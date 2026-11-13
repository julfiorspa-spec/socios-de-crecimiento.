// ==UserScript==
// @name         CotizÁgil · Facturas de compra (SII)
// @namespace    https://cotizagil.netlify.app/
// @version      1.0.0
// @description  En "Administración de documentos recibidos" del sistema de facturación gratuito del SII, lee las facturas de compra (PDF) de la empresa activa y guarda su texto en la memoria de PJANIC para armar el catálogo proveedor → producto → precio. Corre solo, se retoma solo, muestra su avance abajo a la derecha. Solo lee: no emite, no acepta ni rechaza documentos.
// @match        https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsRcp.cgi*
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @grant        none
// @run-at       document-idle
// @updateURL    https://cotizagil.netlify.app/cotizagil-sii.user.js
// @downloadURL  https://cotizagil.netlify.app/cotizagil-sii.user.js
// ==/UserScript==
(function () {
  "use strict";
  const NUBE = "https://cotizagil.netlify.app/bot/sii-ingesta", K = "4a81bc9e0466a9e773f9235b04867ba3";
  const BASE = "https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsRcp.cgi?RUT_EMI=&FOLIO=&RZN_SOC=&FEC_DESDE=&FEC_HASTA=&TPO_DOC=&ESTADO=&ORDEN=&NUM_PAG=";
  const NOMBRES = { "78493114-5": "PJANIC SpA", "78047617-6": "Julfior SpA", "77003913-4": "Ingeniería Barasal SpA" };
  const sl = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (s) => Number(String(s || "").replace(/\D/g, "")) || 0;
  const rutEmp = (document.body.innerText.match(/Empresa:\s*([\d.]+-[\dkK])/) || [])[1]?.replace(/\./g, "").toUpperCase();
  if (!rutEmp) return;
  const KEY = "__siiH_" + rutEmp;
  const ST = () => { try { return JSON.parse(localStorage[KEY] || "{}"); } catch { return {}; } };
  const save = (s) => { try { localStorage[KEY] = JSON.stringify(s); } catch {} };
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;background:#121417;color:#f4f5f7;font:12px/1.4 system-ui;padding:10px 12px;border-radius:12px;border:1px solid #2d333c;max-width:300px;box-shadow:0 6px 24px #0008";
  document.body.appendChild(box);
  const pinta = (s, extra) => { box.innerHTML = `<b style="color:#1ed760">🧾 PJANIC · facturas SII</b> <small>${NOMBRES[rutEmp] || rutEmp}</small><br>${extra || ""}página <b>${s.pg || 1}</b> · facturas leídas ${s.docs || 0} · enviadas ${s.env || 0} · err ${s.err || 0}<br><small style="color:#9aa3b2">${(s.log || []).slice(-2).join(" · ")}</small>`; };
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  function filas(doc) {
    const out = [];
    for (const tr of doc.querySelectorAll("tr")) { const a = tr.querySelector('a[href*="mipeGesDocRcp"]'); if (!a) continue; const c = [...tr.cells].map((x) => x.innerText.trim());
      const tipo = /factura/i.test(c[3]) ? (/exenta|no afecta/i.test(c[3]) ? "34" : "33") : /nota de cr/i.test(c[3]) ? "61" : /guia/i.test(c[3]) ? "52" : "0";
      out.push({ href: new URL(a.getAttribute("href"), "https://www1.sii.cl/cgi-bin/Portal001/").href, rut: c[1], nombre: c[2], tipo, folio: c[4], fecha: c[5], total: num(c[6]) }); }
    return out;
  }
  async function texto(href) {
    const h = await (await fetch(href, { credentials: "include" })).text(); const d = new DOMParser().parseFromString(h, "text/html");
    const a = [...d.querySelectorAll("a")].find((x) => /mipeShowPdf/i.test(x.getAttribute("href") || "") || /VISUALIZACI/i.test(x.innerText)); if (!a) return "";
    const buf = await (await fetch(new URL(a.getAttribute("href"), href).href, { credentials: "include" })).arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise; let t = "";
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) { const p = await pdf.getPage(i); const tc = await p.getTextContent(); t += tc.items.map((it) => it.str).join(" ") + "\n"; }
    return t.slice(0, 6000);
  }
  async function enviar(s, docs, extra) {
    const r = await fetch(NUBE, { method: "POST", body: JSON.stringify(Object.assign({ k: K, rut_empresa: rutEmp, nombre_empresa: NOMBRES[rutEmp] || "", docs }, extra || {})) });
    const j = await r.json().catch(() => ({})); s.log.push((extra?.accion || "env") + ":" + (j.textos ?? j.lineas ?? j.error ?? r.status)); save(s); return j;
  }
  async function run() {
    const s = Object.assign({ pg: 1, docs: 0, env: 0, err: 0, log: [], fin: false }, ST());
    if (!window.pdfjsLib) { pinta(s, "⛔ pdf.js no cargó · "); return; }
    if (s.corriendo && Date.now() - s.corriendo < 90_000) { pinta(s, "⏳ corre en otra pestaña · "); return; }
    const latido = setInterval(() => { s.corriendo = Date.now(); save(s); }, 20_000); s.corriendo = Date.now(); save(s);
    if (!s.fin) for (; ; s.pg++, save(s)) {
      let fs = [];
      try { const h = await (await fetch(BASE + s.pg, { credentials: "include" })).text(); if (!/Empresa:/.test(h)) { s.log.push("⚠ sin sesión: vuelve a entrar"); pinta(s, "⛔ "); save(s); clearInterval(latido); return; } fs = filas(new DOMParser().parseFromString(h, "text/html")); } catch { s.err++; }
      s.log.push("pg" + s.pg + ":" + fs.length); if (!fs.length) break;
      let buf = [];
      for (const f of fs) { if (!["33", "34", "61"].includes(f.tipo)) continue;
        try { const t = await texto(f.href); if (t) { buf.push(Object.assign({}, f, { texto: t })); s.docs++; } } catch { s.err++; }
        if (buf.length >= 25) { try { await enviar(s, buf); s.env += buf.length; } catch { s.err++; } buf = []; }
        pinta(s); await sl(250); }
      if (buf.length) { try { await enviar(s, buf); s.env += buf.length; } catch { s.err++; } }
      if (fs.length < 100) break;
    }
    s.fin = true; save(s);
    // 🧠 catálogo: Claude lee las facturas (12 por vuelta) hasta que no queden pendientes
    pinta(s, "🧠 armando catálogo · ");
    for (let i = 0; i < 80; i++) { let j = null; try { j = await enviar(s, [], { accion: "catalogo" }); } catch { s.err++; break; } if (!j || j.listo || j.error || !j.faltan) break; pinta(s, `🧠 catálogo: ${j.items} líneas, faltan ${j.faltan} · `); await sl(1500); }
    clearInterval(latido); pinta(s, "<b>✅ terminado</b> · ");
  }
  pinta(Object.assign({ pg: 1, log: [] }, ST())); setTimeout(run, 1500);
})();
