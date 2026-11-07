// ==UserScript==
// @name         CotizÁgil · Firma rápida
// @namespace    https://cotizagil.netlify.app/
// @version      3.2.1
// @description  Te lleva a tu Compra Ágil (una navegación, por tu toque) y rellena precios/despacho/detalle al pulsar Rellenar, con confirmación. No envía, no declara, no firma, no navega solo, no oculta la automatización: el envío y la firma los haces tú.
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
  'use strict';
  const APP = 'https://cotizagil.netlify.app';
  const MP = 'https://compra-agil.mercadopublico.cl';
  const CODE = /^[A-Z0-9-]+-COT\d+$/;
  const LOG_LIMIT = 80;
  const sessionLog = [];

  // Registro de diagnóstico (hora, evento, dato) SIN token ni credenciales.
  const debug = (event, data = '') => {
    const rec = { at: new Date().toISOString(), event, data: String(data).slice(0, 160) };
    sessionLog.push(rec);
    if (sessionLog.length > LOG_LIMIT) sessionLog.shift();
    try { console.log('[CotizÁgil]', rec.at, event, rec.data); } catch (_) {}
  };

  const gmGet = async (k) => {
    try { if (typeof GM !== 'undefined' && GM.getValue) return await GM.getValue(k); } catch (_) {}
    try { return typeof GM_getValue === 'function' ? GM_getValue(k) : undefined; } catch (_) { return undefined; }
  };
  const gmSet = async (k, v) => {
    try { if (typeof GM !== 'undefined' && GM.setValue) return await GM.setValue(k, v); } catch (_) {}
    if (typeof GM_setValue === 'function') return GM_setValue(k, v);
  };
  const parse = (raw, fallback = null) => { try { return JSON.parse(raw); } catch (_) { return fallback; } };
  const cleanCode = (value) => { const code = String(value || '').trim().toUpperCase(); return CODE.test(code) ? code : null; };
  const quoteUrl = (code) => `${MP}/resumen-cotizacion/${encodeURIComponent(code)}`;

  const text = (tag, content = '', className = '') => { const el = document.createElement(tag); el.textContent = String(content); if (className) el.className = className; return el; };
  const button = (label, fn, kind) => {
    const el = text('button', label);
    el.type = 'button';
    el.style.cssText = kind === 'ghost'
      ? 'background:transparent;color:#aebcdc;border:1px solid #33456b;border-radius:10px;padding:7px 12px;font:600 12px/1 system-ui;cursor:pointer'
      : 'background:linear-gradient(180deg,#ffdd87,#f3c65a);color:#0b1c3c;border:0;border-radius:13px;padding:13px 16px;font:700 14.5px/1 system-ui;cursor:pointer;flex:1 1 140px;min-width:140px;box-shadow:0 2px 7px rgba(0,0,0,.28)';
    el.addEventListener('pointerdown', () => { el.style.filter = 'brightness(.93)'; });
    const up = () => { el.style.filter = ''; };
    el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up);
    el.addEventListener('click', fn);
    return el;
  };
  const downloadLog = () => {
    const blob = new Blob([JSON.stringify({ version: '3.2.1', records: sessionLog }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'cotizagil-diagnostico.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const lastPending = async () => {
    const p = parse(await gmGet('pendiente'));
    if (!p || Date.now() - p.t > 45 * 60000) return null;
    return cleanCode(p.cod);
  };

  // ⛔ Mercado Público pidió verificar tu ingreso: NO seguimos abriendo compras ni rellenando.
  //    Conservamos la oferta preparada y derivamos a los canales oficiales de ChileCompra.
  const BLOQUEO = /comportamiento inusual|actividad inusual|demasiad[oa]s (intentos|solicitudes)|intenta (nuevamente )?m[aá]s tarde|acceso (no autorizado|denegado|restringido)|has sido bloquead|temporalmente bloquead/i;
  const hayBloqueoMP = () => BLOQUEO.test((document.body && document.body.innerText || '').slice(0, 4000));
  // la declaración jurada (perjurio / art. 210) es un acto legal tuyo: jamás la tocamos ni la rellenamos.
  const hayDeclaracion = () => /perjurio|art[ií]culo\s*210|declaraci[oó]n jurada/i.test((document.body && document.body.innerText || '').slice(0, 4000));

  // ===== ÚNICA navegación: una compra, una sola vez por sesión de pestaña, por acción tuya y solo si NO hay bloqueo =====
  let navegando = false;
  const openRequestedQuote = async (code) => {
    const valid = cleanCode(code);
    if (!valid) return;
    if (navegando) { debug('nav_omitida', valid + ' en-curso'); return; }
    if (location.pathname.includes(valid)) { debug('nav_omitida', valid + ' ya-aqui'); return; }
    try { if (sessionStorage.getItem('cz-nav:' + valid)) { debug('nav_omitida', valid + ' ya-abierta'); return; } } catch (_) {}
    if (hayBloqueoMP()) { debug('nav_bloqueada', valid); mostrarBloqueo(); return; }
    await gmSet('pendiente', JSON.stringify({ cod: valid, t: Date.now() }));
    try { sessionStorage.setItem('cz-nav:' + valid, String(Date.now())); } catch (_) {}
    navegando = true;
    debug('navegacion_usuario', valid);
    location.assign(quoteUrl(valid));   // navegación ÚNICAMENTE por acción del usuario
  };

  const getJson = async (path, token, body) => {
    const uri = `${APP}/bot/${path}`;
    const method = body ? 'POST' : 'GET';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      let response;
      try {
        response = await fetch(uri, { method, headers: { 'x-robot-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: 'no-store' });
      } finally { clearTimeout(timer); }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (e) {
      if (typeof GM_xmlhttpRequest !== 'function') throw e;
      return new Promise((resolve, reject) => GM_xmlhttpRequest({
        method, url: uri, data: body ? JSON.stringify(body) : undefined,
        headers: { 'x-robot-token': token, 'content-type': 'application/json' }, responseType: 'json', timeout: 12000,
        onload: (r) => r.status === 200 ? resolve(r.response) : reject(new Error(`HTTP ${r.status}`)),
        onerror: () => reject(new Error('Error de conexión')), ontimeout: () => reject(new Error('Tiempo de espera agotado')),
      }));
    }
  };

  const getBlob = async (path, tok) => {
    const uri = `${APP}/bot/${path}`;
    try {
      const r = await fetch(uri, { headers: { 'x-robot-token': tok }, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.blob();
    } catch (e) {
      if (typeof GM_xmlhttpRequest !== 'function') throw e;
      return new Promise((ok, mal) => GM_xmlhttpRequest({ method: 'GET', url: uri, headers: { 'x-robot-token': tok }, responseType: 'blob', timeout: 20000,
        onload: (r) => r.status === 200 ? ok(r.response) : mal(new Error('HTTP ' + r.status)), onerror: () => mal(new Error('Error de conexión')), ontimeout: () => mal(new Error('Tiempo agotado')) }));
    }
  };

  // ===================== En CotizÁgil: sincroniza token y confirma firmadas =====================
  if (location.hostname === 'cotizagil.netlify.app') {
    const robot = parse(localStorage.getItem('sdc:robot') || '{}', {});
    if (robot && typeof robot.token === 'string' && robot.token) gmSet('token', robot.token);
    const device = localStorage.getItem('sdc:dispositivo');
    if (device) gmSet('dispositivo', device);
    document.documentElement.dataset.firmaRapida = '1';

    const syncConfirmed = async () => {
      const receipt = parse(await gmGet('firmada'));
      if (!receipt || !cleanCode(receipt.cod) || Date.now() - receipt.t > 12 * 3600e3) return;
      const map = parse(localStorage.getItem('sdc:firmadas') || '{}', {});
      if ((map[receipt.cod] || 0) >= receipt.t) return;
      map[receipt.cod] = receipt.t;
      localStorage.setItem('sdc:firmadas', JSON.stringify(map));
      window.dispatchEvent(new CustomEvent('cotizagil-firmada', { detail: receipt.cod }));
    };
    syncConfirmed();
    window.addEventListener('focus', syncConfirmed);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncConfirmed(); });

    // Puente «Abrir compra» (compatibilidad): muestra un botón; NUNCA redirige solo.
    const bridge = location.pathname.startsWith('/firmar') ? decodeURIComponent(location.hash.slice(1)) : '';
    const pendingCode = cleanCode(bridge);
    if (pendingCode || bridge.toUpperCase() === 'CONECTAR') {
      const p = document.createElement('div');
      p.style.cssText = 'max-width:540px;margin:20px auto;padding:16px;background:#10223d;color:white;border-radius:12px;font:14px system-ui;position:relative;z-index:2147483647';
      p.append(text('h3', 'CotizÁgil · Abrir Mercado Público'));
      p.append(text('p', pendingCode ? `Compra ${pendingCode}. Se abrirá solo cuando presiones el botón.` : 'Abre Mercado Público para iniciar sesión.'));
      p.append(button('Abrir Mercado Público', () => pendingCode ? openRequestedQuote(pendingCode) : location.assign(MP + '/')));
      document.body.append(p);
      debug('puente_esperando_clic', pendingCode || 'conectar');
    }
    return;
  }

  // ===================== En www.mercadopublico.cl: solo un enlace que TÚ tocas =====================
  if (location.hostname === 'www.mercadopublico.cl') {
    lastPending().then((c) => {
      if (!c || hayBloqueoMP()) return;
      const a = document.createElement('a');
      a.href = quoteUrl(c); a.textContent = '✍ Ir a la compra ' + c;
      a.addEventListener('click', () => debug('navegacion_usuario', c + ' www'));
      a.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:6px;z-index:2147483647;background:#7c4dff;color:#fff;padding:7px 14px;border-radius:10px;font:600 13px system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.3)';
      document.body.append(a);
    });
    return;
  }

  // ===================== En compra-agil.mercadopublico.cl: panel + rellenado asistido =====================
  const panel = document.createElement('aside');
  panel.dataset.cotizagil29 = '1';
  panel.style.cssText = 'position:fixed;top:max(8px,env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:2147483000;width:min(94vw,392px);max-height:74vh;overflow:auto;background:linear-gradient(180deg,#17294c,#0f1d36);color:#eef2fb;border:1px solid #3b4d78;border-radius:18px;padding:15px 15px 13px;font:13px/1.45 -apple-system,system-ui,sans-serif;box-shadow:0 12px 36px rgba(0,0,0,.45)';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
  const marca = text('div'); marca.innerHTML = "<b style='font-size:15.5px;letter-spacing:.2px'>CotizÁgil</b> <span style='opacity:.45;font-size:11px'>v3.2.1</span>";
  const chev = text('span', '–'); chev.style.cssText = 'cursor:pointer;font-size:22px;line-height:1;opacity:.6;padding:0 6px';
  head.append(marca, chev); panel.append(head);
  const message = text('div', 'Preparando oferta…'); message.style.cssText = 'margin-top:9px;opacity:.95'; panel.append(message);
  const actions = document.createElement('div'); actions.style.cssText = 'margin-top:12px;display:flex;flex-wrap:wrap;gap:9px'; panel.append(actions);
  const foot = document.createElement('div'); foot.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid #243459;display:flex;gap:8px;flex-wrap:wrap'; panel.append(foot);
  foot.append(button('🩺 Diagnóstico', downloadLog, 'ghost'));
  let minimized = false;
  chev.addEventListener('click', () => { minimized = !minimized; message.hidden = actions.hidden = foot.hidden = minimized; chev.textContent = minimized ? '+' : '–'; });
  document.body.append(panel);
  const say = (t) => { message.textContent = String(t); };

  let ultBloqueo = false;
  function mostrarBloqueo() {
    if (ultBloqueo) return; ultBloqueo = true;
    actions.replaceChildren();
    say('⚠ Mercado Público pidió verificar tu ingreso. No seguiré abriendo compras ni rellenando. Verifica tu sesión en el portal; si el bloqueo persiste, es la Mesa de Ayuda de ChileCompra 600 7000 600. Tu oferta sigue guardada en la app.');
    debug('bloqueo_detectado', location.pathname);
  }

  const getPathCode = () => { const m = location.pathname.match(/^\/resumen-cotizacion\/([^/]+)/i); return m ? cleanCode(decodeURIComponent(m[1])) : null; };
  const confirmedCode = () => { if (!/cotizacion-publicada/i.test(location.pathname)) return null; return cleanCode(new URLSearchParams(location.search).get('quote')); };

  let lastPath = '', currentCode = '', loading = false, token = null;

  // ---- Latido de estado: la app muestra «🟢 conectado». SOLO informa; nunca cambia la página ----
  const estaLogueado = () => {
    const t = (document.body && document.body.innerText || '').slice(0, 6000);
    if (/cerrar sesi[oó]n|mis cotizaciones|mi cuenta|mis compras/i.test(t)) return true;
    if (/iniciar sesi[oó]n|ingresa con|clave[uú]nica/i.test(t)) return false;
    return /resumen-cotizacion|cotizacion-publicada/.test(location.pathname);
  };
  let latiendo = false;
  const latir = async () => {
    if (latiendo || document.hidden || !token) return;
    latiendo = true;
    try {
      const j = await getJson('mp-latido', token, { logueado: estaLogueado(), pagina: location.hostname + location.pathname });
      if (j && j.orden && !location.pathname.includes(j.orden)) {
        await gmSet('pendiente', JSON.stringify({ cod: cleanCode(j.orden) || j.orden, t: Date.now() }));
        debug('latido_orden', j.orden);
        if (!getPathCode() && !confirmedCode()) renderPending();   // ofrece botón (no redirige)
      }
    } catch (e) { debug('latido_error', e.message); } finally { latiendo = false; }
  };

  const renderPending = async () => {
    actions.replaceChildren();
    const pending = await lastPending();
    if (pending) {
      say(`Compra pendiente: ${pending}. El script no redirige solo.`);
      actions.append(button(`Abrir ${pending}`, () => openRequestedQuote(pending)));
    } else {
      say('Abre una compra desde CotizÁgil. El botón Rellenar aparecerá aquí.');
    }
  };

  // ---- Identificación de campos visibles (por etiqueta, no por posición) ----
  const visible = (el) => !!(el && el.isConnected && el.getClientRects().length && !el.disabled && !el.readOnly);
  const fieldText = (el) => {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const labelled = ids.map(id => document.getElementById(id)?.textContent || '').join(' ');
    const label = el.labels ? [...el.labels].map(x => x.textContent || '').join(' ') : '';
    const near = el.closest('tr, [role="row"], .form-group, .form-field, mat-form-field, .row, fieldset, li') || el.parentElement?.parentElement;
    return [label, labelled, el.getAttribute('aria-label'), el.placeholder, el.name, el.id, near?.textContent?.slice(0, 350)].filter(Boolean).join(' ').toLowerCase();
  };
  const allFields = () => [...document.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),textarea')].filter(visible).filter(el => !panel.contains(el));
  const textValue = (value) => String(value ?? '').trim();
  const validAmount = (v) => /^\d+(?:[.,]\d+)?$/.test(textValue(v));

  // Escritura directa (NO simula tecleo humano, NO oculta la automatización, NO envía).
  // Dispara la secuencia de eventos estándar para que el formulario (Angular/React) reconozca
  // el valor y HABILITE «Enviar cotización» (si no, el botón queda gris).
  const soloDig = (s) => String(s).replace(/\D/g, '');
  const writeField = (el, value) => {
    const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) throw new Error('Campo no compatible');
    const v = textValue(value);
    el.focus();
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(el, v);
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: 'insertText' })); }
    catch (_) { el.dispatchEvent(new Event('input', { bubbles: true })); }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.blur();
    const num = /^\d+(?:[.,]\d+)?$/.test(v);               // el portal a veces agrega puntos de miles
    return num ? soloDig(el.value) === soloDig(v) : (el.value || '').trim() === v;
  };

  // ---- Botón RELLENAR: precios/despacho/detalle, con confirmación. Nunca la declaración ni el envío. ----
  //      solo = 'precio' | 'despacho' | 'detalle' | null (todo)
  const previewAndFill = (offer, code, solo) => {
    if (hayBloqueoMP()) { mostrarBloqueo(); return; }
    if (hayDeclaracion()) { say('No rellenaré con la declaración jurada abierta: eso lo marcas y firmas tú.'); debug('rellenado_abortado', 'declaracion-' + code); return; }
    const fields = allFields();
    const inputs = fields.filter(el => el.tagName === 'INPUT');
    // clasifica cada input por el texto de sus ancestros: en el formulario de MP la etiqueta
    // «Valor unitario»/«Despacho» está en un bloque superior, NO envolviendo al campo.
    const clase = (el) => {
      for (let x = el, k = 0; k < 9 && x; k++, x = x.parentElement) {
        const s = x.innerText || '';
        const vu = /(valor|precio|monto)\s*unitario/i.test(s);
        const de = /despacho|flete|transporte/i.test(s);
        if (vu && !de) return 'i';
        if (de && !vu) return 'd';
        if (vu && de) return '';   // ambos en este nivel: subimos demasiado, ambiguo
      }
      return '';
    };
    const amounts = (Array.isArray(offer.precios) ? offer.precios : []).map(textValue);
    const problems = [], assigned = new Set(), tasks = [];
    if (!amounts.length) problems.push('La oferta no contiene precios por ítem.');
    if (amounts.some(x => !validAmount(x))) problems.push('Uno o más precios tienen formato no válido.');

    const priceFields = inputs.filter(el => clase(el) === 'i');
    if (priceFields.length !== amounts.length) {
      problems.push(`Se encontraron ${priceFields.length} campos de precio para ${amounts.length} ítems. No se completarán los precios hasta revisar esa diferencia.`);
    } else {
      amounts.forEach((v, i) => { tasks.push({ tipo: 'precio', label: `Ítem ${i + 1}`, el: priceFields[i], value: v }); assigned.add(priceFields[i]); });
    }
    const selectUnique = (pattern, exclude = null) => fields.filter(el => !assigned.has(el) && (!exclude || !exclude(el)) && pattern.test(fieldText(el)));

    if (offer.despacho !== undefined && offer.despacho !== null && textValue(offer.despacho) !== '') {
      const matches = inputs.filter(el => !assigned.has(el) && clase(el) === 'd');
      if (matches.length === 1 && validAmount(offer.despacho)) { tasks.push({ tipo: 'despacho', label: 'Despacho', el: matches[0], value: offer.despacho }); assigned.add(matches[0]); }
      else problems.push(`Despacho: ${matches.length} campos compatibles; revisión manual.`);
    }
    if (textValue(offer.detalle)) {
      const matches = selectUnique(/detalle|descripci[oó]n|observacion|observaci[oó]n/i, el => el.tagName !== 'TEXTAREA');
      if (matches.length === 1) { tasks.push({ tipo: 'detalle', label: 'Detalle', el: matches[0], value: offer.detalle }); assigned.add(matches[0]); }
      else problems.push(`Detalle: ${matches.length} campos compatibles; revisión manual.`);
    }
    const run = solo ? tasks.filter(t => t.tipo === solo) : tasks;
    const avisos = solo ? problems.filter(p => new RegExp(solo, 'i').test(p)) : problems;
    if (!run.length) { say(`No encontré campos de ${solo || 'oferta'} para ${code}. ` + (avisos.length ? avisos.join(' ') : 'Revisa el formulario.')); debug('sin_campos_compatibles', (solo || 'todo') + '-' + code); return; }

    const confirmed = window.confirm(`CotizÁgil rellenará ${run.length} campo(s) de ${code}:\n` + run.map(t => t.label).join(', ') + '.\n\n' + (avisos.length ? 'Avisos:\n' + avisos.join('\n') + '\n\n' : '') + 'Revisa TODOS los valores y haz tú el envío, la declaración y la firma. ¿Continuar?');
    if (!confirmed) { debug('rellenado_cancelado', (solo || 'todo') + '-' + code); return; }

    let completed = 0;
    for (const task of run) {
      try { if (visible(task.el) && writeField(task.el, task.value)) completed++; else avisos.push(`${task.label}: no se confirmó la escritura.`); }
      catch (_) { avisos.push(`${task.label}: error al completar el campo.`); }
    }
    say(`${completed}/${run.length} campos completados para ${code}. ` + (avisos.length ? 'Avisos: ' + avisos.join(' ') : 'Revisa los montos; el envío y la firma los haces tú.'));
    debug('rellenado_por_usuario', `${code} ${solo || 'todo'}=${completed}/${run.length}`);
  };

  // ---- Botón ADJUNTAR ARCHIVO: baja el PDF de la app y lo pone en «Adjuntar archivos». No envía. ----
  const adjuntar = async (offer, code) => {
    if (hayBloqueoMP()) { mostrarBloqueo(); return; }
    const nombre = (offer && offer.adjunto) || ('Oferta_' + code + '.pdf');
    const fileInput = [...document.querySelectorAll('input[type=file]')].find(visible) || document.querySelector('input[type=file]');
    if (!fileInput) { say('No veo el campo «Adjuntar archivos». Baja hasta esa sección y vuelve a tocar Adjuntar.'); debug('adjuntar_sin_campo', code); return; }
    say(`Bajando ${nombre}…`);
    let blob;
    try { blob = await getBlob('pdf?codigo=' + encodeURIComponent(code), token); }
    catch (e) { say(`No pude bajar el PDF (${e.message}). Súbelo a mano: ${nombre}.`); debug('pdf_error', e.message); return; }
    try {
      const dt = new DataTransfer();
      dt.items.add(new File([blob], nombre, { type: 'application/pdf' }));
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) { say(`El navegador no dejó adjuntar el archivo (${e.message}). Súbelo a mano: ${nombre}.`); debug('adjuntar_error', e.message); return; }
    let ok = false;
    for (let i = 0; i < 24; i++) { if ((document.body.innerText || '').includes(nombre)) { ok = true; break; } await new Promise(r => setTimeout(r, 250)); }
    say(ok ? `✓ ${nombre} adjunto. Revisa, y haz TÚ el envío y la firma.` : `Intenté adjuntar ${nombre}. Si no aparece en «Adjuntar archivos», súbelo a mano (el celular a veces no deja adjuntar por script).`);
    debug('adjuntar', `${code} ${ok ? 'ok' : 'sin-confirmar'}`);
  };

  // ---- Oferta desde CotizÁgil ----
  const showWallet = async (code) => {
    if (loading || code === currentCode) return;
    loading = true; currentCode = code;
    actions.replaceChildren(); say(`Cargando oferta ${code}…`); debug('compra_abierta', code);
    try {
      token = token || await gmGet('token');
      if (!token) { say('Abre CotizÁgil una vez en este navegador para conectar el token.'); return; }
      const result = await getJson('estado', token);
      const work = (result.trabajos || []).find(t => cleanCode(t.codigo) === code);
      if (!work || work.estado !== 'firmar' || !work.firma) { say('Esta compra no tiene una oferta lista para firmar en CotizÁgil.'); return; }
      const offer = work.firma;
      say(`Oferta ${code} · ${Number(offer.total || 0).toLocaleString('es-CL')} CLP. Rellena, adjunta, y envía y firma tú.`);
      actions.append(button('✍ Rellenar', () => previewAndFill(offer, code)));
      actions.append(button('📎 Adjuntar archivos', () => adjuntar(offer, code)));
      foot.replaceChildren(button('↻ Actualizar', () => { currentCode = ''; showWallet(code); }, 'ghost'), button('🩺 Diagnóstico', downloadLog, 'ghost'));
      debug('rellenado_disponible', code);
    } catch (e) { say(`No se pudo cargar la oferta (${e.message}). No se realizó ninguna acción en el portal.`); debug('error_carga', e.message); }
    finally { loading = false; }
  };

  // ---- Control de ruta (sin redirigir) ----
  const assessRoute = async () => {
    const route = location.pathname + location.search;
    if (route === lastPath) return;
    lastPath = route;
    if (hayBloqueoMP()) { mostrarBloqueo(); return; }
    ultBloqueo = false;

    const confirmed = confirmedCode();
    if (confirmed) {
      debug('pagina_publicada', confirmed);
      actions.replaceChildren();
      say(`Mercado Público muestra la página de publicación para ${confirmed}. Confirma visualmente que la oferta fue recibida.`);
      actions.append(button('Confirmé recepción en el portal', async () => {
        await gmSet('firmada', JSON.stringify({ cod: confirmed, t: Date.now() }));
        await gmSet('pendiente', 'null');
        debug('confirmacion_manual', confirmed);
        if (token) { const ua = navigator.userAgent; const disp = (await gmGet('dispositivo')) || (/iphone/i.test(ua) ? 'iPhone' : /android/i.test(ua) ? 'Android' : 'Celular'); getJson('pedir', token, { codigo: confirmed, accion: 'verificar', vista: true, dispositivo: disp }).catch(() => {}); }
        say(`Confirmación guardada para ${confirmed}. Puedes regresar a CotizÁgil.`);
        actions.replaceChildren(button('Volver a CotizÁgil', () => location.assign(APP + '/#firmada=' + encodeURIComponent(confirmed))));
      }));
      return;
    }
    const code = getPathCode();
    if (code) { await showWallet(code); return; }
    currentCode = '';
    await renderPending();
  };

  gmGet('token').then((t) => {
    token = t || null;
    assessRoute();
    // arranca el latido de estado (cada 8 s; solo informa)
    setInterval(latir, 8000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) latir(); });
    setTimeout(latir, 1500);
  });

  // Detectar cambios de ruta sin redirigir (SPA).
  const nativePush = history.pushState.bind(history), nativeReplace = history.replaceState.bind(history);
  history.pushState = function (...a) { const r = nativePush(...a); queueMicrotask(assessRoute); return r; };
  history.replaceState = function (...a) { const r = nativeReplace(...a); queueMicrotask(assessRoute); return r; };
  window.addEventListener('popstate', assessRoute);
  setInterval(() => { if (!document.hidden && location.pathname + location.search !== lastPath) assessRoute(); }, 2500);
})();
