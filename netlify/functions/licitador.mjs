// 🏛 LICITADOR · motor de decisión de licitaciones (puro, sin dependencias, sin red).
// Port del «CotizAgil autonomous bid decision engine v1.0» al flujo real de CotizÁgil: recibe la licitación leída
// (ítems con requisitos y su evidencia), los candidatos encontrados (producto + cotización con evidencia), los
// supuestos de la empresa (ejecución, factoring, PPM) y devuelve: selección por ítem, precio, números, semáforo y
// qué falta. NUNCA inventa: lo que no tiene evidencia queda en «pendientes»; lo que incumple, en «bloqueos».
//
// Evidencia (estado): "verificado" (confirmado por humano/proveedor o compra propia) · "publicado" (lo dice una fuente
// pública con URL y fecha) · "estimado" (cálculo nuestro) · "falta".
// Semáforo: ROJO (hay bloqueos) · AMARILLO (sin bloqueos, con pendientes) · FUEGO (todo verificado y margen ≥ fuego_pct)
// · VERDE (todo verificado, margen entre el piso y fuego).
import { cajaPorFecha, PARAMS_BASE } from "./evaluador.mjs";

const R0 = (v) => Math.round(Number(v) || 0);
const fin = (n) => Number.isFinite(n) && n >= 0;
export const clp = (v) => (R0(v) < 0 ? "-$" : "$") + Math.abs(R0(v)).toLocaleString("es-CL");
export const COD_LIC = /^\d{1,8}-\d{1,8}-[A-Z][A-Z0-9]{1,2}\d{2}$/i;   // 2736-46-LE26 · 1234-5-LP26 · 99-1-L126 · 1057851-1-L126 · 1233822-17-CO26
export const PARAMS_LIC = { ...PARAMS_BASE, margen_min: 12, fuego_pct: 25, descuento_lic: 0.17, validez_dias: 60, garantia_seriedad_pct: 0, garantia_fiel_pct: 5 };

// 🏢 Perfil oficial de PJANIC SpA (21-11-2026). Lo que está acreditado se escribe en los anexos; lo informado-sin-respaldo va como PENDIENTE y nunca se declara solo.
export const EMPRESA_BASE = { razon_social: "Sociedad de Inversiones y Gestión PJANIC SpA", nombre_corto: "PJANIC SpA", rut: "78.493.114-5", email: "pjanicspa@gmail.com", telefono: "+56 9 9047 5141",
  direccion: "Zenteno 1181", comuna: "Santiago", ciudad: "Santiago", region: "Metropolitana", pais: "Chile",
  representante: "Cristopher Antonio Pino Zamora", rut_representante: "19.375.012-5", representante_cargo: "Representante legal", representante_email: "pjanicspa@gmail.com", representante_telefono: "+56 9 9047 5141",
  contacto_comercial: "Cristopher Antonio Pino Zamora", actividad: "Comercializadora intermediaria en Mercado Público",
  facultades_ok: false, integridad_ok: false, difusion_integridad_ok: false,
  // informado, pendiente de acreditar (se escribe en el anexo marcado PENDIENTE):
  giro: "", constitucion: "Empresa en un Día, septiembre de 2026 (informada; confirmar acto, fecha exacta y notaría)", accionista: "Cristopher Antonio Pino Zamora, 100 % (informado; verificar con respaldo societario)",
  banco: "", banco_tipo_cuenta: "", banco_numero_cuenta: "", banco_ciudad: "", contacto_finanzas: "", fax: "",
  pendientes: [
    "Giro tributario y código de actividad: verificar con el SII",
    "Personería del representante: confirmar acto, fecha exacta, notaría y facultades",
    "Participación y beneficiarios finales: verificar con respaldo societario",
    "Banco, tipo y número de cuenta y ciudad de apertura: por completar",
    "Contacto de finanzas, contabilidad o facturación: por completar",
    "Fax: solo si el formulario lo pide",
  ] };

