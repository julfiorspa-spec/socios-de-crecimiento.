// 🧮 licalc · simulador de oferta para licitaciones (presupuesto bruto, barra de descuento, utilidad en vivo, escenarios,
// versión aprobada inmutable y evaluación del paquete). Aritmética entera en BigInt: lo que ve el usuario es exactamente lo que
// va al Excel, al PDF y al portal. Base: módulo licitador.mjs del paquete «Cotizagil_Para_Claude» (4 pruebas) + integración.
import { createHash } from "node:crypto";
import { xlsx } from "./xlsxmin.mjs";

export function simularOferta({
  presupuestoBruto, descuentoBps, ivaBps = 1900, factoringBps = 300,
  ppmBps = 300, logisticaNeta, costoGarantiaNeto = 0,
  topeBrutoObligatorio = null, lineas,
}) {
  const escala = 10_000;
  const montos = [presupuestoBruto, logisticaNeta, costoGarantiaNeto];
  if (topeBrutoObligatorio !== null) montos.push(topeBrutoObligatorio);
  const tasas = [descuentoBps, ivaBps, factoringBps, ppmBps];
  if (montos.some((monto) => !Number.isSafeInteger(monto) || monto < 0) ||
      tasas.some((tasa) => !Number.isSafeInteger(tasa) || tasa < 0 || tasa > escala) ||
      presupuestoBruto === 0 ||
      !Array.isArray(lineas) || lineas.length === 0) {
    throw new Error("Revisa el presupuesto, las tasas y los costos.");
  }
  const ids = new Set();
  for (const linea of lineas) {
    if (!linea.id || ids.has(linea.id) ||
        ![linea.cantidad, linea.compraUnitariaBruta, linea.peso].every(
          (valor) => Number.isSafeInteger(valor) && valor > 0
        )) {
      throw new Error("Cada línea requiere un ID único, cantidad, costo y peso positivos.");
    }
    ids.add(linea.id);
  }
  // Pesos enteros de distribución. Con una línea, asigna el presupuesto completo.
  const pesoTotal = lineas.reduce((suma, linea) => suma + BigInt(linea.peso), 0n);
  const base = BigInt(escala);
  const metaBruta = BigInt(presupuestoBruto) * BigInt(escala - descuentoBps) / base;
  const redondear = (numerador, denominador) =>
    (numerador + denominador / 2n) / denominador;
  const ent = (monto) => {
    const numero = Number(monto);
    if (!Number.isSafeInteger(numero)) throw new Error("Monto fuera de rango.");
    return numero;
  };
  let ventaNeta = 0n;
  let compraBruta = 0n;
  const detalle = lineas.map((linea) => {
    const cantidad = BigInt(linea.cantidad);
    const precioUnitarioNeto = metaBruta * base * BigInt(linea.peso) /
      ((base + BigInt(ivaBps)) * pesoTotal * cantidad);
    const subtotalNeto = precioUnitarioNeto * cantidad;
    ventaNeta += subtotalNeto;
    compraBruta += BigInt(linea.compraUnitariaBruta) * cantidad;
    return { id: linea.id, cantidad: linea.cantidad,
      precioUnitarioNeto: ent(precioUnitarioNeto), subtotalNeto: ent(subtotalNeto) };
  });
  const iva = redondear(ventaNeta * BigInt(ivaBps), base);
  const ventaBruta = ventaNeta + iva;
  const compraNeta = redondear(compraBruta * base, base + BigInt(ivaBps));
  const factoring = redondear(ventaNeta * BigInt(factoringBps), base);
  const reservaPpm = redondear(ventaNeta * BigInt(ppmBps), base);
  const utilidad = ventaNeta - compraNeta - factoring -
    BigInt(logisticaNeta) - BigInt(costoGarantiaNeto);
  return {
    detalle, ventaNeta: ent(ventaNeta), iva: ent(iva), ventaBruta: ent(ventaBruta),
    compraNeta: ent(compraNeta), compraBruta: ent(compraBruta),
    factoring: ent(factoring), utilidad: ent(utilidad), reservaPpm: ent(reservaPpm),
    resultadoTrasPpm: ent(utilidad - reservaPpm),
    margen: ventaNeta ? ent(utilidad) / ent(ventaNeta) : null,
    superaTope: topeBrutoObligatorio !== null && ventaBruta > BigInt(topeBrutoObligatorio),
    tienePrecioEnTodasLasLineas: detalle.every((linea) => linea.precioUnitarioNeto > 0),
  };
}

