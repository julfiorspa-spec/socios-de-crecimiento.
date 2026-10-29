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
const ORIGENES_MP = new Set([ORIGEN_MP, "https://www.mercadopublico.cl"]);
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

async function atender(req) {
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
    o.descartes = (await store.get("oportunidades/descartes", { type: "json" })) || {};
    return json(o);
  }
  // «No deseadas» (deslizar a la izquierda): se guardan para todos tus dispositivos y el robot no las prepara
  if (ruta === "oport-descartes" && req.method === "GET") {
    return json({ descartes: (await store.get("oportunidades/descartes", { type: "json" })) || {} });
  }
  if (ruta === "oport-descartar" && req.method === "POST") {
    const b = await cuerpo(req);
    const codigo = limpiaCodigo(b.codigo);
    if (!/^\d{1,8}-\d{1,8}-[A-Z0-9]{3,6}$/.test(codigo)) return json({ error: "Código inválido" }, 400);
    const d = (await store.get("oportunidades/descartes", { type: "json" })) || {};
    if (b.descartar === false) delete d[codigo]; else d[codigo] = ahora();
    const claves = Object.keys(d);
    if (claves.length > 3000) for (const k of claves.sort((a, b) => d[a].localeCompare(d[b])).slice(0, claves.length - 3000)) delete d[k];
    await store.setJSON("oportunidades/descartes", d);
    return json({ ok: true, n: Object.keys(d).length });
  }
  if (ruta === "oportunidades-actualizar" && req.method === "POST") {
    await store.setJSON("oportunidades/pedido", { t: Date.now() });
    return json({ ok: true });
  }

  // ---------- ⭐ Seleccionadas (compartidas entre tus celulares) ----------
  if (ruta === "seleccionadas" && req.method === "GET") {
    return json({ sel: (await store.get("oportunidades/seleccionadas", { type: "json" })) || {} });
  }
  if (ruta === "seleccionar" && req.method === "POST") {
    const b = await cuerpo(req);
    const codigo = limpiaCodigo(b.codigo);
    if (!/^\d{1,8}-\d{1,8}-COT\d{2}$/.test(codigo)) return json({ error: "Código inválido" }, 400);
    const s = (await store.get("oportunidades/seleccionadas", { type: "json" })) || {};
    if (b.quitar) delete s[codigo];
    else {
      const prev = s[codigo] || { desde: ahora() };
      const num = (v) => (v == null || v === "" ? undefined : Math.max(0, Math.round(Number(v) || 0)));
      s[codigo] = { ...prev, nombre: texto(b.nombre, 200) ?? prev.nombre, organismo: texto(b.organismo, 120) ?? prev.organismo,
        monto: num(b.monto) ?? prev.monto, cierre: texto(b.cierre, 40) ?? prev.cierre, margen: b.margen != null ? Number(b.margen) || 0 : prev.margen,
        precio: num(b.precio) ?? prev.precio, costo: b.costo === null ? undefined : num(b.costo) ?? prev.costo, actualizado: ahora() };
    }
    await store.setJSON("oportunidades/seleccionadas", s);
    return json({ ok: true, sel: s });
  }

  // ---------- 📨 seguimiento en vivo de las enviadas (estado en Mercado Público, ganador y orden de compra) ----------
  if (ruta === "seguimiento" && req.method === "GET") {
    const robot = (await store.get("robot/latido", { type: "json" })) || {};
    const miRut = String(robot.rut || process.env.PROVEEDOR_RUT || "").replace(/[.\s]/g, "").toUpperCase();
    const lista = (await todos(store)).filter((t) => t.estado === "enviada" || t.estado === "confirmada");
    const cache = (await store.get("seguimiento/cache", { type: "json" })) || {};
    const forzar = url.searchParams.get("forzar") === "1";
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
    for (const t of fila) {               // recién ganada: abre su negocio y pide el informe al PC
      if (res[t.codigo]?.ganada && !t.op) {
        t.op = { etapa: "ganada", historial: [{ t: ahora(), etapa: "ganada" }], pedido_informe: { t: ahora() }, oc: res[t.codigo].oc };
        await escribir(store, t);
      }
    }
    return json({ seguimiento: res, rut: miRut || null });
  }

  // ---------- 🏆 negocio ganado: etapas Inversionista → Operación → Despacho → Entrega → Cerrado ----------
  const ETAPAS = ["ganada", "inversionista", "operacion", "despacho", "entrega", "cerrado"];
  if (ruta === "operacion" && req.method === "POST") {
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    const op = t.op || { etapa: "ganada", historial: [] };
    if (b.etapa && ETAPAS.includes(b.etapa) && b.etapa !== op.etapa) {
      op.historial = [...(op.historial || []), { t: ahora(), etapa: b.etapa, por: texto(b.dispositivo, 60) }].slice(-30);
      op.etapa = b.etapa;
    }
    const d = b.datos && typeof b.datos === "object" ? b.datos : {};
    for (const k of ["proveedor", "contacto", "telefono", "email", "transporte", "notas", "medio_pago", "guia", "factura"]) if (d[k] !== undefined) op[k] = texto(d[k], 300);
    for (const k of ["precio_acordado", "costo_transporte", "opcion"]) if (d[k] !== undefined) op[k] = d[k] === null ? null : Math.max(0, Math.round(Number(d[k]) || 0));
    for (const k of ["inversion_ok", "compra_ok", "despacho_ok", "guia_firmada", "factura_firmada", "aplica_comision"]) if (d[k] !== undefined) op[k] = !!d[k];
    if (d.comision !== undefined) op.comision = Math.min(0.10, Math.max(0.01, Number(d.comision) || 0.04));
    if (b.pedir_informe) op.pedido_informe = { t: ahora(), rebuscar: !!b.rebuscar };
    t.op = op;
    return json({ trabajo: await escribir(store, t) });
  }
  // archivos del negocio: informe PDF y Excel (los sube el PC), fotos / guías / facturas (las sube el celular)
  if (ruta === "subir" && req.method === "POST") {
    const b = await cuerpo(req);
    const t = await leer(store, limpiaCodigo(b.codigo));
    if (!t) return json({ error: "No existe." }, 404);
    const tipo = ["foto", "guia", "factura", "otro"].includes(b.tipo) ? b.tipo : "otro";
    const bytes = Buffer.from(String(b.b64 || ""), "base64");
    if (!bytes.length || bytes.length > MAX_PDF) return json({ error: "Archivo vacío o de más de 4,5 MB." }, 400);
    const op = t.op || { etapa: "ganada", historial: [] };
    const id = Date.now().toString(36);
    await store.set(`doc/${t.codigo}/${id}`, bytes);
    op.docs = [...(op.docs || []), { id, tipo, nombre: texto(b.nombre, 120) || tipo, mime: texto(b.mime, 60) || "application/octet-stream",
      kb: Math.round(bytes.length / 1024), fecha: ahora(), por: texto(b.dispositivo, 60) }].slice(-40);
    if (tipo === "foto" && b.cerrar) {                 // la foto de la entrega cierra el negocio (en oro)
      op.historial = [...(op.historial || []), { t: ahora(), etapa: "cerrado", por: texto(b.dispositivo, 60) }].slice(-30);
      op.etapa = "cerrado"; op.cerrado = ahora();
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
      previo.dispositivo = texto(b.dispositivo, 60) || previo.dispositivo || null;   // qué celular la envió (registro «Enviados» del PC)
      anotar(previo, "en_cola", "El robot revisará en Mercado Público si ya quedó enviada.");
      return json({ trabajo: await escribir(store, previo) });
    }
    const descuento = Math.min(0.6, Math.max(0, b.descuento != null ? Number(b.descuento) || 0 : esLic ? 0.17 : 0.08));
    const t = {
      codigo, accion, descuento,
      nombre: texto(b.nombre, 200), organismo: texto(b.organismo, 200), monto: Number(b.monto) || null,
      creado: ahora(), estado: null, mensaje: null, historial: [],
      total: null, neto: null, plazo: null, detalle: null, items: null, pdf: false,
      envios: previo?.envios || 0, // cuántas veces quedó enviada antes (para editar)
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

  // ---------- robot del PC ----------
  if (ruta === "latido" && req.method === "POST") {
    const b = await cuerpo(req);
    await store.setJSON("robot/latido", {
      visto: ahora(), ocupado: !!b.ocupado, tarea: texto(b.tarea, 200), equipo: texto(b.equipo, 60), version: texto(b.version, 20),
      rut: texto(b.rut, 20),
    });
    const pidio = await store.get("oportunidades/pedido", { type: "json" });   // la app pidió actualizar oportunidades
    if (pidio) await store.delete("oportunidades/pedido");
    const lista = await todos(store);
    const negocios = lista.filter((t) => t.op?.pedido_informe).map((t) => ({ codigo: t.codigo, total: t.total, op: t.op })).slice(0, 5);
    const op = { ...(pidio ? { oportunidades: true } : {}), ...(negocios.length ? { negocios } : {}) };
    if (b.ocupado) return json({ siguiente: null, ...op });
    // un pedido tomado que quedó colgado (PC apagado a mitad de camino) vuelve a la cola
    for (const t of lista) {
      if (t.estado === "tomado" && Date.now() - Date.parse(t.actualizado) > TOMADO_VENCE_MS) {
        anotar(t, "en_cola", "El robot no alcanzó a empezarla; vuelve a la cola.");
        await escribir(store, t);
      }
    }
    const siguiente = lista.filter((t) => t.estado === "en_cola").sort((a, b) => a.creado.localeCompare(b.creado))[0];
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
