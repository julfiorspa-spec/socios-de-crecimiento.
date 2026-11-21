// 🤖 LICITADOR AUTOMÁTICO · hace solo lo que hoy se hace a mano con una licitación:
//   1 LEER (ficha oficial de Mercado Público + bases/anexos con Claude) → 2 BUSCAR (productos y precios REALES: Mercado Libre
//   API, compras propias confirmadas, facturas SII) → 3 CALCULAR y DECIDIR (licitador.mjs: 🔥 🟢 🟡 🔴) → 4 OFERTAR (elige
//   producto y precio que cumplen) → 5 PREPARAR (ficha técnica con foto, oferta económica PDF+XLSX, mapa de anexos, pacto de
//   integridad, informe interno) → 6 ENTREGAR (ZIP para revisión, aprobación y firma autorizada).
// Nunca inventa precios, stock ni cumplimiento: cada dato lleva fuente, fecha y estado de evidencia; lo que no está, queda pendiente.
// Puro respecto del almacenamiento: recibe `ctx` con store y helpers (lo arma robot.mjs o la función en segundo plano).
import { decidir, elegir, fijarPrecios, planDocumentos, PARAMS_LIC, EMPRESA_BASE, clp } from "./licitador.mjs";
import { parecido } from "./evaluador.mjs";
import { pdf } from "./pdfmin.mjs";
import { xlsx, zipStore, zipLeer } from "./xlsxmin.mjs";

const R0 = (v) => Math.round(Number(v) || 0);
const PASOS = ["leer", "buscar", "decidir", "preparar"];
const MODELO = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const fechaCL = (iso) => { const d = new Date(iso || Date.now()); return d.toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); };

// ---------- IA (Claude) con documentos; en pruebas ctx.ia se reemplaza por un simulador ----------
export async function iaClaude({ prompt, docs = [], maxTok = 4000, ms = 110000, sistema }) {
  const key = process.env.ANTHROPIC_API_KEY || ""; if (!key) throw new Error("Falta ANTHROPIC_API_KEY en Netlify");
  const content = [];
  for (const d of docs) {
    if (d.tipo === "pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: d.data.toString("base64") }, title: d.nombre, cache_control: undefined });
    else if (d.tipo === "imagen") content.push({ type: "image", source: { type: "base64", media_type: d.mime || "image/jpeg", data: d.data.toString("base64") } });
    else if (d.tipo === "texto") content.push({ type: "text", text: `<documento nombre="${d.nombre}">\n${d.texto.slice(0, 120000)}\n</documento>` });
  }
  content.push({ type: "text", text: prompt });
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO(), max_tokens: maxTok, ...(sistema ? { system: sistema } : {}), messages: [{ role: "user", content }] }), signal: AbortSignal.timeout(ms) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Claude " + r.status + ": " + String(j?.error?.message || "").slice(0, 200));
  return (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}
export function extraerJSON(txt) {
  const s = String(txt || ""); const i = s.indexOf("{"); if (i < 0) throw new Error("La IA no devolvió JSON");
  const k = s.lastIndexOf("}"); const cuerpo = k > i ? s.slice(i, k + 1) : s.slice(i);
  try { return JSON.parse(cuerpo); } catch {}
  try { return JSON.parse(cuerpo.replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, '"')); } catch {}
  const r = repararJSON(s.slice(i)); if (r) return r;
  throw new Error("La IA devolvió un JSON incompleto (respuesta cortada)");
}
// JSON cortado a mitad (la IA se quedó sin espacio): se corta en el último valor completo y se cierran las llaves/corchetes abiertos.
export function repararJSON(s) {
  const cortes = []; let str = false, esc = false, pila = [];
  for (let n = 0; n < s.length; n++) { const c = s[n];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') { str = false; cortes.push({ n: n + 1, pila: pila.slice() }); } continue; }
    if (c === '"') str = true; else if (c === "{" || c === "[") pila.push(c); else if (c === "}" || c === "]") { pila.pop(); cortes.push({ n: n + 1, pila: pila.slice() }); } else if (/[0-9el]/.test(c) && !/[0-9.eE+\-a-z]/.test(s[n + 1] || " ")) cortes.push({ n: n + 1, pila: pila.slice() }); }
  for (let q = cortes.length - 1, intentos = 0; q >= 0 && intentos < 400; q--, intentos++) { const { n, pila: p } = cortes[q]; if (!p.length) continue;
    let pre = s.slice(0, n).replace(/,\s*$/, ""); if (/:\s*$/.test(pre)) continue;
    const cierre = p.slice().reverse().map((c) => (c === "{" ? "}" : "]")).join("");
    try { const j = JSON.parse(pre.replace(/,\s*([}\]])/g, "$1") + cierre); if (j && typeof j === "object") { j._reparado = true; return j; } } catch {} }
  return null;
}

// ---------- documentos: ZIP del portal, anexos subidos; DOCX/XLSX → texto; PDF/imagen → bloques ----------
const ext = (n) => String(n || "").toLowerCase().split(".").pop();
const xmlTexto = (x) => String(x).replace(/<\/w:p>|<\/p>|<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
export function docxTexto(buf) { const f = zipLeer(buf).find((x) => x.name === "word/document.xml"); return f?.data ? xmlTexto(f.data.toString("utf8")) : ""; }
export function xlsxTexto(buf) { const fs = zipLeer(buf); const ss = fs.find((x) => x.name === "xl/sharedStrings.xml"); const strings = ss?.data ? [...ss.data.toString("utf8").matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]) : [];
  const hojas = fs.filter((x) => /^xl\/worksheets\/sheet\d+\.xml$/.test(x.name)); const out = [];
  for (const h of hojas) { const x = h.data?.toString("utf8") || ""; const filas = [...x.matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map((r) => [...r[1].matchAll(/<c([^>]*)>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)/g)].map((c) => /t="s"/.test(c[1]) ? strings[+c[2]] ?? "" : c[2] ?? c[3] ?? "").join(" | ")); out.push(filas.join("\n")); }
  return out.join("\n\n").slice(0, 60000); }
export function expandirDocs(archivos, nivel = 0) {   // [{nombre, data, mime}] → documentos legibles (abre ZIP un nivel)
  const out = [];
  for (const a of archivos || []) { if (!a?.data?.length) continue; const e = ext(a.nombre);
    if (e === "zip" || (a.data[0] === 0x50 && a.data[1] === 0x4b && !["docx", "xlsx", "pptx"].includes(e))) { if (nivel < 2) for (const f of zipLeer(a.data)) if (f.data) out.push(...expandirDocs([{ nombre: f.name.split("/").pop(), data: f.data }], nivel + 1)); continue; }
    if (e === "pdf" || a.data.subarray(0, 4).toString() === "%PDF") out.push({ nombre: a.nombre, tipo: "pdf", data: a.data, kb: Math.round(a.data.length / 1024) });
    else if (e === "docx") { const t = docxTexto(a.data); if (t) out.push({ nombre: a.nombre, tipo: "texto", texto: t, kb: Math.round(a.data.length / 1024), original: a.data }); }
    else if (e === "xlsx") { const t = xlsxTexto(a.data); if (t) out.push({ nombre: a.nombre, tipo: "texto", texto: t, kb: Math.round(a.data.length / 1024), original: a.data }); }
    else if (["jpg", "jpeg", "png", "webp", "gif"].includes(e)) out.push({ nombre: a.nombre, tipo: "imagen", mime: e === "jpg" ? "image/jpeg" : "image/" + e, data: a.data, kb: Math.round(a.data.length / 1024) });
    else if (["txt", "md", "csv"].includes(e)) out.push({ nombre: a.nombre, tipo: "texto", texto: a.data.toString("utf8").slice(0, 60000), kb: Math.round(a.data.length / 1024) });
    else if (["doc", "xls", "rar", "7z"].includes(e)) out.push({ nombre: a.nombre, tipo: "no_legible", kb: Math.round(a.data.length / 1024), original: a.data });
  }
  return out;
}
const prioridadDoc = (n) => { const s = String(n).toLowerCase(); return /bases?\b|administrativ|t[eé]cnic|especificac|ett|eett|requerim|t[eé]rminos de referencia|\bttr\b/.test(s) ? 0 : /anexo|formulario|declaraci|pacto/.test(s) ? 1 : 2; };

