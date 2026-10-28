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

const ESTADOS_ACTIVOS = new Set(["en_cola", "tomado", "preparando", "lista"]);
const ACCIONES = new Set(["ofertar", "editar", "probar", "firmar", "verificar"]);
const MAX_PDF = 4_500_000;                 // bytes del PDF (en base64 crece ~33%; Netlify acepta ~6 MB)
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
async function todos(store) {
  const { blobs } = await store.list({ prefix: "trabajo/" });
  const lista = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
  return lista.sort((a, b) => (b.actualizado || "").localeCompare(a.actualizado || ""));
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

// La página de la cotización en Mercado Público puede pedir tus datos de firma y el PDF (con tu código de enlace)
const ORIGEN_MP = "https://compra-agil.mercadopublico.cl";
export default async (req) => {
  const mp = req.headers.get("origin") === ORIGEN_MP;
  const cors = { "access-control-allow-origin": ORIGEN_MP, "access-control-allow-headers": "x-robot-token, content-type",
                 "access-control-allow-methods": "GET, POST", "access-control-max-age": "600", vary: "origin" };
  if (req.method === "OPTIONS") return new Response(null, { status: mp ? 204 : 403, headers: mp ? cors : {} });
  const res = await atender(req);
  if (mp) for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
};

async function atender(req) {
  if (!autorizado(req)) return json({ error: "Código de enlace inválido o no configurado." }, 401);
  const store = getStore({ name: "robot", consistency: "strong" });
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/bot\/?/, "").replace(/\/$/, "") || "estado";

  // ---------- celular ----------
  if (ruta === "estado" && req.method === "GET") {
    const robot = (await store.get("robot/latido", { type: "json" })) || null;
    const lista = await todos(store);
    return json({
      robot: robot && { ...robot, conectado: Date.now() - Date.parse(robot.visto) < ROBOT_INACTIVO_MS },
      trabajos: lista.slice(0, 60).map(({ historial, ...t }) => ({ ...t, historial: (historial || []).slice(-6) })),
    });
  }

  if (ruta === "pedir" && req.method === "POST") {
    const b = await cuerpo(req);
    const codigo = limpiaCodigo(b.codigo);
    const accion = ACCIONES.has(b.accion) ? b.accion : "ofertar";
    if (!/^\d{1,8}-\d{1,8}-COT\d{2}$/.test(codigo)) {
      return json({ error: "El robot solo trabaja Compras Ágiles (códigos como 1234-56-COT26)." }, 400);
    }
    const previo = await leer(store, codigo);
    if (previo && ESTADOS_ACTIVOS.has(previo.estado)) return json({ trabajo: previo, aviso: "Ya está en manos del robot." }, 409);
    if (accion === "verificar") {          // revisar en el portal si ya quedó enviada: conserva la oferta preparada
      if (!previo) return json({ error: "No hay oferta preparada para verificar." }, 404);
      previo.accion = "verificar";
      anotar(previo, "en_cola", "El robot revisará en Mercado Público si ya quedó enviada.");
      return json({ trabajo: await escribir(store, previo) });
    }
    const descuento = Math.min(0.5, Math.max(0, Number(b.descuento) || 0.08));
    const t = {
      codigo, accion, descuento,
      nombre: texto(b.nombre, 200), organismo: texto(b.organismo, 200), monto: Number(b.monto) || null,
      creado: ahora(), estado: null, mensaje: null, historial: [],
      total: null, neto: null, plazo: null, detalle: null, items: null, pdf: false,
      envios: previo?.envios || 0, // cuántas veces quedó enviada antes (para editar)
    };
    anotar(t, "en_cola", accion === "probar" ? "Prueba sin enviar: el robot la tomará en segundos." : "Esperando que el robot del PC la tome.");
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

  // ---------- robot del PC ----------
  if (ruta === "latido" && req.method === "POST") {
    const b = await cuerpo(req);
    await store.setJSON("robot/latido", {
      visto: ahora(), ocupado: !!b.ocupado, tarea: texto(b.tarea, 200), equipo: texto(b.equipo, 60), version: texto(b.version, 20),
    });
    if (b.ocupado) return json({ siguiente: null });
    const lista = await todos(store);
    // un pedido tomado que quedó colgado (PC apagado a mitad de camino) vuelve a la cola
    for (const t of lista) {
      if (t.estado === "tomado" && Date.now() - Date.parse(t.actualizado) > TOMADO_VENCE_MS) {
        anotar(t, "en_cola", "El robot no alcanzó a empezarla; vuelve a la cola.");
        await escribir(store, t);
      }
    }
    const siguiente = lista.filter((t) => t.estado === "en_cola").sort((a, b) => a.creado.localeCompare(b.creado))[0];
    if (!siguiente) return json({ siguiente: null });
    anotar(siguiente, "tomado", "El robot del PC la tomó.");
    return json({ siguiente: await escribir(store, siguiente) });
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
    const enviado = (e) => e === "enviada" || e === "confirmada";
    if (enviado(b.estado) && !enviado(t.estado)) t.envios = (t.envios || 0) + 1;
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
