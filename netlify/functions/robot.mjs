// Puente entre CotizÁgil (celular) y el robot del PC.
// El celular pide "Hacer oferta"; el robot del PC toma el pedido, prepara la oferta en
// Mercado Público y va informando el estado. El envío final y la declaración jurada
// los hace siempre la persona en mercadopublico.cl.
//
// Seguridad: todas las llamadas exigen el encabezado x-robot-token igual a la variable
// de entorno ROBOT_TOKEN (configurada en Netlify, nunca en el código ni en index.html).
import { getStore } from "@netlify/blobs";
import { timingSafeEqual, createHash } from "node:crypto";

export const config = { path: ["/bot", "/bot/*"] };

const ESTADOS_ACTIVOS = new Set(["en_cola", "tomado", "preparando", "lista"]);
const ACCIONES = new Set(["ofertar", "editar", "probar"]);
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

export default async (req) => {
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
    if (!/^\d{3,6}-\d{1,6}-COT\d{2}$/.test(codigo)) {
      return json({ error: "El robot solo trabaja Compras Ágiles (códigos como 1234-56-COT26)." }, 400);
    }
    const previo = await leer(store, codigo);
    if (previo && ESTADOS_ACTIVOS.has(previo.estado)) return json({ trabajo: previo, aviso: "Ya está en manos del robot." }, 409);
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
    const enviado = (e) => e === "enviada" || e === "confirmada";
    if (enviado(b.estado) && !enviado(t.estado)) t.envios = (t.envios || 0) + 1;
    if (b.pdf_b64) {
      const bytes = Buffer.from(String(b.pdf_b64), "base64");
      if (bytes.length <= MAX_PDF && bytes.subarray(0, 4).toString() === "%PDF") {
        await store.set("pdf/" + t.codigo, bytes);
        t.pdf = true;
      }
    }
    anotar(t, b.estado || null, b.mensaje);
    return json({ trabajo: await escribir(store, t) });
  }

  return json({ error: "Ruta no encontrada." }, 404);
};
