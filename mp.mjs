// Proxy seguro hacia la API de Mercado Público.
// La clave (ticket) vive SOLO en la variable de entorno MP_TICKET de Netlify;
// nunca llega al navegador.
//
// Rutas:
//   GET /api/oportunidades?rubros=aridos,jardin   licitaciones activas filtradas por rubro
//   GET /api/licitacion?codigo=1234-5-LE26          detalle resumido de una licitación
//   GET /api/oc?codigo=1234-56-AG26                 detalle resumido de una orden de compra
//   GET /api/proveedor?rut=76.123.456-7             código de proveedor a partir del RUT
//   GET /api/estado                                 verifica que la clave esté configurada

import rubrosData from "./rubros.json";

const BASE = "https://api.mercadopublico.cl/servicios/v1/publico";
const RUBROS = rubrosData.rubros;
const RX = Object.fromEntries(
  Object.entries(RUBROS).map(([k, v]) => [k, new RegExp(v.kw)])
);
const EXCL = /(punta arenas|in vitro|crema|locion|humectante|panal|pantalla|panel|mesa de partes|mesa central|sillas? de ruedas|carpa de oxigeno|apositos?|quirur|oseo|dental|odontolog|playa el salitre|navide)/;

// Caché en memoria por instancia (las funciones se reutilizan entre llamadas cercanas).
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.p;
  const p = fn().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { t: Date.now(), p });
  return p;
}

const norm = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mp(path, params) {
  const ticket = process.env.MP_TICKET;
  if (!ticket) throw new HttpError(500, "Falta configurar MP_TICKET en Netlify.");
  const qs = new URLSearchParams({ ...params, ticket });
  const url = `${BASE}/${path}?${qs}`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    const j = await r.json().catch(() => null);
    // La API responde {Codigo, Mensaje} cuando hay error o exceso de peticiones simultáneas.
    if (j && (j.Listado || j.listaEmpresas)) return j;
    if (i < 3) {
      await sleep(800 * (i + 1));
      continue;
    }
    throw new HttpError(502, (j && j.Mensaje) || "Mercado Público no respondió.");
  }
}

class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

function clasificar(nombre) {
  const n = norm(nombre);
  if (EXCL.test(n)) return [];
  return Object.keys(RX).filter((k) => RX[k].test(n));
}

function resumenLicitacion(o) {
  const c = o.Comprador || {};
  const f = o.Fechas || {};
  return {
    codigo: o.CodigoExterno,
    nombre: o.Nombre,
    descripcion: (o.Descripcion || "").slice(0, 600),
    estado: o.Estado,
    tipo: o.Tipo,
    cierre: o.FechaCierre || f.FechaCierre,
    publicacion: f.FechaPublicacion,
    adjudicacionEstimada: f.FechaEstimadaAdjudicacion,
    monto: o.VisibilidadMonto === 1 ? o.MontoEstimado : null,
    moneda: o.Moneda,
    organismo: c.NombreOrganismo,
    unidad: c.NombreUnidad,
    region: (c.RegionUnidad || "").trim(),
    comuna: c.ComunaUnidad,
    direccionEntrega: o.DireccionEntrega,
    plazoPagoDias: o.TipoPago,
    items: ((o.Items && o.Items.Listado) || []).slice(0, 60).map((i) => ({
      linea: i.Correlativo,
      producto: i.NombreProducto,
      categoria: i.Categoria,
      codigoCategoria: String(i.CodigoCategoria || ""),
      descripcion: i.Descripcion,
      cantidad: i.Cantidad,
      unidad: i.UnidadMedida,
    })),
    totalItems: (o.Items && o.Items.Cantidad) || 0,
    url: `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(o.CodigoExterno)}`,
  };
}

function resumenOC(o) {
  const c = o.Comprador || {};
  const p = o.Proveedor || {};
  return {
    codigo: o.Codigo,
    nombre: o.Nombre,
    tipo: o.Tipo,
    estado: o.Estado,
    totalNeto: o.TotalNeto,
    total: o.Total,
    formaPago: o.FormaPago,
    fecha: o.Fechas && o.Fechas.FechaCreacion,
    organismo: c.NombreOrganismo,
    region: (c.RegionUnidad || "").trim(),
    comuna: c.ComunaUnidad,
    proveedor: p.Nombre,
    items: ((o.Items && o.Items.Listado) || []).map((i) => ({
      producto: i.Producto,
      categoria: i.Categoria,
      cantidad: i.Cantidad,
      precioNeto: i.PrecioNeto,
      especificacion: i.EspecificacionComprador,
    })),
  };
}

