// ==UserScript==
// @name         CotizÁgil · Histórico de mercado (TodoLicitaciones)
// @namespace    https://cotizagil.netlify.app/
// @version      1.0.0
// @description  Lee compras ágiles ADJUDICADAS en TodoLicitaciones (con tu sesión) y guarda ofertas, ganador y productos en la memoria de PJANIC. Corre solo, se retoma solo, muestra su avance abajo a la derecha. No envía ni modifica nada en TodoLicitaciones.
// @match        https://www.todolicitaciones.cl/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://cotizagil.netlify.app/cotizagil-historico.user.js
// @downloadURL  https://cotizagil.netlify.app/cotizagil-historico.user.js
// ==/UserScript==
(function () {
  "use strict";
  const NUBE = "https://cotizagil.netlify.app/bot/sii-ingesta", K = "4a81bc9e0466a9e773f9235b04867ba3";
  const TERMS = ["pletina", "fierro", "acero", "viruta", "aserrin", "bolsas plasticas", "bolsas basura", "hormigon", "aridos", "alimento perros", "impresion", "pendones",
    "mobiliario", "insumos aseo", "terciado", "madera", "pintura", "herramientas", "señaletica", "carpa", "electrodomesticos", "estanterias", "juguetes",
    "cascos seguridad", "elementos proteccion personal", "guantes", "zapatos seguridad", "chalecos", "uniformes", "toner", "papel", "articulos oficina", "computador", "notebook", "impresora"];
  const PAGES = 4;
  const sl = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (s) => Number(String(s || "").replace(/[^\d]/g, "")) || 0;
  const ST = () => { try { return JSON.parse(localStorage.__tlH || "{}"); } catch { return {}; } };
  const save = (s) => { try { localStorage.__tlH = JSON.stringify(s); } catch {} };
  // ---- caja de estado en la página
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;background:#121417;color:#f4f5f7;font:12px/1.4 system-ui;padding:10px 12px;border-radius:12px;border:1px solid #2d333c;max-width:300px;box-shadow:0 6px 24px #0008";
  document.body.appendChild(box);
  const pinta = (s, extra) => { box.innerHTML = `<b style="color:#1ed760">📚 PJANIC · histórico</b><br>${extra || ""}familia ${Math.min(s.ti + 1, TERMS.length)}/${TERMS.length}: <b>${TERMS[s.ti] || "—"}</b><br>leídas ${s.done || 0} · guardadas ${s.sent || 0} · err ${s.err || 0}<br><small style="color:#9aa3b2">${(s.log || []).slice(-2).join(" · ")}</small>`; };
  function parse(doc) {
    const txt = doc.querySelector("main")?.innerText || doc.body.innerText; const g = (re) => (txt.match(re) || [])[1] || ""; const c = {};
    c.codigo = g(/Código:\s*([\w-]+)/); c.nombre = (doc.querySelector("main h1,main h2,h1")?.innerText || "").trim().slice(0, 160);
    c.pres = num(g(/Presupuesto estimado\s*\$\s*([\d.]+)/) || g(/Presupuesto:\s*\$([\d.]+)/)); c.cierre = (g(/Fecha Cierre\s*([\d-]+\s*[\d:]+)/) || g(/Cierre:\s*([\d-]+ [\d:]+)/)).replace(/\s+/g, " ");
    c.conv = g(/Convocatoria\s*([^\n]+)/); c.plazo = g(/Plazo de entrega\s*([^\n]+)/); c.oc = g(/Orden de compra\s*(\d+)/); c.org = g(/Organismo Comprador\s*Organismo\s*([^\n]+)/);
    c.rutOrg = g(/\nRUT\s*([\d.]+-[\dkK])/); c.region = g(/Unidad de compra\s*[^\n]+\s*Región\s*([^\n]+)/);
    const ts = [...doc.querySelectorAll("table")];
    const tp = ts.find((t) => /Nombre/.test(t.rows[0]?.cells[0]?.innerText) && /Cantidad/.test(t.rows[0].innerText));
    c.productos = tp ? [...tp.rows].slice(1).map((r) => ({ nombre: r.cells[0]?.innerText.trim(), rubro: r.cells[1]?.innerText.trim(), desc: r.cells[2]?.innerText.trim().slice(0, 300), cant: Number(String(r.cells[3]?.innerText).replace(/[^\d.,]/g, "").replace(",", ".")) || 0, unidad: r.cells[4]?.innerText.trim() })) : [];
    const to = ts.find((t) => /Proveedor/.test(t.rows[0]?.cells[0]?.innerText) && /Monto/.test(t.rows[0].innerText)); c.ofertas = [];
    if (to) for (const r of [...to.rows].slice(1)) { if (r.cells.length < 3) continue;
      const n = r.cells[0].innerText.replace(/Empresa de Menor Tamaño|Gran Empresa|Adjudicado/g, "").replace(/\s+/g, " ").trim(), adj = /Adjudicado/.test(r.cells[0].innerText);
      const o = { n, rut: r.cells[1].innerText.trim(), total: num(r.cells[2].innerText), adj }; c.ofertas.push(o);
      if (adj) { const det = r.nextElementSibling?.innerText || ""; c.ganador = { nombre: n, rut: o.rut, total: o.total, neto: num((det.match(/Valor Neto\s*\$([\d.]+)/) || [])[1]), despacho: num((det.match(/Despacho\s*\$([\d.]+)/) || [])[1]) }; } }
    c.nOf = c.ofertas.length || num(g(/Ofertas recibidas\s*(\d+)/)); return c;
  }
  async function post(s, term, compras) {
    const r = await fetch(NUBE, { method: "POST", body: JSON.stringify({ k: K, rut_empresa: "78493114-5", accion: "historico", term, compras }) });
    const j = await r.json().catch(() => ({})); s.log.push(term + ":" + (j.total || j.error || r.status)); save(s);
  }
  async function run() {
    const s = Object.assign({ ti: 0, done: 0, sent: 0, err: 0, log: [], fin: false }, ST());
    if (s.fin) { pinta(s, "<b>✅ terminado</b> · "); return; }
    if (s.corriendo && Date.now() - s.corriendo < 90_000) { pinta(s, "⏳ corre en otra pestaña · "); return; }   // una sola pestaña trabaja
    const latido = setInterval(() => { s.corriendo = Date.now(); save(s); }, 20_000); s.corriendo = Date.now(); save(s);
    for (; s.ti < TERMS.length; s.ti++, save(s)) {
      const term = TERMS[s.ti]; let buf = []; const seen = new Set();
      for (let pg = 1; pg <= PAGES; pg++) {
        let links = [];
        try { const h = await (await fetch("/busqueda/licitaciones?tipoDocumento=COMPRA_AGIL&textSearch=" + encodeURIComponent(term) + "&ESTADO=proveedor_seleccionado&currentPage=" + pg, { credentials: "include" })).text();
          const d = new DOMParser().parseFromString(h, "text/html"); links = [...d.querySelectorAll('a[href^="/compra-agil/"]')].map((a) => a.getAttribute("href")).filter((x, i, a) => a.indexOf(x) === i && !seen.has(x)); } catch { s.err++; }
        if (!links.length) break;
        for (const l of links) { seen.add(l);
          try { const r = await fetch(l, { credentials: "include" }); if (/\/login/.test(r.url)) { s.log.push("⚠ sin sesión: inicia sesión y recarga"); pinta(s, "⛔ "); save(s); clearInterval(latido); return; }
            const c = parse(new DOMParser().parseFromString(await r.text(), "text/html")); if (c.codigo) { c.q = term; buf.push(c); s.done++; } } catch { s.err++; }
          if (buf.length >= 40) { try { await post(s, term, buf); s.sent += buf.length; } catch { s.err++; } buf = []; }
          pinta(s); await sl(400); }
        await sl(800);
      }
      if (buf.length) { try { await post(s, term, buf); s.sent += buf.length; } catch { s.err++; } }
    }
    s.fin = true; save(s); clearInterval(latido); pinta(s, "<b>✅ terminado</b> · ");
  }
  pinta(Object.assign({ ti: 0, log: [] }, ST())); setTimeout(run, 1500);
})();
