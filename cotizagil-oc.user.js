// ==UserScript==
// @name         CotizÁgil · OC del portal → Caja OC
// @namespace    https://cotizagil.netlify.app/
// @version      1.0.0
// @description  Al abrir «Buscar Órdenes de Compra por proveedor» en Mercado Público, recorre todas las páginas y manda la lista oficial (estado real de cada OC) a la Caja OC de la app.
// @match        https://www.mercadopublico.cl/Portal/Modules/Site/Busquedas/ResultadoBusqueda.aspx*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
  "use strict";
  const NUBE = "https://cotizagil.netlify.app/bot/sii-ingesta", K = "4a81bc9e0466a9e773f9235b04867ba3";
  const EMPRESAS = [["78493114-5", /PJANIC/i], ["77891121-3", /NS\s*COMEX/i], ["78047617-6", /JULFIOR/i], ["77003913-4", /BARASAL/i]];
  const txt = document.body.innerText || "";
  if (!/Órdenes de Compra Por Proveedor/i.test(txt)) return;
  const prov = (txt.match(/Por Proveedor:\s*([^\n]+?)\s+Duraci/i) || [])[1] || "";
  const emp = EMPRESAS.find(([, re]) => re.test(prov)); if (!emp) return;
  const rut = emp[0], KEY = "__ocPortal_" + rut;
  const leer = () => [...document.querySelectorAll("table tr")].map((tr) => [...tr.cells].map((c) => c.innerText.trim()))
    .filter((r) => r.length >= 6 && /-(AG|SE|CM|OC|LP|LE|LQ|LR|CA|SC)\d\d$/.test(r[0])).map((r) => ({ oc: r[0], nombre: r[1], comprador: r[2], fecha: r[4], estado: r[5] }));
  const st = (() => { try { return JSON.parse(sessionStorage[KEY] || "{}"); } catch { return {}; } })();
  const pager = document.querySelector(".cssPager"); const nums = [...(pager?.querySelectorAll("div") || [])].map((d) => Number(d.textContent.trim())).filter(Boolean);
  const actual = Number((pager?.querySelector("div:not([onclick])")?.textContent || "1").trim()) || 1, ultima = Math.max(1, ...nums);
  const filas = leer(); const acum = { ...(st.acum || {}) }; for (const f of filas) acum[f.oc] = f;
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;background:#121417;color:#f4f5f7;font:12px/1.4 system-ui;padding:10px 12px;border-radius:12px;border:1px solid #2d333c;max-width:300px;box-shadow:0 6px 24px #0008";
  document.body.appendChild(box);
  const pinta = (m) => { box.innerHTML = `<b style="color:#1ed760">📦 Caja OC · ${prov.split(" ").slice(0, 3).join(" ")}</b><br>${m}`; };
  if (st.fin && Date.now() - (st.fin || 0) < 60_000) { pinta(`✅ ${Object.keys(acum).length} OC enviadas a la app hace un momento.`); return; }
  sessionStorage[KEY] = JSON.stringify({ acum, pag: actual });
  pinta(`leyendo página ${actual} de ${ultima} · ${Object.keys(acum).length} OC…`);
  if (actual < ultima && typeof window.fnMovePage === "function") { setTimeout(() => window.fnMovePage(actual + 1, "PaginadorBusqueda"), 900); return; }
  // última página: enviar todo
  fetch(NUBE, { method: "POST", body: JSON.stringify({ k: K, rut_empresa: rut, accion: "oc_portal", lista: Object.values(acum) }) })
    .then((r) => r.json()).then((j) => { sessionStorage[KEY] = JSON.stringify({ acum: {}, fin: Date.now() });
      pinta(`✅ ${j.n} OC sincronizadas · ${Object.entries(j.estados || {}).map(([e, n]) => `${n} ${e}`).join(" · ")}<br><small>${j.enlazadas} enlazadas con ofertas de la app · ${j.sueltas} sin oferta</small>`);
      if (actual !== 1 && typeof window.fnMovePage === "function") setTimeout(() => window.fnMovePage(1, "PaginadorBusqueda"), 2500); })
    .catch((e) => pinta("⛔ no pude enviar: " + String(e).slice(0, 80)));
})();
