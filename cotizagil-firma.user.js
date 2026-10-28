// ==UserScript==
// @name         CotizÁgil · Firma rápida
// @namespace    https://cotizagil.netlify.app/
// @version      1.7
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
      const disp = localStorage.getItem("sdc:dispositivo");
      if (disp) gmSet("dispositivo", disp);
    } catch (e) {}
    document.documentElement.dataset.firmaRapida = "1";
    // puente «Abrir compra»: /firmar.html#CODIGO → recuerda la compra y te lleva a ella (aunque pida iniciar sesión)
    const puente = location.pathname.startsWith("/firmar") && decodeURIComponent(location.hash.slice(1)).toUpperCase();
    if (puente === "CONECTAR") { location.replace("https://compra-agil.mercadopublico.cl/"); return; }
    if (puente && /-COT\d+$/.test(puente)) {
      gmSet("pendiente", JSON.stringify({ cod: puente, t: Date.now() })).then(() => {
        sessionStorage.removeItem("cotizagil-ir");
        location.replace("https://compra-agil.mercadopublico.cl/resumen-cotizacion/" + encodeURIComponent(puente));
      });
      return;
    }
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

  // 1c) CONEXIÓN EN VIVO con la app: esta pestaña avisa «conectado» y recibe la compra que tocas en «Ir a firmar»
  const estaLogueado = () => {
    const t = (document.body && document.body.innerText || "").slice(0, 6000);
    if (/cerrar sesi[oó]n|mis cotizaciones|mi cuenta|mis compras/i.test(t)) return true;
    if (/iniciar sesi[oó]n|ingresa con|clave[uú]nica/i.test(t)) return false;
    return /resumen-cotizacion|cotizacion-publicada/.test(location.pathname);
  };
  let latiendo = false;
  async function latir() {
    if (latiendo || document.visibilityState !== "visible") return;
    latiendo = true;
    try {
      const tok = await gmGet("token");
      if (!tok) return;
      const r = await fetch(APP + "/bot/mp-latido", { method: "POST", headers: { "x-robot-token": tok, "content-type": "application/json" },
        body: JSON.stringify({ logueado: estaLogueado(), pagina: location.hostname + location.pathname }) });
      const j = await r.json();
      if (j.orden && !location.pathname.includes(j.orden)) {           // tocaste «Ir a firmar» en la app: vamos a esa compra
        await gmSet("pendiente", JSON.stringify({ cod: j.orden, t: Date.now() }));
        sessionStorage.removeItem("cotizagil-ir");
        location.href = urlCompra(j.orden);
      }
    } catch (e) {} finally { latiendo = false; }
  }
  setInterval(latir, 8000);
  document.addEventListener("visibilitychange", latir);
  window.addEventListener("pageshow", latir);
  setTimeout(latir, 1500);
  // quita recuadros de versiones antiguas (si quedaron instaladas dos copias)
  setInterval(() => {
    for (const e of document.querySelectorAll("body > div")) {
      if (e.dataset.cz15 !== "1" && /CotizÁgil · Firma rápida/.test(e.textContent || "") && e.style.bottom) e.remove();
    }
  }, 700);
  if (location.hostname === "www.mercadopublico.cl") {
    pendiente().then((c) => {
      if (!c) return;
      if (sessionStorage.getItem("cotizagil-ir-www") !== c) { sessionStorage.setItem("cotizagil-ir-www", c); location.href = urlCompra(c); return; }
      const a = document.createElement("a");
      a.href = urlCompra(c); a.textContent = "✍ Ir a la compra " + c;
      a.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:6px;z-index:2147483647;background:#7c4dff;color:#fff;" +
        "padding:7px 14px;border-radius:10px;font:600 13px system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.3)";
      document.body.append(a);
    });
    return;
  }

  // 2) En Mercado Público (aplicación de una sola página: se vigila la dirección)
  let token = null;

  // recuadro pequeño ARRIBA (no tapa el botón verde «Enviar cotización»); se minimiza tocando «–»
  const caja = document.createElement("div");
  caja.dataset.cz15 = "1";
  caja.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:6px;z-index:2147483647;width:min(92vw,340px);background:rgba(11,28,60,.95);color:#f6f8fc;" +
    "border:1.5px solid #7c4dff;border-radius:10px;padding:6px 10px;font:12px/1.35 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3)";
  let mini = false, ultimo = "";
  const pintar = () => {
    caja.innerHTML = mini
      ? "<div data-cz='abrir' style='cursor:pointer;text-align:center'>✍ CotizÁgil <span style='opacity:.7'>(ver)</span></div>"
      : "<div style='display:flex;justify-content:space-between;gap:8px'><b>CotizÁgil <span style='opacity:.6;font-weight:400'>v1.6</span></b><span data-cz='mini' style='cursor:pointer;padding:0 6px;font-size:15px;line-height:1'>–</span></div><div style='margin-top:3px'>" + ultimo + "</div>";
    caja.style.width = mini ? "auto" : "min(92vw,340px)";
    if (!caja.isConnected) document.body.append(caja);
  };
  // si Mercado Público abre una ventana (declaración jurada, confirmación), el recuadro desaparece para no tapar nada
  const hayVentana = () => /perjurio|art[ií]culo 210/i.test(document.body.innerText || "") ||
    [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some((e) => !caja.contains(e) && e.getBoundingClientRect().height > 0);
  setInterval(() => { if (caja.isConnected) caja.style.display = hayVentana() ? "none" : ""; }, 500);
  caja.addEventListener("click", (e) => { const a = e.target.closest("[data-cz]")?.dataset.cz; if (a === "mini") { mini = true; pintar(); } if (a === "abrir") { mini = false; pintar(); } });
  const decir = (html) => { ultimo = html; pintar(); };

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
    // terminaste de firmar («Cotización enviada correctamente»): el robot lo confirma, queda en «Enviados» y se cierra esta pestaña
    const okTexto = cod && /cotizaci[oó]n (fue )?enviada correctamente|tu cotizaci[oó]n fue enviada/i.test(document.body.innerText || "");
    const lista = publicada || (okTexto ? cod : null);
    if (lista && !hechas.has("v" + lista)) {
      hechas.add("v" + lista);
      gmSet("pendiente", "null");
      if (!token) return;
      const ua = navigator.userAgent;
      const disp = (await gmGet("dispositivo")) || (/iphone/i.test(ua) ? "iPhone" : /android/i.test(ua) ? "Android" : "Celular");
      try { await pedir("pedir", "json", { codigo: lista.toUpperCase(), accion: "verificar", dispositivo: disp }); decir("✓ Cotización enviada correctamente. El robot la confirma y queda en «Enviados». Cerrando esta pestaña…"); }
      catch (e) { decir("Enviada. Abre la app y toca «Ya la firmé» para confirmarla."); return; }
      setTimeout(() => { try { window.close(); } catch (e) {} setTimeout(() => { if (!document.hidden) location.replace(APP + "/#robot"); }, 600); }, 2500);
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
      "<br>" + adj + "<br><b>Ahora tú:</b> Enviar cotización → declaración → firma.");
    if (ok) setTimeout(() => { mini = true; pintar(); }, 4000);   // todo bien: se achica solo para dejarte firmar
  }
})();