async function reunirDocs(ctx, t) {
  const { store } = ctx; const archivos = [];
  const z = await store.get("lic/" + t.codigo, { type: "arrayBuffer" }).catch(() => null); if (z) archivos.push({ nombre: "portal.zip", data: Buffer.from(z) });
  for (const d of (t.lic_docs || []).filter((x) => x.tipo === "anexo" || x.tipo === "bases")) { const b = await store.get(`doc/${t.codigo}/${d.id}`, { type: "arrayBuffer" }).catch(() => null); if (b) archivos.push({ nombre: d.nombre || d.id, data: Buffer.from(b), mime: d.mime }); }
  const docs = expandirDocs(archivos).sort((a, b) => prioridadDoc(a.nombre) - prioridadDoc(b.nombre) || (b.kb || 0) - (a.kb || 0));
  return docs;
}

// ---------- 1 · LEER ----------
const PROMPT_LEER = (t, ficha) => `Eres el licitador experto de un proveedor chileno del Estado. Lee TODOS los documentos adjuntos de la licitación ${t.codigo}${t.nombre ? " «" + t.nombre + "»" : ""}${ficha ? " (ficha oficial de Mercado Público abajo)" : ""} y devuelve SOLO un JSON (sin comentarios) con esta forma exacta:
{"resumen":"qué compra el organismo, en 2-3 frases concretas",
 "comprador":"", "cierre":"AAAA-MM-DDTHH:MM" , "presupuesto":123456 o null, "presupuesto_con_iva":true|false|null, "presupuesto_cita":"doc p.X: texto literal",
 "adjudicacion_parcial":true|false|null, "plazo_entrega_dias":N o null, "direccion_entrega":"", "pago_dias":N o null,
 "items":[{"id":"I1","nombre":"nombre comercial claro del producto/servicio","cantidad":N,"unidad":"","descripcion":"lo que dicen las bases de este ítem","precio_max_unit_neto":null,
   "requisitos":[{"id":"snake_case","label":"qué se exige","obligatorio":true|false,"comparador":"eq|gte|lte|includes|boolean","esperado":valor,"cita":{"doc":"nombre del archivo","pagina":N,"texto":"frase literal ≤ 25 palabras"}}],
   "consultas_busqueda":["3 búsquedas cortas en español para encontrar este producto en tiendas chilenas"]}],
 "garantias":{"seriedad_pct":null,"seriedad_monto":null,"fiel_pct":null,"fiel_monto":null,"vigencia":""},
 "criterios":[{"nombre":"","peso":"","como_ganar":""}],
 "documentos":[{"nombre":"Anexo N° / formulario","obligatorio":true|false,"firma":true|false,"quien":"representante legal|persona natural","que_contiene":"","campos":["campos que hay que llenar"]}],
 "pacto_integridad":{"existe":true|false,"doc":"","pagina":N,"texto":"texto completo del pacto si está, si no vacío"},
 "multas":"", "riesgos":["riesgos concretos para el proveedor"], "preguntas_foro":["dudas que conviene preguntar"], "fechas":{"foro":"","respuestas":"","apertura":"","adjudicacion":"","visita":""},
 "fuentes":[{"doc":"","que_es":"bases administrativas|bases técnicas|anexo|otro","paginas":N}]}
Reglas: NO inventes. Si un dato no está en los documentos, pon null o "". Los requisitos deben salir de las bases/especificaciones técnicas con su cita; "obligatorio" solo si las bases dicen que su incumplimiento deja fuera la oferta (excluyente, mínimo, deberá, debe). Precios y montos en pesos chilenos sin puntos. Si el presupuesto dice "impuestos incluidos" presupuesto_con_iva=true; si dice neto o "más IVA" false; si no lo dice null. Un ítem por línea de producto exigida (máximo 30).
${ficha ? "\nFICHA OFICIAL (API Mercado Público): " + JSON.stringify(ficha).slice(0, 6000) : ""}`;

