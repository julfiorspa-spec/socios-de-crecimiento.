// Puente entre CotizÁgil (celular) y el robot del PC.
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
  lista:      (t) => ["Falta tu clic · " + t.codigo, `${clpTxt(t.total)} lista en el PC. Presiona «Enviar cotización» y acepta la declaración.`, true],
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
  const store = getStore({ name: "robot", consistency: "strong" });
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

async function atender(req) {
  if (/^\/bot\/wa\/?$/.test(new URL(req.url).pathname)) return waWebhook(req);
  if (!autorizado(req)) return json({ error: "Código de enlace inválido o no configurado." }, 401);
  const store = getStore({ name: "robot", consistency: "strong" });
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/bot\/?/, "").replace(/\/$/, "") || "estado";

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
    return json({ ok: true, n: lista.length });
  }
  if (ruta === "oportunidades" && req.method === "GET") {
    const o = (await store.get("oportunidades/lista", { type: "json" })) || { lista: [] };
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
    if (!/^\d{1,8}-\d{1,8}-COT\d{2}$/.test(codigo)) return json({ error: "Código inválido" }, 400);
    const claveS = cajon("oportunidades/seleccionadas", jug(b.jugador));
    const s = (await store.get(claveS, { type: "json" })) || {};
    if (b.quitar) delete s[codigo];
    else {
      const prev = s[codigo] || { desde: ahora() };
      const num = (v) => (v == null || v === "" ? undefined : Math.max(0, Math.round(Number(v) || 0)));
      s[codigo] = { ...prev, nombre: texto(b.nombre, 200) ?? prev.nombre, organismo: texto(b.organismo, 120) ?? prev.organismo,
        monto: num(b.monto) ?? prev.monto, cierre: texto(b.cierre, 40) ?? prev.cierre, margen: b.margen != null ? Number(b.margen) || 0 : prev.margen,
        precio: num(b.precio) ?? prev.precio, costo: b.costo === null ? undefined : num(b.costo) ?? prev.costo, empresa: texto(b.empresa, 40) ?? prev.empresa, actualizado: ahora() };
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
      "transportista", "transportista_tel", "origen_flete", "patente", "recibio_nombre", "recibio_rut", "fecha_cobro", "inversionista_nombre", "inversionista_tel", "despacho_modo", "proveedor_k", "proveedor_email", "proveedor_tel", "entrega_contacto", "entrega_tel", "vehiculo", "factoring", "nota_cierre"]) if (d[k] !== undefined) op[k] = texto(d[k], 400);
    for (const k of ["precio_acordado", "costo_transporte", "opcion", "km", "cobrado"]) if (d[k] !== undefined) op[k] = d[k] === null ? null : Math.max(0, Math.round(Number(d[k]) || 0));
    const yaPedido = !!op.pedido_transferencia;
    for (const k of ["inversion_ok", "compra_ok", "despacho_ok", "guia_firmada", "factura_firmada", "aplica_comision", "nos_da", "proveedor_pagado", "guia_hecha", "factura_hecha", "oc_aceptada", "pedido_transferencia", "transferido"]) if (d[k] !== undefined) op[k] = !!d[k];
    if (d.comision !== undefined) op.comision = Math.min(0.10, Math.max(0.01, Number(d.comision) || 0.04));
    // 📨 el juego de los proveedores: a quién le escribiste/llamaste y qué precio te dio cada uno
    if (d.contactado && typeof d.contactado === "object") {
      const k = texto(d.contactado.k, 80); if (k) op.contactados = { ...(op.contactados || {}), [k]: { via: texto(d.contactado.via, 20), t: ahora(), nombre: texto(d.contactado.nombre, 120) } };
    }
    if (d.cotizacion && typeof d.cotizacion === "object") {
      const k = texto(d.cotizacion.k, 80), v = Math.max(0, Math.round(Number(d.cotizacion.v) || 0));
      if (k) { op.cotizaciones = { ...(op.cotizaciones || {}) }; if (v) op.cotizaciones[k] = { v, nombre: texto(d.cotizacion.nombre, 120), t: ahora() }; else delete op.cotizaciones[k]; }
    }
    if (d.descartar_k) op.descartados = { ...(op.descartados || {}), [texto(d.descartar_k, 80)]: ahora() };
    const avisarPago = d.pedido_transferencia === true && !yaPedido;
    if (d.proveedor_extra && typeof d.proveedor_extra === "object" && d.proveedor_extra.proveedor) {
      const x = d.proveedor_extra;
      op.extras = [...(op.extras || []), { proveedor: texto(x.proveedor, 120), telefono: texto(x.telefono, 40), email: texto(x.email, 120), fuente: texto(x.fuente, 30) || "manual" }].slice(-6);
    }
    if (b.pedir_informe || (cambioEtapa && AVISO_INV[op.etapa]) || d.precio_acordado !== undefined || d.costo_transporte !== undefined) op.pedido_informe = { t: ahora(), rebuscar: !!b.rebuscar };
    t.op = op;
    const r = await escribir(store, t);
    if (avisarPago) await avisarTexto(store, "💸 Inversionista: paga a " + String(op.proveedor || "proveedor").slice(0, 40), `${t.codigo} · ${"$" + Math.round(op.precio_acordado || 0).toLocaleString("es-CL")}${op.banco_proveedor ? " · " + texto(op.banco_proveedor, 140) : ""}. Sube el comprobante en Ejecuta para que avance.`, "pago-" + t.codigo, "/#robot", true).catch(() => {});
    if (cambioEtapa && AVISO_INV[op.etapa]) {        // 💼 aviso al inversionista (push) con el resumen del negocio
      const util = op.informe?.final != null ? " · utilidad " + "$" + Math.round(op.informe.final).toLocaleString("es-CL") : "";
      await avisarTexto(store, "💼 " + AVISO_INV[op.etapa] + " · " + t.codigo, `${(t.nombre || "").slice(0, 60)} · venta $${Math.round(t.total || 0).toLocaleString("es-CL")}${op.precio_acordado ? " · compra $" + Math.round(op.precio_acordado).toLocaleString("es-CL") : ""}${op.costo_transporte ? " · flete $" + Math.round(op.costo_transporte).toLocaleString("es-CL") : ""}${util}. Excel actualizado en Negocios.`,
        "inv-" + t.codigo, "/#robot").catch(() => {});
    }
    return json({ trabajo: r });
  }
  // archivos del negocio: informe PDF y Excel (los sube el PC), fotos / guías / facturas (las sube el celular)
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
    const meta = (t?.op?.docs || []).find((x) => x.id === url.searchParams.get("id"));
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
    if (accion === "lic_firmar" || accion === "lic_ingresar") {   // pasos siguientes: conservan el análisis y los papeles
      if (!previo?.lic) return json({ error: "Primero el robot debe preparar la licitación." }, 404);
      previo.accion = accion;
      if (b.descuento != null) previo.descuento = Math.min(0.6, Math.max(0, Number(b.descuento) || 0));
      anotar(previo, "en_cola", accion === "lic_firmar" ? "Aprobada: el robot firma los anexos y la deja lista para ofertar."
        : "El robot ingresará la oferta en Mercado Público (tú declaras y envías).");
      return json({ trabajo: await escribir(store, previo) });
    }
    if (accion === "verificar") {          // revisar en el portal si ya quedó enviada: conserva la oferta preparada
      if (!previo) return json({ error: "No hay oferta preparada para verificar." }, 404);
      previo.accion = "verificar";
      if (b.vista) previo.enviada_vista = ahora();     // Mercado Público mostró «Cotización enviada correctamente»: sale de Firmar en todos los celulares
      previo.dispositivo = texto(b.dispositivo, 60) || previo.dispositivo || null;   // qué celular la envió (registro «Enviados» del PC)
      anotar(previo, "en_cola", "El robot revisará en Mercado Público si ya quedó enviada.");
      return json({ trabajo: await escribir(store, previo) });
    }
    // Compra Ágil: se puede ofertar sobre el presupuesto (descuento negativo) hasta el tope de 100 UTM que controla la app
    const descuento = Math.min(0.6, Math.max(esLic ? 0 : -9, b.descuento != null ? Number(b.descuento) || 0 : esLic ? 0.17 : 0.08));
    const t = {
      codigo, accion, descuento,
      nombre: texto(b.nombre, 200), organismo: texto(b.organismo, 200), monto: Number(b.monto) || null,
      creado: ahora(), estado: null, mensaje: null, historial: [],
      total: null, neto: null, plazo: null, detalle: null, items: null, pdf: false,
      envios: previo?.envios || 0, // cuántas veces quedó enviada antes (para editar)
      empresa: texto(b.empresa, 40) || previo?.empresa || null,   // con qué empresa (RUT y datos) se arma la oferta
      jugador: jug(b.jugador) || previo?.jugador || null,         // qué celular (qué juego) la pidió
      dispositivo: texto(b.dispositivo, 60) || previo?.dispositivo || null,
    };
    if (esLic) t.tipo = "licitacion";
    anotar(t, "en_cola", accion === "probar" ? "Prueba sin enviar: el robot la tomará en segundos." : esLic ? "Licitación: el robot bajará la ficha, las bases y los anexos." : "Esperando que el robot del PC la tome.");
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
    const lista = (await todos(store)).filter((t) => t.op && t.op.etapa !== "rechazada" && (todas ? (t.op.oc_codigo || t.op.oc || t.op.etapa === "previa" || (id && t.op.ejecutor === id)) : id && t.op.ejecutor === id))
      .map(({ firma, historial, envios, ...t }) => t);
    return json({ negocios: lista });
  }
  // ---------- 🏢 empresas: cada celular oferta con su RUT y sus datos ----------
  if (ruta === "empresas" && req.method === "GET") {
    return json({ empresas: (await store.get("empresas/lista", { type: "json" })) || {} });
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
    const vivos = Object.keys(E).filter((k) => Date.now() - Date.parse(E[k].visto) < 90_000).sort();
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
    // 📄 OC sin su PDF oficial: el PC lo baja del portal (reintenta cada 6 h)
    const ocs_pdf = [];
    for (const tt of lista) {
      const o = tt.op; if (!o?.oc_codigo || ["rechazada"].includes(o.etapa) || (o.docs || []).some((d) => d.tipo === "oc")) continue;
      if (o.oc_pdf_intento && Date.now() - Date.parse(o.oc_pdf_intento) < 6 * 3600_000) continue;
      if (!mio(tt.codigo) || ocs_pdf.length >= 3) continue;
      o.oc_pdf_intento = ahora(); await escribir(store, tt); ocs_pdf.push({ codigo: tt.codigo, oc: o.oc_codigo });
    }
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
      ...(correos.length ? { correos } : {}), ...(vigilar ? { vigilar } : {}), ...(chats.length ? { chats } : {}), ...(ocs_pdf.length ? { ocs_pdf } : {}) };
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
      }
    }
    const siguiente = lista.filter((t) => t.estado === "en_cola" && mioT(t)).sort((a, b) => (humano(b) - humano(a)) || a.creado.localeCompare(b.creado))[0];
    if (!siguiente) return json({ siguiente: null, ...op });
    anotar(siguiente, "tomado", "El robot del PC la tomó.");
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
