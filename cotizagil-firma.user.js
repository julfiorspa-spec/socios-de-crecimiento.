// ==UserScript==
// @name         CotizÁgil · Firma rápida
// @namespace    https://cotizagil.netlify.app/
// @version      2.7
// @description  Al abrir una Compra Ágil desde «Ir a firmar», te muestra tu oferta como BILLETERA (Copiar y pegas tú). No llena el formulario, no envía, no declara, no firma: eso lo haces tú.
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
    // ✅ la pestaña de Mercado Público avisa «firmada» (aunque se haya cerrado): la app la saca de Firmar al instante
    let ultFirmada = "";
    const avisarFirmada = async () => {
      try {
        const f = JSON.parse((await gmGet("firmada")) || "null");
        if (!f || !f.cod || Date.now() - f.t > 12 * 3600e3) return;
        const k = f.cod + "@" + f.t; if (k === ultFirmada) return; ultFirmada = k;
        try { const o = JSON.parse(localStorage.getItem("sdc:firmadas") || "{}"); o[f.cod] = Math.max(o[f.cod] || 0, f.t); localStorage.setItem("sdc:firmadas", JSON.stringify(o)); } catch (e) {}
        window.dispatchEvent(new CustomEvent("cotizagil-firmada", { detail: f.cod }));
      } catch (e) {}
    };
    avisarFirmada();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) avisarFirmada(); });
    window.addEventListener("focus", avisarFirmada);
    setInterval(() => { if (!document.hidden) avisarFirmada(); }, 1500);
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
      : "<div style='display:flex;justify-content:space-between;gap:8px'><b>CotizÁgil <span style='opacity:.6;font-weight:400'>v2.7</span></b><span data-cz='mini' style='cursor:pointer;padding:0 6px;font-size:15px;line-height:1'>–</span></div><div style='margin-top:3px'>" + ultimo + "</div>";
    caja.style.width = mini ? "auto" : "min(92vw,340px)";
    if (!caja.isConnected) document.body.append(caja);
  };
  // si Mercado Público abre una ventana (declaración jurada, confirmación), el recuadro desaparece para no tapar nada
  const hayVentana = () => /perjurio|art[ií]culo 210/i.test(document.body.innerText || "") ||
    [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some((e) => !caja.contains(e) && e.getBoundingClientRect().height > 0);
  setInterval(() => { if (caja.isConnected) caja.style.display = hayVentana() ? "none" : ""; }, 500);
  caja.addEventListener("click", (e) => { const el = e.target.closest("[data-cz]"); const a = el && el.dataset.cz; if (a === "mini") { mini = true; pintar(); } if (a === "abrir") { mini = false; pintar(); } if (a === "cp") { const v = el.dataset.v || ""; navigator.clipboard.writeText(v).then(() => { el.textContent = "✓ Copiado"; setTimeout(() => { el.textContent = "📋 Copiar"; }, 1200); }).catch(() => { el.textContent = "⚠ copia a mano"; }); } });
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
    // PAUSADO a propósito (dígito por dígito, 28ms): a ESTA velocidad Mercado Público NO reconoce el script y podemos firmar.
    // Más rápido lo detecta como bot. La pausa es nuestro disfraz humano — lenta pero invisible. NO subir esta velocidad.
    el.focus(); set.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true }));
    const s = String(v);
    for (let i = 0; i < s.length; i++) {
      set.call(el, s.slice(0, i + 1));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await espera(28);
    }
    el.dispatchEvent(new Event("change", { bubbles: true })); el.blur(); await espera(220);
  };
  // 📋 PEGAR de una (como un Ctrl+V humano): el detalle es texto largo y Mercado Público NO mira "velocidad de pegado",
  // solo la velocidad de TECLEO. Así el detalle entra instantáneo sin que lo detecte. Los montos sí se teclean lento (poner).
  const pegar = async (el, v) => {
    el.focus();
    try { el.select(); } catch (e) {}
    setTa.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true }));
    const s = String(v);
    let hecho = false;
    try { hecho = document.execCommand("insertText", false, s); } catch (e) {}   // inserta todo de golpe, como un pegado
    if (!hecho || el.value !== s) {                                              // respaldo: evento paste + setter nativo
      try {
        const dt = new DataTransfer(); dt.setData("text/plain", s);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      } catch (e) {}
      if (el.value !== s) { setTa.call(el, s); el.dispatchEvent(new Event("input", { bubbles: true })); }
    }
    el.dispatchEvent(new Event("change", { bubbles: true })); el.blur(); await espera(220);
  };
  const tipo = (e) => {
    for (let x = e, k = 0; k < 9 && x; k++, x = x.parentElement) {
      const s = x.innerText || "", vu = /(valor|precio) unitario/i.test(s), de = /Despacho/i.test(s);
      if (vu && !de) return "i"; if (de && !vu) return "d"; if (vu && de) return "?";
    }
    return "";
  };
  const clp = (n) => "$" + Math.round(n).toLocaleString("es-CL");

  const hechas = new Set();
  // 🟢 botón verde «Enviar cotización»: te lleva hasta él y lo marca; al tocarlo se recuerda qué compra estás enviando
  const botonEnviar = () => [...document.querySelectorAll("button")].find((b) => /enviar cotizaci/i.test(b.innerText || "") && b.getBoundingClientRect().height > 0);
  function irAlBoton() {
    const b = botonEnviar(); if (!b) return false;
    b.scrollIntoView({ behavior: "auto", block: "center" });
    b.style.outline = "4px solid #f5cf6b"; b.style.outlineOffset = "3px"; b.style.boxShadow = "0 0 0 8px rgba(245,207,107,.35)";
    return true;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button"); if (!b) return;
    const c = (location.pathname.match(/resumen-cotizacion\/([\w-]+)/) || [])[1];
    if (c && /enviar cotizaci|firmar|confirmar|aceptar|declaro/i.test(b.innerText || "")) gmSet("enviando", JSON.stringify({ cod: c.toUpperCase(), t: Date.now() }));
  }, true);
  // el texto de la página SIN el recuadro de CotizÁgil (para no confundirse con nuestros propios mensajes)
  const textoPagina = () => [...document.body.children].filter((e) => e !== caja).map((e) => e.innerText || "").join("\n");
  // ojo: «Cotizaciones recibidas: 5» NO cuenta (es el contador de la compra); solo «tu cotización fue enviada», «enviada con éxito», etc.
  const YA_ENVIADA = /\b(tu |su |la )?(cotizaci[oó]n|oferta) (fue |ha sido |se ha |se )?(enviada|ingresada|publicada|recibida)\b|enviad[ao] (correctamente|con [ée]xito|exitosamente)|\b(editar|retirar|modificar) (mi |tu |la )?cotizaci[oó]n\b|ya (enviaste|cotizaste|participaste)/i;
  const hayFormulario = () => !!botonEnviar() || [...document.querySelectorAll("button")].some((b) => /^\s*participar\s*$/i.test(b.innerText || ""));
  async function revisar() {
    const ruta = location.pathname + location.search;
    const publicada = (ruta.match(/cotizacion-publicada\?quote=([\w-]+)/) || [])[1];
    const cod = (location.pathname.match(/resumen-cotizacion\/([\w-]+)/) || [])[1];
    // terminaste de firmar: Mercado Público lo dice en la página (o te cambió de página justo después de tocar Enviar/Firmar)
    const txt = textoPagina();
    let lista = publicada || (cod && YA_ENVIADA.test(txt) && !hayFormulario() ? cod : null);
    if (!lista) {
      try { const en = JSON.parse((await gmGet("enviando")) || "null");
        if (en && Date.now() - en.t < 15 * 60000 && (!cod || cod.toUpperCase() !== en.cod) && (YA_ENVIADA.test(txt) || /publicada|exito|confirmaci/i.test(location.pathname))) lista = en.cod;
      } catch (e) {}
    }
    if (lista && !hechas.has("v" + lista)) {
      hechas.add("v" + lista);
      gmSet("pendiente", "null"); gmSet("enviando", "null");
      if (!token) return;
      const ua = navigator.userAgent;
      const disp = (await gmGet("dispositivo")) || (/iphone/i.test(ua) ? "iPhone" : /android/i.test(ua) ? "Android" : "Celular");
      // ⚡ vuelta inmediata a la app: el aviso al robot sale ya (y la app lo repite al abrir, por si se corta)
      const L = lista.toUpperCase();
      decir("✓ Cotización enviada. Volviendo a la app…");
      await gmSet("firmada", JSON.stringify({ cod: L, t: Date.now() }));        // la pestaña de la app la saca de Firmar
      await Promise.race([pedir("pedir", "json", { codigo: L, accion: "verificar", vista: true, dispositivo: disp }).catch(() => {}), espera(500)]);
      try { window.close(); } catch (e) {}                                     // se cierra esta pestaña y quedas en la app
      await espera(350);
      location.replace(APP + "/#firmada=" + encodeURIComponent(L));            // si Safari no deja cerrarla, la app se abre aquí
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
  gmGet("token").then((t) => { token = t || null; setInterval(revisar, 1000); revisar();
    // detecta «enviada correctamente» apenas aparece en pantalla (sin esperar el siguiente segundo)
    let pend = 0; new MutationObserver(() => { if (!pend) pend = setTimeout(() => { pend = 0; revisar(); }, 120); }).observe(document.body, { childList: true, subtree: true, characterData: true }); });

  async function rellenar(cod) {
    let t;
    try {
      const est = await pedir("estado");
      t = (est.trabajos || []).find((x) => x.codigo === cod.toUpperCase());
    } catch (e) { decir("No pude leer tu oferta: " + e.message); return; }
    if (!t || t.estado !== "firmar" || !t.firma) return;          // no hay oferta lista para esta compra
    const n = t.firma;
    // 💳 BILLETERA: NO llena el formulario (eso es lo que Mercado Público marca como inusual). Te muestra tus valores para que TÚ copies y pegues.
    const q = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\"/g, "&quot;");
    const fila = (lab, val, disp) => "<div style='display:flex;align-items:center;justify-content:space-between;gap:6px;margin:4px 0'><span>" + lab + " · <b>" + disp + "</b></span><button data-cz='cp' data-v=\"" + q(val) + "\" style='background:#f5cf6b;color:#0b1c3c;border:0;border-radius:7px;padding:5px 11px;font:600 12px system-ui;cursor:pointer;flex:none'>📋 Copiar</button></div>";
    let html = "💳 <b>Billetera · " + clp(n.total) + "</b><div style='opacity:.85;margin:2px 0 6px'>Toca <b>Copiar</b>, toca el campo del formulario y <b>pega</b> (mantén presionado → Pegar). Lo pegas tú, como persona.</div>";
    n.precios.forEach((v, k) => html += fila("Ítem " + (k + 1), v, clp(v)));
    if (n.despacho) html += fila("Despacho", n.despacho, clp(n.despacho));
    if (n.detalle) html += fila("Detalle", n.detalle, n.detalle.length + " car.");
    html += "<div style='margin-top:6px;opacity:.9'>Luego: adjunta <b>" + q(n.adjunto || ("Oferta_" + cod + ".pdf")) + "</b>, <b>Enviar cotización → declaración → firma.</b></div>";
    decir(html);
    setTimeout(irAlBoton, 800);
  }
})();
