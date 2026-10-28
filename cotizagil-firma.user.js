// ==UserScript==
// @name         CotizÁgil · Firma rápida
// @namespace    https://cotizagil.netlify.app/
// @version      1.3
// @description  Al abrir una Compra Ágil desde «Ir a firmar», carga sola los precios, el detalle y el PDF de tu oferta. NO envía, NO declara y NO firma: eso lo haces tú.
// @match        https://cotizagil.netlify.app/*
// @match        https://compra-agil.mercadopublico.cl/*
// @match        https://www.mercadopublico.cl/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM_xmlhttpRequest
// @connect      cotizagil.netlify.app
// @run-at       document-idle
// @downloadURL  https://cotizagil.netlify.app/cotizagil-firma.user.js
// @updateURL    https://cotizagil.netlify.app/cotizagil-firma.user.js
// ==/UserScript==
(function () {
  "use strict";
  const APP = "https://cotizagil.netlify.app";
  // compatible con Tampermonkey (PC, Firefox Android) y con la app Userscripts de Safari (iPhone)
  const gmSet = async (k, v) => { try { if (typeof GM !== "undefined" && GM.setValue) return await GM.setValue(k, v); } catch (e) {} return GM_setValue(k, v); };
  const gmGet = async (k) => { try { if (typeof GM !== "undefined" && GM.getValue) return await GM.getValue(k); } catch (e) {} try { return GM_getValue(k); } catch (e) { return undefined; } };

  // 1) En la app: guarda el código de enlace para poder leer tus ofertas desde Mercado Público.
  if (location.hostname === "cotizagil.netlify.app") {
    try {
      const tok = JSON.parse(localStorage.getItem("sdc:robot") || "{}").token;
      if (tok) gmSet("token", tok);
    } catch (e) {}
    document.documentElement.dataset.firmaRapida = "1";
    // recuerda qué compra vas a firmar: si Mercado Público te pide iniciar sesión, después te lleva a ella
    document.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest('[data-rb="ir-firmar"]');
      if (b && b.dataset.c) gmSet("pendiente", JSON.stringify({ cod: b.dataset.c, t: Date.now() }));
    }, true);
    return;
  }

  // 1b) Tras iniciar sesión el portal te deja en su inicio: volver a la compra pendiente
  const pendiente = async () => {
    try { const p = JSON.parse((await gmGet("pendiente")) || "null"); return p && Date.now() - p.t < 45 * 60000 ? p.cod : null; } catch (e) { return null; }
  };
  const urlCompra = (c) => "https://compra-agil.mercadopublico.cl/resumen-cotizacion/" + encodeURIComponent(c);
  if (location.hostname === "www.mercadopublico.cl") {
    pendiente().then((c) => {
      if (!c) return;
      const a = document.createElement("a");
      a.href = urlCompra(c); a.textContent = "✍ Ir a firmar " + c;
      a.style.cssText = "position:fixed;left:12px;right:12px;bottom:14px;z-index:2147483647;display:block;text-align:center;background:#7c4dff;color:#fff;" +
        "padding:14px;border-radius:14px;font:600 16px system-ui,sans-serif;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.35)";
      document.body.append(a);
    });
    return;
  }

  // 2) En Mercado Público (aplicación de una sola página: se vigila la dirección)
  let token = null;

  const caja = document.createElement("div");
  caja.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483647;max-width:380px;background:#0b1c3c;color:#f6f8fc;" +
    "border:2px solid #7c4dff;border-radius:14px;padding:12px 14px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)";
  const decir = (html) => { caja.innerHTML = "<b>CotizÁgil · Firma rápida</b><div style='margin-top:6px'>" + html + "</div>"; if (!caja.isConnected) document.body.append(caja); };

  const pedir = async (ruta, tipo, cuerpo) => {
    try {
      const r = await fetch(APP + "/bot/" + ruta, { method: cuerpo ? "POST" : "GET", body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        headers: { "x-robot-token": token, "content-type": "application/json" } });
      if (r.status !== 200) throw new Error("La app respondió " + r.status);
      return tipo === "blob" ? await r.blob() : await r.json();
    } catch (e) {
      if (typeof GM_xmlhttpRequest === "undefined") throw e;
      return pedirGM(ruta, tipo, cuerpo);
    }
  };
  const pedirGM = (ruta, tipo, cuerpo) => new Promise((ok, mal) => GM_xmlhttpRequest({
    method: cuerpo ? "POST" : "GET", url: APP + "/bot/" + ruta, data: cuerpo ? JSON.stringify(cuerpo) : undefined,
    headers: { "x-robot-token": token, "content-type": "application/json" }, responseType: tipo || "json",
    onload: (r) => r.status === 200 ? ok(r.response) : mal(new Error("La app respondió " + r.status)), onerror: () => mal(new Error("Sin conexión con la app")),
  }));
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const setIn = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const setTa = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  const poner = async (el, v, set) => {
    el.focus(); set.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true }));
    set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true })); el.blur(); await espera(200);
  };
  const tipo = (e) => {
    for (let x = e, k = 0; k < 9 && x; k++, x = x.parentElement) {
      const s = x.innerText || "", vu = /Valor unitario/.test(s), de = /Despacho/i.test(s);
      if (vu && !de) return "i"; if (de && !vu) return "d"; if (vu && de) return "?";
    }
    return "";
  };
  const clp = (n) => "$" + Math.round(n).toLocaleString("es-CL");

  const hechas = new Set();
  async function revisar() {
    const ruta = location.pathname + location.search;
    const publicada = (ruta.match(/cotizacion-publicada\?quote=([\w-]+)/) || [])[1];
    const cod = (location.pathname.match(/resumen-cotizacion\/([\w-]+)/) || [])[1];
    if (publicada && !hechas.has("v" + publicada)) {        // terminaste de firmar: el robot lo confirma solo
      hechas.add("v" + publicada);
      gmSet("pendiente", "null");
      if (!token) return;
      try { await pedir("pedir", "json", { codigo: publicada.toUpperCase(), accion: "verificar" }); decir("✓ Enviada. El robot la está confirmando; la verás en dorado en la app."); }
      catch (e) { decir("Enviada. Abre la app y toca «Ya la firmé» para confirmarla."); }
      return;
    }
    if (!cod && !publicada && !hechas.has("ir")) {          // en otra página de Compra Ágil (p. ej. después del login)
      hechas.add("ir");
      const p = await pendiente();
      if (p && sessionStorage.getItem("cotizagil-ir") !== p) { sessionStorage.setItem("cotizagil-ir", p); location.href = urlCompra(p); }
      return;
    }
    if (!cod || hechas.has(cod)) return;
    hechas.add(cod);
    gmSet("pendiente", JSON.stringify({ cod: cod.toUpperCase(), t: Date.now() }));   // por si el portal te manda a iniciar sesión: al volver, regresa aquí
    if (!token) { decir("Abre una vez la app <b>cotizagil.netlify.app</b> en este navegador (ya enlazada con el robot) y vuelve a esta página."); return; }
    await rellenar(cod);
  }
  gmGet("token").then((t) => { token = t || null; setInterval(revisar, 1000); revisar(); });

  async function rellenar(cod) {
    let t;
    try {
      const est = await pedir("estado");
      t = (est.trabajos || []).find((x) => x.codigo === cod.toUpperCase());
    } catch (e) { decir("No pude leer tu oferta: " + e.message); return; }
    if (!t || t.estado !== "firmar" || !t.firma) return;          // no hay oferta lista para esta compra: no hace nada
    decir("Oferta " + clp(t.firma.total) + " lista. Esperando el formulario… (si no aparece, presiona <b>Participar</b>)");

    // espera hasta 3 minutos a que esté el formulario (por si hay que presionar Participar o iniciar sesión)
    let items = [], desp = [];
    for (let k = 0; k < 360; k++) {
      const campos = [...document.querySelectorAll("main input[type=text]:not([disabled]), main input:not([type]):not([disabled])")];
      items = campos.filter((e) => tipo(e) === "i"); desp = campos.filter((e) => tipo(e) === "d");
      if (items.length) break;
      await espera(500);
    }
    if (!items.length) { decir("No apareció el formulario. Presiona <b>Participar</b> o <b>Enviar nueva cotización</b> y recarga la página."); return; }
    if (items.length !== t.firma.precios.length) {
      decir("⚠ El formulario tiene " + items.length + " ítems y la oferta " + t.firma.precios.length + ". No toqué nada: revisa la oferta en la app."); return;
    }
    for (let k = 0; k < items.length; k++) await poner(items[k], t.firma.precios[k], setIn);
    if (desp[0]) await poner(desp[0], t.firma.despacho || 0, setIn);
    const area = document.querySelector("main textarea");
    if (area && t.firma.detalle) await poner(area, t.firma.detalle.slice(0, 255), setTa);

    // adjunta el PDF de la oferta
    let adj = "⚠ Adjunta el PDF a mano (descárgalo en la app).";
    const archivo = t.firma.adjunto || "Oferta_" + cod + ".pdf";
    try {
      const yaEsta = document.body.innerText.includes(archivo);
      const input = document.querySelector("input[type=file]");
      if (yaEsta) adj = "✓ PDF ya estaba adjunto.";
      else if (input && t.pdf) {
        const blob = await pedir("pdf?codigo=" + encodeURIComponent(cod), "blob");
        const dt = new DataTransfer(); dt.items.add(new File([blob], archivo, { type: "application/pdf" }));
        input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true }));
        for (let k = 0; k < 40 && !document.body.innerText.includes(archivo); k++) await espera(500);
        adj = document.body.innerText.includes(archivo) ? "✓ PDF adjunto: " + archivo : "⚠ Revisa que el PDF quedó adjunto.";
      }
    } catch (e) {}

    await espera(600);
    const dig = (s) => String(s || "").replace(/\D/g, "");
    const malos = items.map((e, k) => dig(e.value) === dig(t.firma.precios[k]) ? null : "ítem " + (k + 1) + " = " + clp(t.firma.precios[k])).filter(Boolean);
    const m = [...document.body.innerText.matchAll(/Monto total\s*\n*\s*\$\s*([\d.]+)/g)].pop();
    const tp = m ? +m[1].replace(/\./g, "") : null;
    const ok = tp != null && Math.abs(tp - t.firma.total) <= 50 && !malos.length;
    decir((ok ? "✓ Precios y detalle cargados. Total " + clp(tp) + " = oferta." :
      "⚠ Revisa: " + (malos.length ? "corrige " + malos.join(", ") + ". " : "") + "Total portal " + (tp == null ? "?" : clp(tp)) + " · oferta " + clp(t.firma.total) + ".") +
      "<br>" + adj + "<br><br><b>Ahora tú:</b> presiona <b>Enviar cotización</b>, marca la <b>declaración</b> y <b>firma</b>." +
      "<br><small style='opacity:.75'>Al terminar, el robot lo confirma solo.</small>");
  }
})();
