// 📄 escritor PDF mínimo (sin dependencias): texto Helvetica con acentos (WinAnsi), títulos, párrafos con corte de línea,
//    tablas, pares clave-valor, imágenes JPEG (DCTDecode) y paginación automática A4. Para fichas, ofertas e informes.
const W = 595.28, H = 841.89, MARGEN = 48;
// anchos Helvetica (1/1000 em) para los caracteres ASCII 32..126; el resto se aproxima con 556
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HWB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
export function ancho(txt, tam, bold) { const T = bold ? HWB : HW; let w = 0; for (const ch of String(txt)) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? T[c - 32] : c === 160 ? 278 : 556; } return w * tam / 1000; }
// WinAnsi: latin-1 directo; algunos signos frecuentes se mapean; emojis y otros símbolos se quitan
const MAPA = { "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "…": 0x85, "€": 0x80, "™": 0x99, "→": 0x3e, "✓": 0x2b, "✔": 0x2b, "✗": 0x78, "✖": 0x78, "✕": 0x78 };
export function winAnsi(txt) {
  const out = []; for (const ch of String(txt ?? "")) { const c = ch.codePointAt(0); if (c < 128) out.push(c); else if (MAPA[ch] != null) out.push(MAPA[ch]); else if (c >= 160 && c <= 255) out.push(c); else if (c === 0x2011) out.push(45); else if (c === 0x00a0) out.push(32); /* emojis u otros: se omiten */ }
  return Buffer.from(out);
}
const esc = (b) => { let s = ""; for (const c of b) { if (c === 0x28 || c === 0x29 || c === 0x5c) s += "\\" + String.fromCharCode(c); else if (c < 32 || c > 126) s += "\\" + c.toString(8).padStart(3, "0"); else s += String.fromCharCode(c); } return s; };
const limpia = (s) => String(s ?? "").replace(/\u2265/g, ">=").replace(/\u2264/g, "<=").replace(/\u2248/g, "~").replace(/\u2212/g, "-").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();

function jpegDims(buf) {
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) return null; let i = 2;
  while (i < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; } const len = buf.readUInt16BE(i + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), comp: buf[i + 9] }; i += 2 + len; }
  return null;
}

