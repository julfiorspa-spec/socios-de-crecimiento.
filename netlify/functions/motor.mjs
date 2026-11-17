// 🧮 MOTOR DE CAJA · toma cada cobro y lo hace correr por la cascada, en orden, y deja a cada persona con su libro.
// Puro: no toca red ni storage. robot.mjs lo persiste en `motor/<empresa>`.
//
// Reglas (editables en M.reglas):
//  1) IVA a pagar → SII (IVA de la venta − IVA de la compra financiada)
//  2) Capital del inversionista de ESE negocio (o proporcional, en fondos sin facturas mapeadas)
//  3) Deudas con prioridad sobre la utilidad (ej. Fabián: 100 % PJANIC, antes que socios y empresa)
//  4) Derechos sobre la utilidad: inversionista 8,4 % · ejecutador 15 % · resto 50 % socios / 50 % empresa (cuenta deuda / reserva)
//     Se pagan en proporción a lo que queda de caja; lo que no alcanza queda "devengado y pendiente" por persona.

export const REGLAS_BASE = {
  inversor_pct: 8.4, ejecutador_pct: 15, factoring_pct: 4,
  socios: [
    { nombre: "Felipe", pct: 51.5, cuentas: [{ nombre: "Mach · deuda Maca", pct: 50 }, { nombre: "Santander · gastos", pct: 25 }, { nombre: "Cuenta RUT · ahorro", pct: 25 }] },
    { nombre: "Diego", pct: 31.5 }, { nombre: "Christopher", pct: 17 },
  ],
  empresa: { cuenta_deuda_pct: 50, reserva_pct: 50 },
};

const R0 = (v) => Math.round(Number(v) || 0);
const neto = (conIva) => R0(conIva / 1.19);

// reparte `monto` entre partes [{k, peso}] en enteros, el residuo al mayor peso (cuadra al peso siempre)
export function repartirEntero(monto, partes) {
  const T = partes.reduce((s, p) => s + Math.max(0, Number(p.peso) || 0), 0); const out = {};
  if (!T || monto <= 0) { for (const p of partes) out[p.k] = 0; return out; }
  let acum = 0; const ord = [...partes].sort((a, b) => (b.peso || 0) - (a.peso || 0));
  for (const p of ord) { out[p.k] = Math.floor(monto * Math.max(0, p.peso || 0) / T); acum += out[p.k]; }
  out[ord[0].k] += monto - acum; return out;
}

// derechos sobre una utilidad U de un negocio: quién tiene derecho a cuánto (todavía no es caja)
export function derechosUtilidad(M, fondo, negocio, U) {
  const rg = M.reglas || REGLAS_BASE; const D = [];
  if (U <= 0) return D;
  const inv = R0(U * (rg.inversor_pct || 0) / 100), ej = R0(U * (rg.ejecutador_pct || 0) / 100);
  if (inv) D.push({ tipo: "inversor", a: fondo.inversor, concepto: `${rg.inversor_pct} % utilidad · ${negocio.nombre}`, monto: inv });
  if (ej) D.push({ tipo: "ejecutador", a: negocio.ejecutador || "Ejecutador", concepto: `ejecutador ${rg.ejecutador_pct} % · ${negocio.nombre}`, monto: ej });
  const resto = U - inv - ej; const mitad = repartirEntero(resto, [{ k: "socios", peso: 50 }, { k: "empresa", peso: 50 }]);
  const soc = repartirEntero(mitad.socios, (rg.socios || []).map((s) => ({ k: s.nombre, peso: s.pct })));
  for (const s of rg.socios || []) if (soc[s.nombre]) D.push({ tipo: "socio", a: s.nombre, concepto: `socio ${s.pct} % · ${negocio.nombre}`, monto: soc[s.nombre] });
  const emp = repartirEntero(mitad.empresa, [{ k: "cuenta_deuda", peso: rg.empresa?.cuenta_deuda_pct ?? 50 }, { k: "reserva", peso: rg.empresa?.reserva_pct ?? 50 }]);
  if (emp.cuenta_deuda) D.push({ tipo: "cuenta_deuda", a: "Cuenta deuda", concepto: `cuenta deuda · ${negocio.nombre}`, monto: emp.cuenta_deuda });
  if (emp.reserva) D.push({ tipo: "reserva", a: "PJANIC", concepto: `reserva empresa · ${negocio.nombre}`, monto: emp.reserva });
  return D;
}

// utilidad estimada de un negocio con los datos del fondo
export function utilidadNegocio(M, n) {
  const rg = M.reglas || REGLAS_BASE; const v = R0(n.venta), c = R0(n.costo);
  const ivaVenta = v - neto(v), ivaCompra = c - neto(c), fac = R0(v * (rg.factoring_pct || 0) / 100);
  return { venta: v, neto: neto(v), ivaVenta, costo: c, ivaCompra, ivaPagar: ivaVenta - ivaCompra, factoring: fac, utilidad: v - (ivaVenta - ivaCompra) - c - fac };
}