// El servidor arma este estado con su manifiesto oficial, costos y firmas verificadas.
export function evaluarOferta(oferta) {
  const pendientes = [];
  const firmasPendientes = [];
  if (oferta.lectura !== "validada") {
    pendientes.push(oferta.lectura === "error" ? "Reintentar lectura de bases" : "Validar bases");
  }
  if (!oferta.costosConfirmados) pendientes.push("Confirmar costos y disponibilidad");
  if (!oferta.precio?.tienePrecioEnTodasLasLineas || oferta.precio.superaTope) {
    pendientes.push("Validar precio y tope obligatorio");
  }
  if (!oferta.version || oferta.versionAprobada !== oferta.version) {
    pendientes.push("Aprobar versión actual");
  }
  if (!oferta.manifiestoValidado || !oferta.documentos?.length) {
    pendientes.push("Validar el listado oficial de documentos");
  }
  for (const documento of oferta.documentos ?? []) {
    if (!documento.obligatorio && !documento.incluir) continue;
    if (!documento.archivoVerificado) {
      pendientes.push(`Completar ${documento.nombre}`);
    } else if (documento.requiereFirma) {
      if (!oferta.representanteAcreditado) {
        if (!pendientes.includes("Acreditar firmante")) pendientes.push("Acreditar firmante");
      }
      if (!documento.firmaVerificada || documento.versionFirmada !== oferta.version) {
        firmasPendientes.push(documento.nombre);
      }
    }
  }
  return {
    pendientes, firmasPendientes,
    listoParaFirmar: !pendientes.length && firmasPendientes.length > 0,
    listoParaOfertar: !pendientes.length && !firmasPendientes.length,
  };
}

// ---------- integración con el licitador automático (t.auto) ----------
const R0 = (v) => Math.round(Number(v) || 0);
const bps = (pct) => Math.max(0, Math.min(10000, R0(Number(pct) * 100)));   // 5 (%) → 500 bps

// Entrada del simulador a partir del trabajo (bases leídas + productos elegidos). Nada se inventa: si falta un dato queda en 0 y
// se marca en `faltan`.
export function entradaDesde(t, sobre = {}) {
  const a = t.auto || {}; const L = a.lic || {}; const F = a.decision?.numeros || {}; const sel = a.seleccion || [];
  const faltan = [];
  let presupuestoBruto = R0(sobre.presupuestoBruto);
  if (!presupuestoBruto) { presupuestoBruto = L.presupuesto ? (L.presupuesto_con_iva === false ? R0(L.presupuesto * 1.19) : R0(L.presupuesto)) : 0; if (!presupuestoBruto) faltan.push("presupuesto"); }
  const descuentoBps = sobre.descuentoBps != null ? Math.max(0, Math.min(3000, R0(sobre.descuentoBps))) : bps((a.precios?.descuento ?? 0) * 100);
  const logisticaNeta = sobre.logisticaNeta != null ? R0(sobre.logisticaNeta) : R0((F.flete || 0) + (F.otros || 0));
  const costoGarantiaNeto = sobre.costoGarantiaNeto != null ? R0(sobre.costoGarantiaNeto) : 0;
  const factoringBps = sobre.factoringBps != null ? R0(sobre.factoringBps) : 300, ppmBps = sobre.ppmBps != null ? R0(sobre.ppmBps) : 300;
  const topeBrutoObligatorio = sobre.topeBrutoObligatorio != null ? (R0(sobre.topeBrutoObligatorio) || null) : (L.tope_obligatorio ? R0(L.tope_obligatorio) : null);
  const lineasSel = sel.map((s) => { const it = (L.items || []).find((i) => i.id === s.itemId) || {}; const unit = R0(s.cotizacion?.unitNeto); const q = R0(s.cantidad || it.cantidad); return { id: s.itemId, nombre: it.nombre || s.producto?.nombre || s.itemId, cantidad: q, compraUnitariaBruta: R0(unit * 1.19), peso: Math.max(1, R0(unit * q)), confirmado: s.cotizacion?.evidencia?.estado === "verificado", stockOk: s.cotizacion?.stock === "verificado" }; });
  // líneas: las del usuario (simulador) mandan; si vienen con `base` (costo real al aprobar) solo valen mientras el costo real no cambie
  const lineas = Array.isArray(sobre.lineas) && sobre.lineas.length
    ? (sobre.lineas.every((l) => l.base != null) && lineasSel.length
        ? lineasSel.map((x) => { const o = sobre.lineas.find((l) => l.id === x.id); return o && o.base === x.compraUnitariaBruta && R0(o.cantidad || x.cantidad) === x.cantidad ? { ...x, compraUnitariaBruta: R0(o.compraUnitariaBruta), peso: Math.max(1, R0(o.peso ?? (x.cantidad * R0(o.compraUnitariaBruta)))) } : x; })
        : sobre.lineas.map((l, i) => ({ ...(lineasSel.find((x) => x.id === l.id) || {}), id: String(l.id || "L" + (i + 1)), nombre: l.nombre || lineasSel.find((x) => x.id === l.id)?.nombre || String(l.id), cantidad: R0(l.cantidad), compraUnitariaBruta: R0(l.compraUnitariaBruta), peso: Math.max(1, R0(l.peso ?? (R0(l.cantidad) * R0(l.compraUnitariaBruta)))) })))
    : lineasSel;
  // sin producto con precio real todavía: se puede jugar igual con los ítems de las bases y el costo que escriba el usuario
  const lineasBase = !lineas.length && !(Array.isArray(sobre.lineas) && sobre.lineas.length) ? (L.items || []).map((it) => ({ id: it.id, nombre: it.nombre || it.id, cantidad: R0(it.cantidad) || 1, compraUnitariaBruta: 0, peso: Math.max(1, R0(it.cantidad) || 1), confirmado: false, stockOk: false, sinProducto: true })) : [];
  if (lineasBase.length) lineas.push(...lineasBase);
  if (!lineas.length) faltan.push("ítems de las bases");
  for (const l of lineas) if (!l.compraUnitariaBruta) faltan.push("costo de " + l.nombre);
  return { presupuestoBruto, descuentoBps, ivaBps: 1900, factoringBps, ppmBps, logisticaNeta, costoGarantiaNeto, topeBrutoObligatorio, lineas, faltan };
}
const limpia = (e) => ({ presupuestoBruto: e.presupuestoBruto, descuentoBps: e.descuentoBps, ivaBps: e.ivaBps ?? 1900, factoringBps: e.factoringBps, ppmBps: e.ppmBps, logisticaNeta: e.logisticaNeta, costoGarantiaNeto: e.costoGarantiaNeto || 0, topeBrutoObligatorio: e.topeBrutoObligatorio ?? null, lineas: e.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, compraUnitariaBruta: l.compraUnitariaBruta, peso: l.peso })) });

