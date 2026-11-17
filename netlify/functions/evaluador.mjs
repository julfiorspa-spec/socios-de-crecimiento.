// 🚦 EVALUADOR DE ÓRDENES DE COMPRA · al abrir una OC su evaluación ya está calculada.
// Puro: recibe el trabajo (OC + oferta + requerimiento + costos) y los parámetros de la empresa; devuelve estado, números, motivos, pendientes y caja por fecha.
// Trabaja en CLP netos para el margen; conserva los importes con IVA para la caja. Los % iniciales (ejecución 10, factoring 3, PPM 3) son supuestos etiquetados.

export const PARAMS_BASE = { ejecucion_pct: 10, factoring_pct: 3, ppm_pct: 3, fuego_min: 1000000, fuego_pct: 15, meta: 500000, cobro_dias: 30, factoring_dias_habiles: 2, factoring_tasa_mensual: 0, factoring_dias: 30, factoring_cargo_fijo: 0, ejecucion_hist_pct: 0 };
const R0 = (v) => Math.round(Number(v) || 0);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const lidDe = (it, k) => it?.lid || "L" + (k + 1);
const clp = (v) => "$" + R0(v).toLocaleString("es-CL");

// 🔎 líneas de la OC con su costo según la MEJOR fuente disponible, en este orden:
//   1 escenario activo (Excel en vivo) · 2 factura de compra SII vinculada a esta OC · 3 asignación confirmada (Ejecución real) · 4 costo confirmado (Proveedores)
//   5 compra anterior del mismo producto (OC cerrada o factura SII) · 6 fuente publicada con fecha · 7 estimación del robot
//   Cada costo guarda fuente, fecha, vigencia, IVA informado, stock, plazo y cumplimiento. Un precio vencido baja a "referencia".
export const VIGENCIA = { confirmado: 90, historico: 120, publicado: 30, estimacion: 30 };
const diasDesde = (iso, hoy) => { if (!iso) return null; const a = new Date(String(iso).slice(0, 10) + "T12:00:00"), b = new Date((hoy || new Date().toISOString().slice(0, 10)) + "T12:00:00"); return isNaN(a) ? null : Math.round((b - a) / 86400000); };
const tokens = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 2 && !["para","con","del","los","las","por","una","uno","segun","según","unidad","pack","global"].includes(w)));
export const parecido = (a, b) => { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };
const normFecha = (f) => { const m = String(f || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(f || "").slice(0, 10); };

export function lineasEval(t, params, ctx, hoy) {
  const oc = t.oc_compra || {}; const op = t.op || {}; const esc = (op.escenarios || []).find((e) => e.activo) || null; const C = ctx || {};
  const ocItems = (oc.items || []).length ? oc.items : (t.items || []).map((i) => ({ nombre: i.nombre || i.d, especificacion: i.descripcion || i.especificacion, cantidad: i.cantidad ?? i.q, precio: i.precio_unit ?? i.p, total: i.total }));
  // facturas SII de compra vinculadas a ESTA OC: el costo real; se reparte entre líneas en proporción a la venta
  const codOC = op.oc_codigo || oc.codigo || null; const siiOC = (C.sii || []).filter((f) => codOC && f.compra && String(f.compra).toUpperCase() === String(codOC).toUpperCase());
  const siiNeto = siiOC.reduce((s2, f) => s2 + R0(f.neto), 0); const ventaT = ocItems.reduce((s2, x) => s2 + (R0(x.total) || R0((Number(x.precio) || 0) * (Number(x.cantidad) || 1))), 0) || 1;
  const asigs = (op.asignaciones || []).filter((a) => a.estado === "confirmada");
  return ocItems.map((x, k) => {
    const lid = lidDe(x, k); const q = Number(x.cantidad) || 1; const pUnit = Number(x.precio) || (Number(x.total) || 0) / q; const ventaNeta = R0(x.total) || R0(pUnit * q); const nombre = String(x.nombre || x.especificacion || "línea " + (k + 1)).slice(0, 120);
    const it = (t.items || [])[k] || {}; const conf = op.costos_confirmados?.[lid] || null; const base = it.costo_base || null; const el = esc?.lineas?.find((l) => l.lid === lid) || null;
    let costoUnit = null, costoTotalFijo = null, tipo = null, fuente = null, fecha = null, stock = null, plazo = null, respaldo = null, proveedor = null, ivaInforma = "neto", cumple = null, despacho = null;
    const asig = asigs.find((a) => (a.lineas || []).some((l) => l.lid === lid));
    if (el && (el.costo_unit != null || el.costo_total != null)) { const cu = el.costo_unit != null ? Number(el.costo_unit) : Number(el.costo_total) / q; costoUnit = R0(el.iva_incl ? cu / 1.19 : cu); if (el.costo_total != null) costoTotalFijo = R0(el.iva_incl ? el.costo_total / 1.19 : el.costo_total); tipo = el.tipo || "estimacion"; fuente = el.fuente || "Excel en vivo · " + (esc.nombre || ""); fecha = esc.t; stock = el.stock ?? null; plazo = el.plazo ?? null; respaldo = el.respaldo || null; proveedor = el.proveedor || null; ivaInforma = el.iva_incl ? "incluido" : "neto"; despacho = el.despacho != null ? R0(el.despacho) : null; }
    else if (siiNeto > 0) { costoTotalFijo = R0(siiNeto * ventaNeta / ventaT); costoUnit = R0(costoTotalFijo / q); tipo = "confirmado"; fuente = `factura(s) SII ${siiOC.map((f) => f.nombre + " N°" + f.folio).join(", ").slice(0, 90)} · vinculadas a esta OC`; fecha = normFecha(siiOC[0].fecha); proveedor = siiOC[0].nombre; stock = "comprado"; }
    else if (asig && (asig.precio_unit_neto || asig.total_neto)) { const ql = asig.lineas.find((l) => l.lid === lid)?.cantidad || q; costoUnit = asig.precio_unit_neto != null ? R0(asig.precio_unit_neto) : R0(asig.total_neto / asig.lineas.reduce((s2, l) => s2 + l.cantidad, 0)); if (ql < q) { const otras = asigs.filter((a) => a !== asig && (a.lineas || []).some((l) => l.lid === lid)); const qOtras = otras.reduce((s2, a) => s2 + (a.lineas.find((l) => l.lid === lid)?.cantidad || 0), 0); costoTotalFijo = R0(costoUnit * ql + otras.reduce((s2, a) => s2 + R0((a.precio_unit_neto ?? (a.total_neto / a.lineas.reduce((s3, l) => s3 + l.cantidad, 0))) * (a.lineas.find((l) => l.lid === lid)?.cantidad || 0)), 0)); stock = ql + qOtras >= q ? "sí (" + (ql + qOtras) + " asignadas)" : "parcial: " + (ql + qOtras) + " de " + q; } else stock = "sí"; tipo = "confirmado"; fuente = `asignación confirmada · ${asig.proveedor}${asig.t_confirmada ? " · " + String(asig.t_confirmada).slice(0, 10) : ""}`; fecha = asig.t_confirmada || asig.fecha; proveedor = asig.proveedor; respaldo = asig.url || null; plazo = asig.plazo || null; }
    else if (conf && conf.neto_unit) { costoUnit = R0(conf.neto_unit); tipo = "confirmado"; fuente = `${conf.proveedor || "proveedor"} · confirmado ${String(conf.t || "").slice(0, 10)}`; fecha = conf.t; stock = conf.stock || null; plazo = conf.plazo || null; respaldo = conf.url || null; proveedor = conf.proveedor || null; }
    else {
      // compra anterior del mismo producto (OC cerrada o detalle de factura SII)
      const h = (C.hist_lineas || []).map((hl) => ({ hl, p: parecido(hl.nombre, nombre) })).filter((z) => z.p >= 0.6).sort((a, b) => b.p - a.p || String(b.hl.fecha || "").localeCompare(String(a.hl.fecha || "")))[0];
      if (h) { costoUnit = R0(h.hl.neto_unit); tipo = "historico"; fuente = `compra anterior · ${h.hl.proveedor || "proveedor"} · ${h.hl.origen}${h.hl.fecha ? " · " + String(h.hl.fecha).slice(0, 10) : ""}`; fecha = h.hl.fecha; proveedor = h.hl.proveedor || null; respaldo = h.hl.respaldo || null; }
      else if (base && base.neto_unit) { costoUnit = R0(base.neto_unit); const f = (it.fuentes || [])[base.fuente_idx ?? 0]; tipo = base.metodo === "proveedor_seleccionado" && f?.url ? "publicado" : "estimacion"; fuente = (base.metodo === "proveedor_seleccionado" ? "precio publicado" : "estimación del robot") + (f?.proveedor ? " · " + f.proveedor : "") + (base.t ? " · " + String(base.t).slice(0, 10) : ""); fecha = base.t; proveedor = f?.proveedor || null; respaldo = f?.url || null; }
    }
    const dias = diasDesde(fecha, hoy); const vig = tipo ? VIGENCIA[tipo] ?? 30 : null; const vencido = dias != null && vig != null && dias > vig;
    const stockOk = stock == null ? null : /^(si|sí|ok|hay|disponible|comprado|\d+)/i.test(String(stock)) && !/parcial/i.test(String(stock)) && !(Number(stock) && Number(stock) < q);
    return { lid, nombre, especificacion: String(x.especificacion || "").slice(0, 200), q, pUnit: R0(pUnit), ventaNeta, costoUnit, costoTotal: costoTotalFijo != null ? costoTotalFijo : costoUnit == null ? null : R0(costoUnit * q), tipo: vencido && tipo !== "confirmado" ? "referencia" : tipo, tipoOriginal: tipo, fuente, fecha: fecha ? String(fecha).slice(0, 10) : null, dias, vencido, proveedor, stock, stockOk, plazo, respaldo, ivaInforma, cumple, despacho };
  });
}

// discrepancias OC vs requerimiento vs oferta, línea por línea, con los dos valores y su fuente
export function discrepancias(t, L) {
  const D = []; const req = t.req_analisis || t.req?.analisis || null; const m = t.op?.oc_match;
  if (req?.partidas?.length) for (const l of L) { const p = req.partidas.find((x) => { const a = norm(x.nombre || x.d || x.texto), b = norm(l.nombre); return a && b && (a === b || a.includes(b.slice(0, 20)) || b.includes(a.slice(0, 20))); });
    const qr = p ? Number(p.cantidad ?? p.q) : null; if (p && qr && qr !== l.q) D.push({ lid: l.lid, campo: "cantidad", oc: l.q, otro: qr, fuente_otro: "requerimiento" + (p.fuente?.archivo ? " · " + p.fuente.archivo : " (TTR)"), txt: `${l.nombre.slice(0, 40)}: OC ${l.q} vs requerimiento ${qr}` }); }
  for (const mo of m?.motivos || []) if (/cantidad|precio|despacho|total/.test(mo)) D.push({ campo: "oferta", txt: mo, fuente_otro: "oferta enviada" + (m.comparado ? " · " + m.comparado : "") });
  return D;
}

export function evaluarOC(t, paramsIn, hoy, ctx) {
  const P = { ...PARAMS_BASE, ...(paramsIn || {}) }; const op = t.op || {}; const oc = t.oc_compra || {}; const esc = (op.escenarios || []).find((e) => e.activo) || null; const sup = { ...(esc?.supuestos || {}) }; const C = ctx || {};
  const L = lineasEval(t, P, C, hoy); const ventaNeta = R0(oc.neto) || L.reduce((s, l) => s + l.ventaNeta, 0) || R0((oc.total || t.total || 0) / 1.19); const ventaTotal = R0(oc.total) || R0(t.total) || R0(ventaNeta * 1.19);
  const faltan = [], motivos = [], pend = [];
  // costo directo: compra + flete + descarga/armado/accesorios/otros
  const sinCosto = L.filter((l) => l.costoTotal == null); const compra = L.reduce((s, l) => s + (l.costoTotal || 0), 0);
  const asigFlete = (op.asignaciones || []).filter((a) => a.estado === "confirmada").reduce((s, a) => s + R0(a.flete), 0);
  const destino = String(oc.direccion || op.informe?.direccion || ""); const fleteHist = (() => { const d = norm(destino); if (!d) return null; const cand = (C.hist_flete || []).map((h) => ({ h, p: parecido(h.destino, destino) })).filter((z) => z.p >= 0.5).sort((a, b) => b.p - a.p)[0]; return cand ? { monto: R0(cand.h.monto), ref: cand.h.codigo, destino: cand.h.destino } : null; })();
  let fleteFuente = null;
  const flete = sup.flete != null ? (fleteFuente = "Excel en vivo", R0(sup.flete)) : L.some((l) => l.despacho != null) ? (fleteFuente = "despacho por línea", L.reduce((s, l) => s + (l.despacho || 0), 0)) : asigFlete ? (fleteFuente = "asignaciones confirmadas", asigFlete) : op.costo_transporte != null && op.costo_transporte > 0 ? (fleteFuente = "Despacho (costo real)", R0(op.costo_transporte)) : fleteHist ? (fleteFuente = `estimado por despacho anterior a ${fleteHist.destino.slice(0, 30)} (OC ${fleteHist.ref})`, fleteHist.monto) : null;
  const otros = R0(sup.otros_directos); const costoDirecto = compra + (flete || 0) + otros;
  if (sinCosto.length) faltan.push(`precio de ${sinCosto.length === L.length ? "todas las líneas" : sinCosto.map((l) => `«${l.nombre.slice(0, 30)}»`).join(", ")} (sin cotización, compra anterior ni asignación)`);
  if (flete == null) faltan.push("flete a " + (destino || "destino sin registrar").slice(0, 40) + " (sin despacho anterior a ese destino)");
  const vencidas = L.filter((l) => l.vencido); if (vencidas.length) pend.push({ tipo: "vigencia", txt: `precio de ${vencidas.map((l) => `«${l.nombre.slice(0, 25)}» (hace ${l.dias} días)`).join(", ")}: reconfirmar` });
  if (!t.req_analisis && !(t.lic_docs || []).length) faltan.push("TTR / anexos del requerimiento (no capturados: adjúntalos en esta OC)");
  // ejecución / factoring / PPM: reales si están, si no supuestos etiquetados
  const ejecucion = sup.ejecucion != null ? R0(sup.ejecucion) : P.ejecucion_hist_pct > 0 ? R0(ventaNeta * P.ejecucion_hist_pct / 100) : R0(ventaNeta * P.ejecucion_pct / 100), ejecSup = sup.ejecucion == null;
  const ejecFuente = sup.ejecucion != null ? "real (Excel en vivo)" : P.ejecucion_hist_pct > 0 ? `promedio histórico ${P.ejecucion_hist_pct} %` : `supuesto ${P.ejecucion_pct} %`;
  // factoring: costo real por monto financiado, tasa mensual y cargos fijos (tarifa de la empresa) · si no hay tarifa, el % supuesto
  const tarifa = P.factoring_tasa_mensual > 0 ? { tasa: P.factoring_tasa_mensual, dias: P.factoring_dias || 30, fijo: R0(P.factoring_cargo_fijo) } : null;
  const factoring = sup.factoring != null ? R0(sup.factoring) : op.factoring?.costo ? R0(op.factoring.costo) : tarifa ? R0(ventaTotal * tarifa.tasa / 100 * tarifa.dias / 30 + tarifa.fijo) : R0(ventaNeta * P.factoring_pct / 100);
  const factSup = sup.factoring == null && !op.factoring?.costo && !tarifa; const factFuente = sup.factoring != null ? "Excel en vivo" : op.factoring?.costo ? "registrado en Facturas y reparto" : tarifa ? `tarifa ${tarifa.tasa} % mensual · ${tarifa.dias} días${tarifa.fijo ? " + " + clp(tarifa.fijo) : ""}` : `supuesto ${P.factoring_pct} %`;
  // el PPM supuesto cierra el redondeo: los tres % se redondean una sola vez sobre la venta neta (ej. 16 % de 1.908.520 = 305.363)
  const ppm = sup.ppm != null ? R0(sup.ppm) : (ejecSup && factSup ? R0(ventaNeta * (P.ejecucion_pct + P.factoring_pct + P.ppm_pct) / 100) - ejecucion - factoring : R0(ventaNeta * P.ppm_pct / 100));
  const margenOperativo = ventaNeta - costoDirecto - ejecucion - factoring, saldo = margenOperativo - ppm, margenPct = ventaNeta ? saldo / ventaNeta : 0;
  const maxCostoDirecto = ventaNeta - ejecucion - factoring - ppm, maxCostoMeta = maxCostoDirecto - P.meta;
  // técnico, stock, plazo
  const D = discrepancias(t, L); for (const d of D) pend.push({ tipo: "discrepancia", txt: d.txt, fuente: d.fuente_otro });
  const sinStock = L.filter((l) => l.costoTotal != null && l.stockOk !== true); if (sinStock.length) pend.push({ tipo: "stock", txt: `stock para la cantidad completa: ${sinStock.map((l) => l.nombre.slice(0, 25) + " (" + l.q + ")").join(", ")}` });
  const reqOk = t.req_check ? Object.values(t.req_check).every(Boolean) : null; const critFaltan = (t.req_analisis?.exigencias || t.req?.analisis?.exigencias || []).filter((e) => e.critica && t.req_check && t.req_check[e.id] === false);
  if (critFaltan.length) motivos.push({ tipo: "tecnico", txt: "incumplimiento técnico confirmado: " + critFaltan.map((e) => e.texto.slice(0, 60)).join("; "), evidencia: "requerimiento (Firmar)" });
  const entrega = op.plazo_fecha || oc.fecha_entrega || (oc.plazo_dias && oc.fecha ? sumarDias(oc.fecha, Number(oc.plazo_dias)) : null);
  if (!entrega) pend.push({ tipo: "plazo", txt: "fecha de entrega no registrada" }); else if (hoy && entrega < hoy && !op.entregado && !op.despacho?.entregado) motivos.push({ tipo: "plazo", txt: `plazo vencido el ${entrega} sin entrega registrada`, evidencia: "OC / Ejecuta" });
  const financiamiento = sup.caja_resuelta === true ? true : sup.caja_resuelta === false ? false : null; if (financiamiento === false) pend.push({ tipo: "caja", txt: "financiamiento por confirmar (inversionista / factoring)" });
  if (sup.incumplimiento) motivos.push({ tipo: "tecnico", txt: "incumplimiento confirmado: " + String(sup.incumplimiento).slice(0, 120), evidencia: "decisión manual" });
  // decisión
  const costoParcialSupera = sinCosto.length && costoDirecto >= maxCostoDirecto;   // lo que falta solo puede subirlo
  let estado, motivo;
  if (motivos.some((m) => m.tipo === "tecnico" || m.tipo === "plazo")) { estado = "ROJO"; motivo = motivos[0].txt; }
  else if (!sinCosto.length && flete != null && saldo <= 0) { estado = "ROJO"; motivo = `quedas abajo por ${clp(-saldo)}`; }
  else if (costoParcialSupera) { estado = "ROJO"; motivo = `el costo parcial ${clp(costoDirecto)} ya supera el equilibrio ${clp(maxCostoDirecto)}; lo que falta solo puede subirlo`; }
  else if (faltan.length || pend.length || financiamiento === null) { estado = "PENDIENTE"; motivo = faltan[0] ? "falta " + faltan[0] : pend[0]?.txt || "falta confirmar financiamiento"; }
  else if (saldo >= P.fuego_min && margenPct >= P.fuego_pct / 100) { estado = "FUEGO"; motivo = `deja ${clp(saldo)} (${(margenPct * 100).toFixed(1)} %) con costos y plazo resueltos`; }
  else { estado = "VERDE"; motivo = `deja ${clp(saldo)} (${(margenPct * 100).toFixed(1)} %), bajo el umbral de Fuego`; }
  // mayor costo
  const mayor = L.filter((l) => l.costoTotal != null).sort((a, b) => b.costoTotal - a.costoTotal)[0] || null;
  const escenarioRef = sinCosto.length ? null : { saldo, texto: saldo <= 0 ? `escenario a precios de referencia: no da (${clp(saldo)})` : `escenario a precios de referencia: ${clp(saldo)}` };
  // lenguaje directo si Rojo
  const rojoTxt = estado === "ROJO" && saldo <= 0 ? `Quedas abajo por ${clp(-saldo)}. El mayor costo viene de ${mayor ? "«" + mayor.nombre.slice(0, 40) + "» (" + clp(mayor.costoTotal) + ")" : "la compra"}. Para quedar tablas, compra y entrega por hasta ${clp(maxCostoDirecto)}. Para dejar ${clp(P.meta)}, el costo máximo es ${clp(maxCostoMeta)}. La acción siguiente es ${op.oc_aceptada || /aceptada/i.test(op.oc_estado || "") ? "renegociar con el proveedor o gestionar la OC" : "confirmar costos antes de aceptar"}.` : null;
  const caja = cajaPorFecha({ L, ventaTotal, ventaNeta, costoDirecto, compra, flete: flete || 0, otros, ejecucion, factoring, ppm, entrega, hoy, P, sup, esc });
  const evidencia = (m) => m.evidencia || "";
  return { v: 1, t: new Date().toISOString(), estado, motivo, rojoTxt, ventaNeta, ventaTotal, iva: ventaTotal - ventaNeta, compra, flete, fleteFuente, otros, costoDirecto, ejecucion, ejecSup, ejecFuente, factoring, factSup, factFuente, ppm, costoConfirmado: L.filter((l) => l.tipo === "confirmado").reduce((s, l) => s + (l.costoTotal || 0), 0), costoProyectado: L.filter((l) => l.costoTotal != null && l.tipo !== "confirmado").reduce((s, l) => s + l.costoTotal, 0), margenOperativo, saldo, margenPct: Math.round(margenPct * 1000) / 10, maxCostoDirecto, maxCostoMeta, meta: P.meta, umbral: { fuego_min: P.fuego_min, fuego_pct: P.fuego_pct }, supuestos: { ejecucion_pct: P.ejecucion_pct, factoring_pct: P.factoring_pct, ppm_pct: P.ppm_pct }, lineas: L, discrepancias: D, faltan, pendientes: pend, motivos: motivos.slice(0, 3).map((m) => ({ txt: m.txt, evidencia: evidencia(m) })), escenarioRef, entrega, cajaNecesaria: caja.necesaria, caja: caja.eventos, recupera: caja.recupera, escenario: esc ? { id: esc.id, nombre: esc.nombre, t: esc.t } : null, mayorCosto: mayor ? { lid: mayor.lid, nombre: mayor.nombre, monto: mayor.costoTotal } : null };
}

function sumarDias(iso, n) { const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); if (isNaN(d)) return null; d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function habiles(iso, n) { const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); let c = 0; while (c < n) { d.setDate(d.getDate() + 1); if (d.getDay() && d.getDay() !== 6) c++; } return d.toISOString().slice(0, 10); }

