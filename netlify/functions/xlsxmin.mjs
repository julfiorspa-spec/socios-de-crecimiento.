// 📊 escritor XLSX mínimo (sin dependencias): hojas con valores, textos y FÓRMULAS. ZIP en modo "store" con CRC32.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipStore(files) {   // files: [{name, data:Buffer}]
  const locals = [], centrals = []; let off = 0; const now = new Date(); const dosT = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff, dosD = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const f of files) { const name = Buffer.from(f.name), data = f.data, crc = crc32(data); const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(dosT, 10); h.writeUInt16LE(dosD, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(dosT, 12); c.writeUInt16LE(dosD, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(off, 42);
    locals.push(h, name, data); centrals.push(c, name); off += h.length + name.length + data.length; }
  const cd = Buffer.concat(centrals); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(0, 4); e.writeUInt16LE(0, 6); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16); e.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, e]);
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const col = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// celda: número → <c><v>; string → inlineStr; {f:"SUM(A1:A3)"} → fórmula; {s:"texto"} → string; null → vacío
function celda(ref, v) {
  if (v == null || v === "") return "";
  if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
  if (typeof v === "object" && v.f) return `<c r="${ref}"><f>${esc(v.f)}</f></c>`;
  if (typeof v === "object" && v.s != null) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v.s)}</t></is></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
}
// hojas: [{nombre, filas:[[...celdas]], anchos:[n,...]}]
export function xlsx(hojas) {
  const sheetsXml = hojas.map((h) => { const cols = h.anchos?.length ? `<cols>${h.anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const rows = h.filas.map((fila, r) => `<row r="${r + 1}">${fila.map((v, c) => celda(col(c) + (r + 1), v)).join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`; });
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${hojas.map((h, i) => `<sheet name="${esc(h.nombre.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  return zipStore([{ name: "[Content_Types].xml", data: Buffer.from(ct) }, { name: "_rels/.rels", data: Buffer.from(rels) }, { name: "xl/workbook.xml", data: Buffer.from(wb) }, { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(wbRels) }, ...hojas.map((h, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(sheetsXml[i]) }))]);
}

// 📗 Excel en vivo de una OC: misma fórmula que la ficha (ventaNeta − costoDirecto − ejecución − factoring − PPM)
export function excelOC(t, ev) {
  const L = ev.lineas; const n = L.length; const H = ["Línea", "Cantidad", "Venta unit. neta", "Venta neta", "Costo unit. neto", "Costo total", "Proveedor", "Tipo de costo", "Stock", "Plazo", "IVA informado", "Despacho", "Respaldo"];
  const filas = [[{ s: `OC ${t.op?.oc_codigo || t.codigo} · ${t.nombre || ""}` }], [{ s: "Evaluación " + ev.estado + " · " + ev.motivo }], [], H];
  L.forEach((l, i) => filas.push([l.nombre, l.q, l.pUnit, { f: `B${i + 5}*C${i + 5}` }, l.costoTotal == null ? "" : l.costoTotal / l.q, l.costoTotal == null ? "" : { f: `B${i + 5}*E${i + 5}` }, l.proveedor || "", l.tipo || "sin costo", l.stock || "", l.plazo || "", l.ivaInforma || "neto", l.despacho ?? "", l.respaldo || ""]));
  const r1 = 5, rN = 4 + n, s = 5 + n;   // la fila "Venta neta" es la primera del resumen
  const sup = [["Venta neta", { f: `SUM(D${r1}:D${rN})` }], ["Compra (suma costos)", { f: `SUM(F${r1}:F${rN})` }], ["Flete", ev.flete ?? 0], ["Otros costos directos", ev.otros || 0], ["Costo directo", { f: `B${s + 1}+B${s + 2}+B${s + 3}` }],
    ["Ejecución %" + (ev.ejecSup ? " (supuesto)" : " (real)"), ev.ejecSup ? ev.supuestos.ejecucion_pct : ""], ["Ejecución", ev.ejecSup ? { f: `B${s}*B${s + 5}/100` } : ev.ejecucion], ["Factoring %" + (ev.factSup ? " (supuesto)" : " (real)"), ev.factSup ? ev.supuestos.factoring_pct : ""], ["Factoring", ev.factSup ? { f: `B${s}*B${s + 7}/100` } : ev.factoring], ["PPM % (reserva)", ev.supuestos.ppm_pct], ["Reserva PPM", { f: `B${s}*B${s + 9}/100` }],
    ["Margen operativo", { f: `B${s}-B${s + 4}-B${s + 6}-B${s + 8}` }], ["Saldo proyectado", { f: `B${s + 11}-B${s + 10}` }], ["Margen %", { f: `IF(B${s}=0,0,B${s + 12}/B${s})` }], ["Costo directo máximo (equilibrio)", { f: `B${s}-B${s + 6}-B${s + 8}-B${s + 10}` }], ["Meta de caja", ev.meta], ["Costo máximo para la meta", { f: `B${s + 14}-B${s + 15}` }], ["IVA de la venta (no es margen)", ev.iva], ["Caja necesaria para partir", ev.cajaNecesaria]];
  sup.forEach((f) => filas.push(f));
  const caja = [["Fecha", "Concepto", "Monto", "Acumulado"], ...ev.caja.map((e) => [e.fecha, e.concepto, e.monto, e.acumulado])];
  return xlsx([{ nombre: "Excel en vivo", filas, anchos: [38, 10, 16, 16, 16, 16, 22, 14, 10, 12, 12, 12, 30] }, { nombre: "Caja por fecha", filas: caja, anchos: [12, 44, 16, 16] }]);
}