// Tres escenarios comparables: presupuesto completo, el descuento elegido y el máximo descuento que respeta el piso de margen.
export function escenarios(entrada, pisoMargen = 0.12) {
  const e = limpia(entrada); const sim = (d) => { try { return simularOferta({ ...e, descuentoBps: d }); } catch { return null; } };
  const viable = (p) => p && p.utilidad > 0 && p.margen >= pisoMargen && !p.superaTope;
  let maxBps = null; for (let d = 0; d <= 3000; d += 10) { if (viable(sim(d))) maxBps = d; else if (maxBps != null) break; }
  const lista = [{ k: "completo", nombre: "Presupuesto completo", descuentoBps: 0 }, { k: "elegido", nombre: "Descuento elegido", descuentoBps: e.descuentoBps }, { k: "piso", nombre: "Máximo descuento con margen ≥ " + Math.round(pisoMargen * 100) + " %", descuentoBps: maxBps }];
  return { pisoMargen, hayViable: maxBps != null, escenarios: lista.map((x) => { const p = x.descuentoBps == null ? null : sim(x.descuentoBps); return { ...x, precio: p, viable: viable(p), motivo: p == null ? "no hay precio viable con estos costos" : !viable(p) ? (p.superaTope ? "supera el tope obligatorio" : p.utilidad <= 0 ? "pierde plata" : `margen ${Math.round(p.margen * 1000) / 10} % bajo el piso`) : "" }; }) };
}

// Huella de la versión: cambia si cambia cualquier supuesto, costo o precio.
export function huella(entrada, precio, extra = null) { return createHash("sha256").update(JSON.stringify({ e: limpia(entrada), p: { ventaNeta: precio.ventaNeta, detalle: precio.detalle }, x: extra })).digest("hex").slice(0, 16); }

// Estado del paquete para evaluarOferta a partir del trabajo.
export function estadoOferta(t, emp = {}) {
  const a = t.auto || {}; const L = a.lic || {}; const D = a.decision; const v = a.version_aprobada; const sel = a.seleccion || [];
  const docsL = (L.documentos || []).filter((d) => d.obligatorio || d.firma);
  const archivos = new Set((a.docs?.archivos || []).map((x) => x.nombre));
  const documentos = docsL.map((d) => { const f = (a.firmas || {})[d.nombre]; return { nombre: d.nombre, obligatorio: !!d.obligatorio, incluir: true, requiereFirma: !!d.firma, archivoVerificado: !!(a.documentos_ok?.[d.nombre] || archivos.size), firmaVerificada: !!f, versionFirmada: f?.version || null }; });
  return { lectura: a.error && /leer/.test(a.error) ? "error" : L.bases_leidas ? "validada" : "resumen", costosConfirmados: sel.length > 0 && sel.every((s) => s.cotizacion?.evidencia?.estado === "verificado" && s.cotizacion?.stock === "verificado"),
    precio: v?.precio || null, version: a.version_actual?.hash || null, versionAprobada: v?.hash || null, manifiestoValidado: !!L.bases_leidas && docsL.length > 0, documentos, representanteAcreditado: !!(emp.facultades_ok ?? a.decision?.empresa_ok?.facultades) };
}

