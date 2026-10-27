// Proxy seguro hacia la API de Mercado Público.
// La clave (ticket) vive SOLO en la variable de entorno MP_TICKET de Netlify;
// nunca llega al navegador.
//
// Rutas:
//   GET /api/oportunidades?rubros=aridos,jardin   Compras Ágiles y licitaciones abiertas, por rubro
//   GET /api/licitacion?codigo=1234-5-LE26          detalle resumido (también acepta códigos COT de Compra Ágil)
//   GET /api/oc?codigo=1234-56-AG26                 detalle resumido de una orden de compra
//   GET /api/proveedor?rut=76.123.456-7             código de proveedor a partir del RUT
//   GET /api/estado                                 verifica que la clave esté configurada

import rubrosData from "../../rubros.json";

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

async function mp(path, params, intentos = 4) {
  const ticket = process.env.MP_TICKET;
  if (!ticket) throw new HttpError(500, "Falta configurar MP_TICKET en Netlify.");
  const qs = new URLSearchParams({ ...params, ticket });
  const url = `${BASE}/${path}?${qs}`;
  for (let i = 0; i < intentos; i++) {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    const j = await r.json().catch(() => null);
    // La API responde {Codigo, Mensaje} cuando hay error o exceso de peticiones simultáneas.
    if (j && (j.Listado || j.listaEmpresas)) return j;
    if (i < intentos - 1) {
      await sleep(600 * (i + 1));
      continue;
    }
    throw new HttpError(502, (j && j.Mensaje) || "Mercado Público no respondió.");
  }
}

