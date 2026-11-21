// ✍️ Anexos firmados en la nube: al apretar «Apruebo este precio · firmar anexos» se generan los anexos que el licitador reconoció
//    (oferta económica, identificación del oferente, pacto/programa de integridad, declaraciones de formato libre) con los datos del
//    perfil de la empresa y el precio aprobado, se estampa la firma dibujada del representante en los que corresponde y se arma el
//    ZIP «Oferta_<ID>_PJANIC.zip». Las declaraciones juradas NO se firman solas: quedan marcadas para revisión del representante.
//    Lo que no está acreditado en el perfil se escribe como PENDIENTE; nunca se inventa un dato ni se declara nada en nombre de nadie.
//    La presentación en Mercado Público es manual (el botón «Ofertar en Mercado Público» solo abre la ficha del portal).
import { EMPRESA_BASE, PARAMS_LIC, clp } from "./licitador.mjs";
import { pdf } from "./pdfmin.mjs";
import { zipStore } from "./xlsxmin.mjs";

const R0 = (v) => Math.round(Number(v) || 0);
const fechaCL = (iso) => new Date(iso || Date.now()).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric" });
const seguro = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70);

// clasifica un documento reconocido por lo que dice su nombre / contenido
export function tipoDoc(d) {
  const s = `${d.nombre || ""} ${d.que_contiene || ""} ${d.requisito || ""}`.toLowerCase();
  if (/declaraci[oó]n jurada|jurad|inhabilidad|no deuda|conflicto de inter|art[ií]culo 4|ley 19\.?886|persona natural|persona jur/.test(s)) return "jurada";
  if (/econ[oó]mic|precio|oferta econ|anexo n.?°? ?(2|3)\b/.test(s)) return "economica";
  if (/identificaci[oó]n|datos del oferente|anexo n.?°? ?1\b|antecedentes del oferente|ficha del oferente/.test(s)) return "identificacion";
  if (/pacto|integridad|probidad/.test(s)) return "integridad";
  if (/t[eé]cnic|ficha|especificaci|plazo|garant[ií]a|experiencia|uni[oó]n temporal|utp/.test(s)) return "tecnica";
  return "otro";
}