// ---------- Excel financiero (interno): valores del escenario + fórmulas para mover supuestos en Excel ----------
export function excelOferta(entrada, precio, meta = {}) {
  const e = entrada; const n = e.lineas.length; const F = [];
  F.push([`Simulador de oferta · ${meta.id || ""}`], [meta.nombre || "", meta.comprador || ""], [`Versión ${meta.version || "borrador"} · ${meta.fecha || ""} · USO INTERNO: no adjuntar a la oferta`], []);
  F.push(["Supuestos (editables)", "Valor"]);                      // fila 5
  F.push(["Presupuesto bruto (con IVA)", e.presupuestoBruto]);     // B6
  F.push(["Descuento %", e.descuentoBps / 100]);                   // B7
  F.push(["IVA %", (e.ivaBps ?? 1900) / 100]);                     // B8
  F.push(["Factoring % de la venta neta", e.factoringBps / 100]);  // B9
  F.push(["Reserva PPM % de la venta neta", e.ppmBps / 100]);      // B10
  F.push(["Logística neta", e.logisticaNeta]);                     // B11
  F.push(["Costo de garantía neto", e.costoGarantiaNeto || 0]);    // B12
  F.push(["Tope bruto obligatorio (0 = no hay)", e.topeBrutoObligatorio || 0]);   // B13
  F.push(["Meta bruta = presupuesto × (1 − descuento)", { f: "ROUNDDOWN(B6*(1-B7/100),0)" }]);   // B14
  F.push(["Meta neta", { f: "ROUNDDOWN(B14/(1+B8/100),0)" }]);        // B15
  F.push([]);
  F.push(["#", "Línea", "Cantidad", "Compra unit. bruta", "Peso", "Precio unit. neto", "Subtotal neto", "Compra bruta"]);   // fila 17
  const r0 = 18; const rN = r0 + n - 1;
  e.lineas.forEach((l, i) => { const r = r0 + i; F.push([i + 1, l.nombre || l.id, l.cantidad, l.compraUnitariaBruta, l.peso, { f: `ROUNDDOWN($B$15*E${r}/SUM($E$${r0}:$E$${rN})/C${r},0)` }, { f: `F${r}*C${r}` }, { f: `D${r}*C${r}` }]); });
  const r = rN + 2;
  F.push([]);
  F.push(["Venta neta", "", "", "", "", "", { f: `SUM(G${r0}:G${rN})` }]);                       // G r
  F.push(["IVA", "", "", "", "", "", { f: `ROUND(G${r}*B8/100,0)` }]);                            // r+1
  F.push(["Venta bruta", "", "", "", "", "", { f: `G${r}+G${r + 1}` }]);                          // r+2
  F.push(["Compra bruta", "", "", "", "", "", { f: `SUM(H${r0}:H${rN})` }]);                      // r+3
  F.push(["Compra neta", "", "", "", "", "", { f: `ROUND(G${r + 3}/(1+B8/100),0)` }]);            // r+4
  F.push(["Factoring", "", "", "", "", "", { f: `ROUND(G${r}*B9/100,0)` }]);                      // r+5
  F.push(["Logística", "", "", "", "", "", { f: "B11" }]);                                        // r+6
  F.push(["Costo de garantía", "", "", "", "", "", { f: "B12" }]);                                // r+7
  F.push(["UTILIDAD antes de impuestos", "", "", "", "", "", { f: `G${r}-G${r + 4}-G${r + 5}-G${r + 6}-G${r + 7}` }]);   // r+8
  F.push(["Margen %", "", "", "", "", "", { f: `IF(G${r}=0,0,G${r + 8}/G${r})` }]);               // r+9
  F.push(["Reserva PPM", "", "", "", "", "", { f: `ROUND(G${r}*B10/100,0)` }]);                   // r+10
  F.push(["Resultado tras PPM", "", "", "", "", "", { f: `G${r + 8}-G${r + 10}` }]);              // r+11
  F.push(["¿Supera el tope obligatorio?", "", "", "", "", "", { f: `IF(B13=0,"no",IF(G${r + 2}>B13,"SÍ","no"))` }]);   // r+12
  F.push([]);
  F.push(["Valores de la versión (calculados por CotizÁgil, enteros)", "", "", "", "", "", ""]);
  F.push(["Venta neta", "", "", "", "", "", precio.ventaNeta], ["Venta bruta", "", "", "", "", "", precio.ventaBruta], ["Utilidad", "", "", "", "", "", precio.utilidad], ["Resultado tras PPM", "", "", "", "", "", precio.resultadoTrasPpm]);
  return xlsx([{ nombre: "Simulador", filas: F, anchos: [34, 30, 11, 18, 10, 18, 16, 16] }]);
}
export const bpsDePct = bps;
