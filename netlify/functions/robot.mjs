// Puente entre CotizÁgil (celular) y el robot del PC.
import caRubros from "./ca_rubros.json";
import PROV_SEED from "./proveedores_seed.json";   // 📒 facturas de compra leídas del SII (13-11-2026) para sembrar la base de proveedores
// El celular pide "Hacer oferta"; el robot del PC toma el pedido, prepara la oferta en
// Mercado Público y va informando el estado. El envío final y la declaración jurada
// los hace siempre la persona en mercadopublico.cl.
//
// Seguridad: todas las llamadas exigen el encabezado x-robot-token igual a la variable
// de entorno ROBOT_TOKEN (configurada en Netlify, nunca en el código ni en index.html).
import { getStore } from "@netlify/blobs";
import {
  timingSafeEqual, createHash, createHmac, createECDH, createCipheriv, createPrivateKey,
  generateKeyPairSync, randomBytes, sign,
} from "node:crypto";

export const config = { path: ["/bot", "/bot/*"] };

// 🧪 AISLAMIENTO DE ENTORNOS (producción vs. simulador/staging). Producción usa el store de siempre, "robot", INTACTO.
// Cualquier deploy de rama o preview (staging) usa un store APARTE ("robot-<rama>") → las pruebas NUNCA tocan los datos
// reales (tu cola, tus enviadas). Fail-safe: si Netlify no da contexto, se asume producción y se usa "robot".
const _CTX = process.env.CONTEXT || "production";
const STORE = _CTX === "production"
  ? "robot"
  : "robot-" + String(process.env.BRANCH || _CTX).replace(/[^a-z0-9_-]/gi, "-").slice(0, 40);

const ESTADOS_ACTIVOS = new Set(["en_cola", "tomado", "preparando", "lista", "lic_bajando", "lic_captcha", "lic_analizando", "lic_ingresando"]);
const COD_LIC = /^\d{1,8}-\d{1,8}-[A-Z][A-Z0-9]\d{2}$/;      // licitaciones: 2736-46-LE26, 1234-5-LP26, 99-1-L126…
const MP_INACTIVO_MS = 45000;          // la pestaña de Mercado Público late cada ~10 s mientras está abierta
const ACCIONES = new Set(["ofertar", "editar", "probar", "firmar", "verificar", "licitar", "lic_firmar", "lic_ingresar"]);
const MAX_PDF = 4_500_000;
const RADAR_CA = "https://radar-publico-blond.vercel.app/mp2/v2/compra-agil";   // API oficial de Compra Ágil (v2) vía RadarPúblico                 // bytes del PDF (en base64 crece ~33%; Netlify acepta ~6 MB)
const ROBOT_INACTIVO_MS = 90_000;          // si el PC no da señales en 90 s se considera desconectado
const TOMADO_VENCE_MS = 10 * 60_000;       // un pedido tomado que no avanza vuelve a la cola

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function autorizado(req) {
  const esperado = process.env.ROBOT_TOKEN || "";
  const recibido = req.headers.get("x-robot-token") || "";
  if (esperado.length < 16 || !recibido) return false;
  const a = createHash("sha256").update(esperado).digest();
  const b = createHash("sha256").update(recibido).digest();
  return timingSafeEqual(a, b);
}

// copia segura de un JSON libre (textos cortos, listas y objetos acotados)
function limpiaJSON(v, d) {
  if (v == null || d > 4) return null;
  if (typeof v === "string") return v.slice(0, 600);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.slice(0, 25).map((x) => limpiaJSON(x, d + 1));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [String(k).slice(0, 40), limpiaJSON(x, d + 1)]));
  return null;
}
const limpiaCodigo = (c) => String(c || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);
const texto = (s, n = 400) => (s == null ? null : String(s).slice(0, n));
const ahora = () => new Date().toISOString();

async function leer(store, codigo) {
  return store.get("trabajo/" + codigo, { type: "json" });
}
async function escribir(store, t) {
  t.actualizado = ahora();
  await store.setJSON("trabajo/" + t.codigo, t);
  return t;
}
function anotar(t, estado, mensaje) {
  if (estado && estado !== t.estado) {
    t.historial = [...(t.historial || []), { t: ahora(), estado, mensaje: texto(mensaje, 300) }].slice(-25);
  }
  if (estado) t.estado = estado;
  if (mensaje !== undefined) t.mensaje = texto(mensaje, 600);
}
// Rapidez: leer cientos de trabajos uno por uno tardaba ~2 s en cada consulta del celular.
// Ahora se guarda una copia (en memoria y en un blob) y solo se vuelven a leer los que cambiaron (etag distinto).
const MEMO = { mapa: null };
async function todos(store) {
  const { blobs } = await store.list({ prefix: "trabajo/" });
  if (!MEMO.mapa) MEMO.mapa = (await store.get("cache/todos", { type: "json" }).catch(() => null)) || {};
  const m = MEMO.mapa, vivos = new Set();
  const cambiados = blobs.filter((b) => { vivos.add(b.key); return !m[b.key] || m[b.key].e !== b.etag; });
  await Promise.all(cambiados.map(async (b) => {
    const d = await store.get(b.key, { type: "json" }).catch(() => null);
    if (d) m[b.key] = { e: b.etag, d }; else delete m[b.key];
  }));
  let borrados = 0;
  for (const k of Object.keys(m)) if (!vivos.has(k)) { delete m[k]; borrados++; }
  if (cambiados.length || borrados) await store.setJSON("cache/todos", m).catch(() => {});
  return Object.values(m).map((x) => x.d).sort((a, b) => (b.actualizado || "").localeCompare(a.actualizado || ""));
}
// Lector SIN caché: el simulador vive en su propio store aislado ("robot-sim"). No puede usar todos() porque ese
// MEMO.mapa es un caché compartido por clave de blob; mezclarlo entre el store real y el simulado corrompería ambos.
async function todosSim(store) {
  const { blobs } = await store.list({ prefix: "trabajo/" });
  const out = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" }).catch(() => null)));
  return out.filter(Boolean).sort((a, b) => (b.actualizado || "").localeCompare(a.actualizado || ""));
}
// El store del simulador es SIEMPRE "robot-sim", en cualquier entorno. Nunca toca los datos reales ("robot").
const storeSim = () => getStore({ name: "robot-sim", consistency: "strong" });
// 🌐 Compras ágiles REALES publicadas (API oficial v2 vía puente RadarPúblico), leídas POR FUERA, sin sesión.
// El simulador las usa para que el latido se vea con datos de verdad — pero siempre en el store aislado "robot-sim".
// (RADAR_CA ya está declarado arriba: mismo puente a la API oficial v2.)
async function traerRealesCA(limite = 20) {
  try {
    const tam = Math.min(50, Math.max(10, limite));
    const r = await fetch(`${RADAR_CA}?estado=publicada&tamano_pagina=${tam}&ordenar_por=FechaCierre&numero_pagina=1`,
      { headers: { "user-agent": "CotizAgil-Sim/1.0", accept: "application/json" } });
    const j = await r.json().catch(() => ({}));
    const items = (j && j.payload && j.payload.items) || [];
    return items.map((p) => {
      const m = p.montos || {}, ins = p.institucion || {};
      const total = Math.round(Number(m.monto_disponible_clp || m.monto_disponible || 0)) || 0;
      return { codigo: p.codigo, nombre: (p.nombre || "").trim() || p.codigo,
        organismo: (ins.unidad_compra || ins.organismo_comprador || "").trim() || "Organismo público",
        total, cierre: (p.fechas || {}).fecha_cierre || "", region: (ins.nombre_region || "").trim() };
    }).filter((x) => x.codigo);
  } catch { return []; }
}
function nuevaSimReal(base, estado) {
  const total = base.total || (100000 + Math.floor(Math.random() * 3000000));
  const t = {
    codigo: base.codigo, accion: "firmar", descuento: 0.08, sim: true, real: true, origen: "api",
    nombre: base.nombre, organismo: base.organismo, monto: total, creado: ahora(), estado: null, mensaje: null, historial: [],
    total, neto: Math.round(total / 1.19), plazo: "5 días", cierre: base.cierre || "",
    detalle: "Compra ágil REAL leída por fuera (API, sin sesión). Flujo simulado — sin Mercado Público, sin firma real.",
    items: [{ id: "1", nombre: base.nombre, cantidad: 1, precio: total }], pdf: false, envios: 0,
    jugador: "sim", dispositivo: "simulador", empresa: null,
  };
  anotar(t, estado, "🌐 Leída por fuera (API oficial). En cola.");
  return t;
}
// Saca una compra real del pool cacheado (se rellena desde la API cuando se vacía).
async function tomarDelPool(store) {
  let pool = (await store.get("sim/pool", { type: "json" })) || [];
  if (!pool.length) pool = await traerRealesCA(30);
  const base = pool.shift();
  await store.setJSON("sim/pool", pool);
  return base || null;
}

// 🧪 fábrica de cotizaciones ficticias (solo staging)
const SIM_NOMBRES = ["Implementos deportivos", "Insumos de aseo", "Artículos de oficina", "Equipos computacionales",
  "Mobiliario escolar", "Herramientas", "Material eléctrico", "Textiles", "Señalética", "Equipos médicos"];
function nuevaSim(estado) {
  const total = 100000 + Math.floor(Math.random() * 5000000);
  const nom = SIM_NOMBRES[Math.floor(Math.random() * SIM_NOMBRES.length)];
  const t = {
    codigo: `SIM-${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}-COT26`, accion: "firmar", descuento: 0.08, sim: true,
    nombre: nom + " (simulada)", organismo: "MUNICIPALIDAD DE PRUEBA", monto: total, creado: ahora(), estado: null, mensaje: null, historial: [],
    total, neto: Math.round(total / 1.19), plazo: "5 días", detalle: "Cotización de prueba — sin Mercado Público real.",
    items: [{ id: "1", nombre: nom, cantidad: 10, precio: Math.round(total / 10) }], pdf: false, envios: 0, jugador: "sim", dispositivo: "simulador", empresa: null,
  };
  anotar(t, estado, "🧪 Simulada.");
  return t;
}

// 🧪 ROBOT SIMULADO (solo staging, NUNCA producción). (1) Avanza las ficticias SOLAS y RÁPIDO hasta «por firmar»
// (en_cola → preparando → lista), así la COLA SE ACUMULA EN FIRMAR. (2) En «demo de carga» el robot TOMA trabajo
// nuevo sin parar (se mantiene produciendo) y un HUMANO SIMULADO firma una cada 25 s → ves al robot producir más
// rápido de lo que un humano firma. Finge robot + MP verdes para que el simulador se vea vivo sin un PC real.
async function simTick(store) {
  await store.setJSON("robot/latido", { visto: ahora(), libre: true, tarea: "🧪 Robot simulado produciendo fichas", version: "sim", cola: {} });
  await store.setJSON("mp/latido", { visto: ahora(), logueado: true });
  let lista = await todosSim(store);
  const now = Date.now();
  // 1) avance RÁPIDO: en_cola → preparando (1.2 s) → lista/por firmar (2.5 s)
  const sig = { en_cola: "preparando", tomado: "preparando", preparando: "lista" };
  const espera = { en_cola: 1200, tomado: 1200, preparando: 2500 };
  for (const t of lista) {
    if (!t.sim || !sig[t.estado]) continue;
    if (now - Date.parse(t.actualizado || t.creado || 0) < (espera[t.estado] || 2000)) continue;
    const nxt = sig[t.estado];
    anotar(t, nxt, nxt === "lista" ? "🧪 ✍️ Lista para firmar." : "🧪 Preparando la ficha…");
    await escribir(store, t);
  }
  // 2) DEMO DE CARGA
  const demo = (await store.get("sim/demo", { type: "json" })) || null;
  if (demo && demo.on) {
    lista = await todosSim(store);
    const sims = lista.filter((t) => t.sim);
    const activas = sims.filter((t) => ["en_cola", "preparando", "tomado"].includes(t.estado)).length;
    const porFirmar = sims.filter((t) => t.estado === "lista");
    if (activas < 4 && sims.length < 40) {                                              // el robot nunca se queda sin qué hacer
      const base = await tomarDelPool(store);                                           // prefiere compras REALES leídas por fuera
      await escribir(store, base ? nuevaSimReal(base, "en_cola") : nuevaSim("en_cola"));
    }
    if (porFirmar.length && now - Date.parse(demo.firmo || demo.t0 || 0) > 25000) {    // humano simulado: 1 firma / 25 s
      const vieja = porFirmar.sort((a, b) => (a.actualizado || "").localeCompare(b.actualizado || ""))[0];
      anotar(vieja, "enviada", "🧪 Firmada por el humano simulado (25 s).");
      vieja.envios = (vieja.envios || 0) + 1;
      await escribir(store, vieja);
      demo.firmo = ahora();
      await store.setJSON("sim/demo", demo);
    }
  }
}
// 🎮 cada celular juega su propio juego: sus seleccionadas y descartes van en su propio cajón
const jug = (v) => String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
const cajon = (base, j) => (j ? base + "/j/" + j : base);
async function leerCajon(store, base, j, legado) {
  const propio = (await store.get(cajon(base, j), { type: "json" })) || {};
  if (!j || !legado) return propio;
  return { ...((await store.get(base, { type: "json" })) || {}), ...propio };
}
async function cuerpo(req) {
  try { return await req.json(); } catch { return {}; }
}

// ---------- avisos push (llegan al celular aunque la app esté cerrada) ----------
// Web Push estándar (RFC 8291 + VAPID RFC 8292) con el crypto de Node: sin dependencias extra.
// Las claves VAPID se crean solas la primera vez y quedan guardadas en Netlify Blobs.
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const deB64u = (s) => Buffer.from(String(s), "base64url");
const hmac = (clave, dato) => createHmac("sha256", clave).update(dato).digest();

async function vapid(store) {
  let v = await store.get("push/vapid", { type: "json" });
  if (!v?.publicKey || !v?.jwk) {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = privateKey.export({ format: "jwk" });
    v = { jwk, publicKey: b64u(Buffer.concat([Buffer.from([4]), deB64u(jwk.x), deB64u(jwk.y)])) };
    await store.setJSON("push/vapid", v);
  }
  return v;
}

// Cifra el mensaje para un teléfono (aes128gcm). `efimera` y `sal` solo se pasan en pruebas.
export function _cifrarPush(sub, texto, efimera, sal) {
  const uaPub = deB64u(sub.keys.p256dh), auth = deB64u(sub.keys.auth);
  const ecdh = createECDH("prime256v1");
  if (efimera) ecdh.setPrivateKey(efimera); else ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const secreto = ecdh.computeSecret(uaPub);
  const ikm = hmac(hmac(auth, secreto), Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub, Buffer.from([1])]));
  const salt = sal || randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const c = createCipheriv("aes-128-gcm", cek, nonce);
  const cifrado = Buffer.concat([c.update(Buffer.concat([Buffer.from(texto), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, cifrado]);
}

function jwtVapid(v, endpoint) {
  const enc = (o) => b64u(JSON.stringify(o));
  const datos = enc({ typ: "JWT", alg: "ES256" }) + "." +
    enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:avisos@cotizagil.app" });
  const firma = sign("sha256", Buffer.from(datos), { key: createPrivateKey({ key: v.jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return datos + "." + b64u(firma);
}

async function enviarPush(v, sub, texto, urgente) {
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "content-encoding": "aes128gcm", "content-type": "application/octet-stream",
      ttl: "3600", urgency: urgente ? "high" : "normal",
      authorization: `vapid t=${jwtVapid(v, sub.endpoint)}, k=${v.publicKey}`,
    },
    body: _cifrarPush(sub, texto),
  });
  return r.status;
}
const idSub = (endpoint) => createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 32);

const AVISO = {
  lista:      (t) => ["Falta tu clic · " + t.codigo, `${clpTxt(t.total)} lista en el robot. Presiona «Enviar cotización» y acepta la declaración.`, true],
  enviada:    (t) => ["Oferta enviada · " + t.codigo, clpTxt(t.total), false],
  confirmada: (t) => ["Oferta confirmada · " + t.codigo, `${clpTxt(t.total)} · confirmada en Mercado Público`, false],
  requiere:   (t) => ["Necesita tu atención · " + t.codigo, t.mensaje || "", true],
  error:      (t) => ["No se pudo · " + t.codigo, t.mensaje || "", true],
  probada:    (t) => ["Prueba lista · " + t.codigo, clpTxt(t.total), false],
  firmar:     (t) => ["Lista para firmar · " + t.codigo, `${clpTxt(t.total)} · abre la app, toca «Ir a firmar» y usa Rellenar.`, true],
};
function clpTxt(n) {
  return n ? "$" + Math.round(n).toLocaleString("es-CL") : "Oferta";
}

async function avisar(store, t) {
  const f = AVISO[t.estado];
  if (!f) return;
  const [title, body, urgente] = f(t);
  const { blobs } = await store.list({ prefix: "push/sub/" });
  if (!blobs.length) return;
  const v = await vapid(store);
  const payload = JSON.stringify({
    title, body: (t.nombre ? t.nombre.slice(0, 70) + " · " : "") + body,
    tag: `rb-${t.codigo}-${t.estado}`, url: `/#robot=${encodeURIComponent(t.codigo)}`, urgente,
  });
  await Promise.all(blobs.map(async (b) => {
    const sub = await store.get(b.key, { type: "json" });
    if (!sub) return;
    try {
      const status = await enviarPush(v, sub, payload, urgente);
      if (status === 404 || status === 410) await store.delete(b.key);   // teléfono que ya no existe
    } catch { /* sin red hacia el servicio push: se intenta en el próximo aviso */ }
  }));
}

// aviso libre (recordatorios, asistente): a todos los teléfonos suscritos
// 💬 WhatsApp Business (API oficial de Meta): si está configurado, el robot escribe y conversa solo
const WA = () => (process.env.WA_TOKEN && process.env.WA_PHONE_ID ? { token: process.env.WA_TOKEN, id: process.env.WA_PHONE_ID } : null);
const waTel = (n) => { let d = String(n || "").replace(/\D/g, ""); if (d.length === 9 && d[0] === "9") d = "56" + d; if (d.length === 8) d = "569" + d; return d.length >= 10 ? d : ""; };
const EMPRESA = () => process.env.EMPRESA_NOMBRE || "PJANIC SpA";
async function waEnviar(tel, txt, plantilla) {
  const w = WA(); if (!w || !tel) return { ok: false, error: "sin WhatsApp Business" };
  if (plantilla && !process.env.WA_TEMPLATE) return { ok: false, error: "falta la plantilla aprobada (WA_TEMPLATE)" };
  const body = plantilla
    ? { messaging_product: "whatsapp", to: tel, type: "template", template: { name: process.env.WA_TEMPLATE, language: { code: process.env.WA_LANG || "es" },
        components: [{ type: "body", parameters: [{ type: "text", text: String(txt).replace(/\s+/g, " ").slice(0, 900) }] }] } }
    : { messaging_product: "whatsapp", to: tel, type: "text", text: { body: String(txt).slice(0, 4000) } };
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${w.id}/messages`, { method: "POST", headers: { authorization: "Bearer " + w.token, "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, id: j.messages?.[0]?.id || null } : { ok: false, error: j.error?.message || "HTTP " + r.status };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
// conversación con un proveedor (WhatsApp / Marketplace): mensajes, lo que sugiere la IA y el precio que sacó
function chatDe(op, k, base = {}) {
  op.chats = op.chats || {};
  const c = op.chats[k] || (op.chats[k] = { canal: "wa", nombre: "", tel: "", msgs: [], creado: ahora() });
  for (const x of ["canal", "nombre", "tel", "link", "motivo"]) if (base[x]) c[x] = texto(base[x], 300);
  if (c.tel) c.tel = waTel(c.tel) || c.tel;
  return c;
}
async function chatEncolar(store, codigo, k) {
  const q = (await store.get("chat/cola", { type: "json" })) || [];
  if (!q.some((x) => x.codigo === codigo && x.k === k)) q.push({ codigo, k, t: ahora() });
  await store.setJSON("chat/cola", q.slice(-100));
}
// manda (si hay WhatsApp Business y teléfono) y anota el mensaje; si no, queda listo para enviarlo con un toque
async function chatMandar(store, codigo, k, c, txt, ia) {
  const m = { de: "yo", txt: texto(txt, 3000), t: ahora(), ia: !!ia, enviado: false };
  if (c.canal === "wa" && WA() && c.tel) {
    const dentro24 = c.ult_entrante && Date.now() - Date.parse(c.ult_entrante) < 23.5 * 3600_000;
    const r = await waEnviar(c.tel, txt, !dentro24);
    m.enviado = r.ok; m.auto = r.ok; if (!r.ok) m.error = texto(r.error, 200);
    if (r.ok) { const mp = (await store.get("chat/tel", { type: "json" })) || {}; mp[c.tel] = { codigo, k, t: ahora() }; await store.setJSON("chat/tel", mp); }
  }
  c.msgs = [...(c.msgs || []), m].slice(-40);
  c.sugerido = null;
  return m;
}
// lo que la IA (en el PC) entendió de la conversación → precio, correo, cuenta; y responde sola si va por WhatsApp Business
async function chatAplicar(store, t, k, a) {
  const op = t.op || (t.op = { etapa: "previa", historial: [] }), c = chatDe(op, k);
  const precio = Math.max(0, Math.round(Number(a.precio_total_con_iva) || 0)) || null;
  c.pendiente = false; c.resumen = texto(a.resumen, 300) || c.resumen;
  if (precio) { c.precio = precio; const v = a.incluye_iva === false ? Math.round(precio * 1.19) : precio;
    op.cotizaciones = { ...(op.cotizaciones || {}), [k]: { v, nombre: c.nombre || k, t: ahora(), auto: true, via: c.canal } }; }
  const ult = [...(c.msgs || [])].reverse().find((m) => m.de === "el");
  const r = { id: idCorto(), t: ahora(), k, quien: "proveedor", via: c.canal, de: c.tel || c.canal, de_nombre: c.nombre, asunto: c.canal === "wa" ? "WhatsApp" : "Marketplace",
    texto: texto(ult?.txt, 1500), resumen: texto(a.resumen, 300), tipo: "cotizacion", precio, incluye_iva: a.incluye_iva !== false, plazo: texto(a.plazo, 120), stock: texto(a.stock, 120),
    despacha: a.despacha ?? null, costo_despacho: Math.round(Number(a.costo_despacho) || 0) || null,
    cuenta: a.cuenta && typeof a.cuenta === "object" && (a.cuenta.numero || a.cuenta.banco) ? Object.fromEntries(["banco", "tipo", "numero", "rut", "titular", "email"].map((x) => [x, texto(a.cuenta[x], 80)])) : null,
    message_id: "chat-" + k + "-" + (c.msgs || []).length, visto: false };
  if (r.resumen || r.precio) { op.respuestas = [...(op.respuestas || []).filter((x) => x.message_id !== r.message_id), r].slice(-40);
    op.contactados = { ...(op.contactados || {}), [k]: { ...((op.contactados || {})[k] || {}), respondio: r.t, nombre: c.nombre || (op.contactados || {})[k]?.nombre } }; }
  // 📧 rescató el correo: si el anterior rebotó, se reenvía la solicitud de cotización al correo nuevo
  const mail = String(a.email || "").trim().toLowerCase();
  const cont = (op.contactados || {})[k] || {};
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(mail) && mail !== c.email) {
    c.email = mail;
    op.extras = (op.extras || []).map((x) => (x.proveedor && kProvS(x.proveedor) === k ? { ...x, email: mail } : x));
    if (!(op.extras || []).some((x) => kProvS(x.proveedor) === k) && c.nombre) op.extras = [...(op.extras || []), { proveedor: c.nombre, telefono: c.tel, email: mail, fuente: c.canal }].slice(-8);
    const prev = (op.cuerpos || {})[k];
    if (cont.estado === "rebotó" && prev) {
      const cola = (await store.get("correo/cola", { type: "json" })) || [];
      cola.push({ id: idCorto(), codigo: t.codigo, to: mail, asunto: prev.asunto, cuerpo: prev.cuerpo, k, nombre: c.nombre, tipo: "cotizacion", adjunto_doc: null, responder_a: null, creado: ahora() });
      await store.setJSON("correo/cola", cola.slice(-200));
      op.contactados = { ...(op.contactados || {}), [k]: { ...cont, via: "correo", estado: "en_cola", error: null, t: ahora(), rescatado: mail } };
    }
  }
  if (r.cuenta && !op.banco_proveedor && (!op.proveedor || k === (op.proveedor_k || ""))) op.banco_proveedor = [r.cuenta.banco, r.cuenta.tipo, r.cuenta.numero, r.cuenta.rut && "RUT " + r.cuenta.rut, r.cuenta.titular, r.cuenta.email].filter(Boolean).join(" · ");
  let enviado = null;
  const resp = texto(a.respuesta, 1500);
  if (resp) {
    if (c.canal === "wa" && WA() && c.tel && c.auto !== false) enviado = await chatMandar(store, t.codigo, k, c, resp, true);
    else c.sugerido = resp;
  }
  return { c, r, enviado, mail };
}
const kProvS = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
function contextoChat(t, k) {
  const op = t.op || {}, inf = op.informe || {}, c = (op.chats || {})[k] || {};
  return { codigo: t.codigo, k, canal: c.canal, nombre: c.nombre, empresa: EMPRESA(), motivo: c.motivo || "",
    que: (inf.que_comprar || inf.productos || []).slice(0, 8).map((x) => `${x.cantidad ?? ""} ${x.unidad || ""} ${x.que || x.nombre || ""}${x.detalle ? " (" + String(x.detalle).slice(0, 160) + ")" : ""}`.trim()).join("; "),
    lugar: t.oc_compra?.direccion || inf.direccion || "", plazo: op.plazo_fecha || "", msgs: (c.msgs || []).slice(-20).map((m) => ({ de: m.de, txt: m.txt })),
    ya: { precio: c.precio || null, email: c.email || null } };
}

async function avisarTexto(store, title, body, tag, url, urgente) {
  const { blobs } = await store.list({ prefix: "push/sub/" });
  if (!blobs.length) return;
  const v = await vapid(store);
  const payload = JSON.stringify({ title, body, tag, url: url || "/#robot", urgente: !!urgente });
  await Promise.all(blobs.map(async (b) => {
    const sub = await store.get(b.key, { type: "json" });
    if (!sub) return;
    try { const st = await enviarPush(v, sub, payload, urgente); if (st === 404 || st === 410) await store.delete(b.key); } catch {}
  }));
}
const idCorto = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// La página de la cotización en Mercado Público puede pedir tus datos de firma y el PDF (con tu código de enlace)
const ORIGEN_MP = "https://compra-agil.mercadopublico.cl";
const ORIGENES_MP = new Set([ORIGEN_MP, "https://www.mercadopublico.cl"]);
// 🔎 estado en vivo de las ofertas enviadas (RadarPúblico) + avisos «vas 1°» / «te seleccionaron»
async function revisarSeguimiento(store, forzar) {
  const robot = (await store.get("robot/latido", { type: "json" })) || {};
  const miRut = String(robot.rut || process.env.PROVEEDOR_RUT || "").replace(/[.\s]/g, "").toUpperCase();
  const lista = (await todos(store)).filter((t) => (t.estado === "enviada" || t.estado === "confirmada") && /COT\d{2}$/.test(t.codigo));
  const cache = (await store.get("seguimiento/cache", { type: "json" })) || {};
  const res = {};
  // de a 4 consultas a la vez: RadarPúblico corta (429) si recibe muchas juntas; lo que no alcance queda para la próxima
  const fila = lista.slice(0, 300), inicio = Date.now();
  const uno = async (t) => {
    const c = cache[t.codigo];
    try {
      const r = await fetch(RADAR_CA + "/" + encodeURIComponent(t.codigo), { headers: { "user-agent": "CotizAgil/1.0", accept: "application/json" }, signal: AbortSignal.timeout(forzar ? 6000 : 3500) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const p = (await r.json()).payload || {};
      const pc = Array.isArray(p.proveedores_cotizando) ? p.proveedores_cotizando : [];
      const rut = (x) => String(x.rut_proveedor || "").replace(/[.\s]/g, "").toUpperCase();
      const yo = pc.find((x) => miRut && rut(x) === miRut) || pc.find((x) => t.total && Math.abs((x.monto_total || 0) - t.total) <= 50);
      const sel = pc.find((x) => x.proveedor_seleccionado);
      const orden = pc.filter((x) => x.activo !== 0).map((x) => x.monto_total || 0).sort((a, b) => a - b);
      const e = p.estado || {};
      res[t.codigo] = cache[t.codigo] = {
        visto: ahora(), estado: e.codigo || null, glosa: e.glosa || null,
        ofertas: (p.resumen || {}).total_ofertas_recibidas ?? pc.length, competidores: pc.length,
        mi_total: yo?.monto_total ?? null, mi_lugar: yo ? orden.indexOf(yo.monto_total) + 1 : null,
        mas_baja: orden[0] ?? null, ganada: !!(yo && yo.proveedor_seleccionado),
        ganador: sel ? texto(sel.razon_social, 120) : null, ganador_total: sel?.monto_total ?? null,
        oc: (yo && yo.proveedor_seleccionado ? yo.id_oc : null) || (yo && yo.proveedor_seleccionado ? p.id_orden_compra : null) || null,
        oc_compra: p.id_orden_compra || null, inadmisible: texto(yo?.justificacion_inadmisibilidad, 200),
        cierre: (p.fechas || {}).fecha_cierre || null, motivo: texto((p.motivos || {}).motivo_cancelacion || (p.motivos || {}).motivo_desierta, 200),
        presupuesto: (p.presupuesto || {}).monto_disponible_clp || null, llamado: (p.convocatoria || {}).descripcion || null,
        siguiente: pc.filter((x) => x !== yo && x.activo !== 0).map((x) => x.monto_total || 0).sort((a, b) => a - b)[0] ?? null,
      };
      const g = res[t.codigo];          // lo que se pudo cobrar: hasta el presupuesto o justo bajo el siguiente competidor
      const techo = Math.min(...[g.presupuesto, g.siguiente ? g.siguiente - 1 : null].filter(Boolean));
      g.dejado = g.ganada && isFinite(techo) && g.mi_total ? Math.max(0, Math.round(techo - g.mi_total)) : null;
    } catch (err) {
      res[t.codigo] = cache[t.codigo] = { ...(c || {}), error: String(err.message || err).slice(0, 120), visto: ahora() };
    }
  };
  const pendientes = [];
  for (const t of fila) {            // primero lo que ya está en caché (instantáneo), luego consultas reales
    const c = cache[t.codigo];
    const final = c && (c.ganada || ["cancelada", "desierta"].includes(c.estado) || (c.estado === "proveedor_seleccionado" && c.ganador));
    const edad = c ? Date.now() - Date.parse(c.visto) : Infinity;
    if (c && !forzar && (c.error ? edad < 3 * 60_000 : edad < (final ? 6 * 3600_000 : 10 * 60_000))) res[t.codigo] = c; else pendientes.push(t);
  }
  pendientes.sort((a, b) => (cache[a.codigo]?.visto || "").localeCompare(cache[b.codigo]?.visto || ""));   // lo más viejo primero
  let i = 0, limitado = false;
  // nunca hacer esperar al celular: a los 3 s (9 s si pidió «actualizar») responde con lo que haya
  await Promise.race([Promise.all(Array.from({ length: 4 }, async () => {
    while (i < pendientes.length && !limitado && Date.now() - inicio < (forzar ? 8000 : 2500)) {
      const t = pendientes[i++];
      await uno(t);
      if (String(res[t.codigo]?.error || "").includes("429")) limitado = true;
    }
  })), new Promise((ok) => setTimeout(ok, forzar ? 9000 : 3000))]);
  for (const t of pendientes) if (!res[t.codigo]) res[t.codigo] = cache[t.codigo] || { pendiente: true };
  await store.setJSON("seguimiento/cache", cache);
  for (const t of fila) await transicion(store, t, res[t.codigo]);
  return { res, miRut };
}
// 📞 antes de la OC: si vas 1° (cerrada, en evaluación) se abre el negocio «previa», se pide el informe al PC y se avisa
//    al celular («te pueden llamar»). Si te seleccionan pasa a «ganada» con aviso. Si eligen a otro, se cierra solo.
async function transicion(store, t, g) {
  if (!g || g.pendiente || (g.error && !g.estado)) return;
  const op = t.op, nom = (t.nombre || "").slice(0, 80);
  if (g.ganada) {
    if (!op || op.etapa === "previa") {
      t.op = { ...(op || {}), etapa: "ganada", historial: [...((op || {}).historial || []), { t: ahora(), etapa: "ganada" }],
        pedido_informe: (op || {}).pedido_informe || { t: ahora() }, oc: g.oc || (op || {}).oc || null, concretar_pendiente: !(op || {}).concrecion };
      await escribir(store, t);
      await avisarTexto(store, "🏆 ¡Te seleccionaron! " + t.codigo, `${nom} · ${g.oc ? "OC " + g.oc : "proveedor seleccionado (la OC viene en camino)"}. Abre Negocios: proveedores, utilidad y ejecutor listos.`, "sel-" + t.codigo, "/#robot", true).catch(() => {});
    } else if (g.oc && !op.oc) { op.oc = g.oc; await escribir(store, t); }
    return;
  }
  const final = ["cancelada", "desierta"].includes(g.estado) || !!g.ganador;
  if (!op && g.mi_lugar === 1 && g.estado && g.estado !== "publicada" && !final) {
    t.op = { etapa: "previa", historial: [{ t: ahora(), etapa: "previa" }], pedido_informe: { t: ahora() }, primero: ahora() };
    await escribir(store, t);
    const ventaja = g.siguiente && g.mi_total ? " · " + Math.round(g.siguiente - g.mi_total).toLocaleString("es-CL") + " bajo el 2°" : "";
    await avisarTexto(store, "📞 Te pueden llamar: vas 1° · " + t.codigo, `${nom} · tu oferta $${Math.round(g.mi_total || t.total || 0).toLocaleString("es-CL")}${ventaja}. Abre la app: qué decir, proveedores y utilidad ya están listos.`, "pri-" + t.codigo, "/#robot", true).catch(() => {});
    return;
  }
  if (op?.etapa === "previa" && (final || (g.mi_lugar && g.mi_lugar > 1))) {
    delete t.op; t.previa_fin = { t: ahora(), motivo: g.ganador ? "Seleccionaron a " + g.ganador : g.estado || "ya no vas 1°" };
    await escribir(store, t);
  }
}

// 📦 TODAS las órdenes de compra que te mandan (Compra Ágil, trato directo, convenio): directo de la API oficial de Mercado Público.
//    Las que el robot cotizó se marcan «ganada» con su OC; las que cotizaste por fuera entran igual a Negocios con sus ítems.
const RADAR_OC = "https://radar-publico-blond.vercel.app/mp/servicios/v1/publico/ordenesdecompra.json";
const PROV_MP = { "78493114-5": "2129328" };                     // RUT → código de proveedor en Mercado Público
const fechaMP = (d) => { const c = new Date(d.getTime() - 3 * 3600_000); return String(c.getUTCDate()).padStart(2, "0") + String(c.getUTCMonth() + 1).padStart(2, "0") + c.getUTCFullYear(); };
async function getMP(q, ms) {
  const r = await fetch(RADAR_OC + q, { headers: { "user-agent": "CotizAgil/1.0", accept: "application/json" }, signal: AbortSignal.timeout(ms || 12000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return ((await r.json()) || {}).Listado || [];
}
async function revisarOCs(store, forzar) {
  const robot = (await store.get("robot/latido", { type: "json" })) || {};
  const rut = String(robot.rut || process.env.PROVEEDOR_RUT || "78493114-5").replace(/[.\s]/g, "").toUpperCase();
  const prov = process.env.MP_CODIGO_PROVEEDOR || PROV_MP[rut];
  if (!prov) return { error: "Sin código de proveedor para " + rut };
  const reg = (await store.get("oc/lista", { type: "json" })) || {};
  const ini = Date.now();
  const dias = Array.from({ length: reg._lleno ? 3 : 40 }, (_, i) => fechaMP(new Date(Date.now() - i * 864e5)));
  const vistos = {}; let k = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (k < dias.length && Date.now() - ini < 15000) {
      const f = dias[k++];
      try { for (const x of await getMP("?CodigoProveedor=" + prov + "&fecha=" + f)) vistos[x.Codigo] = x.CodigoEstado; } catch {}
    }
  }));
  if (k >= dias.length) reg._lleno = true;
  const nuevos = Object.keys(vistos).filter((c) => !reg[c] || reg[c].estado_cod !== vistos[c] || forzar);
  for (const c of nuevos.slice(0, 12)) {
    if (Date.now() - ini > 22000) break;
    try {
      const d = (await getMP("?codigo=" + encodeURIComponent(c)))[0];
      if (!d) continue;
      const cot = ((d.Nombre || "") + " " + (d.Descripcion || "")).match(/\b\d{1,8}-\d{1,8}-COT\d{2}\b/);
      const C = d.Comprador || {}, F = d.Fechas || {};
      const o = reg[c] = {
        codigo: c, cot: cot ? cot[0].toUpperCase() : null, nombre: texto(d.Nombre, 200), estado: texto(d.Estado, 60), estado_cod: d.CodigoEstado,
        estado_prov: texto(d.EstadoProveedor, 60), tipo: texto(d.Tipo, 10), neto: d.TotalNeto || 0, total: d.Total || 0,
        organismo: texto(C.NombreOrganismo, 200), unidad: texto(C.NombreUnidad, 200), rut_organismo: texto(C.RutUnidad, 20),
        direccion: texto([C.DireccionUnidad, C.ComunaUnidad, C.RegionUnidad].filter(Boolean).join(", "), 300),
        contacto: texto(C.NombreContacto, 120), fono: texto(C.FonoContacto, 40), mail: texto(C.MailContacto, 120),
        enviada: F.FechaEnvio || F.FechaCreacion || null, aceptada: F.FechaAceptacion || null, descripcion: texto(d.Descripcion, 800),
        items: ((d.Items || {}).Listado || []).slice(0, 60).map((i) => ({ nombre: texto(i.Producto, 120), especificacion: texto(i.EspecificacionComprador, 500),
          ofrecido: texto(i.EspecificacionProveedor, 300), cantidad: i.Cantidad, unidad: texto(i.Unidad, 30), precio: i.PrecioNeto, total: i.Total || Math.round((i.PrecioNeto || 0) * (i.Cantidad || 0)) })),
        visto: ahora(),
      };
      await enlazarOC(store, o);
    } catch {}
  }
  await store.setJSON("oc/lista", reg);
  return { ocs: Object.values(reg).filter((x) => x && x.codigo).sort((a, b) => String(b.enviada).localeCompare(String(a.enviada))) };
}
// ---------- 🔵 EJECUCIÓN SIMULADA: el robot lee qué pidió el comprador, arma partidas y devuelve un costo en pesos con su explicación ----------
//  Fases (cada una cabe en el tiempo de la nube): req (Leyendo requerimiento) → partidas (Armando partidas) → costeo (Costeando, una partida por llamada) → listo.
//  Resultado en op.simulacion {t, version_req, requerimiento, partidas[], faltan[], totales, explicacion}. Alimenta Excel en vivo / factoring / reparto simulados.
const TARIFAS_SIM = { hora_taller: 28000, hora_tecnico: 22000, viaje_local: 45000, km: 900, diagnostico: 35000 };   // tarifas estimadas (neto) cuando no hay referencia: se marcan como «tarifa estimada»
const hashTxt = (s2) => { let x = 0; for (const ch of String(s2 || "")) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x.toString(36); };
async function claudeJSON(prompt, maxTok, ms) {
  const key = process.env.ANTHROPIC_API_KEY || ""; if (!key) throw new Error("Falta ANTHROPIC_API_KEY");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: maxTok, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(ms) });
  const j = await r.json(); const txt = (j.content || []).map((c) => c.text || "").join(""); const m = txt.match(/\{[\s\S]*/); if (!m) throw new Error("sin JSON: " + txt.slice(0, 80));
  const raw = m[0]; try { return JSON.parse(raw); } catch {}
  for (const corte of [raw, raw.slice(0, raw.lastIndexOf("}") + 1), raw.slice(0, raw.lastIndexOf('",') + 1), raw.slice(0, raw.lastIndexOf('"') + 1)]) { if (!corte) continue; for (const cierre of ["", "}", "]}", '"]}', '"}]}', '"}}', "}]}", '"]}]}']) { try { return JSON.parse(corte.replace(/,\s*$/, "") + cierre); } catch {} } }
  throw new Error("JSON cortado: " + txt.slice(-60));
}
async function simRequerimiento(store, t, b) {
  const cod = t.codigo, fuentes = [], partes = [];
  // 1) anexos leídos por el robot (caché anexo/<cod>/*), el más reciente
  const { blobs } = await store.list({ prefix: "anexo/" + cod + "/" }).catch(() => ({ blobs: [] }));
  let an = null; for (const bl of blobs) { const x = await store.get(bl.key, { type: "json" }).catch(() => null); if (x?.analisis && (!an || (x.t || "") > (an.t || ""))) an = x; }
  if (an) { fuentes.push({ tipo: "anexo", doc: an.doc || "adjuntos del comprador (leídos por el robot)", t: an.t, seccion: an.item || null }); partes.push("ANÁLISIS DE LOS ANEXOS: " + JSON.stringify({ productos: an.analisis.productos, especificaciones: an.analisis.especificaciones, requisitos: (an.analisis.requisitos || []).slice(0, 20), resumen: an.analisis.resumen })); }
  // 2) texto de requerimiento adjuntado a mano en la OC (Adjuntar requerimiento)
  if (t.op?.req_adjunto?.texto) { fuentes.push({ tipo: "adjunto_manual", doc: t.op.req_adjunto.nombre || "requerimiento pegado", t: t.op.req_adjunto.t }); partes.push("REQUERIMIENTO ADJUNTADO: " + String(t.op.req_adjunto.texto).slice(0, 20000)); }
  // 3) ficha de la compra (portal) + ítems de la OC y de la oferta
  let ficha = null; try { if (/^\d{1,8}-\d{1,8}-COT\d{2}$/.test(cod)) { const r = await fetch(RADAR_CA + "/" + encodeURIComponent(cod), { headers: { "user-agent": "CotizAgil/1.0", accept: "application/json" }, signal: AbortSignal.timeout(7000) }); if (r.ok) { const p = (await r.json()).payload || {}; ficha = { nombre: p.nombre, descripcion: texto(p.descripcion, 2000), productos: (p.productos_solicitados || []).slice(0, 30).map((x) => ({ nombre: texto(x.nombre, 200), detalle: texto(x.descripcion, 300), cantidad: x.cantidad, unidad: texto(x.unidad_medida, 20) })), entrega: p.entrega || null, adjuntos: (p.adjuntos || p.archivos || p.anexos || []).slice(0, 10).map((a) => texto(a?.nombre || a?.name || a, 120)) }; } } } catch {}
  if (ficha) { fuentes.push({ tipo: "ficha", doc: "ficha de la compra en Mercado Público", t: ahora() }); partes.push("FICHA DE LA COMPRA: " + JSON.stringify({ nombre: ficha.nombre, descripcion: ficha.descripcion, productos: ficha.productos, plazo_dias: ficha.entrega?.plazo_entrega_dias, direccion: ficha.entrega?.direccion_entrega })); }
  if (t.oc_compra) { fuentes.push({ tipo: "oc", doc: "orden de compra " + (t.op?.oc_codigo || ""), t: t.oc_compra.fecha || null }); partes.push("ORDEN DE COMPRA: " + JSON.stringify({ items: (t.oc_compra.items || []).map((i) => ({ nombre: i.nombre, especificacion: i.especificacion, cantidad: i.cantidad, precio: i.precio })), total: t.oc_compra.total, direccion: t.oc_compra.direccion, organismo: t.oc_compra.organismo })); }
  if (t.items?.length) partes.push("OFERTA PRESENTADA: " + JSON.stringify(itemsOferta(t).map((i) => ({ d: i.d, q: i.q, p: i.p }))) + (t.detalle ? " · " + t.detalle.slice(0, 400) : ""));
  const menciona = /adjunt|anexo|seg[uú]n detalle/i.test(JSON.stringify([t.items, t.oc_compra?.items, t.nombre]));
  const falta = menciona && !an && !t.op?.req_adjunto?.texto;
  const nombres = ficha?.adjuntos?.length ? ficha.adjuntos : [];
  const req = { t: ahora(), texto: partes.join("\n\n").slice(0, 60000), fuentes, falta_adjunto: falta, adjuntos_nombres: nombres, motivo: falta ? (nombres.length ? "el robot no leyó " + nombres.join(", ") : "la compra pide «según detalle adjunto» y no hay anexos leídos ni adjuntados") : null };
  req.version = hashTxt(req.texto);
  if (falta) { t.anexos_pedido = { t: ahora(), motivo: "simulacion", oc: t.op?.oc_codigo || null }; }   // señal para el robot del PC: subir los adjuntos de salida/<cod>/adjuntos_comprador
  return req;
}
async function simPartidas(t, req) {
  const prompt = `Eres el jefe técnico de un proveedor del Estado de Chile. Debes planificar la ejecución de la orden de compra ${t.op?.oc_codigo || ""} (compra ${t.codigo}: «${t.nombre || ""}», ${t.oc_compra?.organismo || t.organismo || ""}, entrega en ${t.oc_compra?.direccion || ""}).
Con el requerimiento de abajo, DESCOMPÓN el proyecto en partidas ANTES de buscar precios. Extrae: vehículos/equipos/componentes/repuestos con cantidades, lugar, plazo y condiciones. Arma partidas para lo que corresponda: diagnostico, desmontaje, retiro, repuesto, instalacion, pruebas, traslado, mano_obra, producto, otro.
Líneas de la OC (para linea_oc, 1..n): ${JSON.stringify((t.oc_compra?.items || itemsOferta(t)).map((i, k) => (k + 1) + ": " + String(i.nombre || i.d || "").slice(0, 60) + " × " + (i.cantidad ?? i.q ?? 1)))}. Si la OC vende 1 servicio, todas las partidas cuelgan de esa línea.
Marca cuáles exige el comprador (exigida=true, con el documento y la sección/página que la respalda) y cuáles son supuestos tuyos (exigida=false, supuesto="…", p. ej. horas de taller estimadas). Si el requerimiento describe una cotización integral (un precio por todo), indica integral.existe=true y qué incluye, para no sumar repuestos o mano de obra dos veces.
No inventes repuestos ni cantidades que no estén en el requerimiento; si falta un dato crítico, ponlo en faltan.
Responde SOLO JSON compacto: {"resumen":"","alcance":{"vehiculos":[""],"componentes":[""],"lugar":"","plazo":"","condiciones":[""]},"partidas":[{"id":"P1","tipo":"repuesto","nombre":"","cantidad":1,"unidad":"un|hora|viaje|km|servicio","linea_oc":1,"exigida":true,"respaldo":{"doc":"","seccion":""},"supuesto":null,"busqueda":"<qué buscar en tiendas, si es repuesto/producto>"}],"integral":{"existe":false,"incluye":[""]},"faltan":[""]}

REQUERIMIENTO:
${req.texto.slice(0, 28000)}`;
  const j = await claudeJSON(prompt, 3500, 24000);
  j.partidas = (j.partidas || []).slice(0, 25).map((p2, i) => ({ id: texto(p2.id, 8) || "P" + (i + 1), tipo: texto(p2.tipo, 20) || "otro", nombre: texto(p2.nombre, 160) || "", cantidad: Number(p2.cantidad) || 1, unidad: texto(p2.unidad, 12) || "un", linea_oc: Number(p2.linea_oc) || 1, exigida: p2.exigida !== false, respaldo: p2.respaldo && typeof p2.respaldo === "object" ? { doc: texto(p2.respaldo.doc, 80), seccion: texto(p2.respaldo.seccion, 80) } : null, supuesto: texto(p2.supuesto, 160), busqueda: texto(p2.busqueda, 100), refs: [], costo_unit_neto: null, fuente: null }));
  return j;
}
async function simCostearPartida(store, t, pa) {
  const refs = []; const q = (pa.busqueda || pa.nombre || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const tipoRep = ["repuesto", "producto", "material", "insumo"].includes(pa.tipo);
  // a) cotización recibida (anotada en Ejecuta para esta OC)
  for (const [k, c] of Object.entries(t.op?.cotizaciones || {})) if (c?.v) refs.push({ fuente_tipo: "cotizacion", proveedor: c.nombre || k, precio_unit_neto: Math.round(c.v / 1.19), cubre: "según cotización", t: c.t || ahora(), url: null });
  // b) precio publicado (tiendas chilenas) para repuestos/productos
  if (tipoRep && q) { try { const w = (await webBuscar(q + " precio chile", 6)).map((x) => x.url).filter((u) => /^https?:\/\//.test(u) && !/duckduckgo|wikipedia|youtube|facebook|instagram|\.ar\/|\.pe\/|\.mx\//i.test(u)).slice(0, 3);
      const pags = await Promise.all(w.map((u) => precioPagina(u).catch(() => ({ productos: [] }))));
      for (const pg of pags) for (const pr of (pg.productos || []).filter((x) => x.precio_iva).slice(0, 2)) refs.push({ fuente_tipo: "publicado", proveedor: pr.fuente || String(pr.url || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0], producto: texto(pr.titulo, 120), url: pr.url, precio_unit_neto: Math.round(pr.precio_iva / 1.19), cubre: "1 un.", condiciones: pr.disponible === false ? "sin stock" : "stock y despacho por verificar", t: ahora() }); } catch {} }
  // c) compra histórica comparable (facturas SII de las empresas del grupo)
  try { const base = await baseProveedores(store); const kw = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 3); const ks = kw(pa.nombre);
    for (const c of base.lista || []) for (const pr of c.productos || []) { if (kw(pr.producto).filter((w) => ks.includes(w)).length >= 2 && pr.precio_unit_neto) { refs.push({ fuente_tipo: "historico", proveedor: c.nombre, producto: texto(pr.producto, 120), precio_unit_neto: Math.round(pr.precio_unit_neto), cubre: "compra anterior", t: pr.fecha || c.ultima || null, url: c.web || null, telefono: c.telefono || null }); if (refs.filter((r) => r.fuente_tipo === "historico").length >= 3) break; } } } catch {}
  // d) tarifa estimada para mano de obra / traslado / diagnóstico
  if (!tipoRep || !refs.length) { const u = pa.unidad; const tarifa = u === "hora" ? (/t[eé]cnico/i.test(pa.nombre) ? TARIFAS_SIM.hora_tecnico : TARIFAS_SIM.hora_taller) : u === "km" ? TARIFAS_SIM.km : u === "viaje" ? TARIFAS_SIM.viaje_local : pa.tipo === "diagnostico" ? TARIFAS_SIM.diagnostico : null;
    if (tarifa) refs.push({ fuente_tipo: "tarifa", proveedor: "tarifa estimada " + (u === "hora" ? "hora de taller RM" : u === "km" ? "flete por km RM" : u === "viaje" ? "viaje local RM" : "diagnóstico"), precio_unit_neto: tarifa, cubre: "por " + u, condiciones: "estimación: confirmar con taller/transportista", t: ahora() }); }
  const con = refs.filter((r) => r.precio_unit_neto).sort((a, b2) => a.precio_unit_neto - b2.precio_unit_neto);
  const prio = { cotizacion: 0, historico: 1, publicado: 2, tarifa: 3 }; const mejor = con.sort((a, b2) => prio[a.fuente_tipo] - prio[b2.fuente_tipo] || a.precio_unit_neto - b2.precio_unit_neto)[0] || null;
  pa.refs = refs.slice(0, 8); pa.costo_unit_neto = mejor ? mejor.precio_unit_neto : null; pa.fuente = mejor ? mejor.fuente_tipo : null; pa.ref_idx = mejor ? refs.indexOf(mejor) : null; pa.costeada = true;
  return pa;
}
function simTotales(t, S) {
  const P = S.partidas || [], integral = S.integral?.existe;
  const neto = (pa) => (pa.costo_unit_neto != null ? Math.round(pa.costo_unit_neto * (pa.cantidad || 1)) : null);
  const costeadas = P.filter((pa) => neto(pa) != null), sinCosto = P.filter((pa) => neto(pa) == null);
  const sub = costeadas.reduce((s2, pa) => s2 + neto(pa), 0), flete = costeadas.filter((pa) => pa.tipo === "traslado").reduce((s2, pa) => s2 + neto(pa), 0);
  const criticas = sinCosto.filter((pa) => pa.exigida);
  const estado = !P.length ? "sin_partidas" : criticas.length ? "parcial" : "completo";
  const venta = Number(t.oc_compra?.total || t.total) || 0; const iva = Math.round(sub * 0.19);
  return { subtotal_neto: sub, iva, total_con_iva: sub + iva, flete, partidas_costeadas: costeadas.length, partidas: P.length, sin_costo: sinCosto.map((pa) => pa.nombre), criticas: criticas.map((pa) => pa.nombre), estado, venta, rango: estado === "completo" ? { min: Math.round(sub * 0.9), max: Math.round(sub * 1.15) } : null, integral: !!integral };
}

// 🟢 compra real: varias asignaciones por línea (un proveedor para todo, varios, o línea dividida); cada costo y flete cuenta una vez.
//    Devuelve {error} si falta algo. precio_acordado / flete / proveedor = suma de lo CONFIRMADO.
function aplicarAsignacion(op, A, dispositivo) {
  const b = { dispositivo }; op.asignaciones = op.asignaciones || [];

      if (A.op === "quitar") op.asignaciones = op.asignaciones.filter((x) => x.id !== A.id);
      else { const lineas = Array.isArray(A.lineas) ? A.lineas.slice(0, 40).map((l) => ({ lid: texto(l.lid, 24), cantidad: Math.max(0, Number(l.cantidad) || 0), unidad: texto(l.unidad, 12) })).filter((l) => l.lid && l.cantidad > 0) : [];
        const prev = A.id ? op.asignaciones.find((x) => x.id === A.id) : null;
        const reg = { id: prev?.id || ("a" + Date.now().toString(36) + randomBytes(2).toString("base64url")), proveedor: texto(A.proveedor, 80) || prev?.proveedor || "", url: texto(A.url, 300) || prev?.url || null, telefono: texto(A.telefono, 30) || prev?.telefono || null,
          lineas: lineas.length ? lineas : prev?.lineas || [], modo_precio: A.modo_precio === "total" ? "total" : "unitario", precio_unit_neto: A.precio_unit_neto != null ? Math.max(0, Math.round(Number(A.precio_unit_neto) || 0)) : prev?.precio_unit_neto ?? null,
          total_neto: A.total_neto != null ? Math.max(0, Math.round(Number(A.total_neto) || 0)) : prev?.total_neto ?? null, flete: A.flete != null ? Math.max(0, Math.round(Number(A.flete) || 0)) : prev?.flete || 0, fecha: texto(A.fecha, 10) || prev?.fecha || null,
          estado: A.op === "confirmar" ? "confirmada" : prev?.estado === "confirmada" && A.op !== "add" ? "confirmada" : "por_confirmar", origen: A.origen && typeof A.origen === "object" ? { tipo: texto(A.origen.tipo, 20), partida: texto(A.origen.partida, 10), ref_url: texto(A.origen.ref_url, 300), precio_ref_neto: Math.round(Number(A.origen.precio_ref_neto) || 0) || null } : prev?.origen || null, integral: !!(A.integral ?? prev?.integral), t: ahora(), por: texto(b.dispositivo, 60) };
        if (reg.modo_precio === "unitario" && reg.precio_unit_neto != null) reg.total_neto = Math.round(reg.lineas.reduce((s2, l) => s2 + l.cantidad, 0) * reg.precio_unit_neto);
        if (A.op === "confirmar") { reg.t_confirmada = ahora(); if (!reg.total_neto && !reg.precio_unit_neto) return { error: "Falta el precio neto (unitario o total)." }; if (!reg.lineas.length) return { error: "Elige al menos una línea y su cantidad." }; }
        if (prev) Object.assign(prev, reg); else op.asignaciones.push(reg); }
      // precio acordado y flete = suma de lo CONFIRMADO (cada costo una vez); mientras falten líneas queda como costo confirmado hasta ahora
      const conf = op.asignaciones.filter((x) => x.estado === "confirmada"); const netoC = conf.reduce((s2, x) => s2 + (x.total_neto || 0), 0), fleteC = conf.reduce((s2, x) => s2 + (x.flete || 0), 0);
      if (conf.length) { op.precio_acordado = Math.round(netoC * 1.19); op.costo_transporte = fleteC; op.proveedor = [...new Set(conf.map((x) => x.proveedor).filter(Boolean))].join(" + ").slice(0, 120); op.pedido_informe = { t: ahora() }; }
      else if (op.asignaciones.length === 0 && !Object.keys(op.costos_confirmados || {}).length) { /* nada confirmado: no tocar */ }
      op.compra_confirmada_neto = netoC;
    
  return { ok: true };
}

// ---------- 🧾 DOCUMENTOS (ERP): guía y factura armadas desde la OC, emitidas en el SII por la persona autorizada y devueltas a la OC ----------
//  op.documentos[] {id, tipo: guia|factura, estado: borrador|emitido|firmada_receptor|recepcion_conforme|cobrada, folio, fecha, emisor, receptor,
//   lineas[{lid,d,q,unidad,precio_unit,total}], neto, iva, total, referencias[{tipo:OC|GD|FA, folio, fecha}], motivo_traslado, despacho, forma_pago, origen: erp|importado, archivo}
//  Un mismo folio (tipo + folio + RUT emisor) se guarda una sola vez. La guía firmada por quien recibe (foto) es un respaldo aparte de la guía electrónica.
const rutLimpio = (r) => String(r || "").replace(/[^0-9kK]/g, "").toUpperCase().replace(/^(\d+)(\w)$/, "$1-$2");
function docBorrador(t, emp, b) {
  const op = t.op || {}, oc = t.oc_compra || {}, tipo = b.tipo === "factura" ? "factura" : "guia";
  const lineasOC = (oc.items || []).map((i, k) => ({ lid: (t.items?.[k]?.lid) || "L" + (k + 1), d: i.nombre + (i.especificacion ? " · " + String(i.especificacion).slice(0, 80) : ""), q: Number(i.cantidad) || 1, unidad: i.unidad || "un", precio_unit: Math.round(Number(i.precio) || 0) }));
  const base = lineasOC.length ? lineasOC : itemsOferta(t).map((i) => ({ lid: i.lid || "L1", d: i.d, q: i.q, unidad: "un", precio_unit: i.p }));
  // ya documentado en guías emitidas → saldo por documentar; entrega parcial: cantidades elegidas
  const emitidas = (op.documentos || []).filter((d) => d.tipo === "guia" && d.estado !== "borrador");
  const docQ = (lid) => emitidas.reduce((s2, d) => s2 + ((d.lineas || []).find((l) => l.lid === lid)?.q || 0), 0);
  const sel = b.cantidades && typeof b.cantidades === "object" ? b.cantidades : null;
  const lineas = base.map((l) => { const saldo = Math.max(0, l.q - (tipo === "guia" ? docQ(l.lid) : 0)); const q = sel ? Math.min(saldo, Math.max(0, Number(sel[l.lid]) || 0)) : saldo; return { ...l, q_oc: l.q, q_documentada: docQ(l.lid), saldo, q, total: Math.round(q * l.precio_unit) }; }).filter((l) => l.q > 0 || !sel);
  const neto = lineas.reduce((s2, l) => s2 + l.total, 0), iva = Math.round(neto * 0.19), total = neto + iva;
  const guiaRef = tipo === "factura" ? (op.documentos || []).filter((d) => d.tipo === "guia" && d.estado !== "borrador").slice(-1)[0] : null;
  const referencias = [{ tipo: "OC", folio: op.oc_codigo || op.oc || "", fecha: (oc.enviada || oc.aceptada || "").slice(0, 10) || null }];
  if (guiaRef) referencias.push({ tipo: "GD", folio: guiaRef.folio, fecha: guiaRef.fecha });
  const emisor = { razon_social: emp?.razon_social || null, rut: emp?.rut || null, giro: emp?.giro || null, direccion: emp?.direccion || null, comuna: emp?.comuna || null, ciudad: emp?.ciudad || null, email: emp?.email || null };
  const receptor = { razon_social: oc.organismo || t.organismo || null, rut: oc.rut_organismo || null, giro: "Administración pública", direccion: oc.direccion || null, comuna: oc.comuna || null, contacto: oc.contacto || null, fono: oc.fono || null, mail: oc.mail || null, unidad: oc.unidad || null };
  const faltan = [];
  for (const [k, v] of Object.entries({ "RUT emisor": emisor.rut, "giro emisor": emisor.giro, "dirección emisor": emisor.direccion, "comuna emisor": emisor.comuna, "RUT receptor": receptor.rut, "dirección receptor": receptor.direccion, "N° OC": referencias[0].folio })) if (!v) faltan.push(k);
  if (tipo === "guia" && !op.despacho_modo && !op.transportista) faltan.push("datos del despacho (quién transporta, patente)");
  if (tipo === "factura" && !guiaRef) faltan.push("guía emitida (se factura desde la guía)");
  if (receptor.direccion && !/,/.test(receptor.direccion)) faltan.push("comuna receptor (revisar)");
  return { id: "d" + Date.now().toString(36), tipo, estado: "borrador", folio: null, fecha: ahora().slice(0, 10), emisor, receptor, lineas, neto, iva, total, referencias,
    motivo_traslado: tipo === "guia" ? (texto(b.motivo, 60) || "Venta") : null, despacho: tipo === "guia" ? { modo: op.despacho_modo || null, transportista: op.transportista || null, patente: op.patente || null, vehiculo: op.vehiculo || null, destino: oc.direccion || null } : null,
    forma_pago: tipo === "factura" ? (texto(b.forma_pago, 30) || "crédito 30 días") : null, origen: "erp", faltan, t: ahora() };
}
// importar XML del DTE emitido (SII): folio, fecha, RUT emisor/receptor, totales y referencias (801 = OC, 52 = guía)
function parseDTE(xml) {
  const g = (tag, from = xml) => { const m = from.match(new RegExp("<" + tag + ">([^<]*)</" + tag + ">")); return m ? m[1].trim() : null; };
  const tipoDTE = g("TipoDTE"), tipo = tipoDTE === "52" ? "guia" : ["33", "34"].includes(tipoDTE) ? "factura" : null; if (!tipo) return null;
  const refs = [...xml.matchAll(/<Referencia>([\s\S]*?)<\/Referencia>/g)].map((m) => { const r = m[1]; const tp = g("TpoDocRef", r); return { tipo: tp === "801" ? "OC" : tp === "52" ? "GD" : tp === "33" ? "FA" : tp, folio: g("FolioRef", r), fecha: g("FchRef", r) }; });
  const det = [...xml.matchAll(/<Detalle>([\s\S]*?)<\/Detalle>/g)].map((m) => { const r = m[1]; return { d: g("NmbItem", r), q: Number(g("QtyItem", r)) || 1, unidad: g("UnmdItem", r) || "un", precio_unit: Math.round(Number(g("PrcItem", r)) || 0), total: Math.round(Number(g("MontoItem", r)) || 0) }; });
  return { tipo, tipoDTE, folio: g("Folio"), fecha: g("FchEmis"), emisor: { rut: rutLimpio(g("RUTEmisor")), razon_social: g("RznSoc") }, receptor: { rut: rutLimpio(g("RUTRecep")), razon_social: g("RznSocRecep"), direccion: g("DirRecep"), comuna: g("CmnaRecep"), giro: g("GiroRecep") },
    neto: Math.round(Number(g("MntNeto")) || 0), iva: Math.round(Number(g("IVA")) || 0), total: Math.round(Number(g("MntTotal")) || 0), referencias: refs, lineas: det, forma_pago: g("FmaPago"), motivo_traslado: g("IndTraslado") };
}
function docAgregar(op, doc) {   // un folio una sola vez (tipo + folio + RUT emisor); si existe, se actualiza sin duplicar
  op.documentos = op.documentos || [];
  const ya = doc.folio ? op.documentos.find((d) => d.tipo === doc.tipo && String(d.folio) === String(doc.folio) && (!d.emisor?.rut || !doc.emisor?.rut || rutLimpio(d.emisor.rut) === rutLimpio(doc.emisor.rut))) : null;
  if (ya) { Object.assign(ya, { ...doc, id: ya.id, estado: ["firmada_receptor", "recepcion_conforme", "cobrada"].includes(ya.estado) ? ya.estado : doc.estado, archivo: doc.archivo || ya.archivo }); return { doc: ya, repetido: true }; }
  // un borrador del mismo tipo sin folio se reemplaza por el emitido
  op.documentos = op.documentos.filter((d) => !(d.tipo === doc.tipo && d.estado === "borrador" && doc.estado !== "borrador"));
  op.documentos.push(doc); return { doc, repetido: false };
}
function docSincronizar(t) {   // refleja los documentos en los campos que ya usan Facturas y reparto / Caja OC
  const op = t.op || {}; const D = op.documentos || [];
  const g = D.filter((d) => d.tipo === "guia" && d.estado !== "borrador").slice(-1)[0], f = D.filter((d) => d.tipo === "factura" && d.estado !== "borrador");
  if (g) { op.folio_guia = String(g.folio || ""); op.guia_hecha = true; }
  if (f.length) { op.folio_factura = String(f[f.length - 1].folio || ""); op.factura_hecha = true;
    op.facturas = f.map((d) => { const prev = (op.facturas || []).find((x) => String(x.folio) === String(d.folio)); return { folio: String(d.folio), monto: d.total, fecha: d.fecha, t: prev?.t || d.t || ahora(), doc_id: d.id }; }); }
}

// ---------- 🚚 TERRENO: quién está a cargo, qué debe hacer ahora y si el trabajo ya fue aceptado ----------
//  op.terreno {modo: ejecutor|despachador|transporte|proveedor, asignado {id,nombre,telefono,vehiculo,patente}, estado: invitado|aceptado|en_retiro|en_trayecto|entregado,
//   viaje {retiro,destino,carga,horario,tarifa,condiciones,publicado_t,invitados[]}, vivo {estado: preparando|en_vivo|terminada, plataforma, canal, url, video, t}, historial[]}
//  Toma única del viaje: blob viajes/<codigo>/tomado escrito con onlyIfNew → el primero gana, el servidor avisa al otro que ya se tomó.
const TERRENO_EST = ["invitado", "aceptado", "en_retiro", "en_trayecto", "entregado"];
function viajeDe(t) {
  const op = t.op || {}, oc = t.oc_compra || {};
  const carga = (oc.items || itemsOferta(t)).slice(0, 6).map((i) => `${i.cantidad ?? i.q ?? 1} × ${String(i.nombre || i.d || "").slice(0, 50)}`).join("; ");
  return { retiro: op.origen_flete || op.proveedor || "retiro por confirmar", destino: oc.direccion || op.informe?.direccion || "destino por confirmar", carga, horario: op.plazo_fecha ? "entrega " + op.plazo_fecha : "horario por confirmar",
    tarifa: op.costo_transporte || (op.km ? Math.round(op.km * 900) : null), condiciones: "Guía de despacho firmada por quien recibe (nombre, RUT, fecha) y foto de la entrega.", organismo: oc.organismo || t.organismo || "" };
}
async function notificarPersona(store, per, titulo, cuerpo, tag, url) {
  await avisarTexto(store, titulo, cuerpo, tag, url).catch(() => {});                     // push a los celulares enlazados
  if (per?.telefono && WA()) { try { await waEnviar(per.telefono, `${titulo}\n${cuerpo}\nVer trabajo: ${(process.env.URL || "https://cotizagil.netlify.app")}${url}`); return "whatsapp"; } catch {} }
  return "push";
}
async function terrenoAccion(store, t, b) {
  const op = t.op = t.op || { etapa: "ganada", historial: [] }; const T = op.terreno = op.terreno || { historial: [] }; const L = (await store.get("ejecutores/lista", { type: "json" })) || {};
  const per = b.persona_id ? L[b.persona_id] : null; const datos = b.persona && typeof b.persona === "object" ? b.persona : null;
  const quien = per ? { id: per.id, nombre: per.nombre, telefono: per.telefono || null, vehiculo: per.vehiculo?.nombre || null, patente: per.vehiculo?.patente || null, rol: per.rol || null } : datos ? { id: null, nombre: texto(datos.nombre, 60), telefono: texto(datos.telefono, 30), vehiculo: texto(datos.vehiculo, 40), patente: texto(datos.patente, 12) } : null;
  const nota = (estado, txt) => { T.historial = [...(T.historial || []), { t: ahora(), estado, txt: texto(txt, 160), por: texto(b.dispositivo, 60) }].slice(-30); if (estado) T.estado = estado; };
  const url = "/#terreno=" + t.codigo;
  switch (b.accion) {
    case "modo": T.modo = ["ejecutor", "despachador", "transporte", "proveedor"].includes(b.modo) ? b.modo : T.modo; if (T.modo === "proveedor") { T.asignado = { nombre: op.proveedor || "proveedor", telefono: op.proveedor_tel || null }; nota("aceptado", "lo hace el proveedor"); } break;
    case "asignar": if (!quien) return { error: "Elige a quién asignar." }; T.modo = b.modo || T.modo || "ejecutor"; T.asignado = quien; T.viaje = viajeDe(t); nota("aceptado", "asignado por la empresa: " + quien.nombre); break;
    case "invitar": { if (!quien) return { error: "Elige a quién invitar." }; T.modo = b.modo || T.modo || "despachador"; T.viaje = { ...viajeDe(t), invitados: [...new Set([...(T.viaje?.invitados || []), quien.id].filter(Boolean))] }; T.asignado = { ...quien, pendiente: true }; nota("invitado", "invitado: " + quien.nombre);
      const v = T.viaje; const canal = await notificarPersona(store, quien, "🚚 Trabajo para ti · OC " + (op.oc_codigo || t.codigo), `${v.carga.slice(0, 80)} · retiro ${v.retiro.slice(0, 40)} → ${v.destino.slice(0, 50)} · ${v.horario}${v.tarifa ? " · tarifa $" + v.tarifa.toLocaleString("es-CL") : ""}. Entra y acepta o rechaza.`, "terreno-" + t.codigo, url); T.viaje.canal = canal; break; }
    case "publicar": { T.modo = "transporte"; T.viaje = { ...viajeDe(t), publicado_t: ahora(), tarifa: b.tarifa != null ? Math.round(Number(b.tarifa) || 0) : viajeDe(t).tarifa, invitados: [] }; T.asignado = null; nota("invitado", "viaje publicado para transportistas");
      await store.setJSON("viajes/" + t.codigo, { codigo: t.codigo, oc: op.oc_codigo || null, ...T.viaje, t: ahora() });
      for (const p2 of Object.values(L).filter((x) => x.rol === "transportista" && x.disponible !== false)) await notificarPersona(store, p2, "🛻 Viaje disponible · " + (T.viaje.organismo || "").slice(0, 40), `${T.viaje.carga.slice(0, 70)} · ${T.viaje.retiro.slice(0, 35)} → ${T.viaje.destino.slice(0, 45)} · ${T.viaje.horario}${T.viaje.tarifa ? " · $" + T.viaje.tarifa.toLocaleString("es-CL") : ""}. El primero que acepta se lo lleva.`, "viaje-" + t.codigo, url);
      break; }
    case "tomar": { if (!quien) return { error: "Identifícate (perfil de ejecutor/transportista)." }; if (T.estado && T.estado !== "invitado") return { error: "Este trabajo ya fue tomado por " + (T.asignado?.nombre || "otra persona") + ".", ya_tomado: true, por: T.asignado?.nombre || null };
      if (T.viaje?.invitados?.length && !T.viaje.invitados.includes(quien.id) && !T.viaje.publicado_t) return { error: "Este trabajo fue invitado a otra persona." };
      const w = await store.setJSON("viajes/" + t.codigo + "/tomado", { por: quien, t: ahora() }, { onlyIfNew: true }).catch((e) => ({ modified: false, e }));   // toma única
      if (w && w.modified === false) { const g = await store.get("viajes/" + t.codigo + "/tomado", { type: "json" }).catch(() => null); if (!g || g.por?.id !== quien.id) return { error: "Ya se tomó: " + (g?.por?.nombre || "otra persona") + " aceptó primero.", ya_tomado: true, por: g?.por?.nombre || null }; }
      T.asignado = quien; nota("aceptado", "aceptó " + quien.nombre); await avisarTexto(store, "✅ " + quien.nombre + " tomó el trabajo", `OC ${op.oc_codigo || t.codigo} · ${(t.nombre || "").slice(0, 50)}`, "terreno-ok-" + t.codigo, "/#robot").catch(() => {}); break; }
    case "rechazar": nota("invitado", "rechazó " + (quien?.nombre || "")); if (T.asignado?.id === quien?.id) T.asignado = null; break;
    case "etapa": if (!TERRENO_EST.includes(b.estado)) return { error: "Estado inválido." }; nota(b.estado, b.txt || ""); if (b.estado === "en_trayecto" && !["despacho", "entrega", "cerrado"].includes(op.etapa)) { op.etapa = "despacho"; op.historial = [...(op.historial || []), { t: ahora(), etapa: "despacho", por: "terreno" }]; } if (b.estado === "entregado") op.despacho_ok = true; break;
    case "liberar": T.asignado = null; T.estado = null; try { await store.delete("viajes/" + t.codigo + "/tomado"); } catch {} nota(null, "liberado"); break;
    case "vivo-inicio": T.vivo = { estado: "preparando", plataforma: texto(b.plataforma, 20) || "twitch", canal: texto(b.canal, 60) || op.twitch_canal || null, t: ahora(), intentos: 0 }; break;
    case "vivo-verificar": { const V = T.vivo; if (!V) return { error: "No hay transmisión preparándose." }; V.intentos = (V.intentos || 0) + 1; let viva = false, detalle = "";
      if (V.plataforma === "twitch" && V.canal) { try { const r = await fetch("https://decapi.me/twitch/uptime/" + encodeURIComponent(V.canal), { signal: AbortSignal.timeout(6000) }); const txt = (await r.text()).trim(); detalle = txt.slice(0, 80); viva = r.ok && !/offline|not found|error/i.test(txt); } catch (e) { detalle = "sin respuesta de Twitch"; } }
      else if (V.plataforma === "manual") { viva = !!b.confirmar; detalle = viva ? "confirmado por el ejecutor" : "sin confirmación"; }
      if (viva) { V.estado = "en_vivo"; V.url = V.plataforma === "twitch" ? "https://www.twitch.tv/" + V.canal : texto(b.url, 300) || V.url || null; V.desde = ahora(); op.en_vivo = true; op.vivo_desde = ahora();
        await avisarTexto(store, "🔴 EN VIVO · " + (op.oc_codigo || t.codigo), `${T.asignado?.nombre || "El ejecutor"} está transmitiendo la entrega de ${(t.nombre || "").slice(0, 40)}. Ver: ${V.url || ""}`, "vivo-" + t.codigo, "/#terreno=" + t.codigo, true).catch(() => {}); }
      V.detalle = detalle; return { ok: true, viva, detalle, vivo: V }; }
    case "vivo-fin": { const V = T.vivo || {}; V.estado = "terminada"; V.hasta = ahora(); if (b.video) V.video = texto(b.video, 300); op.en_vivo = false; op.vivo_hasta = ahora(); if (b.video) op.video_prueba = texto(b.video, 300); T.vivo = V; break; }
    case "evidencia": { const V = T.vivo || { estado: "terminada" }; V.video = texto(b.video, 300) || V.video; V.evidencia_t = ahora(); T.vivo = V; if (V.video) op.video_prueba = V.video; break; }
    default: return { error: "Acción desconocida." };
  }
  await escribir(store, t); return { ok: true, terreno: T };
}

// 🧾 VERSIONES DE OFERTA: cada preparación crea un borrador con id propio (ventas, costo base y fuentes por ítem, con id de línea);
//    al enviar se congela lo que Mercado Público mostró (captura) y la OC se enlaza a esa versión, nunca al borrador que vino después.
const lineaId = (i, it) => texto(it?.lid || it?.id, 24) || ("L" + (i + 1));
function normFuentes(xs) {
  return (Array.isArray(xs) ? xs : []).slice(0, 8).map((f) => ({ proveedor: texto(f?.proveedor, 80), url: texto(f?.url, 300), producto: texto(f?.producto || f?.titulo, 160), sku: texto(f?.sku, 40),
    precio: Math.round(Number(f?.precio) || 0) || null, precio_es_neto: f?.precio_es_neto === true, t: texto(f?.t || f?.fecha, 30) || ahora() })).filter((f) => f.url || f.proveedor);
}
function normCostoBase(c) {
  if (!c || typeof c !== "object") return null;
  const metodo = ["proveedor_seleccionado", "estimacion_multiple", "estimacion_sin_fuente"].includes(c.metodo) ? c.metodo : (c.fuente_idx != null ? "proveedor_seleccionado" : "estimacion_sin_fuente");
  return { neto_unit: Math.round(Number(c.neto_unit) || 0) || null, metodo, fuente_idx: c.fuente_idx == null ? null : Number(c.fuente_idx), nota: texto(c.nota, 160) };
}
function nuevaVersion(t, origen, items, firma, extra = {}) {
  const v = { id: "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: ahora(), origen,
    items: (items || []).map((it, i) => ({ lid: lineaId(i, it), d: it.d, q: it.q, p: it.p, costo_base: it.costo_base || null, fuentes: it.fuentes || [] })),
    precios: firma?.precios || (items || []).map((it) => it.p), despacho: firma?.despacho || 0, total: firma?.total || t.total || null, ...extra };
  t.versiones = [...(t.versiones || []), v].slice(-10); t.version_actual = v.id;
  return v;
}
// comparar lo que quedó en Mercado Público (o un borrador) con los ítems de la OC: línea por línea (cantidad, precio neto), despacho y total.
//    Devuelve el motivo exacto de cada diferencia y qué dato falta cuando no se puede comparar.
const normTxt = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// ítems de la oferta en forma única {d,q,p}: el robot sube {d,q,p}; las cotizadas fuera de la app traen la forma de la OC {nombre, cantidad, precio_unit}
const itemsOferta = (t) => (t.items || []).map((i) => ({ ...i, d: i.d || i.nombre || i.descripcion || "", q: Number(i.q ?? i.cantidad) || 1, p: Number(i.p ?? i.precio_unit ?? i.precio) || 0 }));
const REGLA_COTEJO = 4;   // versión de la regla: un oc_match guardado con otra regla se recalcula al abrir el estudio
function cotejarOC(t) {
  const oc = t.oc_compra; if (!oc || !(oc.items || []).length) return { estado: "sin_datos", texto: "Oferta original por vincular", motivos: [], faltan: ["ítems de la OC (aún no llegan del portal)"], regla: REGLA_COTEJO, t: ahora() };
  const vers = t.versiones || [], env = t.envio, itOf = itemsOferta(t);
  // 📋 cotizada fuera de la app: los ítems se copiaron de la OC, no hay oferta propia que cotejar
  if (t.externa && !vers.length && !env && !(t.firma?.precios || []).length) return { estado: "externa", texto: "Cotizada fuera de la app: la OC es la única fuente de montos (no hay oferta propia que cotejar)", comparado: "ítems copiados de la OC", motivos: [], faltan: ["oferta presentada (se cotizó fuera de la app)"], notas: [], regla: REGLA_COTEJO, t: ahora() };
  // una línea de la OC se trata como cargo de despacho SOLO si parece despacho/flete/transporte Y la oferta no vendió esa línea
  //   (por nombre; o por conteo: si la oferta tiene tantas líneas como la OC, no hay cargo aparte)
  const nombresOf = new Set([...itOf, ...vers.flatMap((v) => v.items || [])].map((i) => normTxt(i.d)).filter(Boolean));
  const nPrecios = (env?.captura?.precios || vers[vers.length - 1]?.precios || t.firma?.precios || itOf.map((i) => i.p)).filter((x) => x != null).length;
  const vendidaNombre = (x) => { const n = normTxt(x.nombre || x.especificacion); return !!n && [...nombresOf].some((d) => d === n || d.includes(n.slice(0, 25)) || n.includes(d.slice(0, 25))); };
  const pareceDesp = (x) => /despacho|flete|transporte/i.test(String(x.nombre || x.especificacion || ""));
  const mismoLargo = nPrecios && nPrecios === (oc.items || []).length;
  const esDesp = (x) => pareceDesp(x) && !vendidaNombre(x) && !mismoLargo;
  const oi = (oc.items || []).filter((x) => !esDesp(x)), ocDesp = (oc.items || []).filter(esDesp).reduce((s2, x) => s2 + (Number(x.total) || Number(x.precio) || 0), 0);
  const dudosas = (oc.items || []).filter((x) => pareceDesp(x) && !esDesp(x)).map((x) => `«${String(x.nombre || "").slice(0, 50)}» se contó como ítem vendido (${vendidaNombre(x) ? "la oferta tiene esa línea" : "la oferta tiene tantas líneas como la OC"}), no como cargo de despacho`);
  const prueba = (precios, items, despacho, total, nombre, vid) => {
    const motivos = [], faltan = []; const pr = Array.isArray(precios) && precios.length ? precios : null;
    if (!pr) faltan.push("precios por ítem de la oferta (" + nombre + ")");
    if (!oc.total) faltan.push("total de la OC");
    if (pr) {
      // emparejar por posición; si el largo difiere, por nombre
      const usados = new Set();
      oi.forEach((x, i) => {
        let j = pr.length === oi.length ? i : -1;
        if (j < 0) {   // largos distintos: 1) misma posición si calzan precio y cantidad · 2) por nombre · 3) por precio único
          const calza = (k) => k >= 0 && k < pr.length && !usados.has(k) && Math.abs((Number(x.precio) || 0) - (Number(pr[k]) || 0)) <= 1 && (!Number(items?.[k]?.q) || !Number(x.cantidad) || Number(items[k].q) === Number(x.cantidad));
          if (calza(i)) j = i;
          else { const n = normTxt(x.nombre || x.especificacion); j = (items || []).findIndex((it, k) => !usados.has(k) && n && (normTxt(it.d) === n || normTxt(it.d).includes(n.slice(0, 25)) || n.includes(normTxt(it.d).slice(0, 25))));
            if (j < 0) { const cands = pr.map((_, k) => k).filter(calza); if (cands.length === 1) j = cands[0]; } } }
        if (j < 0 || pr[j] == null) { motivos.push(`línea ${i + 1} «${String(x.nombre || "").slice(0, 30)}»: sin identificar en la oferta`); return; }
        usados.add(j);
        const p = Number(pr[j]) || 0, po = Number(x.precio) || 0, q = Number(items?.[j]?.q), qo = Number(x.cantidad);
        if (Math.abs(po - p) > 1) motivos.push(`línea ${i + 1}: precio OC $${po.toLocaleString("es-CL")} vs oferta $${p.toLocaleString("es-CL")}`);
        if (q && qo && q !== qo) motivos.push(`línea ${i + 1}: cantidad OC ${qo} vs oferta ${q}`);
      });
      if (pr.length > oi.length) motivos.push(`la oferta tiene ${pr.length - oi.length} línea(s) que la OC no trae`);
    }
    const dOf = Number(despacho) || 0; if (dOf || ocDesp) { if (Math.abs(dOf - ocDesp) > 1) motivos.push(`despacho OC $${ocDesp.toLocaleString("es-CL")} vs oferta $${dOf.toLocaleString("es-CL")}`); }
    if (oc.total && total) { const d = Math.abs(Number(oc.total) - Number(total)); if (d > 2) motivos.push(`total OC $${Number(oc.total).toLocaleString("es-CL")} vs oferta $${Number(total).toLocaleString("es-CL")} (dif. $${d.toLocaleString("es-CL")})`); }
    else if (oc.total && !total) faltan.push("total de la oferta (" + nombre + ")");
    return { nombre, vid, ok: !!pr && !motivos.length && !faltan.length, motivos: motivos.slice(0, 8), faltan };
  };
  const intentos = [];
  if (env?.captura?.precios?.length) intentos.push(prueba(env.captura.precios, (vers.find((v) => v.id === env.version_id) || {}).items || t.items, env.captura.despacho, env.captura.total, "envío capturado", env.version_id));
  for (const v of [...vers].reverse()) intentos.push(prueba(v.precios, v.items, v.despacho, v.total, v.id === env?.version_id ? "versión enviada" : "borrador " + v.id, v.id));
  if (!intentos.length) intentos.push(prueba(t.firma?.precios || itOf.map((i) => i.p), itOf, t.firma?.despacho || 0, t.total, "oferta preparada (sin versión)", null));
  const gana = intentos.find((x) => x.ok), base = intentos[0];
  if (gana) return { estado: gana.nombre === "envío capturado" || gana.nombre === "versión enviada" ? "coincide_envio" : "coincide_borrador", version_id: gana.vid, texto: gana.nombre === "envío capturado" ? "Montos coinciden con el envío capturado en Mercado Público" : "Montos coinciden con la OC" + (gana.nombre.startsWith("borrador") ? " (borrador guardado)" : gana.nombre.startsWith("oferta") ? " (oferta preparada)" : ""), comparado: gana.nombre, motivos: [], faltan: [], notas: dudosas, regla: REGLA_COTEJO, t: ahora() };
  // sin calce total: ¿coinciden los precios aunque falte algo? → «montos por verificar» en vez de «por vincular»
  const soloFalta = base && !base.motivos.length && base.faltan.length;
  return { estado: soloFalta ? "montos_por_verificar" : "por_vincular", version_id: env?.version_id || t.version_actual || null, texto: soloFalta ? "Montos coinciden · falta " + base.faltan.join(", ") : "Oferta original por vincular", comparado: base?.nombre || null, motivos: base?.motivos || [], faltan: base?.faltan || [], notas: dudosas, regla: REGLA_COTEJO, t: ahora() };
}

// 🧊 congela el envío confirmado por Mercado Público: captura (precios/despacho/total en pantalla) + intento + versión preparada.
//    La misma confirmación dos veces (mismo intento) = un solo envío. Sin captura → «Envío confirmado · montos por verificar».
function congelarEnvio(previo, b) {
  const cap = b.captura && typeof b.captura === "object" ? b.captura : null; const intento = texto(b.intento, 40) || null;
  if (previo.envio && intento && previo.envio.intento === intento) return previo.envio;
  const capN = cap && Array.isArray(cap.precios) && cap.precios.length ? { precios: cap.precios.slice(0, 60).map((v) => Math.max(0, Math.round(Number(v) || 0))), cantidades: (cap.cantidades || []).slice(0, 60).map((v) => Number(v) || null),
    despacho: Math.max(0, Math.round(Number(cap.despacho) || 0)), total: Math.round(Number(cap.total) || 0) || null, neto: Math.round(Number(cap.neto) || 0) || null, t: ahora() } : null;
  previo.envio = { t: ahora(), intento, version_id: previo.version_actual || null, captura: capN, montos_verificados: !!capN, dispositivo: texto(b.dispositivo, 60) || null };
  if (previo.versiones?.length) { const v = previo.versiones.find((x) => x.id === previo.version_actual); if (v) { v.enviada = true; if (capN) v.precios_enviados = capN.precios; } }
  previo.envios_hist = [...(previo.envios_hist || []), { t: previo.envio.t, intento, version_id: previo.envio.version_id, verificado: !!capN }].slice(-10);
  return previo.envio;
}

async function enlazarOC(store, o) {
  const cod = o.cot || o.codigo;
  const t = (await leer(store, cod)) || null;
  const nuevo = !t;
  const x = t || { codigo: cod, accion: "externa", externa: true, creado: ahora(), estado: "confirmada", historial: [],
    mensaje: "Cotizada fuera de la app · llegó la orden de compra", pdf: false, envios: 1 };
  if (nuevo || x.externa) {
    x.nombre = o.nombre; x.organismo = o.organismo; x.total = o.total; x.neto = o.neto; x.monto = o.total;
    x.items = o.items.map((i) => ({ nombre: i.nombre, descripcion: i.especificacion, cantidad: i.cantidad, precio_unit: i.precio, total: i.total }));
  }
  x.oc_compra = o;               // la OC completa: ítems, precios, contacto y dirección
  const op = x.op && x.op.etapa !== "previa" ? x.op : { ...(x.op || {}), etapa: "ganada", historial: [...((x.op || {}).historial || []), { t: ahora(), etapa: "ganada" }] };
  const llego = !op.oc_codigo && !(t && t.op && t.op.oc);          // aviso solo si es la primera noticia de esta OC
  op.oc = op.oc || o.codigo; op.oc_codigo = o.codigo; op.oc_estado = o.estado;
  if (!op.pedido_informe && !op.informe) op.pedido_informe = { t: ahora() };
  if (!op.concrecion) op.concretar_pendiente = true;   // 🎯 al llegar la OC: plan de concreción (links, teléfonos, precios, guion) para el ejecutador
  x.op = op;
  try { const m = cotejarOC(x); if (m) op.oc_match = m; } catch {}
  await escribir(store, x);
  if (llego) await avisarTexto(store, "📦 ¡Orden de compra! " + o.codigo,
    `${(o.organismo || "").slice(0, 50)} · $${Math.round(o.total || 0).toLocaleString("es-CL")} · ${(o.nombre || "").slice(0, 60)}. Abre Negocios: el robot ya busca proveedores y calcula la utilidad.`,
    "oc-" + o.codigo, "/#robot", true).catch(() => {});
}

export default async (req) => {
  const origen = req.headers.get("origin") || "";
  const mp = ORIGENES_MP.has(origen);
  const cors = { "access-control-allow-origin": origen, "access-control-allow-headers": "x-robot-token, content-type",
                 "access-control-allow-methods": "GET, POST", "access-control-max-age": "600", vary: "origin" };
  if (req.method === "OPTIONS") return new Response(null, { status: mp ? 204 : 403, headers: mp ? cors : {} });
  const res = await atender(req);
  if (mp) for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
};

// 📲 WhatsApp Business → aquí llegan las respuestas de los proveedores (Meta firma cada aviso con el secreto de la app)
async function waWebhook(req) {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = process.env.WA_VERIFY && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === process.env.WA_VERIFY;
    return new Response(ok ? url.searchParams.get("hub.challenge") || "" : "no", { status: ok ? 200 : 403 });
  }
  if (req.method !== "POST" || !WA()) return new Response("no", { status: 404 });
  const crudo = await req.text();
  const sec = process.env.WA_APP_SECRET || "";
  const firma = req.headers.get("x-hub-signature-256") || "";
  if (sec.length < 8) return new Response("falta WA_APP_SECRET", { status: 403 });
  const esp = "sha256=" + createHmac("sha256", sec).update(crudo).digest("hex");
  if (firma.length !== esp.length || !timingSafeEqual(Buffer.from(firma), Buffer.from(esp))) return new Response("firma", { status: 403 });
  let j = {}; try { j = JSON.parse(crudo); } catch {}
  const store = getStore({ name: STORE, consistency: "strong" });
  const mapa = (await store.get("chat/tel", { type: "json" })) || {};
  for (const e of j.entry || []) for (const ch of e.changes || []) for (const m of ch.value?.messages || []) {
    const de = waTel(m.from), dest = mapa[de];
    if (!dest) continue;                                 // solo números a los que les escribimos por una compra
    const txt = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || (m.type ? "[" + m.type + "]" : "");
    const t = await leer(store, dest.codigo); if (!t) continue;
    const op = t.op || (t.op = { etapa: "previa", historial: [] }), c = chatDe(op, dest.k);
    if ((c.msgs || []).some((x) => x.wid === m.id)) continue;
    c.msgs = [...(c.msgs || []), { de: "el", txt: texto(txt, 3000), t: ahora(), wid: texto(m.id, 120) }].slice(-40);
    c.ult_entrante = ahora(); c.pendiente = true; c.sugerido = null;
    await escribir(store, t); await chatEncolar(store, t.codigo, dest.k);
  }
  return new Response("ok");
}

// ☁️ un servidor nuevo pide conectarse SIN conocer el código: el dueño lo aprueba con un toque en la app
async function nubePedir(req) {
  const store = getStore({ name: STORE, consistency: "strong" });
  const url = new URL(req.url);
  const L = ((await store.get("nube/solicitudes", { type: "json" })) || []).filter((x) => Date.now() - Date.parse(x.t) < 3 * 3600_000);
  if (req.method === "POST") {
    if (L.filter((x) => x.estado === "pendiente").length >= 5) return json({ error: "Demasiadas solicitudes pendientes." }, 429);
    const sol = { id: randomBytes(18).toString("base64url"), t: ahora(), estado: "pendiente",
      ip: (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 60),
      nombre: texto(url.searchParams.get("nombre"), 60) };
    L.push(sol); await store.setJSON("nube/solicitudes", L);
    await avisarTexto(store, "☁️ Un servidor pide conectarse", `IP ${sol.ip}. Si es el tuyo (DigitalOcean), apruébalo en 💎 Planes → Robot en la nube.`, "nube-pedir", "/#robot").catch(() => {});
    return json({ id: sol.id, ip: sol.ip });
  }
  const sol = L.find((x) => x.id === url.searchParams.get("id"));
  if (!sol) return json({ estado: "no_existe" }, 404);
  if (sol.estado === "aprobado") {
    sol.estado = "entregado"; sol.entregado = ahora(); await store.setJSON("nube/solicitudes", L);
    return json({ estado: "aprobado", token: process.env.ROBOT_TOKEN || "" });
  }
  return json({ estado: sol.estado });
}

// ---------- 💳 WebPay Plus (Transbank) ----------
const WP_ENV = process.env.WEBPAY_ENV || "integracion";                               // "produccion" cuando PJANIC tenga su cuenta real
const WP_BASE = WP_ENV === "produccion" ? "https://webpay3g.transbank.cl" : "https://webpay3gint.transbank.cl";
const WP_CC = process.env.WEBPAY_CC || "597055555532";                                // producción: commerce code de PJANIC (variable de entorno WEBPAY_CC)
const WP_KEY = process.env.WEBPAY_KEY || "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C";  // prod: WEBPAY_KEY
const WP_HEAD = () => ({ "Tbk-Api-Key-Id": WP_CC, "Tbk-Api-Key-Secret": WP_KEY, "Content-Type": "application/json" });
const WP_SITIO = process.env.URL || "https://cotizagil.netlify.app";

async function webpayRetorno(req) {                                                   // ← lo llama Transbank (sin token), por eso va antes del autorizado
  const u = new URL(req.url);
  let token = u.searchParams.get("token_ws");
  if (req.method === "POST") { try { const fd = await req.formData(); token = token || fd.get("token_ws") || fd.get("TBK_TOKEN"); } catch {} }
  const volver = (q) => new Response(null, { status: 302, headers: { location: `${WP_SITIO}/?webpay=${q}#robot` } });
  if (!token) return volver("cancelado");
  const store = getStore({ name: STORE, consistency: "strong" });
  try {
    const r = await fetch(`${WP_BASE}/rswebpaytransaction/api/webpay/v1.2/transactions/${encodeURIComponent(token)}`, { method: "PUT", headers: WP_HEAD() });
    const j = await r.json().catch(() => ({}));
    const ok = j.response_code === 0 && j.status === "AUTHORIZED";
    const reg = j.buy_order ? (await store.get(`wp/${j.buy_order}`, { type: "json" })) : null;
    if (ok && reg && reg.inv_id) {                                             // 💼 versión nueva: el abono va al libro del inversionista (un solo efecto por orden)
      const r2 = await abonoWebpay(store, reg, j);
      if (r2.error) { reg.estado = "por_conciliar"; reg.motivo = r2.error; reg.t_pago = ahora(); await store.setJSON(`wp/${reg.orden}`, reg); return volver("revision"); }
      if (reg.estado !== "pagada") { reg.estado = "pagada"; reg.t_pago = ahora(); reg.mov_id = r2.mov.id; await store.setJSON(`wp/${reg.orden}`, reg); }
      return volver("ok");
    }
    if (ok && reg && reg.estado !== "pagada") {                                // versión anterior (orden sin inversionista): crédito local pendiente de conciliar
      reg.estado = "pagada"; reg.t_pago = ahora(); await store.setJSON(`wp/${reg.orden}`, reg);
      const key = `wpcredito/${reg.jug}`, cr = (await store.get(key, { type: "json" })) || { total: 0, items: [] };
      cr.total = (cr.total || 0) + reg.monto; cr.items = [...(cr.items || []), { monto: reg.monto, orden: reg.orden, t: ahora() }].slice(-20);
      await store.setJSON(key, cr);
      return volver("ok");
    }
    return volver(ok ? "ok" : "rechazado");
  } catch { return volver("error"); }
}

// ---------- 💼 DÓNDE ESTÁ MI PLATA: libro de movimientos del inversionista (fuente única del saldo) ----------
//  Identidad: inv/<id> {id, nombre, clave_hash, empresas[]}. El celular manda x-inv-id + x-inv-clave en cada consulta; el token del
//  robot NO basta para acreditar a un inversionista. Libro: inv/<id>/mov {v, movs[]} con movimientos en pesos enteros:
//   {id, tipo: abono|asignacion|devolucion|retiro|ajuste, monto, estado: pendiente|confirmado|rechazado|por_conciliar, t, ref, empresa, oc, nota}
//  Cada ref (orden Webpay, id de solicitud, id de devolución) tiene un solo efecto: repetir la confirmación no duplica.
//  Escritura condicional (etag) cuando la versión de Blobs la soporta; si no, candado de lectura-verificación (modo prueba).
const invHash = (clave) => createHmac("sha256", process.env.ROBOT_TOKEN || "sin-token").update("inv:" + String(clave || "")).digest("base64url");
const invId = () => "inv_" + randomBytes(9).toString("base64url");
async function invDe(req, store) {
  const id = texto(req.headers.get("x-inv-id"), 40), clave = req.headers.get("x-inv-clave") || "";
  if (!id || !clave) return null;
  const p = await store.get("inv/" + id, { type: "json" }).catch(() => null); if (!p || !p.clave_hash) return null;
  const a = Buffer.from(p.clave_hash), b = Buffer.from(invHash(clave)); if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return p;
}
async function leerLibro(store, id) {
  const r = await store.getWithMetadata("inv/" + id + "/mov", { type: "json" }).catch(() => null);
  return { libro: (r && r.data) || { v: 0, movs: [] }, etag: r && r.etag || null };
}
// escribe el libro una sola vez: con etag si Blobs lo soporta; si no, lectura-verificación con sello aleatorio
async function guardarLibro(store, id, libro, etag) {
  libro.v = (libro.v || 0) + 1; libro.sello = randomBytes(6).toString("base64url"); libro.t = ahora();
  const key = "inv/" + id + "/mov";
  let condicional = null;
  try { const r = await store.setJSON(key, libro, etag ? { onlyIfMatch: etag } : { onlyIfNew: true }); if (r && typeof r.modified === "boolean") condicional = r.modified; } catch (e) { if (/onlyIf|conditional|412|precondition/i.test(String(e.message || e))) condicional = false; else throw e; }
  if (condicional === false) return { ok: false, modo: "etag" };
  if (condicional === true) return { ok: true, modo: "etag" };
  const back = await store.get(key, { type: "json" }).catch(() => null);       // sin soporte condicional: verificar que quedó nuestro sello
  return { ok: !!back && back.sello === libro.sello && back.v === libro.v, modo: "verificacion" };
}
function resumenLibro(movs) {
  const ok = (m) => m.estado === "confirmado";
  const sum = (f) => movs.filter((m) => ok(m) && f(m)).reduce((s2, m) => s2 + (m.monto || 0), 0);
  const abonos = sum((m) => m.tipo === "abono"), asign = sum((m) => m.tipo === "asignacion"), devol = sum((m) => m.tipo === "devolucion"), retiros = sum((m) => m.tipo === "retiro"), ajustes = sum((m) => m.tipo === "ajuste");
  const porOC = {};
  for (const m of movs) { if (!m.oc) continue; const o = porOC[m.oc] = porOC[m.oc] || { oc: m.oc, empresa: m.empresa || null, aportado: 0, devuelto_capital: 0, devuelto_ganancia: 0, ganancia: m.ganancia || 0, pendientes: 0, ultimo: null };
    if (m.ganancia) o.ganancia = m.ganancia;
    if (ok(m)) { if (m.tipo === "asignacion") o.aportado += m.monto; if (m.tipo === "devolucion") { o.devuelto_capital += m.imputado_capital || 0; o.devuelto_ganancia += m.imputado_ganancia || 0; } if (!o.ultimo || m.t > o.ultimo.t) o.ultimo = { t: m.t, tipo: m.tipo, monto: m.monto }; }
    else if (m.estado === "pendiente") o.pendientes += m.monto; }
  for (const o of Object.values(porOC)) { o.capital_pendiente = Math.max(0, o.aportado - o.devuelto_capital); o.ganancia_pendiente = Math.max(0, (o.ganancia || 0) - o.devuelto_ganancia); o.por_recibir = o.capital_pendiente + o.ganancia_pendiente; }
  const comprometido = Object.values(porOC).reduce((s2, o) => s2 + o.capital_pendiente, 0);
  const pendRecibir = Object.values(porOC).reduce((s2, o) => s2 + o.por_recibir, 0);
  const devueltoTotal = devol;
  return { disponible: abonos + devol + ajustes - asign - retiros, comprometido, devuelto: devueltoTotal, por_recibir: pendRecibir, en_revision: movs.filter((m) => m.estado === "pendiente" && m.tipo === "abono").reduce((s2, m) => s2 + m.monto, 0),
    por_conciliar: movs.filter((m) => m.estado === "por_conciliar").reduce((s2, m) => s2 + m.monto, 0), porOC };
}
// agrega un movimiento con ref única; si la ref ya existe devuelve el existente (idempotente). Reintenta la escritura condicional hasta 3 veces.
async function movAgregar(store, id, mov) {
  const { validar, ...datos } = mov;           // la validación se repite en cada intento sobre el libro recién leído
  for (let k = 0; k < 3; k++) {
    const { libro, etag } = await leerLibro(store, id);
    const ya = datos.ref ? libro.movs.find((m) => m.ref === datos.ref && m.tipo === datos.tipo) : null;
    if (ya) return { mov: ya, repetido: true, libro };
    if (validar) { const err = validar(resumenLibro(libro.movs), libro); if (err) return { error: err }; }
    const nuevo = { id: "m" + Date.now().toString(36) + randomBytes(3).toString("base64url"), t: ahora(), ...datos };
    libro.movs = [...libro.movs, nuevo].slice(-500);
    const w = await guardarLibro(store, id, libro, etag);
    if (w.ok) return { mov: nuevo, repetido: false, libro, modo: w.modo };
  }
  return { error: "No pude registrar el movimiento (otra operación en curso). Intenta de nuevo." };
}
async function movActualizar(store, id, movId, cambios) {
  for (let k = 0; k < 3; k++) {
    const { libro, etag } = await leerLibro(store, id); const m = libro.movs.find((x) => x.id === movId); if (!m) return { error: "Movimiento no encontrado." };
    if (m.estado === "confirmado" && cambios.estado === "confirmado") return { mov: m, repetido: true, libro };
    Object.assign(m, cambios, { t_confirmado: cambios.estado === "confirmado" ? ahora() : m.t_confirmado });
    const w = await guardarLibro(store, id, libro, etag); if (w.ok) return { mov: m, libro };
  }
  return { error: "No pude actualizar el movimiento. Intenta de nuevo." };
}
// 💳 abono Webpay confirmado por Transbank: un solo efecto por orden (ref = buy_order); valida monto y sesión contra lo registrado
async function abonoWebpay(store, reg, j) {
  if (!reg || !reg.inv_id) return { error: "orden sin inversionista (versión anterior)" };
  if (Math.round(Number(j.amount)) !== reg.monto || (j.session_id && j.session_id !== reg.session)) return { error: "la transacción no coincide con la orden registrada" };
  return movAgregar(store, reg.inv_id, { tipo: "abono", monto: reg.monto, estado: "confirmado", ref: reg.orden, origen: "webpay", nota: "Webpay " + (j.authorization_code || ""), empresa: reg.empresa || null });
}
function ocHabilitada(t) {
  const op = t?.op; if (!t || !op) return "La OC no existe.";
  if (["rechazada", "cerrado"].includes(op.etapa) || op.oc_aceptada === false) return "El negocio ya no admite inversión.";
  if (!(op.oc_codigo || op.oc) && op.etapa !== "previa" && op.etapa !== "ganada") return "El negocio no tiene orden de compra.";
  return null;
}

// 📋 Informes públicos para socias (GENSA): la página /informes/<id>.html lee y guarda respuestas Sí/No con una clave
// derivada del código de enlace (nadie puede adivinarla; el dueño la obtiene desde la app con informe-link).
const informeClave = (id) => createHmac("sha256", process.env.ROBOT_TOKEN || "sin-token").update("informe:" + id).digest("base64url").slice(0, 22);
async function informePublico(req) {
  const u = new URL(req.url), id = (u.searchParams.get("id") || "").replace(/[^\w-]/g, "").slice(0, 40), k = u.searchParams.get("k") || "";
  if (!id || !process.env.ROBOT_TOKEN || k.length !== 22 || !timingSafeEqual(Buffer.from(k), Buffer.from(informeClave(id)))) return json({ error: "Informe no disponible." }, 404);
  const store = getStore({ name: STORE, consistency: "strong" });
  const inf = (await store.get(`informes/${id}`, { type: "json" })) || { resp: {} };
  if (req.method === "POST") {
    const b = await req.json().catch(() => ({})), c = texto(b.codigo, 40)?.replace(/[^\w-]/g, "");
    if (!c) return json({ error: "Falta el código." }, 400);
    if (Object.keys(inf.resp || {}).length > 500) return json({ error: "Informe lleno." }, 429);
    inf.resp = inf.resp || {}; inf.resp[c] = { decision: ["si", "no", ""].includes(b.decision) ? b.decision : "", nota: texto(b.nota, 300) || "", por: texto(b.por, 60) || "", fecha: ahora() };
    inf.ultimo = ahora(); await store.setJSON(`informes/${id}`, inf);
    if (b.decision) avisarTexto(store, `📋 ${id.toUpperCase()} respondió ${b.decision === "si" ? "SÍ ✅" : "NO ✖"}`, `${c}${b.nota ? " · " + texto(b.nota, 120) : ""}${b.por ? " · " + texto(b.por, 40) : ""}`, "informe-" + id, "/#robot").catch(() => {});
    return json({ ok: true, resp: inf.resp });
  }
  return json({ resp: inf.resp || {}, ultimo: inf.ultimo || null });
}

// 📥 INGESTA SII (temporal, 13-11-2026): recibe facturas de compra leídas desde la sesión del SII en el navegador de Felipe.
//    Protegida por clave de un solo uso (SII_INGESTA_K); CORS abierto solo en esta ruta. Quitar cuando termine la carga.
const SII_INGESTA_K = "4a81bc9e0466a9e773f9235b04867ba3";
const corsH = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };

// 📷 FOTOS REALES de producto para las fichas: busca en Mercado Libre Chile (API pública), Bing Imágenes y DuckDuckGo
//    desde la nube (el PC a veces no puede). Devuelve candidatos ordenados: tiendas chilenas primero.
const FOTO_TIENDAS = ["mercadolibre", "mlstatic", "falabella", "paris.cl", "ripley", "sodimac", "easy.cl", "lider.cl", "pcfactory", "dimerc", "prisa", "casaideas", "homecenter", "construmart", "imperial.cl", "abcdin", "lapolar", "hites", "linio", "spdigital", "amazon", "walmart", "tenbox", "coleman"];
const FOTO_MALAS = ["logo", "icon", "sprite", "banner", "placeholder", "avatar", "favicon", "pinterest", "facebook", "instagram", "wikipedia", "youtube", ".svg", ".gif", "tiktok", "whatsapp", "flyer", "afiche", "freepik", "shutterstock", "istock", "dreamstime", "depositphotos", "alamy", "123rf", "vecteezy", "pngtree", "canva"];
const FOTO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function fotoML(q) {
  const r = await fetch("https://api.mercadolibre.com/sites/MLC/search?limit=12&q=" + encodeURIComponent(q), { headers: { "user-agent": FOTO_UA, accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error("ML " + r.status);
  const j = await r.json();
  return (j.results || []).filter((x) => x.thumbnail).map((x) => ({ url: String(x.thumbnail).replace(/-I\.(jpg|webp|png)$/i, "-O.$1").replace(/^http:/, "https:"), fuente: "mercadolibre.cl", titulo: x.title, precio: x.price, pagina: x.permalink, motor: "ml" }));
}
async function fotoBing(q) {
  const r = await fetch("https://www.bing.com/images/search?" + new URLSearchParams({ q, form: "HDRSC2", first: "1", cc: "CL", setlang: "es" }), { headers: { "user-agent": FOTO_UA, "accept-language": "es-CL,es;q=0.9" }, signal: AbortSignal.timeout(9000) });
  const h = await r.text(); const out = [];
  for (const m of h.matchAll(/murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;[\s\S]{0,600}?(?:&quot;t&quot;:&quot;([^&]{3,160})&quot;)?[\s\S]{0,400}?(?:purl&quot;:&quot;(https?:\/\/[^&]+?)&quot;)?/g)) { try { const u = decodeURIComponent(m[1]); out.push({ url: u, fuente: new URL(m[3] ? decodeURIComponent(m[3]) : u).hostname.replace(/^www\./, ""), titulo: m[2] ? decodeURIComponent(m[2]).replace(/&amp;/g, "&") : null, pagina: m[3] ? decodeURIComponent(m[3]) : null, motor: "bing" }); } catch {} }
  return out;
}
async function fotoDDG(q) {
  const h = await (await fetch("https://duckduckgo.com/?" + new URLSearchParams({ q, iax: "images", ia: "images" }), { headers: { "user-agent": FOTO_UA }, signal: AbortSignal.timeout(9000) })).text();
  const m = h.match(/vqd=([\d-]+)/) || h.match(/vqd="([\d-]+)"/) || h.match(/vqd=\\'([\d-]+)/); if (!m) return [];
  const r = await fetch("https://duckduckgo.com/i.js?" + new URLSearchParams({ l: "cl-es", o: "json", q, vqd: m[1], f: ",,,,,", p: "1" }), { headers: { "user-agent": FOTO_UA, referer: "https://duckduckgo.com/", accept: "application/json" }, signal: AbortSignal.timeout(9000) });
  const j = await r.json();
  return (j.results || []).filter((x) => x.image && (x.width || 0) >= 300 && (x.height || 0) >= 300).map((x) => ({ url: x.image, fuente: (() => { try { return new URL(x.url || x.image).hostname.replace(/^www\./, ""); } catch { return ""; } })(), titulo: x.title, pagina: x.url, motor: "ddg" }));
}
async function buscarFotos(q) {
  // consulta corta y limpia: sin viñetas ni frases largas de la ficha; las primeras 7 palabras útiles del producto
  q = String(q || "").replace(/\(c[oó]digo [^)]*\)|seg[uú]n (especificaci[oó]n|eett|ttr).*|o similar/gi, "").replace(/[•·|/\\]+/g, " ").split(/\s+/).filter((w) => w && !/^(de|del|la|el|los|las|con|para|por|en|un|una|y|o|alta|calidad|tipo|uso)$/i.test(w)).slice(0, 7).join(" ").trim().slice(0, 70);
  if (q.length < 4) return { q, fotos: [], errores: ["consulta corta"] };
  const errores = []; let out = [];
  const res = await Promise.allSettled([fotoBing(q), fotoDDG(q)]);
  for (const r of res) { if (r.status === "fulfilled") out.push(...r.value); else errores.push(String(r.reason?.message || r.reason).slice(0, 80)); }
  if (!out.length && q.split(" ").length > 3) { try { out.push(...(await fotoDDG(q.split(" ").slice(0, 3).join(" ")))); } catch (e) { errores.push("corta: " + String(e.message || e).slice(0, 60)); } }
  const vistas = new Set();
  out = out.filter((f) => { const lu = f.url.toLowerCase(); if (vistas.has(f.url) || FOTO_MALAS.some((m) => lu.includes(m))) return false; vistas.add(f.url); return true; });
  out.sort((a, b2) => (FOTO_TIENDAS.some((t) => (a.url + a.fuente).toLowerCase().includes(t)) ? 0 : 1) - (FOTO_TIENDAS.some((t) => (b2.url + b2.fuente).toLowerCase().includes(t)) ? 0 : 1));
  return { q, fotos: out.slice(0, 20), errores };
}

// 🎯 CONCRETAR: para una OC ganada, dice dónde comprar cada ítem DE VERDAD (link o proveedor), a qué precio y cuánto se gana.
//    1) candidatos reales por ítem (buscarFotos → páginas de tienda) 2) precio leído de la página 3) catálogo propio (a quién ya le compraste)
//    4) Claude elige y explica por qué calza con lo cotizado. Se guarda en t.op.concrecion. Nada inventado: solo links/proveedores que existen.
const TIENDA_RE = /mercadolibre\.cl|falabella\.com|sodimac\.cl|easy\.cl|lider\.cl|paris\.cl|ripley\.cl|pcfactory\.cl|dimerc\.cl|prisa\.cl|casaideas\.cl|construmart\.cl|imperial\.cl|abcdin\.cl|lapolar\.cl|hites\.com|spdigital\.cl|tenbox\.cl|amazon\.com/i;
// 🛒 Listado de Mercado Libre Chile (HTML público): título, precio, link y foto de los primeros resultados.
async function mlListado(q, soloLocal = true) {
  const slug = String(q || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const u = "https://listado.mercadolibre.cl/" + slug + (soloLocal ? "_Envio_Local" : "");
  const r = await fetch(u, { headers: { "user-agent": FOTO_UA, "accept-language": "es-CL,es;q=0.9", accept: "text/html,*/*" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("ML listado " + r.status);
  const h = await r.text(); const out = [];
  if (globalThis.__mlDebug) return { len: h.length, poly: (h.match(/poly-card/g) || []).length, title: (h.match(/<title>([^<]*)</) || [])[1], frac: (h.match(/andes-money-amount__fraction/g) || []).length, muestra: h.slice(0, 300), idx: h.indexOf("poly-component__title"), ctx: h.slice(Math.max(0, h.indexOf("poly-component__title") - 300), h.indexOf("poly-component__title") + 600) };
  const bloques = h.split(/<li class="ui-search-layout__item|<div class="poly-card poly-card--list|<div class="poly-card poly-card--grid/).slice(1);
  for (const b of bloques) {
    const tit = (b.match(/class="poly-component__title"[^>]*>([^<]{3,200})</) || b.match(/<h3[^>]*>\s*<a[^>]*>([^<]{3,200})</) || [])[1];
    const link = (b.match(/class="poly-component__title"[^>]*href="([^"]+)"/) || b.match(/href="(https:\/\/(?:www|articulo)\.mercadolibre\.cl\/[^"]+)"/) || [])[1];
    const pr = (b.match(/poly-price__current[\s\S]{0,400}?andes-money-amount__fraction[^>]*>([\d.]+)</) || b.match(/andes-money-amount__fraction[^>]*>([\d.]+)</) || [])[1];
    const img = (b.match(/<img[^>]+(?:data-src|src)="(https:\/\/http2\.mlstatic\.com[^"]+)"/) || [])[1];
    const ad = /mclics\/clicks/.test(link || "");
    if (tit && link && pr) out.push({ titulo: tit.replace(/&amp;/g, "&").trim(), url: link.split("#")[0].split("?")[0], precio_iva: Number(pr.replace(/\./g, "")), foto: img || null, fuente: "mercadolibre.cl", ad });
    if (out.length >= 12) break;
  }
  return out;
}

// 🔎 Búsqueda web (DuckDuckGo HTML): título, link y resumen; sirve para leer precios "$ 44.991" de tiendas en el resumen.
async function webBuscar(q, n = 12) {
  const r = await fetch("https://html.duckduckgo.com/html/?" + new URLSearchParams({ q, kl: "cl-es" }), { headers: { "user-agent": FOTO_UA, "accept-language": "es-CL,es;q=0.9" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("DDG html " + r.status);
  const h = await r.text(); const out = [];
  const des = (t) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  for (const m of h.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)) {
    let u = m[1]; const mu = u.match(/uddg=([^&]+)/); if (mu) u = decodeURIComponent(mu[1]);
    const sn = des(m[3]); const pm = sn.match(/\$\s?([\d.]{4,11})(?!\d)/);
    out.push({ titulo: des(m[2]).slice(0, 140), url: u, resumen: sn.slice(0, 260), precio_iva: pm ? Number(pm[1].replace(/\./g, "")) : null, fuente: (() => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } })() });
    if (out.length >= n) break;
  }
  return out;
}

async function precioPagina(url) {
  // Lee UNA página de tienda y devuelve sus productos con precio (con IVA) y stock. Tiendas Shopify (muchas pymes chilenas:
  // tubotiquin, ecompany, ivmedical…) exponen /products.json; el resto se lee por JSON-LD / meta / regex.
  const H = { "user-agent": FOTO_UA, "accept-language": "es-CL,es;q=0.9", accept: "text/html,application/json,*/*" };
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const prods = [];
  try {
    const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(7000), redirect: "follow" });
    if (!r.ok) return { estado: r.status, productos: [] };
    const h = (await r.text()).slice(0, 900000);
    const tit = ((h.match(/property="og:title" content="([^"]{3,160})"/) || h.match(/<title[^>]*>([^<]{3,160})</i) || [])[1] || "").replace(/\s*[|·–-]\s*(MercadoLibre|Falabella|Sodimac|Tienda Online).*$/i, "").trim();
    const esShopify = /cdn\.shopify\.com|Shopify\.theme|shopify-section/.test(h);
    const telm = h.match(/href="tel:([+\d\s()-]{8,20})"/) || h.match(/href="https:\/\/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)(56\d{9})/) || h.replace(/<[^>]+>/g, " ").match(/(\+?56\s?9\s?\d{4}\s?\d{4}|\+?56\s?2\s?\d{4}\s?\d{4}|\b9\s?\d{4}\s?\d{4}\b)/);
    const telefono = telm ? String(telm[1]).replace(/[^\d+]/g, "").replace(/^(\d{9})$/, "+56$1").replace(/^56/, "+56").slice(0, 16) : null;
    if (esShopify) {
      const u = new URL(url); const base = u.origin;
      const mp = u.pathname.match(/\/products\/([^/?#]+)/), mc = u.pathname.match(/\/collections\/([^/?#]+)/);
      const ju = mp ? `${base}/products/${mp[1]}.js` : `${base}${mc ? "/collections/" + mc[1] : ""}/products.json?limit=12`;
      try {
        const rj = await fetch(ju, { headers: H, signal: AbortSignal.timeout(6000) });
        if (rj.ok) {
          const j = await rj.json(); const L = mp ? [j] : (j.products || []);
          for (const pr of L.slice(0, 12)) {
            const v = (pr.variants || [])[0] || {}; const pre = mp ? Number(pr.price) / 100 : Number(v.price);
            if (!pr.title || !pre) continue;
            prods.push({ titulo: String(pr.title).slice(0, 140), url: mp ? url : `${base}/products/${pr.handle}`, precio_iva: Math.round(pre), disponible: mp ? pr.available !== false : v.available !== false, foto: mp ? (pr.featured_image || null) : (pr.images?.[0]?.src || null), fuente: host, telefono });
          }
        }
      } catch {}
      if (prods.length) return { estado: 200, productos: prods, tienda: "shopify" };
    }
    let precio = null;
    for (const m of h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
      try { const j = JSON.parse(m[1]); const L = Array.isArray(j) ? j : [j, ...(j["@graph"] || [])];
        for (const o of L) { if (/Product/.test(String(o?.["@type"]))) { const of = Array.isArray(o.offers) ? o.offers[0] : o.offers; const pr = Number(of?.price || of?.lowPrice); if (pr) { precio = Math.round(pr); break; } } } } catch {}
      if (precio) break;
    }
    if (!precio) { const m1 = h.match(/property="product:price:amount" content="([\d.]+)"/) || h.match(/itemprop="price"\s+content="([\d.]+)"/) || h.match(/"priceAmount"\s*:\s*(\d{3,8})/) || h.match(/andes-money-amount__fraction[^>]*>([\d.]{4,11})</); if (m1) precio = Math.round(Number(String(m1[1]).replace(/\.(?=\d{3}\b)/g, ""))); }
    if (precio && (precio < 500 || precio > 50000000)) precio = null;
    const sinStock = /sin stock|agotado|no disponible|publicaci[oó]n pausada|finalizada/i.test(h.slice(0, 200000)) && !/en stock|disponible|agregar al carro|comprar ahora/i.test(h.slice(0, 200000));
    if (tit && !/^Mercado Libre$/i.test(tit)) prods.push({ titulo: tit.slice(0, 140), url, precio_iva: precio, disponible: !sinStock, foto: (h.match(/property="og:image" content="([^"]+)"/) || [])[1] || null, fuente: host, telefono });
    return { estado: r.status, productos: prods };
  } catch (e) { return { error: String(e.message || e).slice(0, 60), productos: [] }; }
}
async function concretar(store, t, opts = {}) {
  // fase 1: candidatos (búsquedas, páginas, base de proveedores) → se guarda en t.op.concrecion_tmp
  // fase 2: Claude decide + negociación + pasos → t.op.concrecion. Separadas para no pasar el límite de tiempo de la nube.
  const fase = opts.fase || "ambas";
  const key = process.env.ANTHROPIC_API_KEY || "";
  const items = (Array.isArray(t.items) && t.items.length ? t.items : (t.oc_compra?.items || []).map((i) => ({ d: i.especificacion || i.nombre, q: i.cantidad, p: i.precio })))
    .filter((i) => i && i.d).slice(0, 8).map((i) => ({ d: String(i.d).slice(0, 160), q: Number(i.q) || 1, p: Number(i.p) || 0 }));
  if (!items.length) return { error: "La oferta no tiene ítems guardados." };
  const base = await baseProveedores(store).catch(() => ({ lista: [] }));
  const catal = base.lista.filter((x) => x.util !== false);
  const kw = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !["para", "con", "segun", "tipo", "unidad", "requiere"].includes(w));
  // 1) candidatos por ítem, en paralelo: búsqueda web (tiendas chilenas) + páginas de las fotos; cada página se lee y puede traer varios productos
  const porItem = (fase === "2" && t.op?.concrecion_tmp?.porItem?.length) ? t.op.concrecion_tmp.porItem : await Promise.all(items.map(async (it) => {
    const q = it.d.replace(/\(c[oó]digo [^)]*\)|seg[uú]n (especificaci[oó]n|eett|ttr).*|o similar/gi, "").replace(/\b(Biotecmed|C[oó]rcega|CD-C\d+|CIP\s?\d+L?|BC\d+L|ADC)\b/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
    const [w1, f1, m1] = await Promise.allSettled([webBuscar(q + " precio chile", 10), buscarFotos(q), mlBuscar(store, q, 8)]);
    const deML = m1.status === "fulfilled" ? (m1.value.fotos || []).filter((x) => x.local !== false) : [];
    let pags = [];
    if (w1.status === "fulfilled") pags.push(...w1.value.map((x) => x.url));
    if (f1.status === "fulfilled") pags.push(...f1.value.fotos.map((f) => f.pagina).filter(Boolean));
    pags = pags.map((u) => String(u).split("#")[0]).filter((u) => /^https?:\/\//.test(u) && !/duckduckgo|amazon\.|aliexpress|alibaba|\.es\/|\.ar\/|\.pe\/|\.mx\/|\.co\/|wikipedia|youtube|facebook|instagram|pinterest/i.test(u));
    const vistas = new Set(); pags = pags.filter((u) => !vistas.has(u) && vistas.add(u)).slice(0, 7);
    const leidas = await Promise.all(pags.map((u) => precioPagina(u)));
    let cands = [...deML, ...leidas.flatMap((x) => x.productos || [])];
    const vu = new Set(); cands = cands.filter((c) => c.titulo && !vu.has(c.url) && vu.add(c.url));
    cands.sort((a, b2) => (a.precio_iva ? 0 : 1) - (b2.precio_iva ? 0 : 1));
    cands = cands.slice(0, 14);
    const ks = kw(it.d);
    const propios = catal.map((c) => { const n = kw(c.nombre).filter((w) => ks.includes(w)).length + 2 * kw([c.rubro, ...(c.tipicos || [])].join(" ")).filter((w) => ks.includes(w)).length + 2 * kw(c.productos.map((q) => q.producto).join(" ")).filter((w) => ks.includes(w)).length; return { c, n }; })
      .filter((x) => x.n >= 2).sort((a, b2) => b2.n - a.n || b2.c.total - a.c.total).slice(0, 4)
      .map((x) => ({ proveedor: x.c.nombre, rut: x.c.rut, empresas: x.c.empresas, rubro: x.c.rubro, tipicos: (x.c.tipicos || []).slice(0, 4), compras: x.c.productos.filter((q) => kw(q.producto).some((w) => ks.includes(w))).slice(0, 3).map((q) => ({ producto: q.producto, precio_unit_neto: q.precio_unit || null, empresa: q.empresa, fecha: q.fecha })), facturas: x.c.facturas, telefono: x.c.telefono || null, web: x.c.web || null }));
    // 📞 contacto del proveedor propio mejor rankeado: lo busca en la web (sitio + teléfono) y lo deja guardado
    if (propios[0] && !propios[0].telefono) { try { const w = (await webBuscar(propios[0].proveedor + " chile", 4)).filter((r) => !/duckduckgo|linkedin|facebook|instagram|sii\.cl|mercadopublico|dicom|boletin/i.test(r.url))[0];
      if (w) { const pg = await precioPagina(w.url); const tel = (pg.productos || [])[0]?.telefono || null; propios[0].web = w.url; propios[0].telefono = tel; const R2 = (await store.get("proveedores/_rubros", { type: "json" }).catch(() => null)) || {}; R2[propios[0].rut] = { ...(R2[propios[0].rut] || {}), web: w.url, telefono: tel }; await store.setJSON("proveedores/_rubros", R2); } } catch {} }
    return { item: it, q, candidatos: cands.map((c) => ({ titulo: c.titulo, url: c.url, foto: c.foto, fuente: c.fuente, precio_iva: c.precio_iva || null, sin_stock: c.disponible === false, telefono: c.telefono || null })), propios };
  }));
  if (fase === "1") { t.op = t.op || { etapa: "ganada", historial: [] }; t.op.concrecion_tmp = { t: ahora(), porItem }; await store.setJSON("trabajo/" + t.codigo, t); return { ok: true, fase: 1, items: porItem.length }; }
  // 2) Claude decide — por ÍTEM, uno por llamada (fase "2": siguiente ítem pendiente), para caber en el tiempo de la nube.
  //    Cada decisión se guarda en t.op.concrecion_tmp.plan[i]; cuando están todos, un último paso (fase "3") escribe pasos + resumen.
  let plan = null, aviso = null;
  const tmp = t.op?.concrecion_tmp || {}; tmp.plan = tmp.plan || {};
  const cabecera = `Eres el jefe de compras de ${t.empresa_nombre || "PJANIC SpA"} (proveedor del Estado de Chile). Ganamos la compra ágil ${t.codigo} (${t.nombre || ""}) del organismo ${t.oc_compra?.organismo || t.organismo || ""}; OC ${t.op?.oc_codigo || ""}. Entrega: ${t.oc_compra?.direccion || t.op?.informe?.direccion || "(ver OC)"}.`;
  const reglas = `REGLAS: (1) usa SOLO links y proveedores de la lista; jamás inventes tiendas, teléfonos ni precios: si un candidato no trae precio, pon precio_unit_iva null y dilo; (2) el producto elegido debe cumplir lo cotizado (capacidad, medidas, uso médico/industrial si lo dice el texto); si ninguno calza, elegido null y explica qué buscar; (3) "porque": una frase de por qué calza con lo cotizado; (4) "riesgo": stock, plazo, envío internacional no sirve para entregar en días; (5) PROVEEDORES PROPIOS = empresas a las que el grupo (PJANIC, Julfior, Barasal) ya les compró según el SII: prefiérelos cuando calcen (tipo "proveedor", con su nombre y teléfono si viene). (6) "guion": 2–4 frases para llamar/escribir al proveedor elegido (tono chileno profesional: quién somos, qué compramos y cuánto, que es para una OC del Estado con pago seguro, pedir precio por volumen, plazo y despacho a la dirección), y 2–3 "argumentos" de negociación (volumen, pago contra OC pública, recompra, retiro propio, precio de la competencia con cifra si la hay).`;
  const esquema = `Responde SOLO JSON compacto (una línea, strings cortas sin comillas internas, máximo 2 alternativas): {"i":<índice>,"elegido":{"tipo":"link"|"proveedor","titulo":"","url":"","proveedor":"","telefono":"<solo si el candidato trae telefono>","precio_unit_iva":<número o null>,"porque":"<máx 160>"}|null,"alternativas":[{"titulo":"","url":"","precio_unit_iva":<número o null>}],"riesgo":"<máx 120>","buscar":"<máx 120>","guion":"<máx 380>","argumentos":["<máx 100>"]}`;
  const llamar = async (contenido, maxTok, ms) => { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: maxTok, messages: [{ role: "user", content: contenido }] }), signal: AbortSignal.timeout(ms) });
    const j = await r.json(); const txt = (j.content || []).map((c) => c.text || "").join(""); const m = txt.match(/\{[\s\S]*/); if (!m) throw new Error("sin JSON: " + txt.slice(0, 80));
    const raw = m[0]; try { return JSON.parse(raw); } catch {}
    // respuesta cortada: cerrar lo abierto
    for (const corte of [raw, raw.slice(0, raw.lastIndexOf("}") + 1), raw.slice(0, raw.lastIndexOf('",') + 1), raw.slice(0, raw.lastIndexOf('"') + 1)]) { if (!corte) continue;
      for (const cierre of ["", "}", "]}", '"]}', '"}]}', '"}}', "}]}", '"]}]}']) { try { return JSON.parse(corte.replace(/,\s*$/, "") + cierre); } catch {} } }
    throw new Error("JSON cortado: " + txt.slice(-60)); };
  if (key && fase !== "ambas") {
    const pend = porItem.map((x, i) => i).filter((i) => !tmp.plan[i]);
    if (fase === "2" && pend.length) {
      const i = pend[0], x = porItem[i];
      const mejor = x.candidatos.filter((c) => c.precio_iva && !c.sin_stock).sort((a, b2) => a.precio_iva - b2.precio_iva)[0]; const maxIva = Math.round(x.item.p * 0.8 * 1.19); const obj = Math.min(maxIva, Math.round((mejor?.precio_iva || maxIva) * 0.9));
      try { tmp.plan[i] = await llamar(`${cabecera}\n${reglas}\n${esquema}\n\nÍTEM ${i}: "${x.item.d}" · cantidad ${x.item.q} · venta unit. neto $${x.item.p} · precio_objetivo_iva $${obj} · precio_maximo_iva $${maxIva}\n  candidatos: ${JSON.stringify(x.candidatos.slice(0, 10))}\n  propios: ${JSON.stringify(x.propios)}`, 1500, 22000); }
      catch (e) { tmp.plan[i] = { i, elegido: null, error: String(e.message || e).slice(0, 100) }; }
      t.op = t.op || { etapa: "ganada", historial: [] }; t.op.concrecion_tmp = tmp; await store.setJSON("trabajo/" + t.codigo, t);
      return { ok: true, fase: 2, hecho: i, faltan: pend.length - 1 };
    }
    // fase "3" (o "2" sin pendientes): pasos + resumen con lo decidido
    const dec = porItem.map((x, i) => ({ i, item: x.item.d, cant: x.item.q, venta_neto_u: x.item.p, elegido: tmp.plan[i]?.elegido || null }));
    try { const g = await llamar(`${cabecera}\nYa decidimos dónde concretar cada ítem: ${JSON.stringify(dec)}.\nEscribe para el ejecutador: "pasos": lista ordenada de 4–7 pasos concretos desde ahora hasta entregar (a quién llamar primero y por qué, qué confirmar, cuándo comprar, cómo despachar, qué documento adjuntar), una frase cada uno; y "resumen": 2 frases (qué hacer primero y cuánto se gana si se consiguen los precios). Responde SOLO JSON compacto, pasos de máximo 140 caracteres: {"pasos":[""],"resumen":""}`, 1600, 20000);
      plan = { items: Object.values(tmp.plan), pasos: g.pasos || [], resumen: g.resumen || "" }; }
    catch (e) { plan = { items: Object.values(tmp.plan), pasos: [], resumen: "" }; aviso = "Pasos no disponibles: " + String(e.message || e).slice(0, 80); }
  } else if (key) {
    // modo "ambas" (compatibilidad): una sola llamada, sin guion largo
    try { const todo = await llamar(`${cabecera}\n${reglas}\nResponde SOLO JSON: {"items":[${esquema.split("): ")[1]}],"pasos":[""],"resumen":""}\n\n` + porItem.map((x, i) => `ÍTEM ${i}: "${x.item.d}" · cantidad ${x.item.q} · venta unit. neto $${x.item.p}\n  candidatos: ${JSON.stringify(x.candidatos.slice(0, 6))}\n  propios: ${JSON.stringify(x.propios)}`).join("\n\n"), 3000, 22000); plan = todo; }
    catch (e) { aviso = "Claude no respondió: " + String(e.message || e).slice(0, 80); }
  } else aviso = "Falta ANTHROPIC_API_KEY en Netlify: muestro solo los candidatos encontrados.";
  // 3) armar el plan final con números
  const filas = porItem.map((x, i) => {
    const pj = (plan?.items || []).find((y) => Number(y.i) === i) || {};
    let el = pj.elegido || null;
    if (!el && x.candidatos.length) { const c = x.candidatos.filter((c) => c.precio_iva && !c.sin_stock).sort((a, b2) => a.precio_iva - b2.precio_iva)[0]; if (c) el = { tipo: "link", titulo: c.titulo, url: c.url, precio_unit_iva: c.precio_iva, porque: "El más barato con precio leído de la tienda (sin revisión de Claude)." }; }
    if (el && el.url && !x.candidatos.some((c) => c.url === el.url) && !/^https?:\/\//.test(el.url)) el.url = null;
    if (el) { const cand = x.candidatos.find((c) => c.url === el.url); el.telefono = cand?.telefono || (x.candidatos.some((c) => c.telefono === el.telefono) ? el.telefono : null); el.fuente = el.fuente || cand?.fuente || null; }
    const costoU = el?.precio_unit_iva ? Math.round(el.precio_unit_iva / 1.19) : null;
    const ventaU = x.item.p, q = x.item.q;
    const mejor = x.candidatos.filter((c) => c.precio_iva && !c.sin_stock).sort((a, b2) => a.precio_iva - b2.precio_iva)[0];
    const maximo_iva = Math.round(ventaU * 0.8 * 1.19), objetivo_iva = Math.min(maximo_iva, Math.round((el?.precio_unit_iva || mejor?.precio_iva || maximo_iva) * 0.9));
    return { i, item: x.item.d, cantidad: q, venta_unit_neto: ventaU, venta_neto: ventaU * q, elegido: el, costo_unit_neto: costoU, costo_neto: costoU != null ? costoU * q : null,
      ganancia: costoU != null ? (ventaU - costoU) * q : null, alternativas: (pj.alternativas || x.candidatos.slice(0, 3)).slice(0, 4), riesgo: pj.riesgo || "", buscar: pj.buscar || "", propios: x.propios, candidatos: x.candidatos, foto: x.candidatos[0]?.foto || null,
      negociacion: { objetivo_iva, maximo_iva, guion: texto(pj.guion, 500), argumentos: (pj.argumentos || []).slice(0, 4).map((a) => texto(a, 120)) } };
  });
  const tot = { venta_neto: filas.reduce((s, f) => s + f.venta_neto, 0), costo_neto: filas.reduce((s, f) => s + (f.costo_neto || 0), 0), sin_precio: filas.filter((f) => f.costo_neto == null).length };
  tot.ganancia = tot.sin_precio ? null : tot.venta_neto - tot.costo_neto;
  tot.ganancia_parcial = filas.reduce((s2, f) => s2 + (f.ganancia || 0), 0);
  return { ok: true, codigo: t.codigo, t: ahora(), items: filas, total: tot, resumen: plan?.resumen || "", pasos: (plan?.pasos || []).slice(0, 8).map((x) => texto(x, 200)), aviso };
}

// 🏭 BASE ÚNICA DE PROVEEDORES del grupo (PJANIC + Julfior + Barasal): todo lo que ya se compró (catálogos de facturas SII,
//    listas de proveedores del SII, semilla) en una sola lista con rubro. Claude clasifica el rubro de los que solo tienen nombre.
const EMPRESAS_GRUPO = { "78493114-5": "PJANIC", "78047617-6": "Julfior", "77003913-4": "Barasal" };
async function baseProveedores(store, forzar = false) {
  const kb = "proveedores/_base";
  const prev = await store.get(kb, { type: "json" }).catch(() => null);
  if (prev && !forzar && Date.now() - new Date(prev.t).getTime() < 24 * 3600e3) return prev;
  const P = {};
  const add = (rut, nombre, empresa, extra = {}) => { rut = String(rut || "").replace(/\./g, "").toUpperCase(); if (!rut) return null;
    const x = P[rut] || (P[rut] = { rut, nombre: nombre || "", empresas: [], productos: [], facturas: 0, total: 0, rubro: null, tipicos: [] });
    if (nombre && (!x.nombre || nombre.length > x.nombre.length)) x.nombre = nombre; if (empresa && !x.empresas.includes(empresa)) x.empresas.push(empresa); return x; };
  // 1) catálogos de productos (líneas de factura ya interpretadas)
  for (const [rutE, emp] of Object.entries(EMPRESAS_GRUPO)) {
    const C = await store.get("catalogo/" + rutE, { type: "json" }).catch(() => null);
    for (const it of Object.values(C?.items || {})) { const x = add(it.rut, it.proveedor, emp); if (!x) continue;
      if (x.productos.length < 40) x.productos.push({ producto: texto(it.producto, 100), familia: it.familia, precio_unit: it.precio_unit, unidad: it.unidad, fecha: it.fecha, empresa: emp }); }
    const S = await store.get("proveedores/sii/" + rutE, { type: "json" }).catch(() => null);
    for (const pv of Object.values(S?.lista || {})) { const x = add(pv.rut, pv.nombre, emp); if (!x) continue; const F = Object.values(pv.facturas || {}); x.facturas += F.length; x.total += F.reduce((a, f) => a + (Number(f.total) || 0), 0); if (pv.rubro) x.rubro = pv.rubro;
      for (const f of F) if (f.detalle && x.productos.length < 40 && !x.productos.some((q) => q.producto === f.detalle)) x.productos.push({ producto: texto(f.detalle, 100), empresa: emp, fecha: f.fecha, neto: f.neto }); }
    const semilla = PROV_SEED[rutE];
    for (const f of semilla?.facturas || []) { const x = add(f.rut, f.nombre, emp); if (!x) continue; x.facturas += 1; x.total += Number(f.total) || 0;
      if (f.detalle && x.productos.length < 40 && !x.productos.some((q) => q.producto === f.detalle)) x.productos.push({ producto: texto(f.detalle, 100), empresa: emp, fecha: f.fecha, neto: f.neto }); }
  }
  const prin = await store.get("proveedores/principal", { type: "json" }).catch(() => null);
  for (const pv of Object.values(prin?.lista || {})) { const x = add(pv.rut, pv.nombre, "PJANIC"); if (x && pv.rubro) x.rubro = pv.rubro; if (x && pv.nota) x.nota = pv.nota; }
  // 2) rubros guardados de antes
  const R = (await store.get("proveedores/_rubros", { type: "json" }).catch(() => null)) || {};
  for (const x of Object.values(P)) { const r = R[x.rut]; if (r) { x.rubro = x.rubro || r.rubro; x.tipicos = r.tipicos || []; x.util = r.util; x.web = r.web || null; x.telefono = r.telefono || null; } }
  const base = { t: ahora(), n: Object.keys(P).length, lista: Object.values(P).sort((a, b2) => b2.total - a.total) };
  await store.setJSON(kb, base);
  return base;
}
// Clasifica con Claude hasta 120 proveedores sin rubro (por nombre + lo que se les compró). Se llama varias veces hasta terminar.
async function clasificarProveedores(store) {
  const key = process.env.ANTHROPIC_API_KEY || ""; if (!key) return { error: "sin ANTHROPIC_API_KEY" };
  const base = await baseProveedores(store, true);
  const R = (await store.get("proveedores/_rubros", { type: "json" }).catch(() => null)) || {};
  const pend = base.lista.filter((x) => !R[x.rut]).slice(0, 25);
  if (!pend.length) return { ok: true, listo: true, clasificados: Object.keys(R).length };
  const prompt = `Clasifica proveedores chilenos (facturas de compra de un grupo de empresas que vende al Estado). Para cada uno di su rubro y qué productos/servicios típicos vende, y si sirve como proveedor para revender a organismos públicos ("util": true) o es un gasto interno (banco, luz, telecom, arriendo, combustible, SII, AFP, seguros: "util": false). Responde SOLO JSON: {"p":[{"rut":"","rubro":"<2-4 palabras>","tipicos":["<hasta 5 productos/servicios>"],"util":true|false}]}\n\n` +
    pend.map((x) => `${x.rut} | ${x.nombre} | compras: ${x.productos.slice(0, 4).map((q) => q.producto).join("; ") || "(sin detalle)"} | facturas ${x.facturas} | total $${Math.round(x.total)}`).join("\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 2500, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(20000) });
  const j = await r.json(); const txt = (j.content || []).map((c) => c.text || "").join(""); const m = txt.match(/\{[\s\S]*\}/);
  let out = null; try { out = m ? JSON.parse(m[0]) : null; } catch { const mi = txt.match(/\{[^{}]*"rut"[^{}]*\}/g) || []; out = { p: mi.map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean) }; }
  let n = 0; const porRut = Object.fromEntries(pend.map((x) => [x.rut.replace(/[^0-9K]/g, ""), x.rut]));
  for (const x of out?.p || []) { const rut = porRut[String(x.rut || "").toUpperCase().replace(/[^0-9K]/g, "")] || ""; if (!rut) continue; R[rut] = { rubro: texto(x.rubro, 60), tipicos: (x.tipicos || []).slice(0, 6).map((q) => texto(q, 60)), util: x.util !== false }; n++; }
  await store.setJSON("proveedores/_rubros", R);
  await baseProveedores(store, true);
  return { ok: true, clasificados_ahora: n, total: Object.keys(R).length, faltan: Math.max(0, base.lista.length - Object.keys(R).length) };
}

// 🛒 MERCADO LIBRE OFICIAL (API con OAuth). La nube no puede leer el sitio (bloquea tráfico de servidores), pero la API sí:
//    1) Felipe crea una aplicación en developers.mercadolibre.cl con redirect URI https://cotizagil.netlify.app/bot/ml-callback
//    2) guarda client_id/secret con POST /bot/ml-config  3) abre /bot/ml-auth una vez y autoriza  → tokens en ml/token (se refrescan solos).
async function mlConfig(store) { return (await store.get("ml/app", { type: "json" }).catch(() => null)) || { client_id: process.env.ML_CLIENT_ID || "", client_secret: process.env.ML_CLIENT_SECRET || "" }; }
async function mlToken(store) {
  const app = await mlConfig(store); if (!app.client_id || !app.client_secret) return null;
  const tk = await store.get("ml/token", { type: "json" }).catch(() => null); if (!tk?.refresh_token) return null;
  if (tk.access_token && Date.now() < (tk.expira || 0) - 60e3) return tk.access_token;
  const r = await fetch("https://api.mercadolibre.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: app.client_id, client_secret: app.client_secret, refresh_token: tk.refresh_token }), signal: AbortSignal.timeout(8000) });
  const j = await r.json(); if (!j.access_token) { await store.setJSON("ml/token", { ...tk, error: texto(JSON.stringify(j), 300), t: ahora() }); return null; }
  await store.setJSON("ml/token", { access_token: j.access_token, refresh_token: j.refresh_token || tk.refresh_token, user_id: j.user_id, expira: Date.now() + (j.expires_in || 21600) * 1000, t: ahora() });
  return j.access_token;
}
// 🧩 Puente PC: cuando no hay API oficial, la búsqueda se encola (ml/cola/<k>) y el PC grande (ml_puente.py, IP de casa)
//    la resuelve leyendo mercadolibre.cl y deja el resultado en ml/res/<k> (caché 24 h). Concretar espera hasta ~8 s.
const mlKey = (q) => { let h = 0; for (const ch of String(q).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h.toString(36); };
async function mlPuente(store, q, esperaMs = 6000) {
  const k = mlKey(q);
  const res = await store.get("ml/res/" + k, { type: "json" }).catch(() => null);
  if (res && Date.now() - new Date(res.t).getTime() < 24 * 3600e3) return { fotos: res.fotos || [], origen: "pc", t: res.t, error: res.error || null };
  await store.setJSON("ml/cola/" + k, { k, q, t: ahora() });
  const visto = await store.get("ml/puente_visto", { type: "json" }).catch(() => null);
  if (!visto || Date.now() - new Date(visto.t).getTime() > 10 * 60e3) return { fotos: [], error: "ML: el puente del PC no está activo (ML_PUENTE.bat); la búsqueda queda en cola" };
  const fin = Date.now() + esperaMs;
  while (Date.now() < fin) { await new Promise((r) => setTimeout(r, 1500)); const r2 = await store.get("ml/res/" + k, { type: "json" }).catch(() => null); if (r2 && new Date(r2.t).getTime() > Date.now() - 60e3) return { fotos: r2.fotos || [], origen: "pc", t: r2.t, error: r2.error || null }; }
  return { fotos: [], error: "ML: el PC no respondió a tiempo (queda en cola; en la próxima búsqueda estará)" };
}
async function mlBuscar(store, q, n = 10) {
  const tok = await mlToken(store); if (!tok) return mlPuente(store, q);
  const r = await fetch("https://api.mercadolibre.com/sites/MLC/search?" + new URLSearchParams({ q, limit: String(n), shipping: "", sort: "price_asc" }), { headers: { authorization: "Bearer " + tok, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return { fotos: [], error: "ML " + r.status };
  const j = await r.json();
  return { fotos: (j.results || []).filter((x) => x.available_quantity !== 0).map((x) => ({ titulo: x.title, url: x.permalink, foto: String(x.thumbnail || "").replace(/-I\.(jpg|webp|png)$/i, "-O.$1").replace(/^http:/, "https:"), precio_iva: Math.round(x.price), fuente: "mercadolibre.cl", disponible: x.available_quantity > 0, cantidad_disp: x.available_quantity, vendedor: x.seller?.nickname || null, envio_gratis: !!x.shipping?.free_shipping, local: (x.seller_address?.country?.id || "CL") === "CL", motor: "ml" })) };
}

// fechas de envío: las antiguas vienen «dd-mm-aaaa HH:MM» (hora Chile); se normalizan a ISO para comparar y para el marcador
const isoDe = (v) => { if (!v) return null; const m = String(v).match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/); if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] || "12"}:${m[5] || "00"}:00-03:00`; return String(v); };
const enviadaT = (t) => isoDe(t.fecha_envio) || (t.historial || []).find((h) => /^enviad|^confirmada/.test(h.estado || ""))?.t || null;

// 📎 ANEXOS DEL COMPRADOR → lo que de verdad se entrega: productos, cantidades, especificaciones, requisitos y brief de vistas.
async function analizarAnexo(store, b) {
  const key = process.env.ANTHROPIC_API_KEY || ""; if (!key) return { error: "Falta ANTHROPIC_API_KEY" };
  const txt = String(b.texto || "").slice(0, 60000); const it = b.item || {}, c = b.compra || {};
  const h = (() => { let x = 0; for (const ch of txt.slice(0, 4000) + String(it.nombre || "")) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x.toString(36); })();
  const ck = "anexo/" + texto(b.codigo, 40) + "/" + h;
  const prev = await store.get(ck, { type: "json" }).catch(() => null); if (prev?.analisis && !b.forzar) return { analisis: prev.analisis, cache: true };
  const prompt = `Eres el jefe técnico de un proveedor del Estado de Chile. Compra ágil ${b.codigo} «${c.nombre || ""}» del organismo ${c.organismo || ""}${c.direccion ? ", entrega en " + c.direccion : ""}.
El portal muestra el ítem genérico: «${it.nombre || ""}» (cantidad ${it.cantidad || 1} ${it.unidad || ""}). Lo que realmente se compra está en los ANEXOS del comprador (texto abajo).
Extrae con precisión y SIN inventar (si algo no está en el anexo, omítelo):
1) productos: cada prenda/producto/servicio pedido con cantidad y unidad, tallas o medidas, material, color, logo/bordado si lo piden, y cualquier detalle que defina cómo se ve.
2) especificaciones: pares [clave, valor] comunes a todo el encargo (materiales, normas, plazos, garantía, rotulado, embalaje).
3) requisitos: la matriz de lo exigido: [requisito, texto exigido (resumido fiel), cómo lo cumplimos] — máximo 20 filas, lo que el comprador evaluará.
4) brief para imágenes (el comprador debe VER lo que recibirá): {"tipo":"producto"|"montaje"|"servicio" (producto = bienes, prendas, equipos, kits; montaje = algo que se instala en un lugar: casetas, estructuras, señalética; servicio = trabajos),"encargo":"<qué es, en una línea>","escena":"<dónde se usará / contexto real del organismo>","conservar":["<lo que no puede cambiar: colores, logos institucionales descritos, medidas>"],"mostrar":["<elementos visibles que deben aparecer, uno por producto>"],"medidas":"<medidas/tallas/proporciones>","detalle":"<componente clave para el primer plano>"}
5) nombre_corto: nombre comercial claro del encargo (máx 90 caracteres), p. ej. «Uniformes municipales varones: parka, polar, polera y pantalón con logo».
6) texto_vistas: descripción visual en 1–2 frases de cómo se ve el conjunto entregado.
7) resumen: 2 frases de lo que se cotiza.
Responde SOLO JSON compacto: {"productos":[{"nombre":"","cantidad":0,"unidad":"","detalle":""}],"especificaciones":[["",""]],"requisitos":[["","",""]],"brief":{},"nombre_corto":"","texto_vistas":"","resumen":""}

ANEXOS:
${txt}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 5000, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(90000) });
  const j = await r.json(); const out = (j.content || []).map((x) => x.text || "").join(""); const m = out.match(/\{[\s\S]*\}/);
  let an = null; try { an = m ? JSON.parse(m[0]) : null; } catch { try { const k2 = m[0].lastIndexOf("}"); an = JSON.parse(m[0].slice(0, k2 + 1).replace(/,\s*$/, "") + "}"); } catch {} }
  if (!an) return { error: "Claude no devolvió un análisis legible: " + out.slice(0, 150) };
  await store.setJSON(ck, { t: ahora(), codigo: texto(b.codigo, 40), item: texto(it.nombre, 160), doc: texto(Array.isArray(b.archivos) ? b.archivos.map((a) => String(a).split(/[\\/]/).pop()).join(", ") : b.archivo, 300) || null, analisis: an });
  return { analisis: an };
}

const clpS = (v) => "$" + Math.round(Number(v) || 0).toLocaleString("es-CL");
// 📦 OC DEL PORTAL: la lista oficial «Buscar Órdenes de Compra por proveedor» de Mercado Público (estado real: Enviada a
//    proveedor / Aceptada / No Aceptada / Cancelada). Se guarda por empresa y se refleja en cada trabajo (op.oc_estado…).
async function sincronizarOCPortal(store, rutEmp, lista) {
  const rut = String(rutEmp || "").replace(/\./g, "").toUpperCase();
  const L = (Array.isArray(lista) ? lista : []).slice(0, 400).map((x) => ({ oc: limpiaCodigo(x.oc), nombre: texto(x.nombre, 200), comprador: texto(x.comprador, 120), fecha: texto(x.fecha, 30), estado: texto(x.estado, 40) })).filter((x) => x.oc);
  const T = await todos(store); const reg = (await store.get("oc/lista", { type: "json" }).catch(() => null)) || {};
  const porOC = new Map(); for (const t of T) { const c = t.op?.oc_codigo || t.op?.oc; if (c) porOC.set(limpiaCodigo(c), t); }
  const porCod = new Map(T.map((t) => [t.codigo, t]));
  let enlazadas = 0, cambiadas = 0; const sueltas = [];
  for (const o of L) {
    let t = porOC.get(o.oc) || null;
    if (!t) { const m = o.nombre.match(/\b(\d{3,8}-\d{1,6}-(?:COT|SE|LE|LP|LQ|LR|L1|CM)\d\d)\b/i); if (m) t = porCod.get(limpiaCodigo(m[1])) || null; }
    if (!t && reg[o.oc]?.cot) t = porCod.get(limpiaCodigo(reg[o.oc].cot)) || null;
    if (!t) { // mismo organismo (prefijo) y nombre parecido
      const pref = o.oc.split("-")[0]; const cand = T.filter((x) => String(x.codigo).startsWith(pref + "-") && !x.op?.oc_codigo && /enviad|confirmada|firmar/.test(x.estado));
      const kw = (s2) => String(s2 || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 4);
      const ko = kw(o.nombre); const best = cand.map((x) => ({ x, n: kw(x.nombre).filter((w) => ko.includes(w)).length })).filter((y) => y.n >= 2).sort((a, b2) => b2.n - a.n)[0];
      if (best) t = best.x;
    }
    if (!t) { sueltas.push(o); continue; }
    enlazadas++;
    const op = t.op || { etapa: "ganada", historial: [] }; const antes = JSON.stringify([op.oc_codigo, op.oc_estado, op.etapa, op.oc_aceptada]);
    op.oc = op.oc || o.oc; op.oc_codigo = o.oc; op.oc_estado = o.estado; op.oc_portal_t = ahora(); op.oc_fecha_portal = o.fecha;
    if (/^aceptada/i.test(o.estado)) { op.oc_aceptada = true; if (op.etapa === "rechazada" || op.etapa === "previa") op.etapa = "ganada"; }
    else if (/no aceptada|cancelad|anulad/i.test(o.estado)) { op.oc_aceptada = false; if (!["cerrado", "entrega"].includes(op.etapa)) { op.etapa = "rechazada"; op.motivo = op.motivo || ("OC " + o.estado + " en Mercado Público"); } }
    else if (op.etapa === "previa" || !op.etapa) { op.etapa = "ganada"; op.historial = [...(op.historial || []), { t: ahora(), etapa: "ganada" }]; if (!op.concrecion) op.concretar_pendiente = true; }
    t.op = op;
    if (JSON.stringify([op.oc_codigo, op.oc_estado, op.etapa, op.oc_aceptada]) !== antes) { cambiadas++; t.actualizado = ahora(); await store.setJSON("trabajo/" + t.codigo, t); }
  }
  const resumen = { t: ahora(), rut, n: L.length, estados: L.reduce((a, x) => { a[x.estado] = (a[x.estado] || 0) + 1; return a; }, {}), enlazadas, cambiadas, sueltas: sueltas.length, lista: L, sin_oferta: sueltas };
  await store.setJSON("oc_portal/" + rut, resumen);
  return resumen;
}

async function siiIngesta(req) {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: corsH });
  const b = req.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams.entries()) : await cuerpo(req);
  if (b.k !== SII_INGESTA_K) return new Response(JSON.stringify({ error: "clave" }), { status: 401, headers: { ...corsH, "content-type": "application/json" } });
  const store = getStore({ name: STORE, consistency: "strong" });
  const rutEmp = String(b.rut_empresa || "").replace(/\./g, "").toUpperCase(); if (!rutEmp) return new Response(JSON.stringify({ error: "rut_empresa" }), { status: 400, headers: corsH });
  const k2 = "proveedores/sii/" + rutEmp;
  const base = (await store.get(k2, { type: "json" })) || { lista: {}, nombre: null };
  if (b.nombre_empresa) base.nombre = texto(b.nombre_empresa, 120);
  let n = 0;
  for (const f of (Array.isArray(b.facturas) ? b.facturas : []).slice(0, 5000)) {
    const rut = String(f.rut || "").toUpperCase(); if (!rut) continue;
    const pv = base.lista[rut] || { rut, nombre: texto(f.nombre, 120), facturas: {}, rubro: null, nota: null };
    pv.nombre = texto(f.nombre, 120) || pv.nombre;
    pv.facturas[`${f.tipo || "33"}-${f.folio}`] = { tipo: String(f.tipo || "33"), folio: Number(f.folio) || 0, fecha: texto(f.fecha, 10), neto: Number(f.neto) || 0, iva: Number(f.iva) || 0, total: Number(f.total) || 0, periodo: texto(f.periodo, 6), origen: "sii" };
    base.lista[rut] = pv; n++;
  }
  // 📄 textos de los PDF de las facturas (extraídos en el navegador): se guardan para construir el catálogo de productos
  let nd = 0;
  if (Array.isArray(b.docs) && b.docs.length) {
    const kt = "siitexto/" + rutEmp;
    const T = (await store.get(kt, { type: "json" })) || { docs: {} };
    for (const d of b.docs.slice(0, 200)) { const id = `${d.tipo || "33"}-${String(d.rut || "").toUpperCase()}-${d.folio}`; if (!d.texto) continue; T.docs[id] = { tipo: String(d.tipo || "33"), rut: String(d.rut || "").toUpperCase(), nombre: texto(d.nombre, 120), folio: Number(d.folio) || 0, fecha: texto(d.fecha, 10), total: Number(d.total) || 0, texto: String(d.texto).slice(0, 6000) }; nd++; }
    T.t = ahora(); await store.setJSON(kt, T);
  }
  if (b.accion === "catalogo") return catalogoConstruir(store, rutEmp, corsH);
  if (b.accion === "pagina") return new Response(JSON.stringify({ ok: true, r: await precioPagina(String(b.url || "")) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  if (b.accion === "web") { try { return new Response(JSON.stringify({ ok: true, r: await webBuscar(b.q) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); } }
  if (b.accion === "ml_listado") { globalThis.__mlDebug = !!b.debug; try { return new Response(JSON.stringify({ ok: true, r: await mlListado(b.q, b.local !== false) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); } }
  if (b.accion === "prov_base") return new Response(JSON.stringify({ ok: true, ...(await baseProveedores(store, !!b.forzar)) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  if (b.accion === "prov_clasificar") return new Response(JSON.stringify(await clasificarProveedores(store)), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  if (b.accion === "concretar") { const t = await leer(store, String(b.codigo || "")); if (!t) return new Response(JSON.stringify({ error: "no existe" }), { status: 404, headers: corsH }); const r = await concretar(store, t, { fase: b.fase ? String(b.fase) : "ambas" }); if (r.ok && r.fase !== 1 && r.fase !== 2) { t.op = t.op || { etapa: "ganada", historial: [] }; t.op.concrecion = r; await store.setJSON("trabajo/" + t.codigo, t); } return new Response(JSON.stringify(r), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); }
  if (b.accion === "oc_portal") { const r = await sincronizarOCPortal(store, b.rut_empresa, b.lista); return new Response(JSON.stringify({ ok: true, ...r, lista: undefined, sin_oferta: (r.sin_oferta || []).slice(0, 60) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); }
  if (b.accion === "oc_portal_ver") { const r = await store.get("oc_portal/" + String(b.rut || "78493114-5").replace(/\./g, ""), { type: "json" }).catch(() => null); return new Response(JSON.stringify({ ok: true, r }), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); }
  if (b.accion === "anexo") { const r = await analizarAnexo(store, b); return new Response(JSON.stringify(r), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); }
  if (b.accion === "hoy") {   // diagnóstico: trabajos tocados desde una fecha, con empresa (para ver qué metió cada una y que no se crucen)
    const desde = String(b.desde || new Date(Date.now() - 24 * 3600e3).toISOString()); const L = await todos(store);   // TODOS los trabajos (caché), no solo los últimos por código
    const out = L.filter((t) => t && (String(t.actualizado || t.creado || "") >= desde || String(enviadaT(t) || "") >= desde)).map((t) => ({ codigo: t.codigo, empresa: t.empresa || null, rut_empresa: t.rut_empresa || null, estado: t.estado, accion: t.accion, por: t.por, jugador: t.jugador, persona: t.persona, nombre: texto(t.nombre, 80), organismo: texto(t.organismo, 60), total: t.total, llamado: t.llamado || t.op?.informe?.llamado || null, creado: t.creado, actualizado: t.actualizado, fecha_envio: t.fecha_envio || null, enviada_t: enviadaT(t), oc: t.op?.oc_codigo || null, etapa: t.op?.etapa || null, dispositivo: t.dispositivo || null }));
    return new Response(JSON.stringify({ ok: true, n: out.length, trabajos: out }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  }
  if (b.accion === "fotos_ultimo") return new Response(JSON.stringify({ ok: true, u: await store.get("robot/fotos_ultimo", { type: "json" }) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  if (b.accion === "foto") return new Response(JSON.stringify({ ok: true, ...(await buscarFotos(b.q)) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  if (b.accion === "simular_oc") {   // diagnóstico temporal: corre la simulación de una OC (misma lógica que /bot/simular)
    const r2 = await atender(new Request(new URL(req.url).origin + "/bot/simular-oc", { method: "POST", headers: { "x-robot-token": process.env.ROBOT_TOKEN || "", "content-type": "application/json" }, body: JSON.stringify({ codigo: b.codigo, fase: b.fase || "req", forzar: !!b.forzar, continuar_sin_adjunto: !!b.continuar_sin_adjunto, req_texto: b.req_texto || null, req_nombre: b.req_nombre || null }) }));
    const j2 = await r2.json().catch(() => ({})); return new Response(JSON.stringify(j2), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  }
  if (b.accion === "cotejo") {   // diagnóstico temporal: recalcula y guarda el cotejo OC↔oferta de un trabajo (misma regla que el estudio)
    const t = await leer(store, limpiaCodigo(b.codigo)); if (!t) return new Response(JSON.stringify({ error: "no existe" }), { status: 404, headers: { ...corsH, "content-type": "application/json" } });
    const m = cotejarOC(t); if (m && t.op) { t.op.oc_match = m; await escribir(store, t); }
    return new Response(JSON.stringify({ ok: true, codigo: t.codigo, externa: !!t.externa, oc_match: m }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  }
  if (b.accion === "buscar_trabajo") {   // diagnóstico temporal: busca un texto en los trabajos (ítems, precios, nombre)
    const q = String(b.q || "").toLowerCase(); const { blobs } = await store.list({ prefix: String(b.prefijo || "trabajo/").slice(0, 40) }); const out = [];
    if (b.solo_claves) return new Response(JSON.stringify({ ok: true, n: blobs.length, claves: blobs.slice(-300).map((x) => x.key) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
    if (b.crudo) { const t = await store.get(String(b.crudo), { type: "json" }); return new Response(JSON.stringify({ ok: true, t }), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); }
    const ult = blobs.slice(-(Number(b.max) || 250)).reverse();   // solo los últimos, en paralelo (antes recorría todo en serie y daba timeout)
    const todos = []; for (let i = 0; i < ult.length; i += 25) todos.push(...(await Promise.all(ult.slice(i, i + 25).map((bl) => store.get(bl.key, { type: "json" }).catch(() => null)))));
    for (const t of todos) { if (!t) continue; const s = JSON.stringify(t).toLowerCase(); if (q && !s.includes(q)) continue;
      out.push({ codigo: t.codigo, estado: t.estado, nombre: texto(t.nombre || t.titulo, 120), organismo: texto(t.organismo, 80), presupuesto: t.presupuesto || t.monto || null, descuento: t.descuento, precioTotal: t.precio_total || t.total || t.oferta?.total || null, items: (t.items || t.productos || t.oferta?.items || t.ficha?.items || []).slice(0, 12).map((it) => ({ n: texto(it.nombre || it.producto || it.descripcion, 90), cant: it.cantidad ?? it.cant, pu: it.precio_unitario ?? it.precio_unit ?? it.precio ?? it.pu, modelo: texto(it.modelo || it.detalle, 90) })), actualizado: t.actualizado }); if (out.length >= 5) break; }
    return new Response(JSON.stringify({ ok: true, n: out.length, trabajos: out }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  }
  if (b.accion === "cola_resumen") {   // diagnóstico temporal: últimos trabajos y su estado (para revisar por qué no llegan a Firmar)
    const { blobs } = await store.list({ prefix: "trabajo/" });
    const L = [];
    for (const bl of blobs.slice(-400)) { const t = await store.get(bl.key, { type: "json" }); if (t) L.push(t); }
    L.sort((a, b2) => String(b2.actualizado || b2.creado || "").localeCompare(String(a.actualizado || a.creado || "")));
    const rob = (await store.get("robot/latido", { type: "json" })) || null;
    return new Response(JSON.stringify({ ok: true, robot: rob, n: L.length, ultimos: L.slice(0, 25).map((t) => ({ codigo: t.codigo, estado: t.estado, accion: t.accion, por: t.por, prob: t.prob, descuento: t.descuento, empresa: t.empresa, jugador: t.jugador, creado: t.creado, actualizado: t.actualizado, mensaje: String(t.mensaje || "").slice(0, 160), cerebro: t.cerebro })) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  }
  if (b.accion === "historico_resumen") {   // índice del histórico de mercado + distribución de rivales por familia
    const idx = (await store.get("historico/_indice", { type: "json" })) || { terms: {} };
    const out = [];
    for (const term of Object.keys(idx.terms)) { const H = (await store.get("historico/" + term, { type: "json" })) || { compras: {} }; const L = Object.values(H.compras);
      const ofs = L.map((c) => c.nOf), rs = L.filter((c) => c.pres > 0 && c.ganador?.total > 0).map((c) => c.ganador.total / c.pres).sort((x, y) => x - y);
      const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null;
      out.push({ term, n: L.length, ofMed: idx.terms[term].ofMed, of0_1: ofs.filter((o) => o <= 1).length, of2_3: ofs.filter((o) => o >= 2 && o <= 3).length, of4p: ofs.filter((o) => o >= 4).length,
        r25: q(rs, 0.25), r50: q(rs, 0.5), r75: q(rs, 0.75), presMed: idx.terms[term].presMed, seg: L.filter((c) => /segundo/i.test(c.conv || "")).length }); }
    return new Response(JSON.stringify({ ok: true, familias: out }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  }
  if (b.accion === "catalogo_resumen") {   // lectura rápida del catálogo armado (para revisar la carga desde el navegador)
    const C = (await store.get("catalogo/" + rutEmp, { type: "json" })) || { items: {}, hechos: {} };
    const items = Object.values(C.items), fam = {};
    for (const it of items) { const f = fam[it.familia] || (fam[it.familia] = { n: 0, neto: 0, productos: {} }); f.n++; f.neto += it.neto || 0; const p = f.productos[it.producto] || (f.productos[it.producto] = { n: 0, precios: [], prov: it.proveedor, unidad: it.unidad }); p.n++; p.precios.push(it.precio_unit); }
    const out = Object.entries(fam).sort((a, b2) => b2[1].neto - a[1].neto).map(([k, f]) => ({ familia: k, lineas: f.n, neto: f.neto, top: Object.entries(f.productos).sort((a, b2) => b2[1].n - a[1].n).slice(0, Number(b.top) || 8).map(([p, v]) => ({ producto: p, n: v.n, unidad: v.unidad, prov: v.prov, precio_med: [...v.precios].sort((x, y) => x - y)[Math.floor(v.precios.length / 2)] })) }));
    return new Response(JSON.stringify({ ok: true, rut: rutEmp, lineas: items.length, docs: Object.keys(C.hechos).length, familias: out }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  }
  // 📚 HISTÓRICO de compras ágiles adjudicadas (TodoLicitaciones, leído desde la sesión de Felipe): precio ganador por producto y organismo.
  //    Se guarda por término de búsqueda (familia) en historico/<term>; cada compra con todas sus ofertas, ganador y productos.
  if (b.accion === "historico") {
    const term = String(b.term || "varios").toLowerCase().replace(/[^a-z0-9ñ]+/g, "-").slice(0, 40) || "varios";
    const kh = "historico/" + term;
    const H = (await store.get(kh, { type: "json" })) || { term, compras: {} };
    let nh = 0;
    for (const c of (Array.isArray(b.compras) ? b.compras : []).slice(0, 500)) {
      if (!c.codigo) continue;
      H.compras[String(c.codigo).slice(0, 30)] = { codigo: texto(c.codigo, 30), nombre: texto(c.nombre, 160), org: texto(c.org, 120), rutOrg: texto(c.rutOrg, 14), region: texto(c.region, 60),
        pres: Number(c.pres) || 0, cierre: texto(c.cierre, 16), conv: texto(c.conv, 20), nOf: Number(c.nOf) || 0, oc: texto(c.oc, 20), plazo: texto(c.plazo, 20),
        ganador: c.ganador ? { nombre: texto(c.ganador.nombre, 100), rut: texto(c.ganador.rut, 14), total: Number(c.ganador.total) || 0, neto: Number(c.ganador.neto) || 0, despacho: Number(c.ganador.despacho) || 0 } : null,
        ofertas: (Array.isArray(c.ofertas) ? c.ofertas : []).slice(0, 40).map((o) => ({ n: texto(o.n, 80), rut: texto(o.rut, 14), total: Number(o.total) || 0, adj: !!o.adj })),
        productos: (Array.isArray(c.productos) ? c.productos : []).slice(0, 30).map((p) => ({ nombre: texto(p.nombre, 100), rubro: texto(p.rubro, 120), desc: texto(p.desc, 300), cant: Number(p.cant) || 0, unidad: texto(p.unidad, 16) })),
        t: ahora() }; nh++;
    }
    H.t = ahora(); await store.setJSON(kh, H);
    const idx = (await store.get("historico/_indice", { type: "json" })) || { terms: {} };
    const L = Object.values(H.compras), med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const rs = L.filter((c) => c.pres > 0 && c.ganador?.total > 0).map((c) => c.ganador.total / c.pres);
    idx.terms[term] = { n: L.length, t: ahora(), ratioMed: med(rs), ofMed: med(L.map((c) => c.nOf)), presMed: med(L.map((c) => c.pres)),
      ratioSeg: med(L.filter((c) => /segundo/i.test(c.conv || "") && c.pres > 0 && c.ganador?.total > 0).map((c) => c.ganador.total / c.pres)),
      ratioPri: med(L.filter((c) => !/segundo/i.test(c.conv || "") && c.pres > 0 && c.ganador?.total > 0).map((c) => c.ganador.total / c.pres)) };
    await store.setJSON("historico/_indice", idx);
    return new Response(JSON.stringify({ ok: true, term, guardadas: nh, total: Object.keys(H.compras).length }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  }
  base.t = ahora(); await store.setJSON(k2, base);
  return new Response(JSON.stringify({ ok: true, guardadas: n, textos: nd, proveedores: Object.keys(base.lista).length }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
}
// 🧠 CATÁLOGO: Claude lee los textos de las facturas y arma familia → producto → cantidad/unidad → precio unitario neto
async function catalogoConstruir(store, rutEmp, corsH) {
  const key = process.env.ANTHROPIC_API_KEY || "";
  if (!key) return new Response(JSON.stringify({ error: "sin ANTHROPIC_API_KEY" }), { status: 500, headers: corsH });
  const T = (await store.get("siitexto/" + rutEmp, { type: "json" })) || { docs: {} };
  const kc = "catalogo/" + rutEmp;
  const C = (await store.get(kc, { type: "json" })) || { items: {}, hechos: {} };
  const pendientes = Object.entries(T.docs).filter(([id]) => !C.hechos[id]).slice(0, 12);
  if (!pendientes.length) return new Response(JSON.stringify({ ok: true, listo: true, items: Object.keys(C.items).length }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  const prompt = `Eres el analista de compras de PJANIC SpA. Te paso el texto (extraído de PDF, puede venir desordenado) de facturas de compra recibidas. Para CADA documento extrae sus líneas de producto o servicio. Responde SOLO con JSON: {"docs":[{"id":"<id>","lineas":[{"familia":"<una de: bolsas y plástico, áridos y hormigón, viruta y madera, alimento animal, impresión y gráfica, metalmecánica, construcción y ferretería, eventos y producción, pasajes y transporte, mobiliario, tecnología, asesorías y servicios, financiero y bancario, telecomunicaciones, otros>","producto":"<nombre limpio, con medida/modelo>","cantidad":<número>,"unidad":"<kg|un|m3|m2|ml|global|hora|mes|servicio|...>","precio_unit":<precio unitario NETO en CLP, número>,"neto":<total neto de la línea>}]}]}. Si una factura es solo un servicio sin líneas claras, igual pon una línea con cantidad 1 unidad "global". No inventes: si no hay precio unitario, calcula neto/cantidad.\n\n` + pendientes.map(([id, d]) => `=== ${id} | ${d.nombre} | ${d.fecha} | total ${d.total}\n${d.texto.slice(0, 3500)}`).join("\n\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }) });
  if (!r.ok) return new Response(JSON.stringify({ error: "claude " + r.status }), { status: 502, headers: corsH });
  const d = await r.json(); const out = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  let js = null; try { js = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); } catch { js = null; }
  let nl = 0;
  for (const doc of (js?.docs || [])) { const src = T.docs[doc.id]; if (!src) continue; C.hechos[doc.id] = ahora();
    for (const l of (doc.lineas || [])) { if (!l.producto) continue; const k = `${doc.id}#${nl++}`; C.items[k] = { doc: doc.id, rut: src.rut, proveedor: src.nombre, fecha: src.fecha, familia: texto(l.familia, 40) || "otros", producto: texto(l.producto, 140), cantidad: Number(l.cantidad) || 1, unidad: texto(l.unidad, 12) || "un", precio_unit: Math.round(Number(l.precio_unit) || 0), neto: Math.round(Number(l.neto) || 0) }; } }
  for (const [id] of pendientes) if (!C.hechos[id]) C.hechos[id] = "sin_lineas";
  C.t = ahora(); await store.setJSON(kc, C);
  return new Response(JSON.stringify({ ok: true, procesados: pendientes.length, lineas: nl, items: Object.keys(C.items).length, faltan: Object.keys(T.docs).length - Object.keys(C.hechos).length }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
}

// 🧠 CEREBRO DE PRECIO (modo automático): familia por palabras clave → histórico de mercado (ganador real, rivales) → certeza y descuento.
//    Misma calibración que la app (robot.js probGanar/precioClaude); el piso de costo lo aplica el robot con su propio costo.
const CERTEZA_MIN = 0.40;
const HIST_KW = { "cascos-seguridad": /casco/i, "elementos-proteccion-personal": /\bepp\b|protecci[oó]n personal|guante|zapato de seguridad|chaleco reflect|antiparra|lentes de seguridad|mascarilla/i,
  "pletina": /pletina|plancha de acero/i, "acero": /acero|inoxidable/i, "fierro": /fierro|perfil met|tubo estructural|barra de acero|malla acma/i, "viruta": /viruta|cama de/i, "aserrin": /aserr[ií]n/i,
  "bolsas-basura": /bolsa.*basura|bolsas? de (basura|residuo)/i, "bolsas-plasticas": /bolsa/i, "hormigon": /hormig[oó]n|cemento/i, "aridos": /[áa]rido|gravilla|arena|ripio|estabilizado/i, "alimento-perros": /alimento.*(perro|canino|mascota|gato)|croqueta/i,
  "pendones": /pend[oó]n|gigantograf|lienzo|roller/i, "impresion": /impresi[oó]n|folleter|afiche|tr[ií]ptico|volante|gr[áa]fica|tarjeta/i, "mobiliario": /mobiliario|silla|escritorio|mesa|estante|kardex|locker/i, "insumos-aseo": /aseo|limpieza|detergente|cloro|papel higi[eé]nico|toalla de papel|jab[oó]n/i,
  "terciado": /terciado|melamina|mdf|osb/i, "madera": /madera|pino|tabla|vigas?/i, "pintura": /pintura|esmalte|l[áa]tex|barniz|rodillo/i, "herramientas": /herramienta|taladro|esmeril|sierra|motosierra|desmalezador|galletera/i, "señaletica": /se[ñn]al[eé]tica|letrero|placa|cono/i,
  "carpa": /carpa|toldo|gazebo/i, "electrodomesticos": /electrodom|refrigerador|microondas|hervidor|lavadora|televisor|aire acondicionado/i, "estanterias": /estanter[ií]a|rack|repisa/i, "juguetes": /juguete|navidad|regalo/i,
  "guantes": /guante/i, "zapatos-seguridad": /zapato|bota|calzado/i, "chalecos": /chaleco/i, "uniformes": /uniforme|polera|pantal[oó]n|parka|poleron|buzo/i, "toner": /t[oó]ner|cartucho|tinta/i, "papel": /resma|papel carta|papel oficio/i, "articulos-oficina": /oficina|l[áa]piz|archivador|corchetera/i, "computador": /computador|pc\b|all in one/i, "notebook": /notebook|laptop/i, "impresora": /impresora|multifuncional|plotter/i };
async function cerebroPrecio(store, codigo, b) {
  const O = (await store.get("oportunidades/lista", { type: "json" })) || { lista: [] };
  const x = (O.lista || []).find((y) => limpiaCodigo(y.codigo) === codigo) || {};
  const nombre = [b.nombre, x.nombre, x.descripcion, ...((x.productos || []).map((p) => p?.nombre || p))].filter(Boolean).join(" ");
  const pres = Number(b.monto) || Number(x.monto) || Number(x.presupuesto) || 0;
  const of = x.ofertas != null ? Number(x.ofertas) : null, seg = /segundo|2/.test(String(x.llamado || x.convocatoria || ""));
  const idx = (await store.get("historico/_indice", { type: "json" })) || { terms: {} };
  let h = null; for (const [term, re] of Object.entries(HIST_KW)) { const t = idx.terms[term]; if (t && t.n >= 8 && t.ratioMed && re.test(nombre)) { h = { term, ...t }; break; } }
  // certeza base por rivales y llamado (calibración 13-11-2026, 44 casos propios + histórico de mercado)
  let p = of === 0 ? (seg ? 0.85 : 0.55) : of === 1 ? (seg ? 0.65 : 0.45) : of != null && of <= 3 ? (seg ? 0.45 : 0.32) : of != null && of <= 6 ? 0.18 : of != null ? 0.08 : (seg ? 0.40 : 0.25);
  if (x.tipo === "exp") p *= 1.15; else if (x.tipo === "esp") p *= 0.5; else if ((x.viab ?? 1) < 0.85) p *= 0.7;
  const mr = (h && (seg ? h.ratioSeg : h.ratioPri)) || h?.ratioMed || (seg ? 0.94 : 0.92);
  let r = Math.min(seg && of === 0 ? 0.98 : 0.96, Math.max(h ? 0.55 : 0.85, mr - 0.01)); if (!seg && of != null && of >= 4) r -= 0.02;
  p *= 1.1;   // cotizamos justo bajo la mediana del ganador
  p = Math.max(0.02, Math.min(0.95, p));
  const motivo = `${of == null ? "rivales desconocidos" : of + " rivales"}, ${seg ? "2° llamado" : "1er llamado"}${h ? `, mercado «${h.term}» gana al ${Math.round(mr * 100)} % (${h.n} compras)` : ", sin histórico de familia"}`;
  return { prob: p, descuento: Math.max(0, Math.round((1 - r) * 1000) / 1000), ratio: r, familia: h?.term || null, pres, motivo };
}

async function atender(req) {
  if (/^\/bot\/sii-ingesta\/?$/.test(new URL(req.url).pathname)) return siiIngesta(req);
  if (/^\/bot\/informe\/?$/.test(new URL(req.url).pathname)) return informePublico(req);
  if (/^\/bot\/wa\/?$/.test(new URL(req.url).pathname)) return waWebhook(req);
  if (/^\/bot\/nube-pedir\/?$/.test(new URL(req.url).pathname)) return nubePedir(req);
  if (/^\/bot\/webpay-retorno\/?$/.test(new URL(req.url).pathname)) return webpayRetorno(req);
  if (/^\/bot\/ml-callback\/?$/.test(new URL(req.url).pathname)) {   // 🛒 vuelta de la autorización de Mercado Libre
    const store0 = getStore({ name: STORE, consistency: "strong" }); const u0 = new URL(req.url); const code = u0.searchParams.get("code");
    if (!code) return new Response("Falta el código de Mercado Libre.", { status: 400 });
    const app = await mlConfig(store0);
    const r = await fetch("https://api.mercadolibre.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: app.client_id, client_secret: app.client_secret, code, redirect_uri: "https://cotizagil.netlify.app/bot/ml-callback" }) });
    const j = await r.json();
    if (!j.access_token) return new Response("Mercado Libre no entregó token: " + JSON.stringify(j).slice(0, 300), { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    await store0.setJSON("ml/token", { access_token: j.access_token, refresh_token: j.refresh_token, user_id: j.user_id, expira: Date.now() + (j.expires_in || 21600) * 1000, t: ahora() });
    return new Response("<html><body style='font-family:system-ui;padding:30px'><h2>✅ Mercado Libre conectado a CotizÁgil</h2><p>Ya puedes cerrar esta pestaña. El robot buscará productos y precios en Mercado Libre Chile desde ahora.</p></body></html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (/^\/bot\/ml-auth\/?$/.test(new URL(req.url).pathname)) { const st = getStore({ name: STORE, consistency: "strong" }); const app = await mlConfig(st); if (!app.client_id) return json({ error: "Primero guarda client_id/secret con ml-config." }, 400);
    return Response.redirect("https://auth.mercadolibre.cl/authorization?" + new URLSearchParams({ response_type: "code", client_id: app.client_id, redirect_uri: "https://cotizagil.netlify.app/bot/ml-callback" }), 302); }
  if (!autorizado(req)) return json({ error: "Código de enlace inválido o no configurado." }, 401);
  const store = getStore({ name: STORE, consistency: "strong" });
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/bot\/?/, "").replace(/\/$/, "") || "estado";

  // ---------- 🧪 SIMULADOR (autocontenido, en cualquier entorno) ----------
  // Inyecta cotizaciones FICTICIAS para probar el flujo (cola → por firmar → firma) SIN Mercado Público real.
  // Blindaje total: el simulador SIEMPRE usa su propio store "robot-sim", nunca el real ("robot"). Por eso puede
  // correr incluso en producción sin tocar un solo dato verdadero. Las simuladas llevan sim:true y código SIM-….
  if (ruta === "ml-config" && req.method === "POST") { const b = await cuerpo(req); await store.setJSON("ml/app", { client_id: texto(b.client_id, 40), client_secret: texto(b.client_secret, 120), t: ahora() }); return json({ ok: true, auth_url: "https://cotizagil.netlify.app/bot/ml-auth" }); }
  if (ruta === "ml-auth" && req.method === "GET") { const app = await mlConfig(store); if (!app.client_id) return json({ error: "Primero guarda client_id/secret con ml-config." }, 400);
    return Response.redirect("https://auth.mercadolibre.cl/authorization?" + new URLSearchParams({ response_type: "code", client_id: app.client_id, redirect_uri: "https://cotizagil.netlify.app/bot/ml-callback" }), 302); }
  if (ruta === "ml-estado" && req.method === "GET") { const app = await mlConfig(store); const tk = await store.get("ml/token", { type: "json" }).catch(() => null); const tok = await mlToken(store).catch(() => null); return json({ app: !!app.client_id, autorizado: !!tk?.refresh_token, token_ok: !!tok, user_id: tk?.user_id || null, error: tk?.error || null }); }
  if (ruta === "oc-portal" && req.method === "POST") { const b = await cuerpo(req); const r = await sincronizarOCPortal(store, b.rut_empresa, b.lista); return json({ ok: true, n: r.n, estados: r.estados, enlazadas: r.enlazadas, cambiadas: r.cambiadas, sueltas: r.sueltas }); }
  if (ruta === "oc-portal" && req.method === "GET") { const rut = String(url.searchParams.get("rut") || "").replace(/\./g, "").toUpperCase(); const r = await store.get("oc_portal/" + rut, { type: "json" }).catch(() => null); return json({ ok: true, portal: r }); }
  if (ruta === "anexo" && req.method === "POST") { const b = await cuerpo(req); const r = await analizarAnexo(store, b); if (!r.error && b.codigo) { try { const t = await leer(store, limpiaCodigo(b.codigo)); if (t?.anexos_pedido) { t.anexos_subido = ahora(); await escribir(store, t); } } catch {} } return json(r, r.error ? 400 : 200); }   // 📎 anexos → lo que se entrega
  if (ruta === "ml-pendientes" && req.method === "GET") { try { await store.setJSON("ml/puente_visto", { t: ahora() }); } catch {} const { blobs } = await store.list({ prefix: "ml/cola/" }); const L = []; for (const b2 of blobs.slice(0, 10)) { const x = await store.get(b2.key, { type: "json" }).catch(() => null); if (x) L.push(x); } return json({ ok: true, pendientes: L }); }
  if (ruta === "ml-resultado" && req.method === "POST") { const b = await cuerpo(req); const k = texto(b.k, 20); if (!k) return json({ error: "falta k" }, 400);
    const fotos = (Array.isArray(b.fotos) ? b.fotos : []).slice(0, 15).map((x) => ({ titulo: texto(x.titulo, 160), url: texto(x.url, 400), foto: texto(x.foto, 400) || null, precio_iva: Math.round(Number(x.precio_iva) || 0) || null, fuente: "mercadolibre.cl", disponible: x.disponible !== false, vendedor: texto(x.vendedor, 60) || null, envio_gratis: !!x.envio_gratis, local: x.local !== false, motor: "ml-pc" }));
    await store.setJSON("ml/res/" + k, { k, q: texto(b.q, 120), fotos, error: texto(b.error, 200) || null, t: ahora() }); try { await store.delete("ml/cola/" + k); } catch {} return json({ ok: true, n: fotos.length }); }
  if (ruta === "ml-buscar" && req.method === "GET") return json(await mlBuscar(store, url.searchParams.get("q") || ""));
  if (ruta === "proveedores-base" && req.method === "GET") return json(await baseProveedores(store, url.searchParams.get("forzar") === "1"));
  if (ruta === "proveedores-clasificar" && req.method === "POST") return json(await clasificarProveedores(store));
  if (ruta === "concretar" && req.method === "POST") {   // 🎯 plan para concretar una OC ganada con proveedores/links reales
    const b = await cuerpo(req); const t = await leer(store, limpiaCodigo(b.codigo)); if (!t) return json({ error: "No existe." }, 404);
    if (t.op?.concrecion && !b.forzar && Date.now() - new Date(t.op.concrecion.t).getTime() < 6 * 3600e3) return json(t.op.concrecion);
    const r = await concretar(store, t, { fase: b.fase ? String(b.fase) : "ambas" }); if (r.error) return json(r, 400);
    if (r.fase === 1 || r.fase === 2) return json(r);
    t.op = t.op || { etapa: "ganada", historial: [] }; t.op.concrecion = r; t.op.concretar_pendiente = false; delete t.op.concrecion_tmp; t.actualizado = ahora(); await store.setJSON("trabajo/" + t.codigo, t);
    if (b.auto) { const e0 = (r.items || []).find((x) => x.elegido); const dir = e0?.elegido?.telefono ? "📞 llama al " + e0.elegido.telefono : e0?.elegido?.url ? "🛒 compra en " + String(e0.elegido.url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : "revisa el plan";
      await avisarTexto(store, "🎯 Plan listo · " + t.codigo, `${(t.nombre || "").slice(0, 60)} · ${dir}${r.total?.ganancia != null ? " · ganas " + clpS(r.total.ganancia) : r.total?.ganancia_parcial ? " · ganancia parcial " + clpS(r.total.ganancia_parcial) : ""}. Abre Ejecuta → Concretar.`, "concretar-" + t.codigo, "/#robot", true).catch(() => {}); }
    return json(r);
  }
  if (ruta === "foto" && req.method === "GET") {   // 📷 fotos reales para el robot (deja huella para saber que el parche corre)
    const res = await buscarFotos(url.searchParams.get("q"));
    try { await store.setJSON("robot/fotos_ultimo", { q: res.q, n: res.fotos.length, errores: res.errores, t: ahora(), equipo: req.headers.get("user-agent") }); } catch {}
    return json({ ok: true, ...res });
  }
  if (ruta === "simular" && req.method === "POST") {
    const sim = storeSim();
    const b = await cuerpo(req);
    if (b.limpiar) {
      const { blobs } = await sim.list();
      await Promise.all(blobs.map((x) => sim.delete(x.key)));
      return json({ ok: true, borradas: blobs.length, entorno: "robot-sim" });
    }
    if (b.demo === "on") {                                   // ▶ demo de carga: el robot produce sin parar + humano 25 s
      await sim.setJSON("sim/demo", { on: true, t0: ahora(), firmo: ahora() });
      const pool = await traerRealesCA(30);                  // arranca con compras REALES leídas por fuera (API)
      await sim.setJSON("sim/pool", pool.slice(6));
      for (let i = 0; i < 6; i++) await escribir(sim, pool[i] ? nuevaSimReal(pool[i], "en_cola") : nuevaSim("en_cola"));
      return json({ ok: true, demo: "on", reales: pool.length, entorno: "robot-sim" });
    }
    if (b.reales) {                                          // 🌐 traer N compras REALES por fuera (API), al estado pedido
      const pool = await traerRealesCA(50);
      const n = Math.min(20, Math.max(1, Number(b.reales) || 10));
      const estado = ["en_cola", "preparando", "lista"].includes(b.estado) ? b.estado : "en_cola";
      const creadas = [];
      for (let i = 0; i < n && i < pool.length; i++) creadas.push(await escribir(sim, nuevaSimReal(pool[i], estado)));
      return json({ ok: true, reales: creadas.length, estado, entorno: "robot-sim" });
    }
    if (b.demo === "off") {
      await sim.setJSON("sim/demo", { on: false });
      return json({ ok: true, demo: "off", entorno: "robot-sim" });
    }
    const n = Math.min(50, Math.max(1, Number(b.n) || 5));
    const estado = ["en_cola", "preparando", "lista"].includes(b.estado) ? b.estado : "lista";
    const creadas = [];
    for (let i = 0; i < n; i++) creadas.push(await escribir(sim, nuevaSim(estado)));
    return json({ ok: true, creadas: creadas.length, estado, entorno: "robot-sim" });
  }
  // Estado en vivo del simulador: avanza el robot simulado (tick) y devuelve el tablero. El tablero lo consulta en bucle.
  if (ruta === "sim-estado" && req.method === "GET") {
    const sim = storeSim();
    await simTick(sim);
    const lista = await todosSim(sim);
    const demo = (await sim.get("sim/demo", { type: "json" })) || null;
    const n = (e) => lista.filter((t) => t.estado === e).length;
    return json({
      ok: true, demo: !!(demo && demo.on),
      conteo: { en_cola: n("en_cola"), preparando: n("preparando") + n("tomado"), lista: n("lista"),
        enviada: n("enviada") + n("confirmada"), total: lista.length },
      trabajos: lista.slice(0, 120).map(({ historial, ...t }) => t),
    });
  }

  // ---------- 💳 WebPay: crear el pago y cobrar el abono confirmado ----------
  if (ruta === "webpay-crear" && req.method === "POST") {
    const b = await cuerpo(req);
    const monto = Math.round(Number(b.monto) || 0);
    if (monto < 50 || monto > 10_000_000) return json({ error: "El monto debe estar entre $50 y $10.000.000." }, 400);
    const inv = await invDe(req, store); if (!inv) return json({ error: "Identifícate como inversionista para cargar saldo." }, 401);
    const orden = ("SC" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).slice(0, 26);
    const session = ("s" + randomBytes(8).toString("base64url")).slice(0, 61);
    let j = {};
    try {
      const r = await fetch(`${WP_BASE}/rswebpaytransaction/api/webpay/v1.2/transactions`, {
        method: "POST", headers: WP_HEAD(),
        body: JSON.stringify({ buy_order: orden, session_id: session, amount: monto, return_url: `${WP_SITIO}/bot/webpay-retorno` }),
      });
      j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token || !j.url) return json({ error: "WebPay no respondió (" + r.status + ")." }, 502);
    } catch (e) { return json({ error: "No se pudo contactar WebPay." }, 502); }
    await store.setJSON(`wp/${orden}`, { orden, monto, inv_id: inv.id, session, empresa: texto(b.empresa, 40) || null, token: j.token, estado: "creada", t: ahora() });
    return json({ url: j.url, token: j.token, orden });
  }
  if (ruta === "webpay-cobrar" && req.method === "POST") {
    const b = await cuerpo(req);
    const key = `wpcredito/${texto(b.jugador, 60) || "inv"}`;
    const cr = (await store.get(key, { type: "json" })) || { total: 0, items: [] };
    if (cr.total > 0) await store.setJSON(key, { total: 0, items: [] });
    return json({ abonado: cr.total || 0, items: cr.items || [] });
  }


  // ---------- 💼 inversionista: identidad, libro, asignación a OC, devoluciones (permisos en el servidor) ----------
  if (ruta === "inv-registrar" && req.method === "POST") {   // crea el perfil (id + clave); la clave solo viaja en el celular que la creó
    const b = await cuerpo(req); const nombre = texto(b.nombre, 60), clave = String(b.clave || "");
    if (!nombre || clave.length < 4) return json({ error: "Nombre y clave (mínimo 4 caracteres)." }, 400);
    const id = invId(); await store.setJSON("inv/" + id, { id, nombre, clave_hash: invHash(clave), creado: ahora(), empresas: [] });
    return json({ id, nombre });
  }
  if (ruta === "inv-estado" && req.method === "GET") {        // solo los movimientos propios
    const inv = await invDe(req, store); if (!inv) return json({ error: "Inversionista no identificado." }, 401);
    const { libro } = await leerLibro(store, inv.id); const R2 = resumenLibro(libro.movs);
    const ocs = {}; for (const oc of Object.keys(R2.porOC)) { const t = await leer(store, oc).catch(() => null); if (t) ocs[oc] = { nombre: t.nombre, organismo: t.oc_compra?.organismo || t.organismo, oc_codigo: t.op?.oc_codigo || null, etapa: t.op?.etapa || null, acuerdo: t.op?.inv_acuerdo || null, cobrado: (t.op?.abonos || []).filter((a) => a.confirmado !== false).reduce((s2, a) => s2 + (a.monto || 0), 0), fecha_cobro: t.op?.fecha_cobro || null, cerrado: t.op?.cerrado || null }; }
    return json({ inv: { id: inv.id, nombre: inv.nombre }, resumen: R2, movs: libro.movs.slice(-100).reverse(), ocs, v: libro.v || 0 });
  }
  if (ruta === "inv-simular-abono" && req.method === "POST") {   // 🧪 modo prueba (Webpay integración): abono confirmado con ref única (idempotente)
    if ((process.env.WEBPAY_ENV || "integracion") === "produccion") return json({ error: "Simulación no disponible en producción." }, 403);
    const inv = await invDe(req, store); if (!inv) return json({ error: "Inversionista no identificado." }, 401);
    const b = await cuerpo(req); const monto = Math.round(Number(b.monto) || 0); if (monto < 50) return json({ error: "Monto inválido." }, 400);
    const r = await movAgregar(store, inv.id, { tipo: "abono", monto, estado: "confirmado", ref: texto(b.ref, 40) || ("sim" + Date.now().toString(36)), origen: "simulado", nota: "Abono simulado (modo prueba)" });
    if (r.error) return json({ error: r.error }, 409);
    return json({ ok: true, repetido: r.repetido, mov: r.mov, resumen: resumenLibro(r.libro.movs) });
  }
  if (ruta === "inv-migrar" && req.method === "POST") {   // transición: saldo local y créditos wpcredito/<jugador> de la versión anterior → libro, como «por conciliar»
    const inv = await invDe(req, store); if (!inv) return json({ error: "Inversionista no identificado." }, 401);
    const b = await cuerpo(req); const jug = texto(b.jugador, 60); const out = [];
    if (jug) { const cr = (await store.get(`wpcredito/${jug}`, { type: "json" })) || { items: [] };
      for (const it of cr.items || []) { const reg = it.orden ? await store.get(`wp/${it.orden}`, { type: "json" }).catch(() => null) : null; const ok = reg && reg.estado === "pagada" && reg.jug === jug && !reg.inv_id;
        const r = await movAgregar(store, inv.id, { tipo: "abono", monto: Math.round(it.monto || 0), estado: ok ? "confirmado" : "por_conciliar", ref: it.orden || ("legacy" + it.t), origen: "webpay_legacy", nota: ok ? "Webpay (versión anterior) " + it.orden : "crédito local sin transacción respaldada" });
        if (!r.error) { out.push({ ref: r.mov.ref, estado: r.mov.estado, repetido: r.repetido }); if (ok && reg) { reg.inv_id = inv.id; reg.migrado = ahora(); await store.setJSON(`wp/${reg.orden}`, reg); } } }
      if ((cr.items || []).length) await store.setJSON(`wpcredito/${jug}`, { total: 0, items: [], migrado: ahora(), inv_id: inv.id }); }
    const local = Math.round(Number(b.saldo_local) || 0);
    if (local > 0) { const r = await movAgregar(store, inv.id, { tipo: "ajuste", monto: local, estado: "por_conciliar", ref: "saldo_local_" + (jug || inv.id), origen: "local", nota: "saldo guardado en el celular (versión anterior): sin respaldo de transacción" }); if (!r.error) out.push({ ref: r.mov.ref, estado: r.mov.estado, repetido: r.repetido }); }
    const { libro } = await leerLibro(store, inv.id); return json({ ok: true, migrados: out, resumen: resumenLibro(libro.movs) });
  }
  if (ruta === "inv-asignar" && req.method === "POST") {   // «Invertir desde mi saldo»: descuento del saldo + aporte en la OC, con id de solicitud (reintento sin duplicar)
    const inv = await invDe(req, store); if (!inv) return json({ error: "Inversionista no identificado." }, 401);
    const b = await cuerpo(req); const codigo = limpiaCodigo(b.codigo), monto = Math.round(Number(b.monto) || 0), solicitud = texto(b.solicitud, 40);
    if (!codigo || monto < 1000 || !solicitud) return json({ error: "Faltan datos (negocio, monto, solicitud)." }, 400);
    const t = await leer(store, codigo); const hab = ocHabilitada(t); if (hab) return json({ error: hab }, 409);
    const op = t.op; const yaMov = (op.aportes || []).find((a) => a.solicitud === solicitud);
    const X = { compras: Number(op.precio_acordado) || Number(op.informe?.compras) || 0 }; const capital = Math.round(X.compras * (op.param?.anticipo ?? 1));
    const aportado = (op.aportes || []).reduce((s2, a) => s2 + (Number(a.monto) || 0), 0), pendFin = Math.max(0, capital - aportado);
    const r = await movAgregar(store, inv.id, { tipo: "asignacion", monto, estado: "confirmado", ref: solicitud, oc: codigo, empresa: t.empresa || "principal", nota: "Aporte a " + (t.nombre || codigo), ganancia: op.inv_acuerdo?.tipo === "monto" ? Math.round(op.inv_acuerdo.v) : null,
      validar: (R2) => (yaMov ? null : monto > R2.disponible ? `Saldo insuficiente: disponible ${R2.disponible.toLocaleString("es-CL")}` : capital && monto > pendFin ? `El negocio solo necesita ${pendFin.toLocaleString("es-CL")} más de financiamiento` : null) });
    if (r.error) return json({ error: r.error }, 409);
    if (!yaMov && !(op.aportes || []).some((a) => a.mov_id === r.mov.id)) {   // proyección del movimiento en la OC (un solo origen: el libro)
      op.aportes = [...(op.aportes || []), { monto, fecha: ahora().slice(0, 10), t: ahora(), quien: inv.nombre, inv_id: inv.id, mov_id: r.mov.id, solicitud, origen: "saldo" }].slice(0, 40);
      op.transferido = true; op.inversionista_nombre = op.inversionista_nombre || inv.nombre; await escribir(store, t);
      await avisarTexto(store, "💼 Aporte de " + inv.nombre, `${inv.nombre} asignó $${monto.toLocaleString("es-CL")} a ${(t.nombre || codigo).slice(0, 50)}${pendFin - monto > 0 ? " · faltan $" + (pendFin - monto).toLocaleString("es-CL") : ""}`, "inv-" + codigo, "/#robot").catch(() => {});
    }
    return json({ ok: true, repetido: r.repetido || !!yaMov, mov: r.mov, resumen: resumenLibro(r.libro.movs), pendiente_financiar: Math.max(0, pendFin - (r.repetido || yaMov ? 0 : monto)), modo: r.modo });
  }
  if (ruta === "inv-devolucion-confirmar" && req.method === "POST") {   // el inversionista confirma que recibió su devolución: imputa primero a capital, luego a ganancia
    const inv = await invDe(req, store); if (!inv) return json({ error: "Inversionista no identificado." }, 401);
    const b = await cuerpo(req); const movId = texto(b.mov_id, 40); if (!movId) return json({ error: "Falta el movimiento." }, 400);
    const { libro } = await leerLibro(store, inv.id); const m = libro.movs.find((x) => x.id === movId); if (!m || m.tipo !== "devolucion") return json({ error: "Devolución no encontrada." }, 404);
    const R2 = resumenLibro(libro.movs); const o = R2.porOC[m.oc] || { capital_pendiente: 0, ganancia_pendiente: 0 };
    const cap = Math.min(m.monto, o.capital_pendiente), gan = Math.min(m.monto - cap, o.ganancia_pendiente);
    const r = await movActualizar(store, inv.id, movId, { estado: "confirmado", imputado_capital: cap, imputado_ganancia: gan, imputado_extra: m.monto - cap - gan });
    if (r.error) return json({ error: r.error }, 409);
    const t = m.oc ? await leer(store, m.oc).catch(() => null) : null;
    if (t?.op) { const d = (t.op.devoluciones || []).find((x) => x.mov_id === movId); if (d) { d.confirmado = true; d.t_confirmado = ahora(); await escribir(store, t); } }
    return json({ ok: true, repetido: r.repetido, mov: r.mov, resumen: resumenLibro(r.libro.movs) });
  }

  if (ruta === "simular-oc" && req.method === "POST") {   // 🔵 trabajo de simulación por fases para una OC
    const b = await cuerpo(req); const t = await leer(store, limpiaCodigo(b.codigo)); if (!t) return json({ error: "No existe." }, 404);
    t.op = t.op || { etapa: "ganada", historial: [] }; const op = t.op; const fase = String(b.fase || "req");
    if (b.req_texto) { op.req_adjunto = { texto: String(b.req_texto).slice(0, 40000), nombre: texto(b.req_nombre, 120) || "requerimiento adjuntado", t: ahora() }; op.simulacion_tmp = null; }
    try {
      if (fase === "req" || !op.simulacion_tmp || b.forzar) { const r = await simRequerimiento(store, t, b); op.simulacion_tmp = { t: ahora(), req: r, partidas: null, i: 0 }; await escribir(store, t);
        return json({ ok: true, fase: "req", siguiente: r.falta_adjunto && !b.continuar_sin_adjunto ? "falta_adjunto" : "partidas", req: { fuentes: r.fuentes, falta_adjunto: r.falta_adjunto, adjuntos_nombres: r.adjuntos_nombres, motivo: r.motivo, version: r.version, largo: r.texto.length } }); }
      const T = op.simulacion_tmp;
      if (fase === "partidas") { const j = await simPartidas(t, T.req); T.plan = j; T.partidas = j.partidas; T.i = 0; await escribir(store, t); return json({ ok: true, fase: "partidas", n: j.partidas.length, siguiente: j.partidas.length ? "costeo" : "listo", resumen: j.resumen, alcance: j.alcance, integral: j.integral, faltan: j.faltan }); }
      if (fase === "costeo") { const P = T.partidas || []; const pend = P.findIndex((pa) => !pa.costeada); if (pend >= 0) { await simCostearPartida(store, t, P[pend]); T.i = pend + 1; await escribir(store, t); return json({ ok: true, fase: "costeo", hecha: P[pend].nombre, faltan: P.filter((pa) => !pa.costeada).length, siguiente: P.some((pa) => !pa.costeada) ? "costeo" : "listo" }); } }
      // listo: guardar el resultado con fecha, fuentes y versión del requerimiento; alimentar Excel en vivo (informe.compras) si estaba vacío
      const tot = simTotales(t, T); const plan = T.plan || {};
      op.simulacion = { t: ahora(), version_req: T.req.version, requerimiento: { fuentes: T.req.fuentes, falta_adjunto: T.req.falta_adjunto, adjuntos_nombres: T.req.adjuntos_nombres, motivo: T.req.motivo }, resumen: plan.resumen || "", alcance: plan.alcance || null, integral: plan.integral || null, faltan: [...(plan.faltan || []), ...tot.criticas.map((n) => "costear: " + n)], partidas: T.partidas || [], totales: tot,
        explicacion: tot.estado === "completo" ? `Subtotal neto ${tot.subtotal_neto.toLocaleString("es-CL")} = suma de ${tot.partidas_costeadas} partidas (cantidad u horas × tarifa o precio de referencia); IVA ${tot.iva.toLocaleString("es-CL")}; flete incluido ${tot.flete.toLocaleString("es-CL")}.` : tot.estado === "parcial" ? `Subtotal sustentado ${tot.subtotal_neto.toLocaleString("es-CL")} neto con ${tot.partidas_costeadas}/${tot.partidas} partidas; falta costear partida(s) crítica(s): ${tot.criticas.join(", ")}.` : "Sin partidas: falta el requerimiento." };
      op.simulacion_tmp = null;
      if (tot.estado === "completo") { op.informe = op.informe || {}; if (!op.precio_acordado && !(Number(op.informe.compras) > 0 && op.informe.compras_fuente !== "simulacion")) { op.informe.compras = tot.total_con_iva; op.informe.compras_fuente = "simulacion"; op.informe.t_sim = ahora(); } }
      await escribir(store, t); return json({ ok: true, fase: "listo", simulacion: op.simulacion });
    } catch (e) { return json({ error: "Simulación interrumpida en «" + fase + "»: " + String(e.message || e).slice(0, 140), fase }, 502); }
  }
  if (ruta === "anexos-pendientes" && req.method === "GET") {   // el robot del PC consulta qué compras necesitan que suba sus adjuntos (anexos_pedido)
    const lista = (await todos(store)).filter((t) => t.anexos_pedido && !t.anexos_subido).slice(0, 20).map((t) => ({ codigo: t.codigo, oc: t.op?.oc_codigo || null, motivo: t.anexos_pedido.motivo, t: t.anexos_pedido.t }));
    return json({ pendientes: lista });
  }

  if (ruta === "terreno" && req.method === "POST") { const b = await cuerpo(req); const t = await leer(store, limpiaCodigo(b.codigo)); if (!t) return json({ error: "No existe." }, 404); const r = await terrenoAccion(store, t, b); return json(r, r.error ? (r.ya_tomado ? 409 : 400) : 200); }
  if (ruta === "viajes" && req.method === "GET") { const { blobs } = await store.list({ prefix: "viajes/" }); const L = []; for (const bl of blobs) { if (/\/tomado$/.test(bl.key)) continue; const v = await store.get(bl.key, { type: "json" }).catch(() => null); if (v) { const tom = await store.get(bl.key + "/tomado", { type: "json" }).catch(() => null); L.push({ ...v, tomado: tom ? tom.por?.nombre : null }); } } return json({ viajes: L.filter((v) => !v.tomado) }); }
  if (ruta === "factorings" && req.method === "GET") { const emp = texto(url.searchParams.get("empresa"), 40) || "principal"; return json({ factorings: (await store.get("factorings/" + emp, { type: "json" })) || [] }); }
  if (ruta === "factorings" && req.method === "POST") { const b = await cuerpo(req); const emp = texto(b.empresa, 40) || "principal"; const L = (Array.isArray(b.factorings) ? b.factorings : []).slice(0, 12).map((f) => ({ nombre: texto(f.nombre, 60), ejecutivo: texto(f.ejecutivo, 60), telefono: texto(f.telefono, 30), email: texto(f.email, 120) })).filter((f) => f.nombre); await store.setJSON("factorings/" + emp, L); return json({ ok: true, factorings: L }); }
  if (ruta === "doc-borrador" && req.method === "POST") {   // 🧾 borrador de guía/factura con todo lo que ya sabe la OC
    const b = await cuerpo(req); const t = await leer(store, limpiaCodigo(b.codigo)); if (!t) return json({ error: "No existe." }, 404);
    const L = (await store.get("empresas/lista", { type: "json" })) || {}; const emp = L[t.empresa || "principal"] || L.principal || null;
    const doc = docBorrador(t, emp, b); t.op = t.op || { etapa: "ganada", historial: [] }; t.op.documentos = (t.op.documentos || []).filter((d) => !(d.tipo === doc.tipo && d.estado === "borrador")); t.op.documentos.push(doc); await escribir(store, t);
    return json({ ok: true, doc });
  }
  if (ruta === "doc-importar" && req.method === "POST") {   // XML emitido por el SII (o folio a mano con PDF subido): queda vinculado a la OC una sola vez
    const b = await cuerpo(req); const t = await leer(store, limpiaCodigo(b.codigo)); if (!t) return json({ error: "No existe." }, 404); t.op = t.op || { etapa: "ganada", historial: [] };
    let doc = null;
    if (b.xml) { const d = parseDTE(String(b.xml).slice(0, 400000)); if (!d) return json({ error: "El XML no es una guía (52) ni una factura (33/34)." }, 400);
      const borr = (t.op.documentos || []).find((x) => x.tipo === d.tipo && x.estado === "borrador");
      doc = { id: "d" + Date.now().toString(36), ...d, estado: "emitido", origen: "importado", lineas: d.lineas.length ? d.lineas.map((l, k) => ({ ...l, lid: borr?.lineas?.[k]?.lid || "L" + (k + 1) })) : borr?.lineas || [], despacho: borr?.despacho || null, t: ahora() }; }
    else { const tipo = b.tipo === "factura" ? "factura" : "guia"; const folio = texto(b.folio, 20); if (!folio) return json({ error: "Falta el folio." }, 400);
      const borr = (t.op.documentos || []).find((x) => x.tipo === tipo && x.estado === "borrador");
      doc = { ...(borr || docBorrador(t, null, { tipo })), id: "d" + Date.now().toString(36), folio, fecha: texto(b.fecha, 10) || ahora().slice(0, 10), estado: "emitido", origen: "importado", archivo: texto(b.archivo, 40) || null, neto: Math.round(Number(b.neto) || borr?.neto || 0), iva: Math.round(Number(b.iva) || borr?.iva || 0), total: Math.round(Number(b.total) || borr?.total || 0), t: ahora() }; }
    // la factura emitida desde la guía lleva ambas referencias
    if (doc.tipo === "factura" && !(doc.referencias || []).some((r) => r.tipo === "GD")) { const g = (t.op.documentos || []).filter((x) => x.tipo === "guia" && x.estado !== "borrador").slice(-1)[0]; if (g) doc.referencias = [...(doc.referencias || []), { tipo: "GD", folio: g.folio, fecha: g.fecha }]; }
    if (!(doc.referencias || []).some((r) => r.tipo === "OC") && (t.op.oc_codigo || t.op.oc)) doc.referencias = [...(doc.referencias || []), { tipo: "OC", folio: t.op.oc_codigo || t.op.oc, fecha: (t.oc_compra?.enviada || "").slice(0, 10) || null }];
    const r = docAgregar(t.op, doc); docSincronizar(t); await escribir(store, t);
    return json({ ok: true, repetido: r.repetido, doc: r.doc, documentos: t.op.documentos });
  }
  if (ruta === "doc-estado" && req.method === "POST") {   // Guía firmada por quien recibe · Recepción conforme · Factura cobrada
    const b = await cuerpo(req); const t = await leer(store, limpiaCodigo(b.codigo)); if (!t?.op) return json({ error: "No existe." }, 404);
    const d = (t.op.documentos || []).find((x) => x.id === b.id); if (!d) return json({ error: "Documento no encontrado." }, 404);
    if (["firmada_receptor", "recepcion_conforme", "cobrada", "emitido"].includes(b.estado)) d.estado = b.estado; if (b.archivo) d.archivo = texto(b.archivo, 40);
    if (b.estado === "recepcion_conforme") { t.op.guia_firmada = true; t.op.despacho_ok = true; } if (b.estado === "cobrada") t.op.factura_firmada = true;
    docSincronizar(t); await escribir(store, t); return json({ ok: true, doc: d });
  }
  // ---------- celular ----------
  if (ruta === "estado" && req.method === "GET") {
    const robot = (await store.get("robot/latido", { type: "json" })) || null;
    const lista = await todos(store);
    const mpl = (await store.get("mp/latido", { type: "json" })) || null;
    const ligero = url.searchParams.get("ligero") === "1";      // el celular: sin el detalle pesado de las ya enviadas
    const hecha = (t) => t.estado === "enviada" || t.estado === "confirmada";
    const cuerpoE = {
      robot: robot && { ...robot, conectado: Date.now() - Date.parse(robot.visto) < ROBOT_INACTIVO_MS },
      mp: mpl && { ...mpl, conectado: !!mpl.logueado && Date.now() - Date.parse(mpl.visto) < MP_INACTIVO_MS },
      // las 60 más recientes + todas las enviadas (para las cajas «Enviadas» y «Ganadas»)
      trabajos: [...lista.slice(0, 60), ...lista.slice(60).filter(hecha).slice(0, 300)]
        .map(({ historial, ...t }) => ligero && hecha(t)
          ? (({ items, detalle, firma, envios, ...r }) => ({ ...r, historial: (historial || []).slice(-2) }))(t)
          : { ...t, historial: (historial || []).slice(-6) }),
    };
    // si nada cambió desde la última consulta, responde 304 sin cuerpo (el celular no repinta nada)
    const firma = createHash("sha1").update(JSON.stringify({ ...cuerpoE, robot: robot && { ...robot, visto: undefined, conectado: cuerpoE.robot.conectado },
      mp: mpl && { ...mpl, visto: undefined, conectado: cuerpoE.mp.conectado } })).digest("base64url").slice(0, 20);
    if (ligero && req.headers.get("x-ya-tengo") === firma) return new Response(null, { status: 204, headers: { "x-version": firma, "cache-control": "no-store" } });
    const r = json(cuerpoE); r.headers.set("x-version", firma); return r;
  }

  // ---------- oportunidades (el robot sube el ranking; la app lo muestra) ----------
  if (ruta === "oportunidades" && req.method === "POST") {
    const b = await cuerpo(req);
    const lista = Array.isArray(b.lista) ? b.lista.slice(0, 1200) : [];
    await store.setJSON("oportunidades/lista", { fecha: texto(b.fecha, 40) || ahora(), excel: texto(b.excel, 80), resumen: b.resumen || null, lista });
    // 🔔 ¿cambió algo en una compra guardada mientras se cotiza? (cierre, presupuesto): se marca para revisar y se avisa
    try {
      const porCod = new Map(lista.map((x) => [limpiaCodigo(x.codigo), x]));
      const { blobs } = await store.list({ prefix: "oportunidades/seleccionadas" });
      const t0 = ahora(); let avisos = 0;
      for (const bl of blobs) {
        const sel = (await store.get(bl.key, { type: "json" })) || {}; let tocado = false;
        for (const [cod, x] of Object.entries(sel)) {
          const nuevo = porCod.get(cod); if (!nuevo) continue;
          const vistoC = x.verificado?.cierre ?? x.cierre ?? null, vistoM = x.verificado?.monto ?? x.monto ?? null;
          const nC = texto(nuevo.cierre, 40) || null, nM = nuevo.monto != null ? Math.round(Number(nuevo.monto) || 0) : null;
          const cambios = [];
          if (nC && vistoC && nC !== vistoC) cambios.push({ campo: "cierre", antes: vistoC, despues: nC, t: t0 });
          if (nM != null && vistoM != null && nM !== vistoM) cambios.push({ campo: "presupuesto", antes: vistoM, despues: nM, t: t0 });
          if (nuevo.llamado && /segundo|2/.test(String(nuevo.llamado).toLowerCase()) && !x.seg) { x.seg = true; cambios.push({ campo: "llamado", antes: "1°", despues: "2° llamado", t: t0 }); }
          if (!cambios.length) { x.ultima_verificacion = t0; tocado = true; continue; }
          x.cambios = [...(x.cambios || []), ...cambios].slice(-12); x.revisar = true; x.ultima_verificacion = t0;
          x.cierre = nC || x.cierre; if (nM != null) x.monto = nM;
          x.verificado = { cierre: nC || vistoC, monto: nM ?? vistoM, t: t0 }; tocado = true;
          if (avisos < 6) { avisos++;
            const det = cambios.map((c) => c.campo === "cierre" ? `cierre ${String(c.antes).slice(5, 16).replace("T", " ")} → ${String(c.despues).slice(5, 16).replace("T", " ")}` : c.campo === "presupuesto" ? `presupuesto $${Number(c.antes).toLocaleString("es-CL")} → $${Number(c.despues).toLocaleString("es-CL")}` : "pasó a 2° llamado").join(" · ");
            await avisarTexto(store, `⚠ Cambió ${cod}${x.responsable ? " · " + x.responsable : ""}`, `${(x.nombre || "").slice(0, 60)}: ${det}. Revisa antes de aprobar; tu borrador se conserva.`, "cambio-" + cod, "/#robot=" + cod, true).catch(() => {});
          }
        }
        if (tocado) await store.setJSON(bl.key, sel);
      }
    } catch (e) { console.log("cambios guardadas:", String(e).slice(0, 120)); }
    return json({ ok: true, n: lista.length });
  }
  // ☁️ Compras Ágiles directo desde la API oficial de Mercado Público (ticket en Netlify: CA_TICKET o MP_TICKET).
  // Así la app muestra oportunidades aunque el robot del PC esté apagado o su intermediario (RadarPúblico) caído.
  if (ruta === "oportunidades" && req.method === "GET") {
    let o = (await store.get("oportunidades/lista", { type: "json" })) || { lista: [] };
    try {
      const ca = (o.lista || []).filter((x) => x.fuente !== "licitacion");
      const vivasRobot = ca.filter((x) => x.cierre && Date.parse(x.cierre) > Date.now()).length;
      const edadMin = o.fecha ? (Date.now() - Date.parse(o.fecha)) / 60000 : 1e9;
      const tk = process.env.CA_TICKET || process.env.MP_TICKET || ((await store.get("config/ticket_api", { type: "json" })) || {}).ticket;
      const lento = url.searchParams.get("refrescar") === "1";   // ⚡ el ciclo lento de la API oficial solo cuando la app lo pide en segundo plano
      if ((vivasRobot < 20 || edadMin > 150) && tk && lento) {
        const of = await caOficial(store, tk);
        if (of && of.lista.length) {
          const vistos = new Set(of.lista.map((x) => x.codigo));
          const lic = (o.lista || []).filter((x) => x.fuente === "licitacion");
          const resto = ca.filter((x) => !vistos.has(x.codigo) && x.cierre && Date.parse(x.cierre) > Date.now());
          o = { ...o, fecha: of.fecha, origen: "api_oficial", lista: [...of.lista, ...resto, ...lic] };
        }
      }
    } catch (e) { console.log("CA oficial:", String(e).slice(0, 160)); o.oficial_error = String(e).slice(0, 160); }
    try {
      const tk2 = process.env.CA_TICKET || process.env.MP_TICKET || ((await store.get("config/ticket_api", { type: "json" })) || {}).ticket;
      const est = (await store.get("oportunidades/ca_oficial", { type: "json" }).catch(() => null)) || {};
      o.oficial = { ticket: !!tk2, fecha: est.fecha || null, n: (est.lista || []).length, ciclo: est.ciclo ? { region: est.ciclo.region, siguiente: est.ciclo.siguiente, total: est.ciclo.total, completo: est.ciclo.completo, errores: est.ciclo.errores, ultimo_error: est.ciclo.ultimo_error || null, tam: est.ciclo.tam } : null, error: o.oficial_error || null };
    } catch (_) {}
    o.descartes = await leerCajon(store, "oportunidades/descartes", jug(url.searchParams.get("jugador")), url.searchParams.get("legado") === "1");
    return json(o);
  }
  // «No deseadas» (deslizar a la izquierda): se guardan para todos tus dispositivos y el robot no las prepara
  if (ruta === "oport-descartes" && req.method === "GET") {
    return json({ descartes: await leerCajon(store, "oportunidades/descartes", jug(url.searchParams.get("jugador")), url.searchParams.get("legado") === "1") });
  }
  if (ruta === "oport-descartar" && req.method === "POST") {
    const b = await cuerpo(req);
    const codigo = limpiaCodigo(b.codigo);
    if (!/^\d{1,8}-\d{1,8}-[A-Z0-9]{3,6}$/.test(codigo)) return json({ error: "Código inválido" }, 400);
    const clave = cajon("oportunidades/descartes", jug(b.jugador));
    const d = (await store.get(clave, { type: "json" })) || {};
    if (b.descartar === false) delete d[codigo]; else d[codigo] = ahora();
    const claves = Object.keys(d);
    if (claves.length > 3000) for (const k of claves.sort((a, b) => d[a].localeCompare(d[b])).slice(0, claves.length - 3000)) delete d[k];
    await store.setJSON(clave, d);
    if (b.descartar === false && b.legado && jug(b.jugador)) {
      const L = (await store.get("oportunidades/descartes", { type: "json" })) || {};
      if (L[codigo]) { delete L[codigo]; await store.setJSON("oportunidades/descartes", L); }
    }
    return json({ ok: true, n: Object.keys(d).length });
  }
  if (ruta === "oportunidades-actualizar" && req.method === "POST") {
    await store.setJSON("oportunidades/pedido", { t: Date.now() });
    return json({ ok: true });
  }

  // ---------- ⭐ Seleccionadas (compartidas entre tus celulares) ----------
  if (ruta === "seleccionadas" && req.method === "GET") {
    if (url.searchParams.get("todos") === "1") {          // el PC ve las elegidas de todos los celulares (costo de mercado, panel)
      const todas = { ...((await store.get("oportunidades/seleccionadas", { type: "json" })) || {}) };
      const { blobs } = await store.list({ prefix: "oportunidades/seleccionadas/j/" });
      for (const bl of blobs.slice(0, 40)) Object.assign(todas, (await store.get(bl.key, { type: "json" })) || {});
      return json({ sel: todas });
    }
    return json({ sel: await leerCajon(store, "oportunidades/seleccionadas", jug(url.searchParams.get("jugador")), url.searchParams.get("legado") === "1") });
  }
  if (ruta === "seleccionar" && req.method === "POST") {
    const b = await cuerpo(req);
    const codigo = limpiaCodigo(b.codigo);
    if (!/^\d{1,8}-\d{1,8}-(COT|LE|LP|LQ|LR|LS|L1|R1|CO)\d{2}$/i.test(codigo)) return json({ error: "Código inválido" }, 400);
    const claveS = cajon("oportunidades/seleccionadas", jug(b.jugador));
    const s = (await store.get(claveS, { type: "json" })) || {};
    if (b.quitar) delete s[codigo];
    else {
      const prev = s[codigo] || { desde: ahora() };
      const num = (v) => (v == null || v === "" ? undefined : Math.max(0, Math.round(Number(v) || 0)));
      s[codigo] = { ...prev, nombre: texto(b.nombre, 200) ?? prev.nombre, organismo: texto(b.organismo, 120) ?? prev.organismo,
        monto: num(b.monto) ?? prev.monto, cierre: texto(b.cierre, 40) ?? prev.cierre, margen: b.margen != null ? Number(b.margen) || 0 : prev.margen,
        precio: num(b.precio) ?? prev.precio, costo: b.costo === null ? undefined : num(b.costo) ?? prev.costo, empresa: texto(b.empresa, 40) ?? prev.empresa, actualizado: ahora(),
        // 📋 borrador de trabajo: quién lo lleva, flete y plazo ofrecido; y qué vimos en MP al guardarlo (para detectar cambios)
        responsable: b.responsable !== undefined ? (texto(b.responsable, 60) || undefined) : prev.responsable,
        flete: b.flete === null ? undefined : num(b.flete) ?? prev.flete,
        plazo: b.plazo !== undefined ? (texto(b.plazo, 80) || undefined) : prev.plazo,
        nota: b.nota !== undefined ? (texto(b.nota, 300) || undefined) : prev.nota,
        decision: b.decision !== undefined ? (["si", "no", "despues"].includes(b.decision) ? b.decision : undefined) : prev.decision,   // 📑 licitador: vamos / no / después
        verificado: prev.verificado || { cierre: texto(b.cierre, 40) || null, monto: num(b.monto) ?? null, t: ahora() },
        cambios: prev.cambios || [], revisar: b.revisado ? false : (prev.revisar || false), jugador: prev.jugador || jug(b.jugador) || null };
      if (b.revisado) { s[codigo].verificado = { cierre: s[codigo].cierre || null, monto: s[codigo].monto ?? null, t: ahora() }; }
    }
    await store.setJSON(claveS, s);
    if (b.quitar && b.legado && jug(b.jugador)) {            // las antiguas (antes de separar los juegos) también se sueltan
      const L = (await store.get("oportunidades/seleccionadas", { type: "json" })) || {};
      if (L[codigo]) { delete L[codigo]; await store.setJSON("oportunidades/seleccionadas", L); }
    }
    return json({ ok: true, sel: b.legado ? await leerCajon(store, "oportunidades/seleccionadas", jug(b.jugador), true) : s });
  }

  // ---------- 📨 seguimiento en vivo de las enviadas (estado en Mercado Público, ganador y orden de compra) ----------
  // ---------- 📧 correos reales (los envía y lee el PC con el Gmail de la empresa) ----------
  if (ruta === "correo-enviar" && req.method === "POST") {
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    const lista = (Array.isArray(b.lista) ? b.lista : [b]).filter((x) => /@/.test(String(x.to || ""))).slice(0, 8);
    if (!lista.length) return json({ error: "Falta el correo del destinatario." }, 400);
    const robot = (await store.get("robot/latido", { type: "json" })) || {};
    const cola = (await store.get("correo/cola", { type: "json" })) || [];
    const op = t.op || (t.op = { etapa: "previa", historial: [] });
    for (const x of lista) {
      const id = idCorto();
      cola.push({ id, codigo: t.codigo, to: texto(x.to, 160), asunto: texto(x.asunto, 200), cuerpo: texto(x.cuerpo, 6000), k: texto(x.k, 80), nombre: texto(x.nombre, 120),
        tipo: texto(x.tipo, 30) || "cotizacion", adjunto_doc: x.adjunto_doc && typeof x.adjunto_doc === "object" ? { id: texto(x.adjunto_doc.id, 40), nombre: texto(x.adjunto_doc.nombre, 120), mime: texto(x.adjunto_doc.mime, 60) } : null,
        responder_a: texto(x.responder_a, 300), creado: ahora() });
      if (x.k) op.contactados = { ...(op.contactados || {}), [texto(x.k, 80)]: { via: "correo", t: ahora(), nombre: texto(x.nombre, 120), estado: "en_cola", tipo: texto(x.tipo, 30) || "cotizacion" } };
      if (x.k && (texto(x.tipo, 30) || "cotizacion") === "cotizacion") op.cuerpos = { ...(op.cuerpos || {}), [texto(x.k, 80)]: { asunto: texto(x.asunto, 200), cuerpo: texto(x.cuerpo, 3000), to: texto(x.to, 160) } };
    }
    await store.setJSON("correo/cola", cola.slice(-200));
    await escribir(store, t);
    const vivo = robot.visto && Date.now() - Date.parse(robot.visto) < ROBOT_INACTIVO_MS;
    return json({ ok: true, en_cola: lista.length, pc: !!(vivo && robot.correo), trabajo: t });
  }
  if (ruta === "correo-hecho" && req.method === "POST") {
    const b = await cuerpo(req);
    const cola = (await store.get("correo/cola", { type: "json" })) || [];
    const x = cola.find((c) => c.id === b.id);
    if (!x) return json({ ok: true });
    await store.setJSON("correo/cola", cola.filter((c) => c.id !== b.id));
    const t = await leer(store, x.codigo);
    if (t) {
      const op = t.op || (t.op = { etapa: "previa", historial: [] });
      op.correos = [...(op.correos || []), { k: x.k, to: x.to, asunto: x.asunto, tipo: x.tipo, t: ahora(), mid: texto(b.message_id, 300), ok: !!b.ok, error: texto(b.error, 200) }].slice(-60);
      if (x.k) op.contactados = { ...(op.contactados || {}), [x.k]: { ...((op.contactados || {})[x.k] || {}), via: "correo", t: ahora(), estado: b.ok ? "enviado" : "error", error: texto(b.error, 200) } };
      await escribir(store, t);
      if (!b.ok) await avisarTexto(store, "⚠ No se envió un correo · " + x.codigo, `${x.to}: ${texto(b.error, 120)}`, "cerr-" + x.id, "/#robot").catch(() => {});
    }
    return json({ ok: true });
  }
  if (ruta === "correo-entrante" && req.method === "POST") {
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ ok: false });
    const a = b.analisis && typeof b.analisis === "object" ? b.analisis : {};
    const op = t.op || (t.op = { etapa: "previa", historial: [] });
    if (b.rebote) {        // 📛 el correo rebotó → se le pide el correo por WhatsApp y de paso se le cotiza por ahí
      const k = texto(b.k, 80), mail = texto(b.email, 160) || "";
      if (!k) return json({ ok: true, sin_k: true });
      if ((op.rebotes || []).some((x) => x.k === k && x.email === mail)) return json({ ok: true, repetido: true });
      op.rebotes = [...(op.rebotes || []), { k, email: mail, t: ahora() }].slice(-20);
      const cont = (op.contactados || {})[k] || {};
      op.contactados = { ...(op.contactados || {}), [k]: { ...cont, via: "correo", estado: "rebotó", error: "el correo " + mail + " rebotó", t: ahora() } };
      const inf = op.informe || {};
      const o = [...(inf.opciones || []), ...(op.extras || [])].find((x) => x.proveedor && kProvS(x.proveedor) === k) || {};
      const nombre = o.proveedor || cont.nombre || "";
      const c = chatDe(op, k, { canal: "wa", nombre, tel: o.telefono || "", motivo: "rebote" });
      const ctx = contextoChat(t, k);
      const txt = `Hola${o.contacto ? " " + o.contacto : ""}, le escribo de ${EMPRESA()}. Le enviamos una solicitud de cotización a ${mail || "su correo"} pero nos rebotó. ¿Nos podría indicar un correo vigente? Y de paso, ¿nos puede cotizar por aquí?${ctx.que || t.nombre ? " Necesitamos: " + (ctx.que || t.nombre) + "." : ""}${ctx.lugar ? " Entrega en " + ctx.lugar + "." : ""} Precio total con IVA, plazo y si despacha. ¡Muchas gracias!`;
      let m = null;
      if (c.tel) m = await chatMandar(store, t.codigo, k, c, txt, true);
      if (!m || !m.enviado) c.sugerido = txt;
      await escribir(store, t);
      await avisarTexto(store, "📛 Rebotó el correo de " + String(nombre || mail).slice(0, 40),
        m?.enviado ? `${t.codigo} · ya le escribí por WhatsApp pidiendo su correo y el precio.` : c.tel ? `${t.codigo} · toca para pedírselo por WhatsApp (mensaje listo).` : `${t.codigo} · no tiene teléfono: búscalo o agrega otro proveedor.`,
        "rebote-" + t.codigo + "-" + k, "/#robot", true).catch(() => {});
      return json({ ok: true, rebote: true, whatsapp: !!m?.enviado });
    }
    const r = { id: idCorto(), t: ahora(), k: texto(b.k, 80), quien: texto(b.quien, 20), de: texto(b.de, 160), de_nombre: texto(b.de_nombre, 120), asunto: texto(b.asunto, 200),
      texto: texto(b.texto, 1500), resumen: texto(a.resumen, 300), tipo: texto(a.tipo, 30), precio: Math.max(0, Math.round(Number(a.precio_total_con_iva) || 0)) || null,
      incluye_iva: a.incluye_iva !== false, plazo: texto(a.plazo, 120), stock: texto(a.stock, 120), despacha: a.despacha ?? null, costo_despacho: Math.round(Number(a.costo_despacho) || 0) || null,
      cuenta: a.cuenta && typeof a.cuenta === "object" && (a.cuenta.numero || a.cuenta.banco) ? Object.fromEntries(["banco", "tipo", "numero", "rut", "titular", "email"].map((k) => [k, texto(a.cuenta[k], 80)])) : null,
      pide: texto(a.pide, 300), message_id: texto(b.message_id, 300), visto: false };
    if (op.respuestas?.some((x) => x.message_id && x.message_id === r.message_id)) return json({ ok: true, repetido: true });
    op.respuestas = [...(op.respuestas || []), r].slice(-40);
    const nombre = r.de_nombre || r.de;
    if (r.k) {
      op.contactados = { ...(op.contactados || {}), [r.k]: { ...((op.contactados || {})[r.k] || {}), respondio: r.t, nombre: (op.contactados || {})[r.k]?.nombre || nombre } };
      if (r.precio) { const v = r.incluye_iva ? r.precio : Math.round(r.precio * 1.19); op.cotizaciones = { ...(op.cotizaciones || {}), [r.k]: { v, nombre: (op.contactados || {})[r.k]?.nombre || nombre, t: ahora(), auto: true } }; }
    }
    if (r.cuenta && !op.banco_proveedor && (!op.proveedor || r.k === (op.proveedor_k || ""))) op.banco_proveedor = [r.cuenta.banco, r.cuenta.tipo, r.cuenta.numero, r.cuenta.rut && "RUT " + r.cuenta.rut, r.cuenta.titular, r.cuenta.email].filter(Boolean).join(" · ");
    await escribir(store, t);
    const al = (await store.get("correo/alertas", { type: "json" })) || [];
    al.unshift({ id: r.id, codigo: t.codigo, t: r.t, quien: r.quien, de: nombre, resumen: r.resumen || r.asunto, precio: r.precio, visto: false });
    await store.setJSON("correo/alertas", al.slice(0, 60));
    const tit = r.quien === "proveedor" ? "📩 Respondió " + String(nombre).slice(0, 40) : "📨 Te escriben por " + t.codigo;
    await avisarTexto(store, tit, `${t.codigo} · ${(r.resumen || r.asunto || "").slice(0, 120)}${r.precio ? " · $" + r.precio.toLocaleString("es-CL") : ""}`, "mail-" + r.id, "/#robot", true).catch(() => {});
    return json({ ok: true });
  }
  // 💬 conversación con un proveedor por WhatsApp / Marketplace (la app pega lo que respondió; la IA del PC contesta)
  if (ruta === "chat" && req.method === "POST") {
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    const k = texto(b.k, 80) || kProvS(b.nombre); if (!k) return json({ error: "Falta el proveedor." }, 400);
    const op = t.op || (t.op = { etapa: "previa", historial: [] });
    const c = chatDe(op, k, { canal: texto(b.canal, 10), nombre: texto(b.nombre, 120), tel: texto(b.tel, 40), link: texto(b.link, 300) });
    if (b.auto !== undefined) c.auto = !!b.auto;
    if (c.canal === "mk" && c.nombre && !(op.extras || []).some((x) => kProvS(x.proveedor) === k))
      op.extras = [...(op.extras || []), { proveedor: c.nombre, telefono: c.tel || "", email: "", fuente: "marketplace", link: c.link || "" }].slice(-8);
    let m = null;
    if (b.saliente) { m = await chatMandar(store, t.codigo, k, c, b.saliente, !!b.ia);
      if (!m.enviado && b.manual) m.enviado = true;               // lo envió la persona con el botón (copiar / WhatsApp / Messenger)
      op.contactados = { ...(op.contactados || {}), [k]: { ...((op.contactados || {})[k] || {}), via: c.canal === "mk" ? "marketplace" : "whatsapp", t: ahora(), nombre: c.nombre } }; }
    if (b.entrante) { c.msgs = [...(c.msgs || []), { de: "el", txt: texto(b.entrante, 3000), t: ahora() }].slice(-40); c.ult_entrante = ahora(); c.pendiente = true; c.sugerido = null; await chatEncolar(store, t.codigo, k); }
    if (b.borrar_sugerido) c.sugerido = null;
    const r = await escribir(store, t);
    return json({ ok: true, enviado: !!m?.enviado, wa: !!WA(), trabajo: r });
  }
  if (ruta === "chat-ia" && req.method === "POST") {          // el PC devuelve lo que entendió y qué contestar
    const b = await cuerpo(req);
    const q = (await store.get("chat/cola", { type: "json" })) || [];
    await store.setJSON("chat/cola", q.filter((x) => !(x.codigo === b.codigo && x.k === b.k)));
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ ok: false });
    const { c, r, enviado, mail } = await chatAplicar(store, t, texto(b.k, 80), b.analisis && typeof b.analisis === "object" ? b.analisis : {});
    await escribir(store, t);
    const al = (await store.get("correo/alertas", { type: "json" })) || [];
    al.unshift({ id: r.id, codigo: t.codigo, t: r.t, quien: "proveedor", de: c.nombre || c.tel, resumen: (c.canal === "wa" ? "💬 " : "🛒 ") + (r.resumen || "respondió"), precio: r.precio, visto: false });
    await store.setJSON("correo/alertas", al.slice(0, 60));
    await avisarTexto(store, (c.canal === "wa" ? "💬 " : "🛒 ") + "Respondió " + String(c.nombre || c.tel || "proveedor").slice(0, 40),
      `${t.codigo} · ${(r.resumen || "").slice(0, 100)}${r.precio ? " · $" + r.precio.toLocaleString("es-CL") : ""}${mail ? " · 📧 rescaté su correo" : ""}${enviado?.enviado ? " · 🤖 ya le contesté" : c.sugerido ? " · respuesta lista para enviar" : ""}`,
      "chat-" + t.codigo + "-" + b.k, "/#robot", !!r.precio).catch(() => {});
    return json({ ok: true });
  }
  if (ruta === "correo-alertas" && req.method === "GET") {
    const robot = (await store.get("robot/latido", { type: "json" })) || {};
    return json({ alertas: (await store.get("correo/alertas", { type: "json" })) || [], correo_pc: !!robot.correo, wa: !!WA(), cola: ((await store.get("correo/cola", { type: "json" })) || []).length });
  }
  if (ruta === "correo-visto" && req.method === "POST") {
    const b = await cuerpo(req);
    const al = (await store.get("correo/alertas", { type: "json" })) || [];
    for (const x of al) if (!b.codigo || x.codigo === b.codigo) x.visto = true;
    await store.setJSON("correo/alertas", al);
    return json({ ok: true });
  }
  if (ruta === "ocs" && req.method === "GET") return json(await revisarOCs(store, url.searchParams.get("forzar") === "1"));
  if (ruta === "seguimiento" && req.method === "GET") {
    const { res, miRut } = await revisarSeguimiento(store, url.searchParams.get("forzar") === "1");
    return json({ seguimiento: res, rut: miRut || null });
  }

  // ---------- 🏆 negocio ganado: etapas Inversionista → Operación → Despacho → Entrega → Cerrado ----------
  const ETAPAS = ["previa", "ganada", "inversionista", "operacion", "transporte", "pago", "documentos", "despacho", "entrega", "cerrado", "rechazada"];
  // 💼 lo que se le avisa al inversionista en cada paso del negocio (y el PC le rehace su Excel con los costos reales)
  const AVISO_INV = { transporte: "🤝 Proveedor acordado", pago: "💸 Paga al proveedor", despacho: "🛣 Pedido en trayecto", entrega: "📦 Entregado: falta la recepción firmada", cerrado: "🥇 Negocio cerrado OK" };
  // 📒 PROVEEDORES: base real de a quién le compramos (facturas recibidas según el SII + pagos registrados en la app)
  if (ruta === "proveedores") {
    const emp = texto(url.searchParams.get("empresa"), 40) || "principal";
    const clave = "proveedores/" + emp;
    if (req.method === "POST") {
      const b = await cuerpo(req);
      const e2 = texto(b.empresa, 40) || emp, k2 = "proveedores/" + e2;
      const base = (await store.get(k2, { type: "json" })) || { lista: {} };
      for (const f of (Array.isArray(b.facturas) ? b.facturas : []).slice(0, 2000)) {
        const rut = String(f.rut || "").replace(/[^0-9kK-]/g, "").toUpperCase(); if (!rut) continue;
        const pv = base.lista[rut] || { rut, nombre: texto(f.nombre, 120), facturas: {}, rubro: null, nota: null };
        pv.nombre = texto(f.nombre, 120) || pv.nombre;
        const id = `${f.tipo || "33"}-${f.folio}`;
        pv.facturas[id] = { tipo: String(f.tipo || "33"), folio: Number(f.folio) || 0, fecha: texto(f.fecha, 10), neto: Number(f.neto) || 0, iva: Number(f.iva) || 0, total: Number(f.total) || 0, periodo: texto(f.periodo, 6), origen: texto(b.origen, 10) || "sii", compra: texto(f.compra, 30) || pv.facturas[id]?.compra || null, detalle: texto(f.detalle, 200) || pv.facturas[id]?.detalle || null };
        base.lista[rut] = pv;
      }
      if (b.rut && (b.rubro != null || b.nota != null || b.compra)) {          // anotar un proveedor: rubro, nota o a qué compra fue una factura
        const pv = base.lista[String(b.rut).toUpperCase()]; if (pv) { if (b.rubro != null) pv.rubro = texto(b.rubro, 60); if (b.nota != null) pv.nota = texto(b.nota, 200); if (b.compra && b.factura && pv.facturas[b.factura]) pv.facturas[b.factura].compra = texto(b.compra, 30); }
      }
      base.t = ahora(); await store.setJSON(k2, base);
      return json({ ok: true, proveedores: Object.keys(base.lista).length });
    }
    let base = (await store.get(clave, { type: "json" })) || { lista: {} };
    {   // 📥 mezclar lo ingresado desde el SII por RUT de la empresa
      const L0 = (await store.get("empresas/lista", { type: "json" })) || {};
      const rutE = String(L0[emp]?.rut || (emp === "principal" ? "78493114-5" : "")).replace(/\./g, "").toUpperCase();
      const ing = rutE ? await store.get("proveedores/sii/" + rutE, { type: "json" }) : null;
      if (ing?.lista) for (const [rut, pv] of Object.entries(ing.lista)) { const cur = base.lista[rut] || { rut, nombre: pv.nombre, facturas: {}, rubro: null, nota: null }; cur.nombre = cur.nombre || pv.nombre; Object.assign(cur.facturas, pv.facturas); cur.rubro = cur.rubro || pv.rubro || null; base.lista[rut] = cur; }
    }
    if (!Object.keys(base.lista).length) {                                   // 🌱 primera vez: sembrar con lo leído del SII, según el RUT de la empresa
      const L = (await store.get("empresas/lista", { type: "json" })) || {};
      const rutEmp = String(L[emp]?.rut || (emp === "principal" ? "78493114-5" : "")).replace(/\./g, "").toUpperCase();
      const semilla = PROV_SEED[rutEmp];
      if (semilla) {
        for (const f of semilla.facturas) { const rut = String(f.rut).toUpperCase(); const pv = base.lista[rut] || { rut, nombre: f.nombre, facturas: {}, rubro: null, nota: null };
          pv.facturas[`${f.tipo}-${f.folio}`] = { tipo: String(f.tipo), folio: f.folio, fecha: f.fecha, neto: f.neto, iva: f.iva, total: f.total, periodo: f.periodo, origen: "sii", compra: f.compra || null, detalle: f.detalle || null }; base.lista[rut] = pv; }
        base.t = ahora(); await store.setJSON(clave, base);
      }
    }
    const lista = Object.values(base.lista).map((pv) => { const fs = Object.values(pv.facturas || {}); const ncs = fs.filter((f) => f.tipo === "61"); const fac = fs.filter((f) => f.tipo !== "61");
      return { ...pv, facturas: fs.sort((a, b2) => (b2.fecha || "").split("/").reverse().join("").localeCompare((a.fecha || "").split("/").reverse().join(""))), n: fac.length, total: fac.reduce((s2, f) => s2 + f.total, 0) - ncs.reduce((s2, f) => s2 + f.total, 0), ultima: fac[0]?.fecha || null }; })
      .sort((a, b2) => b2.total - a.total);
    return json({ empresa: emp, t: base.t || null, lista });
  }
  if (ruta === "catalogo") {   // 📚 catálogo de productos/precios de la empresa activa (construido desde las facturas del SII)
    const emp = texto(url.searchParams.get("empresa"), 40) || "principal";
    const L0 = (await store.get("empresas/lista", { type: "json" })) || {};
    const rutE = String(L0[emp]?.rut || (emp === "principal" ? "78493114-5" : "")).replace(/\./g, "").toUpperCase();
    const C = rutE ? (await store.get("catalogo/" + rutE, { type: "json" })) : null;
    const items = Object.values(C?.items || {});
    return json({ empresa: emp, rut: rutE, t: C?.t || null, n: items.length, items: items.sort((a, b2) => (b2.fecha || "").split("/").reverse().join("").localeCompare((a.fecha || "").split("/").reverse().join(""))) });
  }
  if (ruta === "historico") {   // 📚 histórico de compras ágiles adjudicadas (precio ganador por producto/organismo), por término o resumen
    const term = texto(url.searchParams.get("term"), 40);
    const idx = (await store.get("historico/_indice", { type: "json" })) || { terms: {} };
    if (!term) return json({ terms: idx.terms });
    const H = (await store.get("historico/" + term.toLowerCase().replace(/[^a-z0-9ñ]+/g, "-"), { type: "json" })) || { term, compras: {} };
    const compras = Object.values(H.compras);
    const r = compras.filter((c) => c.pres > 0 && c.ganador?.total > 0).map((c) => c.ganador.total / c.pres).sort((a, b2) => a - b2);
    return json({ term, t: H.t || null, n: compras.length, ratioMed: r.length ? r[Math.floor(r.length / 2)] : null, ofMed: compras.length ? compras.map((c) => c.nOf).sort((a, b2) => a - b2)[Math.floor(compras.length / 2)] : null, compras });
  }
  if (ruta === "operacion" && req.method === "POST") {
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    const op = t.op || { etapa: "ganada", historial: [] };
    let cambioEtapa = false;
    if (b.etapa && ETAPAS.includes(b.etapa) && b.etapa !== op.etapa) {
      op.historial = [...(op.historial || []), { t: ahora(), etapa: b.etapa, por: texto(b.dispositivo, 60) }].slice(-30);
      op.etapa = b.etapa; cambioEtapa = true;
      if (b.etapa === "cerrado") op.cerrado = op.cerrado || ahora();
    }
    const d = b.datos && typeof b.datos === "object" ? b.datos : {};
    for (const k of ["proveedor", "contacto", "telefono", "email", "transporte", "notas", "medio_pago", "guia", "factura", "motivo_no", "folio_guia", "folio_factura",
      "ejecutor", "ejecutor_nombre", "plazo_proveedor", "fecha_entrega", "banco_proveedor", "negociacion", "plazo_fecha", "plazo_nota", "incidencia",
      "transportista", "transportista_tel", "origen_flete", "patente", "recibio_nombre", "recibio_rut", "fecha_cobro", "inversionista_nombre", "inversionista_tel", "despacho_modo", "proveedor_k", "proveedor_email", "proveedor_tel", "entrega_contacto", "entrega_tel", "vehiculo", "factoring", "cliente_nombre", "cliente_tel", "cliente_mail", "nota_cierre", "twitch_canal", "video_prueba", "inversionista_banco", "ejecutor_banco", "jugador_banco"]) if (d[k] !== undefined) op[k] = texto(d[k], 400);
    for (const k of ["precio_acordado", "costo_transporte", "opcion", "km", "cobrado"]) if (d[k] !== undefined) op[k] = d[k] === null ? null : Math.max(0, Math.round(Number(d[k]) || 0));
    // 🧾 caja real: facturas, abonos, aportes y devoluciones (listas de movimientos en pesos enteros) · acuerdo del inversionista
    const mov = (xs, extra) => (Array.isArray(xs) ? xs : []).slice(0, 40).map((x) => ({ monto: Math.max(0, Math.round(Number(x?.monto) || 0)), fecha: texto(x?.fecha, 10) || null, t: texto(x?.t, 30) || ahora(), ...extra(x || {}) })).filter((x) => x.monto > 0);
    if (d.facturas !== undefined) op.facturas = mov(d.facturas, (x) => ({ folio: texto(x.folio, 20) }));
    if (d.abonos !== undefined) op.abonos = mov(d.abonos, (x) => ({ origen: x.origen === "cliente" ? "cliente" : "factoring", confirmado: x.confirmado !== false }));
    if (d.aportes !== undefined) op.aportes = mov(d.aportes, (x) => ({ quien: texto(x.quien, 60) }));
    if (d.devoluciones !== undefined) { const antes = op.devoluciones || []; op.devoluciones = mov(d.devoluciones, (x) => ({ mov_id: texto(x.mov_id, 40), inv_id: texto(x.inv_id, 40), confirmado: !!x.confirmado }));
      const invId_ = (op.aportes || []).find((a) => a.inv_id)?.inv_id || null;   // devolución nueva → queda «pendiente» en el libro hasta que el inversionista confirme que la recibió
      if (invId_) for (const dv of op.devoluciones) { if (dv.mov_id || antes.some((a) => a.t === dv.t && a.monto === dv.monto && a.mov_id)) continue;
        const r = await movAgregar(store, invId_, { tipo: "devolucion", monto: dv.monto, estado: "pendiente", ref: "dev_" + t.codigo + "_" + dv.t, oc: t.codigo, empresa: t.empresa || "principal", nota: "Devolución registrada por la empresa" });
        if (!r.error) { dv.mov_id = r.mov.id; dv.inv_id = invId_; } } }
    if (d.asignacion && typeof d.asignacion === "object") { const ra = aplicarAsignacion(op, d.asignacion, b.dispositivo); if (ra.error) return json({ error: ra.error }, 400); }
    if (d.costo_confirmado && typeof d.costo_confirmado === "object" && d.costo_confirmado.lid) {   // ✅ proveedor y precio neto confirmados para una línea (historial: el original se conserva en versiones/fuentes)
      const c = d.costo_confirmado; op.costos_confirmados = op.costos_confirmados || {};
      if (c.quitar) delete op.costos_confirmados[texto(c.lid, 24)];
      else op.costos_confirmados[texto(c.lid, 24)] = { neto_unit: Math.max(0, Math.round(Number(c.neto_unit) || 0)), proveedor: texto(c.proveedor, 80), url: texto(c.url, 300), telefono: texto(c.telefono, 30), stock: texto(c.stock, 60), plazo: texto(c.plazo, 60),
        flete: Math.max(0, Math.round(Number(c.flete) || 0)), modo: ["despacho", "retiro"].includes(c.modo) ? c.modo : null, origen: texto(c.origen, 120), t: ahora(), por: texto(b.dispositivo, 60) };
      // costo vigente = líneas confirmadas; cuando están todas, pasa a ser el precio de compra acordado (con IVA) y el flete confirmado
      const items = t.items || []; const CC = op.costos_confirmados; const todas = items.length && items.every((it, k) => CC[it.lid || "L" + (k + 1)]);
      if (todas) { op.precio_acordado = Math.round(items.reduce((s2, it, k) => s2 + (CC[it.lid || "L" + (k + 1)].neto_unit || 0) * (it.q || 1), 0) * 1.19); const fl = items.reduce((s2, it, k) => s2 + (CC[it.lid || "L" + (k + 1)].flete || 0), 0); if (fl) op.costo_transporte = fl; op.pedido_informe = { t: ahora() }; }
    }
    if (d.factoring_sol !== undefined) {   // 💬 solicitud de simulación al factoring: preparada → enviada (seguimiento en la OC)
      const x = d.factoring_sol || {}; op.factoring_sol = { ...(op.factoring_sol || {}), factoring: texto(x.factoring, 80), ejecutivo: texto(x.ejecutivo, 80), telefono: texto(x.telefono, 30), factura_folio: texto(x.factura_folio, 20), guias: (Array.isArray(x.guias) ? x.guias : []).slice(0, 10).map((g) => texto(g, 20)), contacto: texto(x.contacto, 200),
        estado: x.estado === "enviada" ? "enviada" : (op.factoring_sol?.estado === "enviada" && x.estado !== "preparada" ? "enviada" : "preparada"), t_preparada: op.factoring_sol?.t_preparada || ahora(), t_enviada: x.estado === "enviada" ? ahora() : op.factoring_sol?.t_enviada || null, por: texto(b.dispositivo, 60) }; }
    if (d.factoring_resp !== undefined) {  // respuesta del factoring (simulación): anticipo líquido, costo total, segundo abono y fechas → alimenta Factoring y reparto como simulación
      const x = d.factoring_resp || {}; const n = (v) => Math.max(0, Math.round(Number(v) || 0)); op.factoring_resp = { anticipo_liquido: n(x.anticipo_liquido), costo_total: n(x.costo_total), segundo_abono: n(x.segundo_abono), fecha_anticipo: texto(x.fecha_anticipo, 10), fecha_segundo: texto(x.fecha_segundo, 10), nota: texto(x.nota, 200), t: ahora() };
      const tot = Number(t.oc_compra?.total || t.total) || 0; if (op.factoring_resp.costo_total && tot) op.param = { ...(op.param || {}), factoring: Math.round(op.factoring_resp.costo_total / tot * 10000) / 10000 };
      if (op.factoring_sol) op.factoring_sol.estado = "respondida";
      // abonos previstos (no confirmados) para la caja: se confirman cuando se depositen
      const prev = (op.abonos || []).filter((a) => a.origen !== "factoring_sim"); const nuevos = [];
      if (op.factoring_resp.anticipo_liquido) nuevos.push({ monto: op.factoring_resp.anticipo_liquido, fecha: op.factoring_resp.fecha_anticipo || null, origen: "factoring", confirmado: false, sim: true, t: ahora() });
      if (op.factoring_resp.segundo_abono) nuevos.push({ monto: op.factoring_resp.segundo_abono, fecha: op.factoring_resp.fecha_segundo || null, origen: "factoring", confirmado: false, sim: true, t: ahora() });
      op.abonos = [...prev.filter((a) => !a.sim), ...nuevos]; }
    if (d.inv_acuerdo !== undefined) op.inv_acuerdo = d.inv_acuerdo && ["pct", "pct_capital", "monto"].includes(d.inv_acuerdo.tipo) && Number(d.inv_acuerdo.v) > 0 ? { tipo: d.inv_acuerdo.tipo, v: Number(d.inv_acuerdo.v) } : null;
    if (Array.isArray(d.pagos)) {                                    // 💸 a quién le compré: nombre + monto neto + factura (varias personas)
      op.pagos = d.pagos.slice(0, 12).map((x) => ({ nombre: texto(x?.nombre, 60) || "", monto: Math.max(0, Math.round(Number(x?.monto) || 0)), factura: x?.factura !== false, ...(Array.isArray(x?.unit) ? { unit: x.unit.slice(0, 8).map((u) => Math.max(0, Math.round(Number(u) || 0))) } : {}), ...(x?.tipo === "neto" || x?.tipo === "bruto" ? { tipo: x.tipo } : {}) })).filter((x) => x.nombre || x.monto);
      op.precio_acordado = Math.round(op.pagos.reduce((s, x) => s + x.monto * (x.factura ? 1.19 : 1), 0)); op.sin_factura = op.pagos.length > 0 && op.pagos.every((x) => !x.factura);
    }
    const yaPedido = !!op.pedido_transferencia, yaTransf = !!op.transferido;
    for (const k of ["inversion_ok", "compra_ok", "despacho_ok", "guia_firmada", "factura_firmada", "aplica_comision", "nos_da", "proveedor_pagado", "guia_hecha", "factura_hecha", "oc_aceptada", "pedido_transferencia", "transferido", "flete_pagado", "rp_inversionista", "rp_ejecutador", "rp_jugador", "rp_sii", "sin_factura"]) if (d[k] !== undefined) op[k] = !!d[k];
    if (d.comision !== undefined) op.comision = Math.min(0.10, Math.max(0.01, Number(d.comision) || 0.04));
    // 📨 el juego de los proveedores: a quién le escribiste/llamaste y qué precio te dio cada uno
    if (d.contactado && typeof d.contactado === "object") {
      const k = texto(d.contactado.k, 80); if (k) op.contactados = { ...(op.contactados || {}), [k]: { via: texto(d.contactado.via, 20), t: ahora(), nombre: texto(d.contactado.nombre, 120) } };
    }
    if (d.cotizacion && typeof d.cotizacion === "object") {
      const k = texto(d.cotizacion.k, 80), v = Math.max(0, Math.round(Number(d.cotizacion.v) || 0));
      if (k) { op.cotizaciones = { ...(op.cotizaciones || {}) }; if (v) op.cotizaciones[k] = { v, nombre: texto(d.cotizacion.nombre, 120), t: ahora() }; else delete op.cotizaciones[k]; }
    }
    if (d.concretados && typeof d.concretados === "object") {          // 🎯 dónde se concretó cada ítem (link/proveedor real elegido por la persona)
      const c = {}; let i = 0;
      for (const kk of Object.keys(d.concretados)) { if (i++ >= 12) break; const x = d.concretados[kk]; if (!x) continue;
        c[texto(kk, 8)] = { titulo: texto(x.titulo, 140), url: texto(x.url, 400), fuente: texto(x.fuente, 80), proveedor: texto(x.proveedor, 120), telefono: texto(x.telefono, 40),
          precio_unit_iva: Math.max(0, Math.round(Number(x.precio_unit_iva) || 0)), cantidad: Math.max(0, Math.round(Number(x.cantidad) || 0)), t: ahora() }; }
      op.concretados = c;
    }
    if (d.cerrados && typeof d.cerrados === "object") {              // 🤝 varios proveedores que SUMAN en la misma misión
      const c = {}; let i = 0;
      for (const kk of Object.keys(d.cerrados)) { if (i++ >= 12) break; const x = d.cerrados[kk] || {};
        c[texto(kk, 80)] = { proveedor: texto(x.proveedor, 120), k: texto(x.k, 80), email: texto(x.email, 120),
          tel: texto(x.tel, 40), precio: Math.max(0, Math.round(Number(x.precio) || 0)), banco: texto(x.banco, 400) }; }
      op.cerrados = c;
    }
    if (d.descartar_k) op.descartados = { ...(op.descartados || {}), [texto(d.descartar_k, 80)]: ahora() };
    if (d.quitar_doc) {                                   // 🗑 quitar un archivo mal subido (ej. un PDF que era una página de error)
      const id = String(d.quitar_doc).replace(/[^a-z0-9]/gi, "");
      const x = (op.docs || []).find((y) => y.id === id);
      if (x) { op.docs = op.docs.filter((y) => y.id !== id); await store.delete(`doc/${t.codigo}/${id}`).catch(() => {}); if (x.tipo === "oc") op.oc_pdf_intento = null; }
    }
    const avisarPago = d.pedido_transferencia === true && !yaPedido;
    const avisarInv = d.transferido === true && !yaTransf;          // 💼 el inversionista dice que ya transfirió
    const avisarVivo = d.en_vivo === true && !op.en_vivo;      // 🔴 transmisión en vivo de la entrega (lentes Meta → Twitch)
    if (d.en_vivo !== undefined) { op.en_vivo = !!d.en_vivo; if (d.en_vivo) op.vivo_desde = ahora(); else op.vivo_hasta = ahora(); }
    if (d.proveedor_extra && typeof d.proveedor_extra === "object" && d.proveedor_extra.proveedor) {
      const x = d.proveedor_extra;
      op.extras = [...(op.extras || []), { proveedor: texto(x.proveedor, 120), telefono: texto(x.telefono, 40), email: texto(x.email, 120), fuente: texto(x.fuente, 30) || "manual" }].slice(-6);
    }
    if (b.pedir_informe || (cambioEtapa && AVISO_INV[op.etapa]) || d.precio_acordado !== undefined || d.costo_transporte !== undefined) op.pedido_informe = { t: ahora(), rebuscar: !!b.rebuscar };
    t.op = op;
    const r = await escribir(store, t);
    if (avisarInv) await avisarTexto(store, "💼 El inversionista transfirió · " + t.codigo, `${String(t.nombre || "").slice(0, 60)} · revisa la cuenta de la empresa y paga a ${String(op.proveedor || "el proveedor").slice(0, 40)} (${"$" + Math.round(op.precio_acordado || 0).toLocaleString("es-CL")}).`, "inv-" + t.codigo, "/#robot", true).catch(() => {});
    if (avisarVivo && op.twitch_canal) await avisarTexto(store, "🔴 En vivo: " + String(t.nombre || t.codigo).slice(0, 50), `${t.codigo} · mira la entrega en directo: twitch.tv/${op.twitch_canal}`, "vivo-" + t.codigo, "https://www.twitch.tv/" + encodeURIComponent(op.twitch_canal), true).catch(() => {});
    if (avisarPago) await avisarTexto(store, "💸 Inversionista: paga a " + String(op.proveedor || "proveedor").slice(0, 40), `${t.codigo} · ${"$" + Math.round(op.precio_acordado || 0).toLocaleString("es-CL")}${op.banco_proveedor ? " · " + texto(op.banco_proveedor, 140) : ""}. Sube el comprobante en Ejecuta para que avance.`, "pago-" + t.codigo, "/#robot", true).catch(() => {});
    if (cambioEtapa && AVISO_INV[op.etapa]) {        // 💼 aviso al inversionista (push) con el resumen del negocio
      const util = op.informe?.final != null ? " · utilidad " + "$" + Math.round(op.informe.final).toLocaleString("es-CL") : "";
      await avisarTexto(store, "💼 " + AVISO_INV[op.etapa] + " · " + t.codigo, `${(t.nombre || "").slice(0, 60)} · venta $${Math.round(t.total || 0).toLocaleString("es-CL")}${op.precio_acordado ? " · compra $" + Math.round(op.precio_acordado).toLocaleString("es-CL") : ""}${op.costo_transporte ? " · flete $" + Math.round(op.costo_transporte).toLocaleString("es-CL") : ""}${util}. Excel actualizado en Negocios.`,
        "inv-" + t.codigo, "/#robot").catch(() => {});
    }
    return json({ trabajo: r });
  }
  // archivos del negocio: informe PDF y Excel (los sube el PC), fotos / guías / facturas (las sube el celular)
  // ✍️ firma de la representante legal: la sube el celular, el PC la guarda y la estampa en los anexos
  if (ruta === "firma-subir" && req.method === "POST") {
    const b = await cuerpo(req);
    const bytes = Buffer.from(String(b.b64 || ""), "base64");
    if (!bytes.length || bytes.length > 4_000_000) return json({ error: "Imagen vacía o de más de 4 MB." }, 400);
    const meta = { id: idCorto(), t: ahora(), mime: texto(b.mime, 40) || "image/jpeg", nombre: texto(b.nombre, 120), rut: texto(b.rut, 20), cargo: texto(b.cargo, 60) || "Representante legal", procesada: false };
    await store.set("firma/img", bytes);
    await store.setJSON("firma/meta", meta);
    return json({ ok: true, firma: meta });
  }
  if (ruta === "firma" && req.method === "GET") {
    const meta = (await store.get("firma/meta", { type: "json" })) || null;
    if (url.searchParams.get("img") && meta) {
      const llave = url.searchParams.get("img") === "lista" ? "firma/lista" : "firma/img";
      const data = await store.get(llave, { type: "arrayBuffer" });
      if (!data) return json({ error: "Sin imagen." }, 404);
      return new Response(data, { headers: { "content-type": llave === "firma/lista" ? "image/png" : meta.mime, "cache-control": "no-store" } });
    }
    return json({ firma: meta });
  }
  if (ruta === "firma-lista" && req.method === "POST") {          // el PC devuelve la firma limpia (fondo transparente)
    const b = await cuerpo(req);
    const meta = (await store.get("firma/meta", { type: "json" })) || null;
    if (!meta || meta.id !== b.id) return json({ ok: false });
    const bytes = Buffer.from(String(b.b64 || ""), "base64");
    if (bytes.length) await store.set("firma/lista", bytes);
    await store.setJSON("firma/meta", { ...meta, procesada: ahora(), error: texto(b.error, 200) });
    return json({ ok: true });
  }
  // 🎨 visualizar el proyecto de una licitación (render por fuera / por dentro) y archivos del análisis
  if (ruta === "lic-vision" && req.method === "POST") {
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    const vistas = (Array.isArray(b.vistas) && b.vistas.length ? b.vistas : ["exterior", "interior"]).map((v) => texto(v, 30)).slice(0, 4);
    t.lic_vision = { t: ahora(), vistas, nota: texto(b.nota, 400), hechas: [] };
    return json({ trabajo: await escribir(store, t) });
  }
  if (ruta === "lic-archivo" && req.method === "POST") {
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    // 📦 subida por partes: un archivo pesado (> 4,5 MB) llega en pedazos y aquí se arma completo (sin tope)
    if (b.up && b.total) {
      const up = String(b.up).replace(/[^a-z0-9]/gi, "").slice(0, 40);
      const idx = Math.max(0, parseInt(b.idx, 10) || 0), total = Math.min(60, Math.max(1, parseInt(b.total, 10) || 1));
      const parte = Buffer.from(String(b.b64 || ""), "base64");
      if (!parte.length || parte.length > MAX_PDF) return json({ error: "Pedazo vacío o muy grande." }, 400);
      await store.set(`chunk/${t.codigo}/${up}/${idx}`, parte);
      if (idx + 1 < total) return json({ ok: true, parte: idx + 1, de: total });
      const trozos = [];
      for (let i = 0; i < total; i++) {
        const p = await store.get(`chunk/${t.codigo}/${up}/${i}`, { type: "arrayBuffer" });
        if (!p) return json({ error: `Faltó el pedazo ${i + 1} de ${total}: reenvía ese archivo.` }, 400);
        trozos.push(Buffer.from(p));
      }
      const full = Buffer.concat(trozos);
      const idc = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      await store.set(`doc/${t.codigo}/${idc}`, full);
      t.lic_docs = [...(t.lic_docs || []), { id: idc, tipo: texto(b.tipo, 20) || "anexo", nombre: texto(b.nombre, 120) || "archivo",
        mime: texto(b.mime, 60) || "application/pdf", kb: Math.round(full.length / 1024), fecha: ahora() }].slice(-20);
      const rr = await escribir(store, t);
      for (let i = 0; i < total; i++) await store.delete(`chunk/${t.codigo}/${up}/${i}`).catch(() => {});
      return json({ trabajo: rr, armado: true, kb: Math.round(full.length / 1024) });
    }
    const bytes = Buffer.from(String(b.b64 || ""), "base64");
    if (!bytes.length || bytes.length > MAX_PDF) return json({ error: "Archivo vacío o muy grande." }, 400);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    await store.set(`doc/${t.codigo}/${id}`, bytes);
    t.lic_docs = [...(t.lic_docs || []).filter((d) => !(b.vista && d.vista === b.vista && d.tipo === b.tipo)),
      { id, tipo: texto(b.tipo, 20) || "otro", vista: texto(b.vista, 30), nombre: texto(b.nombre, 120) || "archivo", mime: texto(b.mime, 60) || "image/jpeg", kb: Math.round(bytes.length / 1024), fecha: ahora() }].slice(-20);
    if (t.lic_vision && b.vista) { t.lic_vision.hechas = [...new Set([...(t.lic_vision.hechas || []), texto(b.vista, 30)])]; if (b.error) t.lic_vision.error = texto(b.error, 200); }
    const r = await escribir(store, t);
    if (t.lic_vision && t.lic_vision.vistas.every((v) => t.lic_vision.hechas.includes(v)))
      await avisarTexto(store, "🎨 Proyecto visualizado · " + t.codigo, `${(t.lic?.producto || t.nombre || "").slice(0, 80)} · mira cómo quedaría por fuera y por dentro.`, "vis-" + t.codigo, "/#robot").catch(() => {});
    return json({ trabajo: r });
  }
  if (ruta === "lic-anexos-listo" && req.method === "POST") {   // 📎 el celular subió los anexos del ZIP: el robot los absorbe sin bajar de Mercado Público
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    if (ESTADOS_ACTIVOS.has(t.estado)) return json({ trabajo: t, aviso: "Ya está en manos del robot." }, 409);
    const n = (t.lic_docs || []).filter((d) => d.tipo === "anexo").length;
    if (!n) return json({ error: "Primero elige los anexos que descargaste del portal." }, 400);
    t.accion = "licitar";
    t.anexos_sube = { t: ahora(), n };                           // señal para el robot: analiza desde estos archivos, no desde el portal
    anotar(t, "en_cola", `📂 ${n} anexo${n > 1 ? "s" : ""} subido${n > 1 ? "s" : ""} desde el celular: el robot los absorbe y analiza (sin bajar de Mercado Público).`);
    return json({ trabajo: await escribir(store, t) });
  }
  if (ruta === "subir" && req.method === "POST") {
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    const tipo = ["foto", "guia", "factura", "comprobante", "oc", "otro"].includes(b.tipo) ? b.tipo : "otro";
    const bytes = Buffer.from(String(b.b64 || ""), "base64");
    if (!bytes.length || bytes.length > MAX_PDF) return json({ error: "Archivo vacío o de más de 4,5 MB." }, 400);
    const op = t.op || { etapa: "ganada", historial: [] };
    const id = Date.now().toString(36);
    await store.set(`doc/${t.codigo}/${id}`, bytes);
    op.docs = [...(op.docs || []), { id, tipo, nombre: texto(b.nombre, 120) || tipo, mime: texto(b.mime, 60) || "application/octet-stream",
      kb: Math.round(bytes.length / 1024), fecha: ahora(), por: texto(b.dispositivo, 60) }].slice(-40);
    if (tipo === "foto" && b.cerrar) {                 // la foto de la entrega cierra el negocio (en oro)
      op.historial = [...(op.historial || []), { t: ahora(), etapa: "cerrado", por: texto(b.dispositivo, 60) }].slice(-30);
      op.etapa = "cerrado"; op.cerrado = ahora(); op.pedido_informe = { t: ahora() };     // el PC rehace el Excel final del inversionista
      t.op = op; const r = await escribir(store, t);
      await avisarTexto(store, "💼 🥇 Negocio cerrado OK · " + t.codigo, `${(t.nombre || "").slice(0, 60)} · entregado con recepción conforme. Excel del inversionista actualizado en Negocios.`, "inv-" + t.codigo, "/#robot").catch(() => {});
      return json({ trabajo: r });
    }
    t.op = op;
    return json({ trabajo: await escribir(store, t) });
  }
  if (ruta === "archivo" && req.method === "GET") {
    const codigo = limpiaCodigo(url.searchParams.get("codigo"));
    const tipo = url.searchParams.get("tipo");
    const llave = tipo === "informe" ? "inf/" + codigo : tipo === "excel" ? "xls/" + codigo : "doc/" + codigo + "/" + String(url.searchParams.get("id") || "").replace(/[^a-z0-9]/gi, "");
    const data = await store.get(llave, { type: "arrayBuffer" });
    if (!data) return json({ error: "No está ese archivo." }, 404);
    const t = await leer(store, codigo);
    const meta = [...(t?.op?.docs || []), ...(t?.lic_docs || [])].find((x) => x.id === url.searchParams.get("id"));
    const mime = tipo === "informe" ? "application/pdf" : tipo === "excel" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : meta?.mime || "application/octet-stream";
    const nombre = tipo === "informe" ? `Informe_negocio_${codigo}.pdf` : tipo === "excel" ? `Negocio_${codigo}.xlsx` : (meta?.nombre || "archivo").replace(/[^\w.\- ]/g, "_");
    return new Response(data, { headers: { "content-type": mime, "content-disposition": `${tipo === "excel" ? "attachment" : "inline"}; filename="${nombre}"`, "cache-control": "no-store" } });
  }
  // el PC sube el informe de negocio (PDF + Excel + resumen)
  if (ruta === "negocio-subir" && req.method === "POST") {
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    const op = t.op || { etapa: "ganada", historial: [{ t: ahora(), etapa: "ganada" }] };
    if (b.informe_b64) { const x = Buffer.from(String(b.informe_b64), "base64"); if (x.length <= MAX_PDF && x.subarray(0, 4).toString() === "%PDF") await store.set("inf/" + t.codigo, x); }
    if (b.xlsx_b64) { const x = Buffer.from(String(b.xlsx_b64), "base64"); if (x.length <= MAX_PDF && x.subarray(0, 2).toString() === "PK") await store.set("xls/" + t.codigo, x); }
    if (b.resumen && typeof b.resumen === "object") op.informe = { ...b.resumen, fecha: ahora() };
    op.pedido_informe = null;
    t.op = op;
    return json({ trabajo: await escribir(store, t) });
  }

  // ---------- comprobante PDF del envío (lo sube el PC al confirmar) ----------
  if (ruta === "comprobante" && req.method === "GET") {
    const codigo = limpiaCodigo(url.searchParams.get("codigo"));
    const data = await store.get("comp/" + codigo, { type: "arrayBuffer" });
    if (!data) return json({ error: "Aún no hay comprobante de esta oferta." }, 404);
    return new Response(data, {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Comprobante_${codigo}.pdf"`, "cache-control": "no-store" },
    });
  }

  // ---------- tu Mercado Público (pestaña de Safari con Firma rápida) ----------
  // La pestaña conectada avisa que está viva y recibe la compra que tocaste en la app («Ir a firmar»).
  if (ruta === "mp-latido" && req.method === "POST") {
    const b = await cuerpo(req);
    await store.setJSON("mp/latido", { visto: ahora(), logueado: !!b.logueado, pagina: texto(b.pagina, 120), usuario: texto(b.usuario, 60) });
    const orden = await store.get("mp/orden", { type: "json" });
    if (orden && !orden.entregada && Date.now() - orden.t < 15 * 60000) {
      await store.setJSON("mp/orden", { ...orden, entregada: true });
      return json({ orden: orden.codigo });
    }
    return json({ orden: null });
  }
  if (ruta === "mp-orden" && req.method === "POST") {
    const b = await cuerpo(req);
    const codigo = limpiaCodigo(b.codigo);
    if (!/^\d{1,8}-\d{1,8}-COT\d{2}$/.test(codigo)) return json({ error: "Código inválido" }, 400);
    await store.setJSON("mp/orden", { codigo, t: Date.now(), entregada: false });
    return json({ ok: true });
  }

  if (ruta === "pedir" && req.method === "POST") {
    const b = await cuerpo(req);
    const codigo = limpiaCodigo(b.codigo);
    const accion = ACCIONES.has(b.accion) ? b.accion : "ofertar";
    const esLic = accion.startsWith("lic");
    if (esLic ? !COD_LIC.test(codigo) || /COT\d{2}$/.test(codigo) : !/^\d{1,8}-\d{1,8}-COT\d{2}$/.test(codigo)) {
      return json({ error: esLic ? "Código de licitación inválido (ej. 2736-46-LE26)." : "El robot solo trabaja Compras Ágiles (códigos como 1234-56-COT26)." }, 400);
    }
    const previo = await leer(store, codigo);
    if (previo && ESTADOS_ACTIVOS.has(previo.estado)) return json({ trabajo: previo, aviso: "Ya está en manos del robot." }, 409);
    // 🏢 Una compra = una empresa. Si otra empresa del grupo ya la cotizó (o la tiene lista para firmar), no se vuelve a preparar:
    //    sobrescribiría sus precios en el portal y además dos empresas relacionadas no pueden ofertar la misma compra.
    { const empN = texto(b.empresa, 40) || null; const prevE = previo?.empresa || null;
      const distinta = previo && empN && prevE && prevE !== "principal" && empN !== "principal" && prevE !== empN;
      if (distinta && ["firmar", "enviada", "confirmada"].includes(previo.estado) && accion !== "verificar") {
        const L = (await store.get("empresas/lista", { type: "json" })) || {}; const nom = L[prevE]?.razon_social || prevE;
        return json({ trabajo: previo, error: `Esta compra ya la cotizó ${nom} (${previo.estado}). Una misma compra no se oferta con dos empresas del grupo: elige otra.` }, 409); } }
    if (accion === "lic_firmar" || accion === "lic_ingresar") {   // pasos siguientes: conservan el análisis y los papeles
      if (!previo?.lic) return json({ error: "Primero el robot debe preparar la licitación." }, 404);
      previo.accion = accion;
      if (b.descuento != null) previo.descuento = Math.min(0.6, Math.max(0, Number(b.descuento) || 0));
      anotar(previo, "en_cola", accion === "lic_firmar" ? "Aprobada: el robot firma los anexos y la deja lista para ofertar."
        : "El robot ingresará la oferta en Mercado Público (tú declaras y envías).");
      return json({ trabajo: await escribir(store, previo) });
    }
    if (accion === "verificar") {          // marcar enviada: SOLO con confirmación humana/visual (vista), nunca por tiempo
      if (!previo) return json({ error: "No hay oferta preparada para verificar." }, 404);
      if (!b.vista) return json({ trabajo: previo, aviso: "Sin confirmación de Mercado Público: sigue en Firmar." });   // el robot ya no entra al portal a mirar; sin «enviada correctamente» no se marca
      previo.accion = "verificar";
      if (b.vista) previo.enviada_vista = ahora();     // Mercado Público mostró «Cotización enviada correctamente»: sale de Firmar en todos los celulares
      if (b.vista) congelarEnvio(previo, b);          // 🧊 lo que el portal mostró al pulsar Enviar queda congelado con el intento y la versión que lo originó
      previo.dispositivo = texto(b.dispositivo, 60) || previo.dispositivo || null;   // qué celular la envió (registro «Enviados» del PC)
      anotar(previo, "en_cola", "El robot revisará en Mercado Público si ya quedó enviada.");
      return json({ trabajo: await escribir(store, previo) });
    }
    // 🤖 MODO AUTOMÁTICO (el robot pide sin descuento): Claude decide con el histórico de mercado por familia.
    //    Certeza < 40 % → la deja pasar (200 + saltada:true, el robot la marca hecha y sigue); si no, fija el descuento del ganador real.
    let cerebro = null;
    if (!esLic && b.descuento == null && !["verificar", "probar", "editar"].includes(accion)) {
      try { cerebro = await cerebroPrecio(store, codigo, b); } catch { cerebro = null; }
      if (cerebro && cerebro.prob < CERTEZA_MIN) {
        return json({ trabajo: null, saltada: true, aviso: `🤖 Claude la deja pasar: certeza ${Math.round(cerebro.prob * 100)} % < ${Math.round(CERTEZA_MIN * 100)} % (${cerebro.motivo})` });
      }
    }
    // Compra Ágil: se puede ofertar sobre el presupuesto (descuento negativo) hasta el tope de 100 UTM que controla la app
    const descuento = Math.min(0.6, Math.max(esLic ? 0 : -9, b.descuento != null ? Number(b.descuento) || 0 : cerebro ? cerebro.descuento : esLic ? 0.17 : 0.08));
    const t = {
      codigo, accion, descuento,
      nombre: texto(b.nombre, 200), organismo: texto(b.organismo, 200), monto: Number(b.monto) || null,
      creado: ahora(), estado: null, mensaje: null, historial: [],
      total: null, neto: null, plazo: null, detalle: null, items: null, pdf: false,
      envios: previo?.envios || 0, // cuántas veces quedó enviada antes (para editar)
      empresa: texto(b.empresa, 40) || previo?.empresa || "principal",   // con qué empresa (RUT y datos) se arma la oferta; sin etiqueta = PJANIC (principal)
      jugador: jug(b.jugador) || previo?.jugador || null,         // qué celular (qué juego) la pidió
      dispositivo: texto(b.dispositivo, 60) || previo?.dispositivo || null,
      persona: texto(b.persona, 60) || previo?.persona || null,               // quién la pidió (nombre que puso en la app)
      por: b.por === "claude" || cerebro ? "claude" : (previo?.por || null),    // 🤖 "claude": el precio lo puso Claude (ronda jugada por la IA o modo automático)
    };
    if (cerebro) { t.prob = cerebro.prob; t.cerebro = cerebro.motivo; }
    if (esLic) t.tipo = "licitacion";
    // ⚡ Firma directa: si el robot no está conectado y la app manda los precios por ítem (del juego), la oferta queda LISTA PARA FIRMAR
    //    al instante, sin esperar al robot. El PDF lo agrega el robot después si vuelve, sin sacarla de Firmar.
    const fa = b.firma_app; const robotL = (await store.get("robot/latido", { type: "json" })) || {}; const robotOn = robotL.visto && Date.now() - Date.parse(robotL.visto) < ROBOT_INACTIVO_MS;
    if (!esLic && accion === "firmar" && fa && Array.isArray(fa.precios) && fa.precios.length && (!robotOn || b.directo)) {
      const precios = fa.precios.slice(0, 60).map((v) => Math.max(0, Math.round(Number(v) || 0)));
      t.items = Array.isArray(fa.items) ? fa.items.slice(0, 60).map((i) => ({ d: texto(i?.d, 200) || "", q: Number(i?.q) || 1, p: Math.max(0, Math.round(Number(i?.p) || 0)) })) : previo?.items || null;
      t.firma = { precios, despacho: Math.max(0, Math.round(Number(fa.despacho) || 0)), detalle: texto(fa.detalle, 900) || "", origen: "app", persona: t.persona };
      t.items = (t.items || []).map((it, k) => ({ ...it, lid: lineaId(k, it) })); nuevaVersion(t, "app", t.items, t.firma);
      t.neto = Math.round((t.items || []).reduce((s2, it, i) => s2 + (precios[i] || 0) * (it.q || 1), 0) + t.firma.despacho); t.total = Math.round(t.neto * 1.19);
      t.accion = "pdf"; t.pdf = previo?.pdf || false;
      anotar(t, "firmar", robotOn ? "Lista para firmar con tus precios (el robot agrega el PDF)." : "Lista para firmar con tus precios · el robot está apagado: va sin PDF, tú la ingresas en MP.");
      return json({ trabajo: await escribir(store, t), directo: true });
    }
    anotar(t, "en_cola", accion === "probar" ? "Prueba sin enviar: el robot la tomará en segundos." : esLic ? "Licitación: el robot bajará la ficha, las bases y los anexos." : "Esperando que el robot la tome.");
    return json({ trabajo: await escribir(store, t) });
  }

  if (ruta === "cancelar" && req.method === "POST") {
    const t = await leer(store, limpiaCodigo((await cuerpo(req)).codigo));
    if (!t) return json({ error: "No existe." }, 404);
    if (!["en_cola", "tomado"].includes(t.estado)) return json({ error: "Ya no se puede cancelar desde aquí: el robot está trabajando en el portal." }, 409);
    anotar(t, "cancelada", "Cancelada desde el celular.");
    return json({ trabajo: await escribir(store, t) });
  }

  if (ruta === "olvidar" && req.method === "POST") {
    const codigo = limpiaCodigo((await cuerpo(req)).codigo);
    const t = await leer(store, codigo);
    if (t && ESTADOS_ACTIVOS.has(t.estado)) return json({ error: "Está en proceso; cancélala o espera que termine." }, 409);
    await store.delete("trabajo/" + codigo);
    await store.delete("pdf/" + codigo);
    return json({ ok: true });
  }

  if (ruta === "push-clave" && req.method === "GET") {
    return json({ publicKey: (await vapid(store)).publicKey });
  }

  if (ruta === "push-suscribir" && req.method === "POST") {
    const sub = (await cuerpo(req)).sub;
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
      return json({ error: "Suscripción inválida." }, 400);
    }
    await store.setJSON("push/sub/" + idSub(sub.endpoint), {
      endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, creado: ahora(),
    });
    return json({ ok: true });
  }

  if (ruta === "push-borrar" && req.method === "POST") {
    const sub = (await cuerpo(req)).sub;
    if (sub?.endpoint) await store.delete("push/sub/" + idSub(sub.endpoint));
    return json({ ok: true });
  }

  if (ruta === "push-probar" && req.method === "POST") {
    await avisar(store, { codigo: "PRUEBA", estado: "probada", total: null, nombre: "Aviso de prueba de CotizÁgil" });
    return json({ ok: true });
  }

  if (ruta === "pdf" && req.method === "GET") {
    const codigo = limpiaCodigo(url.searchParams.get("codigo"));
    const data = await store.get("pdf/" + codigo, { type: "arrayBuffer" });
    if (!data) return json({ error: "Sin PDF." }, 404);
    return new Response(data, {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Oferta_${codigo}.pdf"`, "cache-control": "no-store" },
    });
  }

  if (ruta === "captcha" && req.method === "POST") {      // tú escribes el código de la imagen; el robot lo ingresa
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t?.captcha) return json({ error: "No hay código pendiente." }, 404);
    t.captcha_resp = texto(b.texto, 20);
    anotar(t, t.estado, "Código enviado al robot.");
    return json({ trabajo: await escribir(store, t) });
  }
  if (ruta === "lic-zip" && req.method === "GET") {
    const codigo = limpiaCodigo(url.searchParams.get("codigo"));
    const data = await store.get("lic/" + codigo, { type: "arrayBuffer" });
    if (!data) return json({ error: "Sin documentos." }, 404);
    return new Response(data, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="PJANIC_${codigo}.zip"`, "cache-control": "no-store" } });
  }

  if (ruta === "trabajo" && req.method === "GET") {       // una oferta completa (ítems y precios) para guía y factura
    const t = await leer(store, limpiaCodigo(url.searchParams.get("codigo")));
    if (!t) return json({ error: "No existe." }, 404);
    const { firma, historial, ...r } = t;
    let match = r.op?.oc_match || null;
    if (r.oc_compra && (!match || match.regla !== REGLA_COTEJO)) { try { match = cotejarOC(t); if (t.op) { t.op.oc_match = match; await escribir(store, t); } } catch {} }   // regla nueva: se recalcula y se guarda
    return json({ trabajo: { ...r, op: r.op ? { ...r.op, oc_match: match } : r.op, precios: firma?.precios || null, despacho_firma: firma?.despacho || 0, historial: (historial || []).slice(-10) } });
  }
  // ---------- 🛠 Ejecuta: socios ejecutadores (compran, negocian, entregan y cierran con guía y factura firmadas) ----------
  // ☁️ robot en la nube: el PC sube su paquete (código + configuración) UNA vez; el servidor lo baja y se borra
  if (ruta === "paquete" && req.method === "POST") {
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length < 1000 || bytes.length > 4_300_000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json({ error: "Paquete inválido o de más de 4 MB." }, 400);
    await store.set("nube/paquete", bytes);
    await store.setJSON("nube/paquete-meta", { t: ahora(), kb: Math.round(bytes.length / 1024), desde: texto(url.searchParams.get("desde"), 60) });
    return json({ ok: true, kb: Math.round(bytes.length / 1024) });
  }
  if (ruta === "paquete" && req.method === "GET") {
    const data = await store.get("nube/paquete", { type: "arrayBuffer" });
    if (!data) return json({ error: "No hay paquete: en el PC haz doble clic en SUBIR_A_LA_NUBE." }, 404);
    if (url.searchParams.get("borrar") !== "0") { await store.delete("nube/paquete"); await store.setJSON("nube/paquete-meta", { bajado: ahora() }); }
    return new Response(data, { headers: { "content-type": "application/zip", "cache-control": "no-store" } });
  }
  if (ruta === "nube-estado" && req.method === "POST") {      // el servidor avisa dónde quedó su vista remota
    const b = await cuerpo(req);
    const e = { t: ahora(), host: texto(b.host, 120), vista: texto(b.vista, 200), panel: texto(b.panel, 200), usuario: texto(b.usuario, 40), clave: texto(b.clave, 80), version: texto(b.version, 20) };
    await store.setJSON("nube/estado", e);
    await avisarTexto(store, "☁️ Tu robot ya vive en la nube", "Funciona 24/7 sin tu PC. Abre 💎 Planes → Robot en la nube para iniciar sesión en Mercado Público una vez.", "nube", "/#robot").catch(() => {});
    return json({ ok: true });
  }
  // 🔐 conectar Mercado Público desde el celular: RUN + ClaveÚnica viajan CIFRADOS con la llave del robot del PC
  // (este servidor no puede leerlos), el robot los escribe en ClaveÚnica y pide aquí el código o la empresa si hace falta.
  if (ruta === "mp-login" && req.method === "GET") {
    const pub = await store.get("login/pub", { type: "json" }), est = await store.get("login/estado", { type: "json" });
    const lat = (await store.get("robot/equipos", { type: "json" })) || {};
    const pcVivo = Object.entries(lat).some(([k, v]) => !/nube/i.test(k) && Date.now() - Date.parse(v.visto) < 90_000);
    const pn = await store.get("login/pub_nube", { type: "json" }), sn = await store.get("login/sesion_nube", { type: "json" });
    return json({ pub: pub?.pub || null, equipo: pub?.equipo || null, pc_vivo: pcVivo, estado: est || null, pub_nube: pn?.pub || null, sesion_nube: sn || null });
  }
  if (ruta === "mp-login" && req.method === "POST") {
    const b = await cuerpo(req);
    if (!b.legado) return json({ error: "Solo el dueño conecta la sesión de Mercado Público del robot." }, 403);
    if (typeof b.sobre !== "string" || b.sobre.length > 2000) return json({ error: "Datos inválidos." }, 400);
    const id = globalThis.crypto.randomUUID();
    await store.setJSON("login/pedido", { id, sobre: b.sobre, t: ahora() });
    await store.delete("login/resp").catch(() => {});
    await store.setJSON("login/estado", { id, paso: "enviado", mensaje: "Esperando que el robot del PC lo tome (segundos)…", t: ahora() });
    return json({ ok: true, id });
  }
  if (ruta === "mp-login-resp" && req.method === "POST") {      // el celular contesta: código cifrado, empresa elegida o cancelar
    const b = await cuerpo(req);
    if (!b.legado) return json({ error: "Solo el dueño." }, 403);
    await store.setJSON("login/resp", { id: texto(b.id, 60), sobre: typeof b.sobre === "string" ? b.sobre.slice(0, 2000) : null,
      opcion: Number.isInteger(b.opcion) ? b.opcion : null, cancelar: !!b.cancelar, t: ahora() });
    return json({ ok: true });
  }
  if (ruta === "mp-login-resp" && req.method === "GET") {       // el robot del PC retira la respuesta (y se borra)
    const r = await store.get("login/resp", { type: "json" });
    if (!r || r.id !== url.searchParams.get("id")) return json({ resp: null });
    await store.delete("login/resp");
    return json({ resp: r });
  }
  if (ruta === "mp-sesion" && req.method === "POST") {          // el PC deja la sesión SELLADA para la nube
    const b = await cuerpo(req);
    if (typeof b.datos !== "string" || b.datos.length > 3_000_000) return json({ error: "Sesión inválida." }, 400);
    await store.setJSON("login/sesion", { llave: texto(b.llave, 1000), iv: texto(b.iv, 64), datos: b.datos, t: ahora() });
    return json({ ok: true });
  }
  if (ruta === "mp-sesion-ok" && req.method === "POST") {       // la nube cuenta si quedó conectada
    const b = await cuerpo(req), E = (await store.get("login/estado", { type: "json" })) || {};
    await store.setJSON("login/sesion_nube", { ok: !!b.ok, mensaje: texto(b.mensaje, 300), t: ahora() });
    await store.setJSON("login/estado", { ...E, paso: b.ok ? "listo" : "error", mensaje: texto(b.mensaje, 300), foto: null, t: ahora() });
    await avisarTexto(store, b.ok ? "☁️ La nube quedó conectada" : "⚠️ La nube no quedó conectada", texto(b.mensaje, 200), "mp-login", "/#robot").catch(() => {});
    return json({ ok: true });
  }
  if (ruta === "mp-login-estado" && req.method === "POST") {    // el robot del PC cuenta en qué paso va
    const b = await cuerpo(req);
    const ops = Array.isArray(b.opciones) ? b.opciones.slice(0, 30).map((x) => texto(x, 160)) : null;
    await store.setJSON("login/estado", { id: texto(b.id, 60), paso: texto(b.paso, 20), mensaje: texto(b.mensaje, 400), opciones: ops,
      foto: typeof b.foto === "string" && b.foto.length < 400_000 ? b.foto : null, t: ahora() });
    if (b.paso === "listo") await avisarTexto(store, "🔐 Mercado Público conectado", "El robot ya tiene tu sesión. Puedes seguir preparando ofertas.", "mp-login", "/#robot").catch(() => {});
    return json({ ok: true });
  }
  if (ruta === "robot-mando" && req.method === "POST") {     // el dueño elige qué robot manda: PC o nube
    const b = await cuerpo(req);
    if (!b.legado) return json({ error: "Solo el dueño elige qué robot manda." }, 403);
    const M = (await store.get("robot/mando", { type: "json" })) || {};
    M.preferido = ["pc", "nube"].includes(b.preferido) ? b.preferido : null;
    await store.setJSON("robot/mando", M);
    return json({ ok: true, mando: M });
  }
  if (ruta === "nube-solicitudes" && req.method === "GET") {
    const L = ((await store.get("nube/solicitudes", { type: "json" })) || []).filter((x) => Date.now() - Date.parse(x.t) < 3 * 3600_000);
    return json({ solicitudes: L.map(({ id, t, estado, ip, nombre }) => ({ id, t, estado, ip, nombre })) });
  }
  if (ruta === "nube-aprobar" && req.method === "POST") {
    const b = await cuerpo(req);
    if (!b.legado) return json({ error: "Solo el dueño puede aprobar servidores." }, 403);
    const L = (await store.get("nube/solicitudes", { type: "json" })) || [];
    const sol = L.find((x) => x.id === b.id && x.estado === "pendiente");
    if (!sol) return json({ error: "La solicitud ya no está pendiente." }, 404);
    sol.estado = b.rechazar ? "rechazado" : "aprobado"; sol.resuelto = ahora();
    await store.setJSON("nube/solicitudes", L);
    return json({ ok: true, estado: sol.estado });
  }
  if (ruta === "nube-estado" && req.method === "GET") {
    const e = (await store.get("nube/estado", { type: "json" })) || null;
    const pm = (await store.get("nube/paquete-meta", { type: "json" })) || null;
    const lat = (await store.get("robot/latido", { type: "json" })) || null;
    const mando = (await store.get("robot/mando", { type: "json" })) || null, equipos = (await store.get("robot/equipos", { type: "json" })) || {};
    return json({ nube: e, paquete: pm, latido: lat ? { visto: lat.visto || null, equipo: lat.equipo || null } : null, mando, equipos });
  }
  // 💎 planes de suscripción (USD/mes): cada celular/juego tiene el suyo; el dueño los activa cuando llega el pago
  const PLANES = { basico: { usd: 20, nombre: "Básico" }, medio: { usd: 100, nombre: "Medio" }, premium: { usd: 1000, nombre: "Premium" } };
  if (ruta === "plan" && req.method === "GET") {
    const L = (await store.get("planes/lista", { type: "json" })) || {};
    const j = jug(url.searchParams.get("jugador"));
    const guardados = (await store.get("planes/links", { type: "json" })) || {};
    const links = Object.fromEntries(Object.keys(PLANES).map((k) => [k, guardados[k] || process.env["PAGO_" + k.toUpperCase()] || null]));
    return json({ plan: (j && L[j]) || null, planes: PLANES, links, todos: url.searchParams.get("admin") === "1" ? L : undefined });
  }
  if (ruta === "plan-links" && req.method === "POST") {       // el dueño pega el link de pago (Mercado Pago / Flow) de cada plan
    const b = await cuerpo(req);
    if (!b.legado) return json({ error: "Solo el dueño puede cambiar los links de pago." }, 403);
    const L = (await store.get("planes/links", { type: "json" })) || {};
    for (const k of Object.keys(PLANES)) if (b.links && b.links[k] !== undefined) {
      const v = texto(b.links[k], 300).trim();
      if (v && !/^https:\/\/([a-z0-9-]+\.)*(mercadopago\.(cl|com)|mpago\.(la|li)|flow\.cl|paypal\.(me|com)|stripe\.com|buy\.stripe\.com|khipu\.com|webpay\.cl)\//i.test(v)) return json({ error: "El link de " + PLANES[k].nombre + " debe ser de Mercado Pago, Flow, PayPal, Stripe o Khipu (https)." }, 400);
      L[k] = v || null;
    }
    await store.setJSON("planes/links", L);
    return json({ ok: true, links: L });
  }
  if (ruta === "plan" && req.method === "POST") {
    const b = await cuerpo(req);
    const L = (await store.get("planes/lista", { type: "json" })) || {};
    const j = jug(b.jugador); if (!j) return json({ error: "Falta el juego." }, 400);
    const plan = PLANES[b.plan] ? b.plan : null; if (!plan) return json({ error: "Plan desconocido." }, 400);
    const previo = L[j] || {};
    if (b.activar) {                                           // lo hace el dueño (desde el informe global) al confirmar el pago
      L[j] = { ...previo, plan, estado: "activo", desde: previo.desde || ahora(), activado: ahora(), hasta: texto(b.hasta, 20) || null, nombre: previo.nombre || texto(b.nombre, 60) };
    } else {
      L[j] = { ...previo, plan_pedido: plan, estado: previo.estado === "activo" ? "activo" : "pendiente_pago", pedido: ahora(), nombre: texto(b.nombre, 60) || previo.nombre || null, telefono: texto(b.telefono, 30) || previo.telefono || null };
      await avisarTexto(store, "💎 Pidieron el plan " + PLANES[plan].nombre, `${L[j].nombre || "Un jugador"} quiere el plan ${PLANES[plan].nombre} (USD ${PLANES[plan].usd}/mes). Actívalo en 🌍 Informe global cuando llegue el pago.`, "plan-" + j, "/#robot").catch(() => {});
    }
    await store.setJSON("planes/lista", L);
    return json({ ok: true, plan: L[j] });
  }
  // 🌍 informe global: todo lo que se ha hecho en la app, en todos los juegos, y quién lo hizo
  if (ruta === "global" && req.method === "GET") {
    const lista = await todos(store);
    const corto = (x, n) => (x == null ? null : String(x).slice(0, n));
    return json({
      jugadores: (await store.get("ejecutores/lista", { type: "json" })) || {},
      trabajos: lista.slice(0, 1200).map((t) => ({
        codigo: t.codigo, nombre: corto(t.nombre, 160), organismo: corto(t.organismo, 120), estado: t.estado, accion: t.accion, tipo: t.tipo || null,
        total: t.total, jugador: t.jugador || null, persona: t.persona || null, dispositivo: t.dispositivo || null, empresa: t.empresa || null,
        creado: t.creado, actualizado: t.actualizado, fecha_envio: t.fecha_envio || null, externa: !!t.externa, detalle: corto(t.detalle, 240),
        enviada_t: enviadaT(t),
        items: (t.items || []).slice(0, 6),
        oc_compra: t.oc_compra ? { organismo: corto(t.oc_compra.organismo, 120), unidad: corto(t.oc_compra.unidad, 120), direccion: corto(t.oc_compra.direccion, 160),
          mail: t.oc_compra.mail || null, fono: t.oc_compra.fono || null, nombre: corto(t.oc_compra.nombre, 160),
          items: (t.oc_compra.items || []).slice(0, 6).map((i) => ({ nombre: corto(i.nombre, 80), especificacion: corto(i.especificacion, 100) })) } : null,
        neto: t.neto || null, llamado: t.llamado || t.op?.informe?.llamado || null, prob: t.prob ?? null, por: t.por || null, envios: t.envios || 0,
        op: t.op ? { etapa: t.op.etapa, oc_codigo: t.op.oc_codigo || null, precio_acordado: t.op.precio_acordado || null, proveedor: corto(t.op.proveedor, 80),
          costo_transporte: t.op.costo_transporte || 0, cerrado: t.op.cerrado || null, concretar_pendiente: !!t.op.concretar_pendiente, nos_da: t.op.nos_da ?? null, sin_factura: !!t.op.sin_factura,
          ganada_t: (t.op.historial || []).find((h) => h.etapa === "ganada")?.t || null, historial: (t.op.historial || []).slice(-8).map((h) => ({ t: h.t, etapa: h.etapa })),
          inversionista_nombre: corto(t.op.inversionista_nombre, 40), ejecutor_nombre: corto(t.op.ejecutor_nombre, 40),
          docs: (t.op.docs || []).filter((d) => d.tipo === "oc"),
          informe: t.op.informe ? { final: t.op.informe.final ?? null, utilidad: t.op.informe.utilidad ?? null, repartir: t.op.informe.repartir ?? null, compras: t.op.informe.compras ?? null,
            inversionista: t.op.informe.inversionista ?? null, comision: t.op.informe.comision ?? null, julfior: t.op.informe.julfior ?? null, impuesto: t.op.informe.impuesto ?? null, factoring: t.op.informe.factoring ?? null, iva_pagar: t.op.informe.iva_pagar ?? null,
            direccion: corto(t.op.informe.direccion, 160), comprador: t.op.informe.comprador || null,
            que_comprar: (t.op.informe.que_comprar || []).slice(0, 4).map((x) => ({ que: corto(x.que, 100) })) } : null } : null,
      })),
    });
  }
  if (ruta === "ejecutores" && req.method === "GET") return json({ ejecutores: (await store.get("ejecutores/lista", { type: "json" })) || {} });
  if (ruta === "ejecutor" && req.method === "POST") {
    const b = await cuerpo(req);
    const id = jug(b.id); if (!id) return json({ error: "Falta id" }, 400);
    const L = (await store.get("ejecutores/lista", { type: "json" })) || {};
    if (b.borrar) delete L[id];
    else L[id] = { ...(L[id] || {}), id, nombre: texto(b.nombre, 60) || L[id]?.nombre || "Ejecutador", telefono: texto(b.telefono, 30) ?? L[id]?.telefono ?? null, actualizado: ahora(),
      ...(b.rol !== undefined ? { rol: ["ejecutor", "despachador", "transportista"].includes(b.rol) ? b.rol : L[id]?.rol || null } : {}), ...(b.zona !== undefined ? { zona: texto(b.zona, 80) } : {}), ...(b.disponible !== undefined ? { disponible: !!b.disponible } : {}),
      ...(b.vehiculo !== undefined ? { vehiculo: b.vehiculo && typeof b.vehiculo === "object" ? { nombre: texto(b.vehiculo.nombre, 40), patente: texto(b.vehiculo.patente, 12), tipo: texto(b.vehiculo.tipo, 30) } : null } : {}) };
    await store.setJSON("ejecutores/lista", L);
    return json({ ok: true, ejecutores: L });
  }
  if (ruta === "ejecuta" && req.method === "GET") {      // los negocios que te asignaron para ejecutar
    const id = jug(url.searchParams.get("ejecutor"));
    const todas = url.searchParams.get("todos") === "1";     // ⚓ todas las OC y «vas 1°» quedan ancladas en Ejecuta
    const lista = (await todos(store)).filter((t) => t.op && t.op.etapa !== "rechazada" && !/cancelad|anulad/i.test(t.op.oc_estado || "") && (todas ? (t.op.oc_codigo || t.op.oc || t.op.etapa === "previa" || (id && t.op.ejecutor === id)) : id && t.op.ejecutor === id))
      .map(({ firma, historial, envios, ...t }) => t);
    return json({ negocios: lista });
  }
  // ↩ reabrir: una compra marcada «enviada» por error vuelve a Firmar con su oferta intacta (la firma se conserva en el registro)
  if (ruta === "reabrir" && req.method === "POST") {
    const b = await cuerpo(req); const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    if (!t.firma || !Array.isArray(t.firma.precios)) return json({ error: "Esta compra no tiene una oferta preparada que reabrir: pide prepararla de nuevo." }, 409);
    if (!["enviada", "confirmada", "en_cola", "error"].includes(t.estado)) return json({ trabajo: t, aviso: "Ya está en Firmar." });
    t.accion = "firmar"; delete t.enviada_vista; delete t.fecha_envio;
    anotar(t, "firmar", "Reabierta desde el celular: no se había enviado. Lista para rellenar y firmar.");
    return json({ trabajo: await escribir(store, t) });
  }
  // ---------- 🤝 comisiones: OC concretadas por la app para una empresa socia × su % (GENSA 28%) ----------
  if (ruta === "comisiones" && req.method === "GET") {
    const id = texto(url.searchParams.get("empresa"), 40) || "";
    const L = (await store.get("empresas/lista", { type: "json" })) || {};
    const e = L[id]; if (!e) return json({ error: "Empresa desconocida" }, 404);
    const pct = Number(e.comision) || 0;
    const filas = (await todos(store)).filter((t) => (t.empresa || "principal") === id && t.op && (t.op.oc_codigo || t.op.oc) && !/cancelad|anulad|rechazad/i.test(t.op.oc_estado || ""))
      .map((t) => { const total = Number(t.total) || Number(t.monto) || 0; const neto = Number(t.neto) || Math.round(total / 1.19);
        const fuera = !!t.externa;                       // cotizada fuera de la app: la OC no nació de CotizÁgil → se revisa a mano
        const pagada = !!(t.op.comision_pagada);
        return { codigo: t.codigo, nombre: t.nombre || "", organismo: t.organismo || "", oc: t.op.oc_codigo || t.op.oc, oc_estado: t.op.oc_estado || "", fecha: t.op.oc_fecha || t.actualizado || "",
          total, neto, comision: fuera ? 0 : Math.round(neto * pct / 100), fuera_app: fuera, pagada }; })
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const suma = (f) => filas.filter(f).reduce((s, x) => s + x.comision, 0);
    return json({ empresa: { id, razon_social: e.razon_social, comision: pct, socio_desde: e.socio_desde || null }, ocs: filas,
      resumen: { ocs: filas.length, neto: filas.reduce((s, x) => s + x.neto, 0), comision_total: suma(() => true), por_cobrar: suma((x) => !x.pagada), cobrada: suma((x) => x.pagada), revisar: filas.filter((x) => x.fuera_app).length } });
  }
  if (ruta === "comision-pagada" && req.method === "POST") {   // el dueño de la app marca una comisión como cobrada
    const b = await cuerpo(req); const t = await leer(store, String(b.codigo || "").trim());
    if (!t || !t.op) return json({ error: "Compra desconocida" }, 404);
    t.op.comision_pagada = b.pagada === false ? null : { t: ahora(), nota: texto(b.nota, 200) }; await escribir(store, t);
    return json({ ok: true, pagada: !!t.op.comision_pagada });
  }
  // ---------- 🏢 empresas: cada celular oferta con su RUT y sus datos ----------
  if (ruta === "empresas" && req.method === "GET") {
    return json({ empresas: (await store.get("empresas/lista", { type: "json" })) || {} });
  }
  // ⚡ prioridad de cola por empresa: sus compras ágiles las toma el robot antes que las demás (por horas; 0 = quitar)
  if (ruta === "cola-prioridad") {
    if (req.method === "POST") {
      const b = await cuerpo(req);
      const horas = Math.max(0, Math.min(24, Number(b.horas) || 0)), emp = texto(b.empresa, 40);
      if (!horas || !emp) { await store.delete("cola/prioridad").catch(() => {}); return json({ ok: true, prioridad: null }); }
      const L = (await store.get("empresas/lista", { type: "json" })) || {};
      const p = { empresa: emp, nombre: L[emp]?.razon_social || emp, hasta: new Date(Date.now() + horas * 3600_000).toISOString(), por: texto(b.por, 60), t: ahora() };
      await store.setJSON("cola/prioridad", p);
      return json({ ok: true, prioridad: p });
    }
    const p = (await store.get("cola/prioridad", { type: "json" })) || null;
    return json({ prioridad: p && Date.parse(p.hasta || 0) > Date.now() ? p : null });
  }
  if (ruta === "empresa" && req.method === "POST") {
    const b = await cuerpo(req);
    const rut = String(b.rut || "").replace(/[^0-9kK]/g, "").toUpperCase();
    if (rut.length < 7) return json({ error: "RUT inválido" }, 400);
    const id = (texto(b.id, 40) || "e" + rut).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    const L = (await store.get("empresas/lista", { type: "json" })) || {};
    if (b.borrar) { delete L[id]; await store.setJSON("empresas/lista", L); return json({ ok: true, empresas: L }); }
    const campos = ["razon_social", "rut", "giro", "contacto", "email", "telefono", "direccion", "comuna", "ciudad", "representante", "rut_representante", "despacho", "banco"];
    const e = { ...(L[id] || {}), id, actualizado: ahora() };
    for (const k of campos) if (b[k] !== undefined) e[k] = texto(b[k], 200);
    for (const k of ["descripcion", "web", "region", "nombre_fantasia"]) if (b[k] !== undefined) e[k] = texto(b[k], 400);
    // 🤝 socio comercial: % de comisión para CotizÁgil sobre el neto de cada OC concretada por la app (ej. GENSA 28)
    if (b.comision !== undefined) { const c = Number(String(b.comision).replace(",", ".")); e.comision = Number.isFinite(c) && c >= 0 && c <= 100 ? c : 0; if (e.comision && !e.socio_desde) e.socio_desde = ahora(); }
    if (b.socio_nota !== undefined) e.socio_nota = texto(b.socio_nota, 300);
    if (Array.isArray(b.rubros_app)) e.rubros_app = b.rubros_app.slice(0, 12).map((x) => texto(x, 80)).filter(Boolean);   // 🏢 rubros que esta empresa ve en la app (multiusuario)
    if (b.perfil && typeof b.perfil === "object") {        // 🔎 lo que el robot descubrió con el RUT: rubros, subrubros y aperturas
      const L2 = (v, n, m) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => (typeof x === "object" ? { rubro: texto(x.rubro, 80), por_que: texto(x.por_que, 200) } : texto(x, m)));
      e.perfil = { rubros: L2(b.perfil.rubros, 8, 80), subrubros: L2(b.perfil.subrubros, 14, 80), aperturas: L2(b.perfil.aperturas, 5, 80),
        palabras: L2(b.perfil.palabras, 12, 40), actividades: L2(b.perfil.actividades, 8, 160), confianza: texto(b.perfil.confianza, 10), t: ahora() };
    }
    if (!e.razon_social) return json({ error: "Falta la razón social" }, 400);
    L[id] = e; await store.setJSON("empresas/lista", L);
    return json({ ok: true, empresa: e, empresas: L });
  }

  // ---------- 🔎 ficha de una Compra Ágil cualquiera (para «Me llamaron»: el cliente te da el ID) ----------
  if (ruta === "ficha" && req.method === "GET") {
    const codigo = limpiaCodigo(url.searchParams.get("codigo"));
    if (!/^\d{1,8}-\d{1,8}-COT\d{2}$/.test(codigo)) return json({ error: "Código de Compra Ágil inválido (ej. 1234-56-COT26)" }, 400);
    try {
      const r = await fetch(RADAR_CA + "/" + encodeURIComponent(codigo), { headers: { "user-agent": "CotizAgil/1.0", accept: "application/json" }, signal: AbortSignal.timeout(7000) });
      if (!r.ok) return json({ error: "Mercado Público no respondió (" + r.status + ")" }, 502);
      const p = (await r.json()).payload || {};
      const pc = Array.isArray(p.proveedores_cotizando) ? p.proveedores_cotizando : [];
      const ins = p.institucion || {}, ent = p.entrega || {};
      const montos = pc.filter((x) => x.activo !== 0).map((x) => x.monto_total || 0).filter(Boolean).sort((a, b) => a - b);
      return json({ ficha: {
        codigo, nombre: texto(String(p.nombre || "").trim(), 300), estado: (p.estado || {}).codigo || null, glosa: (p.estado || {}).glosa || null,
        organismo: texto(ins.organismo_comprador, 200), rut_organismo: texto(ins.rut, 20), unidad: texto(ins.unidad_compra, 200), region: texto(ins.nombre_region, 80),
        presupuesto: (p.presupuesto || {}).monto_disponible_clp || null, llamado: (p.convocatoria || {}).descripcion || null, cierre: (p.fechas || {}).fecha_cierre || null,
        direccion: texto(String(ent.direccion_entrega || "").trim(), 200), plazo_dias: ent.plazo_entrega_dias ?? null, descripcion: texto(p.descripcion, 1500),
        productos: (p.productos_solicitados || []).slice(0, 30).map((x) => ({ nombre: texto(x.nombre, 200), detalle: texto(x.descripcion, 300), cantidad: x.cantidad, unidad: texto(x.unidad_medida, 20) })),
        ofertas: pc.length, mas_baja: montos[0] ?? null, mas_alta: montos[montos.length - 1] ?? null,
        proveedores: pc.slice(0, 12).map((x) => ({ nombre: texto(x.razon_social, 120), total: x.monto_total || null, seleccionado: !!x.proveedor_seleccionado })),
        ganador: texto((pc.find((x) => x.proveedor_seleccionado) || {}).razon_social, 120), oc: p.id_orden_compra || null,
      } });
    } catch (e) { return json({ error: "No pude consultar Mercado Público: " + String(e.message || e).slice(0, 100) }, 502); }
  }

  // ---------- 💹 costo de mercado real (el PC lo busca con IA en tiendas chilenas para cada seleccionada) ----------
  // 🧾 fuentes por ítem que usó el robot al preparar (proveedor, URL, precio observado, fecha) y el costo base que explica el precio
  if (ruta === "fuentes" && req.method === "POST") {
    const b = await cuerpo(req), codigo = limpiaCodigo(b.codigo); if (!codigo) return json({ error: "Falta el código" }, 400);
    const t = await leer(store, codigo); if (!t) return json({ error: "No existe." }, 404);
    const map = {}; (Array.isArray(b.items) ? b.items : []).slice(0, 40).forEach((i, k) => { map[lineaId(k, i)] = { fuentes: normFuentes(i.fuentes), costo_base: normCostoBase(i.costo_base) }; });
    if (Array.isArray(t.items) && t.items.length) { t.items = t.items.map((it, k) => { const f = map[it.lid || "L" + (k + 1)]; return f ? { ...it, lid: it.lid || "L" + (k + 1), fuentes: f.fuentes, costo_base: f.costo_base } : it; });
      const v = (t.versiones || []).find((x) => x.id === t.version_actual); if (v) v.items = v.items.map((it, k) => ({ ...it, ...(map[it.lid || "L" + (k + 1)] || {}) })); }
    else t._fuentes_pend = map;
    await escribir(store, t); return json({ ok: true, n: Object.keys(map).length });
  }
  if (ruta === "mercado" && req.method === "GET") return json({ mercado: (await store.get("mercado/lista", { type: "json" })) || {} });
  if (ruta === "mercado" && req.method === "POST") {
    const b = await cuerpo(req), codigo = limpiaCodigo(b.codigo), m = b.mercado || {};
    if (!codigo) return json({ error: "Falta el código" }, 400);
    const L = (await store.get("mercado/lista", { type: "json" })) || {};
    L[codigo] = { t: ahora(), total_neto: Math.round(Number(m.total_neto) || 0) || null, total_con_iva: Math.round(Number(m.total_con_iva) || 0) || null,
      completo: !!m.completo, fuente: texto(m.fuente, 60), nota: texto(m.nota, 240),
      items: (Array.isArray(m.items) ? m.items : []).slice(0, 15).map((i) => ({ n: texto(i.nombre, 90), q: Number(i.cantidad) || null, u: Math.round(Number(i.unit_neto) || 0) || null, f: (i.fuentes || []).length || 0 })) };
    const ks = Object.keys(L).sort((a, b2) => (L[b2].t || "").localeCompare(L[a].t || "")); for (const k of ks.slice(400)) delete L[k];
    await store.setJSON("mercado/lista", L);
    return json({ ok: true });
  }

  // ---------- ⏰ recordatorios (llegan como aviso al teléfono) ----------
  if (ruta === "recordar" && req.method === "POST") {
    const b = await cuerpo(req);
    const L = (await store.get("recordatorios", { type: "json" })) || [];
    if (b.quitar) { const n = L.filter((x) => x.id !== b.quitar); await store.setJSON("recordatorios", n); return json({ ok: true, recordatorios: n }); }
    const cuando = Date.parse(b.cuando) || Date.now() + (Number(b.minutos) || 60) * 60000;
    const r = { id: idCorto(), codigo: limpiaCodigo(b.codigo) || null, texto: texto(b.texto, 300) || "Recordatorio", cuando: new Date(cuando).toISOString(), creado: ahora() };
    L.push(r); await store.setJSON("recordatorios", L.slice(-200));
    return json({ ok: true, recordatorio: r, recordatorios: L });
  }
  if (ruta === "recordatorios" && req.method === "GET") return json({ recordatorios: (await store.get("recordatorios", { type: "json" })) || [] });

  // ---------- 📞 «Me llamaron»: el celular pregunta (texto o audio) y el robot del PC responde con IA ----------
  // ---------- 💬 chat con Claude dentro de la app: el cerebro responde directo desde la nube (sin pasar por el PC) ----------
  if (ruta === "informe-link") {                                     // el dueño pide el link público de un informe (con su clave)
    const id = (url.searchParams.get("id") || "gensa").replace(/[^\w-]/g, "").slice(0, 40);
    const inf = (await store.get(`informes/${id}`, { type: "json" })) || { resp: {} };
    return json({ id, url: `${process.env.URL || "https://cotizagil.netlify.app"}/informes/${id}.html?k=${informeClave(id)}`, resp: inf.resp || {}, ultimo: inf.ultimo || null });
  }
  if (ruta === "cerebro" && req.method === "POST") {
    const key = process.env.ANTHROPIC_API_KEY || "";
    if (!key) return json({ error: "Falta ANTHROPIC_API_KEY en Netlify (Site configuration → Environment variables). Con eso Claude responde aquí mismo." }, 503);
    const b = await cuerpo(req);
    const msgs = (Array.isArray(b.mensajes) ? b.mensajes : []).slice(-16)
      .map((m) => ({ role: m.rol === "claude" ? "assistant" : "user", content: texto(m.texto, 4000) })).filter((m) => m.content);
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") return json({ error: "Falta tu mensaje" }, 400);
    const L = (await store.get("empresas/lista", { type: "json" })) || {};
    const e = L[texto(b.empresa, 40)] || null;
    const cod = limpiaCodigo(b.codigo) || null;
    const t = cod ? await leer(store, cod) : null;
    const mios = e ? (await todos(store)).filter((x) => (x.empresa || "principal") === e.id).slice(0, 25)
      .map((x) => `- ${x.codigo} · ${x.nombre || ""} · ${x.organismo || ""} · estado ${x.estado}${x.total ? " · $" + x.total : ""}${x.op?.oc_codigo ? " · OC " + x.op.oc_codigo : ""}`).join("\n") : "";
    const sistema = [
      "Eres Claude, el cerebro de CotizÁgil (app «Socios de Crecimiento» de PJANIC SpA) que ayuda a pymes chilenas a vender al Estado por Mercado Público: Compra Ágil (<100 UTM) y licitaciones.",
      "Hablas en español de Chile, directo y corto (es un celular). Das números cuando los pides; si falta un dato, dices cuál y propones un supuesto.",
      "Nunca firmas, envías ni declaras nada en Mercado Público: eso lo hace la persona. No manejas claves ni pagos.",
      e ? `Empresa del usuario: ${e.razon_social} (RUT ${e.rut || "?"}), giro: ${e.giro || "?"}, comuna: ${e.comuna || e.ciudad || "?"}.${e.comision ? ` Es socia comercial: CotizÁgil recibe ${e.comision}% del neto de cada OC concretada por la app.` : ""}${e.perfil?.rubros?.length ? " Rubros: " + e.perfil.rubros.map((r) => r.rubro || r).join(", ") + "." : ""}` : "El usuario aún no eligió empresa.",
      t ? `Compra en pantalla: ${t.codigo} · ${t.nombre || ""} · ${t.organismo || ""} · estado ${t.estado} · total ofertado ${t.total || "?"}. Ítems: ${(t.items || []).slice(0, 12).map((i) => `${i.nombre || i.descripcion} x${i.cantidad}${i.precio_unit ? " a $" + i.precio_unit : ""}`).join("; ")}` : "",
      mios ? "Compras recientes de esta empresa en la app:\n" + mios : "",
    ].filter(Boolean).join("\n\n");
    // 📑 Licitaciones: Claude lee las bases y anexos (PDF) subidos a la compra y trabaja como licitador: resume, arma checklist, calcula y pregunta
    const esLic = cod && /-(LE|LP|LQ|LR|LS|L1|R1|CO)\d{2}$/i.test(cod);
    const docsPdf = t ? (t.lic_docs || []).filter((d) => /pdf/i.test(d.mime || "")).slice(-4) : [];
    const bloques = []; let kb = 0;
    for (const d of docsPdf) { if (kb + (d.kb || 0) > 7000) break; const buf = await store.get(`doc/${t.codigo}/${d.id}`, { type: "arrayBuffer" }).catch(() => null); if (!buf) continue; kb += d.kb || 0;
      bloques.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(buf).toString("base64") }, title: d.nombre || "documento", cache_control: { type: "ephemeral" } }); }
    const modoLlamada = b.modo === "llamada" && t;
    const sistemaLlamada = modoLlamada ? `\n\nMODO «ME LLAMARON»: el comprador (${t.organismo || "organismo"}) acaba de llamar por esta compra. Responde SOLO con un JSON (sin texto fuera) con estas claves: que_hacer (1–2 frases concretas en español de Chile: qué hay que comprar o hacer, cantidades y unidades reales de los ítems, y dónde dejarlo), entrega (lugar/comuna de entrega y plazo si se sabe), donde_comprar (lista de hasta 3 {nombre, url} de tiendas o distribuidores chilenos reales donde se compra eso; si no estás seguro de una URL exacta, usa la URL de búsqueda del sitio), como_lo_haria (un párrafo: cómo ejecutarías el negocio paso a paso desde la comuna de la empresa hasta el lugar de entrega: comprar dónde, flete en qué, cuánto demora, cuándo entregar, cuándo facturar y cobrar; georreferencia real de distancias aproximadas), utilidad_estimada (texto corto con número en pesos y supuesto de costo), ojo (lista de hasta 3 riesgos: multas por atraso, recepción conforme, peso/volumen, etc.). Datos: oferta total ${t.total || "?"} con IVA; ítems: ${(t.items || []).slice(0, 10).map((i) => `${i.d || i.nombre || i.descripcion} x${i.q || i.cantidad || "?"}${i.p ? " a $" + i.p : ""}`).join("; ")}; OC: ${t.op?.oc_codigo || t.oc_compra?.oc_codigo || "sin OC aún"}; dirección de entrega: ${t.oc_compra?.direccion || t.op?.informe?.direccion || "no indicada"}; empresa en ${e?.comuna || e?.ciudad || "Santiago"}.` : "";
    const sistemaFinal = sistema + sistemaLlamada + (esLic ? "\n\nEsta compra es una LICITACIÓN. Actúa como el licitador socio del usuario: lee las bases y anexos adjuntos; resume qué piden, plazos (cierre, consultas, visita, entrega), garantías (seriedad y fiel cumplimiento), criterios de evaluación con sus ponderaciones, multas y documentos/anexos que hay que presentar; da el checklist en orden; calcula el precio para ganar con margen; señala riesgos; y TERMINA SIEMPRE con la siguiente decisión concreta que el usuario debe tomar (una pregunta). No digas que estás «revisando documentos»: responde con el contenido." : "");
    if (bloques.length) { const last = msgs[msgs.length - 1]; last.content = [...bloques, { type: "text", text: last.content }]; }
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: esLic ? 1400 : modoLlamada ? 1000 : 900, system: sistemaFinal, messages: msgs }) });
    if (!r.ok) { const err = await r.text().catch(() => ""); return json({ error: "Claude no respondió (" + r.status + "): " + err.slice(0, 200) }, 502); }
    const d = await r.json();
    const out = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    return json({ ok: true, respuesta: out || "…" });
  }
  if (ruta === "preguntar" && req.method === "POST") {
    const b = await cuerpo(req);
    const id = idCorto();
    const audio = typeof b.audio_b64 === "string" && b.audio_b64.length < 5_500_000 ? b.audio_b64 : null;
    await store.setJSON("asistente/" + id, { id, creado: ahora(), estado: "pendiente", texto: texto(b.texto, 2000), codigo: limpiaCodigo(b.codigo) || null,
      empresa: texto(b.empresa, 40), dispositivo: texto(b.dispositivo, 60), audio: !!audio, mime: texto(b.mime, 40),
      tipo: texto(b.tipo, 20), rut: texto(b.rut, 20) });
    if (audio) await store.set("asistente-audio/" + id, audio);
    const cola = (await store.get("asistente-cola", { type: "json" })) || [];
    await store.setJSON("asistente-cola", [...cola, id].slice(-30));
    return json({ ok: true, id });
  }
  if (ruta === "respuesta" && req.method === "GET") {
    const x = await store.get("asistente/" + String(url.searchParams.get("id") || "").replace(/[^a-z0-9]/g, ""), { type: "json" });
    return x ? json({ pregunta: x }) : json({ error: "No existe" }, 404);
  }
  if (ruta === "audio" && req.method === "GET") {        // el PC baja el audio para transcribirlo
    const a = await store.get("asistente-audio/" + String(url.searchParams.get("id") || "").replace(/[^a-z0-9]/g, ""));
    return a ? json({ b64: a }) : json({ error: "Sin audio" }, 404);
  }
  if (ruta === "responder" && req.method === "POST") {   // el PC entrega la respuesta
    const b = await cuerpo(req);
    const id = String(b.id || "").replace(/[^a-z0-9]/g, "");
    const x = await store.get("asistente/" + id, { type: "json" });
    if (!x) return json({ error: "No existe" }, 404);
    Object.assign(x, { estado: b.error ? "error" : "lista", respondido: ahora(), error: texto(b.error, 300), transcripcion: texto(b.transcripcion, 2000),
      respuesta: b.respuesta && typeof b.respuesta === "object" ? b.respuesta : null });
    await store.setJSON("asistente/" + id, x);
    await store.delete("asistente-audio/" + id).catch(() => {});
    const cola = (await store.get("asistente-cola", { type: "json" })) || [];
    await store.setJSON("asistente-cola", cola.filter((k) => k !== id));
    if (!b.error && x.tipo !== "empresa") await avisarTexto(store, "📞 Respuesta lista", texto((b.respuesta || {}).titular || x.texto || "Tu consulta", 120), "asis-" + id, "/#robot");
    return json({ ok: true });
  }

  // ---------- robot del PC ----------
  if (ruta === "latido" && req.method === "POST") {
    const b = await cuerpo(req);
    // 🎫 el robot comparte el ticket de la API oficial (nube.json → ticket_api) para que la nube lea Compra Ágil por su cuenta
    if (typeof b.ticket_api === "string" && /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(b.ticket_api)) {
      const T = (await store.get("config/ticket_api", { type: "json" })) || {};
      if (T.ticket !== b.ticket_api) await store.setJSON("config/ticket_api", { ticket: b.ticket_api, equipo: texto(b.equipo, 60), t: ahora() });
    }
    // 🔐 conectar Mercado Público desde el celular: SOLO el robot del PC (ClaveÚnica bloquea los servidores en la nube)
    let loginMP = null;
    {
      const eqL = texto(b.equipo, 60) || "pc";
      if (/nube/i.test(eqL)) {            // ☁️ la nube recibe la SESIÓN cifrada que inició el PC (nunca la clave)
        if (typeof b.pub === "string" && b.pub.length < 1500) {
          const PN = (await store.get("login/pub_nube", { type: "json" })) || {};
          if (PN.pub !== b.pub || Date.now() - Date.parse(PN.t || 0) > 600_000) await store.setJSON("login/pub_nube", { pub: b.pub, equipo: eqL, t: ahora() });
        }
        const SS = await store.get("login/sesion", { type: "json" });
        if (SS && SS.datos && !SS.entregado) {
          loginMP = null;
          b._mp_sesion = { llave: SS.llave, iv: SS.iv, datos: SS.datos };
          await store.setJSON("login/sesion", { t: SS.t, entregado: ahora() });     // la sesión cifrada se borra apenas sale
        }
      } else {
        if (typeof b.pub === "string" && b.pub.length < 1500) {
          const PB = (await store.get("login/pub", { type: "json" })) || {};
          if (PB.pub !== b.pub || PB.equipo !== eqL || Date.now() - Date.parse(PB.t || 0) > 600_000) await store.setJSON("login/pub", { pub: b.pub, equipo: eqL, t: ahora() });
        }
        const LP = await store.get("login/pedido", { type: "json" });
        if (LP && LP.sobre && Date.now() - Date.parse(LP.t) < 300_000) {
          loginMP = { id: LP.id, sobre: LP.sobre };
          await store.setJSON("login/pedido", { id: LP.id, t: LP.t, sobre: null, entregado: ahora(), equipo: eqL });   // la clave cifrada se borra apenas sale
        }
      }
    }
    // 🎖 UN SOLO ROBOT AL MANDO: Mercado Público acepta una sesión por usuario; si dos robots trabajan se botan entre sí.
    // Manda el preferido (lo elige el dueño: PC o nube) si está vivo; si no, el que ya mandaba; si nadie, el primero que llega.
    {
      const eqM = texto(b.equipo, 60) || "pc", M = (await store.get("robot/mando", { type: "json" })) || {};
      const fresco = M.equipo && Date.now() - Date.parse(M.visto || 0) < 90_000;
      const esPref = (e) => (M.preferido === "nube" ? /nube/i.test(e || "") : M.preferido === "pc" ? !/nube/i.test(e || "") : false);
      const manda = !fresco || M.equipo === eqM || (esPref(eqM) && !esPref(M.equipo)) ? eqM : M.equipo;
      if (manda !== eqM) {
        const E2 = (await store.get("robot/equipos", { type: "json" })) || {};
        E2[eqM] = { visto: ahora(), ocupado: !!b.ocupado, version: texto(b.version, 20), pausa: true };
        await store.setJSON("robot/equipos", E2);
        return json({ pausa: true, manda, pendientes: true, ...(loginMP ? { login_mp: loginMP } : {}), ...(b._mp_sesion ? { mp_sesion: b._mp_sesion } : {}), motivo: `El robot «${manda}» está a cargo: este espera para no cerrar su sesión de Mercado Público.` });
      }
      if (M.equipo !== eqM) await avisarTexto(store, "🎖 Robot a cargo: " + eqM, M.equipo ? `Tomó el mando desde «${M.equipo}». Solo uno trabaja con tu sesión de Mercado Público.` : "Trabajando.", "mando", "/#robot").catch(() => {});
      await store.setJSON("robot/mando", { ...M, equipo: eqM, visto: ahora(), desde: M.equipo === eqM ? M.desde : ahora() });
    }
    await store.setJSON("robot/latido", {
      visto: ahora(), ocupado: !!b.ocupado, tarea: texto(b.tarea, 200), equipo: texto(b.equipo, 60), version: texto(b.version, 20),
      rut: texto(b.rut, 20), correo: !!b.correo,
    });
    // 🖥🖥 varios robots (PC de escritorio + notebook): cada uno se registra y la cola se reparte sin duplicar
    const eq = texto(b.equipo, 60) || "pc";
    const E = (await store.get("robot/equipos", { type: "json" })) || {};
    E[eq] = { visto: ahora(), ocupado: !!b.ocupado, version: texto(b.version, 20) };
    for (const k of Object.keys(E)) if (Date.now() - Date.parse(E[k].visto) > 600_000) delete E[k];
    await store.setJSON("robot/equipos", E);
    const vivos = Object.keys(E).filter((k) => Date.now() - Date.parse(E[k].visto) < 90_000 && !E[k].pausa).sort();   // los pausados no reciben trabajo
    const hashTxt = (x) => [...String(x)].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261) >>> 5;   // FNV-1a
    const dueno = (x) => (vivos.length < 2 ? eq : vivos[hashTxt(x) % vivos.length]);
    const mio = (x) => dueno(x) === eq || !vivos.includes(dueno(x));
    const pidio = await store.get("oportunidades/pedido", { type: "json" });   // la app pidió actualizar oportunidades
    if (pidio) await store.delete("oportunidades/pedido");
    const lista = await todos(store);
    const negocios = lista.filter((t) => t.op?.pedido_informe && mio(t.codigo)).map((t) => ({ codigo: t.codigo, total: t.total, op: t.op, externa: !!t.externa, oc_compra: t.oc_compra || null })).slice(0, 5);
    // preguntas del asistente que esperan al PC (las tomadas hace más de 3 min se reintentan)
    const cola = (await store.get("asistente-cola", { type: "json" })) || [];
    const preguntas = [];
    for (const id of cola) {
      if (!mio(id)) continue;
      const x = await store.get("asistente/" + id, { type: "json" });
      if (x && (x.estado === "pendiente" || (x.estado === "tomada" && Date.now() - Date.parse(x.tomada) > 180_000))) {
        x.estado = "tomada"; x.tomada = ahora(); await store.setJSON("asistente/" + id, x); preguntas.push(x);
        if (preguntas.length >= 2) break;
      }
    }
    // recordatorios vencidos: aviso al teléfono
    const rec = (await store.get("recordatorios", { type: "json" })) || [];
    const vencidos = rec.filter((r) => !r.avisado && Date.parse(r.cuando) <= Date.now());
    if (vencidos.length) {
      for (const r of vencidos) { r.avisado = ahora(); await avisarTexto(store, "⏰ " + (r.codigo || "Recordatorio"), r.texto, "rec-" + r.id, r.codigo ? "/#robot=" + r.codigo : "/#robot", true); }
      await store.setJSON("recordatorios", rec);
    }
    // 🔎 cada 5 min el latido del PC revisa el portal: así llegan los avisos «vas 1°» aunque nadie tenga la app abierta
    const segAuto = (await store.get("seguimiento/auto", { type: "json" })) || {};
    if (Date.now() - Date.parse(segAuto.t || 0) > 5 * 60_000) {
      await store.setJSON("seguimiento/auto", { t: ahora() });
      try { await revisarSeguimiento(store, false); } catch {}
    }
    // 📦 cada 10 min: las órdenes de compra nuevas (todas, también las cotizadas por fuera)
    const ocAuto = (await store.get("oc/auto", { type: "json" })) || {};
    if (Date.now() - Date.parse(ocAuto.t || 0) > 10 * 60_000) {
      await store.setJSON("oc/auto", { t: ahora() });
      try { await revisarOCs(store, false); } catch {}
    }
    const empresas = (await store.get("empresas/lista", { type: "json" })) || {};
    // 📧 correo: este PC envía la cola y vigila la bandeja (qué compras, proveedores y mensajes esperar)
    let correos = [], vigilar = null;
    if (b.correo) {
      const cola = (await store.get("correo/cola", { type: "json" })) || [];
      const yo = texto(b.equipo, 60) || "pc";
      correos = cola.filter((x) => !x.tomado || Date.now() - Date.parse(x.tomado) > 5 * 60_000).slice(0, 10);
      if (correos.length) { for (const x of correos) { x.tomado = ahora(); x.por = yo; } await store.setJSON("correo/cola", cola); }
      const hace15 = Date.now() - 15 * 864e5;
      vigilar = lista.filter((t) => (t.op && !["cerrado", "rechazada"].includes(t.op.etapa)) || ((t.estado === "enviada" || t.estado === "confirmada") && Date.parse(t.actualizado || t.creado || 0) > hace15))
        .slice(0, 120).map((t) => {
          const op = t.op || {}, inf = op.informe || {}, emails = {}, msgids = {};
          const kk = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
          for (const o of [...(inf.opciones || []), ...(op.extras || [])]) if (o.email && o.proveedor) emails[String(o.email).toLowerCase()] = kk(o.proveedor);
          for (const c of op.correos || []) { if (c.mid) msgids[c.mid] = c.k || null; if (c.to && c.k) emails[String(c.to).toLowerCase()] = c.k; }
          return { codigo: t.codigo, nombre: texto(t.nombre, 120), oc: op.oc_codigo || null, palabras: [t.codigo, op.oc_codigo].filter(Boolean),
            emails, msgids, mail_cliente: t.oc_compra?.mail || inf.comprador?.email || null,
            que: (inf.que_comprar || inf.productos || []).slice(0, 6).map((x) => `${x.cantidad ?? ""} ${x.unidad || ""} ${x.que || x.nombre || ""}`.trim()).join("; ") };
        });
    }
    // 📄 OC sin su PDF oficial: el PC lo baja del portal (reintenta cada 30 min)
    const ocs_pdf = [];
    for (const tt of lista) {
      const o = tt.op; if (!o?.oc_codigo || ["rechazada"].includes(o.etapa) || (o.docs || []).some((d) => d.tipo === "oc")) continue;
      if (o.oc_pdf_intento && Date.now() - Date.parse(o.oc_pdf_intento) < 30 * 60_000) continue;
      if (!mio(tt.codigo) || ocs_pdf.length >= 3) continue;
      o.oc_pdf_intento = ahora(); await escribir(store, tt); ocs_pdf.push({ codigo: tt.codigo, oc: o.oc_codigo });
    }
    // ✍️ firma nueva para el PC y 🎨 visualizaciones pedidas
    const firmaMeta = (await store.get("firma/meta", { type: "json" })) || null;
    const visiones = [];
    for (const tt of lista) {
      const v = tt.lic_vision; if (!v || visiones.length >= 2) continue;
      if ((v.hechas || []).length >= (v.vistas || []).length) continue;
      if (v.tomada && Date.now() - Date.parse(v.tomada) < 10 * 60_000) continue;
      v.tomada = ahora(); await escribir(store, tt);
      visiones.push({ codigo: tt.codigo, vistas: v.vistas.filter((x) => !(v.hechas || []).includes(x)), nota: v.nota || "", producto: tt.lic?.producto || tt.nombre || "",
        resumen: tt.lic?.resumen || "", vision: tt.lic?.experto?.vision || null, lugar: tt.lic?.lugar_entrega || "", items: (tt.lic?.items || []).slice(0, 8) });
    }
    // 📥 todas las OC que aún no tienen su PDF: si la persona lo descarga en el PC, el robot lo sube solo
    const oc_sin_pdf = lista.filter((tt) => tt.op?.oc_codigo && tt.op.etapa !== "rechazada" && !(tt.op.docs || []).some((d) => d.tipo === "oc")).slice(0, 40).map((tt) => ({ codigo: tt.codigo, oc: tt.op.oc_codigo }));
    // 💬 conversaciones que esperan que la IA del PC las lea y conteste
    const chats = [];
    const cq = (await store.get("chat/cola", { type: "json" })) || [];
    for (const x of cq) {
      if (chats.length >= 4) break;
      if (x.tomado && Date.now() - Date.parse(x.tomado) < 180_000) continue;
      const tt = lista.find((y) => y.codigo === x.codigo);
      if (!tt) continue;
      x.tomado = ahora(); chats.push(contextoChat(tt, x.k));
    }
    if (chats.length) await store.setJSON("chat/cola", cq.filter((x) => lista.some((y) => y.codigo === x.codigo)));
    const op = { ...(pidio ? { oportunidades: true } : {}), ...(negocios.length ? { negocios } : {}), ...(preguntas.length ? { preguntas } : {}), empresas, equipos: vivos,
      ...(correos.length ? { correos } : {}), ...(vigilar ? { vigilar } : {}), ...(chats.length ? { chats } : {}), ...(ocs_pdf.length ? { ocs_pdf } : {}), ...(oc_sin_pdf.length ? { oc_sin_pdf } : {}),
      ...(firmaMeta ? { firma: firmaMeta } : {}), ...(visiones.length ? { visiones } : {}), ...(loginMP ? { login_mp: loginMP } : {}), ...(b._mp_sesion ? { mp_sesion: b._mp_sesion } : {}) };
    // ⚡ lo que pide una persona desde el celular va antes que el autopiloto del PC
    const humano = (t) => !!(t.jugador || t.dispositivo);
    // un pedido es de este equipo si le toca por reparto, o si al dueño lo tienen ocupado y es de una persona (no se hace esperar)
    const mioT = (t) => mio(t.codigo) || (humano(t) && E[dueno(t.codigo)]?.ocupado);
    const enCola = lista.filter((t) => t.estado === "en_cola" && mioT(t));
    if (b.ocupado) return json({ siguiente: null, ...op, ...(enCola.some(humano) ? { espera_celular: true } : {}) });
    // un pedido tomado que quedó colgado (PC apagado a mitad de camino) vuelve a la cola
    for (const t of lista) {
      if (t.estado === "tomado" && Date.now() - Date.parse(t.actualizado) > TOMADO_VENCE_MS) {
        anotar(t, "en_cola", "El robot no alcanzó a empezarla; vuelve a la cola.");
        await escribir(store, t);
      } else if (t.estado === "preparando" && Date.now() - Date.parse(t.actualizado) > 8 * 60_000) {
        anotar(t, "en_cola", "Se cortó mientras se preparaba (el robot se reinició); vuelve a la cola.");   // 🔁 preparación colgada
        await escribir(store, t);
      }
    }
    // 🛣️ DOS CARRILES: la "tarea" del latido es el carril de COMPRAS ÁGILES. Si va ocupado, solo ofrecemos
    // licitaciones (que corren en su carril aparte); si ya hay una licitación procesándose, no ofrecemos otra.
    // Así una licitación nunca espera detrás de una compra ágil, y no se marcan trabajos "tomado" sin ejecutarse.
    // 🚦 el robot nos dice el estado EXACTO de cada carril (busy_agil / busy_lic): usamos ese mismo semáforo,
    // así no ofrecemos una compra que el robot no va a tomar. (Clientes viejos: caemos a la señal por «tarea».)
    const agilOcupado = b.busy_agil !== undefined ? !!b.busy_agil : !!texto(b.tarea, 200);
    const licOcupado = b.busy_lic !== undefined ? !!b.busy_lic
      : lista.some((t) => ["lic_bajando", "lic_captcha", "lic_analizando", "lic_ingresando"].includes(t.estado));
    const esLic = (t) => String(t.accion || "").startsWith("lic") || t.tipo === "licitacion";
    // 🚧 LICITACIONES EN PAUSA (hasta que Felipe diga). El licitador abre una SEGUNDA sesión de Mercado Público (perfil
    // aparte) y tener dos sesiones de MP abiertas confunde al portal y BOTA la sesión de compra ágil → "se sale de MP".
    // Con esto el robot NO recibe NINGUNA tarea de licitación → nunca abre esa segunda sesión → MP queda estable.
    // Para reactivar licitaciones: poner LICITADOR_OFF = false.
    const LICITADOR_OFF = true;
    let cola2 = lista.filter((t) => t.estado === "en_cola" && mioT(t));
    if (LICITADOR_OFF) cola2 = cola2.filter((t) => !esLic(t));
    if (agilOcupado) cola2 = cola2.filter(esLic);
    if (licOcupado) cola2 = cola2.filter((t) => !esLic(t));
    // 🆘 RESCATE: este robot está libre (si no, ya salió arriba por b.ocupado). Si por el reparto no le toca ninguna,
    // igual toma las que están ESPERANDO: más vale un robot libre trabajando que cotizaciones en cola porque el equipo
    // "dueño" quedó ocupado o colgado. Respeta el carril (ágiles/licitaciones) y solo toma una por latido.
    if (!cola2.length) {
      let rescate = lista.filter((t) => t.estado === "en_cola");
      if (LICITADOR_OFF) rescate = rescate.filter((t) => !esLic(t));
      if (agilOcupado) rescate = rescate.filter(esLic);
      if (licOcupado) rescate = rescate.filter((t) => !esLic(t));
      cola2 = rescate;
    }
    // 🌿 RAMIFICAR por equipo/jugador: reparto JUSTO (round-robin). Los pedidos de tu iPhone, el de Cristopher y el
    // compu grande no se tapan entre sí: va primero el equipo que fue atendido hace más rato, así cada uno avanza por turno.
    const servido = (await store.get("cola/servido", { type: "json" })) || {};
    // 🏢 cada EMPRESA es su propia cola: NS Comex nunca se mezcla ni espera detrás de PJANIC (y al revés). El turno
    //    se reparte por empresa+persona. ⚡ Y si alguien pidió prioridad para una empresa (cola-prioridad), esa va primero.
    const prio = (await store.get("cola/prioridad", { type: "json" })) || null;
    const prioOn = prio && prio.empresa && Date.parse(prio.hasta || 0) > Date.now();
    const empDe = (t) => texto(t.empresa, 40) || "principal";
    const quien = (t) => empDe(t) + "|" + (texto(t.jugador || t.dispositivo || "_", 60) || "_");
    const esPrio = (t) => (prioOn && empDe(t) === prio.empresa ? 1 : 0);
    const siguiente = cola2.sort((a, b) => (esPrio(b) - esPrio(a))
      || (humano(b) - humano(a))
      || (servido[quien(a)] || "").localeCompare(servido[quien(b)] || "")   // empresa/persona menos atendida primero
      || a.creado.localeCompare(b.creado))[0];
    if (!siguiente) return json({ siguiente: null, ...op });
    servido[quien(siguiente)] = ahora();                                     // este equipo pasa al final de su turno
    for (const k of Object.keys(servido)) if (Date.now() - Date.parse(servido[k]) > 864e5) delete servido[k];
    await store.setJSON("cola/servido", servido);
    anotar(siguiente, "tomado", "El robot la tomó.");
    return json({ siguiente: await escribir(store, siguiente), ...op });
  }

  if (ruta === "reportar" && req.method === "POST") {
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    for (const k of ["total", "neto", "iva"]) if (b[k] != null) t[k] = Number(b[k]) || null;
    for (const k of ["plazo", "nombre", "organismo"]) if (b[k] != null) t[k] = texto(b[k], 200);
    if (b.detalle != null) t.detalle = texto(b.detalle, 1500);
    if (Array.isArray(b.items)) t.items = b.items.slice(0, 40).map((i, k) => ({
      d: texto(i.d, 200), q: Number(i.q) || 0, p: Number(i.p) || 0, lid: lineaId(k, i),
      costo_base: normCostoBase(i.costo_base || (i.costo_neto_unit != null ? { neto_unit: i.costo_neto_unit, metodo: i.metodo, fuente_idx: i.fuente_idx } : null)), fuentes: normFuentes(i.fuentes),
    }));
    // fuentes subidas antes por el robot (/bot/fuentes) se incorporan si los ítems no las traen
    if (t._fuentes_pend && Array.isArray(t.items)) { t.items.forEach((it, k) => { const f = t._fuentes_pend[it.lid] || t._fuentes_pend["L" + (k + 1)]; if (f && !it.fuentes?.length) { it.fuentes = f.fuentes || []; it.costo_base = it.costo_base || f.costo_base || null; } }); delete t._fuentes_pend; }
    if (b.fecha_envio) t.fecha_envio = texto(b.fecha_envio, 40);
    if (b.firma && Array.isArray(b.firma.precios)) {   // datos para el botón Rellenar
      t._nuevaVersion = true;
      t.firma = {
        precios: b.firma.precios.slice(0, 60).map((x) => Math.max(0, Math.round(Number(x) || 0))),
        despacho: Math.max(0, Math.round(Number(b.firma.despacho) || 0)),
        detalle: texto(b.firma.detalle, 255) || "",
        total: Math.round(Number(b.firma.total) || 0),
        adjunto: texto(b.firma.adjunto, 120),
        aviso: texto(b.firma.aviso, 300),
        alertas: (Array.isArray(b.firma.alertas) ? b.firma.alertas : []).slice(0, 12).map((a) => ({
          nivel: a?.nivel === "rojo" ? "rojo" : "amarillo", texto: texto(a?.texto, 240) || "",
        })).filter((a) => a.texto),
      };
    }
    if (b.lic && typeof b.lic === "object") {       // análisis de licitación para aprobar en la app
      const L = b.lic, num = (x) => (x == null || x === "" ? null : Math.round(Number(x) || 0));
      t.lic = {
        presupuesto: num(L.presupuesto), con_iva: !!L.con_iva, descuento: Number(L.descuento) || 0,
        precio_unit: num(L.precio_unit), cantidad: Number(L.cantidad) || null, unidad: texto(L.unidad, 30),
        neto: num(L.neto), iva: num(L.iva), total: num(L.total), cierre: texto(L.cierre, 40),
        resumen: texto(L.resumen, 1200), producto: texto(L.producto, 300),
        criterios: (Array.isArray(L.criterios) ? L.criterios : []).slice(0, 12).map((c) => ({
          nombre: texto(c?.nombre, 120), peso: texto(c?.peso, 20), propuesta: texto(c?.propuesta, 240), confirmar: !!c?.confirmar })),
        comparables: (Array.isArray(L.comparables) ? L.comparables : []).slice(0, 8).map((c) => texto(c, 240)),
        alertas: (Array.isArray(L.alertas) ? L.alertas : []).slice(0, 15).map((a) => ({
          nivel: a?.nivel === "rojo" ? "rojo" : "amarillo", texto: texto(a?.texto, 260) || "" })).filter((a) => a.texto),
        documentos: (Array.isArray(L.documentos) ? L.documentos : []).slice(0, 20).map((d) => ({
          nombre: texto(d?.nombre, 120), estado: texto(d?.estado, 120), seccion: texto(d?.seccion, 40) })),
        firmados: !!L.firmados,
        // 🧠 lectura experta de las bases (habilidad, admisibilidad, garantías, evaluación, contrato, foro, plan y visión)
        experto: limpiaJSON(L.experto, 0),
        items: (Array.isArray(L.items) ? L.items : []).slice(0, 30).map((i) => ({ descripcion: texto(i?.descripcion, 240), cantidad: Number(i?.cantidad) || null, unidad: texto(i?.unidad, 30) })),
        lugar_entrega: texto(L.lugar_entrega, 240), plazo_entrega: texto(L.plazo_entrega, 200),
      };
    }
    if (t._nuevaVersion) { delete t._nuevaVersion; nuevaVersion(t, "robot", t.items, t.firma); if (t.oc_compra) { try { const m = cotejarOC(t); if (m) { t.op = t.op || {}; t.op.oc_match = m; } } catch {} } }
    if (b.captcha_b64 != null) {                    // código de imagen que el robot necesita que escribas
      t.captcha = String(b.captcha_b64).slice(0, 90000) || null;
      t.captcha_resp = null;
    }
    if (b.zip_b64) {
      const z = Buffer.from(String(b.zip_b64), "base64");
      if (z.length <= MAX_PDF && z.subarray(0, 2).toString() === "PK") { await store.set("lic/" + t.codigo, z); t.zip = true; }
    }
    const enviado = (e) => e === "enviada" || e === "confirmada";
    // 🔁 VERIFICACIÓN DE FIRMA: cuando revisaste una firma y el robot miró Mercado Público, hay dos caminos.
    //   · Si quedó enviada → sigue de largo (se marca enviada abajo) y pasas a la siguiente.
    //   · Si NO quedó enviada (error, o MP «aún no la muestra como enviada») → NO la dejamos trabada «en cola»:
    //     vuelve a «por firmar» (lista) para que la firmes de nuevo. Así reconoce si se firmó o no y la enruta sola.
    if (t.accion === "verificar" && b.estado && !enviado(b.estado)
        && !["en_cola", "tomado", "preparando"].includes(b.estado)
        && (b.estado === "error" || /no\s+(la\s+)?(muestra|aparece|qued[oó]).*enviad|a[uú]n\s+no|no\s+enviad/i.test(String(b.mensaje || "")))) {
      b.estado = "lista";
      b.mensaje = "Mercado Público aún no la muestra enviada: queda lista para firmar de nuevo.";
    }
    if (enviado(b.estado) && !enviado(t.estado)) t.envios = (t.envios || 0) + 1;
    if (b.comp_b64) {                                   // comprobante / registro del envío
      const c = Buffer.from(String(b.comp_b64), "base64");
      if (c.length <= MAX_PDF && c.subarray(0, 4).toString() === "%PDF") { await store.set("comp/" + t.codigo, c); t.comprobante = true; }
    }
    if (b.enviado_por) t.dispositivo = texto(b.enviado_por, 60);
    if (b.pdf_b64) {
      const bytes = Buffer.from(String(b.pdf_b64), "base64");
      if (bytes.length <= MAX_PDF && bytes.subarray(0, 4).toString() === "%PDF") {
        await store.set("pdf/" + t.codigo, bytes);
        t.pdf = true;
      }
    }
    const cambio = b.estado && b.estado !== t.estado;
    anotar(t, b.estado || null, b.mensaje);
    const guardado = await escribir(store, t);
    if (cambio) {
      try { await avisar(store, guardado); } catch { /* un aviso fallido no detiene al robot */ }
    }
    return json({ trabajo: guardado });
  }

  return json({ error: "Ruta no encontrada." }, 404);
}


// ===================== Compra Ágil · API oficial (api2.mercadopublico.cl) =====================
const CA_API = "https://api2.mercadopublico.cl/v2/compra-agil";
const caNorm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
const CA_RX = caRubros.rubros.map((r) => ({ ...r, re: new RegExp(r.kw, "i") }));
const CA_GE = { ...caRubros.ge, re: new RegExp(caRubros.ge.kw, "i"), no: new RegExp(caRubros.ge.no, "i") };
function caClasificar(nombre) {
  const t = caNorm(nombre);
  if (CA_GE.re.test(t) && !CA_GE.no.test(t)) return { rubro: CA_GE.rubro, tipo: CA_GE.tipo, margen: CA_GE.margen, viab: CA_GE.viab };
  const hits = CA_RX.filter((r) => r.re.test(t));
  if (!hits.length) return { rubro: "Otro producto", tipo: "rev", margen: 0.18, viab: 0.6 };
  const orden = { exp: 0, rev: 1, srv: 2, esp: 3 };
  const esp = hits.filter((h) => h.tipo === "esp"), exp = hits.filter((h) => h.tipo === "exp");
  const h = (esp[0] || exp[0] || hits.sort((a, b) => orden[a.tipo] - orden[b.tipo])[0]);
  return { rubro: h.rubro, tipo: h.tipo, margen: h.margen, viab: h.viab };
}
const caFecha = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 16); };
function caItem(x) {
  const f = x.fechas || {}, m = x.montos || {}, i = x.institucion || {};
  const conv = (x.convocatoria || {}).estado_convocatoria;
  return { codigo: String(x.codigo || "").trim(), nombre: String(x.nombre || "").replace(/\s+/g, " ").trim(),
    publicada: caFecha(f.fecha_publicacion), cierre: caFecha(f.fecha_cierre),
    organismo: String(i.organismo_comprador || "").trim(), unidad: String(i.unidad_compra || "").trim(), region: String(i.nombre_region || "").trim(),
    monto: Number(m.monto_disponible_clp || m.monto_disponible || 0), llamado: conv === 2 ? "Segundo llamado" : "Primer llamado",
    ofertas: Number((x.resumen || {}).total_ofertas_recibidas || 0), enviadas: 0, oc: null };
}
const caDesde = (dias) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
async function caPagina(ticket, n, tam, dias = 6, region = null) {
  // La API exige filtros y responde 504 a consultas amplias: se pide POR REGIÓN (1..16) y solo lo publicado en los últimos días.
  const u = `${CA_API}?estado=publicada${region ? "&region=" + region : ""}&publicado_desde=${caDesde(dias)}&tamano_pagina=${tam}&numero_pagina=${n}`;
  const r = await fetch(u, { headers: { ticket, accept: "application/json", "user-agent": "CotizAgil/1.0" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("HTTP " + r.status + " región " + region + " página " + n);
  const d = await r.json(); const p = d.payload || d;
  return { items: p.items || [], total: Number((p.paginacion || {}).total_paginas || 1) };
}
async function caOficial(store, ticketDado) {
  // Lectura incremental por región: cada llamada avanza lo que alcanza (~6 s) y guarda el cursor; hasta terminar el ciclo
  // se sigue mostrando la lista completa del ciclo anterior.
  const ticket = ticketDado || process.env.CA_TICKET || process.env.MP_TICKET;
  const K = "oportunidades/ca_oficial";
  const est = (await store.get(K, { type: "json" }).catch(() => null)) || { lista: [], fecha: null, ciclo: null };
  const ahora = Date.now();
  const cicloViejo = !est.ciclo || !est.ciclo.region || (est.ciclo.completo && ahora - Date.parse(est.ciclo.inicio) > 15 * 60000) || (!est.ciclo.completo && ahora - Date.parse(est.ciclo.inicio) > 30 * 60000);
  if (est.ciclo && est.ciclo.completo && !cicloViejo) return est;
  if (cicloViejo) est.ciclo = { inicio: new Date().toISOString(), region: 1, siguiente: 1, total: null, tam: 10, dias: 6, items: {}, completo: false, errores: 0 };
  const c = est.ciclo; const t0 = Date.now();
  while (!c.completo && Date.now() - t0 < 6000) {
    const n = c.siguiente; const cuantas = c.total ? Math.min(4, c.total - n + 1) : 1;
    if (cuantas <= 0) { c.region++; c.siguiente = 1; c.total = null; if (c.region > 16) c.completo = true; continue; }
    const lote = await Promise.allSettled([...Array(cuantas)].map((_, k) => caPagina(ticket, n + k, c.tam, c.dias, c.region)));
    let ok = 0;
    for (const r of lote) if (r.status === "rejected") c.ultimo_error = String(r.reason && r.reason.message || r.reason).slice(0, 120);
    for (const r of lote) if (r.status === "fulfilled") { ok++; if (!c.total) c.total = Math.min(r.value.total, 60); for (const x of r.value.items) { const o = caItem(x); if (o.codigo) c.items[o.codigo] = o; } }
    if (!ok) { c.errores++; if (c.errores >= 3) { c.errores = 0; c.region++; c.siguiente = 1; c.total = null; if (c.region > 16) c.completo = true; } continue; }   // región que no contesta: se salta
    c.siguiente = n + cuantas;
    if (c.total && c.siguiente > c.total) { c.region++; c.siguiente = 1; c.total = null; if (c.region > 16) c.completo = true; }
  }
  if (c.completo) {
    const [lo, hi] = caRubros.rango; const res = [];
    for (const o of Object.values(c.items)) {
      if (o.monto < lo || o.monto > hi || !o.cierre || Date.parse(o.cierre) < ahora + 3600000) continue;
      const cl = caClasificar(o.nombre); const neto = o.monto / 1.19; const horas = (Date.parse(o.cierre) - ahora) / 3600000;
      let bonus = 1; if (/^segundo/i.test(o.llamado)) bonus *= 1.6; if (o.ofertas === 0) bonus *= 1.1; else if (o.ofertas >= 5) bonus *= 0.85; if (horas < 6) bonus *= 0.8; if (o.monto < 300000) bonus *= 0.7;
      const ganancia = neto * cl.margen * cl.viab * bonus;
      res.push({ fuente: "compra_agil", ...o, ...cl, neto: Math.round(neto), horas: Math.round(horas * 10) / 10, ganancia: Math.round(ganancia), ya_ofertada: false, etiqueta: caRubros.etiqueta[cl.tipo], trabajada: false, nuestra: false });
    }
    const tope = Math.max(1, ...res.map((r) => r.ganancia));
    for (const r of res) r.puntaje = Math.round(100 * Math.pow(r.ganancia / tope, 0.6));
    res.sort((a, b) => b.ganancia - a.ganancia);
    if (res.length || !est.lista.length) { est.lista = res; est.fecha = new Date().toISOString(); est.crudas = Object.keys(c.items).length; }
    c.items = {};
    console.log(`CA oficial: ${res.length} compras en rango de ${est.crudas} (16 regiones, páginas de ${c.tam})`);
  }
  await store.setJSON(K, est);
  return est.lista.length ? est : null;
}
