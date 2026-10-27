// Análisis del estudio de mercado. Se ejecuta en el navegador sobre los datos
// recolectados (window.H2) y devuelve el objeto que se guarda como public/data/estudio.json.
// Se guarda aquí para poder repetir el estudio más adelante.
window.analizar = function analizar(H, AGG) {
  // Prefijos de categoría oficial (UNSPSC) que cuentan como "núcleo" de cada rubro.
  const CORE = {
    aridos: ["1111", "3011", "3012", "3013"],
    canchas: ["4916", "4920", "4921", "4922", "3012", "3015", "1111"],
    jardin: ["1015", "1016", "102", "103", "104", "105", "2711", "2110", "2111", "7010", "7011", "7016", "7017"],
    fertilizantes: ["1017", "1019", "7014", "721021"],
    alimentos: ["50", "9010"],
    imprenta: ["8210", "8212", "8214", "5510", "5511", "5512", "5310", "5212", "5215", "6014", "8014"],
    eventos: ["5610", "5611", "5612", "9010", "9011", "9013", "9015", "8014", "5216", "4511", "5215", "4810"],
  };
  // Vecindad curada entre rubros (se suma a la evidencia de compras conjuntas).
  const VECINOS = {
    aridos: [["canchas", "Maicillo y polvo de ladrillo usan la misma logística de áridos."], ["jardin", "Obras de plazas combinan áridos con áreas verdes."]],
    canchas: [["aridos", "La base de una cancha es árido compactado."], ["jardin", "Pasto natural y riego son la otra mitad del recinto deportivo."]],
    jardin: [["fertilizantes", "Quien mantiene áreas verdes compra abonos y herbicidas."], ["canchas", "Mantención de canchas de pasto natural."]],
    fertilizantes: [["jardin", "Mismo comprador: aseo y ornato, áreas verdes."], ["alimentos", "Programas agrícolas y huertos escolares."]],
    alimentos: [["eventos", "Colaciones y coffee break van con cada ceremonia."], ["imprenta", "Canastas y regalos corporativos con marca."]],
    imprenta: [["eventos", "Pendones, manteles y gráfica para ceremonias."], ["alimentos", "Regalos corporativos y canastas."]],
    eventos: [["alimentos", "Banquetería y coffee break."], ["imprenta", "Gráfica y merchandising del evento."]],
  };

  const mm = new Map(H.matches.map((m) => [m.c, m]));
  const median = (a) => { const s = a.filter((x) => x > 0).sort((x, y) => x - y); if (!s.length) return null; const k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  const top = (obj, n, sortKey) => Object.values(obj).sort((a, b) => b[sortKey] - a[sortKey]).slice(0, n);
  const isCore = (r, cc) => CORE[r].some((p) => String(cc || "").startsWith(p));
  const coreOf = (cc) => Object.keys(CORE).filter((r) => isCore(r, cc));
  const famName = (cat) => (cat || "").split(" / ").slice(-1)[0] || "Sin categoría";
  const regName = (s) => {
    let r = (s || "").trim().replace(/^Región (de los |de la |del |de |)/i, "").replace(/^Metropolitana de Santiago/i, "Metropolitana");
    if (/higgins/i.test(r)) r = "O'Higgins";
    if (/ays[eé]n/i.test(r)) r = "Aysén";
    if (/magallanes/i.test(r)) r = "Magallanes";
    if (/^lagos$/i.test(r)) r = "Los Lagos";
    if (/^r[ií]os$/i.test(r)) r = "Los Ríos";
    if (/^araucan/i.test(r)) r = "La Araucanía";
    return r ? r.charAt(0).toUpperCase() + r.slice(1) : "Sin región";
  };

  // Días muestreados por mes (para estacionalidad).
  const diasMes = {};
  AGG.listTotals.forEach((d) => { const k = d.f.slice(4) + "-" + d.f.slice(2, 4); diasMes[k] = (diasMes[k] || 0) + 1; });
  const SEMANA = 5; // un miércoles representa ~1/5 de las órdenes de la semana (fines de semana casi no hay emisión)

  const rubros = {};
  for (const r of Object.keys(CORE)) {
    const sample = Object.entries(H.details).filter(([c]) => (mm.get(c)?.r || []).includes(r));
    const core = sample.filter(([, d]) => d.it.some((i) => isCore(r, i.cc)));
    const p = sample.length ? core.length / sample.length : 0;
    const nombreMatches = Object.values(AGG.agg[r] || {}).reduce((a, x) => a + x.n, 0);
    const agMatches = Object.values(AGG.agg[r] || {}).reduce((a, x) => a + x.ag, 0);
    const ocAnual = nombreMatches * p * SEMANA;
    const montos = core.map(([, d]) => d.tn || 0);
    // Se acota el 5% superior para que un par de contratos gigantes no distorsione el promedio.
    const srt = montos.slice().sort((a, b) => a - b);
    const cap = srt.length ? srt[Math.min(srt.length - 1, Math.floor(srt.length * 0.95))] : 0;
    const meanMonto = montos.length ? montos.reduce((a, b) => a + Math.min(b, cap), 0) / montos.length : 0;
    const shareAG = core.length ? core.filter(([, d]) => d.t === "AG").length / core.length : (nombreMatches ? agMatches / nombreMatches : 0);

    const sub = {}, prod = {}, org = {}, reg = {}, prov = {}, comp = {}, vecEv = {};
    let montoCore = 0;
    for (const [, d] of core) {
      const o = (org[d.org] = org[d.org] || { org: d.org || "Sin nombre", n: 0, monto: 0 }); o.n++; o.monto += d.tn || 0;
      const g = regName(d.reg); (reg[g] = reg[g] || { region: g, n: 0 }).n++;
      const pv = (prov[d.pv] = prov[d.pv] || { nombre: d.pv || "Sin nombre", n: 0, monto: 0 }); pv.n++; pv.monto += d.tn || 0;
      const seenComp = new Set();
      for (const i of d.it) {
        const linea = (i.q || 0) * (i.pr || 0);
        if (isCore(r, i.cc)) {
          const k = String(i.cc);
          const s = (sub[k] = sub[k] || { codigo: k, nombre: famName(i.cat), monto: 0, n: 0 }); s.monto += linea; s.n++;
          montoCore += linea;
          const pk = (i.p || "").trim();
          if (pk) { const pr = (prod[pk] = prod[pk] || { producto: pk, n: 0, precios: [] }); pr.n++; if (i.pr > 0) pr.precios.push(i.pr); }
        } else {
          const fam = String(i.cc || "").slice(0, 6);
          if (!fam || fam === "0" || seenComp.has(fam)) continue;
          seenComp.add(fam);
          const c = (comp[fam] = comp[fam] || { codigo: fam, nombre: famName(i.cat), veces: 0 }); c.veces++;
          for (const r2 of coreOf(i.cc)) if (r2 !== r) vecEv[r2] = (vecEv[r2] || 0) + 1;
        }
      }
    }
    const totReg = Object.values(reg).reduce((a, x) => a + x.n, 0) || 1;
    Object.values(reg).forEach((x) => (x.share = x.n / totReg));
    const subArr = top(sub, 12, "monto");
    const totSub = subArr.reduce((a, x) => a + x.monto, 0) || 1;
    subArr.forEach((x) => (x.share = x.monto / totSub));
    const provArr = Object.values(prov).sort((a, b) => b.monto - a.monto);
    const totProv = provArr.reduce((a, x) => a + x.monto, 0) || 1;

    const mensual = Object.keys(diasMes).sort().map((mes) => {
      const a = (AGG.agg[r] || {})[mes] || { n: 0 };
      const porDia = a.n / diasMes[mes];
      return { mes, oc: Math.round(porDia * p * SEMANA * 4.33) };
    }).filter((m) => m.mes >= Object.keys(diasMes).sort()[1]); // se omite el mes inicial incompleto

    const vecinos = (VECINOS[r] || []).map(([rubro, porque]) => ({
      rubro,
      porque: vecEv[rubro] ? `${porque} En la muestra apareció ${vecEv[rubro]} veces en el mismo pedido.` : porque,
      peso: (vecEv[rubro] || 0) + 1,
    }));
    for (const [rubro, n] of Object.entries(vecEv)) {
      if (!vecinos.find((v) => v.rubro === rubro) && n >= 3) vecinos.push({ rubro, porque: `Apareció ${n} veces en el mismo pedido que tu rubro.`, peso: n });
    }
    vecinos.sort((a, b) => b.peso - a.peso);

    rubros[r] = {
      muestra: sample.length,
      muestraNucleo: core.length,
      precision: +p.toFixed(3),
      ocAnual: Math.round(ocAnual),
      montoAnual: Math.round(ocAnual * meanMonto),
      ticketMediano: median(montos),
      shareAG: +shareAG.toFixed(3),
      mensual,
      subrubros: subArr.map(({ codigo, nombre, monto, share }) => ({ codigo, nombre, monto: Math.round(monto), share: +share.toFixed(3) })),
      productos: Object.values(prod).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 20)
        .map((x) => ({ producto: x.producto, n: x.n, precioMediano: median(x.precios) })),
      compradores: top(org, 10, "n").map((x) => ({ org: x.org, n: x.n, monto: Math.round(x.monto) })),
      regiones: top(reg, 16, "n").map((x) => ({ region: x.region, share: +x.share.toFixed(3) })),
      proveedores: provArr.slice(0, 10).map((x) => ({ nombre: x.nombre, n: x.n, monto: Math.round(x.monto) })),
      proveedoresDistintos: provArr.length,
      concentracionTop5: +(provArr.slice(0, 5).reduce((a, x) => a + x.monto, 0) / totProv).toFixed(3),
      complementarios: top(comp, 10, "veces"),
      rubrosVecinos: vecinos.map(({ rubro, porque }) => ({ rubro, porque })),
      ejemplos: core.slice().sort((a, b) => String(b[1].fc).localeCompare(String(a[1].fc))).slice(0, 8)
        .map(([c, d]) => ({ codigo: c, nombre: mm.get(c)?.n, org: d.org, monto: d.tn, tipo: d.t, fecha: (d.fc || "").slice(0, 10) })),
    };
  }

  const fechas = AGG.listTotals.map((d) => d.f.slice(4) + "-" + d.f.slice(2, 4) + "-" + d.f.slice(0, 2)).sort();
  const fmt = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("es-CL", { month: "long", year: "numeric" });
  return {
    generado: new Date().toISOString(),
    periodo: { desde: fechas[0], hasta: fechas[fechas.length - 1], texto: `${fmt(fechas[0])} y ${fmt(fechas[fechas.length - 1])}` },
    metodo: {
      diasMuestreados: AGG.listTotals.length,
      ordenesRevisadas: AGG.totals.n,
      ordenesCompraAgil: AGG.totals.ag,
      detallesAnalizados: Object.keys(H.details).length,
      nota: `Estimación propia con datos públicos de la API de Mercado Público: se revisaron ${AGG.totals.n.toLocaleString("es-CL")} órdenes de compra de ${AGG.listTotals.length} días (un miércoles por semana durante 12 meses) y el detalle de ${Object.keys(H.details).length.toLocaleString("es-CL")} órdenes de la muestra. Los totales anuales se proyectan desde esa muestra y son conservadores: los contratos excepcionalmente grandes (el 5% superior) se acotan para que no distorsionen el promedio, y alrededor de 1 de cada 6 órdenes tiene un nombre genérico y no se puede asignar a un rubro solo por su nombre.`,
    },
    rubros,
  };
};
