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
        pedido_informe: (op || {}).pedido_informe || { t: ahora() }, oc: g.oc || (op || {}).oc || null };
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
  x.op = op;
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
    if (ok && reg && reg.estado !== "pagada") {
      reg.estado = "pagada"; reg.t_pago = ahora(); await store.setJSON(`wp/${reg.orden}`, reg);
      const key = `wpcredito/${reg.jug}`, cr = (await store.get(key, { type: "json" })) || { total: 0, items: [] };
      cr.total = (cr.total || 0) + reg.monto; cr.items = [...(cr.items || []), { monto: reg.monto, orden: reg.orden, t: ahora() }].slice(-20);
      await store.setJSON(key, cr);
      return volver("ok&monto=" + reg.monto);
    }
    return volver(ok ? "ok" : "rechazado");
  } catch { return volver("error"); }
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
  const r = await fetch("https://www.bing.com/images/search?" + new URLSearchParams({ q, form: "HDRSC2", first: "1", cc: "CL", setlang: "es" }), { headers: { "user-agent": FOTO_UA, "accept-language": "es-CL,es;q=0.9" }, signal: AbortSignal.timeout(7000) });
  const h = await r.text(); const out = [];
  for (const m of h.matchAll(/murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/g)) { try { const u = decodeURIComponent(m[1]); out.push({ url: u, fuente: new URL(u).hostname.replace(/^www\./, ""), motor: "bing" }); } catch {} }
  return out;
}
async function fotoDDG(q) {
  const h = await (await fetch("https://duckduckgo.com/?" + new URLSearchParams({ q, iax: "images", ia: "images" }), { headers: { "user-agent": FOTO_UA }, signal: AbortSignal.timeout(6000) })).text();
  const m = h.match(/vqd=([\d-]+)/) || h.match(/vqd="([\d-]+)"/) || h.match(/vqd=\\'([\d-]+)/); if (!m) return [];
  const r = await fetch("https://duckduckgo.com/i.js?" + new URLSearchParams({ l: "cl-es", o: "json", q, vqd: m[1], f: ",,,,,", p: "1" }), { headers: { "user-agent": FOTO_UA, referer: "https://duckduckgo.com/", accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  const j = await r.json();
  return (j.results || []).filter((x) => x.image && (x.width || 0) >= 300 && (x.height || 0) >= 300).map((x) => ({ url: x.image, fuente: (() => { try { return new URL(x.url || x.image).hostname.replace(/^www\./, ""); } catch { return ""; } })(), titulo: x.title, pagina: x.url, motor: "ddg" }));
}
async function buscarFotos(q) {
  q = String(q || "").replace(/\(c[oó]digo [^)]*\)|seg[uú]n (especificaci[oó]n|eett).*|o similar/gi, "").replace(/\s+/g, " ").trim().slice(0, 90);
  if (q.length < 4) return { q, fotos: [], errores: ["consulta corta"] };
  const errores = []; let out = [];
  const res = await Promise.allSettled([fotoML(q), fotoBing(q), fotoDDG(q)]);
  for (const r of res) { if (r.status === "fulfilled") out.push(...r.value); else errores.push(String(r.reason?.message || r.reason).slice(0, 80)); }
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
  try {
    const r = await fetch(url, { headers: { "user-agent": FOTO_UA, "accept-language": "es-CL,es;q=0.9", accept: "text/html,*/*" }, signal: AbortSignal.timeout(7000), redirect: "follow" });
    if (!r.ok) return { estado: r.status };
    const h = (await r.text()).slice(0, 900000);
    const tit = (h.match(/<title[^>]*>([^<]{3,160})</i) || [])[1] || (h.match(/property="og:title" content="([^"]{3,160})"/) || [])[1] || "";
    let precio = null;
    const m1 = h.match(/"price"\s*:\s*"?(\d{3,8})(?:\.\d+)?"?/) || h.match(/itemprop="price"\s+content="(\d{3,8})/) || h.match(/"priceAmount"\s*:\s*(\d{3,8})/) || h.match(/andes-money-amount__fraction[^>]*>([\d.]{4,11})</);
    if (m1) precio = Number(String(m1[1]).replace(/\./g, ""));
    if (precio && (precio < 500 || precio > 50000000)) precio = null;
    const sinStock = /sin stock|agotado|no disponible|publicaci[oó]n pausada|finalizada/i.test(h.slice(0, 200000)) && !/en stock|disponible/i.test(h.slice(0, 50000));
    return { precio, titulo: tit.replace(/\s*[|·-]\s*(MercadoLibre|Falabella|Sodimac).*$/i, "").trim(), sinStock, estado: r.status };
  } catch (e) { return { error: String(e.message || e).slice(0, 60) }; }
}
async function concretar(store, t, opts = {}) {
  const key = process.env.ANTHROPIC_API_KEY || "";
  const items = (Array.isArray(t.items) && t.items.length ? t.items : (t.oc_compra?.items || []).map((i) => ({ d: i.especificacion || i.nombre, q: i.cantidad, p: i.precio })))
    .filter((i) => i && i.d).slice(0, 8).map((i) => ({ d: String(i.d).slice(0, 160), q: Number(i.q) || 1, p: Number(i.p) || 0 }));
  if (!items.length) return { error: "La oferta no tiene ítems guardados." };
  const rutEmp = String(t.rut_empresa || t.empresa_rut || "78493114-5").replace(/\./g, "").toUpperCase();
  const C = (await store.get("catalogo/" + rutEmp, { type: "json" }).catch(() => null)) || { items: {} };
  const catal = Object.values(C.items || {});
  const kw = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !["para", "con", "segun", "tipo", "unidad", "requiere"].includes(w));
  // 1) candidatos por ítem, en paralelo
  const porItem = await Promise.all(items.map(async (it) => {
    const q = it.d.replace(/\(c[oó]digo [^)]*\)|seg[uú]n (especificaci[oó]n|eett|ttr).*|o similar/gi, "").replace(/\b(Biotecmed|C[oó]rcega|CD-C\d+|CIP\s?\d+L?|BC\d+L)\b/g, "").replace(/\s+/g, " ").trim();
    let cands = [];
    try { cands = (await buscarFotos(q)).fotos.filter((f) => f.pagina && TIENDA_RE.test(f.pagina)); } catch {}
    const vistas = new Set(); cands = cands.filter((f) => { const u = f.pagina.split("#")[0].split("?")[0]; if (vistas.has(u)) return false; vistas.add(u); f.pagina = u; return true; }).slice(0, 4);
    const conPrecio = await Promise.all(cands.map(async (f) => ({ ...f, ...(await precioPagina(f.pagina)) })));
    const ks = kw(it.d);
    const propios = catal.map((c) => ({ c, n: kw(c.producto).filter((w) => ks.includes(w)).length })).filter((x) => x.n >= 1).sort((a, b2) => b2.n - a.n).slice(0, 3)
      .map((x) => ({ producto: x.c.producto, proveedor: x.c.proveedor, precio_unit_neto: x.c.precio_unit, unidad: x.c.unidad, fecha: x.c.fecha }));
    return { item: it, candidatos: conPrecio.filter((f) => !f.error).map((f) => ({ titulo: (f.titulo || "").slice(0, 120), url: f.pagina, foto: f.url, fuente: f.fuente, precio_iva: f.precio || null, sin_stock: !!f.sinStock })), propios };
  }));
  // 2) Claude decide
  let plan = null, aviso = null;
  if (key) {
    const prompt = `Eres el jefe de compras de ${t.empresa_nombre || "PJANIC SpA"} (proveedor del Estado de Chile). Ganamos la compra ágil ${t.codigo} (${t.nombre || ""}) del organismo ${t.oc_compra?.organismo || t.organismo || ""}; OC ${t.op?.oc_codigo || ""}. Entrega: ${t.oc_compra?.direccion || t.op?.informe?.direccion || "(ver OC)"}.
Para cada ítem cotizado te doy: lo que ofrecimos (texto de nuestra cotización), cantidad, precio unitario NETO de venta, candidatos REALES encontrados en tiendas (título, link, precio con IVA leído de la página; null si no se pudo leer) y productos que ya le compramos antes a proveedores propios (catálogo de facturas).
Tu trabajo: decir dónde concretar cada ítem. REGLAS: (1) usa SOLO links y proveedores de la lista; jamás inventes tiendas, teléfonos ni precios: si un candidato no trae precio, pon precio_unit_iva null y dilo; (2) el producto elegido debe cumplir lo cotizado (capacidad, medidas, uso médico/industrial si lo dice el texto); si ninguno calza, elegido null y explica qué buscar; (3) explica en una frase por qué calza con lo que cotizamos y por qué cotizamos así (p. ej. "cotizamos caja isotérmica 16 L para cadena de frío: este cooler rígido de 15–16 L lo cumple"); (4) alerta riesgos (stock, plazo, producto chino con envío internacional no sirve para entregar en 3 días).
Responde SOLO JSON: {"items":[{"i":<índice>,"elegido":{"tipo":"link"|"proveedor","titulo":"","url":"","proveedor":"","precio_unit_iva":<número o null>,"porque":""}|null,"alternativas":[{"titulo":"","url":"","precio_unit_iva":<número o null>}],"riesgo":"","buscar":""}],"resumen":"<2 frases: qué hacer primero y cuánto se gana>"}

` + porItem.map((x, i) => `ÍTEM ${i}: "${x.item.d}" · cantidad ${x.item.q} · venta unit. neto $${x.item.p}\n  candidatos: ${JSON.stringify(x.candidatos)}\n  propios: ${JSON.stringify(x.propios)}`).join("\n\n");
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 2500, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(20000) });
      const j = await r.json(); const txt = (j.content || []).map((c) => c.text || "").join("");
      const m = txt.match(/\{[\s\S]*\}/); plan = m ? JSON.parse(m[0]) : null;
      if (!plan) aviso = "Claude no devolvió un plan legible: " + txt.slice(0, 120);
    } catch (e) { aviso = "Claude no respondió: " + String(e.message || e).slice(0, 80); }
  } else aviso = "Falta ANTHROPIC_API_KEY en Netlify: muestro solo los candidatos encontrados.";
  // 3) armar el plan final con números
  const filas = porItem.map((x, i) => {
    const pj = (plan?.items || []).find((y) => Number(y.i) === i) || {};
    let el = pj.elegido || null;
    if (!el && x.candidatos.length) { const c = x.candidatos.filter((c) => c.precio_iva && !c.sin_stock).sort((a, b2) => a.precio_iva - b2.precio_iva)[0]; if (c) el = { tipo: "link", titulo: c.titulo, url: c.url, precio_unit_iva: c.precio_iva, porque: "El más barato con precio leído de la tienda (sin revisión de Claude)." }; }
    if (el && el.url && !x.candidatos.some((c) => c.url === el.url) && !/^https?:\/\//.test(el.url)) el.url = null;
    const costoU = el?.precio_unit_iva ? Math.round(el.precio_unit_iva / 1.19) : null;
    const ventaU = x.item.p, q = x.item.q;
    return { i, item: x.item.d, cantidad: q, venta_unit_neto: ventaU, venta_neto: ventaU * q, elegido: el, costo_unit_neto: costoU, costo_neto: costoU != null ? costoU * q : null,
      ganancia: costoU != null ? (ventaU - costoU) * q : null, alternativas: (pj.alternativas || x.candidatos.slice(0, 3)).slice(0, 4), riesgo: pj.riesgo || "", buscar: pj.buscar || "", propios: x.propios, candidatos: x.candidatos, foto: x.candidatos[0]?.foto || null };
  });
  const tot = { venta_neto: filas.reduce((s, f) => s + f.venta_neto, 0), costo_neto: filas.reduce((s, f) => s + (f.costo_neto || 0), 0), sin_precio: filas.filter((f) => f.costo_neto == null).length };
  tot.ganancia = tot.venta_neto - tot.costo_neto;
  return { ok: true, codigo: t.codigo, t: ahora(), items: filas, total: tot, resumen: plan?.resumen || "", aviso };
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
  if (b.accion === "web") { try { return new Response(JSON.stringify({ ok: true, r: await webBuscar(b.q) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); } }
  if (b.accion === "ml_listado") { globalThis.__mlDebug = !!b.debug; try { return new Response(JSON.stringify({ ok: true, r: await mlListado(b.q, b.local !== false) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); } }
  if (b.accion === "concretar") { const t = await leer(store, String(b.codigo || "")); if (!t) return new Response(JSON.stringify({ error: "no existe" }), { status: 404, headers: corsH }); const r = await concretar(store, t); if (r.ok) { t.op = t.op || { etapa: "ganada", historial: [] }; t.op.concrecion = r; await store.setJSON("trabajo/" + t.codigo, t); } return new Response(JSON.stringify(r), { status: 200, headers: { ...corsH, "content-type": "application/json" } }); }
  if (b.accion === "fotos_ultimo") return new Response(JSON.stringify({ ok: true, u: await store.get("robot/fotos_ultimo", { type: "json" }) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
  if (b.accion === "foto") return new Response(JSON.stringify({ ok: true, ...(await buscarFotos(b.q)) }), { status: 200, headers: { ...corsH, "content-type": "application/json" } });
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
  if (!autorizado(req)) return json({ error: "Código de enlace inválido o no configurado." }, 401);
  const store = getStore({ name: STORE, consistency: "strong" });
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/bot\/?/, "").replace(/\/$/, "") || "estado";

  // ---------- 🧪 SIMULADOR (autocontenido, en cualquier entorno) ----------
  // Inyecta cotizaciones FICTICIAS para probar el flujo (cola → por firmar → firma) SIN Mercado Público real.
  // Blindaje total: el simulador SIEMPRE usa su propio store "robot-sim", nunca el real ("robot"). Por eso puede
  // correr incluso en producción sin tocar un solo dato verdadero. Las simuladas llevan sim:true y código SIM-….
  if (ruta === "concretar" && req.method === "POST") {   // 🎯 plan para concretar una OC ganada con proveedores/links reales
    const b = await cuerpo(req); const t = await leer(store, limpiaCodigo(b.codigo)); if (!t) return json({ error: "No existe." }, 404);
    if (t.op?.concrecion && !b.forzar && Date.now() - new Date(t.op.concrecion.t).getTime() < 6 * 3600e3) return json(t.op.concrecion);
    const r = await concretar(store, t); if (r.error) return json(r, 400);
    t.op = t.op || { etapa: "ganada", historial: [] }; t.op.concrecion = r; t.actualizado = ahora(); await store.setJSON("trabajo/" + t.codigo, t);
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
    const jug = texto(b.jugador, 60) || "inv";
    const orden = ("SC" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).slice(0, 26);
    let j = {};
    try {
      const r = await fetch(`${WP_BASE}/rswebpaytransaction/api/webpay/v1.2/transactions`, {
        method: "POST", headers: WP_HEAD(),
        body: JSON.stringify({ buy_order: orden, session_id: jug.slice(0, 61), amount: monto, return_url: `${WP_SITIO}/bot/webpay-retorno` }),
      });
      j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token || !j.url) return json({ error: "WebPay no respondió (" + r.status + ")." }, 502);
    } catch (e) { return json({ error: "No se pudo contactar WebPay." }, 502); }
    await store.setJSON(`wp/${orden}`, { orden, monto, jug, token: j.token, estado: "creada", t: ahora() });
    return json({ url: j.url, token: j.token });
  }
  if (ruta === "webpay-cobrar" && req.method === "POST") {
    const b = await cuerpo(req);
    const key = `wpcredito/${texto(b.jugador, 60) || "inv"}`;
    const cr = (await store.get(key, { type: "json" })) || { total: 0, items: [] };
    if (cr.total > 0) await store.setJSON(key, { total: 0, items: [] });
    return json({ abonado: cr.total || 0, items: cr.items || [] });
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
      "transportista", "transportista_tel", "origen_flete", "patente", "recibio_nombre", "recibio_rut", "fecha_cobro", "inversionista_nombre", "inversionista_tel", "despacho_modo", "proveedor_k", "proveedor_email", "proveedor_tel", "entrega_contacto", "entrega_tel", "vehiculo", "factoring", "nota_cierre", "twitch_canal", "video_prueba", "inversionista_banco", "ejecutor_banco", "jugador_banco"]) if (d[k] !== undefined) op[k] = texto(d[k], 400);
    for (const k of ["precio_acordado", "costo_transporte", "opcion", "km", "cobrado"]) if (d[k] !== undefined) op[k] = d[k] === null ? null : Math.max(0, Math.round(Number(d[k]) || 0));
    if (Array.isArray(d.pagos)) {                                    // 💸 a quién le compré: nombre + monto neto + factura (varias personas)
      op.pagos = d.pagos.slice(0, 12).map((x) => ({ nombre: texto(x?.nombre, 60) || "", monto: Math.max(0, Math.round(Number(x?.monto) || 0)), factura: x?.factura !== false, ...(Array.isArray(x?.unit) ? { unit: x.unit.slice(0, 8).map((u) => Math.max(0, Math.round(Number(u) || 0))) } : {}), ...(x?.tipo === "neto" || x?.tipo === "bruto" ? { tipo: x.tipo } : {}) })).filter((x) => x.nombre || x.monto);
      op.precio_acordado = Math.round(op.pagos.reduce((s, x) => s + x.monto * (x.factura ? 1.19 : 1), 0)); op.sin_factura = op.pagos.length > 0 && op.pagos.every((x) => !x.factura);
    }
    const yaPedido = !!op.pedido_transferencia, yaTransf = !!op.transferido;
    for (const k of ["inversion_ok", "compra_ok", "despacho_ok", "guia_firmada", "factura_firmada", "aplica_comision", "nos_da", "proveedor_pagado", "guia_hecha", "factura_hecha", "oc_aceptada", "pedido_transferencia", "transferido", "rp_inversionista", "rp_ejecutador", "rp_jugador", "rp_sii", "sin_factura"]) if (d[k] !== undefined) op[k] = !!d[k];
    if (d.comision !== undefined) op.comision = Math.min(0.10, Math.max(0.01, Number(d.comision) || 0.04));
    // 📨 el juego de los proveedores: a quién le escribiste/llamaste y qué precio te dio cada uno
    if (d.contactado && typeof d.contactado === "object") {
      const k = texto(d.contactado.k, 80); if (k) op.contactados = { ...(op.contactados || {}), [k]: { via: texto(d.contactado.via, 20), t: ahora(), nombre: texto(d.contactado.nombre, 120) } };
    }
    if (d.cotizacion && typeof d.cotizacion === "object") {
      const k = texto(d.cotizacion.k, 80), v = Math.max(0, Math.round(Number(d.cotizacion.v) || 0));
      if (k) { op.cotizaciones = { ...(op.cotizaciones || {}) }; if (v) op.cotizaciones[k] = { v, nombre: texto(d.cotizacion.nombre, 120), t: ahora() }; else delete op.cotizaciones[k]; }
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
      empresa: texto(b.empresa, 40) || previo?.empresa || null,   // con qué empresa (RUT y datos) se arma la oferta
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
    return json({ trabajo: r });
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
      trabajos: lista.slice(0, 700).map((t) => ({
        codigo: t.codigo, nombre: corto(t.nombre, 160), organismo: corto(t.organismo, 120), estado: t.estado, accion: t.accion, tipo: t.tipo || null,
        total: t.total, jugador: t.jugador || null, persona: t.persona || null, dispositivo: t.dispositivo || null, empresa: t.empresa || null,
        creado: t.creado, actualizado: t.actualizado, fecha_envio: t.fecha_envio || null, externa: !!t.externa, detalle: corto(t.detalle, 240),
        items: (t.items || []).slice(0, 6),
        oc_compra: t.oc_compra ? { organismo: corto(t.oc_compra.organismo, 120), unidad: corto(t.oc_compra.unidad, 120), direccion: corto(t.oc_compra.direccion, 160),
          mail: t.oc_compra.mail || null, fono: t.oc_compra.fono || null, nombre: corto(t.oc_compra.nombre, 160),
          items: (t.oc_compra.items || []).slice(0, 6).map((i) => ({ nombre: corto(i.nombre, 80), especificacion: corto(i.especificacion, 100) })) } : null,
        op: t.op ? { etapa: t.op.etapa, oc_codigo: t.op.oc_codigo || null, precio_acordado: t.op.precio_acordado || null, proveedor: corto(t.op.proveedor, 80),
          docs: (t.op.docs || []).filter((d) => d.tipo === "oc"),
          informe: t.op.informe ? { final: t.op.informe.final ?? null, direccion: corto(t.op.informe.direccion, 160), comprador: t.op.informe.comprador || null,
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
    else L[id] = { ...(L[id] || {}), id, nombre: texto(b.nombre, 60) || L[id]?.nombre || "Ejecutador", telefono: texto(b.telefono, 30) ?? L[id]?.telefono ?? null, actualizado: ahora() };
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
    if (Array.isArray(b.items)) t.items = b.items.slice(0, 40).map((i) => ({
      d: texto(i.d, 200), q: Number(i.q) || 0, p: Number(i.p) || 0,
    }));
    if (b.fecha_envio) t.fecha_envio = texto(b.fecha_envio, 40);
    if (b.firma && Array.isArray(b.firma.precios)) {   // datos para el botón Rellenar
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
