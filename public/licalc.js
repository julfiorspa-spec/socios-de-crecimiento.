// 🧮 licalc (navegador) · misma aritmética que netlify/functions/licalc.mjs (BigInt): lo que se ve es lo que se aprueba.
// Generado a partir del módulo del servidor; si cambias uno, cambia el otro (tests/licalc.test.mjs lo comprueba).
(function () {
function simularOferta({
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


const limpia = (e) => ({ presupuestoBruto: e.presupuestoBruto, descuentoBps: e.descuentoBps, ivaBps: e.ivaBps ?? 1900, factoringBps: e.factoringBps, ppmBps: e.ppmBps, logisticaNeta: e.logisticaNeta, costoGarantiaNeto: e.costoGarantiaNeto || 0, topeBrutoObligatorio: e.topeBrutoObligatorio ?? null, lineas: e.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad, compraUnitariaBruta: l.compraUnitariaBruta, peso: l.peso })) });


// Tres escenarios comparables: presupuesto completo, el descuento elegido y el máximo descuento que respeta el piso de margen.
function escenarios(entrada, pisoMargen = 0.12) {
  const e = limpia(entrada); const sim = (d) => { try { return simularOferta({ ...e, descuentoBps: d }); } catch { return null; } };
  const viable = (p) => p && p.utilidad > 0 && p.margen >= pisoMargen && !p.superaTope;
  let maxBps = null; for (let d = 0; d <= 3000; d += 10) { if (viable(sim(d))) maxBps = d; else if (maxBps != null) break; }
  const lista = [{ k: "completo", nombre: "Presupuesto completo", descuentoBps: 0 }, { k: "elegido", nombre: "Descuento elegido", descuentoBps: e.descuentoBps }, { k: "piso", nombre: "Máximo descuento con margen ≥ " + Math.round(pisoMargen * 100) + " %", descuentoBps: maxBps }];
  return { pisoMargen, hayViable: maxBps != null, escenarios: lista.map((x) => { const p = x.descuentoBps == null ? null : sim(x.descuentoBps); return { ...x, precio: p, viable: viable(p), motivo: p == null ? "no hay precio viable con estos costos" : !viable(p) ? (p.superaTope ? "supera el tope obligatorio" : p.utilidad <= 0 ? "pierde plata" : `margen ${Math.round(p.margen * 1000) / 10} % bajo el piso`) : "" }; }) };
}


window.LICALC = { simularOferta, escenarios };
})();