// compara el valor informado del producto con lo exigido. null = no hay dato (no se inventa).
export function comparar(comparador, real, esperado) {
  if (real === undefined || real === null || real === "") return null;
  const n = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (comparador === "eq") return n(real) === n(esperado);
  if (comparador === "includes") return n(real).includes(n(esperado));
  if (comparador === "boolean") return typeof real === "boolean" ? real === (esperado === true || esperado === "true" || esperado === "sí" || esperado === "si") : null;
  const a = parseFloat(String(real).replace(/\./g, "").replace(",", ".")), e = parseFloat(String(esperado).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(a) || !Number.isFinite(e)) return null;
  return comparador === "gte" ? a >= e : comparador === "lte" ? a <= e : null;
}

// ---------- validación de datos ----------
export function validar(lic, sel) {
  const err = [];
  if (!COD_LIC.test(String(lic.id || ""))) err.push("Código de Mercado Público con formato no reconocido: " + lic.id);
  const iva = lic.iva ?? 0.19; if (!fin(iva) || iva >= 1) err.push("Tasa de IVA inválida");
  for (const it of lic.items || []) {
    if (!(Number(it.cantidad) > 0)) err.push(`Cantidad inválida: ${it.nombre}`);
    const n = sel.filter((s) => s.itemId === it.id).length;
    if (n > 1) err.push(`Hay ${n} selecciones para ${it.nombre}; debe ser una`);
  }
  for (const s of sel) {
    if (!fin(s.precioVentaNeto) || !fin(s.cotizacion?.unitNeto) || !fin(s.cotizacion?.fleteNeto ?? 0)) err.push(`Precio o flete inválido en ${s.itemId}`);
    if (s.cotizacion && s.producto && s.cotizacion.productoId && s.cotizacion.productoId !== s.producto.id) err.push(`Cotización incompatible con el producto en ${s.itemId}`);
  }
  return err;
}

// ---------- cumplimiento técnico ----------
// Un requisito se evalúa primero con el juicio explícito del lector (c.juicios[reqId] = {cumple:true|false|null, nota}) y,
// si no lo hay, comparando el atributo del producto. Sin dato → null (pendiente de acreditar), nunca «cumple».
export function cumplimiento(lic, sel) {
  const out = [];
  for (const it of lic.items || []) {
    const s = sel.find((x) => x.itemId === it.id);
    for (const r of it.requisitos || []) {
      if (!s) { out.push({ itemId: it.id, reqId: r.id, obligatorio: !!r.obligatorio, cumple: null, nota: `${r.label}: sin producto seleccionado`, evidencia: "falta" }); continue; }
      const j = s.juicios?.[r.id];
      let cumple, nota, evidencia;
      if (j && (j.cumple === true || j.cumple === false || j.cumple === null)) { cumple = j.cumple; nota = `${r.label}: ${j.nota || (cumple === null ? "sin dato en la fuente" : cumple ? "cumple" : "NO cumple")}`; evidencia = j.evidencia || (cumple === null ? "falta" : "publicado"); }
      else { const real = s.producto?.atributos?.[r.id]; cumple = comparar(r.comparador || "includes", real, r.esperado); nota = `${r.label}: exigido ${String(r.esperado)}, informado ${real == null ? "sin dato" : String(real)}`; evidencia = real == null ? "falta" : (s.producto?.evidencia || []).some((e) => e.estado === "verificado") ? "verificado" : "publicado"; }
      out.push({ itemId: it.id, reqId: r.id, obligatorio: !!r.obligatorio, cumple, nota, evidencia, cita: r.cita || null });
    }
  }
  return out;
}

