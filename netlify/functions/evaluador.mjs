// 🚦 EVALUADOR DE ÓRDENES DE COMPRA · al abrir una OC su evaluación ya está calculada.
// Puro: recibe el trabajo (OC + oferta + requerimiento + costos) y los parámetros de la empresa; devuelve estado, números, motivos, pendientes y caja por fecha.
// Trabaja en CLP netos para el margen; conserva los importes con IVA para la caja. Los % iniciales (ejecución 10, factoring 3, PPM 3) son supuestos etiquetados.

export const PARAMS_BASE = { ejecucion_pct: 10, factoring_pct: 3, ppm_pct: 3, fuego_min: 1000000, fuego_pct: 15, meta: 500000, cobro_dias: 30, factoring_dias_habiles: 2 };
const R0 = (v) => Math.round(Number(v) || 0);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const lidDe = (it, k) => it?.lid || "L" + (k + 1);
const clp = (v) => "$" + R0(v).toLocaleString("es-CL");

// líneas de la OC con su costo según la mejor fuente disponible (escenario activo > confirmado > referencia/estimación)
export function lineasEval(t, params) {
  const oc = t.oc_compra || {}; const op = t.op || {}; const esc = (op.escenarios || []).find((e) => e.activo) || null;
  const ocItems = (oc.items || []).length ? oc.items : (t.items || []).map((i) => ({ nombre: i.nombre || i.d, especificacion: i.descripcion || i.especificacion, cantidad: i.cantidad ?? i.q, precio: i.precio_unit ?? i.p, total: i.total }));
  return ocItems.map((x, k) => {
    const lid = lidDe(x, k); const q = Number(x.cantidad) || 1; const pUnit = Number(x.precio) || (Number(x.total) || 0) / q; const ventaNeta = R0(x.total) || R0(pUnit * q);
    const it = (t.items || [])[k] || {}; const conf = op.costos_confirmados?.[lid] || null; const base = it.costo_base || null; const el = esc?.lineas?.find((l) => l.lid === lid) || null;
    let costoUnit = null, tipo = null, fuente = null, stock = null, plazo = null, respaldo = null, proveedor = null, ivaInforma = null;
    let costoTotalFijo = null;
    if (el && (el.costo_unit != null || el.costo_total != null)) { const cu = el.costo_unit != null ? Number(el.costo_unit) : Number(el.costo_total) / q; costoUnit = R0(el.iva_incl ? cu / 1.19 : cu); if (el.costo_total != null) costoTotalFijo = R0(el.iva_incl ? el.costo_total / 1.19 : el.costo_total); tipo = el.tipo || "escenario"; fuente = el.fuente || "escenario " + (esc.nombre || ""); stock = el.stock ?? null; plazo = el.plazo ?? null; respaldo = el.respaldo || null; proveedor = el.proveedor || null; ivaInforma = el.iva_incl ? "incluido" : "neto"; }
    else if (conf && conf.neto_unit) { costoUnit = R0(conf.neto_unit); tipo = "confirmado"; fuente = `${conf.proveedor || "proveedor"} · confirmado ${String(conf.t || "").slice(0, 10)}`; stock = conf.stock || null; plazo = conf.plazo || null; respaldo = conf.url || null; proveedor = conf.proveedor || null; }
    else if (base && base.neto_unit) { costoUnit = R0(base.neto_unit); tipo = base.metodo === "proveedor_seleccionado" ? "publicado" : "estimacion"; fuente = (base.metodo || "referencia") + (base.t ? " · " + String(base.t).slice(0, 10) : ""); const f = (it.fuentes || [])[base.fuente_idx ?? 0]; proveedor = f?.proveedor || null; respaldo = f?.url || null; }
    const stockOk = stock == null ? null : /^(si|sí|ok|hay|disponible|\d+)/i.test(String(stock)) && !(Number(stock) && Number(stock) < q);
    return { lid, nombre: String(x.nombre || x.especificacion || "línea " + (k + 1)).slice(0, 120), especificacion: String(x.especificacion || "").slice(0, 200), q, pUnit: R0(pUnit), ventaNeta, costoUnit, costoTotal: costoTotalFijo != null ? costoTotalFijo : costoUnit == null ? null : R0(costoUnit * q), tipo, fuente, proveedor, stock, stockOk, plazo, respaldo, ivaInforma, despacho: el?.despacho != null ? R0(el.despacho) : null };
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

export function evaluarOC(t, paramsIn, hoy) {
  const P = { ...PARAMS_BASE, ...(paramsIn || {}) }; const op = t.op || {}; const oc = t.oc_compra || {}; const esc = (op.escenarios || []).find((e) => e.activo) || null; const sup = { ...(esc?.supuestos || {}) };
  const L = lineasEval(t, P); const ventaNeta = R0(oc.neto) || L.reduce((s, l) => s + l.ventaNeta, 0) || R0((oc.total || t.total || 0) / 1.19); const ventaTotal = R0(oc.total) || R0(t.total) || R0(ventaNeta * 1.19);
  const faltan = [], motivos = [], pend = [];
  // costo directo: compra + flete + descarga/armado/accesorios/otros
  const sinCosto = L.filter((l) => l.costoTotal == null); const compra = L.reduce((s, l) => s + (l.costoTotal || 0), 0);
  const flete = sup.flete != null ? R0(sup.flete) : L.some((l) => l.despacho != null) ? L.reduce((s, l) => s + (l.despacho || 0), 0) : op.costo_transporte != null ? R0(op.costo_transporte) : null;
  const otros = R0(sup.otros_directos); const costoDirecto = compra + (flete || 0) + otros;
  if (sinCosto.length) faltan.push(`costo de ${sinCosto.length === L.length ? "todas las líneas" : sinCosto.map((l) => `«${l.nombre.slice(0, 30)}»`).join(", ")}`);
  if (flete == null) faltan.push("flete a " + (oc.direccion || "destino").slice(0, 40));
  // ejecución / factoring / PPM: reales si están, si no supuestos etiquetados
  const ejecucion = sup.ejecucion != null ? R0(sup.ejecucion) : R0(ventaNeta * P.ejecucion_pct / 100), ejecSup = sup.ejecucion == null;
  const factoring = sup.factoring != null ? R0(sup.factoring) : R0(ventaNeta * P.factoring_pct / 100), factSup = sup.factoring == null;
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
  return { v: 1, t: new Date().toISOString(), estado, motivo, rojoTxt, ventaNeta, ventaTotal, iva: ventaTotal - ventaNeta, compra, flete, otros, costoDirecto, ejecucion, ejecSup, factoring, factSup, ppm, margenOperativo, saldo, margenPct: Math.round(margenPct * 1000) / 10, maxCostoDirecto, maxCostoMeta, meta: P.meta, umbral: { fuego_min: P.fuego_min, fuego_pct: P.fuego_pct }, supuestos: { ejecucion_pct: P.ejecucion_pct, factoring_pct: P.factoring_pct, ppm_pct: P.ppm_pct }, lineas: L, discrepancias: D, faltan, pendientes: pend, motivos: motivos.slice(0, 3).map((m) => ({ txt: m.txt, evidencia: evidencia(m) })), escenarioRef, entrega, cajaNecesaria: caja.necesaria, caja: caja.eventos, recupera: caja.recupera, escenario: esc ? { id: esc.id, nombre: esc.nombre, t: esc.t } : null, mayorCosto: mayor ? { lid: mayor.lid, nombre: mayor.nombre, monto: mayor.costoTotal } : null };
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