// 📅 caja por fecha: cuánta plata hay que poner, cuándo, y cuándo se recupera. IVA no es margen; PPM es reserva.
export function cajaPorFecha({ L, ventaTotal, ventaNeta, compra, flete, otros, ejecucion, factoring, ppm, entrega, hoy, P, sup, esc }) {
  const h = hoy || new Date().toISOString().slice(0, 10); const ev = []; const add = (fecha, concepto, monto, tipo) => ev.push({ fecha: fecha || h, concepto, monto: R0(monto), tipo });
  const fCompra = sup.fecha_compra || h; const fEntrega = entrega || sumarDias(h, 10);
  if (compra) add(fCompra, "pago a proveedores (con IVA)", -R0(compra * 1.19), "proveedor");
  if (flete) add(fEntrega, "despacho / flete", -flete, "despacho");
  if (otros) add(fCompra, "otros costos directos", -otros, "otros");
  if (ejecucion) add(fEntrega, "ejecución" + (sup.ejecucion == null ? " (supuesto)" : ""), -ejecucion, "ejecucion");
  const usaFactoring = sup.factoring !== 0 && (sup.usa_factoring !== false);
  if (usaFactoring) { const fGiro = habiles(fEntrega, P.factoring_dias_habiles); add(fGiro, "giro factoring (anticipo de la factura)", ventaTotal - factoring, "cobro"); }
  else add(sumarDias(fEntrega, P.cobro_dias), "pago del cliente (Mercado Público a " + P.cobro_dias + " días)", ventaTotal, "cobro");
  const mesSig = (iso) => { const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); return new Date(d.getFullYear(), d.getMonth() + 1, 12).toISOString().slice(0, 10); };
  add(mesSig(fEntrega), "IVA débito − crédito (F29)", -((ventaTotal - ventaNeta) - R0(compra * 0.19)), "iva");
  if (ppm) add(mesSig(fEntrega), "reserva PPM", -ppm, "ppm");
  ev.sort((a, b) => a.fecha.localeCompare(b.fecha)); let acum = 0, minimo = 0, recupera = null; for (const e of ev) { acum += e.monto; e.acumulado = acum; if (acum < minimo) minimo = acum; if (recupera == null && e.tipo === "cobro" && acum >= 0) recupera = e.fecha; }
  return { eventos: ev, necesaria: -minimo, recupera };
}

// 📦 consolidado de un paquete de OC: venta, costo y caja; separa confirmado de proyectado
export function consolidar(evals) {
  const T = { n: evals.length, ventaTotal: 0, ventaNeta: 0, costoDirecto: 0, costoConfirmado: 0, costoProyectado: 0, saldo: 0, cajaNecesaria: 0, pendientes: [], estados: {} };
  for (const e of evals) { T.ventaTotal += e.ventaTotal; T.ventaNeta += e.ventaNeta; T.costoDirecto += e.costoDirecto; T.saldo += e.saldo; T.cajaNecesaria += e.cajaNecesaria; T.estados[e.estado] = (T.estados[e.estado] || 0) + 1;
    for (const l of e.lineas) { if (l.costoTotal == null) continue; if (l.tipo === "confirmado") T.costoConfirmado += l.costoTotal; else T.costoProyectado += l.costoTotal; }
    for (const p of [...e.faltan.map((x) => ({ txt: "falta " + x })), ...e.pendientes]) T.pendientes.push({ codigo: e.codigo, txt: p.txt }); }
  return T;
}