// ---------- números (CLP netos; la caja conserva el IVA) ----------
export function financieros(lic, sel, P0) {
  const P = { ...PARAMS_LIC, ...(P0 || {}) };
  let ventaNeta = 0, compraNeta = 0, flete = 0, fleteFalta = false;
  for (const s of sel) {
    const it = (lic.items || []).find((i) => i.id === s.itemId); if (!it) continue;
    const q = s.cantidad ?? it.cantidad;
    ventaNeta += q * s.precioVentaNeto; compraNeta += q * s.cotizacion.unitNeto;
    if (s.cotizacion.fleteNeto == null) fleteFalta = true; else flete += s.cotizacion.fleteNeto;
  }
  const sup = lic.supuestos || {};
  const ejecucion = sup.ejecucion != null ? R0(sup.ejecucion) : R0(ventaNeta * (P.ejecucion_pct || 0) / 100);
  const factoring = sup.factoring != null ? R0(sup.factoring) : R0(ventaNeta * (P.factoring_pct || 0) / 100);
  const ppm = sup.ppm != null ? R0(sup.ppm) : R0(ventaNeta * (P.ppm_pct || 0) / 100);
  const otros = R0(sup.otros_directos || 0) + R0(sup.garantia_costo || 0);
  const costoDirecto = R0(compraNeta) + R0(flete) + otros;
  const utilidad = R0(ventaNeta) - costoDirecto - ejecucion - factoring - ppm;
  const iva = lic.iva ?? 0.19;
  const garantiaSeriedad = lic.garantias?.seriedad_monto != null ? R0(lic.garantias.seriedad_monto) : R0(ventaNeta * (1 + iva) * ((lic.garantias?.seriedad_pct ?? P.garantia_seriedad_pct ?? 0) / 100));
  const cajaNecesaria = R0(compraNeta * (1 + iva)) + R0(flete) + otros + garantiaSeriedad;
  return { ventaNeta: R0(ventaNeta), ventaTotal: R0(ventaNeta * (1 + iva)), iva: R0(ventaNeta * iva), compraNeta: R0(compraNeta), compraTotal: R0(compraNeta * (1 + iva)), flete: R0(flete), fleteFalta, otros, costoDirecto,
    ejecucion, factoring, ppm, ejecSup: sup.ejecucion == null, factSup: sup.factoring == null, utilidad, margenPct: ventaNeta ? Math.round(10000 * utilidad / ventaNeta) / 100 : 0, cajaNecesaria, garantiaSeriedad,
    costoMaximo: R0(ventaNeta) - ejecucion - factoring - ppm };
}