async function pasoLeer(ctx, t) {
  const { store } = ctx; const a = t.auto;
  let ficha = null; try { ficha = ctx.mpDetalle ? await ctx.mpDetalle(t.codigo) : null; } catch (e) { a.avisos = [...(a.avisos || []), "Ficha MP: " + String(e.message || e).slice(0, 120)]; }
  const docs = await reunirDocs(ctx, t);
  const legibles = docs.filter((d) => d.tipo !== "no_legible");
  const firma = legibles.map((d) => d.nombre + ":" + d.kb).join("|") + "#" + (ficha ? ficha.items?.length : 0);
  const prev = await store.get(`licauto/${t.codigo}/bases`, { type: "json" }).catch(() => null);
  let L;
  if (prev?.firma === firma && prev.lic && !a.forzar_lectura) L = prev.lic;
  else if (!legibles.length && !ficha) throw new Error("Sin fuentes para leer: no hay ficha de Mercado Público (MP_TICKET) ni bases subidas. Sube el ZIP de las bases.");
  else {
    // tamaño para Claude: PDFs hasta ~18 MB en total, 6 archivos; el resto se lista como no leído
    let presup = 18e6; const enviar = [], noLeidos = [];
    for (const d of legibles) { const peso = d.tipo === "pdf" ? d.data.length : d.tipo === "imagen" ? d.data.length : d.texto.length; if (enviar.length < 6 && peso <= presup) { enviar.push(d); presup -= peso; } else noLeidos.push(d.nombre); }
    let j; try { const txt = await ctx.ia({ prompt: PROMPT_LEER(t, ficha), docs: enviar, maxTok: 16000, ms: 170000 }); j = extraerJSON(txt); }
    catch (e1) {   // JSON cortado o inválido: segundo intento pidiendo la respuesta compacta
      a.avisos = [...new Set([...(a.avisos || []), "Lectura: primer intento devolvió JSON incompleto; se repitió en modo compacto."])];
      const txt2 = await ctx.ia({ prompt: PROMPT_LEER(t, ficha) + "\n\nIMPORTANTE: responde SOLO el JSON, compacto (sin saltos de línea decorativos), citas de máximo 120 caracteres, máximo 5 riesgos, 5 preguntas del foro y 12 requisitos por ítem. No cortes la respuesta.", docs: enviar, maxTok: 16000, ms: 170000 });
      j = extraerJSON(txt2); }
    if (j._reparado) { a.avisos = [...new Set([...(a.avisos || []), "Lectura: la respuesta de la IA venía cortada; se recuperó la parte completa. Revisa documentos y garantías."])]; delete j._reparado; }
    L = normalizarLic(t, j, ficha, enviar.map((d) => d.nombre), noLeidos.concat(docs.filter((d) => d.tipo === "no_legible").map((d) => d.nombre + " (formato no legible)")));
    await store.setJSON(`licauto/${t.codigo}/bases`, { t: ctx.ahora(), firma, lic: L, ficha, crudo: j });
  }
  delete a.forzar_lectura; a.lic = L; a.fuentes_lectura = { docs: legibles.map((d) => ({ nombre: d.nombre, tipo: d.tipo, kb: d.kb })), ficha: !!ficha, t: ctx.ahora() };
  if (!legibles.length) a.avisos = [...new Set([...(a.avisos || []), "Bases no leídas: solo la ficha oficial. Sube el ZIP de las bases para leer requisitos, anexos y garantías."])];
  return { items: L.items.length, requisitos: L.items.reduce((s, i) => s + (i.requisitos || []).length, 0), docs: legibles.length };
}
function normalizarLic(t, j, ficha, leidos, noLeidos) {
  const num = (v) => (v == null || v === "" ? null : (Number(String(v).replace(/[^\d.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "")) || null));
  const items = (Array.isArray(j.items) && j.items.length ? j.items : (ficha?.items || []).map((i, k) => ({ id: "I" + (k + 1), nombre: i.producto, cantidad: i.cantidad, unidad: i.unidad, descripcion: i.descripcion, requisitos: [] }))).slice(0, 30).map((it, k) => ({
    id: String(it.id || "I" + (k + 1)).replace(/[^A-Za-z0-9_]/g, "").slice(0, 12) || "I" + (k + 1), nombre: String(it.nombre || "Ítem " + (k + 1)).slice(0, 200), cantidad: Math.max(1, R0(it.cantidad) || 1), unidad: String(it.unidad || "unidad").slice(0, 30),
    descripcion: String(it.descripcion || "").slice(0, 1200), precio_max_unit_neto: num(it.precio_max_unit_neto),
    requisitos: (Array.isArray(it.requisitos) ? it.requisitos : []).slice(0, 25).map((r, q) => ({ id: String(r.id || "r" + (q + 1)).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40), label: String(r.label || r.id || "").slice(0, 200), obligatorio: !!r.obligatorio, comparador: ["eq", "gte", "lte", "includes", "boolean"].includes(r.comparador) ? r.comparador : "includes", esperado: r.esperado ?? "", cita: r.cita ? { doc: String(r.cita.doc || "").slice(0, 120), pagina: r.cita.pagina ?? null, texto: String(r.cita.texto || "").slice(0, 300) } : null })),
    consultas: (Array.isArray(it.consultas_busqueda) ? it.consultas_busqueda : []).slice(0, 3).map((s) => String(s).slice(0, 80)).filter(Boolean) }));
  const presup = num(j.presupuesto) ?? (ficha?.monto != null ? R0(ficha.monto) : null);
  return { id: t.codigo, nombre: t.nombre || ficha?.nombre || j.resumen?.slice(0, 120) || t.codigo, comprador: j.comprador || ficha?.organismo || t.organismo || "", cierre: j.cierre || ficha?.cierre || null, publicacion: ficha?.publicacion || null,
    presupuesto: presup, presupuesto_con_iva: j.presupuesto_con_iva === true ? true : j.presupuesto_con_iva === false ? false : null, presupuesto_cita: j.presupuesto_cita || (presup != null && j.presupuesto == null ? "monto estimado de la ficha oficial de Mercado Público" : ""), iva: 0.19,
    adjudicacion_parcial: j.adjudicacion_parcial === true, plazo_entrega_dias: num(j.plazo_entrega_dias), direccion_entrega: j.direccion_entrega || ficha?.direccionEntrega || "", pago_dias: num(j.pago_dias) ?? (ficha?.plazoPagoDias != null ? num(ficha.plazoPagoDias) : null), region: ficha?.region || "", comuna: ficha?.comuna || "",
    items, garantias: { seriedad_pct: num(j.garantias?.seriedad_pct), seriedad_monto: num(j.garantias?.seriedad_monto), fiel_pct: num(j.garantias?.fiel_pct), fiel_monto: num(j.garantias?.fiel_monto), vigencia: String(j.garantias?.vigencia || "").slice(0, 120) },
    criterios: (Array.isArray(j.criterios) ? j.criterios : []).slice(0, 12).map((c) => ({ nombre: String(c.nombre || "").slice(0, 120), peso: String(c.peso || "").slice(0, 20), como_ganar: String(c.como_ganar || "").slice(0, 240) })),
    documentos: (Array.isArray(j.documentos) ? j.documentos : []).slice(0, 25).map((d) => ({ nombre: String(d.nombre || "").slice(0, 120), obligatorio: !!d.obligatorio, firma: !!d.firma, quien: String(d.quien || "").slice(0, 60), que_contiene: String(d.que_contiene || "").slice(0, 240), campos: (Array.isArray(d.campos) ? d.campos : []).slice(0, 20).map((c) => String(c).slice(0, 80)), estado: "pendiente" })),
    pacto_integridad: j.pacto_integridad && typeof j.pacto_integridad === "object" ? { existe: !!j.pacto_integridad.existe, doc: String(j.pacto_integridad.doc || "").slice(0, 120), pagina: j.pacto_integridad.pagina ?? null, texto: String(j.pacto_integridad.texto || "").slice(0, 6000) } : { existe: false, texto: "" },
    multas: String(j.multas || "").slice(0, 600), riesgos: (Array.isArray(j.riesgos) ? j.riesgos : []).slice(0, 10).map((r) => String(r).slice(0, 240)), preguntas_foro: (Array.isArray(j.preguntas_foro) ? j.preguntas_foro : []).slice(0, 8).map((r) => String(r).slice(0, 240)),
    fechas: j.fechas && typeof j.fechas === "object" ? Object.fromEntries(Object.entries(j.fechas).slice(0, 8).map(([k, v]) => [k, String(v || "").slice(0, 40)])) : {}, resumen: String(j.resumen || "").slice(0, 900),
    fuentes: (Array.isArray(j.fuentes) ? j.fuentes : []).slice(0, 12).map((f) => ({ doc: String(f.doc || "").slice(0, 120), que_es: String(f.que_es || "").slice(0, 40), paginas: f.paginas ?? null })), leidos, no_leidos: noLeidos, bases_leidas: leidos.length > 0, url: `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(t.codigo)}` };
}