// saldo de capital por negocio: aportado − devuelto (por pagos de tipo capital ya hechos o programados en cobros)
function capitalDevuelto(fondo, negocioId) {
  let s = 0; for (const c of fondo.cobros || []) for (const p of c.pagos || []) if (p.tipo === "capital" && p.negocio === negocioId && p.estado !== "anulado") s += R0(p.monto); return s;
}
function ivaReservado(fondo, negocioId) {
  let s = 0; for (const c of fondo.cobros || []) for (const p of c.pagos || []) if (p.tipo === "iva" && p.negocio === negocioId && p.estado !== "anulado") s += R0(p.monto); return s;
}
function pagadoDeuda(M, deudaId) {
  let s = R0(M.deudas?.find((d) => d.id === deudaId)?.pagado_antes); for (const f of M.fondos || []) for (const c of f.cobros || []) for (const p of c.pagos || []) if (p.tipo === "deuda" && p.deuda === deudaId && p.estado !== "anulado") s += R0(p.monto); return s;
}

// 🔁 LA CASCADA · cobro = { negocios:[ids], facturas_total (con IVA), liquido (lo que entró), factoring (costo real), nota }
export function cascada(M, fondo, cobro) {
  const rg = M.reglas || REGLAS_BASE; const negs = (fondo.negocios || []).filter((n) => (cobro.negocios || []).includes(n.id));
  const liquido = R0(cobro.liquido); let caja = liquido; const pagos = []; const paso = (tipo, a, concepto, monto, extra = {}) => { const m = Math.min(Math.max(0, R0(monto)), caja); if (m > 0) { pagos.push({ tipo, a, concepto, monto: m, estado: tipo === "iva" || tipo === "reserva" || tipo === "cuenta_deuda" ? "retenido" : "pendiente", ...extra }); caja -= m; } return m; };
  const facturasTotal = R0(cobro.facturas_total) || negs.reduce((s, n) => s + R0(n.venta), 0);
  const factoring = cobro.factoring != null ? R0(cobro.factoring) : Math.min(Math.max(0, facturasTotal - liquido), R0(facturasTotal * (rg.factoring_pct || 0) / 100));   // sin dato real: estimado al % de la regla (un giro parcial no es costo)
  // 1) IVA · por negocio, una sola vez (el día 9 no vuelve a reservar lo que ya se reservó el día 1)
  let iva = 0;
  if (fondo.modo === "proporcional") { const ivaVenta = facturasTotal - neto(facturasTotal), ivaCompra = negs.reduce((s, n) => s + (R0(n.costo) - neto(R0(n.costo))), 0); iva = paso("iva", "SII", `IVA a pagar (venta ${ivaVenta} − compra ${ivaCompra})`, ivaVenta - ivaCompra, { negocio: negs[0]?.id }); }
  else for (const n of negs) { const u = utilidadNegocio(M, n); const pendIva = Math.max(0, u.ivaPagar - ivaReservado(fondo, n.id)); if (pendIva) iva += paso("iva", "SII", `IVA a pagar · ${n.nombre} (venta ${u.ivaVenta} − compra ${u.ivaCompra})`, pendIva, { negocio: n.id }); }
  // 2) capital del inversionista, negocio por negocio
  let capital = 0; const derechos = [];
  if (fondo.modo === "proporcional") {
    const pend = (fondo.negocios || []).reduce((s, n) => s + Math.max(0, R0(n.costo) - capitalDevuelto(fondo, n.id)), 0);
    const Utot = (fondo.negocios || []).reduce((s, n) => s + Math.max(0, utilidadNegocio(M, n).utilidad), 0);
    const base = pend + Utot; const r = base > 0 ? Math.min(1, caja / base) : 0;
    for (const n of fondo.negocios || []) { const p = Math.max(0, R0(n.costo) - capitalDevuelto(fondo, n.id)); if (p) capital += paso("capital", fondo.inversor, `capital ${n.nombre} (${(r * 100).toFixed(2)} %)`, R0(p * r), { negocio: n.id }); }
    for (const n of fondo.negocios || []) for (const d of derechosUtilidad(M, fondo, n, utilidadNegocio(M, n).utilidad)) derechos.push({ ...d, monto: R0(d.monto * r), negocio: n.id });
  } else {
    for (const n of negs) { const p = Math.max(0, R0(n.costo) - capitalDevuelto(fondo, n.id)); if (p) capital += paso("capital", fondo.inversor, `capital ${n.nombre}`, p, { negocio: n.id }); }
    const facEst = negs.reduce((s, x) => s + utilidadNegocio(M, x).factoring, 0), ventaT = negs.reduce((s, x) => s + R0(x.venta), 0) || 1;
    for (const n of negs) { const U0 = utilidadNegocio(M, n); const u = U0.utilidad - R0((factoring - facEst) * R0(n.venta) / ventaT);   // utilidad real: ajusta el factoring estimado al costo real del giro
      for (const d of derechosUtilidad(M, fondo, n, u)) derechos.push({ ...d, negocio: n.id }); }
  }
  // 3) deudas con prioridad sobre la utilidad
  let prioridad = 0;
  for (const d of M.deudas || []) { if (!d.prioridad || (d.fondo && d.fondo !== fondo.id)) continue; const pend = Math.max(0, R0(d.monto) - pagadoDeuda(M, d.id)); if (pend) prioridad += paso("deuda", d.nombre, `prioridad · ${d.nombre} (${d.origen || "acuerdo"})`, pend, { deuda: d.id }); }
  // 4) derechos sobre la utilidad, en proporción a la caja que queda
  const totalDer = derechos.reduce((s, d) => s + d.monto, 0); const disponible = caja; const rr = totalDer > 0 ? Math.min(1, disponible / totalDer) : 0;
  const agreg = {}; for (const d of derechos) { const k = d.tipo + "|" + d.a; agreg[k] = agreg[k] || { tipo: d.tipo, a: d.a, derecho: 0, conceptos: [] }; agreg[k].derecho += d.monto; agreg[k].conceptos.push(d.concepto); }
  const pagosDer = repartirEntero(R0(totalDer * rr), Object.entries(agreg).map(([k, v]) => ({ k, peso: v.derecho })));
  let cuentaDeuda = 0;
  for (const [k, v] of Object.entries(agreg)) { const m = pagosDer[k] || 0; if (v.tipo === "cuenta_deuda") { cuentaDeuda += paso("cuenta_deuda", "Cuenta deuda", v.conceptos.join(" · "), m, { derecho: v.derecho }); continue; }
    if (v.tipo === "socio" && (rg.socios || []).find((s) => s.nombre === v.a)?.cuentas?.length) { const s = rg.socios.find((x) => x.nombre === v.a); const sub = repartirEntero(m, s.cuentas.map((c) => ({ k: c.nombre, peso: c.pct }))); for (const c of s.cuentas) if (sub[c.nombre]) paso("socio", v.a, `${v.conceptos[0].split(" · ")[0]} → ${c.nombre}`, sub[c.nombre], { derecho: R0(v.derecho * c.pct / 100), cuenta: c.nombre }); continue; }
    paso(v.tipo, v.a, v.conceptos.join(" · "), m, { derecho: v.derecho }); }
  // 5) la cuenta deuda se reparte entre las deudas en proporción al saldo de cada una
  if (cuentaDeuda > 0) { const ds = (M.deudas || []).map((d) => ({ d, pend: Math.max(0, R0(d.monto) - pagadoDeuda(M, d.id)) })).filter((x) => x.pend > 0); const rep = repartirEntero(cuentaDeuda, ds.map((x) => ({ k: x.d.id, peso: x.pend })));
    for (const x of ds) if (rep[x.d.id]) pagos.push({ tipo: "deuda", a: x.d.nombre, concepto: `cuenta deuda · ${Math.round(x.pend / ds.reduce((s, y) => s + y.pend, 0) * 1000) / 10} % del saldo`, monto: rep[x.d.id], estado: "pendiente", deuda: x.d.id, desde: "cuenta_deuda" }); const i = pagos.findIndex((p) => p.tipo === "cuenta_deuda"); if (i >= 0) pagos[i].estado = "repartido"; }
  const sobra = caja;
  return { liquido, facturas_total: facturasTotal, factoring, iva, capital, prioridad, utilidad_derechos: totalDer, proporcion_derechos: rr, pagos, sobra, derechos: Object.values(agreg) };
}