// ---------- decisión ----------
export function decidir(lic, sel, P0, empresa, hoy) {
  const P = { ...PARAMS_LIC, ...(P0 || {}) }, E = { ...EMPRESA_BASE, ...(empresa || {}) };
  const bloqueos = [], pendientes = [], motivos = [];
  bloqueos.push(...validar(lic, sel));
  const h = hoy || new Date().toISOString().slice(0, 10);
  if (lic.cierre && String(lic.cierre).slice(0, 10) < h) bloqueos.push("La licitación ya cerró (" + String(lic.cierre).slice(0, 16).replace("T", " ") + ")");
  const comp = cumplimiento(lic, sel);
  for (const c of comp) {
    if (!c.obligatorio) { if (c.cumple === false) pendientes.push("Requisito deseable no cumplido: " + c.nota); continue; }
    if (c.cumple === false) bloqueos.push("INCUMPLE condición excluyente: " + c.nota);
    else if (c.cumple === null) pendientes.push("Acreditar: " + c.nota);
  }
  const sinSel = (lic.items || []).filter((it) => !sel.some((s) => s.itemId === it.id));
  for (const it of sinSel) (lic.adjudicacion_parcial ? pendientes : bloqueos).push(`Sin producto con precio real para «${it.nombre}»` + (lic.adjudicacion_parcial ? " (se puede ofertar parcial)" : ""));
  for (const s of sel) {
    const it = (lic.items || []).find((i) => i.id === s.itemId); if (!it) continue;
    const q = s.cantidad ?? it.cantidad, c = s.cotizacion;
    if (q !== it.cantidad && !lic.adjudicacion_parcial) bloqueos.push(`Cantidad distinta de la exigida en ${it.nombre} (${q} vs ${it.cantidad})`);
    if (c.stock !== "verificado") pendientes.push(`Stock no confirmado por el proveedor: ${it.nombre}` + (c.cantidadDisponible != null ? ` (publica ${c.cantidadDisponible} u.)` : ""));
    else if (c.cantidadDisponible != null && c.cantidadDisponible < q) pendientes.push(`Sin evidencia de ${q} unidades disponibles: ${it.nombre} (${c.cantidadDisponible})`);
    if (lic.plazo_entrega_dias != null && (c.plazoDias == null || c.plazoDias > lic.plazo_entrega_dias)) pendientes.push(`Plazo del proveedor ${c.plazoDias == null ? "sin acreditar" : c.plazoDias + " días > " + lic.plazo_entrega_dias + " exigidos"}: ${it.nombre}`);
    if (!c.evidencia || c.evidencia.estado === "estimado" || c.evidencia.estado === "falta") pendientes.push(`Precio de compra sin evidencia comercial: ${it.nombre}`);
    if (c.fleteNeto == null) pendientes.push(`Flete sin cotizar hasta ${lic.direccion_entrega || "el lugar de entrega"}: ${it.nombre}`);
  }
  if (!E.facultades_ok) pendientes.push("Personería / facultades de firma del representante sin acreditar (⚙ Más opciones → Datos para licitaciones)");
  if (!E.integridad_ok || !E.difusion_integridad_ok) pendientes.push("Programa y difusión de integridad no acreditados: no declarar su cumplimiento en los anexos");
  for (const d of lic.documentos || []) if (d.obligatorio && d.estado !== "listo") pendientes.push(`Documento exigido: ${d.nombre}${d.firma ? " (firma del representante)" : ""}`);
  const F = financieros(lic, sel, P);
  if (lic.presupuesto != null && sel.length) {
    const comparable = lic.presupuesto_con_iva ? F.ventaTotal : F.ventaNeta;
    if (comparable > lic.presupuesto) bloqueos.push(`La oferta ${clp(comparable)} excede el presupuesto máximo ${clp(lic.presupuesto)}${lic.presupuesto_con_iva ? " (con IVA)" : " (neto)"}`);
  }
  if (lic.presupuesto == null) pendientes.push("Las bases no informan presupuesto: se ofertó contra el mercado");
  if (sel.length && F.utilidad <= 0) bloqueos.push(`Utilidad no positiva: ${clp(F.utilidad)} después de ejecución, factoring y PPM`);
  else if (sel.length && F.margenPct < P.margen_min) pendientes.push(`Margen ${F.margenPct} % bajo el piso de ${P.margen_min} %`);
  const estado = bloqueos.length ? "ROJO" : pendientes.length ? "AMARILLO" : F.margenPct >= P.fuego_pct ? "FUEGO" : "VERDE";
  motivos.push(`Utilidad estimada ${clp(F.utilidad)} (${F.margenPct} % de la venta neta ${clp(F.ventaNeta)})`);
  motivos.push(bloqueos.length ? `${bloqueos.length} bloqueo${bloqueos.length > 1 ? "s" : ""} impiden presentar` : "Sin incumplimientos obligatorios identificados");
  motivos.push(pendientes.length ? `${pendientes.length} verificación${pendientes.length > 1 ? "es" : ""} pendiente${pendientes.length > 1 ? "s" : ""}` : "Evidencias críticas disponibles");
  // caja por fecha (misma mecánica que el evaluador de OC): compra → entrega → giro factoring → F29 → PPM
  let caja = null;
  if (sel.length) { try { const ent = lic.fecha_entrega_estimada || sumarDias(h, (lic.plazo_entrega_dias || 10) + 15);
    caja = cajaPorFecha({ L: [], ventaTotal: F.ventaTotal, ventaNeta: F.ventaNeta, compra: F.compraNeta, flete: F.flete, otros: F.otros, ejecucion: F.ejecucion, factoring: F.factoring, ppm: F.ppm, entrega: ent, hoy: h, P, sup: { fecha_compra: sumarDias(h, 15), ...(lic.supuestos || {}) }, esc: null }); } catch { caja = null; } }
  const motivo = estado === "ROJO" ? bloqueos[0] : estado === "AMARILLO" ? pendientes[0] : estado === "FUEGO" ? `margen ${F.margenPct} % ≥ ${P.fuego_pct} %, todo verificado` : `rentable: margen ${F.margenPct} %`;
  return { estado, motivo, etapa: bloqueos.length ? "BLOQUEADA" : "PENDIENTE_APROBACION", puedeOfertar: false, motivos, bloqueos, pendientes, cumplimiento: comp, numeros: F,
    caja: caja ? { eventos: caja.eventos, necesaria: caja.necesaria, recupera: caja.recupera } : null, t: new Date().toISOString() };
}