// unifica el trabajo (licitador en la nube `t.auto` o lectura del PC `t.lic`) en una oferta plana
export function ofertaDesde(t, op = {}) {
  const A = t.auto || null, L = A?.lic || null, LG = t.lic || null, X = LG?.experto || {};
  const id = t.codigo; const O = { id, nombre: L?.nombre || LG?.producto || t.nombre || "Licitación", comprador: L?.comprador || t.organismo || "", cierre: L?.cierre || LG?.cierre || "", plazo: op.plazo || L?.plazo_entrega || LG?.plazo_entrega || X.evaluacion?.plazo_recomendado || "",
    garantia: op.garantia || "", vigencia: op.vigencia || `${PARAMS_LIC.validez_dias || 60} días desde la apertura`, lineas: [], docs: [], pacto: L?.pacto_integridad || null, fuente: A ? "nube" : "pc", presupuesto: L?.presupuesto ?? LG?.presupuesto ?? null, presupuesto_con_iva: L?.presupuesto_con_iva ?? LG?.con_iva ?? null };
  const vA = A?.version_aprobada; const det = vA?.precio?.detalle || [];
  if (A && (A.seleccion || []).length) {       // nube: precio de la versión aprobada (o de la decisión vigente)
    for (const s of A.seleccion) { const it = (L.items || []).find((i) => i.id === s.itemId) || {}; const d = det.find((x) => x.id === s.itemId); O.lineas.push({ nombre: it.nombre || s.producto?.nombre || s.itemId, cantidad: Number(s.cantidad || it.cantidad) || 1, unidad: it.unidad || "", unitNeto: R0(d?.precioUnitarioNeto ?? s.precioVentaNeto) }); }
  } else if (LG) {                             // lectura del PC: precio unitario aprobado con la barra (o el que mandó el cliente)
    const cant = Number(LG.cantidad) || 1; const unit = R0(op.precioUnitNeto ?? LG.precio_unit);
    const items = (LG.items || []).filter((i) => i.descripcion);
    if (items.length <= 1) O.lineas.push({ nombre: LG.producto || items[0]?.descripcion || O.nombre, cantidad: cant, unidad: LG.unidad || items[0]?.unidad || "", unitNeto: unit });
    else O.lineas.push({ nombre: LG.producto || O.nombre, cantidad: cant, unidad: LG.unidad || "", unitNeto: unit, detalle: items.map((i) => `${i.cantidad ?? ""} ${i.unidad || ""} ${i.descripcion}`.trim()) });
  }
  if (op.precioUnitNeto != null && O.lineas.length === 1 && O.fuente === "pc") O.lineas[0].unitNeto = R0(op.precioUnitNeto);
  O.ventaNeta = O.lineas.reduce((s, l) => s + l.unitNeto * l.cantidad, 0); O.iva = R0(O.ventaNeta * 0.19); O.ventaTotal = O.ventaNeta + O.iva;
  // documentos reconocidos: lectura de la nube (L.documentos) o admisibilidad del PC (X.admisibilidad)
  const vistos = new Set();
  for (const d of L?.documentos || []) { const n = String(d.nombre || "").trim(); if (!n || vistos.has(n.toLowerCase())) continue; vistos.add(n.toLowerCase()); O.docs.push({ nombre: n, obligatorio: d.obligatorio !== false, firma: !!d.firma, quien: d.quien || "", campos: d.campos || [], que_contiene: d.que_contiene || "", seccion: d.seccion_portal || "", tipo: tipoDoc(d) }); }
  for (const a of X.admisibilidad || []) { const n = String(a.documento || a.requisito || "").trim(); if (!n || vistos.has(n.toLowerCase())) continue; vistos.add(n.toLowerCase()); O.docs.push({ nombre: n, obligatorio: a.subsanable !== true, firma: !!a.firma && !/no/i.test(String(a.firma)), quien: "", campos: [], que_contiene: a.requisito || "", seccion: a.seccion_portal || "", tipo: tipoDoc({ nombre: n, requisito: a.requisito }) }); }
  if (!O.docs.some((d) => d.tipo === "economica")) O.docs.push({ nombre: "Anexo oferta económica", obligatorio: true, firma: true, campos: [], tipo: "economica", generico: true });
  if (!O.docs.some((d) => d.tipo === "identificacion")) O.docs.push({ nombre: "Anexo identificación del oferente", obligatorio: true, firma: true, campos: [], tipo: "identificacion", generico: true });
  if (O.pacto?.existe && !O.docs.some((d) => d.tipo === "integridad")) O.docs.push({ nombre: "Pacto de integridad", obligatorio: true, firma: true, campos: [], tipo: "integridad", generico: true });
  return O;
}