// API de Compra Ágil (ChileCompra, mayo 2026): mismo ticket, pero va en el encabezado "ticket".
const BASE_CA = "https://api2.mercadopublico.cl/v2";
async function ca(path, params = {}) {
  const ticket = process.env.MP_TICKET;
  if (!ticket) throw new HttpError(500, "Falta configurar MP_TICKET en Netlify.");
  const qs = new URLSearchParams(params);
  const r = await fetch(`${BASE_CA}/${path}${qs.toString() ? "?" + qs : ""}`, {
    headers: { accept: "application/json", ticket },
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 429) throw new HttpError(429, "Se agotó la cuota diaria de la API de Compra Ágil; vuelve a intentar mañana.");
  if (r.status === 404) throw new HttpError(404, "No se encontró esa Compra Ágil.");
  const j = await r.json().catch(() => null);
  if (!j || j.success !== "OK") {
    const e = j && j.errors && j.errors[0];
    throw new HttpError(r.status >= 400 ? r.status : 502, (e && (e.detalle || e.mensaje)) || "La API de Compra Ágil no respondió.");
  }
  return j.payload;
}

// "2026-10-27 15:00" (hora de Chile) -> "2026-10-27T15:00:00"
const fechaCA = (s) => (s ? String(s).replace(" ", "T") + (String(s).length === 16 ? ":00" : "") : null);
const urlCA = (codigo) => `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(codigo)}`;

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

async function licitacionesAbiertas(rubros, inicio) {
  const activas = await cached("activas", 30 * 60 * 1000, () =>
    mp("licitaciones.json", { estado: "activas" }, 2)
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

  // Enriquecemos las primeras con su detalle (monto, organismo, región), con un tope de tiempo
  // para responder siempre rápido; las que no alcancen se completan en la próxima consulta (caché).
  const top = lista.slice(0, 18);
  let idx = 0;
  async function worker() {
    while (idx < top.length && Date.now() - inicio < 7000) {
      const x = top[idx++];
      try {
        const d = await cached("lic:" + x.codigo, 6 * 3600 * 1000, async () => {
          const j = await mp("licitaciones.json", { codigo: x.codigo }, 1);
          return resumenLicitacion(j.Listado[0]);
        });
        Object.assign(x, {
          fuente: "LIC",
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
  await Promise.all([worker(), worker(), worker()]);
  lista.forEach((x) => { x.fuente = "LIC"; });
  return { totalActivas: activas.Cantidad, lista };
}

async function compraAgilAbiertas(rubros, inicio) {
  // Una búsqueda por término de cada rubro (estado publicada), en paralelo y con tope de tiempo.
  const tareas = [];
  for (const r of rubros) for (const q of RUBROS[r].qca || []) tareas.push({ r, q });
  const porCodigo = new Map();
  let idx = 0;
  async function worker() {
    while (idx < tareas.length && Date.now() - inicio < 8000) {
      const { r, q } = tareas[idx++];
      try {
        const p = await cached("ca:" + q, 10 * 60 * 1000, () =>
          ca("compra-agil", { estado: "publicada", q, tamano_pagina: 50, ordenar_por: "FechaPublicacion" })
        );
        for (const i of p.items || []) {
          const n = norm(i.nombre);
          if (EXCL.test(n)) continue;
          let x = porCodigo.get(i.codigo);
          if (!x) {
            x = {
              fuente: "CA",
              codigo: i.codigo,
              nombre: (i.nombre || "").trim(),
              cierre: fechaCA(i.fechas && i.fechas.fecha_cierre),
              monto: (i.montos && i.montos.monto_disponible_clp) || null,
              organismo: i.institucion && i.institucion.organismo_comprador,
              unidad: i.institucion && i.institucion.unidad_compra,
              region: ((i.institucion && i.institucion.nombre_region) || "").trim(),
              ofertas: (i.resumen && i.resumen.total_ofertas_recibidas) || 0,
              rubros: [],
              url: urlCA(i.codigo),
            };
            porCodigo.set(i.codigo, x);
          }
          for (const k of new Set([r, ...clasificar(i.nombre).filter((k) => rubros.includes(k))])) {
            if (!x.rubros.includes(k)) x.rubros.push(k);
          }
        }
      } catch (e) {
        if (e.status === 429) throw e;
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  const ahora = Date.now();
  return [...porCodigo.values()].filter((x) => !x.cierre || new Date(x.cierre).getTime() > ahora);
}

async function oportunidades(rubros) {
  const inicio = Date.now();
  const [lic, cag] = await Promise.allSettled([licitacionesAbiertas(rubros, inicio), compraAgilAbiertas(rubros, inicio)]);
  if (lic.status === "rejected" && cag.status === "rejected") throw lic.reason;
  const L = lic.status === "fulfilled" ? lic.value.lista : [];
  const C = cag.status === "fulfilled" ? cag.value : [];
  const todas = [...C, ...L].sort((a, b) => new Date(a.cierre || "2999-01-01") - new Date(b.cierre || "2999-01-01"));
  return {
    actualizado: new Date().toISOString(),
    totalActivas: lic.status === "fulfilled" ? lic.value.totalActivas : null,
    cantidad: todas.length,
    cantidadCompraAgil: C.length,
    cantidadLicitaciones: L.length,
    avisos: [
      lic.status === "rejected" ? "Las licitaciones no respondieron; se muestran solo Compras Ágiles." : null,
      cag.status === "rejected" ? (cag.reason && cag.reason.message) || "Compra Ágil no respondió; se muestran solo licitaciones." : null,
    ].filter(Boolean),
    oportunidades: todas.slice(0, 150),
  };
}

function resumenCompraAgil(p) {
  const inst = p.institucion || {};
  const f = p.fechas || {};
  const conv = p.convocatoria || {};
  const pres = p.presupuesto || {};
  return {
    fuente: "CA",
    codigo: p.codigo,
    nombre: (p.nombre || "").trim(),
    descripcion: (p.descripcion || "").trim().slice(0, 800),
    estado: p.estado && p.estado.glosa,
    cierre: fechaCA(f.fecha_cierre),
    cierreSegundoLlamado: fechaCA(conv.fecha_cierre_segundo_llamado),
    publicacion: fechaCA(f.fecha_publicacion),
    monto: pres.monto_disponible_clp || pres.presupuesto_estimado || null,
    tipoPresupuesto: pres.tipo_presupuesto,
    organismo: inst.organismo_comprador,
    unidad: inst.unidad_compra,
    region: (inst.nombre_region || "").trim(),
    direccionEntrega: p.entrega && (p.entrega.direccion_entrega || "").trim(),
    plazoEntregaDias: p.entrega && p.entrega.plazo_entrega_dias,
    ofertas: (p.proveedores_cotizando || []).length,
    adjuntos: (p.documentos || []).map((d) => d.nombre).filter(Boolean),
    items: (p.productos_solicitados || []).map((i, k) => ({
      linea: k + 1,
      producto: i.nombre,
      codigoCategoria: String(i.codigo_producto || ""),
      descripcion: (i.descripcion || "").trim(),
      cantidad: i.cantidad,
      unidad: i.unidad_medida,
    })),
    totalItems: (p.productos_solicitados || []).length,
    url: urlCA(p.codigo),
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
    } else if (ruta === "licitacion" && /-COT\d+$/i.test((url.searchParams.get("codigo") || "").trim())) {
      const codigo = url.searchParams.get("codigo").trim().toUpperCase();
      if (!CODIGO.test(codigo)) throw new HttpError(400, "Código de Compra Ágil no válido.");
      data = resumenCompraAgil(await ca(`compra-agil/${encodeURIComponent(codigo)}`));
      ttl = 600;
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