// ---------- selección automática: el producto más conveniente que cumple ----------
// candidatos[itemId] = [{ producto, cotizacion, juicios }]. Se descartan los que incumplen un obligatorio; entre el resto
// gana el de menor costo entregado (unit × q + flete), prefiriendo evidencia verificada ante empate (<2 %).
export function elegir(lic, candidatos) {
  const sel = [], descartes = [];
  for (const it of lic.items || []) {
    const lista = (candidatos?.[it.id] || []).filter((c) => c?.cotizacion && fin(c.cotizacion.unitNeto) && c.cotizacion.unitNeto > 0);
    const aptos = [];
    for (const c of lista) {
      const malo = (it.requisitos || []).find((r) => r.obligatorio && (c.juicios?.[r.id]?.cumple === false || (c.juicios?.[r.id] == null && comparar(r.comparador || "includes", c.producto?.atributos?.[r.id], r.esperado) === false)));
      if (malo) { descartes.push({ itemId: it.id, producto: c.producto?.nombre, motivo: "incumple " + malo.label }); continue; }
      aptos.push(c);
    }
    if (!aptos.length) continue;
    const costo = (c) => c.cotizacion.unitNeto * it.cantidad + (c.cotizacion.fleteNeto || 0);
    aptos.sort((a, b) => { const d = costo(a) - costo(b); if (Math.abs(d) / Math.max(1, costo(b)) < 0.02) { const v = (x) => (x.cotizacion.stock === "verificado" ? 2 : 0) + (x.cotizacion.evidencia?.estado === "verificado" ? 1 : 0); return v(b) - v(a); } return d; });
    const g = aptos[0];
    sel.push({ itemId: it.id, producto: g.producto, cotizacion: g.cotizacion, juicios: g.juicios || {}, cantidad: it.cantidad, precioVentaNeto: 0, alternativas: aptos.slice(1, 4).map((c) => ({ nombre: c.producto?.nombre, unitNeto: c.cotizacion.unitNeto, url: c.cotizacion.evidencia?.fuente })) });
  }
  return { seleccion: sel, descartes };
}