// ---------- 🧩 cuestionario previo: lo que los anexos no pueden saber solos se le pregunta al humano, con contexto ----------
const esLog = (d) => /recinto|almacen|bodega|equipo|maquinaria|traslado|transporte|veh[ií]culo|log[ií]stic|flota|cami[oó]n|plan de (trabajo|entrega|ejecuci)|metodolog/i.test(`${d.nombre} ${d.que_contiene || ""}`);
export function preguntasFirma(t, E, O, previas = {}) {
  const L = t.auto?.lic || {}, LG = t.lic || {}, X = LG.experto || {}; const Q = []; const v = (id, def) => previas[id] ?? def ?? "";
  const lugar = L.direccion_entrega || L.lugar_entrega || LG.lugar_entrega || ""; const dias = L.plazo_entrega_dias || null; const G = L.garantias || X.garantias || {};
  const ctxPlazo = [dias ? `Las bases hablan de ${dias} días` : (L.plazo_entrega || LG.plazo_entrega) ? `Las bases hablan de «${L.plazo_entrega || LG.plazo_entrega}»` : "Las bases no fijan un plazo claro", lugar ? `entrega en ${lugar}` : "", L.multas ? `multa: ${L.multas}` : ""].filter(Boolean).join(" · ");
  Q.push({ id: "plazo", titulo: "Plazo de entrega", pregunta: "¿En cuántos días entregas, contados desde la orden de compra o el contrato?", ayuda: ctxPlazo + ". Pon un plazo que puedas cumplir: la multa corre por día de atraso.", valor: v("plazo", O.plazo), obligatoria: true, ejemplo: dias ? `${dias} días corridos desde la orden de compra` : "20 días corridos desde la orden de compra" });
  const gTxt = [G.fiel_pct ? `fiel cumplimiento ${G.fiel_pct} %` : G.fiel_cumplimiento ? `fiel cumplimiento: ${G.fiel_cumplimiento}` : "", G.seriedad_pct ? `seriedad ${G.seriedad_pct} %` : G.seriedad ? `seriedad: ${G.seriedad}` : "", G.vigencia ? `vigencia ${G.vigencia}` : ""].filter(Boolean).join(" · ");
  Q.push({ id: "garantia", titulo: "Garantía del producto", pregunta: "¿Qué garantía ofreces sobre lo que entregas (meses, cambio por defecto, respaldo del fabricante)?", ayuda: (gTxt ? `Las bases piden además garantías documentales: ${gTxt}. ` : "") + "Aquí va la garantía comercial del producto, la que escribes en la oferta.", valor: v("garantia", O.garantia), obligatoria: true, ejemplo: "12 meses contra defectos de fabricación; reposición sin costo" });
  Q.push({ id: "vigencia", titulo: "Vigencia de la oferta", pregunta: "¿Cuántos días mantienes vigente tu oferta?", ayuda: "Si las bases exigen un mínimo, respétalo.", valor: v("vigencia", O.vigencia), obligatoria: false, ejemplo: "60 días desde la apertura" });
  const prov = (t.auto?.seleccion || []).map((s) => s.cotizacion?.proveedor).filter(Boolean).join(", ");
  Q.push({ id: "proveedor", titulo: "Tu proveedor y dónde está", pregunta: "¿Quién te vende el producto y desde qué ciudad sale?", ayuda: prov ? `El licitador cotizó con ${prov}; confirma o corrige, y agrega la ciudad de origen.` : "Nombre del proveedor y ciudad de origen (de ahí sale la logística).", valor: v("proveedor", prov), obligatoria: true, ejemplo: "Distribuidora Sur, Puerto Montt" });
  Q.push({ id: "traslado", titulo: "Cómo lo trasladas", pregunta: `¿Cómo llega el producto${lugar ? " hasta " + lugar : " al lugar de entrega"}? Cuéntame el camino completo.`, ayuda: "Camión, camión con carro, barcaza, transportista, courier, retiro en bodega del proveedor… y quién lo paga. Esto va en el plan de logística y en las declaraciones de traslado.", valor: v("traslado"), obligatoria: true, ejemplo: "Camiones con carro desde Puerto Montt, cruce en barcaza a Chaitén y camino por la Carretera Austral hasta la faena" });
  if (O.docs.some((d) => /recinto|almacen|bodega/i.test(d.nombre))) Q.push({ id: "recinto", titulo: "Recinto de almacenamiento", pregunta: "¿Dónde guardas el producto antes de entregarlo (dirección y de quién es la bodega)?", ayuda: "Las bases piden una declaración de recinto de almacenamiento.", valor: v("recinto"), obligatoria: true, ejemplo: "Bodega del proveedor en Puerto Montt hasta el despacho; acopio en la faena al llegar" });
  if (O.docs.some((d) => /equipo|maquinaria|veh[ií]culo|flota/i.test(d.nombre))) Q.push({ id: "equipos", titulo: "Equipos para el traslado", pregunta: "¿Con qué equipos o vehículos haces el traslado y la descarga?", ayuda: "Las bases piden declarar los equipos: tipo, cantidad y si son propios o contratados.", valor: v("equipos"), obligatoria: true, ejemplo: "2 camiones con carro (transportista contratado) y grúa horquilla para descargar" });
  // campos de los anexos que el perfil no sabe llenar
  O.docs.forEach((d, n) => { for (const c of d.campos || []) { if (!/PENDIENTE/.test(datoPara(c, E, O, "", {}))) continue; const id = `campo:${n}:${c}`; if (/plazo|garant|vigencia|validez/i.test(c)) continue;
    Q.push({ id, titulo: c, pregunta: `En «${d.nombre}» piden «${c}». ¿Qué pongo?`, ayuda: d.que_contiene || "", valor: v(id), obligatoria: !!d.obligatorio, doc: d.nombre }); } });
  if (!E.giro) Q.push({ id: "giro", titulo: "Giro (SII)", pregunta: "¿Cuál es el giro tributario de la empresa según el SII? (si no lo tienes a mano, sáltalo y queda PENDIENTE)", ayuda: "Se guarda en el perfil para las próximas licitaciones.", valor: v("giro"), obligatoria: false, perfil: true });
  if (!E.banco) Q.push({ id: "banco", titulo: "Banco y cuenta", pregunta: "¿Banco, tipo y número de cuenta para los pagos? (puedes saltarlo)", ayuda: "Se guarda en el perfil; en los anexos aparece como PENDIENTE si lo saltas.", valor: v("banco"), obligatoria: false, perfil: true });
  return Q;
}