export function pdf(meta = {}) {
  const paginas = []; const imgs = []; let pg = null, y = 0; const pie = meta.pie || "";
  const nueva = () => { pg = { ops: [], imgs: [] }; paginas.push(pg); y = H - MARGEN; if (meta.cabecera) { texto(meta.cabecera, 8, false, 0.45); y -= 8; } };
  const falta = (n) => { if (!pg || y - n < MARGEN + 18) nueva(); };
  const texto = (s, tam, bold, gris, x = MARGEN, w = W - 2 * MARGEN, alinear = "izq") => {
    const lineas = cortar(limpia(s), tam, bold, w);
    for (const ln of lineas) { falta(tam * 1.3); const tw = ancho(ln, tam, bold); const xx = alinear === "der" ? x + w - tw : alinear === "centro" ? x + (w - tw) / 2 : x;
      pg.ops.push(`BT /${bold ? "F2" : "F1"} ${tam} Tf ${gris ? `${gris} g ` : "0 g "}${xx.toFixed(2)} ${(y - tam).toFixed(2)} Td (${esc(winAnsi(ln))}) Tj ET`); y -= tam * 1.3; }
    return lineas.length;
  };
  const cortar = (s, tam, bold, w) => { const out = []; for (const parr of String(s).split("\n")) { const pal = parr.split(" "); let ln = ""; for (const p of pal) { const t = ln ? ln + " " + p : p; if (ancho(t, tam, bold) <= w) ln = t; else { if (ln) out.push(ln); ln = p; while (ancho(ln, tam, bold) > w && ln.length > 1) { let k = ln.length - 1; while (k > 1 && ancho(ln.slice(0, k), tam, bold) > w) k--; out.push(ln.slice(0, k)); ln = ln.slice(k); } } } out.push(ln); } return out; };
  const linea = (x1, x2, gris = 0.75) => { falta(4); pg.ops.push(`${gris} G 0.5 w ${x1.toFixed(2)} ${(y - 2).toFixed(2)} m ${x2.toFixed(2)} ${(y - 2).toFixed(2)} l S`); y -= 6; };
  const api = {
    titulo(s, sub) { falta(40); texto(s, 17, true); if (sub) texto(sub, 9.5, false, 0.35); y -= 6; linea(MARGEN, W - MARGEN, 0.2); y -= 4; return api; },
    h2(s) { falta(26); y -= 6; texto(s.toUpperCase(), 9, true, 0.3); linea(MARGEN, W - MARGEN); return api; },
    h3(s) { falta(18); y -= 3; texto(s, 10.5, true); return api; },
    p(s, op = {}) { if (s == null || s === "") return api; texto(s, op.tam || 9.5, !!op.bold, op.gris, MARGEN + (op.sangria || 0), W - 2 * MARGEN - (op.sangria || 0)); y -= 3; return api; },
    nota(s) { texto(s, 8, false, 0.45); y -= 2; return api; },
    lista(items, vineta = "•") { for (const it of items || []) { const t = limpia(it); falta(14); texto(vineta, 9.5, false, 0, MARGEN + 4, 12); y += 9.5 * 1.3; texto(t, 9.5, false, 0, MARGEN + 16, W - 2 * MARGEN - 16); } y -= 3; return api; },
    kv(pares, op = {}) { const kw = op.kw || 150; for (const [k, v] of pares || []) { if (v == null || v === "") continue; falta(14); const y0 = y; texto(k, 9, true, 0.35, MARGEN, kw); const y1 = y; y = y0; texto(String(v), 9.5, false, 0, MARGEN + kw + 8, W - 2 * MARGEN - kw - 8); y = Math.min(y, y1); } y -= 4; return api; },
    tabla(cols, filas, op = {}) {
      const anchos = op.anchos || cols.map(() => (W - 2 * MARGEN) / cols.length); const tam = op.tam || 8.5; const der = op.der || [];
      const fila = (celdas, bold, fondo) => { const lineasC = celdas.map((c, i) => cortar(limpia(c), tam, bold, anchos[i] - 6)); const n = Math.max(1, ...lineasC.map((l) => l.length)); const alto = n * tam * 1.3 + 5; falta(alto);
        if (fondo) pg.ops.push(`${fondo} g ${MARGEN.toFixed(2)} ${(y - alto).toFixed(2)} ${(W - 2 * MARGEN).toFixed(2)} ${alto.toFixed(2)} re f`);
        const y0 = y; let x = MARGEN; let yMin = y; celdas.forEach((c, i) => { y = y0 - 2.5; texto(lineasC[i].join("\n"), tam, bold, 0, x + 3, anchos[i] - 6, der.includes(i) ? "der" : "izq"); yMin = Math.min(yMin, y); x += anchos[i]; }); y = y0 - alto; linea(MARGEN, W - MARGEN, 0.85); y += 2; };
      fila(cols, true, 0.92); for (const f of filas || []) fila(f.map((c) => (c == null ? "" : String(c))), false, null); y -= 4; return api;
    },
    imagen(jpg, op = {}) { const d = jpg && jpegDims(jpg); if (!d) return api; const maxW = op.ancho || 220, maxH = op.alto || 180; const k = Math.min(maxW / d.w, maxH / d.h, 1); const w = d.w * k, h = d.h * k; falta(h + 8);
      const id = imgs.push({ data: jpg, w: d.w, h: d.h, comp: d.comp }) - 1; const x = op.x ?? MARGEN; pg.imgs.push(id); pg.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(y - h).toFixed(2)} cm /Im${id} Do Q`); y -= h + 8; if (op.pie) texto(op.pie, 7.5, false, 0.45); return api; },
    salto() { nueva(); return api; }, espacio(n = 8) { y -= n; return api; },
    firma(etiqueta) { falta(60); y -= 28; linea(MARGEN, MARGEN + 230, 0.3); texto(etiqueta, 8.5, false, 0.35, MARGEN, 230); y -= 6; return api; },
    build() {
      if (!paginas.length) nueva();
      const objs = []; const add = (s) => objs.push(s) - 1 + 1;   // ids desde 1
      const fontIds = [add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"), add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")];
      const imgIds = imgs.map((im) => add({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /${im.comp === 1 ? "DeviceGray" : im.comp === 4 ? "DeviceCMYK" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>`, stream: im.data }));
      const pagesId = objs.length + 1 + paginas.length * 2;   // se reserva al final
      const pageIds = [];
      paginas.forEach((p, i) => {
        const pieTxt = pie ? `BT /F1 7.5 Tf 0.45 g ${MARGEN} 24 Td (${esc(winAnsi(limpia(pie)))}) Tj ET` : ""; const num = `BT /F1 7.5 Tf 0.45 g ${(W - MARGEN - ancho(`${i + 1} / ${paginas.length}`, 7.5)).toFixed(2)} 24 Td (${esc(winAnsi(`${i + 1} / ${paginas.length}`))}) Tj ET`;
        const cont = Buffer.from([...p.ops, pieTxt, num].join("\n"), "latin1");
        const cId = add({ dict: `<< /Length ${cont.length} >>`, stream: cont });
        const xo = p.imgs.length ? ` /XObject << ${[...new Set(p.imgs)].map((k) => `/Im${k} ${imgIds[k]} 0 R`).join(" ")} >>` : "";
        pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${cId} 0 R /Resources << /Font << /F1 ${fontIds[0]} 0 R /F2 ${fontIds[1]} 0 R >>${xo} >> >>`));
      });
      const realPages = add(`<< /Type /Pages /Kids [${pageIds.map((k) => k + " 0 R").join(" ")}] /Count ${pageIds.length} >>`);
      // corrige la referencia al /Pages si el id reservado no coincidió
      if (realPages !== pagesId) for (const k of pageIds) objs[k - 1] = objs[k - 1].replace(`/Parent ${pagesId} 0 R`, `/Parent ${realPages} 0 R`);
      const info = add(`<< /Title (${esc(winAnsi(limpia(meta.titulo || "Documento")))}) /Author (${esc(winAnsi(limpia(meta.autor || "CotizÁgil")))}) /Producer (CotizAgil pdfmin) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`);
      const cat = add(`<< /Type /Catalog /Pages ${realPages} 0 R >>`);
      const partes = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")]; const offs = []; let off = partes[0].length;
      objs.forEach((o, i) => { offs.push(off); const head = Buffer.from(`${i + 1} 0 obj\n`, "latin1"); let body; if (typeof o === "string") body = Buffer.from(o + "\nendobj\n", "latin1"); else body = Buffer.concat([Buffer.from(o.dict + "\nstream\n", "latin1"), o.stream, Buffer.from("\nendstream\nendobj\n", "latin1")]); partes.push(head, body); off += head.length + body.length; });
      const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R /Info ${info} 0 R >>\nstartxref\n${off}\n%%EOF\n`;
      partes.push(Buffer.from(xref, "latin1")); return Buffer.concat(partes);
    },
  };
  nueva(); return api;
}