// 📒 libro por persona: devengado (derechos) · pagado · pendiente, a partir de todos los cobros del motor
export function libros(M) {
  const L = {}; const add = (a, k, v) => { L[a] = L[a] || { devengado: 0, pagado: 0, programado: 0, capital_devuelto: 0 }; L[a][k] += R0(v); };
  for (const f of M.fondos || []) for (const c of f.cobros || []) for (const p of c.pagos || []) {
    if (p.estado === "anulado" || p.tipo === "iva" || p.tipo === "reserva" || p.tipo === "cuenta_deuda") continue;
    if (p.tipo === "capital") { if (p.estado === "pagado") add(p.a, "capital_devuelto", p.monto); else add(p.a, "programado", p.monto); continue; }
    if (p.derecho) add(p.a, "devengado", p.derecho);
    if (p.estado === "pagado") add(p.a, "pagado", p.monto); else add(p.a, "programado", p.monto);
  }
  for (const a of Object.keys(L)) L[a].pendiente = Math.max(0, L[a].devengado - L[a].pagado - L[a].programado);
  return L;
}

export function resumenFondo(M, f) {
  const negs = (f.negocios || []).map((n) => { const u = utilidadNegocio(M, n); const dev = capitalDevuelto(f, n.id); return { ...n, ...u, capital_devuelto: dev, capital_pendiente: Math.max(0, R0(n.costo) - dev), aporte: R0(n.aporte) }; });
  const T = (k) => negs.reduce((s, n) => s + (n[k] || 0), 0);
  return { id: f.id, nombre: f.nombre, inversor: f.inversor, modo: f.modo || "por_negocio", negocios: negs, ventas: T("venta"), costo: T("costo"), aportado: T("aporte"), capital_devuelto: T("capital_devuelto"), capital_pendiente: T("capital_pendiente"), utilidad: T("utilidad"), cobros: (f.cobros || []).length };
}