// ---------- precio: contra el presupuesto, con piso de margen, nunca sobre el máximo ----------
// Reparte el presupuesto neto × (1 − descuento) proporcional al costo de cada ítem. Si el margen queda bajo el piso, sube
// hasta el presupuesto (descuento mínimo 1 %). Sin presupuesto, precio = costo entregado / (1 − margen objetivo − cargas).
export function fijarPrecios(lic, sel, P0, descuento) {
  const P = { ...PARAMS_LIC, ...(P0 || {}) }, iva = lic.iva ?? 0.19; if (!sel.length) return { sel, descuento: null, modo: "sin seleccion" };
  const cargas = ((P.ejecucion_pct || 0) + (P.factoring_pct || 0) + (P.ppm_pct || 0)) / 100;
  const costoNeto = sel.reduce((a, s) => a + s.cotizacion.unitNeto * s.cantidad + (s.cotizacion.fleteNeto || 0), 0);
  const presNeto = lic.presupuesto != null ? (lic.presupuesto_con_iva ? lic.presupuesto / (1 + iva) : lic.presupuesto) : null;
  const porcion = (s) => (s.cotizacion.unitNeto * s.cantidad + (s.cotizacion.fleteNeto || 0)) / Math.max(1, costoNeto);
  const aplicar = (ventaNeta) => { for (const s of sel) s.precioVentaNeto = Math.max(1, Math.floor(ventaNeta * porcion(s) / s.cantidad)); };
  let d = descuento != null ? descuento : P.descuento_lic, modo = "presupuesto";
  if (presNeto != null && presNeto > 0) {
    // ítems cuyo presupuesto propio viene por línea
    aplicar(presNeto * (1 - d));
    const margen = (v) => (v - costoNeto - v * cargas) / v;
    if (margen(presNeto * (1 - d)) < P.margen_min / 100) {   // subir hasta donde alcance (máximo 1 % bajo el presupuesto)
      const vMin = costoNeto / (1 - cargas - P.margen_min / 100);
      const v = Math.min(presNeto * 0.99, Math.max(vMin, presNeto * (1 - d)));
      d = Math.round((1 - v / presNeto) * 1000) / 1000; aplicar(v); modo = vMin > presNeto * 0.99 ? "tope presupuesto (margen bajo el piso)" : "piso de margen";
    }
  } else { const v = costoNeto / (1 - cargas - Math.max(P.margen_min, 20) / 100); aplicar(v); d = null; modo = "sin presupuesto: costo + margen objetivo"; }
  // los precios por ítem no pueden superar un máximo por línea si las bases lo fijan
  for (const s of sel) { const it = (lic.items || []).find((i) => i.id === s.itemId); if (it?.precio_max_unit_neto != null && s.precioVentaNeto > it.precio_max_unit_neto) { s.precioVentaNeto = Math.floor(it.precio_max_unit_neto); modo += " · tope por línea"; } }
  return { sel, descuento: d, modo };
}

// ---------- plan de documentos (solo el plan: el renderizador llena los formularios OFICIALES) ----------
export function planDocumentos(dec, lic, empresa) {
  const E = { ...EMPRESA_BASE, ...(empresa || {}) }, b = dec.bloqueos.length;
  return [
    { archivo: `${lic.id}_Ficha_Tecnica.pdf`, tipo: "Ficha técnica con fuente y foto del producto", estado: b ? "FALTA_EVIDENCIA" : "LISTO_BORRADOR" },
    { archivo: `${lic.id}_Oferta_Economica.pdf`, tipo: "Oferta económica (formulario de la licitación)", estado: b ? "FALTA_EVIDENCIA" : "REQUIERE_APROBACION" },
    { archivo: `${lic.id}_Oferta_Economica.xlsx`, tipo: "Oferta económica editable", estado: b ? "FALTA_EVIDENCIA" : "LISTO_BORRADOR" },
    { archivo: `${lic.id}_Identificacion_Oferente.pdf`, tipo: "Identificación del oferente", estado: E.facultades_ok ? "LISTO_BORRADOR" : "FALTA_EVIDENCIA", motivo: E.facultades_ok ? null : "acreditar facultades del representante" },
    { archivo: `${lic.id}_Anexos_Datos.pdf`, tipo: "Mapa campo oficial → dato validado para los anexos originales", estado: "REQUIERE_APROBACION", motivo: "validar cada declaración contra el formato oficial" },
    { archivo: `${lic.id}_Pacto_Integridad.pdf`, tipo: "Pacto de integridad", estado: "REQUIERE_APROBACION", motivo: "revisión y firma autorizada del representante" },
    { archivo: `${lic.id}_Informe_Interno.pdf`, tipo: "Costo, utilidad, caja y riesgos (NO se adjunta a la oferta)", estado: "LISTO_BORRADOR" },
  ];
}
export const puedePreparar = (dec, aprob) => dec.bloqueos.length === 0 && dec.pendientes.length === 0 && !!aprob;
export const puedePresentar = (dec, aprob) => puedePreparar(dec, aprob) && aprob?.consentimiento_portal === true;

function sumarDias(iso, n) { const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
export { sumarDias };