// ---------- 2 · BUSCAR (fuentes reales) ----------
async function buscarML(ctx, q, n = 8) {
  const tok = ctx.mlToken ? await ctx.mlToken().catch(() => null) : null; if (!tok) return { error: "Mercado Libre no conectado (⚙ ml-config)", lista: [] };
  const r = await fetch("https://api.mercadolibre.com/sites/MLC/search?" + new URLSearchParams({ q, limit: String(n), sort: "price_asc" }), { headers: { authorization: "Bearer " + tok, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return { error: "ML " + r.status, lista: [] };
  const j = await r.json(); const t0 = ctx.ahora();
  return { lista: (j.results || []).filter((x) => x.available_quantity !== 0 && x.currency_id === "CLP").map((x) => ({ id: x.id, titulo: x.title, url: x.permalink, foto: String(x.thumbnail || "").replace(/-I\.(jpg|webp|png)$/i, "-O.$1").replace(/^http:/, "https:"), precio_iva: R0(x.price), disponible: x.available_quantity, vendedor: x.seller?.nickname || null, envio_gratis: !!x.shipping?.free_shipping, condicion: x.condition,
    atributos: Object.fromEntries((x.attributes || []).filter((a) => a.value_name).slice(0, 20).map((a) => [a.id, a.value_name])), consultado: t0, fuente: "mercadolibre.cl" })) };
}
const PROMPT_JUICIO = (lic, it, cands) => `Eres el jefe técnico de un proveedor del Estado de Chile. Licitación ${lic.id} «${lic.nombre}». Ítem «${it.nombre}» × ${it.cantidad} ${it.unidad}. Descripción en bases: ${it.descripcion || "(sin más detalle)"}.
REQUISITOS (de las bases): ${JSON.stringify(it.requisitos.map((r) => ({ id: r.id, exige: r.label, esperado: r.esperado, obligatorio: r.obligatorio })))}
CANDIDATOS encontrados en fuentes reales (título, atributos publicados, precio): ${JSON.stringify(cands.map((c) => ({ k: c.k, titulo: c.producto.nombre, atributos: c.producto.atributos, descripcion: c.producto.descripcion || "", precio_neto: c.cotizacion.unitNeto, origen: c.cotizacion.evidencia?.estado })))}
Devuelve SOLO JSON: {"juicios":{"<k>":{"es_el_producto":true|false,"nota":"por qué sirve o no (≤ 20 palabras)","req":{"<reqId>":{"cumple":true|false|null,"nota":"dato literal del candidato que lo prueba, o 'sin dato'"}}}}}
Reglas estrictas: "cumple":true SOLO si el título/atributos/descripción del candidato lo dicen explícitamente; false si lo contradicen; null si no hay dato (NUNCA supongas). "es_el_producto":false si el candidato es un accesorio, repuesto, otra cantidad por pack, otro tamaño o claramente otro producto.`;

async function pasoBuscar(ctx, t) {
  const { store } = ctx; const a = t.auto; const L = a.lic; if (!L) throw new Error("Primero hay que leer la licitación");
  const emp = t.empresa || "principal"; let hist = null; try { hist = ctx.contextoEval ? await ctx.contextoEval(emp, false) : null; } catch {}
  const LE = ctx.empresas ? await ctx.empresas().catch(() => ({})) : {}; const rutE = String(LE?.[emp]?.rut || "78493114-5").replace(/\./g, "").toUpperCase();
  const cat = await store.get("catalogo/" + rutE, { type: "json" }).catch(() => null); const catItems = Object.values(cat?.items || {});
  const candidatos = {}, fuentes = { ml: 0, propias: 0, catalogo: 0, errores: [] }; let k = 0;
  for (const it of L.items.slice(0, 15)) {
    const lista = []; const vistos = new Set();
    const consultas = (it.consultas?.length ? it.consultas : [it.nombre]).slice(0, 3);
    for (const q of consultas) { const r = await buscarML(ctx, q, 8); if (r.error) { if (!fuentes.errores.includes(r.error)) fuentes.errores.push(r.error); break; }
      for (const x of r.lista) { if (vistos.has(x.id)) continue; vistos.add(x.id); fuentes.ml++;
        lista.push({ k: "c" + (++k), producto: { id: x.id, nombre: x.titulo, marca: x.atributos.BRAND || null, modelo: x.atributos.MODEL || null, atributos: x.atributos, foto: x.foto, url: x.url, evidencia: [{ fuente: x.url, consultado: x.consultado, estado: "publicado" }] },
          cotizacion: { id: x.id, proveedor: x.vendedor || "vendedor Mercado Libre", productoId: x.id, unitNeto: R0(x.precio_iva / 1.19), precioIVA: x.precio_iva, fleteNeto: x.envio_gratis ? 0 : null, stock: x.disponible > 0 ? "publicado" : "falta", cantidadDisponible: x.disponible, plazoDias: null, condicion: x.condicion, evidencia: { fuente: x.url, consultado: x.consultado, estado: "publicado", detalle: "precio publicado con IVA " + clp(x.precio_iva) + (x.envio_gratis ? " · envío gratis" : "") } } }); } }
    // compras propias confirmadas / facturas SII (precio verificado; stock por confirmar)
    for (const h of (hist?.hist_lineas || [])) { const p = parecido(h.nombre, it.nombre); if (p < 0.6 || !(h.neto_unit > 0)) continue; fuentes.propias++;
      lista.push({ k: "c" + (++k), producto: { id: "h" + k, nombre: h.nombre, atributos: {}, evidencia: [{ fuente: h.origen || "compra anterior", consultado: h.fecha, estado: "verificado" }] },
        cotizacion: { id: "h" + k, proveedor: h.proveedor || "proveedor anterior", productoId: "h" + k, unitNeto: R0(h.neto_unit), fleteNeto: null, stock: "falta", cantidadDisponible: null, plazoDias: null, evidencia: { fuente: h.origen || "compra anterior", consultado: h.fecha, estado: "verificado", detalle: "precio pagado por nosotros (" + (h.origen || "histórico") + ", " + String(h.fecha || "").slice(0, 10) + ")" } } }); if (lista.length > 14) break; }
    for (const c of catItems) { const p = parecido(c.nombre || c.descripcion, it.nombre); if (p < 0.6 || !(c.neto_unit > 0 || c.precio > 0)) continue; fuentes.catalogo++;
      lista.push({ k: "c" + (++k), producto: { id: "k" + k, nombre: c.nombre || c.descripcion, atributos: {}, evidencia: [{ fuente: "catálogo SII " + (c.folio ? "factura " + c.folio : ""), consultado: c.fecha, estado: "verificado" }] },
        cotizacion: { id: "k" + k, proveedor: c.proveedor || "proveedor del catálogo", productoId: "k" + k, unitNeto: R0(c.neto_unit || c.precio), fleteNeto: null, stock: "falta", cantidadDisponible: null, plazoDias: null, evidencia: { fuente: "catálogo SII", consultado: c.fecha, estado: "verificado", detalle: "precio de factura propia" } } }); if (lista.length > 16) break; }
    // juicio técnico de la IA sobre fuentes reales (solo si hay requisitos o varios candidatos)
    const cands = lista.slice(0, 10);
    if (cands.length && (it.requisitos.length || cands.length > 1)) {
      try { const j = extraerJSON(await ctx.ia({ prompt: PROMPT_JUICIO(L, it, cands), maxTok: 3000, ms: 60000 })).juicios || {};
        for (const c of cands) { const jc = j[c.k]; if (!jc) continue; c.es_el_producto = jc.es_el_producto !== false; c.nota = String(jc.nota || "").slice(0, 200);
          c.juicios = Object.fromEntries(Object.entries(jc.req || {}).filter(([rid]) => it.requisitos.some((r) => r.id === rid)).map(([rid, v]) => [rid, { cumple: v?.cumple === true ? true : v?.cumple === false ? false : null, nota: String(v?.nota || "").slice(0, 160), evidencia: v?.cumple == null ? "falta" : "publicado" }])); }
      } catch (e) { fuentes.errores.push("juicio IA: " + String(e.message || e).slice(0, 100)); }
    }
    candidatos[it.id] = cands.filter((c) => c.es_el_producto !== false).concat(cands.filter((c) => c.es_el_producto === false).map((c) => ({ ...c, descartado: true })));
  }
  await store.setJSON(`licauto/${t.codigo}/candidatos`, { t: ctx.ahora(), candidatos, fuentes });
  a.busqueda = { t: ctx.ahora(), fuentes, por_item: Object.fromEntries(Object.entries(candidatos).map(([id, l]) => [id, { n: l.filter((c) => !c.descartado).length, descartados: l.filter((c) => c.descartado).length }])) };
  return { candidatos: Object.values(candidatos).reduce((s, l) => s + l.length, 0), fuentes };
}

// ---------- 3 · CALCULAR + DECIDIR + OFERTAR ----------
function aplicarConfirmaciones(a, candidatos) {
  const C = a.confirmaciones || {};
  for (const [itemId, lista] of Object.entries(candidatos)) for (const c of lista) { const cf = C[itemId]?.[c.k] || C[itemId]?.[c.cotizacion?.id] || C[itemId]?.[c.producto?.id] || C[itemId]?.["*"]; if (!cf) continue;
    if (cf.stock === true) { c.cotizacion.stock = "verificado"; c.cotizacion.cantidadDisponible = cf.cantidad ?? c.cotizacion.cantidadDisponible ?? 999999; } if (cf.stock === false) c.cotizacion.stock = "falta";
    if (cf.flete != null) c.cotizacion.fleteNeto = R0(cf.flete); if (cf.plazoDias != null) c.cotizacion.plazoDias = R0(cf.plazoDias); if (cf.unitNeto != null) { c.cotizacion.unitNeto = R0(cf.unitNeto); c.cotizacion.evidencia = { ...(c.cotizacion.evidencia || {}), estado: "verificado", detalle: "precio confirmado por " + (cf.por || "el equipo") + " " + fechaCL(cf.t) }; }
    for (const [rid, v] of Object.entries(cf.cumple || {})) { c.juicios = c.juicios || {}; c.juicios[rid] = { cumple: v === true ? true : v === false ? false : null, nota: "confirmado por " + (cf.por || "el equipo"), evidencia: "verificado" }; }
    if (cf.elegir) c.forzado = true; if (cf.descartar) c.descartado = true; }
}
async function pasoDecidir(ctx, t) {
  const { store } = ctx; const a = t.auto; const L = a.lic; if (!L) throw new Error("Primero hay que leer la licitación");
  const CJ = (await store.get(`licauto/${t.codigo}/candidatos`, { type: "json" }).catch(() => null)) || { candidatos: {} };
  const candidatos = JSON.parse(JSON.stringify(CJ.candidatos || {})); aplicarConfirmaciones(a, candidatos);
  const usables = Object.fromEntries(Object.entries(candidatos).map(([id, l]) => { const f = l.find((c) => c.forzado && !c.descartado); return [id, f ? [f] : l.filter((c) => !c.descartado)]; }));
  const P = { ...PARAMS_LIC, ...(ctx.params || {}) }; const emp = await (ctx.empresaPerfil ? ctx.empresaPerfil(t.empresa || "principal") : Promise.resolve(EMPRESA_BASE)).catch(() => EMPRESA_BASE);
  L.supuestos = { ...(L.supuestos || {}), ...(a.supuestos || {}) };
  // documentos exigidos: listos si hay firma guardada y están marcados; por ahora pendientes (los llena el representante)
  for (const d of L.documentos || []) d.estado = a.documentos_ok?.[d.nombre] ? "listo" : "pendiente";
  const { seleccion, descartes } = elegir(L, usables);
  let desc = a.descuento != null ? a.descuento : null;
  if (desc == null && ctx.descuentoLic) { try { desc = await ctx.descuentoLic(L); } catch { desc = null; } }
  const precios = fijarPrecios(L, seleccion, P, desc == null ? undefined : desc);
  if (a.precios_manual) for (const s of seleccion) if (a.precios_manual[s.itemId] != null) s.precioVentaNeto = R0(a.precios_manual[s.itemId]);
  const dec = decidir(L, seleccion, P, emp, ctx.hoy || ctx.ahora().slice(0, 10));
  a.seleccion = seleccion.map((s) => ({ itemId: s.itemId, k: s.cotizacion.id, producto: { nombre: s.producto.nombre, marca: s.producto.marca || null, foto: s.producto.foto || null, url: s.producto.url || null, atributos: s.producto.atributos || {} }, cotizacion: { ...s.cotizacion }, juicios: s.juicios || {}, cantidad: s.cantidad, precioVentaNeto: s.precioVentaNeto, alternativas: s.alternativas || [] }));
  a.descartes = descartes.slice(0, 20); a.precios = { descuento: precios.descuento, modo: precios.modo, t: ctx.ahora() };
  a.decision = { estado: dec.estado, motivo: dec.motivo, etapa: dec.etapa, motivos: dec.motivos, bloqueos: dec.bloqueos.slice(0, 30), pendientes: dec.pendientes.slice(0, 40), numeros: dec.numeros, caja: dec.caja, cumplimiento: dec.cumplimiento.slice(0, 120), t: dec.t, empresa_ok: { facultades: !!emp.facultades_ok, integridad: !!emp.integridad_ok && !!emp.difusion_integridad_ok } };
  a.plan = planDocumentos(dec, L, emp); a.hist = [...(a.hist || []), { t: dec.t, estado: dec.estado, motivo: dec.motivo }].slice(-20);
  // ficha compatible con la mesa de juego existente (t.lic)
  const s0 = seleccion[0]; const F = dec.numeros;
  t.lic = { ...(t.lic || {}), presupuesto: L.presupuesto, con_iva: !!L.presupuesto_con_iva, descuento: precios.descuento ?? 0, precio_unit: s0 ? s0.precioVentaNeto : null, cantidad: s0 ? s0.cantidad : null, unidad: L.items[0]?.unidad || "", neto: F.ventaNeta, iva: F.iva, total: F.ventaTotal, cierre: L.cierre, resumen: L.resumen,
    producto: s0 ? s0.producto.nombre : L.items[0]?.nombre || L.nombre, items: L.items.map((i) => ({ descripcion: i.nombre, cantidad: i.cantidad, unidad: i.unidad })), lugar_entrega: L.direccion_entrega, plazo_entrega: L.plazo_entrega_dias ? L.plazo_entrega_dias + " días" : "",
    alertas: [...dec.bloqueos.map((x) => ({ nivel: "rojo", texto: x })), ...dec.pendientes.map((x) => ({ nivel: "amarillo", texto: x }))].slice(0, 15), documentos: (L.documentos || []).map((d) => ({ nombre: d.nombre, estado: d.estado, seccion: d.firma ? "firma representante" : "" })), criterios: (L.criterios || []).map((c) => ({ nombre: c.nombre, peso: c.peso, propuesta: c.como_ganar })), auto: true };
  return { estado: dec.estado, utilidad: F.utilidad, margen: F.margenPct, seleccionados: seleccion.length };
}

// ---------- 4 · PREPARAR documentos + 5 · ZIP ----------
async function foto(url) { try { if (!/^https:\/\//.test(url || "")) return null; const r = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: "image/jpeg" } }); if (!r.ok) return null; const b = Buffer.from(await r.arrayBuffer()); return b[0] === 0xff && b[1] === 0xd8 && b.length < 3e6 ? b : null; } catch { return null; } }
const SEM = { FUEGO: "🔥 MUCHA UTILIDAD", VERDE: "🟢 RENTABLE", AMARILLO: "🟡 REVISAR", ROJO: "🔴 DESCARTAR" };
const SEMT = { FUEGO: "FUEGO - mucha utilidad", VERDE: "VERDE - rentable", AMARILLO: "AMARILLO - revisar", ROJO: "ROJO - descartar" };
async function pasoPreparar(ctx, t) {
  const { store } = ctx; const a = t.auto; const L = a.lic, D = a.decision; if (!L || !D) throw new Error("Primero hay que decidir");
  const emp = await (ctx.empresaPerfil ? ctx.empresaPerfil(t.empresa || "principal") : Promise.resolve(EMPRESA_BASE)).catch(() => EMPRESA_BASE); const E = { ...EMPRESA_BASE, ...emp };
  const hoy = fechaCL(ctx.ahora()); const pie = `CotizÁgil · ${E.razon_social} · ${E.rut} · generado ${hoy} · BORRADOR para revisión y firma autorizada`; const cab = `Licitación ${L.id} · ${L.comprador}`; const F = D.numeros;
  const archivos = []; const guardar = async (nombre, data) => { archivos.push({ nombre, data }); await store.set(`licauto/${t.codigo}/doc/${nombre}`, data).catch(() => {}); };
  const sel = a.seleccion || []; const itemDe = (id) => L.items.find((i) => i.id === id) || {};
  // 1) Ficha técnica con foto y fuente
  { const d = pdf({ titulo: `Ficha técnica ${L.id}`, autor: E.razon_social, pie, cabecera: cab }).titulo("Ficha técnica de la oferta", `${L.nombre} · ${L.comprador} · ${sel.length} de ${L.items.length} ítems con producto real`);
    for (const s of sel) { const it = itemDe(s.itemId); d.h2(`Ítem ${it.nombre} · ${it.cantidad} ${it.unidad}`); d.h3(s.producto.nombre + (s.producto.marca ? " · " + s.producto.marca : ""));
      const jpg = await foto(s.producto.foto); if (jpg) d.imagen(jpg, { ancho: 200, alto: 160, pie: "Foto publicada por el proveedor (" + (s.cotizacion.evidencia?.fuente || "") + ")" });
      d.kv([["Proveedor", s.cotizacion.proveedor], ["Fuente", s.cotizacion.evidencia?.fuente], ["Consultado", fechaCL(s.cotizacion.evidencia?.consultado)], ["Evidencia", s.cotizacion.evidencia?.estado + (s.cotizacion.evidencia?.detalle ? " · " + s.cotizacion.evidencia.detalle : "")], ["Stock", s.cotizacion.stock + (s.cotizacion.cantidadDisponible != null ? " · " + s.cotizacion.cantidadDisponible + " u." : "")], ["Condición", { new: "nuevo", used: "usado" }[s.cotizacion.condicion] || s.cotizacion.condicion || ""], ["Descripción en bases", it.descripcion]]);
      const at = Object.entries(s.producto.atributos || {}); if (at.length) d.tabla(["Atributo publicado", "Valor"], at.slice(0, 25), { anchos: [200, 299] });
      const comp = (D.cumplimiento || []).filter((c) => c.itemId === s.itemId); if (comp.length) d.tabla(["Requisito de las bases", "Oblig.", "Resultado", "Nota / evidencia", "Cita"], comp.map((c) => { const r = (it.requisitos || []).find((x) => x.id === c.reqId) || {}; return [r.label || c.reqId, c.obligatorio ? "sí" : "no", c.cumple === true ? "CUMPLE" : c.cumple === false ? "NO CUMPLE" : "ACREDITAR", c.nota.replace(/^[^:]+:\s*/, ""), r.cita ? `${r.cita.doc || ""}${r.cita.pagina ? " p. " + r.cita.pagina : ""}` : ""]; }), { anchos: [150, 38, 62, 160, 89] }); }
    const sin = L.items.filter((i) => !sel.some((s) => s.itemId === i.id)); if (sin.length) { d.h2("Ítems sin producto con precio real"); d.lista(sin.map((i) => `${i.nombre} × ${i.cantidad}: no se encontró en las fuentes consultadas; no se oferta hasta tener cotización real.`)); }
    d.h2("Fuentes consultadas").nota(`Bases leídas: ${(L.leidos || []).join(", ") || "ninguna (solo ficha oficial)"}. Búsqueda: Mercado Libre Chile (API oficial), compras propias confirmadas y facturas SII. Nada de este documento está inventado: cada precio y atributo viene de la fuente indicada.`);
    await guardar(`${L.id}_Ficha_Tecnica.pdf`, d.build()); }
  // 2) Oferta económica PDF + XLSX
  { const filas = sel.map((s, i) => { const it = itemDe(s.itemId); return [String(i + 1), it.nombre, `${it.cantidad} ${it.unidad}`, clp(s.precioVentaNeto), clp(s.precioVentaNeto * s.cantidad)]; });
    const d = pdf({ titulo: `Oferta económica ${L.id}`, autor: E.razon_social, pie, cabecera: cab }).titulo("Oferta económica", `${L.nombre} · ${L.comprador}`).kv([["Oferente", E.razon_social], ["RUT", E.rut], ["Domicilio", E.direccion], ["Correo", E.email], ["Representante legal", `${E.representante || ""} · ${E.rut_representante || ""}`], ["Licitación", L.id], ["Validez de la oferta", `${PARAMS_LIC.validez_dias} días corridos desde el cierre`], ["Plazo de entrega", L.plazo_entrega_dias ? `${L.plazo_entrega_dias} días corridos desde la orden de compra` : "según bases"], ["Lugar de entrega", L.direccion_entrega]])
      .h2("Detalle").tabla(["#", "Producto", "Cantidad", "Precio unitario neto", "Total neto"], filas, { anchos: [24, 230, 70, 90, 85], der: [3, 4] })
      .kv([["Total neto", clp(F.ventaNeta)], ["IVA 19 %", clp(F.iva)], ["TOTAL CON IVA", clp(F.ventaTotal)], ["Presupuesto de las bases", L.presupuesto != null ? clp(L.presupuesto) + (L.presupuesto_con_iva ? " con IVA" : L.presupuesto_con_iva === false ? " neto" : " (no indica si incluye IVA)") : "no informado"]], { kw: 200 })
      .nota("Valores en pesos chilenos. Los precios unitarios son netos; el total incluye IVA. Este formulario se transcribe al formato oficial de la licitación (Anexo de oferta económica) y al portal; un error en el precio no se puede corregir después del cierre.").firma(`Firma y timbre · ${E.representante || "Representante legal"} · ${E.rut_representante || ""}`);
    await guardar(`${L.id}_Oferta_Economica.pdf`, d.build());
    const n = sel.length; const xf = [["Oferta económica " + L.id], [L.nombre + " · " + L.comprador], [], ["#", "Producto", "Cantidad", "Precio unitario neto", "Total neto", "Costo unitario neto", "Costo total", "Proveedor", "Fuente", "Evidencia"]];
    sel.forEach((s, i) => { const it = itemDe(s.itemId); xf.push([i + 1, it.nombre, it.cantidad, s.precioVentaNeto, { f: `C${i + 5}*D${i + 5}` }, s.cotizacion.unitNeto, { f: `C${i + 5}*F${i + 5}` }, s.cotizacion.proveedor, s.cotizacion.evidencia?.fuente || "", s.cotizacion.evidencia?.estado || ""]); });
    const r = 5 + n; xf.push([], ["Total neto", "", "", "", { f: `SUM(E5:E${4 + n})` }], ["IVA 19 %", "", "", "", { f: `ROUND(E${r + 1}*0.19,0)` }], ["Total con IVA", "", "", "", { f: `E${r + 1}+E${r + 2}` }], ["Compra total neta", "", "", "", { f: `SUM(G5:G${4 + n})` }], ["Flete", "", "", "", F.flete], ["Ejecución " + PARAMS_LIC.ejecucion_pct + " %", "", "", "", { f: `ROUND(E${r + 1}*${PARAMS_LIC.ejecucion_pct / 100},0)` }], ["Factoring " + PARAMS_LIC.factoring_pct + " %", "", "", "", { f: `ROUND(E${r + 1}*${PARAMS_LIC.factoring_pct / 100},0)` }], ["PPM " + PARAMS_LIC.ppm_pct + " %", "", "", "", { f: `ROUND(E${r + 1}*${PARAMS_LIC.ppm_pct / 100},0)` }], ["Utilidad", "", "", "", { f: `E${r + 1}-E${r + 4}-E${r + 5}-E${r + 6}-E${r + 7}-E${r + 8}` }], ["Margen %", "", "", "", { f: `IF(E${r + 1}=0,0,E${r + 9}/E${r + 1})` }]);
    await guardar(`${L.id}_Oferta_Economica.xlsx`, xlsx([{ nombre: "Oferta", filas: xf, anchos: [5, 44, 10, 18, 16, 18, 16, 24, 40, 12] }])); }
  // 3) Identificación del oferente + mapa de anexos
  { const d = pdf({ titulo: `Anexos ${L.id} · datos`, autor: E.razon_social, pie, cabecera: cab }).titulo("Identificación del oferente y mapa de anexos", "Cada campo oficial con el dato validado que corresponde; los anexos ORIGINALES van en la carpeta Anexos_Oficiales")
      .h2("Datos validados del oferente").kv([["Razón social", E.razon_social], ["RUT", E.rut], ["Giro", E.giro], ["Domicilio", [E.direccion, E.comuna, E.ciudad].filter(Boolean).join(", ")], ["Correo", E.email], ["Teléfono", E.telefono], ["Representante legal", E.representante], ["RUT representante", E.rut_representante], ["Facultades acreditadas", E.facultades_ok ? "sí (documento de personería en poder de la empresa)" : "NO acreditadas: adjuntar escritura / certificado de vigencia antes de firmar"], ["Programa de integridad", E.integridad_ok && E.difusion_integridad_ok ? "acreditado" : "NO acreditado: no declarar su cumplimiento"]])
      .h2("Documentos que exigen las bases");
    if ((L.documentos || []).length) d.tabla(["Documento", "Oblig.", "Firma", "Quién firma", "Qué contiene / campos", "Estado"], L.documentos.map((x) => [x.nombre, x.obligatorio ? "sí" : "no", x.firma ? "sí" : "no", x.quien, [x.que_contiene, (x.campos || []).join(", ")].filter(Boolean).join(" · "), x.estado === "listo" ? "listo" : "PENDIENTE"]), { anchos: [120, 36, 36, 70, 177, 60] }); else d.p("Las bases leídas no enumeran anexos, o no se leyeron las bases (solo ficha oficial). Revisar el portal.");
    d.h2("Mapa campo → dato").tabla(["Campo típico del anexo", "Dato a escribir"], [["Nombre o razón social del oferente", E.razon_social], ["RUT", E.rut], ["Domicilio", E.direccion], ["Nombre del representante legal", E.representante], ["RUT del representante", E.rut_representante], ["Correo electrónico", E.email], ["ID de la licitación", L.id], ["Nombre de la licitación", L.nombre], ["Precio total neto de la oferta", clp(F.ventaNeta)], ["Precio total con IVA", clp(F.ventaTotal)], ["Plazo de entrega ofertado", L.plazo_entrega_dias ? L.plazo_entrega_dias + " días corridos" : "según bases"], ["Validez de la oferta", PARAMS_LIC.validez_dias + " días"], ["Garantía ofrecida", "la que publica el fabricante/proveedor (ver ficha técnica); no prometer más"], ["Fecha", hoy.slice(0, 10)]], { anchos: [200, 299] })
      .nota("Las declaraciones juradas (inhabilidades, integridad, no deudas, etc.) las revisa y firma el representante legal. Nada se firma ni declara automáticamente.");
    await guardar(`${L.id}_Anexos_Datos.pdf`, d.build()); }
  // 4) Pacto de integridad
  { const d = pdf({ titulo: `Pacto de integridad ${L.id}`, autor: E.razon_social, pie, cabecera: cab }).titulo("Pacto de integridad", L.pacto_integridad?.existe ? `Texto tomado de ${L.pacto_integridad.doc || "las bases"}${L.pacto_integridad.pagina ? " p. " + L.pacto_integridad.pagina : ""}` : "Las bases leídas no traen el texto del pacto: usar el de las bases oficiales del portal");
    if (L.pacto_integridad?.existe && L.pacto_integridad.texto) d.p(L.pacto_integridad.texto); else d.p("El oferente declara conocer y aceptar el pacto de integridad de las bases de esta licitación (cláusula estándar de ChileCompra): no ofrecer ni conceder sobornos u otros beneficios indebidos; no incurrir en colusión ni acuerdos con otros oferentes; revisar y verificar toda la información de su oferta; ajustarse a la legislación vigente; y asumir que el incumplimiento acarrea la exclusión del proceso y la ejecución de garantías.").nota("Texto de referencia: debe reemplazarse por el pacto literal de las bases antes de firmar.");
    d.kv([["Oferente", E.razon_social + " · " + E.rut], ["Representante legal", (E.representante || "") + " · " + (E.rut_representante || "")], ["Licitación", L.id + " · " + L.nombre]]).firma(`Firma del representante legal · ${E.representante || ""}`);
    await guardar(`${L.id}_Pacto_Integridad.pdf`, d.build()); }
  // 5) Informe interno (no se adjunta)
  { const d = pdf({ titulo: `Informe interno ${L.id}`, autor: "CotizÁgil", pie: "USO INTERNO · no adjuntar a la oferta · " + pie, cabecera: cab }).titulo(`${SEMT[D.estado]} · ${L.id}`, D.motivo)
      .h2("Las seis preguntas").kv([["¿Qué compramos?", sel.map((s) => `${s.producto.nombre} × ${s.cantidad}`).join(" · ") || "nada aún: sin producto con precio real"], ["¿Dónde lo compramos?", sel.map((s) => `${s.cotizacion.proveedor} (${s.cotizacion.evidencia?.fuente || "fuente"})`).join(" · ")], ["¿Cuánto invertimos?", `${clp(F.cajaNecesaria)} (compra con IVA ${clp(F.compraTotal)} + flete ${clp(F.flete)}${F.garantiaSeriedad ? " + garantía seriedad " + clp(F.garantiaSeriedad) : ""})`], ["¿A cuánto vendemos?", `${clp(F.ventaNeta)} neto · ${clp(F.ventaTotal)} con IVA${a.precios?.descuento != null ? ` · ${Math.round(a.precios.descuento * 1000) / 10} % bajo el presupuesto` : ""} (${a.precios?.modo || ""})`], ["¿Cuánto ganamos?", `${clp(F.utilidad)} · margen ${F.margenPct} % (ejecución ${clp(F.ejecucion)}, factoring ${clp(F.factoring)}, PPM ${clp(F.ppm)} ya descontados)`], ["¿Cumple las bases?", D.bloqueos.length ? "NO: " + D.bloqueos.join(" · ") : D.pendientes.length ? "Falta acreditar: " + D.pendientes.slice(0, 6).join(" · ") : "Sí, con evidencia"]], { kw: 130 })
      .h2("Números").tabla(["Concepto", "Monto"], [["Venta neta", clp(F.ventaNeta)], ["IVA", clp(F.iva)], ["Venta total", clp(F.ventaTotal)], ["Compra neta", clp(F.compraNeta)], ["Flete", F.fleteFalta ? "SIN COTIZAR" : clp(F.flete)], ["Otros directos", clp(F.otros)], ["Ejecución (" + (F.ejecSup ? "supuesto" : "real") + ")", clp(F.ejecucion)], ["Factoring (" + (F.factSup ? "supuesto" : "real") + ")", clp(F.factoring)], ["Reserva PPM", clp(F.ppm)], ["UTILIDAD", clp(F.utilidad)], ["Margen", F.margenPct + " %"], ["Caja necesaria", clp(F.cajaNecesaria)], ["Costo máximo de equilibrio", clp(F.costoMaximo)]], { anchos: [300, 199], der: [1] });
    if (D.caja?.eventos?.length) d.h2("Caja por fecha").tabla(["Fecha", "Concepto", "Monto", "Acumulado"], D.caja.eventos.map((e) => [e.fecha, e.concepto, clp(e.monto), clp(e.acumulado)]), { anchos: [70, 249, 90, 90], der: [2, 3] }).nota(`Caja mínima necesaria ${clp(D.caja.necesaria)} · recupera el ${D.caja.recupera || "—"}`);
    if (D.bloqueos.length) d.h2("Bloqueos (impiden presentar)").lista(D.bloqueos); if (D.pendientes.length) d.h2("Pendientes (verificar antes de aprobar)").lista(D.pendientes);
    if ((a.descartes || []).length) d.h2("Candidatos descartados").lista(a.descartes.map((x) => `${x.producto}: ${x.motivo}`));
    if ((L.criterios || []).length) d.h2("Criterios de evaluación").tabla(["Criterio", "Peso", "Cómo ganar"], L.criterios.map((c) => [c.nombre, c.peso, c.como_ganar]), { anchos: [150, 60, 289] });
    if ((L.riesgos || []).length) d.h2("Riesgos").lista(L.riesgos); if (L.multas) d.p("Multas: " + L.multas); if ((L.preguntas_foro || []).length) d.h2("Preguntas para el foro").lista(L.preguntas_foro);
    d.h2("Plan de documentos").tabla(["Archivo", "Qué es", "Estado"], (a.plan || []).map((p) => [p.archivo, p.tipo, p.estado + (p.motivo ? " · " + p.motivo : "")]), { anchos: [170, 200, 129] });
    await guardar(`${L.id}_Informe_Interno.pdf`, d.build()); }
  // 6) anexos oficiales originales + LEEME
  const originales = []; try { const docs = await reunirDocs(ctx, t); let total = 0; for (const d of docs) { const data = d.original || d.data; if (!data || data.length > 4e6 || total + data.length > 22e6) continue; if (/anexo|formulario|declaraci|pacto|bases/i.test(d.nombre) || docs.length <= 8) { originales.push({ name: "Anexos_Oficiales/" + d.nombre.replace(/[\\/]/g, "_"), data }); total += data.length; } } } catch {}
  const leeme = [`LICITACIÓN ${L.id} · ${L.nombre}`, `${L.comprador} · cierra ${L.cierre || "?"}`, "", `DECISIÓN: ${SEMT[D.estado]} · ${D.motivo}`, `Preparado por CotizÁgil el ${hoy}. BORRADOR: nada de esta carpeta se presenta sin revisión, aprobación y firma autorizada del representante legal.`, "",
    "CONTENIDO", ...archivos.map((f) => ` - ${f.nombre}`), originales.length ? ` - Anexos_Oficiales/ (${originales.length} originales del portal para llenar y firmar)` : " - (sin anexos originales: súbelos desde el portal para incluirlos)", "",
    "ANTES DE FIRMAR", ...(D.bloqueos.length ? ["BLOQUEOS:", ...D.bloqueos.map((b) => " ✖ " + b)] : []), ...(D.pendientes.length ? ["PENDIENTES:", ...D.pendientes.map((b) => " ? " + b)] : []), ...(!D.bloqueos.length && !D.pendientes.length ? [" ✓ sin bloqueos ni pendientes"] : []), "",
    `APROBACIÓN: ${a.aprobacion ? `${a.aprobacion.usuario} el ${fechaCL(a.aprobacion.t)} · monto ${clp(a.aprobacion.monto)} · consentimiento para ingresar al portal: ${a.aprobacion.consentimiento_portal ? "SÍ" : "no"}` : "pendiente (botón Aprobar en CotizÁgil)"}`,
    "Firma: una firma escaneada no es firma electrónica avanzada. Los anexos se firman por el representante con facultades vigentes. CotizÁgil no ingresa ni envía ofertas al portal sin consentimiento explícito."].join("\n");
  const zip = zipStore([...archivos.map((f) => ({ name: f.nombre, data: f.data })), ...originales, { name: "LEEME.txt", data: Buffer.from(leeme, "utf8") }]);
  await store.set(`licauto/${t.codigo}/oferta.zip`, zip);
  a.docs = { t: ctx.ahora(), archivos: archivos.map((f) => ({ nombre: f.nombre, kb: Math.round(f.data.length / 1024) })), originales: originales.length, zip_kb: Math.round(zip.length / 1024) }; t.zip_auto = true;
  return { archivos: archivos.length, originales: originales.length, kb: a.docs.zip_kb };
}

// ---------- orquestación ----------
const CORRE = { leer: pasoLeer, buscar: pasoBuscar, decidir: pasoDecidir, preparar: pasoPreparar };
export function siguientePaso(a) { for (const p of PASOS) if (!a.pasos?.[p]?.ok) return p; return null; }
export async function correrPaso(ctx, t, paso) {
  const a = t.auto = t.auto || { v: 1, pasos: {}, creado: ctx.ahora() }; a.pasos = a.pasos || {};
  a.corriendo = ctx.ahora(); a.paso_actual = paso; a.error = null; await ctx.escribir(t);
  try { const r = await CORRE[paso](ctx, t); a.pasos[paso] = { ok: true, t: ctx.ahora(), ...r }; if (paso === "decidir" || paso === "preparar") for (const p of PASOS.slice(PASOS.indexOf(paso) + 1)) delete a.pasos[p]; }
  catch (e) { a.pasos[paso] = { ok: false, t: ctx.ahora(), error: String(e.message || e).slice(0, 300) }; a.error = `${paso}: ${String(e.message || e).slice(0, 300)}`; }
  a.corriendo = null; a.paso_actual = null; a.etapa = siguientePaso(a) || "listo";
  // estado del trabajo visible en la app
  if (a.error) ctx.anotar(t, "lic_revisar", `⚠ Licitador automático se detuvo en «${a.paso_actual || paso}»: ${a.pasos[paso].error}`);
  else if (a.etapa === "listo") ctx.anotar(t, "lic_revisar", `${SEM[a.decision?.estado] || ""} · ${a.decision?.motivo || ""} · oferta preparada (ZIP)`);
  else ctx.anotar(t, "lic_analizando", { leer: "🤖 Leí la licitación; ahora busco productos y precios reales…", buscar: "🤖 Encontré candidatos; ahora calculo y decido…", decidir: "🤖 Decidido; ahora preparo los documentos…" }[paso] || "🤖 Trabajando…");
  await ctx.escribir(t); return a;
}
// corre todos los pasos pendientes (o hasta agotar el presupuesto de tiempo); devuelve el estado
export async function correr(ctx, t, { presupuestoMs = 14 * 60e3, desde } = {}) {
  const ini = Date.now(); const a = t.auto = t.auto || { v: 1, pasos: {}, creado: ctx.ahora() }; delete a.pendiente;
  if (desde) for (const p of PASOS.slice(PASOS.indexOf(desde))) delete (a.pasos || {})[p];
  let paso; while ((paso = siguientePaso(a)) && Date.now() - ini < presupuestoMs) { await correrPaso(ctx, t, paso); if (a.error) break; }
  if (paso && !a.error && siguientePaso(a)) { a.etapa = siguientePaso(a); a.pendiente = true; await ctx.escribir(t); }
  return a;
}
export { PASOS, SEM, SEMT };
