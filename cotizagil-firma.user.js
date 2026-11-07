// ==UserScript==
// @name         CotizÁgil · Firma rápida
// @namespace    https://cotizagil.netlify.app/
// @version      2.9
// @description  Te lleva a la Compra Ágil que preparaste (una sola navegación, por tu toque) y avisa a la app cuando la enviaste. No llena el formulario, no copia, no envía, no declara, no firma: eso lo haces tú en Mercado Público.
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
  // registro de diagnóstico: hora, compra, origen y errores. NUNCA token ni datos sensibles.
  const log = (ev, d) => { try { console.log("[CotizÁgil]", new Date().toLocaleTimeString(), ev, d ? JSON.stringify(d) : ""); } catch (e) {} };
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
    // puente «Abrir compra» (ÚNICA entrada, por tu toque): /firmar.html#CODIGO → recuerda la compra y te lleva a ella
    const puente = location.pathname.startsWith("/firmar") && decodeURIComponent(location.hash.slice(1)).toUpperCase();
    if (puente === "CONECTAR") { location.replace("https://compra-agil.mercadopublico.cl/"); return; }
    if (puente && /-COT\d+$/.test(puente)) {
      log("puente", { cod: puente });
      gmSet("pendiente", JSON.stringify({ cod: puente, t: Date.now() })).then(() => {
        location.replace("https://compra-agil.mercadopublico.cl/resumen-cotizacion/" + encodeURIComponent(puente));
      });
      return;
    }
    // recuerda qué compra vas a firmar: si Mercado Público te pide iniciar sesión, después un botón te lleva a ella
    document.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest('[data-rb="ir-firmar"]');
      if (b && b.dataset.c) gmSet("pendiente", JSON.stringify({ cod: b.dataset.c, t: Date.now() }));
    }, true);
    return;
  }

  // ----- A partir de aquí: estás en Mercado Público -----
  const urlCompra = (c) => "https://compra-agil.mercadopublico.cl/resumen-cotizacion/" + encodeURIComponent(String(c).toUpperCase());
  const pendiente = async () => {
    try { const p = JSON.parse((await gmGet("pendiente")) || "null"); return p && Date.now() - p.t < 45 * 60000 ? p.cod : null; } catch (e) { return null; }
  };
  const estaLogueado = () => {
    const t = (document.body && document.body.innerText || "").slice(0, 6000);
    if (/cerrar sesi[oó]n|mis cotizaciones|mi cuenta|mis compras/i.test(t)) return true;
    if (/iniciar sesi[oó]n|ingresa con|clave[uú]nica/i.test(t)) return false;
    return /resumen-cotizacion|cotizacion-publicada/.test(location.pathname);
  };

  // ⛔ Mercado Público pidió verificar tu ingreso: NO seguimos abriendo compras solos.
  //    Conservamos la oferta preparada y te mandamos a los canales oficiales.
  const BLOQUEO = /comportamiento inusual|actividad inusual|demasiad[oa]s (intentos|solicitudes)|intenta (nuevamente )?m[aá]s tarde|acceso (no autorizado|denegado|restringido)|has sido bloquead|temporalmente bloquead/i;
  const hayBloqueoMP = () => BLOQUEO.test((document.body && document.body.innerText || "").slice(0, 4000));

  // ===== ÚNICO controlador de navegación =====
  // Una compra, una sola vez por sesión de pestaña, solo por una acción tuya y solo si NO hay bloqueo.
  let navegando = false;
  function irA(cod, origen) {
    if (!cod) return false;
    cod = String(cod).toUpperCase();
    if (navegando) { log("nav-omitida", { cod, origen, motivo: "en curso" }); return false; }
    if (location.pathname.includes(cod)) { log("nav-omitida", { cod, origen, motivo: "ya-aqui" }); return false; }
    const marca = "cz-nav:" + cod;
    try { if (sessionStorage.getItem(marca)) { log("nav-omitida", { cod, origen, motivo: "ya-abierta" }); return false; } } catch (e) {}
    if (hayBloqueoMP()) { log("nav-bloqueada", { cod, origen }); avisarBloqueo(); return false; }
    try { sessionStorage.setItem(marca, String(Date.now())); } catch (e) {}
    navegando = true;
    log("navegar", { cod, origen });
    location.href = urlCompra(cod);
    return true;
  }

  // ========= En www.mercadopublico.cl: solo un enlace que TÚ tocas (sin salto automático) =========
  if (location.hostname === "www.mercadopublico.cl") {
    pendiente().then((c) => {
      if (!c || hayBloqueoMP()) return;
      const a = document.createElement("a");
      a.href = urlCompra(c); a.textContent = "✍ Ir a la compra " + c;
      a.addEventListener("click", () => log("navegar", { cod: c, origen: "www-enlace" }));
      a.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:6px;z-index:2147483647;background:#7c4dff;color:#fff;" +
        "padding:7px 14px;border-radius:10px;font:600 13px system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.3)";
      document.body.append(a);
    });
    return;
  }

  // ========= En compra-agil.mercadopublico.cl =========
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
      : "<div style='display:flex;justify-content:space-between;gap:8px'><b>CotizÁgil <span style='opacity:.6;font-weight:400'>v2.9</span></b><span data-cz='mini' style='cursor:pointer;padding:0 6px;font-size:15px;line-height:1'>–</span></div><div style='margin-top:3px'>" + ultimo + "</div>";
    caja.style.width = mini ? "auto" : "min(92vw,340px)";
    if (!caja.isConnected) document.body.append(caja);
  };
  // si Mercado Público abre una ventana (declaración jurada, confirmación), el recuadro desaparece para no tapar nada
  const hayVentana = () => /perjurio|art[ií]culo 210/i.test(document.body.innerText || "") ||
    [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some((e) => !caja.contains(e) && e.getBoundingClientRect().height > 0);
  setInterval(() => { if (caja.isConnected) caja.style.display = hayVentana() ? "none" : ""; }, 700);
  caja.addEventListener("click", (e) => {
    const el = e.target.closest("[data-cz]"); const a = el && el.dataset.cz;
    if (a === "mini") { mini = true; pintar(); }
    if (a === "abrir") { mini = false; pintar(); }
    if (a === "abrir-compra") { mini = false; irA(el.dataset.c, "boton"); }
  });
  const decir = (html) => { ultimo = html; pintar(); };

  // botón (acción expresa del usuario) para abrir una compra pendiente, o aviso de bloqueo. Idempotente.
  let ultBoton = "";
  function avisarBloqueo() {
    if (ultBoton === "BLOQUEO") return; ultBoton = "BLOQUEO";
    decir("⚠ <b>Mercado Público pidió verificar tu ingreso.</b><div style='margin-top:4px;opacity:.92'>No seguiré abriendo compras solo. Verifica tu sesión en el portal; si el bloqueo persiste, es la Mesa de Ayuda de ChileCompra <b>600 7000 600</b>. Tu oferta sigue guardada en la app.</div>");
  }
  function ofrecerBoton(cod) {
    if (hayBloqueoMP()) { avisarBloqueo(); return; }
    const key = "A:" + String(cod).toUpperCase();
    if (key === ultBoton) return; ultBoton = key;
    decir("Tu app te mandó a la compra <b>" + String(cod).toUpperCase() + "</b>.<div style='margin:6px 0'><button data-cz='abrir-compra' data-c='" + String(cod).toUpperCase() + "' style='width:100%;background:#f5cf6b;color:#0b1c3c;border:0;border-radius:9px;padding:9px;font:700 14px system-ui;cursor:pointer'>▸ Abrir compra " + String(cod).toUpperCase() + "</button></div>");
  }

  // 1c) CONEXIÓN EN VIVO con la app: esta pestaña avisa «conectado» y recibe la compra que tocas en «Ir a firmar».
  //     El latido SOLO informa estado y ofrece un botón; NUNCA cambia la página solo.
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
      if (j.orden && !location.pathname.includes(j.orden)) {
        await gmSet("pendiente", JSON.stringify({ cod: j.orden, t: Date.now() }));
        log("latido-orden", { cod: j.orden });
        ofrecerBoton(j.orden);        // botón: lo abres TÚ (sin redirección automática)
      }
    } catch (e) { log("latido-error", { msg: String(e && e.message || e) }); } finally { latiendo = false; }
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
  }, 1500);

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
  const clp = (n) => "$" + Math.round(n).toLocaleString("es-CL");

  const hechas = new Set();
  // 🟢 botón verde «Enviar cotización»: te lleva hasta él; al tocarlo se recuerda qué compra estás enviando
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
    const publicada = (ruta.match(/cotizacion-publicada\?quote=([\w-]+)/) || [])[1];   // evidencia FUERTE: el portal cambió a la página de publicada
    const cod = (location.pathname.match(/resumen-cotizacion\/([\w-]+)/) || [])[1];
    // terminaste de firmar: el portal lo dice en la página (o te cambió a la página de «publicada» tras Enviar/Firmar)
    const txt = textoPagina();
    const porTexto = cod && YA_ENVIADA.test(txt) && !hayFormulario();
    let lista = publicada || (porTexto ? cod : null), evidencia = publicada ? "url-publicada" : (porTexto ? "texto-pantalla" : null);
    if (!lista) {
      try { const en = JSON.parse((await gmGet("enviando")) || "null");
        if (en && Date.now() - en.t < 15 * 60000 && (!cod || cod.toUpperCase() !== en.cod) && (YA_ENVIADA.test(txt) || /publicada|exito|confirmaci/i.test(location.pathname))) { lista = en.cod; evidencia = "cambio-de-pagina"; }
      } catch (e) {}
    }
    if (lista && !hechas.has("v" + lista)) {
      hechas.add("v" + lista);
      log("enviada", { cod: String(lista).toUpperCase(), evidencia });   // confirmación con evidencia (no solo por un clic)
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
    // Mercado Público pidió verificar: detenemos toda navegación automática y conservamos la oferta
    if (hayBloqueoMP()) { avisarBloqueo(); return; }
    if (!cod && !publicada) {                       // en otra página (p. ej. inicio tras iniciar sesión)
      const p = await pendiente();
      if (p) ofrecerBoton(p);                       // botón, no salto automático
      return;
    }
    if (!cod || hechas.has(cod)) return;
    hechas.add(cod);
    gmSet("pendiente", JSON.stringify({ cod: cod.toUpperCase(), t: Date.now() }));   // por si el portal te manda a iniciar sesión: al volver, un botón regresa aquí
    if (!token) { decir("Abre una vez la app <b>cotizagil.netlify.app</b> en este navegador (ya enlazada con el robot) y vuelve a esta página."); return; }
    await mostrarOferta(cod);
  }
  gmGet("token").then((t) => {
    token = t || null; setInterval(revisar, 2500); revisar();
    // detecta «enviada correctamente» apenas aparece en pantalla (sin esperar el siguiente ciclo)
    let pend = 0; new MutationObserver(() => { if (!pend) pend = setTimeout(() => { pend = 0; revisar(); }, 150); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  // SIN BILLETERA: no copiamos ni llenamos nada. Solo confirmamos que la oferta está lista en la app
  // y te recordamos que el envío, la declaración y la firma los haces TÚ en Mercado Público.
  async function mostrarOferta(cod) {
    let t;
    try {
      const est = await pedir("estado");
      t = (est.trabajos || []).find((x) => x.codigo === cod.toUpperCase());
    } catch (e) { decir("No pude leer tu oferta: " + e.message); log("oferta-error", { cod: cod.toUpperCase(), msg: e.message }); return; }
    if (!t || t.estado !== "firmar" || !t.firma) { decir("Esta compra no tiene una oferta lista para firmar en la app."); return; }
    const n = t.firma;
    log("oferta-lista", { cod: cod.toUpperCase() });
    decir("📋 Oferta lista: <b>" + clp(n.total) + "</b>.<div style='margin-top:4px;opacity:.9;font-size:11px'>Mira los precios y el detalle en <b>CotizÁgil</b>, adjunta <b>Oferta_" + cod.toUpperCase() + ".pdf</b>, y <b>tú</b>: completa → Enviar cotización → declaración → firmar.</div>");
    setTimeout(irAlBoton, 800);
  }
})();