// ---------- generación ----------
export async function firmarAnexos(ctx, t, op = {}) {
  const { store } = ctx; const E = { ...EMPRESA_BASE, ...(op.empresa || {}) }; const O = ofertaDesde(t, op); const R = op.respuestas || {};
  if (R.plazo) O.plazo = R.plazo; if (R.garantia) O.garantia = R.garantia; if (R.vigencia) O.vigencia = R.vigencia;
  if (!O.lineas.length || !O.ventaNeta) throw new Error("No hay precio aprobado para esta licitación: revisa la lectura o el simulador antes de firmar.");
  const firmaImg = op.firma || null; const meta = op.firmaMeta || {}; const firmante = E.representante || meta.nombre || "Representante legal"; const rutF = E.rut_representante || meta.rut || "";
  const hoy = fechaCL(ctx.ahora()); const lugar = `${E.ciudad || "Santiago"}, ${hoy}`; const domicilio = [E.direccion, E.comuna, E.ciudad, E.region ? "Región " + E.region : ""].filter(Boolean).flatMap((p) => String(p).split(/\s*,\s*/)).filter((p, i, a) => p && a.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i).join(", ");
  const pie = `${E.razon_social} · RUT ${E.rut} · Licitación ${O.id} · preparado con CotizÁgil el ${hoy}`; const cab = `Licitación ${O.id} · ${O.comprador}`;
  const PEND = (v, que) => (v ? String(v) : `PENDIENTE · ${que}`);
  const firmaBloque = (d, firmar) => (firmar && firmaImg ? d.firma(`${firmante} · RUT ${rutF} · ${E.representante_cargo || "Representante legal"} · ${E.razon_social}`, { img: firmaImg, nota: `Firmado en ${lugar} con la firma registrada en CotizÁgil (aprobación de ${op.por || "la empresa"}).` })
    : d.firma(`${firmante} · RUT ${rutF} · ${E.representante_cargo || "Representante legal"} · ${E.razon_social}`, { nota: firmar ? "Sin firma registrada: firmar a mano." : "PARA REVISIÓN Y FIRMA DEL REPRESENTANTE · no se firma automáticamente." }));
  const datosOferente = [["Razón social", E.razon_social], ["Nombre de fantasía", E.nombre_corto], ["RUT", E.rut], ["Giro", PEND(E.giro, "verificar con el SII")], ["Domicilio", domicilio], ["Región / país", [E.region, E.pais].filter(Boolean).join(" · ")],
    ["Correo comercial", E.email], ["Teléfono", E.telefono], ["Representante legal", `${E.representante} · RUT ${E.rut_representante}`], ["Cargo", E.representante_cargo || "Representante legal"], ["Correo / teléfono del representante", [E.representante_email || E.email, E.representante_telefono || E.telefono].filter(Boolean).join(" · ")],
    ["Contacto comercial", E.contacto_comercial || E.representante], ["Actividad", E.actividad || ""], ["Personería", E.facultades_ok ? "acreditada (documento de personería adjunto)" : "PENDIENTE · confirmar acto, fecha, notaría y facultades"],
    ["Constitución", E.constitucion || ""], ["Accionistas / beneficiarios finales", E.accionista || "PENDIENTE"], ["Banco / cuenta", PEND(E.banco, "banco, tipo y número de cuenta y ciudad de apertura")], ["Contacto finanzas / facturación", PEND(E.contacto_finanzas, "por completar")], ["ChileProveedores", E.chileproveedores ? "hábil" : "verificar estado hábil al presentar"]];
  const archivos = []; const guardar = async (nombre, data) => { archivos.push({ nombre, data }); await store.set(`licauto/${t.codigo}/firmado/${nombre}`, data).catch(() => {}); };
  const firmados = [], revision = [], declarados = [], pendientes = [...(E.pendientes || []), ...(!O.plazo ? ["Plazo de entrega: por confirmar"] : []), ...(!O.garantia ? ["Garantía del producto: por confirmar"] : [])]; let n = 0;
  for (const d of O.docs) {
    n++; const nombreArch = `${O.id}_${String(n).padStart(2, "0")}_${seguro(d.nombre) || d.tipo}.pdf`; const firmar = d.tipo !== "jurada" && d.tipo !== "tecnica" && (d.firma || d.generico) && (d.tipo !== "otro" || (esLog(d) && !!(R.recinto || R.equipos || R.traslado)));
    const doc = pdf({ titulo: `${d.nombre} · ${O.id}`, autor: E.razon_social, pie, cabecera: cab }).titulo(d.nombre, `${O.nombre} · ${O.comprador}${d.seccion ? " · sección del portal: " + d.seccion : ""}`);
    if (!d.generico) doc.nota(`Transcripción del anexo oficial «${d.nombre}» con los datos del oferente. Si el portal exige el formato original, copiar estos mismos datos en él.`);
    if (d.tipo === "economica") {
      doc.h2("Oferente").kv([["Razón social", E.razon_social], ["RUT", E.rut], ["Domicilio", domicilio], ["Correo / teléfono", [E.email, E.telefono].filter(Boolean).join(" · ")], ["Representante legal", `${E.representante} · ${E.rut_representante}`], ["Licitación", `${O.id} · ${O.nombre}`]], { kw: 150 })
        .h2("Oferta económica").tabla(["#", "Producto / servicio", "Cantidad", "Precio unitario neto", "Total neto"], O.lineas.map((l, i) => [String(i + 1), l.nombre + (l.detalle ? "\n" + l.detalle.join("\n") : ""), `${l.cantidad} ${l.unidad}`.trim(), clp(l.unitNeto), clp(l.unitNeto * l.cantidad)]), { anchos: [24, 230, 70, 90, 85], der: [3, 4] })
        .kv([["Total neto", clp(O.ventaNeta)], ["IVA 19 %", clp(O.iva)], ["TOTAL CON IVA", clp(O.ventaTotal)], ["Presupuesto referencial", O.presupuesto != null ? clp(O.presupuesto) + (O.presupuesto_con_iva ? " con IVA" : O.presupuesto_con_iva === false ? " neto" : "") : "no informado"]], { kw: 200 })
        .h2("Condiciones").kv([["Plazo de entrega", PEND(O.plazo, "confirmar plazo ofertado")], ["Vigencia de la oferta", O.vigencia], ["Garantía ofrecida", PEND(O.garantia, "confirmar garantía según bases")]], { kw: 200 })
        .nota("Precios en pesos chilenos, netos; el total incluye IVA. El valor a transcribir en el portal es el NETO aprobado. Precio aprobado en CotizÁgil por " + (op.por || "la empresa") + " el " + hoy + ".");
    } else if (d.tipo === "identificacion") {
      doc.h2("Datos del oferente").kv(datosOferente, { kw: 190 });
      if (d.campos?.length) doc.h2("Campos del anexo oficial").tabla(["Campo", "Dato"], d.campos.map((c) => [c, datoPara(c, E, O, domicilio, R, n - 1)]), { anchos: [200, 299] });
    } else if (d.tipo === "integridad") {
      doc.h2("Pacto / programa de integridad");
      if (O.pacto?.texto) doc.p(O.pacto.texto).nota(`Texto tomado de ${O.pacto.doc || "las bases"}${O.pacto.pagina ? " p. " + O.pacto.pagina : ""}.`);
      else doc.p("El oferente declara conocer y aceptar el pacto de integridad de las bases de esta licitación: no ofrecer ni conceder sobornos u otros beneficios indebidos; no incurrir en colusión ni acuerdos con otros oferentes; entregar información veraz; respetar las normas de probidad y la Ley 19.886 y su reglamento.").nota("Las bases leídas no traen el texto exacto del pacto: si el portal exige el formato oficial, usar ese documento con estos mismos datos.");
      doc.kv([["Oferente", `${E.razon_social} · ${E.rut}`], ["Representante legal", `${E.representante} · ${E.rut_representante}`], ["Licitación", `${O.id} · ${O.nombre}`]], { kw: 150 });
      if (!E.integridad_ok) { doc.nota("RESPALDO PENDIENTE: las bases piden pacto o programa de integridad; adjuntar el respaldo (programa/política de integridad de la empresa o constancia de difusión) si lo exigen."); pendientes.push(`${d.nombre}: adjuntar respaldo de integridad si las bases lo exigen`); }
    } else if (d.tipo === "jurada") {
      doc.h2("Declaración jurada · para revisión del representante").p(`Documento: ${d.nombre}.${d.que_contiene ? " Contenido según bases: " + d.que_contiene + "." : ""}`)
        .p("Esta declaración la lee, completa y firma el representante legal con facultades vigentes. CotizÁgil deja los datos del oferente listos y NO declara nada en su nombre.")
        .h3("Datos del declarante").kv([["Razón social", E.razon_social], ["RUT", E.rut], ["Representante legal", `${E.representante} · ${E.rut_representante}`], ["Domicilio", domicilio], ["Licitación", O.id]], { kw: 150 });
      if (d.campos?.length) doc.tabla(["Campo del formulario", "Dato / estado"], d.campos.map((c) => [c, datoPara(c, E, O, domicilio, R, n - 1)]), { anchos: [200, 299] });
      revision.push(d.nombre);
    } else if (d.tipo === "otro" && esLog(d) && (R.recinto || R.equipos || R.traslado)) {   // declaración de formato libre con lo que respondió el humano (se firma: lo declaró él)
      const cuerpo = /recinto|almacen|bodega/i.test(d.nombre) ? R.recinto : /equipo|maquinaria|veh[ií]culo|flota/i.test(d.nombre) ? R.equipos : R.traslado;
      doc.h2("Declaración").p(`${E.razon_social}, RUT ${E.rut}, representada por ${E.representante}, RUT ${E.rut_representante}, declara para la licitación ${O.id} «${O.nombre}»:`)
        .p(cuerpo || "", { sangria: 12 }).kv([["Proveedor / origen", R.proveedor || ""], ["Traslado", R.traslado || ""], ["Plazo ofertado", O.plazo], ["Garantía", O.garantia]], { kw: 150 });
      if (d.campos?.length) doc.tabla(["Campo", "Dato"], d.campos.map((c) => [c, datoPara(c, E, O, domicilio, R, n - 1)]), { anchos: [200, 299] });
      declarados.push(d.nombre);
    } else {
      doc.h2(d.obligatorio ? "Documento obligatorio" : "Documento opcional").p(d.que_contiene || "Según bases.").kv([["Oferente", `${E.razon_social} · ${E.rut}`], ["Representante", `${E.representante} · ${E.rut_representante}`], ["Licitación", O.id], ["Plazo ofertado", PEND(O.plazo, "confirmar")], ["Garantía", PEND(O.garantia, "confirmar")]], { kw: 150 });
      if (d.campos?.length) doc.tabla(["Campo", "Dato"], d.campos.map((c) => [c, datoPara(c, E, O, domicilio, R, n - 1)]), { anchos: [200, 299] });
      if (d.tipo === "tecnica") { doc.nota("Los datos técnicos (fichas, certificados, experiencia) se adjuntan desde el proveedor real: no se firma hasta tener el respaldo."); revision.push(d.nombre); }
    }
    doc.h2("Lugar y fecha").p(lugar); firmaBloque(doc, firmar);
    await guardar(nombreArch, doc.build()); if (firmar && firmaImg) firmados.push(d.nombre); else if (firmar) revision.push(d.nombre + " (sin firma registrada)");
  }
  // 🚚 plan de logística y ejecución con lo que contó el humano (se firma: es su declaración)
  if (R.proveedor || R.traslado) { n++; const nombreArch = `${O.id}_${String(n).padStart(2, "0")}_Plan_de_logistica_y_ejecucion.pdf`;
    const doc = pdf({ titulo: `Plan de logística ${O.id}`, autor: E.razon_social, pie, cabecera: cab }).titulo("Plan de logística y ejecución", `${O.nombre} · ${O.comprador}`)
      .h2("Qué se entrega").tabla(["Producto", "Cantidad"], O.lineas.map((l) => [l.nombre, `${l.cantidad} ${l.unidad}`.trim()]), { anchos: [380, 119] })
      .h2("Origen").p(R.proveedor || "").h2("Traslado hasta el lugar de entrega").p(R.traslado || "");
    if (R.recinto) doc.h2("Almacenamiento").p(R.recinto); if (R.equipos) doc.h2("Equipos").p(R.equipos);
    doc.h2("Plazo y garantía").kv([["Plazo de entrega", O.plazo], ["Garantía", O.garantia], ["Vigencia de la oferta", O.vigencia]], { kw: 150 }).h2("Lugar y fecha").p(lugar); firmaBloque(doc, true);
    await guardar(nombreArch, doc.build()); if (firmaImg) firmados.push("Plan de logística y ejecución"); else revision.push("Plan de logística y ejecución (sin firma registrada)"); }
  // índice / LEEME
  const leeme = [`OFERTA ${O.id} · ${O.nombre}`, `${O.comprador}${O.cierre ? " · cierra " + O.cierre : ""}`, `${E.razon_social} · ${E.rut} · ${E.email} · ${E.telefono}`, "",
    `PRECIO APROBADO: neto ${clp(O.ventaNeta)} · IVA ${clp(O.iva)} · total ${clp(O.ventaTotal)} · ${O.lineas.map((l) => `${l.nombre}: ${clp(l.unitNeto)} × ${l.cantidad}`).join(" · ")}`, `Aprobado por ${op.por || "la empresa"} el ${hoy}.`, "",
    "CONDICIONES: plazo " + (O.plazo || "PENDIENTE") + " · garantía " + (O.garantia || "PENDIENTE") + " · vigencia " + O.vigencia, R.proveedor ? "ORIGEN: " + R.proveedor : "", R.traslado ? "TRASLADO: " + R.traslado : "", "",
    "ARCHIVOS", ...archivos.map((f) => ` - ${f.nombre}`), "",
    `FIRMADOS con la firma registrada (${firmados.length}): ${firmados.join(" · ") || "ninguno"}`, `PARA REVISIÓN Y FIRMA DEL REPRESENTANTE (${revision.length}): ${revision.join(" · ") || "ninguno"}`, "",
    "PENDIENTES DE ACREDITAR (los anexos los marcan como PENDIENTE):", ...pendientes.map((p) => ` ? ${p}`), "",
    "PRESENTACIÓN: manual en Mercado Público. Subir cada archivo en su sección, transcribir el valor NETO aprobado, declarar y enviar lo hace el representante. Una firma escaneada no es firma electrónica avanzada."].join("\n");
  const zip = zipStore([...archivos.map((f) => ({ name: f.nombre, data: f.data })), { name: `LEEME_${O.id}_PJANIC.txt`, data: Buffer.from(leeme, "utf8") }]);
  await store.set(`licauto/${t.codigo}/firmado.zip`, zip);
  const res = { t: ctx.ahora(), por: op.por || null, zip: `Oferta_${O.id}_${seguro((E.nombre_corto || "PJANIC").replace(/\s+S\.?p\.?A\.?$/i, ""))}.zip`, zip_kb: Math.round(zip.length / 1024), archivos: archivos.map((f) => f.nombre), firmados, revision, declarados, pendientes, con_firma: !!firmaImg, fuente: O.fuente, condiciones: { plazo: O.plazo || "", garantia: O.garantia || "", vigencia: O.vigencia }, respuestas: R,
    precio: { ventaNeta: O.ventaNeta, iva: O.iva, ventaTotal: O.ventaTotal, lineas: O.lineas.map((l) => ({ nombre: l.nombre, cantidad: l.cantidad, unitNeto: l.unitNeto })) } };
  t.firmado = res; return res;
}