async function oportunidades(rubros) {
  const activas = await cached("activas", 30 * 60 * 1000, () =>
    mp("licitaciones.json", { estado: "activas" })
  );
  const ahora = Date.now();
  const lista = (activas.Listado || [])
    .map((x) => ({
      codigo: x.CodigoExterno,
      nombre: x.Nombre,
      cierre: x.FechaCierre,
      rubros: clasificar(x.Nombre),
    }))
    .filter((x) => x.rubros.some((r) => rubros.includes(r)))
    .filter((x) => !x.cierre || new Date(x.cierre).getTime() > ahora)
    .sort((a, b) => new Date(a.cierre) - new Date(b.cierre));

  // Enriquecemos las primeras con su detalle (monto, organismo, región), de a dos en paralelo.
  const top = lista.slice(0, 24);
  let idx = 0;
  async function worker() {
    while (idx < top.length) {
      const x = top[idx++];
      try {
        const d = await cached("lic:" + x.codigo, 6 * 3600 * 1000, async () => {
          const j = await mp("licitaciones.json", { codigo: x.codigo });
          return resumenLicitacion(j.Listado[0]);
        });
        Object.assign(x, {
          monto: d.monto,
          organismo: d.organismo,
          region: d.region,
          comuna: d.comuna,
          tipo: d.tipo,
          totalItems: d.totalItems,
          url: d.url,
        });
      } catch {
        /* si falla el detalle mostramos igual la oportunidad */
      }
    }
  }
  await Promise.all([worker(), worker()]);
  return {
    actualizado: activas.FechaCreacion,
    totalActivas: activas.Cantidad,
    cantidad: lista.length,
    oportunidades: lista.slice(0, 80),
  };
}

const CODIGO = /^[0-9]{1,8}-[0-9]{1,6}-[A-Z0-9]{2,6}$/i;

export default async (req) => {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  try {
    let data;
    let ttl = 600;
    if (ruta === "estado") {
      data = { ok: Boolean(process.env.MP_TICKET) };
      ttl = 60;
    } else if (ruta === "oportunidades") {
      const pedidos = (url.searchParams.get("rubros") || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => RUBROS[s]);
      if (!pedidos.length) throw new HttpError(400, "Indica al menos un rubro válido.");
      data = await oportunidades(pedidos);
      ttl = 900;
    } else if (ruta === "licitacion") {
      const codigo = (url.searchParams.get("codigo") || "").trim();
      if (!CODIGO.test(codigo)) throw new HttpError(400, "Código de licitación no válido.");
      const j = await mp("licitaciones.json", { codigo });
      if (!j.Listado.length) throw new HttpError(404, "No se encontró esa licitación.");
      data = resumenLicitacion(j.Listado[0]);
      ttl = 3600;
    } else if (ruta === "oc") {
      const codigo = (url.searchParams.get("codigo") || "").trim();
      if (!CODIGO.test(codigo)) throw new HttpError(400, "Código de orden de compra no válido.");
      const j = await mp("ordenesdecompra.json", { codigo });
      if (!j.Listado.length) throw new HttpError(404, "No se encontró esa orden de compra.");
      data = resumenOC(j.Listado[0]);
      ttl = 3600;
    } else if (ruta === "proveedor") {
      const rut = (url.searchParams.get("rut") || "").trim();
      if (!/^[0-9.]{7,12}-[0-9kK]$/.test(rut)) throw new HttpError(400, "RUT no válido (ej: 76.123.456-7).");
      const j = await mp("Empresas/BuscarProveedor", { rutempresaproveedor: rut });
      data = { empresas: j.listaEmpresas || [] };
      ttl = 86400;
    } else {
      throw new HttpError(404, "Ruta no encontrada.");
    }
    return Response.json(data, {
      headers: {
        "cache-control": "public, max-age=60",
        "netlify-cdn-cache-control": `public, s-maxage=${ttl}, stale-while-revalidate=${ttl}`,
      },
    });
  } catch (e) {
    const status = e.status || 500;
    return Response.json({ error: e.message || "Error inesperado." }, { status });
  }
};

export const config = { path: "/api/*" };