// dato del perfil que corresponde a un campo típico de un anexo; si no hay dato acreditado, PENDIENTE
export function datoPara(campo, E, O, domicilio, R = {}, n = null) {
  const c = String(campo || "").toLowerCase(); if (n != null && R[`campo:${n}:${campo}`]) return R[`campo:${n}:${campo}`];
  if (/recinto|almacen|bodega/.test(c) && R.recinto) return R.recinto; if (/equipo|veh[ií]culo|flota/.test(c) && R.equipos) return R.equipos; if (/traslado|transporte|log[ií]st/.test(c) && R.traslado) return R.traslado; if (/proveedor|origen/.test(c) && R.proveedor) return R.proveedor;
  if (/raz[oó]n social|nombre.*(oferente|empresa|proveedor)/.test(c)) return E.razon_social;
  if (/fantas/.test(c)) return E.nombre_corto || "";
  if (/rut.*(representante|legal)|representante.*rut/.test(c)) return E.rut_representante;
  if (/\brut\b/.test(c)) return E.rut;
  if (/representante/.test(c)) return E.representante;
  if (/giro/.test(c)) return E.giro || "PENDIENTE · verificar con el SII";
  if (/domicilio|direcci/.test(c)) return domicilio;
  if (/comuna/.test(c)) return E.comuna || ""; if (/ciudad/.test(c)) return E.ciudad || ""; if (/regi[oó]n/.test(c)) return E.region || "";
  if (/correo|e-?mail/.test(c)) return E.email; if (/tel[eé]fono|fono|celular/.test(c)) return E.telefono; if (/fax/.test(c)) return E.fax || "no aplica";
  if (/banco|cuenta/.test(c)) return E.banco || "PENDIENTE · banco, tipo y número de cuenta";
  if (/plazo/.test(c)) return O.plazo || "PENDIENTE · confirmar plazo"; if (/garant/.test(c)) return O.garantia || "PENDIENTE · confirmar garantía"; if (/vigencia|validez/.test(c)) return O.vigencia;
  if (/precio|monto|total|valor/.test(c)) return `neto ${clp(O.ventaNeta)} · con IVA ${clp(O.ventaTotal)}`;
  if (/licitaci|id\b|proceso/.test(c)) return O.id; if (/fecha/.test(c)) return fechaCL(); if (/personer|facultad/.test(c)) return E.facultades_ok ? "acreditada" : "PENDIENTE · confirmar personería";
  if (/socio|accionista|beneficiario/.test(c)) return E.accionista || "PENDIENTE";
  if (/contacto|encargado|nombre/.test(c)) return `${E.contacto_comercial || E.representante} · ${E.email} · ${E.telefono}`;
  if (/cargo/.test(c)) return E.representante_cargo || "Representante legal"; if (/actividad|rubro/.test(c)) return E.actividad || ""; if (/constituci/.test(c)) return E.constitucion || "PENDIENTE";
  return "PENDIENTE · completar";
}
