/* CotizÁgil · Robot PJANIC
   Conecta la app del celular con el robot del PC.
   - "Hacer oferta" en cada Compra Ágil: el robot del PC lee la ficha, analiza los adjuntos, calcula el
     precio, genera la cotización con render y deja el formulario cargado en Mercado Público.
   - El envío final y la declaración jurada los confirma siempre la persona en el portal.
   - Estados: En cola · Preparando · Falta tu clic · Enviada (verde) · Confirmada (dorado, se puede editar).
   El código de enlace se guarda solo en este teléfono (nunca en el código de la app). */
(function () {
  "use strict";
  const KEY = "sdc:robot";
  const POLL_RAPIDO = 5000, POLL_LENTO = 30000;
  const REMOTO_DEF = "https://remotedesktop.google.com/access";
  const VISTAS = [["lista", "Lista"], ["cajas", "Cajas"], ["tablero", "Tablero"], ["oport", "💰 Oportunidades"]];
  // columnas del tablero (etapas del trabajo)
  const COLUMNAS = [
    ["Por hacer", ["en_cola", "probada", "cancelada"]],
    ["Preparando", ["tomado", "preparando"]],
    ["Para firmar", ["firmar", "lista"]],
    ["Atención", ["requiere", "error"]],
    ["Enviadas", ["enviada", "confirmada"]],
  ];
  const COD_CA = /^\d{1,8}-\d{1,8}-COT\d{2}$/i;
  const COD_CA_G = /\d{1,8}-\d{1,8}-COT\d{2}/gi;
  // botón «Rellenar» (marcador): se usa en TU navegador, en la página de la cotización de Mercado Público.
  // Pone precios, despacho y detalle; NO adjunta, NO envía y NO declara (eso lo haces tú).
  const RELLENAR = "(async()=>{const d=(prompt(\"CotizÁgil · Pega aquí el código de la oferta (lo copiaste en la app con «Copiar código Rellenar»):\")||\"\").trim();if(!d)return;const n=d.split(\"|\");if(n[0]!==\"CA1\"||n.length<6){alert(\"Ese no es un código de CotizÁgil. Cópialo de nuevo en la app.\");return}const c=n[1],S=n[2],a=n[3].split(\",\"),f=+n[5];let i=\"\";try{i=decodeURIComponent(escape(atob(n[4])))}catch{i=\"\"}if(!location.href.includes(c)&&!confirm(\"Esta página no parece ser la compra \"+c+\". ¿Rellenar de todos modos?\"))return;const g=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,\"value\").set,x=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,\"value\").set,m=e=>new Promise(t=>setTimeout(t,e)),s=async(e,t,l)=>{e.scrollIntoView({block:\"center\"}),e.focus(),l.call(e,\"\"),e.dispatchEvent(new Event(\"input\",{bubbles:!0})),l.call(e,String(t)),e.dispatchEvent(new Event(\"input\",{bubbles:!0})),e.dispatchEvent(new Event(\"change\",{bubbles:!0})),e.blur(),e.dispatchEvent(new Event(\"focusout\",{bubbles:!0})),await m(250)},b=e=>{for(let t=e,l=0;l<9&&t;l++,t=t.parentElement){const T=t.innerText||\"\",p=/Valor unitario/.test(T),u=/Despacho/i.test(T);if(p&&!u)return\"i\";if(u&&!p)return\"d\";if(p&&u)return\"?\"}return\"\"},v=document.querySelector(\"main\")||document.body,h=[...v.querySelectorAll(\"input[type=text]:not([disabled]), input:not([type]):not([disabled])\")],o=h.filter(e=>b(e)===\"i\"),y=h.filter(e=>b(e)===\"d\");if(!o.length){alert(\"No encontré los campos «Valor unitario». Abre el formulario de la cotización (botón Participar o Enviar nueva cotización) y vuelve a tocar Rellenar.\");return}if(o.length!==a.length){alert(\"El formulario tiene \"+o.length+\" ítems y la oferta \"+a.length+\". Revisa la oferta en la app; no se rellenó nada.\");return}for(let e=0;e<o.length;e++)await s(o[e],a[e],g);y[0]&&await s(y[0],S,g);const E=v.querySelector(\"textarea\");E&&i&&await s(E,i.slice(0,255),x),await m(700);const w=e=>String(e||\"\").replace(/\\D/g,\"\"),C=o.map((e,t)=>w(e.value)===w(a[t])?null:\"ítem \"+(t+1)+\" debe ser $\"+(+a[t]).toLocaleString(\"es-CL\")).filter(Boolean),L=[...document.body.innerText.matchAll(/Monto total\\s*\\n*\\s*\\$\\s*([\\d.]+)/g)].pop(),r=L?+L[1].replace(/\\./g,\"\"):null,z=r!=null&&Math.abs(r-f)<=50;alert((C.length?\"⚠ Corrige a mano: \"+C.join(\"; \")+`\n\n`:\"\")+(z?\"✓ Total del portal $\"+r.toLocaleString(\"es-CL\")+\" = oferta.\":\"⚠ Total del portal \"+(r==null?\"no encontrado\":\"$\"+r.toLocaleString(\"es-CL\"))+\" · oferta $\"+f.toLocaleString(\"es-CL\")+\". Revisa antes de enviar.\")+`\n\nAhora tú: adjunta Oferta_`+c+\".pdf, presiona «Enviar cotización», marca la declaración y firma.\")})();";
  // marcador personal: lee tu oferta desde la app con tu código de enlace (no hay que pegar nada) y adjunta el PDF
  const RELLENAR_PERSONAL = "(async()=>{const g=\"__TOKEN__\",x=\"https://cotizagil.netlify.app/bot/\",a=t=>{let e=document.getElementById(\"cotizagil-aviso\");e||(e=document.createElement(\"div\"),e.id=\"cotizagil-aviso\",e.style.cssText=\"position:fixed;left:10px;right:10px;bottom:10px;z-index:2147483647;background:#0b1c3c;color:#fff;border:2px solid #7c4dff;border-radius:14px;padding:12px;font:15px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)\",e.onclick=()=>e.remove(),document.body.append(e)),e.innerHTML=\"<b>CotizÁgil</b><br>\"+t+\"<br><small style='opacity:.7'>(toca para cerrar)</small>\"},c=(location.pathname.match(/resumen-cotizacion\\/([\\w-]+)/)||[])[1];if(!c){a(\"Abre primero la compra en Mercado Público (botón «Ir a firmar» de la app).\");return}a(\"Cargando tu oferta…\");let l;try{l=((await fetch(x+\"estado\",{headers:{\"x-robot-token\":g}}).then(e=>e.json())).trabajos||[]).find(e=>e.codigo===c.toUpperCase())}catch(t){a(\"No pude conectar con la app: \"+t.message);return}if(!l||!l.firma){a(\"No hay una oferta lista para firmar de \"+c+\".\");return}const n=l.firma,d=t=>new Promise(e=>setTimeout(e,t)),v=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,\"value\").set,P=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,\"value\").set,u=async(t,e,o)=>{t.focus();o.call(t,\"\");t.dispatchEvent(new Event(\"input\",{bubbles:!0}));const s=String(e);for(let _i=0;_i<s.length;_i++){o.call(t,s.slice(0,_i+1));t.dispatchEvent(new Event(\"input\",{bubbles:!0}));await d(28)}t.dispatchEvent(new Event(\"change\",{bubbles:!0}));t.blur();await d(220)},w=t=>{for(let e=t,o=0;o<9&&e;o++,e=e.parentElement){const i=e.innerText||\"\",h=/(valor|precio) unitario/i.test(i),y=/Despacho/i.test(i);if(h&&!y)return\"i\";if(y&&!h)return\"d\";if(h&&y)return\"?\"}return\"\"};let r=[],f=[];for(let t=0;t<40;t++){const e=[...document.querySelectorAll(\"main input[type=text]:not([disabled]), main input[type=number]:not([disabled]), main input[type=tel]:not([disabled]), main input[inputmode=numeric]:not([disabled]), main input:not([type]):not([disabled])\")];if(r=e.filter(o=>w(o)===\"i\"),f=e.filter(o=>w(o)===\"d\"),r.length)break;await d(500)}if(!r.length){a(\"No veo el formulario. Presiona «Participar» y vuelve a tocar Rellenar.\");return}if(r.length!==n.precios.length){a(\"⚠ El formulario tiene \"+r.length+\" ítems y la oferta \"+n.precios.length+\". No toqué nada.\");return}for(let t=0;t<r.length;t++)await u(r[t],n.precios[t],v);f[0]&&await u(f[0],n.despacho||0,v);const T=document.querySelector(\"main textarea\");T&&n.detalle&&await u(T,n.detalle.slice(0,255),P);const p=n.adjunto||\"Oferta_\"+c+\".pdf\";let b=document.body.innerText.includes(p);if(!b&&l.pdf)try{const t=await fetch(x+\"pdf?codigo=\"+encodeURIComponent(c),{headers:{\"x-robot-token\":g}}).then(i=>i.blob()),e=new DataTransfer;e.items.add(new File([t],p,{type:\"application/pdf\"}));const o=document.querySelector(\"input[type=file]\");o.files=e.files,o.dispatchEvent(new Event(\"change\",{bubbles:!0}));for(let i=0;i<40&&!document.body.innerText.includes(p);i++)await d(500);b=document.body.innerText.includes(p)}catch{}await d(600);const E=[...document.body.innerText.matchAll(/Monto total\\s*\\n*\\s*\\$\\s*([\\d.]+)/g)].pop(),s=E?+E[1].replace(/\\./g,\"\"):null,m=t=>\"$\"+Math.round(t).toLocaleString(\"es-CL\"),j=s!=null&&Math.abs(s-n.total)<=50,k=[...document.querySelectorAll(\"button\")].find(t=>/Enviar cotizaci/i.test(t.innerText));k&&k.scrollIntoView({block:\"center\"}),a((j?\"✓ Total \"+m(s)+\" = oferta.\":\"⚠ Total portal \"+(s==null?\"?\":m(s))+\" · oferta \"+m(n.total)+\". Revisa.\")+\"<br>\"+(b?\"✓ PDF adjunto.\":\"⚠ Adjunta el PDF a mano.\")+\"<br><b>Ahora tú: Enviar cotización → declaración → firmar.</b>\")})();";
  const marcador = () => "javascript:" + encodeURIComponent(R.token ? RELLENAR_PERSONAL.replace("__TOKEN__", R.token) : RELLENAR);
  const b64utf8 = (t) => btoa(unescape(encodeURIComponent(t)));
  const codigoRellenar = (t) => ["CA1", t.codigo, t.firma.despacho || 0, t.firma.precios.join(","), b64utf8(t.firma.detalle || ""),
    t.firma.total || t.total || 0].join("|");
  const firmaRapida = () => document.documentElement.dataset.firmaRapida === "1";   // extensión Tampermonkey instalada
  const portalDe = (cod) => `https://compra-agil.mercadopublico.cl/resumen-cotizacion/${encodeURIComponent(cod)}`;
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch {}
    try {
      const ta = document.createElement("textarea"); ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.append(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch { return false; }
  }

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clp = (n) => n == null || isNaN(n) ? "—" : "$" + Math.round(n).toLocaleString("es-CL");
  // 💰 tope legal de la Compra Ágil: 100 UTM (valor SII del mes; ofertas sobre el presupuesto permitidas hasta ese tope)
  const UTM = { "2026-09": 71721, "2026-10": 72151, "2026-11": 72440 };
  const utmHoy = () => { const k = new Date().toISOString().slice(0, 7), ks = Object.keys(UTM).sort(); return UTM[k] || UTM[ks.filter((x) => x <= k).pop() || ks[0]]; };
  const TOPE_CA = () => 100 * utmHoy();
  // barra en 2 tramos: 75% del recorrido = −50%…+50% del presupuesto (precisión), 25% final = hasta las 100 UTM
  const tramos = (r) => { const lo = +r.dataset.lo, mid = +r.dataset.mid, hi = +r.dataset.hi; return { lo, mid, hi, k: hi > mid ? 0.75 : 1 }; };
  const precioDe = (r) => { const { lo, mid, hi, k } = tramos(r), p = +r.value / 1000;
    const v = p <= k ? lo + (Math.min(mid, hi) - lo) * p / k : mid + (hi - mid) * (p - k) / (1 - k); return Math.round(v / 10) * 10; };
  const posDe = (r, v) => { const { lo, mid, hi, k } = tramos(r); v = Math.max(lo, Math.min(hi, v));
    return Math.round(1000 * (v <= Math.min(mid, hi) ? (v - lo) / ((Math.min(mid, hi) - lo) || 1) * k : k + (v - mid) / ((hi - mid) || 1) * (1 - k))); };
  const cortoG = (n) => Math.abs(n) >= 1e6 ? (n < 0 ? "−" : "") + "$" + (Math.abs(n) / 1e6).toFixed(Math.abs(n) >= 1e7 ? 0 : 1).replace(".", ",") + "M" : clp(n);
  // números que «suben» al aparecer (sensación de crecer); solo animan cuando el valor cambia
  function contar(box) {
    const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;
    $$("[data-cnt]", box).forEach((el) => {
      const k = el.dataset.k || "", v = +el.dataset.cnt, a = R.cnt[k] ?? 0; R.cnt[k] = v;
      if (a === v || quieto || !isFinite(v)) return;
      const fmt = el.dataset.fmt === "pct" ? (n) => Math.round(n) + "%" : el.dataset.fmt === "corto" ? cortoG : clp;
      const t0 = performance.now();
      const paso = (t) => { const p = Math.min(1, (t - t0) / 750), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(a + (v - a) * e); if (p < 1) requestAnimationFrame(paso); };
      el.textContent = fmt(a); requestAnimationFrame(paso);
    });
  }
  const leer = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const guardar = (o) => { try { localStorage.setItem(KEY, JSON.stringify({ ...leer(), ...o })); } catch {} };
  // 💾 "quede guardado lo que estoy haciendo": recuerda la pantalla, el Analizador y la Caja al cerrar/abrir
  const leerUI = () => { try { return JSON.parse(localStorage.getItem("sdc:ui")) || {}; } catch { return {}; } };
  const guardarUI = () => { try { const q = R.llamada; localStorage.setItem("sdc:ui", JSON.stringify({
    pantalla: R.pantalla || null, anl: R.anl || null,
    llamada: q ? { confirmado: q.confirmado || null, compraAnalisis: q.compraAnalisis || null, cliTel: q.cliTel || null, cliMail: q.cliMail || null, propCuerpo: q.propCuerpo || null, texto: q.texto || null } : null })); } catch {} };
  const hace = (iso) => {
    if (!iso) return "";
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return "recién";
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short" });
  };

  const ESTADO = {
    en_cola:    { txt: "En cola",            cls: "gris",  activo: true },
    tomado:     { txt: "Preparando",         cls: "azul",  activo: true },
    preparando: { txt: "Preparando",         cls: "azul",  activo: true },
    lista:      { txt: "Falta tu clic",      cls: "ambar", activo: true },
    firmar:     { txt: "Lista para firmar",  cls: "violeta" },
    probada:    { txt: "Prueba lista",       cls: "azul" },
    enviada:    { txt: "Enviada",            cls: "verde" },
    confirmada: { txt: "Enviada · confirmada", cls: "oro" },
    requiere:   { txt: "Necesita tu atención", cls: "rojo" },
    error:      { txt: "No se pudo",         cls: "rojo" },
    cancelada:  { txt: "Cancelada",          cls: "gris" },
    lic_bajando:    { txt: "Bajando bases",        cls: "azul", activo: true },
    lic_captcha:    { txt: "📋 Pega el código",    cls: "ambar", activo: true },
    lic_analizando: { txt: "Analizando bases",     cls: "azul", activo: true },
    lic_revisar:    { txt: "¿Te parece el precio?", cls: "violeta" },
    lic_lista:      { txt: "Lista para ofertar",   cls: "violeta" },
    lic_ingresando: { txt: "Ingresando al portal", cls: "azul", activo: true },
  };
  const est = (e) => ESTADO[e] || { txt: e || "—", cls: "gris" };

  /* ---------------- estilos ---------------- */
  const css = document.createElement("style");
  css.textContent = `
  .rb-chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--panel);border-radius:99px;padding:6px 11px;font-size:.78rem;color:var(--ink-dim);cursor:pointer;white-space:nowrap}
  .rb-chip .rb-dot{width:8px;height:8px;border-radius:50%;background:var(--ink-faint);flex-shrink:0}
  .rb-chip.on .rb-dot{background:var(--ok);box-shadow:0 0 0 3px rgba(63,191,138,.18)}
  .rb-chip.atn{border-color:var(--warn);color:#fff}
  .rb-chip.atn .rb-dot{background:var(--warn);animation:pulse 1.2s ease-in-out infinite}
  .rb-n{background:var(--warn);color:#241600;border-radius:99px;font-size:.66rem;font-weight:700;padding:0 6px;line-height:16px}
  .rb-badge{display:inline-flex;align-items:center;gap:6px;font-size:.72rem;font-weight:700;padding:4px 10px;border-radius:99px;white-space:nowrap;letter-spacing:.01em}
  .rb-badge.gris{background:var(--bg-2);color:var(--ink-dim);border:1px solid var(--line)}
  .rb-badge.azul{background:rgba(63,122,224,.18);color:#bcd3ff;border:1px solid rgba(63,122,224,.5)}
  .rb-badge.ambar{background:rgba(240,180,60,.16);color:#ffd88a;border:1px solid rgba(240,180,60,.55)}
  .rb-badge.verde{background:#16a34a;color:#fff}
  .rb-badge.oro{background:linear-gradient(180deg,#fbe08a,#d69e16);color:#3d2a00;box-shadow:0 0 0 1px #c8900f inset}
  .rb-badge.rojo{background:rgba(232,49,63,.15);color:#ffb3b9;border:1px solid rgba(232,49,63,.5)}
  .rb-badge .spinner{width:11px;height:11px;border-width:2px}
  .btn.rb-go{background:linear-gradient(100deg,var(--red),var(--red-deep));border-color:transparent;color:#fff}
  #rbSheet button,#rbSheet a.btn,#rbSheet [data-rb]{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
  #rbSheet button:active,#rbSheet a.btn:active{transform:scale(.96);filter:brightness(1.12);transition:transform .05s}
  #rbSheet .rb-rchip{transition:background .08s,color .08s,box-shadow .08s}
  .rb-swipe{position:relative;touch-action:pan-y;user-select:none;-webkit-user-select:none;will-change:transform}
  .rb-sello{position:absolute;top:10px;padding:2px 10px;border:3px solid;border-radius:8px;font-weight:900;font-size:1.1rem;letter-spacing:.06em;opacity:0;pointer-events:none;z-index:2}
  .rb-sello.si{left:12px;color:#22c55e;border-color:#22c55e;transform:rotate(-12deg)}
  .rb-sello.no{right:12px;color:#ff5a5a;border-color:#ff5a5a;transform:rotate(12deg)}
  .rb-otabs{display:flex;gap:4px;overflow-x:auto;margin:8px 0 4px;padding-bottom:2px}
  .rb-otabs button{flex:1 0 auto;background:transparent;border:1px solid var(--line-soft);color:inherit;border-radius:999px;padding:7px 12px;font:inherit;font-size:.8rem;white-space:nowrap;cursor:pointer}
  .rb-otabs button.on{background:#7c4dff;border-color:#7c4dff;color:#fff;font-weight:700}
  .rb-otabs i{font-style:normal;margin-left:6px;opacity:.75;font-size:.72rem}
  .rb-estrella{background:none;border:0;font-size:1.5rem;line-height:1;color:#6b7891;cursor:pointer;padding:0 2px}
  .rb-estrella.on{color:#ffc93c}
  .rb-sel .rb-precio{font-size:1.7rem;font-weight:800;letter-spacing:-.01em}
  .rb-sel .rb-pct{font-size:.78rem;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:6px;vertical-align:middle}
  .rb-sel .rb-pct.baja{background:rgba(34,197,94,.18);color:#7ee2a0}.rb-sel .rb-pct.sube{background:rgba(255,90,90,.18);color:#ff9a9a}
  .rb-range{-webkit-appearance:none;appearance:none;width:100%;height:10px;border-radius:99px;background:#2a3550;margin:14px 0 4px;outline:none;touch-action:none}
  .rb-range::-webkit-slider-thumb{-webkit-appearance:none;width:30px;height:30px;border-radius:50%;background:#fff;border:4px solid #7c4dff;box-shadow:0 2px 8px rgba(0,0,0,.4)}
  .rb-range::-moz-range-thumb{width:26px;height:26px;border-radius:50%;background:#fff;border:4px solid #7c4dff}
  .rb-escala{display:flex;justify-content:space-between;font-size:.7rem;opacity:.7}
  .rb-pasos2{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.rb-pasos2 button{flex:1 0 auto;min-width:54px}
  .rb-mini{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}.rb-mini div{background:rgba(255,255,255,.04);border:1px solid var(--line-soft);border-radius:10px;padding:7px 9px}
  .rb-mini small{display:block;opacity:.7;font-size:.7rem}.rb-mini b{font-size:.95rem}
  .rb-env{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
  .rb-marcador{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0 10px}
  .rb-m{border-radius:14px;padding:10px 12px;position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.08)}
  .rb-m b{display:block;font-size:1.32rem;letter-spacing:-.01em;line-height:1.15}.rb-m span{font-size:.7rem;opacity:.85;text-transform:uppercase;letter-spacing:.04em}
  .rb-m small{display:block;font-size:.68rem;opacity:.8;margin-top:2px}
  .rb-m.oro{background:linear-gradient(135deg,#f8d56b,#c8900f);color:#2b1d00}.rb-m.verde{background:linear-gradient(135deg,#22c55e,#0f7a3a);color:#fff}
  .rb-m.azul{background:linear-gradient(135deg,#3b82f6,#1e3a8a);color:#fff}.rb-m.violeta{background:linear-gradient(135deg,#8b5cf6,#5b21b6);color:#fff}
  .rb-sug{background:rgba(255,201,60,.12);border:1px dashed rgba(255,201,60,.6);border-radius:10px;padding:8px 10px;margin:8px 0;font-size:.78rem}
  .rb-sug b{color:#ffd88a}
  .rb-etapas{display:flex;gap:4px;overflow-x:auto;margin:6px 0 8px}.rb-etapas button{flex:0 0 auto;border:1px solid var(--line-soft);background:transparent;color:inherit;border-radius:999px;padding:5px 10px;font:inherit;font-size:.74rem;cursor:pointer}
  .rb-etapas button.on{background:linear-gradient(100deg,#f8d56b,#c8900f);color:#2b1d00;border-color:transparent;font-weight:800}
  .rb-comprar{margin:10px 0;padding:12px;border-radius:16px;border:2px solid #f5cf6b;background:linear-gradient(180deg,rgba(245,207,107,.16),rgba(245,207,107,.04));box-shadow:0 0 22px rgba(245,207,107,.15)}
  .rb-comprar>.rb-env b{font-size:.86rem;letter-spacing:.04em;color:#f5cf6b}
  .rb-qc{display:flex;gap:10px;align-items:flex-start;margin-top:8px}.rb-qc .n{min-width:52px;text-align:center;font:800 1.35rem/1 system-ui;color:#fff6d6;background:rgba(0,0,0,.25);border-radius:12px;padding:6px 4px}
  .rb-qc .n small{display:block;font-size:.58rem;font-weight:600;opacity:.8;margin-top:2px}.rb-qc b{font-size:.92rem}.rb-qc.mini .n{min-width:42px;font-size:1.05rem}.rb-qc.mini b{font-size:.8rem}
  .rb-ojo{font-size:.7rem;color:#ffd88a;margin-top:2px}
  .rb-ejcard{border:1px solid rgba(245,207,107,.4);border-radius:18px;padding:12px;margin:8px 0;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02));position:relative;overflow:hidden}
  .rb-ejcard.trayecto{border-color:#5ef0b0;animation:rbParpadeo 1.6s ease-in-out infinite}
  @keyframes rbParpadeo{0%,100%{box-shadow:0 0 0 0 rgba(94,240,176,0)}50%{box-shadow:0 0 0 4px rgba(94,240,176,.35),0 0 24px rgba(94,240,176,.35)}}
  .rb-luz{display:inline-block;width:10px;height:10px;border-radius:50%;background:#5ef0b0;box-shadow:0 0 10px #5ef0b0;margin-right:6px;vertical-align:middle;animation:rbLuz 1.1s ease-in-out infinite}
  .rb-luz.grande{width:22px;height:22px;margin:0}
  @keyframes rbLuz{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.8)}}
  .rb-op.respondio{border-color:#5ef0b0!important;box-shadow:0 0 0 1px rgba(94,240,176,.4),0 0 18px rgba(94,240,176,.18)}.rb-op.fuera{opacity:.45}
  .rb-resp{font-size:.74rem;margin:6px 0;padding:6px 8px;border-radius:10px;background:rgba(255,255,255,.05)}.rb-resp.nueva{background:rgba(94,240,176,.12);border:1px solid rgba(94,240,176,.35)}
  .rb-cerraste{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px;padding:6px 8px;border-radius:12px;background:rgba(245,207,107,.1)}.rb-cerraste span{flex:1;font-size:.76rem;font-weight:700}
  .rb-pagar{padding:12px;border-radius:14px;border:1px solid rgba(245,207,107,.5);background:rgba(0,0,0,.2);margin:6px 0}
  .rb-trayecto{display:flex;gap:12px;align-items:center;padding:12px;border-radius:14px;border:1px solid #5ef0b0;background:rgba(94,240,176,.1);margin:8px 0}.rb-trayecto b{letter-spacing:.06em;color:#5ef0b0}
  .rb-modos button{flex:1}
  .rb-eerr{margin-top:8px}.rb-hitos{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.rb-hito{font-size:.66rem;padding:3px 7px;border-radius:9px;background:rgba(255,255,255,.07)}.rb-hito span{opacity:.7;margin-right:4px}
  .rb-pill.verde{border-color:#5ef0b0;color:#c9ffe8}
  .rb-candado{text-align:center;padding:28px 16px;border-radius:18px;border:1px dashed rgba(245,207,107,.5);margin:12px 0;display:flex;flex-direction:column;gap:8px;align-items:center}
  .rb-plan-c{padding:14px;border-radius:18px;border:1px solid rgba(255,255,255,.14);margin:10px 0;background:rgba(255,255,255,.04)}.rb-plan-c.medio{border-color:rgba(245,207,107,.6)}.rb-plan-c.premium{border-color:#b78cff;background:linear-gradient(180deg,rgba(183,140,255,.12),rgba(245,207,107,.06))}.rb-plan-c.on{box-shadow:0 0 0 2px #5ef0b0}
  .rb-precio{font-size:1.15rem;color:#f5cf6b}.rb-precio small{font-size:.65rem;opacity:.8;margin-left:2px}
  .rb-vivo{margin:8px 0;padding:10px;border-radius:14px;border:1px solid rgba(255,90,90,.45);background:rgba(255,90,90,.06)}.rb-vivo.on{border-color:#ff4d4d;box-shadow:0 0 18px rgba(255,77,77,.25)}
  .rb-luz.rojo{background:#ff4d4d;box-shadow:0 0 10px #ff4d4d}.rb-tw{position:relative;padding-top:56.25%;border-radius:12px;overflow:hidden;margin:6px 0}.rb-tw iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
  .rb-glob{display:block!important;text-align:left;width:100%}.rb-glob b{display:block;margin-bottom:2px}.rb-glob span{display:block;font-size:.68rem;opacity:.8;white-space:normal!important;overflow-wrap:anywhere;text-overflow:clip!important;overflow:visible!important}
  .rb-link{background:none;border:0;color:inherit;padding:0;text-align:left;font:inherit;cursor:pointer}
  .rb-acciones{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .rb-caja{margin:8px 0;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.035);overflow:hidden}
  .rb-caja>summary{list-style:none;display:flex;align-items:center;gap:10px;padding:13px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent}.rb-caja>summary::-webkit-details-marker{display:none}
  .rb-caja>summary::after{content:"›";margin-left:auto;font-size:1.3rem;opacity:.6;transition:transform .2s}.rb-caja[open]>summary::after{transform:rotate(90deg)}
  .rb-caja-i{flex:0 0 26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:.8rem;background:rgba(255,255,255,.08)}
  .rb-caja-t{font-weight:700;font-size:.92rem;white-space:nowrap}.rb-caja-s{font-size:.7rem;opacity:.75;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rb-caja-b{padding:0 12px 12px}
  .rb-caja.ahora{border-color:rgba(94,240,176,.55)}.rb-caja.ahora .rb-caja-i{background:#5ef0b0;color:#06281c}
  .rb-caja.hecho .rb-caja-i{background:rgba(94,240,176,.25);color:#5ef0b0}
  .rb-caja.oro{border-color:#f5cf6b;background:linear-gradient(180deg,rgba(245,207,107,.14),rgba(245,207,107,.03))}.rb-caja.oro .rb-caja-i{background:#f5cf6b;color:#3a2a00}
  .rb-caja.vivo{border-color:rgba(124,77,255,.55)}.rb-caja.vivo .rb-caja-i{background:#7c4dff;color:#fff}
  .rb-caja.luego{opacity:.82}
  .rb-op.respondio{border-color:#f5cf6b!important;background:linear-gradient(180deg,rgba(245,207,107,.16),rgba(245,207,107,.04))!important;box-shadow:0 0 14px rgba(245,207,107,.18)}
  .rb-prov-oro{padding:12px;border-radius:14px;border:1px solid #f5cf6b;background:linear-gradient(135deg,rgba(245,207,107,.22),rgba(245,207,107,.05));margin:4px 0 10px}
  .rb-xl table td small,.rb-copias td small{display:block;font-size:.62rem;opacity:.65}.rb-xl tr.t td{font-weight:700}.rb-xl tr.oro td{font-weight:800;color:#f5cf6b;border-top:1px solid rgba(245,207,107,.5)}
  .rb-rep{display:flex;align-items:center;gap:10px;padding:8px 10px;margin:5px 0;border-radius:12px;background:rgba(255,255,255,.05)}.rb-rep>span{font-size:1.2rem}.rb-rep>div{flex:1;min-width:0}.rb-rep small{display:block;font-size:.66rem;opacity:.7}
  .rb-rep.pagado{opacity:.6;background:rgba(94,240,176,.08)}.rb-rep .rb-banco{width:100%;margin-top:4px;font-size:16px;padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:inherit;box-sizing:border-box}
  .rb-pagado{display:flex;gap:4px;align-items:center;justify-content:flex-end;font-size:.66rem;margin-top:4px;opacity:.85}
  .rb-inv-c{padding:10px 12px;border-radius:14px;background:rgba(94,240,176,.07);border:1px solid rgba(94,240,176,.35);margin-bottom:8px}
  .rb-inv{padding:12px;border-radius:16px;margin:8px 0;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04)}.rb-inv.toca{border-color:#f5cf6b;box-shadow:0 0 16px rgba(245,207,107,.2)}.rb-inv.activo{border-color:rgba(94,240,176,.5)}
  .rb-inv-flecha{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:.8rem}.rb-inv-flecha b{font-size:1.15rem;color:#5ef0b0}
  .rb-cmd{font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:8px 10px;margin:6px 0;overflow-wrap:anywhere;user-select:all}
  .rb-firma-ok{display:flex;gap:10px;align-items:center;padding:10px;border-radius:14px;border:1px solid rgba(183,140,255,.45);background:rgba(183,140,255,.08);margin:6px 0}
  .rb-firma-ok img{height:46px;max-width:120px;object-fit:contain;background:#fff;border-radius:8px;padding:3px}
  .rb-licmatch{border-color:#b78cff}.rb-mesa{border-color:rgba(183,140,255,.6)}
  .rb-vision{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.rb-vision figure{margin:0;flex:1;min-width:140px}.rb-vision img{width:100%;border-radius:12px;display:block;cursor:pointer}
  .rb-vision figcaption{font-size:.66rem;text-align:center;opacity:.8;margin-top:2px}.rb-vision-ph{height:110px;border-radius:12px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center}
  .rb-rango{width:100%;accent-color:#f5cf6b;margin:8px 0}.rb-ul{margin:4px 0;padding-left:18px;font-size:.76rem}.rb-ul li{margin:2px 0}
  .rb-plan{display:flex;flex-direction:column;gap:6px;margin:6px 0}.rb-plan-p{display:flex;gap:8px;align-items:flex-start;font-size:.78rem}.rb-plan-p>span{min-width:22px;height:22px;border-radius:50%;background:#b78cff;color:#1a1033;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:.7rem}
  .rb-foco{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0 6px;position:sticky;top:0;z-index:3;padding:6px 0;background:rgba(10,14,30,.97);border-radius:0 0 14px 14px}
  .rb-cola{display:flex;gap:6px;overflow-x:auto;padding:4px 0 8px}.rb-cola-i{flex:none;font-size:.7rem;padding:6px 10px;border-radius:12px;border:1px solid rgba(245,207,107,.35);background:rgba(255,255,255,.04);color:inherit;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rb-proy{font-size:.8rem;margin:6px 0 2px;padding:8px 10px;border-radius:12px;background:rgba(0,0,0,.22)}.rb-proy .muted{font-size:.68rem;margin-top:2px}
  .rb-chat{margin-top:6px}.rb-burb{font-size:.74rem;padding:6px 9px;border-radius:12px;margin:4px 0;max-width:88%;white-space:pre-wrap;word-break:break-word}
  .rb-burb.yo{margin-left:auto;background:rgba(245,207,107,.16);border:1px solid rgba(245,207,107,.3)}.rb-burb.el{background:rgba(94,240,176,.12);border:1px solid rgba(94,240,176,.3)}
  .rb-burb small{display:block;font-size:.6rem;opacity:.7;margin-top:2px;text-align:right}
  .rb-rebote{font-size:.74rem;padding:6px 8px;border-radius:10px;background:rgba(255,90,90,.12);border:1px solid rgba(255,90,90,.4);margin:4px 0}
  .rb-sugerido{padding:8px;border-radius:12px;border:1px dashed rgba(245,207,107,.6);margin:6px 0;font-size:.76rem}.rb-sugerido small{opacity:.8}.rb-sugerido>div{margin:4px 0;white-space:pre-wrap}
  .rb-mail{position:relative}.rb-mail b{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;border-radius:8px;background:#ff5a5a;color:#fff;font-size:.6rem;display:flex;align-items:center;justify-content:center;padding:0 3px}
  .rb-mision{margin:10px 0 6px;padding:10px 12px;border-radius:14px;border:1px solid rgba(245,207,107,.45);background:rgba(245,207,107,.07)}
  .rb-barra{height:8px;border-radius:8px;background:rgba(255,255,255,.08);margin:6px 0;overflow:hidden}.rb-barra i{display:block;height:100%;background:linear-gradient(90deg,#f5cf6b,#5ef0b0);transition:width .4s}
  .rb-op.on{border-color:rgba(94,240,176,.55)}
  .rb-neg{border:1px solid #c8900f;border-radius:16px;padding:12px;margin:8px 0;background:linear-gradient(180deg,rgba(248,213,107,.10),rgba(255,255,255,.02))}
  .rb-neg.cerrado{background:linear-gradient(160deg,#f8d56b,#b8860b);color:#2b1d00;border-color:#f8d56b}
  .rb-neg .rb-big{font-size:1.6rem;font-weight:900;color:#7ee2a0;letter-spacing:-.02em}.rb-neg.cerrado .rb-big{color:#1a3d12}
  .rb-neg.cerrado .rb-sug{background:rgba(0,0,0,.10);border-color:rgba(60,40,0,.35);color:#2b1d00}.rb-neg.cerrado .rb-sug b{color:#3d2a00}
  .rb-neg.cerrado .muted{color:#4a3a10}.rb-neg.cerrado .btn{background:rgba(255,255,255,.55);color:#2b1d00;border-color:rgba(60,40,0,.25)}
  .rb-prog{display:flex;gap:3px;margin:8px 0}.rb-prog i{flex:1;height:5px;border-radius:9px;background:rgba(255,255,255,.12)}.rb-prog i.ok{background:linear-gradient(90deg,#f8d56b,#c8900f)}
  .rb-op{border:1px solid var(--line-soft);border-radius:12px;padding:9px 10px;margin:6px 0}.rb-op.on{border-color:#f8d56b;background:rgba(248,213,107,.08)}
  .rb-acc{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.rb-acc .btn{flex:1 0 auto}
  .rb-chip{display:inline-block;font-size:.7rem;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(255,179,71,.18);color:#ffb347;margin-left:4px}
  .rb-card{background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--radius);padding:14px;margin-top:10px}
  .rb-card.ambar{border-color:rgba(240,180,60,.6)}
  .rb-card.oro{border-color:#c8900f}
  .rb-card.verde{border-color:rgba(22,163,74,.7)}
  .rb-card .rb-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
  .rb-card h3{font-size:.92rem;margin:6px 0 4px;line-height:1.35}
  .rb-figs{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:.78rem;color:var(--ink-dim);margin-top:6px}
  .rb-figs b{color:#fff;font-family:"IBM Plex Mono",monospace;font-weight:500}
  .rb-msg{font-size:.82rem;color:var(--ink-dim);margin-top:8px}
  .rb-card.ambar .rb-msg{color:#ffe2a6}
  .rb-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .rb-det{margin-top:10px}
  .rb-mk{border:1px solid rgba(24,119,242,.45);border-radius:12px;padding:6px 10px;background:rgba(24,119,242,.08)}.rb-mk summary{color:#9cc4ff;font-weight:700;font-size:.8rem}
  .rb-det summary{cursor:pointer;font-size:.78rem;color:var(--ink-faint)}
  .rb-det pre{white-space:pre-wrap;background:var(--bg-2);border:1px solid var(--line-soft);border-radius:10px;padding:10px;font-family:"IBM Plex Mono",monospace;font-size:.72rem;color:var(--ink-dim);margin:8px 0 0}
  .rb-line{display:flex;gap:8px;font-size:.74rem;color:var(--ink-faint);font-family:"IBM Plex Mono",monospace}
  .rb-status{display:flex;align-items:center;gap:10px;font-size:.84rem;color:var(--ink-dim);margin:4px 0 6px}
  .rb-status .rb-dot{width:10px;height:10px;border-radius:50%;background:var(--ink-faint)}
  .rb-status.on .rb-dot{background:var(--ok)}
  .rb-desc{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px}
  .rb-conf{background:linear-gradient(160deg,var(--panel-2),var(--panel));border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin-bottom:6px}
  .rb-big{font-family:"Fraunces",serif;font-size:1.6rem;font-weight:600;color:#fff;line-height:1.1}
  .rb-sheet-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
  .rb-x{background:none;border:none;color:var(--ink-faint);font-size:1.3rem;cursor:pointer;padding:4px 8px}
  #rbSheet{z-index:43} #rbBack{z-index:42}
  .rb-vistas{display:flex;background:var(--bg-2);border:1px solid var(--line-soft);border-radius:12px;padding:3px;gap:3px;margin:10px 0 4px}
  .rb-vistas button{flex:1;border:0;background:none;border-radius:9px;padding:7px 0;font-size:.8rem;font-weight:600;color:var(--ink-faint);cursor:pointer}
  .rb-vistas button.on{background:var(--panel-2);color:#fff;box-shadow:0 1px 0 rgba(255,255,255,.06) inset}
  .rb-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0 4px}
  .rb-kpi{background:var(--bg-2);border:1px solid var(--line-soft);border-radius:12px;padding:8px 8px 7px;min-width:0}
  .rb-kpi b{display:block;font-family:"IBM Plex Mono",monospace;font-weight:500;font-size:1.02rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rb-kpi span{display:block;font-size:.66rem;color:var(--ink-faint);line-height:1.2;margin-top:2px}
  .rb-kpi.ambar{border-color:rgba(240,180,60,.6)} .rb-kpi.ambar b{color:#ffd88a}
  .rb-cajas{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:8px}
  .rb-caja{position:relative;text-align:left;background:var(--panel);border:1px solid var(--line-soft);border-radius:14px;padding:11px 11px 10px;cursor:pointer;display:flex;flex-direction:column;gap:6px;min-width:0;color:inherit}
  .rb-caja::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--line)}
  .rb-caja.verde::before{background:#16a34a}.rb-caja.oro::before{background:#d69e16}.rb-caja.ambar::before{background:var(--warn)}
  .rb-caja.azul::before{background:var(--blue)}.rb-caja.rojo::before{background:var(--red)}
  .rb-caja.ambar{border-color:rgba(240,180,60,.55)}
  .rb-caja .rb-cod{font-family:"IBM Plex Mono",monospace;font-size:.68rem;color:var(--ink-faint)}
  .rb-caja .rb-nom{font-size:.8rem;line-height:1.3;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.1em}
  .rb-caja .rb-tot{font-family:"IBM Plex Mono",monospace;font-size:.95rem;color:#fff}
  .rb-caja .rb-badge{align-self:flex-start;font-size:.64rem;padding:3px 8px}
  .rb-tablero{display:flex;align-items:flex-start;gap:8px;overflow-x:auto;margin:8px -4px 0;padding:0 4px 8px;scroll-snap-type:x mandatory}
  .rb-col{flex:0 0 74%;max-width:240px;background:var(--bg-2);border:1px solid var(--line-soft);border-radius:14px;padding:8px;scroll-snap-align:start;display:flex;flex-direction:column;gap:7px}
  .rb-col h4{margin:2px 4px 2px;font-size:.74rem;font-weight:700;color:var(--ink-dim);display:flex;justify-content:space-between;letter-spacing:.02em}
  .rb-col h4 i{font-style:normal;color:var(--ink-faint);font-family:"IBM Plex Mono",monospace}
  .rb-col .rb-vacio{font-size:.72rem;color:var(--ink-faint);padding:6px 4px}
  .rb-ajustes{margin-top:16px;border-top:1px solid var(--line-soft);padding-top:12px}
  .rb-ajustes summary{cursor:pointer;font-size:.8rem;color:var(--ink-faint)}
  .btn.rb-remoto{border-color:rgba(240,180,60,.7);color:#ffd88a}
  .rb-badge.violeta{background:rgba(160,120,255,.18);color:#d9c9ff;border:1px solid rgba(160,120,255,.6)}
  .rb-card.violeta{border-color:rgba(160,120,255,.7)}
  .rb-caja.violeta::before{background:#a078ff}.rb-caja.violeta{border-color:rgba(160,120,255,.55)}
  .rb-kpi.violeta{border-color:rgba(160,120,255,.6)} .rb-kpi.violeta b{color:#d9c9ff}
  .btn.rb-firmar{background:linear-gradient(100deg,#7c4dff,#5a2fd6);border-color:transparent;color:#fff}
  .rb-pasos{margin:10px 0 0;padding-left:18px;font-size:.8rem;color:var(--ink-dim);line-height:1.55}
  .rb-copias{width:100%;border-collapse:collapse;margin-top:8px;font-size:.78rem}
  .rb-copias td{padding:5px 4px;border-top:1px solid var(--line-soft);vertical-align:middle}
  .rb-copias td.n{font-family:"IBM Plex Mono",monospace;color:#fff;white-space:nowrap}
  .rb-cp{border:1px solid var(--line);background:var(--bg-2);color:var(--ink-dim);border-radius:8px;padding:3px 8px;font-size:.7rem;cursor:pointer}
  .rb-cp.ok{color:#9ff0c8;border-color:var(--ok)}
  .rb-alertas{margin:10px 0 0;padding:8px 10px 8px 12px;border-radius:10px;background:rgba(232,49,63,.10);border:1px solid rgba(232,49,63,.45);font-size:.78rem}
  .rb-alertas b{display:block;color:#ffb3b9;margin-bottom:4px}
  .rb-alertas li{margin:3px 0 3px 14px;color:var(--ink-dim)} .rb-alertas li.rojo{color:#ffc9cd}
  .rb-caja .rb-ojo{position:absolute;top:8px;right:8px;background:var(--red);color:#fff;border-radius:99px;font-size:.62rem;font-weight:700;padding:1px 6px}
  @media (min-width:560px){.rb-col{flex-basis:220px}}
  /* ======== modo ejecutivo (grafito · Inter · color solo en estados) ======== */
  #rbSheet.rb-exec{background:#121417;font-family:Inter,system-ui,sans-serif;--panel:#1d2127;--panel-2:#262b33;--bg-2:#181b20;--line:#363c47;--line-soft:#2a2f38;--oro:#f0c060;--oro-d:#c7961f;--vivo:#4fd18b;--ink-faint:#9aa3b2;color:#f3f4f6;padding-bottom:calc(96px + env(safe-area-inset-bottom,0px))}
  #rbSheet.rb-exec::before{background:#121417}
  #rbSheet.rb-exec .rb-card,#rbSheet.rb-exec .rb-sel,#rbSheet.rb-exec .rb-neg{background:#1d2127;border-color:#2a2f38;border-radius:12px}
  #rbSheet.rb-exec h2.rb-h,#rbSheet.rb-exec .rb-h{font-family:Inter,system-ui,sans-serif;letter-spacing:-.02em;font-weight:800}
  #rbSheet.rb-exec .btn{border-radius:12px;font-weight:700}
  #rbSheet.rb-exec .rb-oro,#rbSheet.rb-exec .btn.rb-oro{background:#f3f4f6;color:#121417;border-color:#f3f4f6}
  .rb-top-ex{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;overflow:hidden}
  .rb-top-ex .rb-emp span{max-width:34vw;display:inline-block;vertical-align:bottom;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rb-ex-menu{display:flex;gap:6px;flex-wrap:wrap;background:#1d2127;border:1px solid #2a2f38;border-radius:12px;padding:8px;margin:6px 0 2px}
  #rbSheet.rb-exec .rb-ajustes.rb-mas{margin-top:18px}
  /* 🎨 el color ejecutivo (grafito · Inter · verde) también en la app clásica con Jugar */
  #rbSheet.rb-color{background:#121417;font-family:Inter,system-ui,sans-serif;--panel:#1d2127;--panel-2:#262b33;--bg-2:#181b20;--line:#363c47;--line-soft:#2a2f38;--oro:#f0c060;--oro-d:#c7961f;--vivo:#4fd18b;--ink-faint:#9aa3b2;color:#f3f4f6;}
  #rbSheet.rb-color::before{background:#121417}
  #rbSheet.rb-color .rb-card,#rbSheet.rb-color .rb-sel,#rbSheet.rb-color .rb-neg{background:#1d2127;border-color:#2a2f38;border-radius:12px}
  #rbSheet.rb-color h2.rb-h,#rbSheet.rb-color .rb-h{font-family:Inter,system-ui,sans-serif;letter-spacing:-.02em;font-weight:800}
  #rbSheet.rb-color .btn{border-radius:12px;font-weight:700}
  #rbSheet.rb-color .rb-oro,#rbSheet.rb-color .btn.rb-oro{background:#f3f4f6;color:#121417;border-color:#f3f4f6}
  #rbSheet.rb-color .rb-ajustes.rb-mas{margin-top:18px}
  .rb-ex-nav{position:fixed;left:0;right:0;bottom:0;height:calc(70px + env(safe-area-inset-bottom,0px));padding:10px 0 env(safe-area-inset-bottom,0px);background:linear-gradient(180deg,rgba(18,20,23,0),#121417 30%);display:grid;grid-template-columns:repeat(4,1fr);z-index:30}
  .rb-ex-nav button{background:none;border:0;color:#9aa3b2;font:600 .64rem Inter,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;gap:3px;position:relative;padding:0}
  .rb-ex-nav button.on{color:#f3f4f6}
  .rb-ex-nav button svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
  .rb-ex-nav .n{position:absolute;top:-4px;right:calc(50% - 20px);background:#ff8a65;color:#121417;font-size:.6rem;font-weight:800;min-width:16px;height:16px;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0 4px}
  .rb-ex-h1{font-size:1.45rem;font-weight:800;letter-spacing:-.02em;margin:4px 0 2px}
  .rb-ex-h2{font-size:1rem;font-weight:700;margin:20px 0 8px;display:flex;justify-content:space-between;align-items:baseline}
  .rb-ex-h2 small{font-size:.72rem;color:#9aa3b2;font-weight:600}
  .rb-ex-carr{display:flex;gap:12px;overflow-x:auto;margin:0 -14px;padding:2px 14px 6px;scroll-snap-type:x mandatory}
  .rb-ex-carr::-webkit-scrollbar{display:none}
  .rb-ex-cov{flex:0 0 146px;scroll-snap-align:start;cursor:pointer;text-align:left;background:none;border:0;color:inherit;padding:0;font:inherit}
  .rb-ex-cov .art{width:146px;height:146px;border-radius:8px;position:relative;overflow:hidden;display:flex;align-items:flex-end;padding:10px;box-sizing:border-box}
  .rb-ex-cov .art b{font-size:.76rem;line-height:1.2;text-shadow:0 1px 2px rgba(0,0,0,.7);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .rb-ex-cov .tag{position:absolute;top:8px;left:8px;font-size:.6rem;font-weight:800;letter-spacing:.04em;padding:3px 7px;border-radius:4px;background:rgba(0,0,0,.6)}
  .rb-ex-cov .t{font-size:.8rem;font-weight:600;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rb-ex-cov .m{font-size:.7rem;color:#9aa3b2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rb-ex-row{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #2a2f38;cursor:pointer}
  .rb-ex-row:last-child{border-bottom:0}
  .rb-ex-row .d{flex:0 0 50px;height:50px;border-radius:6px;background:#262b33;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}
  .rb-ex-row .d b{font-size:1rem}.rb-ex-row .d small{font-size:.56rem;color:#9aa3b2;margin-top:3px;text-transform:uppercase}
  .rb-ex-row .tx{flex:1;min-width:0}.rb-ex-row .tx b{display:block;font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rb-ex-row .tx span{display:block;font-size:.72rem;color:#9aa3b2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rb-ex-st{display:inline-block;font-size:.64rem;font-weight:700;padding:2px 7px;border-radius:999px;border:1px solid #363c47;color:#9aa3b2;margin:3px 4px 0 0}
  .rb-ex-st.cierre{color:#ff8a65;border-color:#ff8a65}.rb-ex-st.doc{color:#f4c95d;border-color:#f4c95d}.rb-ex-st.env{color:#4fd18b;border-color:#4fd18b}.rb-ex-st.info{color:#6ea8ff;border-color:#6ea8ff}
  .rb-ex-chips{display:flex;gap:8px;overflow-x:auto;margin:8px -14px 4px;padding:0 14px 4px}.rb-ex-chips::-webkit-scrollbar{display:none}
  .rb-ex-chips button{flex:0 0 auto;height:32px;padding:0 12px;border-radius:16px;border:1px solid #363c47;background:#1d2127;color:#f3f4f6;font:600 .78rem Inter,sans-serif}
  .rb-ex-chips button.on{background:#f3f4f6;color:#121417;border-color:#f3f4f6}
  .rb-ex-search{display:flex;align-items:center;gap:10px;background:#f3f4f6;color:#121417;border-radius:10px;padding:0 12px;height:46px;margin-top:8px}
  .rb-ex-search input{flex:1;min-width:0;background:none;border:0;outline:0;color:#121417;font:500 .9rem Inter,sans-serif}
  .rb-ex-search svg{width:20px;height:20px;flex:0 0 20px;fill:none;stroke:#121417;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
  #rbSheet svg:not([width]):not(.rb-svg-libre){max-width:28px;max-height:28px}
  .rb-ex-cont{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(74px + env(safe-area-inset-bottom,0px));width:min(560px,calc(100vw - 16px));z-index:29}
  .rb-ex-cont button{width:100%;display:flex;align-items:center;gap:10px;background:#262b33;border:1px solid #363c47;border-radius:10px;padding:9px 10px;color:#f3f4f6;text-align:left;font:inherit;box-shadow:0 10px 30px rgba(0,0,0,.5)}
  .rb-ex-cont .bar{height:3px;background:#363c47;border-radius:2px;overflow:hidden;margin-top:5px}.rb-ex-cont .bar i{display:block;height:100%;background:#f4c95d}
  .rb-ex-kv{display:grid;grid-template-columns:104px 1fr;gap:6px 10px;font-size:.86rem}.rb-ex-kv div:nth-child(odd){color:#9aa3b2}
  .rb-ex-src{font-size:.66rem;color:#6ea8ff;font-weight:600;margin-left:6px;white-space:nowrap}
  /* ======== tema «cristal, oro, cielo, mar y luna» (solo en la hoja del robot) ======== */
  #rbSheet{top:0;max-height:none;height:100%;border:0;border-radius:0;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
    padding:calc(10px + env(safe-area-inset-top,0px)) 14px calc(28px + env(safe-area-inset-bottom,0px));background:#030713;
    --panel:rgba(255,255,255,.06);--panel-2:rgba(255,255,255,.10);--bg-2:rgba(255,255,255,.05);--line:rgba(255,255,255,.18);--line-soft:rgba(255,255,255,.11);
    --oro:#f5cf6b;--oro-d:#c48f17;--vivo:#5ef0b0;font-feature-settings:"tnum" 1}
  #rbSheet::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
    background:radial-gradient(1.2px 1.2px at 12% 14%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 33% 6%,#fff 50%,transparent 51%),
      radial-gradient(1.4px 1.4px at 58% 18%,#fff 50%,transparent 51%),radial-gradient(1px 1px at 72% 28%,#dfe8ff 50%,transparent 51%),
      radial-gradient(1px 1px at 22% 32%,#dfe8ff 50%,transparent 51%),radial-gradient(1.3px 1.3px at 92% 22%,#fff 50%,transparent 51%),
      radial-gradient(900px 380px at 50% 112%,rgba(18,160,190,.55),transparent 65%),
      linear-gradient(180deg,#02040d 0%,#061230 34%,#0a2547 62%,#0b3f5c 84%,#0d5a6e 100%)}
  #rbSheet .sheet-in{position:relative}
  #rbSheet h2{font-family:"Fraunces",serif;font-weight:600;letter-spacing:-.01em;background:linear-gradient(180deg,#fff8e0,#f5cf6b 55%,#c48f17);-webkit-background-clip:text;background-clip:text;color:transparent}
  #rbSheet .btn{background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.05));border:1px solid rgba(255,255,255,.18);color:#f4f7ff;box-shadow:inset 0 1px 0 rgba(255,255,255,.18);transition:transform .08s}
  #rbSheet .btn:active{transform:scale(.97)}
  #rbSheet .btn.rb-firmar,#rbSheet .btn.rb-oro{background:linear-gradient(180deg,#fff0bd 0%,#f5cf6b 38%,#d9a52a 70%,#b37a0f 100%);color:#2a1a00;border-color:rgba(255,236,170,.9);font-weight:800;
    box-shadow:0 6px 20px rgba(245,190,70,.28),inset 0 1px 0 rgba(255,255,255,.7);text-shadow:0 1px 0 rgba(255,255,255,.35)}
  #rbSheet .rb-card,#rbSheet .rb-caja,#rbSheet .rb-conf{background:linear-gradient(155deg,rgba(255,255,255,.11),rgba(255,255,255,.035) 60%,rgba(120,200,255,.05));
    border:1px solid rgba(255,255,255,.14);border-radius:18px;box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 10px 28px rgba(0,0,0,.30)}
  #rbSheet .rb-card.oro{border-color:rgba(245,207,107,.7);box-shadow:0 0 0 1px rgba(245,207,107,.25),0 10px 30px rgba(245,190,70,.18)}
  #rbSheet .rb-otabs{position:sticky;top:calc(-10px + env(safe-area-inset-top,0px));z-index:5;margin:8px -14px 6px;padding:8px 14px;
    background:rgba(6,16,40,.72);-webkit-backdrop-filter:blur(16px) saturate(150%);backdrop-filter:blur(16px) saturate(150%);border-bottom:1px solid rgba(255,255,255,.08)}
  #rbSheet .rb-otabs button{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.04)}
  #rbSheet .rb-otabs button.on{background:linear-gradient(180deg,#fff0bd,#f5cf6b 45%,#c48f17);border-color:transparent;color:#2a1a00;box-shadow:0 4px 14px rgba(245,190,70,.3)}
  .rb-oro-t{background:linear-gradient(180deg,#fffaf0 0%,#ffe69a 40%,#f5cf6b 62%,#c48f17 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
  .rb-vivo-t{color:var(--vivo);text-shadow:0 0 18px rgba(94,240,176,.35)}
  #rbSheet .rb-marcador{gap:8px}
  #rbSheet .rb-m{background:linear-gradient(160deg,rgba(255,255,255,.13),rgba(255,255,255,.04));border:1px solid rgba(255,255,255,.14);color:#eef3ff;border-radius:18px;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 10px 26px rgba(0,0,0,.28)}
  #rbSheet .rb-m b{font-family:"Fraunces",serif;font-weight:600;font-size:1.5rem}
  #rbSheet .rb-m span{opacity:.75}
  #rbSheet .rb-m.oro{background:linear-gradient(160deg,rgba(255,226,140,.30),rgba(196,143,23,.14));border-color:rgba(245,207,107,.6)}
  #rbSheet .rb-m.verde{background:linear-gradient(160deg,rgba(94,240,176,.22),rgba(20,120,90,.12));border-color:rgba(94,240,176,.45)}
  #rbSheet .rb-m.verde b{color:var(--vivo);text-shadow:0 0 22px rgba(94,240,176,.4)}
  #rbSheet .rb-m.azul{background:linear-gradient(160deg,rgba(120,180,255,.20),rgba(40,80,160,.10))}
  #rbSheet .rb-m.violeta{background:linear-gradient(160deg,rgba(190,160,255,.20),rgba(90,60,180,.10))}
  .rb-filtros{display:flex;gap:6px;overflow-x:auto;margin:6px -14px;padding:2px 14px 4px;scrollbar-width:none}.rb-filtros::-webkit-scrollbar{display:none}.rb-filtros .btn{flex:0 0 auto}
  .rb-oq{flex:0 0 auto;display:flex;align-items:center;gap:4px;padding:0 8px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);font-size:.8rem}.rb-oq.on{border-color:#f5cf6b;background:rgba(245,207,107,.12)}
  .rb-oq input{width:120px;background:transparent;border:0;outline:0;color:inherit;font-size:16px;padding:6px 0}.rb-oq input::-webkit-search-cancel-button{display:none}.rb-oq button{background:none;border:0;color:inherit;font-size:.85rem;padding:2px 4px;cursor:pointer}
  #rbSheet .rb-status{font-size:.78rem;margin:2px 0}
  #rbSheet .rb-vistas{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.1)}
  #rbSheet .rb-vistas button.on{background:rgba(245,207,107,.18);color:#ffe9a8}
  body:has(#rbSheet.on) .toast{background:rgba(8,20,48,.82);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(245,207,107,.5);color:#fff6d6;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
  .rb-fnom{margin:3px 0;font-weight:600;font-size:.9rem;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-transform:lowercase}
  .rb-fnom::first-letter{text-transform:uppercase}
  .rb-rchips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:14px}
  .rb-rchip{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#eef3ff;border-radius:999px;padding:10px 14px;font:inherit;font-size:.86rem;cursor:pointer;transition:transform .08s}
  .rb-rchip:active{transform:scale(.96)}.rb-rchip i{font-style:normal;margin-left:7px;font-size:.72rem;opacity:.7}
  .rb-rchip.on{background:linear-gradient(180deg,#fff0bd,#f5cf6b 45%,#c48f17);color:#2a1a00;border-color:transparent;font-weight:800;box-shadow:0 4px 16px rgba(245,190,70,.35)}
  /* ======== portal ejecutivo: letra más chica, navegación abajo, menos botones ======== */
  #rbSheet{font-size:14px;padding-bottom:calc(86px + env(safe-area-inset-bottom,0px))}
  #rbSheet .btn{padding:9px 13px;font-size:.84rem;border-radius:12px}#rbSheet .btn.small{padding:6px 10px;font-size:.76rem;border-radius:10px}
  #rbSheet .rb-card{padding:12px}
  .rb-top2{display:flex;align-items:center;gap:8px;margin:0 0 8px}
  .rb-emp{flex:1;min-width:0;display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#f4f7ff;border-radius:12px;padding:8px 10px;font:inherit;font-size:.8rem;font-weight:700;cursor:pointer;text-align:left}
  .rb-emp span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rb-mando-barra{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:13px;padding:9px 11px;margin:7px 0}
  .rb-mando-luz{font-size:.82rem;color:#e8edf8}
  .rb-rating{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-radius:12px;padding:9px 12px;margin-bottom:8px;font-size:1rem;font-weight:700}
  .rb-rating span{font-size:.72rem;opacity:.9;width:100%;font-weight:400}
  .rb-rating.fuego{background:linear-gradient(90deg,rgba(255,90,20,.28),rgba(255,180,0,.14));border:1px solid #ff7a1a;color:#ffd7ad}
  .rb-rating.bien{background:rgba(63,220,138,.16);border:1px solid #3fdc8a;color:#c6f6de}
  .rb-rating.ok{background:rgba(63,220,138,.1);border:1px solid rgba(63,220,138,.4);color:#d2efdf}
  .rb-rating.reg{background:rgba(245,207,107,.13);border:1px solid rgba(245,207,107,.5);color:#f4e4b4}
  .rb-rating.mal{background:rgba(255,90,90,.13);border:1px solid rgba(255,90,90,.5);color:#ffc7c7}
  .rb-puertas{display:flex;flex-direction:column;gap:10px;margin:18px 0 4px}
  .rb-puerta{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:14px 14px;color:#eaf0ff;cursor:pointer;transition:transform .08s,border-color .15s,background .15s}
  .rb-puerta:active{transform:scale(.98)}
  .rb-puerta:hover{border-color:#c8a24a;background:rgba(200,162,74,.12)}
  .rb-puerta-i{font-size:1.7rem;flex:0 0 auto;width:40px;text-align:center}
  .rb-puerta-t{flex:1;display:flex;flex-direction:column;gap:2px}
  .rb-puerta-t b{font-size:.96rem}
  .rb-puerta-t small{font-size:.74rem;color:#a9b8d9;line-height:1.3}
  .rb-puerta-f{font-size:1.4rem;color:#c8a24a;flex:0 0 auto}
  .rb-p-cambiar{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:999px;padding:4px 11px;font-size:.72rem;color:#dfe7fb;cursor:pointer}
  .rb-pcs{display:flex;align-items:center;gap:4px;font-size:.66rem;color:#a9b8d9;letter-spacing:.04em;background:none;border:none;cursor:pointer;font-family:inherit;padding:2px 2px}
  .rb-pcs i{width:7px;height:7px;border-radius:50%;background:#64708a;display:inline-block;margin-left:4px}.rb-pcs i.on{background:#3fdc8a;box-shadow:0 0 0 3px rgba(63,220,138,.18)}
  .rb-ico{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:12px;width:38px;height:36px;font-size:1rem;cursor:pointer}
  .rb-ico.rb-tel{background:linear-gradient(180deg,#fff0bd,#f5cf6b 50%,#c48f17);border-color:transparent;box-shadow:0 4px 14px rgba(245,190,70,.35)}
  .rb-nav{position:fixed;left:0;right:0;bottom:0;z-index:6;display:flex;justify-content:space-around;gap:2px;padding:6px 6px calc(6px + env(safe-area-inset-bottom,0px));
    background:rgba(4,12,32,.86);-webkit-backdrop-filter:blur(18px) saturate(160%);backdrop-filter:blur(18px) saturate(160%);border-top:1px solid rgba(255,255,255,.1)}
  .rb-nav button{flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;background:none;border:0;color:#8f9cba;font:inherit;padding:4px 0;cursor:pointer;border-radius:12px}
  .rb-nav .i{position:relative;font-size:1.25rem;line-height:1.2}.rb-nav .t{font-size:.62rem;font-weight:700;letter-spacing:.02em}
  .rb-nav em{position:absolute;top:-4px;right:-14px;font-style:normal;font-size:.58rem;font-weight:800;background:#e8313f;color:#fff;border-radius:99px;padding:0 5px;line-height:15px}
  .rb-nav button.on{color:#ffe9a8;background:rgba(245,207,107,.12)}.rb-nav button.on .t{color:#f5cf6b}
  .rb-tira{display:flex;justify-content:space-between;gap:6px;font-size:.74rem;padding:8px 10px;border-radius:14px;margin:0 0 6px;background:linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.1)}
  .rb-tira b{font-size:.9rem}
  .rb-sec{font-size:.68rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#a9b8d9;margin:12px 0 6px}
  .rb-env.rb-sec{align-items:center;text-transform:none;letter-spacing:0;font-size:.8rem;color:#e8edf8}
  .rb-paso{padding-top:4px}.rb-paso-n{font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:#f5cf6b;font-weight:800}
  #rbSheet .rb-h{font-size:1.45rem;margin:4px 0}.rb-sub{font-size:.8rem;margin-bottom:10px}
  .rb-lab{display:block;font-size:.7rem;color:#a9b8d9;margin-top:8px}
  .rb-lab input,.rb-in,#rbSheet textarea{display:block;width:100%;margin-top:3px;padding:10px 11px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#fff;font:inherit;font-size:16px;box-sizing:border-box}
  #rbSheet input,#rbSheet select,#rbSheet textarea{font-size:16px}  /* iPhone no hace zoom al escribir */
  #rbSheet{touch-action:manipulation}
  .rb-big-btn{width:100%;margin-top:12px;padding:13px!important;font-size:.95rem!important}
  .rb-link{width:100%;margin-top:6px;background:none!important;border:0!important;box-shadow:none!important;opacity:.75}
  .rb-emp-c{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:8px 0}.rb-emp-c.on{border-color:rgba(245,207,107,.7)!important}
  .rb-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px}
  .rb-chat{display:flex;flex-direction:column;gap:8px;padding:8px 0;min-height:40vh}
  .rb-msg{max-width:88%;padding:9px 12px;border-radius:14px;font-size:.88rem;line-height:1.4;white-space:pre-wrap;word-break:break-word}
  .rb-msg.yo{align-self:flex-end;background:rgba(245,207,107,.22);border:1px solid rgba(245,207,107,.45);border-bottom-right-radius:4px}
  .rb-msg.cl{align-self:flex-start;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-bottom-left-radius:4px}
  .rb-msg.err{align-self:stretch;background:rgba(255,120,120,.12);border:1px solid rgba(255,120,120,.4)}
  .rb-chat-sug{display:flex;flex-wrap:wrap;gap:6px}
  .rb-chat-in{display:flex;gap:8px;align-items:flex-end;position:sticky;bottom:0;padding:8px 0;background:inherit}
  .rb-chat-in textarea{flex:1;min-width:0;border-radius:12px;padding:9px;font:inherit}
  .rb-claude{background:linear-gradient(160deg,rgba(245,207,107,.35),rgba(245,207,107,.1))!important}
  .rb-bor{margin-top:10px;padding-top:10px;border-top:1px dashed rgba(255,255,255,.14)}
  .rb-bor-g{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .rb-bor-g label{display:flex;flex-direction:column;gap:3px;font-size:.66rem;letter-spacing:.05em;text-transform:uppercase;opacity:.8}
  .rb-bor-g label b{font-size:.85rem;text-transform:none;letter-spacing:0;opacity:1}
  .rb-bor-g select,.rb-bor-g input{font-size:.85rem;padding:7px 8px;border-radius:8px;background:rgba(0,0,0,.25);color:inherit;border:1px solid rgba(255,255,255,.14);text-transform:none;letter-spacing:0}
  .rb-bor-al{background:rgba(255,179,71,.14);border:1px solid rgba(255,179,71,.5);border-radius:10px;padding:8px 10px;font-size:.8rem;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .rb-oc-d{flex:0 0 46px;height:46px;border-radius:8px;background:rgba(255,255,255,.07);display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}
  .rb-oc-d b{font-size:1.05rem}.rb-oc-d small{font-size:.58rem;opacity:.7;margin-top:2px}
  .rb-oc-d.tarde{background:rgba(201,75,75,.25);color:#ff9a9a}.rb-oc-d.pronto{background:rgba(245,207,107,.22)}
  .rb-oc-tag{display:inline-block;padding:1px 7px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);font-size:.68rem}
  .rb-oc-tag.ok{border-color:rgba(79,209,139,.5);color:#8ff0b8}.rb-oc-tag.mal{border-color:rgba(255,120,120,.5);color:#ff9a9a}
  .rb-llamar{border-radius:16px;padding:10px;background:linear-gradient(160deg,rgba(255,226,140,.12),rgba(255,255,255,.03));border:1px solid rgba(245,207,107,.35)}
  .btn.rb-mic.on{background:#e8313f!important;border-color:#e8313f!important;animation:pulse 1.2s ease-in-out infinite}
  .rb-resp{margin-top:12px;border-radius:18px;padding:14px;border:1px solid rgba(255,255,255,.16);background:linear-gradient(160deg,rgba(255,255,255,.10),rgba(255,255,255,.03))}
  .rb-resp.si{border-color:rgba(94,240,176,.6);box-shadow:0 0 28px rgba(94,240,176,.12)}.rb-resp.no{border-color:rgba(255,120,120,.6)}.rb-resp.dep{border-color:rgba(245,207,107,.6)}
  .rb-resp p{margin:4px 0;font-size:.84rem;line-height:1.45}
  .rb-verd{font-family:"Fraunces",serif;font-size:1.7rem;font-weight:600}.rb-resp.si .rb-verd{color:var(--vivo)}.rb-resp.no .rb-verd{color:#ff8a80}.rb-resp.dep .rb-verd{color:#f5cf6b}
  .rb-tit{font-weight:700;margin:2px 0 6px}
  .rb-wa{white-space:pre-wrap;font-size:.8rem;padding:10px;border-radius:12px;background:rgba(37,211,102,.08);border:1px solid rgba(37,211,102,.35)}
  .rb-hist{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#dfe6f5;border-radius:12px;padding:8px 10px;margin:4px 0;font:inherit;font-size:.78rem;cursor:pointer}
  .rb-hist span{color:#8f9cba;white-space:nowrap;font-size:.7rem}
  .rb-mini2{padding:10px!important;margin:6px 0}.rb-kv{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:.74rem;margin-top:4px}
  .rb-pill{display:inline-block;font-size:.64rem;font-weight:800;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.1);color:#dfe6f5}.rb-pill.oro{background:rgba(245,207,107,.2);color:#ffe9a8}
  .rb-neg-t{color:#ff8a80}
  .rb-chips2{display:grid;grid-template-columns:auto 1fr 1fr auto;gap:6px;margin-top:6px}.rb-chips2 .btn{justify-content:center;white-space:nowrap;min-width:0;padding-left:6px!important;padding-right:6px!important}
  #rbSheet .btn.rb-soltar{width:auto;margin:0}
  .rb-firma{margin:8px 0}.rb-firma.nueva{border-color:rgba(245,207,107,.75)!important;box-shadow:0 0 0 1px rgba(245,207,107,.3),0 10px 30px rgba(245,190,70,.15)!important}
  .rb-prog2{height:6px;border-radius:9px;background:rgba(255,255,255,.1);overflow:hidden;margin:10px 0 4px}.rb-prog2 i{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#5ef0b0);animation:pulse 1.6s ease-in-out infinite}
  .rb-sii{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0}.rb-sii div{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:7px 9px;min-width:0}
  .rb-sii small{display:block;font-size:.64rem;color:#8f9cba}.rb-sii b{font-size:.8rem;word-break:break-word}
  .rb-chk{display:flex;gap:6px;align-items:center;font-size:.8rem;margin-top:8px}
  #rbSheet .rb-neg{padding:12px;border-radius:18px}
  #rbSheet .rb-etapas button{font-size:.7rem;padding:5px 9px}
  .rb-mas{margin-top:18px}
  .rb-portal{display:flex;gap:4px;margin:0 0 10px;padding:4px;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
  .rb-portal button{flex:1;border:0;background:none;color:#a9b8d9;font:inherit;font-size:.82rem;font-weight:800;padding:8px 0;border-radius:10px;cursor:pointer}
  .rb-portal button{font-size:.74rem;padding:8px 2px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
  .rb-portal button.on{background:linear-gradient(180deg,#fff0bd,#f5cf6b 45%,#c48f17);color:#2a1a00;box-shadow:0 4px 14px rgba(245,190,70,.3)}
  .rb-plazo{margin:8px 0;padding:10px;border-radius:14px;border:1px solid rgba(94,240,176,.4);background:rgba(94,240,176,.08);font-size:.8rem}
  .rb-plazo.nuevo{border-color:rgba(245,207,107,.7);background:rgba(245,207,107,.1)}.rb-plazo.pronto{border-color:rgba(255,190,80,.7);background:rgba(255,190,80,.1)}
  .rb-plazo.tarde{border-color:rgba(255,100,100,.75);background:rgba(255,90,90,.12)}
  .rb-prod{padding:8px 10px;margin:6px 0;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);font-size:.8rem}
  .rb-prod .rb-row{font-size:.7rem;color:#a9b8d9}
  .rb-ejrow{margin:10px 0 4px;padding:8px 10px;border-radius:12px;background:rgba(120,180,255,.08);border:1px solid rgba(120,180,255,.25);font-size:.78rem}
  #rbSheet .rb-portada{position:relative;overflow:hidden;margin:-6px -4px 0;padding:22px 16px 26px;border-radius:24px;min-height:82vh;
    background:radial-gradient(120% 80% at 80% -10%,rgba(245,207,107,.35),transparent 55%),radial-gradient(90% 60% at -10% 110%,rgba(94,140,255,.25),transparent 60%),linear-gradient(170deg,#0b1430,#05070f 70%)}
  #rbSheet .rb-p-brillo{position:absolute;right:-60px;top:-60px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,#fff6d6 0,#f5cf6b 35%,transparent 70%);opacity:.55;filter:blur(6px);animation:rbLatido 4s ease-in-out infinite}
  @keyframes rbLatido{50%{opacity:.8;transform:scale(1.06)}}
  #rbSheet .rb-p-top{position:relative;display:flex;justify-content:space-between;align-items:center;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:#cbb67a}
  #rbSheet .rb-p-logo{font-weight:900;color:#ffe9a8;letter-spacing:.12em}
  #rbSheet .rb-p-h{position:relative;margin:26px 0 10px;font-size:2.05rem;line-height:1.08;font-weight:900;color:#fff}
  #rbSheet .rb-p-h span{background:linear-gradient(90deg,#ffe9a8,#f5cf6b 45%,#c48f17);-webkit-background-clip:text;background-clip:text;color:transparent}
  #rbSheet .rb-p-sub{position:relative;color:#c6cde3;font-size:.9rem;line-height:1.45}
  #rbSheet .rb-p-stats{position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:18px 0}
  #rbSheet .rb-p-stats div{padding:10px 6px;border-radius:16px;text-align:center;background:rgba(255,255,255,.06);border:1px solid rgba(245,207,107,.28)}
  #rbSheet .rb-p-stats b{display:block;font-size:1.2rem;color:#ffe9a8}#rbSheet .rb-p-stats small{font-size:.64rem;color:#aab3cc}
  #rbSheet .rb-p-rut{position:relative;display:block;font-size:.74rem;color:#cbb67a;letter-spacing:.06em;text-transform:uppercase}
  #rbSheet .rb-p-rut input{display:block;width:100%;margin-top:6px;padding:16px;border-radius:18px;border:1px solid rgba(245,207,107,.55);background:rgba(0,0,0,.35);color:#fff;font:inherit;font-size:1.3rem;font-weight:800;letter-spacing:.06em;text-align:center}
  #rbSheet .rb-p-jugar{position:relative;width:100%;margin-top:12px;padding:18px;font-size:1.25rem;font-weight:900;letter-spacing:.14em;border-radius:20px;box-shadow:0 10px 40px rgba(245,207,107,.35)}
  #rbSheet .rb-p-nota{position:relative;margin-top:8px;font-size:.72rem;color:#9aa3bd;text-align:center}
  #rbSheet .rb-p-con-t{position:relative;margin:22px 0 8px;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:#8f9cba}
  #rbSheet .rb-p-con{position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  #rbSheet .rb-con{display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 4px;border-radius:16px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#e6e9f5;font:inherit;cursor:pointer;text-align:center}
  #rbSheet .rb-con .i{font-size:1.5rem}#rbSheet .rb-con b{display:block;font-size:.8rem}#rbSheet .rb-con small{display:block;font-size:.6rem;color:#9aa3bd}
  #rbSheet .rb-con.on{border-color:rgba(94,240,176,.6);background:rgba(94,240,176,.1)}#rbSheet .rb-con.on small{color:#9ff0c9}
  #rbSheet .rb-p-form{position:relative;display:flex;gap:8px;margin-top:8px}#rbSheet .rb-p-form input{flex:1;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.35);color:#fff;font:inherit}
  #rbSheet .rb-p-desc{margin:6px 0 8px;padding:10px 12px;border-radius:16px;background:rgba(120,180,255,.08);border:1px solid rgba(120,180,255,.3);font-size:.78rem}
  #rbSheet .rb-p-desc summary{cursor:pointer;list-style:none}
  #rbSheet .rb-libro{margin:10px 0;padding:10px 12px;border-radius:16px;background:linear-gradient(160deg,rgba(245,207,107,.14),rgba(255,255,255,.03));border:1px solid rgba(245,207,107,.38)}
  #rbSheet .rb-libro summary{display:flex;justify-content:space-between;align-items:center;cursor:pointer;font-weight:800;font-size:.86rem;color:#ffe9a8;list-style:none}
  #rbSheet .rb-libro summary b{font-size:.78rem;padding:3px 10px;border-radius:99px;background:rgba(245,207,107,.18);border:1px solid rgba(245,207,107,.45)}
  #rbSheet .rb-nivel{margin:8px 0 4px;font-size:.74rem}
  #rbSheet .rb-filtro-ganador{margin:6px 0 8px;padding:10px 12px;border-radius:16px;background:linear-gradient(160deg,rgba(245,207,107,.16),rgba(255,255,255,.03));border:1px solid rgba(245,207,107,.45);font-size:.8rem}
  #rbSheet .rb-filtro-ganador .rb-link{padding:4px 0!important;font-size:.72rem;color:#ffb3b9;text-align:left;white-space:normal}
  #rbSheet .rb-chip-si,#rbSheet .rb-chip-no,#rbSheet .rb-chip-esp{margin-top:4px;font-size:.72rem;padding:4px 8px;border-radius:10px;display:inline-block}
  #rbSheet .rb-chip-si{background:rgba(94,240,176,.14);color:#c9ffe6;border:1px solid rgba(94,240,176,.4)}
  #rbSheet .rb-chip-no{background:rgba(255,90,90,.12);color:#ffc4c4;border:1px solid rgba(255,90,90,.35)}
  #rbSheet .rb-chip-esp{background:rgba(255,255,255,.05);color:#d6dcef;border:1px solid rgba(255,255,255,.14)}
  #rbSheet .rb-mkc{margin-top:10px;padding:8px 10px;border-radius:12px;font-size:.74rem;line-height:1.45;background:rgba(94,240,176,.08);border:1px solid rgba(94,240,176,.35)}
  #rbSheet .rb-mkc span{opacity:.7}#rbSheet .rb-mkc.mal{background:rgba(255,90,90,.12);border-color:rgba(255,90,90,.5)}#rbSheet .rb-mkc.espera{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.14);opacity:.85}
  #rbSheet .rb-yo{flex:none;background:rgba(94,240,176,.12);border:1px solid rgba(94,240,176,.4);color:#dfffee;border-radius:99px;padding:6px 10px;font:inherit;font-size:.74rem;font-weight:700;cursor:pointer;white-space:nowrap}
  #rbAtras{position:fixed;left:0;top:50%;z-index:2147483646;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;
    font:700 30px/1 system-ui;color:#1a1300;background:linear-gradient(180deg,#ffe9a8,#f5cf6b);box-shadow:0 6px 22px rgba(0,0,0,.45);opacity:0;pointer-events:none;
    transform:translate3d(-40px,-50%,0) scale(.7);transition:opacity .15s}
  #rbAtras.listo{box-shadow:0 0 0 4px rgba(245,207,107,.35),0 6px 22px rgba(0,0,0,.45)}
  #rbSheet .rb-nav{left:10px;right:10px;bottom:calc(8px + env(safe-area-inset-bottom,0px));padding:6px;border-radius:22px;border:1px solid rgba(245,207,107,.28);
    background:linear-gradient(180deg,rgba(14,28,60,.92),rgba(4,12,32,.94));box-shadow:0 10px 30px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.08)}
  #rbSheet .rb-nav button.on{background:linear-gradient(180deg,rgba(245,207,107,.22),rgba(245,207,107,.08));box-shadow:inset 0 0 0 1px rgba(245,207,107,.35)}
  #rbSheet{padding-bottom:calc(100px + env(safe-area-inset-bottom,0px))}
  .rb-cartera{grid-column:1/-1;border-radius:18px;padding:12px 14px 6px;border:1px solid rgba(245,207,107,.45);
    background:linear-gradient(160deg,rgba(255,226,140,.16),rgba(255,255,255,.03) 55%,rgba(18,160,190,.10));box-shadow:inset 0 1px 0 rgba(255,255,255,.16)}
  .rb-cartera .rb-ctop{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
  .rb-cartera b{font-family:"Fraunces",serif;font-size:2rem;font-weight:600;line-height:1.05}
  .rb-cartera svg{display:block;width:100%;height:46px;margin-top:4px}
  .rb-up{color:var(--vivo);font-weight:800;font-size:.8rem}
  /* deslizar fluido */
  #rbSheet .rb-swipe{touch-action:pan-y}
  #rbSheet .vuela{transition:transform .22s cubic-bezier(.2,.7,.3,1),opacity .22s}
  #rbSheet .cierra{transition:max-height .22s ease,margin .22s ease,padding .22s ease,opacity .18s;overflow:hidden}
  /* ⭐ apuesta en Seleccionadas */
  .rb-rival{display:inline-block;font-size:.7rem;font-weight:800;padding:2px 9px;border-radius:999px;margin-left:4px;vertical-align:middle}
  .rb-rival.solo{background:linear-gradient(180deg,#fff0bd,#f5cf6b);color:#2a1a00;box-shadow:0 0 14px rgba(245,207,107,.5)}
  .rb-rival.pocos{background:rgba(94,240,176,.16);color:var(--vivo);border:1px solid rgba(94,240,176,.4)}
  .rb-rival.muchos{background:rgba(255,255,255,.08);color:#c9d4ee;border:1px solid rgba(255,255,255,.15)}
  #rbSheet .rb-sel .rb-precio{font-family:"Fraunces",serif;font-size:2.3rem;font-weight:600;letter-spacing:-.02em}
  #rbSheet .rb-range{height:12px;background:rgba(255,255,255,.12);margin:16px 0 6px;box-shadow:inset 0 1px 3px rgba(0,0,0,.5)}
  #rbSheet .rb-range::-webkit-slider-thumb{width:34px;height:34px;border:0;background:radial-gradient(circle at 35% 30%,#fffaf0,#f5cf6b 45%,#b37a0f);box-shadow:0 0 0 4px rgba(245,207,107,.25),0 4px 14px rgba(0,0,0,.5)}
  #rbSheet .rb-range::-moz-range-thumb{width:30px;height:30px;border:0;background:#f5cf6b}
  .rb-ticket{margin:12px 0 8px;border-radius:16px;padding:12px;background:linear-gradient(160deg,rgba(4,10,30,.65),rgba(10,40,70,.55));border:1px solid rgba(245,207,107,.35);position:relative;overflow:hidden}
  .rb-ticket::after{content:"";position:absolute;top:-40%;left:-60%;width:40%;height:180%;transform:rotate(20deg);background:linear-gradient(90deg,transparent,rgba(255,240,190,.10),transparent);animation:rbBrillo 4.5s ease-in-out infinite;pointer-events:none}
  @keyframes rbBrillo{0%,60%{left:-60%}100%{left:130%}}
  .rb-ticket .t{display:flex;justify-content:space-between;align-items:center;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;opacity:.75;margin-bottom:8px}
  .rb-ticket .g{display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;text-align:center}
  .rb-ticket .g small{display:block;font-size:.66rem;opacity:.7}.rb-ticket .g b{font-size:1rem}
  .rb-ticket .flecha{font-size:1.1rem;opacity:.6}
  .rb-cuota{display:inline-block;font-family:"IBM Plex Mono",monospace;font-weight:700;font-size:.9rem;padding:3px 10px;border-radius:10px;background:rgba(245,207,107,.15);color:var(--oro);border:1px solid rgba(245,207,107,.45)}
  .rb-prob{height:8px;border-radius:9px;background:rgba(255,255,255,.1);overflow:hidden;margin:8px 0 2px}
  .rb-prob i{display:block;height:100%;border-radius:9px;background:linear-gradient(90deg,#1fb98a,#5ef0b0,#f5cf6b);transition:width .25s}
  .rb-si-ganas{display:flex;justify-content:space-between;align-items:flex-end;margin-top:8px}
  .rb-si-ganas b{font-family:"Fraunces",serif;font-size:1.8rem;font-weight:600}
  .btn.rb-soltar{width:100%;margin-top:6px;background:linear-gradient(180deg,rgba(94,240,176,.22),rgba(20,120,90,.18))!important;border-color:rgba(94,240,176,.55)!important;color:#dfffee!important;font-weight:800}
  .btn.rb-soltar.brilla{box-shadow:0 0 0 1px rgba(94,240,176,.5),0 0 22px rgba(94,240,176,.35)!important}
  `;
  document.head.appendChild(css);

  /* ---------------- estado ---------------- */
  const R = { token: leer().token || null, data: null, err: null, previos: {}, timer: null, enCurso: false, foco: null,
              vista: (leer().v_cajas ? leer().vista : "oport") || "oport", detalle: null, push: false, instalar: null,
              oportTab: leer().oportTab || "nuevas", toque: 0, cnt: {} };
  try { const __ui = leerUI();                         // 💾 vuelve a donde estabas
    if (__ui.anl) R.anl = __ui.anl;
    if (__ui.pantalla === "llamada" || __ui.pantalla === "analizador" || __ui.pantalla === "claude") R.pantalla = __ui.pantalla;
    if (__ui.llamada) R.llamada = __ui.llamada; } catch {}
  // ---- rapidez: lo último que se vio queda guardado y se muestra al instante; la red solo actualiza
  const CK = "sdc:cache:";
  const deCache = (k) => { try { return JSON.parse(localStorage.getItem(CK + k)); } catch { return null; } };
  const aCache = (k, v) => { try { localStorage.setItem(CK + k, JSON.stringify(v)); } catch {} };
  if (R.token) {
    const c = deCache("estado2"); if (c?.data) { R.data = c.data; R.ver = null; }
    const o = deCache("oport2"); if (o?.lista) { R.oport = o; R.oportViejo = true; }
    const g = deCache("seg"); if (g?.seg) { R.seg = g.seg; R.segT = 0; }
  }

  async function api(ruta, opt = {}) {
    if (!R.token) throw new Error("Robot sin enlazar");
    if (opt.body && /^(pedir|seleccionar|preguntar|cerebro|oport-descartar|plan-links|nube-aprobar|robot-mando|mp-login|mp-login-resp)$/.test(ruta)) {      // cada pedido viaja con TU empresa, tu celular y tu juego
      try { const o = JSON.parse(opt.body); if (!o.empresa && leer().empresa) o.empresa = leer().empresa; if (!o.dispositivo) o.dispositivo = dispositivo(false);
        o.jugador = miJug(); if (legado()) o.legado = true; if (!o.persona && typeof persona === "function" && persona()?.nombre) o.persona = persona().nombre; opt = { ...opt, body: JSON.stringify(o) }; } catch {}
    }
    if (/^(seleccionadas|oportunidades|oport-descartes)(\?|$)/.test(ruta)) ruta += (ruta.includes("?") ? "&" : "?") + "jugador=" + miJug() + (legado() ? "&legado=1" : "");
    const r = await fetch("/bot/" + ruta, {
      ...opt,
      headers: { "x-robot-token": R.token, ...(opt.body ? { "content-type": "application/json" } : {}), ...(opt.headers || {}) },
      cache: "no-store",
    });
    const tipo = r.headers.get("content-type") || "";
    const j = tipo.includes("json") ? await r.json().catch(() => ({})) : null;
    if (r.status === 401) { const e = new Error(j?.error || "Código de enlace inválido"); e.auth = true; throw e; }
    if (!r.ok && r.status !== 409) throw new Error(j?.error || `Error ${r.status}`);
    return j ? { ...j, _status: r.status } : r;
  }
  const trabajo = (cod) => R.data?.trabajos?.find((t) => t.codigo === String(cod).toUpperCase());
  // 🌍 el asistente y el informe global ven TODOS los juegos (cada juego sigue siendo independiente para jugar)
  const trabajoG = (cod) => { const c = String(cod).toUpperCase(); return trabajo(c) || (R.todos || []).find((t) => t.codigo === c) || (R.ejec || []).find((t) => t.codigo === c) || (R.global?.trabajos || []).find((t) => t.codigo === c); };
  // ✉ desglose de la oferta por producto y monto (lo piden los compradores antes de adjudicar)
  function desgloseTexto(t) {
    const emp = empresaActual() || {}, its = (t.items || []).filter((i) => i.d), n = (v) => Math.round(Number(v) || 0);
    const li = its.map((i, k) => { const q = Number(i.q) || 1, p = n(i.p); return { k: k + 1, d: i.d, q, p, s: q * p }; });
    const neto = li.reduce((a, x) => a + x.s, 0), total = n(t.total), conIva = total && Math.abs(neto * 1.19 - total) < Math.abs(neto - total);
    const base = conIva ? neto : total && Math.abs(neto - total) > 2 ? Math.round(total / 1.19) : neto, iva = Math.round(base * 0.19);
    const fila = (x) => `${x.k}. ${x.d} — ${x.q.toLocaleString("es-CL")} x ${clp(x.p)} = ${clp(x.s)}`;
    return `Estimada/o:\n\nJunto con saludar, adjunto el desglose de la cotización ${t.codigo}${t.nombre ? " (" + t.nombre + ")" : ""}:\n\n${li.map(fila).join("\n")}\n\nNeto: ${clp(base)}\nIVA 19 %: ${clp(iva)}\nTotal: ${clp(total || base + iva)}\n\nLos valores son unitarios netos; el total incluye IVA, despacho a ${t.oc_compra?.direccion || t.organismo || "destino"} y la validez indicada en la oferta.\n\nQuedo atento a cualquier consulta.\n\nAtentamente,\n${emp.razon_social || ""}${emp.rut ? "\nRUT " + emp.rut : ""}${emp.telefono ? "\n" + emp.telefono : ""}`;
  }
  // 🤝 2 (o más) jugadores conectados: lo que OTRO juego ya tomó/envió NO se le repite a este. Devuelve el nombre del que la tiene, o null.
  const LIBRE_OTRO = new Set(["cancelada", "rechazada", "descartada"]);
  const tomadaOtro = (cod) => { const c = String(cod).toUpperCase(), mio = miJug();
    const t = (R.todos || []).find((t) => t.codigo === c && t.jugador && t.jugador !== mio && !LIBRE_OTRO.has(t.estado));
    return t ? (t.persona || t.dispositivo || "otro jugador") : null; };
  // 🏢 cada celular ve y oferta solo con su empresa ("principal" = la del robot del PC)
  const miEmp = () => leer().empresa || null;
  // 🏢 Multiusuario: cada empresa ve SOLO sus rubros y sus cotizaciones (Diego · PJANIC / Nicolás · NS Comex)
  const RUBROS_EMP_DEF = [[/pjanic/i, ["Áridos y materiales de calle", "Electro y tecnología", "Imprenta y publicidad", "Mobiliario y equipamiento", "Polietileno y bolsas"]],
    [/ns ?comex|comex/i, ["Arriendos y logística", "Catering y alimentación", "Eventos y amplificación", "Limpia fosas y sanitarios", "Mantención y reparación técnica", "Obras y servicios mayores"]]];
  const rubrosDeEmp = (e) => { if (!e) return null; if (Array.isArray(e.rubros_app) && e.rubros_app.length) return e.rubros_app; const d = RUBROS_EMP_DEF.find(([re]) => re.test(e.razon_social || "")); return d ? d[1] : null; };
  const esMia = (t) => { const yo = miEmp(); if (!yo || leer().todasEmp) return true; const te = t.empresa || "principal"; return te === yo || (te === "principal" && /pjanic/i.test((R.empresas || {})[yo]?.razon_social || "")); };
  function aplicarRubrosEmp(e) { const r = rubrosDeEmp(e); if (r) guardar({ rubros: r, rubroListo: 1, rubrosEmp: e.id }); }
  const deMiEmpresa = (x) => !miEmp() || (x?.empresa || "principal") === miEmp();
  // 🎮 cada celular es un juego aparte: ve solo lo que pidió él (lo de antes de separar, solo si este celular lo pidió)
  function miJug() {
    let j = null; try { j = localStorage.getItem("sdc:jugador"); } catch {}
    if (!j) { j = "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); try { localStorage.setItem("sdc:jugador", j); } catch {} }
    return j;
  }
  const legado = () => leer().legado === true;
  const deMiJuego = (t) => (t.jugador ? t.jugador === miJug() : legado()) && deMiEmpresa(t);
  // Las LISTAS PARA FIRMAR las ve el dueño aunque sean de otro juego, pero SOLO de SU empresa (estricto: nunca mezcla empresas).
  const paraElDueno = (t) => ["firmar", "lista", "requiere", "error"].includes(t.estado) && !!miEmp() && (t.empresa || "principal") === miEmp();
  function filtrarEmpresa(d) { if (d) R.hayLegado = (d.trabajos || []).some((t) => !t.jugador); return d ? { ...d, trabajos: (d.trabajos || []).filter((t) => deMiJuego(t) || paraElDueno(t)) } : d; }
  const empresaActual = () => (R.empresas || {})[miEmp()] || null;
  async function cargarEmpresas() {
    if (R._cargEmp) return; R._cargEmp = true;
    try { R.empresas = (await api("empresas")).empresas || {}; } catch (e) { R.empresas = R.empresas || {}; }
    // Solo autoselecciona PJANIC cuando hay UNA sola empresa (un único dueño). Con varias empresas, cada celular nuevo ELIGE la suya.
    try { const ye = miEmp() && (R.empresas || {})[miEmp()]; if (ye && leer().rubrosEmp !== ye.id && rubrosDeEmp(ye)) { aplicarRubrosEmp(ye); R.oport = null; } } catch {}
    try { if (!miEmp() && Object.keys(R.empresas || {}).length <= 1) { const pj = Object.values(R.empresas || {}).find((e) => /pjanic/i.test(e.razon_social || "") || (e.rut || "").replace(/[.\-]/g, "") === "784931145"); if (pj) guardar({ empresa: pj.id }); } } catch {}
    R._cargEmp = false; pintarHoja(true);
  }

  /* ---------- quién envía + cerrar la pestaña de Mercado Público cuando queda enviada ---------- */
  const DISP = "sdc:dispositivo";
  function dispositivo(preguntar) {
    let d = (localStorage.getItem(DISP) || "").trim();
    const ua = navigator.userAgent;
    const def = /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) ? "iPad" : /android/i.test(ua) ? "Android" : "Celular";
    if (!d && preguntar) {
      d = (prompt("¿Nombre de este celular? Queda en el registro «Enviados» del PC (ej. iPhone Felipe).", def) || def).trim().slice(0, 40);
      localStorage.setItem(DISP, d);
    }
    return d || def;
  }
  const ABIERTAS = {};          // compras abiertas con «Ir a firmar»: {codigo: {w, t}}
  let ocultaDesde = 0;
  async function verificarAbiertas() {
    if (Date.now() - ocultaDesde < 40_000) return;   // volvió muy rápido: aún no alcanzó a firmar
    for (const [cod, x] of Object.entries(ABIERTAS)) {
      if (Date.now() - x.t > 45 * 60_000) { delete ABIERTAS[cod]; continue; }
      if (x.pedido && Date.now() - x.pedido < 90_000) continue;
      x.pedido = Date.now();      // ya no se pide «verificar» por tiempo: solo cuenta la pantalla «enviada correctamente» de MP o tu «Ya la firmé»
    }
  }
  function cerrarEnviadas(lista) {
    for (const t of lista) {
      const x = ABIERTAS[t.codigo];
      if (!x || !["enviada", "confirmada"].includes(t.estado)) continue;
      try { if (x.w && !x.w.closed) x.w.close(); } catch {}
      delete ABIERTAS[t.codigo];
      toast("✓ Cotización enviada correctamente · " + t.codigo);
    }
  }

  /* ---------------- avisos ---------------- */
  function toast(msg) {
    const t = $("#toast"); if (!t) return;
    t.textContent = msg; t.classList.add("on");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 3200);
  }
  function sonar() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.22].forEach((d) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(0.0001, ac.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d + 0.18);
        o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.2);
      });
    } catch {}
  }
  async function notificar(titulo, cuerpo, urgente, tag) {
    toast(titulo);
    if (urgente) { sonar(); try { navigator.vibrate?.([180, 90, 180]); } catch {} }
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    // mismo «tag» que el aviso push del servidor: si llegan los dos, el teléfono muestra uno solo
    const op = { body: cuerpo, icon: "/icon-512.png", badge: "/icon-180.png", tag: tag || "robot-" + titulo, renotify: true };
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg) return reg.showNotification(titulo, op);
      new Notification(titulo, op);
    } catch {}
  }
  function revisarCambios(lista) {
    const primera = !Object.keys(R.previos).length;
    for (const t of lista) {
      const antes = R.previos[t.codigo];
      R.previos[t.codigo] = t.estado;
      if (primera || antes === t.estado) continue;
      const n = t.nombre ? ` · ${t.nombre.slice(0, 60)}` : "";
      const tag = `rb-${t.codigo}-${t.estado}`;
      if (t.estado === "lista") notificar(`Falta tu clic · ${t.codigo}`, `${clp(t.total)}${n}. Presiona «Enviar cotización» y acepta la declaración.`, true, tag);
      else if (t.estado === "confirmada") notificar(`Oferta confirmada · ${t.codigo}`, `${clp(t.total)}${n}`, true, tag);
      else if (t.estado === "enviada") notificar(`Oferta enviada · ${t.codigo}`, `${clp(t.total)}${n}`, true, tag);
      else if (t.estado === "requiere" || t.estado === "error") notificar(`Necesita tu atención · ${t.codigo}`, t.mensaje || "", true, tag);
      else if (t.estado === "firmar") notificar(`Lista para firmar · ${t.codigo}`, `${clp(t.total)}${n}. Toca «Ir a firmar» y usa Rellenar.`, true, tag);
      else if (t.estado === "probada") notificar(`Prueba lista · ${t.codigo}`, `${clp(t.total)}${n}`, false, tag);
    }
  }

  /* ---------------- app instalable + avisos push ---------------- */
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalada = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function abrirEnSafari(cod) {
    const conectar = cod === "conectar";
    const url = location.origin + "/firmar.html#" + encodeURIComponent(cod);   // puente: recuerda la compra y vuelve a ella tras iniciar sesión
    const enVivo = !conectar && R.data?.mp?.conectado;
    document.getElementById("rbSafari")?.remove();
    const d = document.createElement("div");
    d.id = "rbSafari";
    d.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 8px);z-index:2147483646;width:min(92vw,360px);" +
      "background:#0b1c3c;color:#f6f8fc;border:1.5px solid #7c4dff;border-radius:12px;padding:10px 12px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.4)";
    d.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <b data-x="estado">${conectar ? "Conectar tu Mercado Público" : enVivo ? `🟢 Tu Mercado Público va a la ${esc(cod)}` : `Copiando enlace de ${esc(cod)}…`}</b><span data-x="cerrar" style="cursor:pointer;font-size:18px;padding:0 4px;line-height:1">×</span></div>
      <div style="margin-top:4px;opacity:.9">${conectar
        ? "Abre <b>Safari</b> → mantén presionada la barra → <b>Pegar e ir</b>, e inicia sesión. Deja esa pestaña abierta: aquí verás «🟢 conectado»."
        : enVivo ? "Cambia a <b>Safari</b>: la pestaña de Mercado Público salta sola a la compra y la llena."
        : "Abre <b>Safari</b>, mantén presionada la barra de direcciones → <b>Pegar e ir</b>. Se llena sola."}</div>
      <div style="margin-top:6px;display:flex;gap:12px;font-size:12px">
        <span data-x="copiar" style="color:#d9c9ff;text-decoration:underline;cursor:pointer">Copiar de nuevo</span></div>
      <a href="x-safari-${url}" style="display:block;margin-top:8px;text-align:center;background:#7c4dff;color:#fff;border-radius:9px;padding:9px;font-weight:700;text-decoration:none">${conectar ? "Abrir Mercado Público en Safari" : "Abrir compra en Safari"}</a>`;
    const estado = (txt) => { const b = d.querySelector("[data-x=estado]"); if (b) b.textContent = txt; };
    const copiarYa = async () => { const ok = await copiar(url); if (!enVivo) estado(ok ? (conectar ? "✓ Enlace para conectar copiado" : `✓ Enlace de ${cod} copiado`) : "No se pudo copiar: toca «Copiar de nuevo»"); };
    d.addEventListener("click", (ev) => {
      const x = ev.target.closest("[data-x]")?.dataset.x;
      if (x === "cerrar") d.remove();
      if (x === "copiar") copiarYa();
    });
    document.body.append(d);
    copiarYa();
    setTimeout(() => d.remove(), 30000);
  }
  async function registrarSW() {
    if (!("serviceWorker" in navigator)) return null;
    try { return await navigator.serviceWorker.register("/sw.js", { scope: "/" }); } catch { return null; }
  }
  const swListo = registrarSW();
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); R.instalar = e; pintarHojaSiAbierta(); });
  window.addEventListener("appinstalled", () => { R.instalar = null; toast("App instalada"); pintarHojaSiAbierta(); });
  navigator.serviceWorker?.addEventListener?.("message", (e) => {
    if (e.data?.tipo === "abrir") { location.hash = new URL(e.data.url).hash; desdeHash(); }
  });

  const b64aBytes = (s) => {
    const p = "=".repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  };
  async function suscribirPush(preguntar) {
    if (!R.token || !("PushManager" in window) || !("Notification" in window)) return false;
    if (Notification.permission === "default" && preguntar) { try { await Notification.requestPermission(); } catch {} }
    if (Notification.permission !== "granted") return false;
    const reg = await swListo; if (!reg) return false;
    try {
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { publicKey } = await api("push-clave");
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(publicKey) });
      }
      await api("push-suscribir", { method: "POST", body: JSON.stringify({ sub: sub.toJSON() }) });
      R.push = true;
      return true;
    } catch (e) { R.push = false; if (preguntar) toast("No se pudieron activar los avisos: " + e.message); return false; }
  }
  async function estadoPush() {
    try { const reg = await swListo; R.push = !!(reg && await reg.pushManager?.getSubscription()); } catch { R.push = false; }
  }
  // 👆👆 doble toque arriba: vuelve al inicio (sin zoom, arriba de todo, sin pantallas abiertas)
  function volverAlOrigen() {
    try { document.activeElement?.blur(); } catch {}
    R.pantalla = null; R.detalle = null; R.conf = null; R.ejAbierto = null; R.llamada = null;
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp) { const orig = vp.getAttribute("content"); vp.setAttribute("content", orig + ", maximum-scale=1"); setTimeout(() => vp.setAttribute("content", orig), 400); }
    if (sheet) sheet.scrollTop = 0; window.scrollTo(0, 0);
    pintarHoja(true); navigator.vibrate?.(12); toast("↩ Volviste al inicio");
  }
  async function ejOpVivo(cod, datos, msg) {
    try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, datos, dispositivo: dispositivo(false) }) }); if (msg) toast(msg); R.ejecT = 0; await cargarEjecuta(); pintarHoja(true); } catch (e) { toast(e.message); }
  }
  function pintarHojaSiAbierta() { if (sheet?.classList.contains("on")) pintarHoja(); }

  /* ---------------- ciclo de consulta ---------------- */
  async function refrescar() {
    clearTimeout(R.timer);
    if (!R.token) { pintar(); return; }
    let cambio = true;
    try {
      const r = await fetch("/bot/estado?ligero=1", { headers: { "x-robot-token": R.token, ...(R.ver && R.data ? { "x-ya-tengo": R.ver } : {}) }, cache: "no-store" });
      if (r.status === 401) { const e = new Error("Código de enlace inválido"); e.auth = true; throw e; }
      if (r.status === 204) cambio = false;                       // nada nuevo: no se descarga ni se repinta nada
      else if (!r.ok) throw new Error("Error " + r.status);
      else {
        const crudo = await r.json(); R.todos = crudo.trabajos || []; R.data = filtrarEmpresa(crudo); R.ver = r.headers.get("x-version");
        revisarCambios(R.data.trabajos || []);
        cerrarEnviadas(R.data.trabajos || []);
        aCache("estado2", { data: R.data });
      }
      if (R.err) cambio = true; R.err = null;
    } catch (e) {
      R.err = e.message;
      if (e.auth) { R.token = null; guardar({ token: null }); }
    }
    if (cambio) pintar();
    const activos = (R.data?.trabajos || []).some((t) => est(t.estado).activo);
    const abierto = $("#rbSheet")?.classList.contains("on");
    if (!document.hidden) R.timer = setTimeout(refrescar, activos ? POLL_RAPIDO : abierto ? 12000 : POLL_LENTO);
  }
  // 🔄 auto-actualiza: si el servidor tiene una versión nueva de la app, la recarga sola (sin botar la app a mano)
  let _appLen = null;
  async function chequeaActualiza() {
    try {
      const r = await fetch("/public/robot.js?v=" + Date.now(), { method: "HEAD", cache: "no-store" });
      const len = r.headers.get("content-length");
      if (!len) return;
      if (_appLen === null) { _appLen = len; return; }
      if (len !== _appLen) { _appLen = len; try { toast("🔄 Actualizando a la última versión…"); } catch (e) {} setTimeout(() => location.reload(), 700); }
    } catch (e) {}
  }
  setTimeout(chequeaActualiza, 3000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { ocultaDesde = Date.now(); return; }
    chequeaActualiza();
    verificarAbiertas().finally(refrescar);           // al volver de Mercado Público el robot revisa solo si quedó enviada
  });

  /* ---------------- enlazar ---------------- */
  function enlazar(tok) {
    tok = String(tok || "").trim();
    if (tok.length < 16) { toast("Código de enlace incompleto"); return false; }
    R.token = tok; guardar({ token: tok }); R.previos = {};
    refrescar(); toast("Robot enlazado");
    suscribirPush(false);
    return true;
  }
  // enlaces que abren el robot: #enlazar=<código> (QR del PC) y #robot=<compra> (avisos)
  function desdeHash() {
    const f = location.hash.match(/^#firmada=([A-Za-z0-9-]+)/);      // ⚡ vuelves de firmar en Mercado Público: sigue el juego al instante
    if (f) {
      const cod = decodeURIComponent(f[1]).toUpperCase();
      history.replaceState(null, "", location.pathname + "#inicio");
      try { sessionStorage.setItem("sdc:portada", "1"); } catch {}
      marcarFirmada(cod, false);
      setTimeout(() => { abrir(); toast("✅ " + cod + " firmada · ya no está en Firmar. ¡Va la próxima!"); }, 30);
      // ▶ y te lleva directo a la siguiente lista para firmar (de tu empresa primero); si no hay, al Inicio del cotizador
      R.siguienteDe = cod;
      const irSiguiente = () => { const yo = miEmp(); const cola = (R.data?.trabajos || []).filter((t) => t.estado === "firmar" && !yaFirmada(t) && !noFirmable(t) && t.codigo !== cod && esMia(t) && !leerOcultas()[t.codigo]).sort((a, b) => (a.empresa === yo ? 0 : 1) - (b.empresa === yo ? 0 : 1) || (Date.parse(a.cierre || 0) || 9e15) - (Date.parse(b.cierre || 0) || 9e15));
        R.siguienteDe = null; R.exFicha = null; if (cola.length) { R.detalle = cola[0].codigo; toast("▶ Siguiente: " + corta(cola[0].nombre || cola[0].codigo)); } else { R.detalle = null; R.exTab = "inicio"; toast("No queda nada por firmar 👌"); } pintarHoja(true); };
      setTimeout(irSiguiente, 1500); setTimeout(() => { if (R.siguienteDe) irSiguiente(); }, 4000);
      return;
    }
    const m = location.hash.match(/enlazar=([A-Za-z0-9_-]{16,})/);
    const r = location.hash.match(/^#robot(?:=([A-Za-z0-9-]+))?$/);
    if (!m && !r) return;
    if (m) enlazar(m[1]);
    history.replaceState(null, "", location.pathname + "#inicio");
    const cod = r?.[1] ? decodeURIComponent(r[1]).toUpperCase() : null;
    setTimeout(() => abrir(null, cod && cod !== "PRUEBA" ? cod : null), 400);
  }
  window.addEventListener("hashchange", desdeHash);
  document.addEventListener("input", (e) => { const box = e.target.closest?.(".rb-items"); if (box) itemsCalc(box.dataset.c); else if (e.target.classList?.contains("it-prov")) { const b2 = document.querySelector(".rb-items"); if (b2) itemsCalc(b2.dataset.c); } });
  document.addEventListener("click", (e) => { const b = e.target.closest?.(".it-tipo"); if (!b) return; document.querySelectorAll(".it-tipo").forEach((x) => x.classList.toggle("rb-oro", x === b)); const b2 = document.querySelector(".rb-items"); if (b2) itemsCalc(b2.dataset.c); });

  /* ---------------- UI: botón en la cabecera ---------------- */
  const chip = document.createElement("button");
  chip.type = "button"; chip.className = "rb-chip"; chip.id = "rbChip";
  chip.setAttribute("aria-label", "Robot de ofertas");
  chip.innerHTML = `<span class="rb-dot"></span><span>Robot</span>`;
  chip.addEventListener("click", () => abrir());
  const pill = $("#rubroPill");
  pill?.parentNode.insertBefore(chip, pill);

  /* ---------------- UI: hoja del robot ---------------- */
  const back = document.createElement("div"); back.className = "sheet-back"; back.id = "rbBack";
  const sheet = document.createElement("div"); sheet.className = "sheet"; sheet.id = "rbSheet";
  sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "Robot de ofertas");
  sheet.innerHTML = `<div class="sheet-in" id="rbIn"></div>`;
  document.body.append(back, sheet);
  back.addEventListener("click", cerrar);

  function abrir(foco, detalle) {
    sheet.classList.toggle("rb-exec", execOn()); sheet.classList.add("rb-color");
    R.foco = foco || null; R.conf = null; R.detalle = detalle || (foco && R.vista !== "lista" ? foco : null);
    sheet.classList.add("on"); back.classList.add("on");
    pintarHoja(); refrescar(); estadoPush().then(pintarHojaSiAbierta);
  }
  function cerrar() { sheet.classList.remove("on"); back.classList.remove("on"); R.conf = null; R.detalle = null; }

  function badge(t) {
    const e = est(t.estado);
    return `<span class="rb-badge ${e.cls}">${e.cls === "azul" && e.activo ? '<span class="spinner"></span>' : ""}${esc(e.txt)}</span>`;
  }

  /* ---------- 📑 portal Licitaciones: match → mesa de juego (bases, precio, garantías, visión) → lista → ofertada ---------- */
  const LIC_NO = "sdc:licNo";
  const licNo = () => { try { return JSON.parse(localStorage.getItem(LIC_NO) || "{}"); } catch { return {}; } };
  const tipoPorMonto = (m) => { const u = (Number(m) || 0) / utmHoy(); return u < 100 ? "L1" : u < 1000 ? "LE" : u < 5000 ? "LP" : "LR"; };
  async function cargarFirma() {
    if (R._cargFirma) return; R._cargFirma = true;
    try { const r = await api("firma"); R.firma = r.firma || null; R.firmaT = Date.now();
      if (R.firma?.procesada) { const b = await api("firma?img=lista"); if (b && b.blob) { if (R.firmaUrl) URL.revokeObjectURL(R.firmaUrl); R.firmaUrl = URL.createObjectURL(await b.blob()); } }
      pintarHojaSiAbierta(); } catch {} finally { R._cargFirma = false; }
  }
  async function cargarImgsLic(t) {
    R.licImgs = R.licImgs || {};
    for (const d of (t.lic_docs || []).filter((x) => x.tipo === "render")) {
      if (R.licImgs[d.id]) continue; R.licImgs[d.id] = "…";
      try { const r = await api(`archivo?codigo=${encodeURIComponent(t.codigo)}&tipo=doc&id=${encodeURIComponent(d.id)}`); R.licImgs[d.id] = URL.createObjectURL(await r.blob()); pintarHojaSiAbierta(); } catch { delete R.licImgs[d.id]; }
    }
  }
  // ✍️ lienzo para dibujar la firma con el dedo (estilo iLovePDF)
  function initFirmaCanvas() {
    const cv = document.getElementById("rbFirCv"); if (!cv || cv._init) return; cv._init = true;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 300, h = 160;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + "px";
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#111"; ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
    cv._ctx = ctx; let dibujando = false, ult = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener("pointerdown", (e) => { e.preventDefault(); dibujando = true; ult = pos(e); cv._dib = true; cv.setPointerCapture?.(e.pointerId); });
    cv.addEventListener("pointermove", (e) => { if (!dibujando) return; e.preventDefault(); const p = pos(e); ctx.beginPath(); ctx.moveTo(ult.x, ult.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ult = p; });
    cv.addEventListener("pointerup", () => { dibujando = false; });
    cv.addEventListener("pointerleave", () => { dibujando = false; });
  }
  function cajaFirma() {
    if (!R.firmaT || Date.now() - R.firmaT > 120000) setTimeout(cargarFirma, 0);
    const F = R.firma;
    if (F && !R.firmaEditar) return `<div class="rb-firma-ok"><div>${R.firmaUrl ? `<img src="${R.firmaUrl}" alt="Firma">` : `<span class="spinner"></span>`}</div>
      <div style="flex:1;min-width:0"><b>✍️ ${esc(F.nombre || "Representante legal")}</b><div class="muted" style="font-size:.7rem">${esc(F.rut || "")} · ${esc(F.cargo || "")} · ${F.procesada ? (F.error ? "⚠ " + esc(F.error) : "lista para estampar en los anexos") : "⟳ el robot la está limpiando…"}</div></div>
      <button class="btn small" type="button" data-rb="firma-editar">Cambiar</button></div>`;
    if (R.firmaDibujar) setTimeout(initFirmaCanvas, 0);
    return `<div class="rb-mision" style="border-color:#b78cff"><div class="rb-env"><b>✍️ Firma de la representante legal de PJANIC</b></div>
      <div class="muted" style="font-size:.72rem">Dibuja tu firma con el dedo acá abajo, o súbele una foto de tu firma en papel. El robot la limpia y la estampa en todos los anexos y en el programa de integridad.</div>
      <label class="rb-lab">Nombre completo (como en los anexos)<input class="rb-in" id="rbFirN" value="${esc(F?.nombre || "")}" placeholder="Ej: María José Pérez Soto"></label>
      <div class="rb-row"><label class="rb-lab" style="flex:1">RUT<input class="rb-in" id="rbFirR" value="${esc(F?.rut || "")}" placeholder="12.345.678-9"></label>
        <label class="rb-lab" style="flex:1">Cargo<input class="rb-in" id="rbFirC" value="${esc(F?.cargo || "Representante legal")}"></label></div>
      ${R.firmaDibujar ? `<div class="rb-sec">✍️ Dibuja tu firma aquí</div>
        <canvas id="rbFirCv" style="touch-action:none;border:1px dashed #b78cff;border-radius:10px;background:#fff;width:100%;height:160px;display:block"></canvas>
        <div class="rb-row" style="margin-top:6px"><button class="btn small" type="button" data-rb="firma-limpiar">🧽 Borrar</button><button class="btn rb-oro" type="button" data-rb="firma-guardar-dibujo" style="flex:1">✍️ Guardar firma</button></div>` : ""}
      <div class="rb-row"><button class="btn ${R.firmaDibujar ? "small" : "rb-oro rb-big-btn"}" type="button" data-rb="firma-dibujar">✍️ ${R.firmaDibujar ? "Cerrar dibujo" : "Dibujar firma"}</button><button class="btn small" type="button" data-rb="firma-subir">📷 Subir foto</button>${F ? `<button class="btn small" type="button" data-rb="firma-editar">Cancelar</button>` : ""}</div></div>`;
  }
  function cartaMatch(x) {
    const dias = Math.max(0, Math.round((Date.parse(x.cierre) - Date.now()) / 864e5));
    const tipo = x.tipo_lic || tipoPorMonto(x.monto);
    return `<div class="rb-ejcard rb-licmatch"><div class="rb-env"><span class="rb-cp">📑 ${esc(tipo)}</span><span class="${dias <= 3 ? "rb-neg-t" : "muted"}" style="font-size:.74rem">cierra en ${dias} día${dias === 1 ? "" : "s"}</span></div>
      <div class="rb-fnom" style="margin:6px 0 2px;font-size:1.02rem">${esc(x.nombre || "")}</div>
      <div class="muted" style="font-size:.74rem">${esc(x.organismo || "")}${x.region ? " · 📍 " + esc(x.region) : ""}</div>
      <div class="rb-kv" style="margin:8px 0"><span>Presupuesto <b>${clp(x.monto)}</b>${x.monto_estimado ? " <span class='muted'>(estimado)</span>" : ""}</span>${x.ganancia ? `<span class="rb-vivo-t">Gana ≈ <b>${clp(x.ganancia)}</b></span>` : ""}</div>
      <div class="muted" style="font-size:.68rem">${(Number(x.monto) || 0) / utmHoy() > 1000 ? "🛡 Sobre 1.000 UTM: pide garantía de fiel cumplimiento (5 % neto) al adjudicar." : "Bajo 1.000 UTM: normalmente sin garantía."} El robot lee las bases completas antes de que pongas un peso.</div>
      <div class="rb-row" style="margin-top:8px"><button class="btn" type="button" data-rb="lic-no" data-c="${esc(x.codigo)}" style="flex:1">✖ No vamos</button>
        <a class="btn small" href="https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(x.codigo)}" target="_blank" rel="noopener">Ficha ↗</a>
        <button class="btn rb-oro" type="button" data-rb="lic-vamos" data-c="${esc(x.codigo)}" style="flex:1">💚 Vamos</button></div></div>`;
  }
  // 🧾 Caja interactiva "Datos de ingreso": guía paso a paso para ofertar en el portal, con copiar y ✓
  const ING = "sdc:ingreso";
  const leerIng = () => { try { return JSON.parse(localStorage.getItem(ING)) || {}; } catch { return {}; } };
  const ingDe = (cod) => leerIng()[cod] || {};
  function cajaDatosIngreso(t) {
    const L = t.lic || {}, X = L.experto || {}, c = esc(t.codigo);
    const Oe = X.oferta_economica || {}, emp = empresaActual() || {};
    const nombreOferta = `${(emp.razon_social || "PJANIC").split(" ").slice(0, 2).join(" ")} · ${(L.producto || t.nombre || "").slice(0, 40)}`;
    const precioTxt = L.precio_unit ? `${clp(L.precio_unit)} ${esc(Oe.neto_o_iva || "neto")} ${esc(Oe.unitario_o_total || "")}`.trim() : "—";
    const base = [
      { k: "nombre", ico: "📝", lab: "Nombre de la oferta (SIN precios)", val: nombreOferta },
      { k: "precio", ico: "💲", lab: "Oferta económica (Anexo 2)", val: precioTxt },
    ];
    const adm = (X.admisibilidad || []).map((a, i) => ({ k: "adm" + i, ico: "📎", lab: (a.requisito || "Documento") + (a.documento ? " — " + a.documento : ""), nota: a.seccion_portal || "", firma: a.firma && !/no/i.test(String(a.firma)) }));
    const extra = [];
    if ((t.lic_docs || []).some((d) => d.tipo === "render")) extra.push({ k: "render", ico: "🎨", lab: "Adjuntar el render del proyecto" });
    extra.push({ k: "integridad", ico: "🧩", lab: "Pacto de integridad (aceptar en el portal)" });
    extra.push({ k: "enviar", ico: "🚀", lab: "Finalizar y ENVIAR · guarda el comprobante" });
    const items = adm.length ? [...base, ...adm, ...extra]
      : [...base, { k: "anexos", ico: "📎", lab: "Adjuntar los anexos del ZIP (administrativo / técnico / económico)" }, ...extra];
    const done = ingDe(t.codigo), hechos = items.filter((it) => done[it.k]).length;
    return `<div class="rb-mision" style="border-color:#7c4dff">
      <div class="rb-env"><b>🧾 Datos de ingreso al portal</b><span>${hechos}/${items.length}</span></div>
      <div class="rb-barra"><i style="width:${Math.round(hechos / items.length * 100)}%"></i></div>
      <div class="muted" style="font-size:.7rem;margin:2px 0 6px">Copia cada dato en «Ingresar nueva oferta» de Mercado Público y marca ✓ a medida que avanzas. La Clave Única y el envío final los haces tú.</div>
      ${items.map((it) => `<div class="rb-rep ${done[it.k] ? "pagado" : ""}"><span>${it.ico}</span><div style="min-width:0"><b>${esc(it.lab)}</b>${it.val ? `<small>${esc(it.val)}</small>` : ""}${it.nota ? `<small class="muted">📍 ${esc(it.nota)}</small>` : ""}${it.firma ? `<small style="color:#ffd88a">✍️ requiere firma</small>` : ""}</div>
        <div style="display:flex;gap:4px;align-items:center">${it.val && it.val !== "—" ? `<button class="btn small" type="button" data-rb="cp" data-v="${esc(it.val)}">📋</button>` : ""}<label class="rb-pagado"><input type="checkbox" data-rb-ing="${esc(it.k)}" data-c="${c}" ${done[it.k] ? "checked" : ""}> ✓</label></div></div>`).join("")}
      <div class="rb-row" style="margin-top:6px"><button class="btn small rb-firmar" type="button" data-rb="lic-ir" data-c="${c}">🌐 Abrir portal para ofertar</button>${t.zip ? `<button class="btn small" data-rb="lic-zip" data-c="${c}" type="button">⬇ Anexos (ZIP)</button>` : ""}</div></div>`;
  }
  function mesaLic(t) {
    const L = t.lic || {}, X = L.experto || {}, c = esc(t.codigo), cod = t.codigo;
    if ((t.lic_docs || []).some((d) => d.tipo === "render")) setTimeout(() => cargarImgsLic(t), 0);
    const V = X.veredicto || {}, Rg = X.riesgo || {}, G = X.garantias || {}, K = X.contrato || {}, Fe = X.fechas || {}, Oe = X.oferta_economica || {};
    const li = (arr, f) => (arr || []).length ? `<ul class="rb-ul">${arr.map(f).join("")}</ul>` : "";
    const sec = (tit, cuerpo, abierto) => cuerpo ? `<details class="rb-det" ${abierto ? "open" : ""}><summary>${tit}</summary>${cuerpo}</details>` : "";
    const renders = (t.lic_docs || []).filter((d) => d.tipo === "render");
    const pidiendo = t.lic_vision && (t.lic_vision.hechas || []).length < (t.lic_vision.vistas || []).length;
    const desc = Math.round((L.descuento || 0.17) * 1000) / 10;
    const pres = Number(L.presupuesto) || 0, cant = Number(L.cantidad) || 1;
    const vision = `<div class="rb-vision">${renders.length ? renders.map((d) => `<figure>${R.licImgs?.[d.id] && R.licImgs[d.id] !== "…" ? `<img src="${R.licImgs[d.id]}" alt="${esc(d.vista)}" data-rb="neg-doc" data-c="${c}" data-id="${esc(d.id)}">` : `<div class="rb-vision-ph"><span class="spinner"></span></div>`}<figcaption>${d.vista === "exterior" ? "Por fuera" : d.vista === "interior" ? "Por dentro" : esc(d.vista)}</figcaption></figure>`).join("") : ""}
      ${pidiendo ? `<div class="muted" style="font-size:.72rem">🎨 El robot está dibujando cómo quedará el proyecto…</div>` : `<button class="btn small" type="button" data-rb="lic-vision" data-c="${c}">🎨 ${renders.length ? "Volver a visualizar" : "Visualizar el proyecto terminado"}</button>`}</div>`;
    return `<div class="rb-ejcard rb-mesa">
      <div class="rb-env"><span class="rb-cp">📑 ${esc(X.tipo_licitacion || tipoPorMonto(pres))} · ${c}</span>${V.vamos != null ? `<b class="${V.vamos ? "rb-vivo-t" : "rb-neg-t"}">${V.vamos ? "💚 VAMOS" : "✖ NO CONVIENE"}${V.puntaje != null ? " · " + esc(V.puntaje) + "/100" : ""}</b>` : badge(t)}</div>
      <div class="rb-fnom" style="margin:6px 0 2px;font-size:1.02rem">${esc(L.producto || t.nombre || "Licitación")}</div>
      <div class="muted" style="font-size:.74rem">${esc(t.organismo || "")}${L.cierre ? " · cierra " + esc(L.cierre) : ""}</div>
      ${V.por_que ? `<div class="rb-resp nueva" style="margin-top:6px">${esc(V.por_que)}</div>` : ""}
      ${t.mensaje && !L.resumen ? `<div class="rb-msg">${esc(t.mensaje)}</div>` : ""}
      <div class="rb-comprar"><div class="rb-env"><b>🎯 LO QUE QUIERE EL CLIENTE</b><a class="btn small" href="https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(cod)}" target="_blank" rel="noopener">📄 Ficha</a></div>
        <div style="font-size:.82rem;margin-top:6px">${esc(X.lo_que_quiere_el_cliente || L.resumen || "⟳ El robot está leyendo las bases…")}</div>
        ${(L.items || []).map((i) => `<div class="rb-qc mini"><span class="n">${esc(i.cantidad ?? "")}<small>${esc(i.unidad || "")}</small></span><div><b>${esc(i.descripcion || "")}</b></div></div>`).join("")}
        ${L.lugar_entrega ? `<div class="muted" style="font-size:.7rem;margin-top:4px">📍 ${esc(L.lugar_entrega)}${L.plazo_entrega ? " · ⏱ " + esc(L.plazo_entrega) : ""}</div>` : ""}</div>
      ${vision}
      ${L.precio_unit != null ? `<div class="rb-mision rb-precio-lic" data-pres="${pres}" data-coniva="${L.con_iva ? 1 : 0}" data-cant="${cant}">
        <div class="rb-env"><b>💲 Juguemos con el precio</b><b><span data-v="desc">${desc}</span>% bajo el presupuesto</b></div>
        ${(() => { const RM = L.referencia_mercado || {}; const plazo = L.plazo_entrega || (X.evaluacion && X.evaluacion.plazo_recomendado) || ""; const sug = RM.oferta_sugerida ? clp(RM.oferta_sugerida) + "/u" : (L.precio_unit ? clp(L.precio_unit) + "/u" : "");
          return `<div class="rb-sug" style="border-color:#7c4dff;margin:4px 0 8px;font-size:.74rem"><b>🧭 Lo recomendado</b> <span class="muted">(ya analicé las bases y el mercado)</span>
            ${plazo ? `<div>🗓️ Plazo: <b>${esc(plazo)}</b> — cumplible, sin arriesgar multas.</div>` : ""}
            ${sug ? `<div>💲 Precio: <b>${sug}</b> — competitivo y con margen.</div>` : ""}
            <div>📎 Yo preparo: <b>Anexos 1-5 + Pacto de Integridad + render</b>, firmados y listos para subir.</div>
            <div class="muted" style="font-size:.66rem;margin-top:2px">Ajusta la barra si quieres y aprueba: el robot firma los anexos con tu firma.</div></div>`; })()}
        <input type="range" class="rb-rango" id="rbDesc-${c}" min="0" max="40" step="0.5" value="${desc}">
        <div class="rb-kv"><span>Unitario neto <b data-v="unit">${clp(L.precio_unit)}</b></span><span>Total c/IVA <b data-v="total">${clp(L.total)}</b></span></div>
        <div class="muted" style="font-size:.68rem">Presupuesto ${clp(pres)}${L.con_iva ? " con IVA" : " neto"} · cantidad ${esc(cant)} ${esc(L.unidad || "")}${(L.comparables || []).length ? " · compras anteriores: " + esc(L.comparables.slice(0, 2).join(" | ")) : ""}</div>
        ${X.evaluacion?.formula_precio ? `<div class="muted" style="font-size:.68rem">📐 Puntaje precio: ${esc(X.evaluacion.formula_precio)}</div>` : ""}
        ${(() => { const RM = L.referencia_mercado || {}; return (RM.precio_hoy || RM.oferta_sugerida) ? `<div class="rb-sug" style="border-color:#5ef0b0;margin-top:6px;font-size:.72rem">💡 <b>Precios a valor de hoy</b>${RM.precio_hoy ? `<br>Mercado hoy: <b>${clp(RM.precio_hoy)}</b>/u` : ""}${RM.piso_costo ? ` · piso costo: <b>${clp(RM.piso_costo)}</b>/u` : ""}${RM.oferta_sugerida ? `<br>🎯 Ofertar en torno a <b>${clp(RM.oferta_sugerida)}</b>/u` : ""}${RM.comentario ? `<div class="muted" style="font-size:.66rem;margin-top:2px">${esc(RM.comentario)}</div>` : ""}</div>` : ""; })()}
        ${t.estado === "lic_revisar" ? `<button class="btn rb-oro rb-big-btn" type="button" data-rb="lic-firmar" data-c="${c}">✅ Apruebo este precio · firmar anexos</button>` : ""}</div>` : ""}
      ${(L.alertas || []).length ? `<div class="rb-alertas"><b>⚠ Revisa antes de aprobar</b><ul style="margin:0;padding:0">${L.alertas.map((a) => `<li class="${a.nivel === "rojo" ? "rojo" : ""}">${a.nivel === "rojo" ? "⛔" : "⚠"} ${esc(a.texto)}</li>`).join("")}</ul></div>` : ""}
      ${sec("📋 Para no quedar fuera (admisibilidad)", li(X.habilidad, (h) => `<li>✔ ${esc(h)}</li>`) + li(X.admisibilidad, (a) => `<li><b>${esc(a.requisito || "")}</b>${a.documento ? " · " + esc(a.documento) : ""}${a.firma && !/no/i.test(a.firma) ? " · ✍️ firma" : ""}${a.seccion_portal ? " · " + esc(a.seccion_portal) : ""}${a.subsanable === false ? " <b class='rb-neg-t'>· no subsanable</b>" : ""}</li>`) + li(L.documentos, (d) => `<li>📎 ${esc(d.nombre)} · ${esc(d.estado)}</li>`), true)}
      ${sec("🛡 Garantías", G.seriedad || G.fiel_cumplimiento ? `<div style="font-size:.78rem">Seriedad: <b>${esc(G.seriedad || "—")}</b><br>Fiel cumplimiento: <b>${esc(G.fiel_cumplimiento || "—")}</b>${G.legal === false ? `<div class="rb-neg-t">⛔ ${esc(G.comentario || "Contradice el reglamento: pregúntalo en el foro")}</div>` : G.comentario ? `<div class="muted">${esc(G.comentario)}</div>` : ""}<div class="muted" style="font-size:.66rem">Puedes usar boleta, vale vista, póliza o certificado de fianza (IGR): las bases no pueden exigir uno solo.</div></div>` : "")}
      ${sec("💵 Cómo se ingresa el precio", Oe.neto_o_iva ? `<div style="font-size:.78rem">${esc(Oe.neto_o_iva)} · ${esc(Oe.unitario_o_total || "")}${Oe.lineas ? " · " + esc(Oe.lineas) : ""}${Oe.validez ? " · validez " + esc(Oe.validez) : ""}</div><div class="muted" style="font-size:.66rem">Un error en el precio no se puede corregir después: el robot cuadra el formulario con el anexo.</div>` : "")}
      ${sec("⚖️ Contrato y riesgos", (K.multas || Rg.nivel) ? `<div style="font-size:.78rem">${Rg.nivel ? `Riesgo <b class="${Rg.nivel === "alto" ? "rb-neg-t" : Rg.nivel === "medio" ? "" : "rb-vivo-t"}">${esc(Rg.nivel)}</b>` : ""}${li(Rg.razones, (r) => `<li>${esc(r)}</li>`)}
        ${K.multas ? `<div>Multas: ${esc(K.multas)}${K.tope_multas ? " · tope " + esc(K.tope_multas) : ""}</div>` : ""}${K.termino_anticipado ? `<div>Término anticipado: ${esc(K.termino_anticipado)}</div>` : ""}${K.subcontratacion ? `<div>Subcontratación: ${esc(K.subcontratacion)}</div>` : ""}${K.pago ? `<div>Pago: ${esc(K.pago)}</div>` : ""}${K.plazo_contrato ? `<div>Plazo: ${esc(K.plazo_contrato)}</div>` : ""}</div>` : "")}
      ${sec("🗓 Fechas clave", Object.values(Fe).some(Boolean) ? li(Object.entries(Fe).filter(([, v]) => v), ([k, v]) => `<li>${esc({ foro_preguntas: "Foro de preguntas", respuestas: "Respuestas", cierre: "Cierre", apertura: "Apertura", adjudicacion: "Adjudicación", visita_terreno: "Visita a terreno" }[k] || k)}: <b>${esc(v)}</b></li>`) : "")}
      ${sec("🗺 Mapa de ejecución (así lo haremos)", (X.plan || []).length ? `<div class="rb-plan">${X.plan.map((p, i) => `<div class="rb-plan-p"><span>${i + 1}</span><div><b>${esc(p.paso || "")}</b>${p.cuando ? ` <span class="muted">· ${esc(p.cuando)}</span>` : ""}<div class="muted" style="font-size:.7rem">${esc(p.detalle || "")}</div></div></div>`).join("")}</div>${X.proveedor_ideal ? `<div class="rb-proy">🤝 <b>Proveedor ideal:</b> ${esc(X.proveedor_ideal)}</div>` : ""}` : "")}
      ${sec("❓ Preguntas para el foro", (X.preguntas_foro || []).length ? li(X.preguntas_foro, (q) => `<li>${esc(q)}</li>`) + `<button class="btn small" type="button" data-rb="cp" data-v="${esc((X.preguntas_foro || []).join("\n\n"))}">Copiar preguntas</button>` : "")}
      ${t.estado === "lic_lista" ? cajaDatosIngreso(t) : ""}
      <div class="rb-row" style="margin-top:8px">${t.zip ? `<button class="btn small" data-rb="lic-zip" data-c="${c}" type="button">⬇ Anexos (ZIP)</button>` : ""}
        <button class="btn small" type="button" data-rb="lic-preguntar" data-c="${c}">💬 Pregúntale al robot por estas bases</button>
        ${t.estado === "lic_lista" ? `<button class="btn small rb-firmar" data-rb="lic-ingresar" data-c="${c}" type="button">🚀 Ingresar al portal</button>
          <button class="btn small" type="button" data-rb="lic-ir" data-c="${c}">🌐 Copiar código y abrir para ofertar</button>` : ""}
        ${["requiere", "error", "cancelada"].includes(t.estado) ? `<button class="btn small" data-rb="licitar" data-c="${c}" type="button">Reintentar</button>` : ""}</div>
      ${t.estado === "lic_captcha" ? tarjetaLic(t) : ""}</div>`;
  }
  function portalLicita() {
    if (!R.oport && !R._cargandoOport) setTimeout(cargarOport, 0);
    const lics = (R.data?.trabajos || []).filter((t) => t.tipo === "licitacion");
    const enP = ["en_cola", "tomado", "lic_bajando", "lic_captcha", "lic_analizando", "requiere", "error"];
    const prep = lics.filter((t) => enP.includes(t.estado)), mesa = lics.filter((t) => t.estado === "lic_revisar"),
      listas = lics.filter((t) => ["lic_lista", "lic_ingresando"].includes(t.estado)), ofer = lics.filter((t) => ["enviada", "confirmada"].includes(t.estado));
    const no = licNo(), ya = new Set(lics.map((t) => t.codigo));
    const match = (R.oport?.lista || []).filter((x) => x.fuente === "licitacion" && Date.parse(x.cierre) - Date.now() > 36 * 3600e3 && !no[x.codigo] && !ya.has(x.codigo) && !tomadaOtro(x.codigo))
      .sort((a, b) => (b.ganancia || 0) - (a.ganancia || 0));
    const tab = R.licTab || (mesa.length ? "mesa" : "match");
    const TABS = [["match", "💘 Match", match.length], ["prep", "🧩 Preparando", prep.length], ["mesa", "🎯 Mesa de juego", mesa.length], ["lista", "✅ Listas", listas.length], ["ofer", "📤 Ofertadas", ofer.length]];
    let cuerpo = "";
    if (tab === "match") cuerpo = match.length ? `<div class="muted" style="font-size:.72rem;text-align:center;margin:6px 0">Licitación <b>1 de ${match.length}</b> · ¿vamos o no vamos?</div>` + cartaMatch(match[0])
      : `<div class="empty">${R.oport ? "No hay licitaciones nuevas que calcen con tu rubro. El robot sigue buscando." : `<span class="spinner"></span>`}</div>`;
    else { const L = { prep, mesa, lista: listas, ofer }[tab] || [];
      cuerpo = L.length ? L.map((t) => tab === "prep" || tab === "ofer" ? tarjetaLic(t) : mesaLic(t)).join("") : `<div class="empty">${{ prep: "Nada preparándose. En 💘 Match elige una con «Vamos».", mesa: "Cuando el robot termine de leer las bases, aquí juegan tú y él: precio, garantías, plazos y cómo quedará el proyecto.", lista: "Aún no hay ofertas listas.", ofer: "Aún no hay ofertas ingresadas." }[tab]}</div>`; }
    const ingreso = `<details class="rb-licod-sec" style="margin-top:12px">
      <summary class="muted" style="font-size:.74rem;cursor:pointer;list-style:none">⚡ ¿Ya tienes el código a mano? Pégalo tú mismo</summary>
      <div class="rb-mision rb-licod" style="margin-top:8px">
        <div class="rb-row"><input class="rb-in" id="rbLicCod" placeholder="Ej: 2585-77-LE26" autocapitalize="characters" autocorrect="off" spellcheck="false" style="flex:1">
          <button class="btn rb-oro" type="button" data-rb="lic-codigo">🚀 Empezar</button></div>
        <div class="rb-row"><a class="btn small" href="https://www.mercadopublico.cl/Home/BusquedaLicitacion" target="_blank" rel="noopener">🔎 Buscar en Mercado Público</a>
          <button class="btn small" type="button" data-rb="lic-pegar">📋 Pegar código</button></div></div></details>`;
    return `${cajaFirma()}<div class="rb-etapas">${TABS.map(([k, n, q]) => `<button type="button" class="${tab === k ? "on" : ""}" data-rb="lic-tab" data-e="${k}">${n} ${q}</button>`).join("")}</div>${cuerpo}${ingreso}`;
  }

  /* ---------- licitaciones ---------- */
  function tarjetaLic(t) {
    const e = est(t.estado), L = t.lic || {}, c = esc(t.codigo);
    const anexN = (t.lic_docs || []).filter((d) => d.tipo === "anexo").length;
    const fichaUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(t.codigo)}`;
    const acts = [];
    if (t.estado === "en_cola" || t.estado === "tomado") acts.push(`<button class="btn small danger" data-rb="cancelar" data-c="${c}" type="button">Cancelar</button>`);
    if (t.zip) acts.push(`<button class="btn small" data-rb="lic-zip" data-c="${c}" type="button">⬇ Documentos</button>`);
    if (t.estado === "lic_lista") acts.unshift(`<button class="btn small rb-firmar" data-rb="lic-ingresar" data-c="${c}" type="button">🚀 Ingresar al portal</button>`);
    if (["requiere", "error", "cancelada"].includes(t.estado)) acts.push(`<button class="btn small" data-rb="licitar" data-c="${c}" type="button">Reintentar</button>`);
    acts.push(`<a class="btn small" href="${fichaUrl}" target="_blank" rel="noopener noreferrer">Ficha ↗</a>`);
    if (!e.activo) acts.push(`<button class="btn small" data-rb="olvidar" data-c="${c}" type="button">Quitar</button>`);
    const captcha = t.estado === "lic_captcha" && t.captcha ? `<div class="rb-alertas" style="border-color:#c8900f">
        <b>📋 Pega el código aquí</b> · el robot no avanza hasta que lo ingreses (Mercado Público lo pide para bajar los anexos)
        <img src="data:image/png;base64,${esc(t.captcha)}" alt="Código" style="display:block;margin:8px 0;max-width:100%;background:#fff;border-radius:6px">
        <div class="row" style="gap:6px"><input id="rbCap-${c}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="send" style="flex:1;min-width:120px;font-size:1.1rem;letter-spacing:.08em" placeholder="Pega el código aquí">
        <button class="btn small rb-firmar" data-rb="lic-captcha" data-c="${c}" type="button">Enviar</button></div></div>` : "";
    const codigoBox = ["requiere", "error", "cancelada", "lic_bajando", "en_cola", "tomado"].includes(t.estado) ? `<div class="rb-alertas" style="border-color:#7c4dff">
        <b>📥 Así preparamos esta licitación</b>
        <ol style="margin:6px 0 10px;padding-left:20px;font-size:.74rem;line-height:1.55">
          <li><b>Descarga los documentos</b>: entras como humano, escribes el código de imagen que pide Mercado Público y se te baja el ZIP con las bases y anexos.</li>
          <li><b>Me lo subes</b> acá abajo → yo lo absorbo, leo las bases, reconozco los criterios y la paso a la Mesa de juego.</li>
        </ol>
        <a class="btn rb-firmar" href="${fichaUrl}" target="_blank" rel="noopener noreferrer" style="display:block;text-align:center;margin-bottom:8px">⬇ Descargar documentos en Mercado Público</a>
        <button class="btn rb-oro" data-rb="lic-anexos" data-c="${c}" type="button" style="width:100%">📎 ${anexN ? `${anexN} documento${anexN > 1 ? "s" : ""} cargado${anexN > 1 ? "s" : ""} · agregar o reenviar` : "Subir documentos (ZIP)"}</button></div>` : "";
    const precio = L.precio_unit ? `<div class="rb-figs">
        <span>Precio <b>${clp(L.precio_unit)}</b> neto${L.unidad ? " / " + esc(L.unidad) : ""}</span>
        <span>Total <b>${clp(L.total)}</b> con IVA</span>
        ${L.presupuesto ? `<span>Presupuesto <b>${clp(L.presupuesto)}</b>${L.con_iva ? " c/IVA" : " neto"}</span>` : ""}
        <span>${Math.round((L.descuento || 0) * 100)}% bajo presupuesto</span>${L.cierre ? `<span>Cierra ${esc(L.cierre)}</span>` : ""}</div>` : "";
    const lista = (arr, f) => arr && arr.length ? `<ul style="margin:4px 0 0;padding-left:18px">${arr.map(f).join("")}</ul>` : "";
    const alertas = (L.alertas || []).length ? `<div class="rb-alertas"><b>Revisa antes de aprobar</b><ul style="margin:0;padding:0">${L.alertas.map((a) =>
      `<li class="${a.nivel === "rojo" ? "rojo" : ""}">${a.nivel === "rojo" ? "⛔" : "⚠"} ${esc(a.texto)}</li>`).join("")}</ul></div>` : "";
    const aprobar = t.estado === "lic_revisar" ? `<div class="rb-alertas" style="border-color:#7c4dff">
        <b>¿Te parece este precio?</b> Ajusta el descuento si quieres y aprueba: el robot firma los anexos y la deja lista para ofertar.
        <div class="row" style="gap:6px;margin-top:6px;align-items:center"><label class="muted" for="rbDesc-${c}">Descuento</label>
        <input id="rbDesc-${c}" type="number" min="0" max="60" step="0.5" value="${Math.round((L.descuento || 0.17) * 1000) / 10}" style="width:80px"> %
        <button class="btn small rb-firmar" data-rb="lic-firmar" data-c="${c}" type="button">✅ Aprobar y firmar</button></div></div>` : "";
    return `<div class="rb-card ${e.cls}" id="rb-${c}">
      <div class="rb-top"><span class="tag ag">${c}</span><span class="tag" style="background:#2a2350;color:#d9c9ff">📑 Licitación</span>${badge(t)}</div>
      <h3>${esc(L.producto || t.nombre || "Licitación")}</h3>
      ${t.organismo ? `<div class="muted">${esc(t.organismo)}</div>` : ""}
      ${precio}
      ${t.mensaje ? `<div class="rb-msg">${esc(t.mensaje)}</div>` : ""}
      ${captcha}${codigoBox}${aprobar}${alertas}
      ${L.resumen ? `<details class="rb-det" open><summary>Análisis de las bases</summary><div style="font-size:.85rem">${esc(L.resumen)}
        ${(L.criterios || []).length ? `<div style="margin-top:6px"><b>Criterios · cómo ganamos</b>${lista(L.criterios, (k) => `<li>${esc(k.nombre)}${k.peso ? " (" + esc(k.peso) + ")" : ""}: ${esc(k.propuesta)}${k.confirmar ? " <b style='color:#ffd88a'>· confirmar</b>" : ""}</li>`)}</div>` : ""}
        ${(L.comparables || []).length ? `<div style="margin-top:6px"><b>Compras anteriores</b>${lista(L.comparables, (k) => `<li>${esc(k)}</li>`)}</div>` : ""}
        ${(L.documentos || []).length ? `<div style="margin-top:6px"><b>Documentos</b>${lista(L.documentos, (d) => `<li>${esc(d.nombre)} · ${esc(d.estado)}${d.seccion ? " · " + esc(d.seccion) : ""}</li>`)}</div>` : ""}
      </div></details>` : ""}
      <div class="rb-acts">${acts.join("")}</div>
      <div class="rb-line" style="margin-top:8px">${esc(hace(t.actualizado))}</div>
    </div>`;
  }

  function tarjeta(t) {
    if (t.tipo === "licitacion") return tarjetaLic(t);
    const e = est(t.estado);
    const enviada = t.estado === "enviada" || t.estado === "confirmada";
    const portal = `https://compra-agil.mercadopublico.cl/resumen-cotizacion/${encodeURIComponent(t.codigo)}`;
    const acts = [];
    if (t.estado === "en_cola" || t.estado === "tomado") acts.push(`<button class="btn small danger" data-rb="cancelar" data-c="${esc(t.codigo)}" type="button">Cancelar</button>`);
    const firmable = t.estado === "firmar" && t.firma?.precios?.length;
    if (firmable) {
      acts.push(`<button class="btn small rb-firmar" data-rb="ir-firmar" data-c="${esc(t.codigo)}" type="button">✍ Ir a firmar</button>`);
      acts.push(`<button class="btn small" data-rb="verificar" data-c="${esc(t.codigo)}" type="button">Ya la firmé</button>`);
      acts.push(`<button class="btn small" data-rb="ofertar" data-c="${esc(t.codigo)}" type="button">↻ Rehacer oferta</button>`);
    }
    if (t.estado === "confirmada") acts.push(`<button class="btn small" data-rb="editar" data-c="${esc(t.codigo)}" type="button" style="border-color:#c8900f;color:#ffd88a">Editar oferta</button>`);
    if (enviada && !t.op?.oc_codigo) acts.push(`<button class="btn small" data-rb="reabrir" data-c="${esc(t.codigo)}" type="button" title="Si en realidad no se envió, vuelve a Firmar con la misma oferta">↩ No se envió · volver a Firmar</button>`);
    if (t.estado === "probada") acts.push(`<button class="btn small rb-go" data-rb="ofertar" data-c="${esc(t.codigo)}" type="button">Preparar para firmar</button>`);
    if (["requiere", "error", "cancelada"].includes(t.estado)) acts.push(`<button class="btn small" data-rb="ofertar" data-c="${esc(t.codigo)}" type="button">Reintentar</button>`);
    if (t.estado === "lista") acts.unshift(`<a class="btn small rb-remoto" href="${esc(leer().remoto || REMOTO_DEF)}" target="_blank" rel="noopener noreferrer">Dar el clic desde aquí ↗</a>`);
    if (t.pdf) acts.push(`<button class="btn small" data-rb="pdf" data-c="${esc(t.codigo)}" type="button">Ver PDF</button>`);
    acts.push(`<a class="btn small" href="${portal}" target="_blank" rel="noopener noreferrer">Mercado Público ↗</a>`);
    if (!e.activo) acts.push(`<button class="btn small" data-rb="olvidar" data-c="${esc(t.codigo)}" type="button" aria-label="Quitar de la lista">Quitar</button>`);
    const msg = t.estado === "lista"
      ? "Todo cargado en el robot. Presiona «Enviar cotización», marca la declaración y «Aceptar y enviar» (en el PC o desde aquí con escritorio remoto). El robot confirma solo."
      : firmable ? (t.firma.aviso || null) : t.mensaje;
    const al = firmable ? (t.firma.alertas || []) : [];
    const avisoIA = firmable && al.some((a) => /sin saldo|insufficient|exceeded your current quota|429|valor promedio/i.test(a.texto || "")) ? `<div class="rb-alertas" style="border-left-color:var(--warn)"><b>⚠️ Precios de relleno (faltó saldo de IA)</b>Esta oferta se preparó sin poder buscar precios reales por ítem. Si ya recargaste OpenAI, toca «↻ Rehacer oferta» para precios verdaderos.</div>` : "";
    const declJurada = firmable ? `<details class="rb-det" style="margin-top:8px"><summary>📜 La declaración jurada que vas a aceptar (léela)</summary><div class="muted" style="font-size:.76rem;line-height:1.5;margin-top:4px">Declaro que toda la información ingresada en este formulario es veraz, completa, verificable y se encuentra actualizada. Debe tenerse presente que faltar a la verdad respecto de lo informado en una declaración jurada puede traducirse en la comisión del delito de perjurio, en virtud del artículo 210 del Código Penal, que dispone que «el que ante la autoridad o sus agentes perjurare o diere falso testimonio en materia que no sea contenciosa, sufrirá las penas de presidio menor en sus grados mínimo a medio y multa de seis a diez unidades tributarias mensuales.»<br><br><b>Tú firmas, no el robot.</b> Por ley, el envío y esta declaración los autorizas tú en Mercado Público.</div></details>` : "";
    const alertasHtml = al.length ? `<div class="rb-alertas"><b>Revisa antes de firmar</b><ul style="margin:0;padding:0">${al.map((a) =>
      `<li class="${a.nivel === "rojo" ? "rojo" : ""}">${a.nivel === "rojo" ? "⛔" : "⚠"} ${esc(a.texto)}</li>`).join("")}</ul></div>` : "";
    const pasos = firmable && firmaRapida() ? `<ol class="rb-pasos">
        <li><b>Ir a firmar</b> abre la compra: <b>Firma rápida</b> te muestra tu <b>billetera</b> ahí mismo (toca Copiar y pega cada valor tú).</li>
        <li>Adjunta el PDF, presiona <b>Enviar cotización</b>, marca la <b>declaración</b> y <b>firma</b>. El robot lo confirma solo.</li></ol>` : firmable ? `<div class="rb-msg" style="color:#d9c9ff">Más rápido: instala <b>Firma rápida</b> (Robot → Ajustes) y «Ir a firmar» te deja el formulario listo con el PDF.</div><ol class="rb-pasos">
        <li><b>Ir a firmar</b> abre la compra en Mercado Público.</li>
        <li>Ahí toca tu marcador <b>Rellenar</b> (en el celular: escribe «Rellenar» en la barra de direcciones y toca el marcador). Se llenan solos el precio, el detalle y el <b>PDF</b>.</li>
        <li>Tú: <b>Enviar cotización</b> → <b>declaración</b> → <b>firmar</b>. Vuelve y toca <b>Ya la firmé</b>.</li></ol>
      <details class="rb-det" style="margin-top:6px"><summary>Marcador «Rellenar» (opcional — llena solo, pero Mercado Público puede marcarlo como inusual)</summary><button type="button" class="btn small" data-rb="copiar-marcador" style="margin-top:6px">Copiar marcador Rellenar</button></details>` : "";
    // 💳 BILLETERA: los datos de la compra listos para que TÚ copies y pegues en Mercado Público (tu dedo = humano, no lo marca)
    const billetera = firmable ? `<div class="rb-env rb-sec" style="margin-top:10px">💳 Billetera · copia y pega en Mercado Público</div>
      <div class="muted" style="font-size:.72rem;margin:2px 0 6px">Toca «Copiar», anda al campo en MP y <b>pega con tu dedo</b>. Lo pegas tú, como persona — así no te marca.</div>
      <table class="rb-copias">
        ${t.firma.precios.map((v, k) => `<tr><td>Ítem ${k + 1}${t.items?.[k]?.d && t.items.length === t.firma.precios.length ? " · " + esc(t.items[k].d.slice(0, 32)) : ""}</td><td class="n"><b>${clp(v)}</b></td><td><button type="button" class="rb-cp btn small rb-oro" data-rb="cp" data-v="${v}">📋 Copiar</button></td></tr>`).join("")}
        <tr><td>Despacho</td><td class="n"><b>${clp(t.firma.despacho || 0)}</b></td><td><button type="button" class="rb-cp btn small rb-oro" data-rb="cp" data-v="${t.firma.despacho || 0}">📋 Copiar</button></td></tr>
        <tr><td>Detalle</td><td class="n muted">${(t.firma.detalle || "").length} car.</td><td><button type="button" class="rb-cp btn small rb-oro" data-rb="cp" data-v="${esc(t.firma.detalle || "")}">📋 Copiar</button></td></tr>
        <tr><td><b>Total</b></td><td class="n"><b>${clp(t.firma.total)}</b></td><td></td></tr></table>` : "";
    return `<div class="rb-card ${e.cls}" id="rb-${esc(t.codigo)}">
      <div class="rb-top"><span class="tag ag">${esc(t.codigo)}</span>${badge(t)}</div>
      <h3>${esc(t.nombre || "Compra Ágil")}</h3>
      ${t.organismo ? `<div class="muted">${esc(t.organismo)}</div>` : ""}
      <div class="rb-figs">
        ${t.total ? `<span>Oferta <b>${clp(t.total)}</b></span>` : ""}
        ${t.monto ? `<span>Presupuesto <b>${clp(t.monto)}</b></span>` : ""}
        ${t.plazo ? `<span>Plazo <b>${esc(t.plazo)}</b></span>` : ""}
        <span>${t.accion === "editar" ? "Edición" : t.accion === "probar" ? "Prueba" : "Oferta"} · ${Math.round((t.descuento || 0) * 100)}% bajo presupuesto</span>
        ${enviada && t.fecha_envio ? `<span>Enviada ${esc(t.fecha_envio)}</span>` : ""}
      </div>
      ${msg ? `<div class="rb-msg">${esc(msg)}</div>` : ""}
      ${avisoIA}
      ${alertasHtml}
      ${billetera}${pasos}${declJurada}
      ${t.detalle || (t.items && t.items.length) ? `<details class="rb-det"><summary>Detalle de la oferta</summary><pre>${esc(
        (t.items || []).map((i, k) => `${k + 1}. ${i.d} — ${i.q} x ${clp(i.p)}`).join("\n") + (t.detalle ? "\n\n" + t.detalle : ""))}</pre>${(t.items || []).some((i) => i.p) ? `<div class="rb-row"><button class="btn small rb-oro" type="button" data-rb="desglose-mail" data-c="${esc(t.codigo)}">✉ Responder desglose al comprador</button><button class="btn small" type="button" data-rb="desglose-copiar" data-c="${esc(t.codigo)}">📋 Copiar desglose</button></div>` : ""}</details>` : ""}
      <div class="rb-acts">${acts.join("")}</div>
      <div class="rb-line" style="margin-top:8px">${esc(hace(t.actualizado))}</div>
    </div>`;
  }

  function pantallaEnlace() {
    return `
      <div class="rb-sheet-head"><h2 style="margin:0">Conecta tu robot</h2><button class="rb-x" type="button" data-rb="cerrar" aria-label="Cerrar">✕</button></div>
      <p class="lead" style="margin:8px 0 14px">El robot trabaja en tu PC con tu sesión de Mercado Público. Desde aquí le pides ofertas y ves cómo avanzan.</p>
      ${esIOS && instalada() ? `<div class="card" style="border-color:rgba(245,207,107,.6)">
        <h3>📲 App del inicio del iPhone</h3>
        <div class="muted">El iPhone guarda esta app <b>separada de Safari</b>, por eso aquí no está tu enlace. Es una sola vez:</div>
        <ol class="rb-pasos"><li>Abre <b>cotizagil.netlify.app</b> en <b>Safari</b> → Robot → Ajustes → <b>«Copiar enlace para la app del inicio»</b>.</li>
          <li>Vuelve aquí y toca:</li></ol>
        <button class="btn rb-oro" type="button" data-rb="pegar-enlace" style="width:100%;margin-top:8px;padding:14px">📋 Pegar enlace y entrar</button>
      </div>` : ""}
      <div class="card">
        <h3>1 · En el PC</h3>
        <div class="muted">Abre el panel del robot y entra a <strong>Celular</strong>. Escanea el código QR con la cámara de este teléfono.</div>
        <h3 style="margin-top:14px">2 · O escribe el código de enlace</h3>
        <div class="row" style="flex-wrap:nowrap;margin-top:6px">
          <div class="field" style="flex:1"><input id="rbTok" placeholder="Código de enlace" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
          <button class="btn primary small" type="button" data-rb="enlazar">Enlazar</button>
        </div>
        ${R.err ? `<div class="note" style="border-left-color:var(--red)">${esc(R.err)}</div>` : ""}
      </div>
      <p class="note">El código queda guardado solo en este teléfono. El envío final y la declaración jurada siempre los haces tú en Mercado Público.</p>`;
  }

  function pantallaConfirmar(c) {
    const t = trabajo(c.codigo);
    const d = c.descuento;
    const oferta = c.monto ? Math.round(c.monto * (1 - d)) : null;
    const editar = c.editar || c.accion === "editar";
    return `
      <div class="rb-sheet-head"><h2 style="margin:0">${editar ? "Editar oferta" : "Hacer oferta"}</h2><button class="rb-x" type="button" data-rb="volver" aria-label="Volver">✕</button></div>
      <div class="rb-conf" style="margin-top:12px">
        <div class="rb-line"><span>${esc(c.codigo)}</span>${c.organismo ? `<span>· ${esc(c.organismo.slice(0, 50))}</span>` : ""}</div>
        <h3 style="margin:8px 0 10px">${esc(c.nombre || "Compra Ágil")}</h3>
        <div class="muted">Precio: presupuesto menos</div>
        <div class="rb-desc">${[0.05, 0.08, 0.09, 0.10, 0.12].map((x) =>
          `<button type="button" class="chip ${Math.abs(x - d) < 1e-6 ? "on" : ""}" data-rb="desc" data-d="${x}">${Math.round(x * 100)}%</button>`).join("")}</div>
        ${oferta ? `<div style="margin-top:10px"><div class="muted">Oferta aproximada</div><div class="rb-big">${clp(oferta)}</div><div class="muted">Presupuesto ${clp(c.monto)} · el robot calcula el valor exacto con la ficha (IVA incluido o no) y se ajusta al número del portal</div></div>` : `<div class="muted" style="margin-top:8px">El robot lee el presupuesto en la ficha y aplica el descuento.</div>`}
      </div>
      <div class="card" style="margin-top:10px">
        <div class="muted">El robot del PC lee la ficha y los adjuntos, calcula el precio y arma cotización, ficha técnica y PDF. La oferta queda <b>lista para firmar</b> aquí.</div>
        <div class="muted" style="margin-top:8px"><strong style="color:#d9c9ff">Tú la envías y firmas</strong> desde tu navegador normal con el botón <b>Rellenar</b>: así Mercado Público no ve un navegador automatizado. Te avisamos cuando esté lista.</div>
      </div>
      ${!R.data?.robot?.conectado ? `<div class="note" style="border-left-color:var(--warn)">El robot está apagado. El pedido queda en cola y parte apenas vuelva.</div>` : ""}
      ${t && est(t.estado).activo ? `<div class="note" style="border-left-color:var(--warn)">Esta compra ya está en manos del robot (${esc(est(t.estado).txt)}).</div>` : ""}
      <div class="row" style="margin-top:14px">
        <button class="btn" type="button" data-rb="volver">Volver</button>
        <button class="btn rb-firmar" type="button" data-rb="confirmar" style="flex:1" ${t && est(t.estado).activo ? "disabled" : ""}>✍ ${editar ? "Preparar edición para firmar" : "Preparar para firmar"}</button>
      </div>
      <details class="rb-det" style="margin-top:12px"><summary>Modo antiguo (ventana del robot)</summary>
        <button class="btn small" type="button" data-rb="antiguo" style="margin-top:8px;width:100%" ${t && est(t.estado).activo ? "disabled" : ""}>Cargar en la ventana del robot del PC</button></details>`;
  }

  const enviadaEst = (e) => e === "enviada" || e === "confirmada";
  const esHoy = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();
  function kpis(lista) {
    const curso = lista.filter((t) => ["en_cola", "tomado", "preparando"].includes(t.estado)).length;
    const clic = lista.filter((t) => t.estado === "lista" || t.estado === "firmar").length;
    const env = lista.filter((t) => enviadaEst(t.estado));
    const hoy = env.filter((t) => esHoy(t.actualizado)).length;
    const monto = env.reduce((s, t) => s + (Number(t.total) || 0), 0);
    const corto = (n) => n >= 1e6 ? "$" + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + "M" : clp(n);
    return `<div class="rb-kpis">
      <div class="rb-kpi"><b>${curso}</b><span>En curso</span></div>
      <div class="rb-kpi ${clic ? "violeta" : ""}"><b>${clic}</b><span>Para firmar</span></div>
      <div class="rb-kpi"><b>${hoy}</b><span>Enviadas hoy</span></div>
      <div class="rb-kpi"><b>${corto(monto)}</b><span>Ofertado (${env.length})</span></div>
    </div>`;
  }
  // ✍ Firmar: tarjeta simple, una acción grande
  function tarjetaFirma(t, nueva) {
    const e = est(t.estado), firmable = t.estado === "firmar" && t.firma?.precios?.length;
    const rojas = (firmable && t.firma.alertas || []).filter((a) => a.nivel === "rojo").length;
    const accion = firmable ? `<button class="btn rb-oro rb-big-btn" data-rb="ir-firmar" data-c="${esc(t.codigo)}" type="button">✍ Ir a firmar ${clp(t.total)}</button>
        <div class="rb-row" style="justify-content:center"><button class="btn small" data-rb="verificar" data-c="${esc(t.codigo)}" type="button">Ya la firmé</button><button class="btn small" data-rb="det" data-c="${esc(t.codigo)}" type="button">Ver detalle</button></div>`
      : ["requiere", "error"].includes(t.estado) ? `<div class="rb-row"><button class="btn small rb-oro" data-rb="ofertar" data-c="${esc(t.codigo)}" type="button">Reintentar</button><button class="btn small" data-rb="det" data-c="${esc(t.codigo)}" type="button">Ver qué pasó</button></div>`
      : `<div class="rb-prog2"><i style="width:${{ en_cola: 15, tomado: 30, preparando: 60, lista: 90 }[t.estado] || 45}%"></i></div><div class="muted" style="font-size:.72rem">${esc(t.mensaje || e.txt)}</div>`;
    return `<div class="rb-card rb-firma rb-swipe ${nueva ? "nueva" : ""}" data-modo="fir" data-c="${esc(t.codigo)}" id="rb-${esc(t.codigo)}">
      <span class="rb-sello si">FIRMAR</span><span class="rb-sello no">QUITAR</span>
      <div class="rb-env"><span style="font-size:.72rem"><b>${esc(t.codigo)}</b>${nueva ? ' <span class="rb-pill oro">🆕 la más nueva lista</span>' : ""}</span>${badge(t)}</div>
      <div class="rb-fnom">${esc(t.nombre || "Compra Ágil")}</div>
      <div class="muted" style="font-size:.72rem">${esc(t.organismo || "")}${t.monto ? " · Ppto. " + clp(t.monto) : ""}${rojas ? ` · <b style="color:#ff8a80">⛔ ${rojas} alerta${rojas > 1 ? "s" : ""}</b>` : ""}</div>
      ${accion}
      <div class="rb-row" style="justify-content:center"><button class="btn small" type="button" data-rb="fir-quitar" data-c="${esc(t.codigo)}" style="opacity:.75">🗑 Quitar</button></div></div>`;
  }
  function caja(t) {
    const e = est(t.estado);
    const rojas = (t.estado === "firmar" && t.firma?.alertas || []).filter((a) => a.nivel === "rojo").length;
    return `<button type="button" class="rb-caja ${e.cls}" data-rb="det" data-c="${esc(t.codigo)}">${rojas ? `<span class="rb-ojo">⛔ ${rojas}</span>` : ""}
      <span class="rb-cod">${esc(t.codigo)}</span>
      <span class="rb-nom">${esc(t.nombre || "Compra Ágil")}</span>
      <span class="rb-tot">${t.total ? clp(t.total) : t.monto ? `<span class="muted" style="font-size:.72rem">Ppto.</span> ${clp(t.monto)}` : "—"}</span>
      ${badge(t)}
    </button>`;
  }
  function vistaLista(lista) {
    const atn = lista.filter((t) => ["lista", "firmar", "requiere", "lic_captcha", "lic_revisar", "lic_lista"].includes(t.estado));
    const enCurso = lista.filter((t) => est(t.estado).activo && !atn.includes(t));
    const resto = lista.filter((t) => !atn.includes(t) && !enCurso.includes(t));
    return `${atn.length ? `<div class="label">Necesitan tu acción</div>${atn.map(tarjeta).join("")}` : ""}
      ${enCurso.length ? `<div class="label">En curso</div>${enCurso.map(tarjeta).join("")}` : ""}
      ${resto.length ? `<div class="label">Ofertas</div>${resto.map(tarjeta).join("")}` : ""}`;
  }
  function vistaCajas(lista) {
    const orden = (t) => ["lista", "firmar", "lic_captcha", "lic_revisar", "lic_lista"].includes(t.estado) ? 0 : t.estado === "requiere" || t.estado === "error" ? 1 : est(t.estado).activo ? 2 : 3;
    return `<div class="rb-cajas">${[...lista].sort((a, b) => orden(a) - orden(b)).map(caja).join("")}</div>`;
  }
  /* ---------- oportunidades: Por preparar · Por firmar · Hechas · No deseadas (desliza tipo Tinder) ---------- */
  const EN_FIRMA = ["en_cola", "tomado", "preparando", "lista", "firmar", "probada", "requiere", "error",
    "lic_bajando", "lic_captcha", "lic_analizando", "lic_revisar", "lic_lista", "lic_ingresando"];
  const HECHA = ["enviada", "confirmada"];
  // ✅ ya firmada: Mercado Público dijo «enviada correctamente» (aviso de Firma rápida o de otro celular). No vuelve a Firmar
  //    aunque el robot del PC todavía la esté confirmando; pasa directo a Enviadas.
  const FIRMADAS = "sdc:firmadas";
  const leerFirmadas = () => { try { const o = JSON.parse(localStorage.getItem(FIRMADAS)) || {}; for (const k in o) if (Date.now() - o[k] > 12 * 3600e3) delete o[k]; return o; } catch { return {}; } };
  // ⛔ no se puede firmar: la compra cerró (fecha de cierre pasada) o MP dijo cerrada / fuera de plazo: sale sola de Firmar
  const noFirmable = (t) => !!t && ((t.cierre && Date.parse(t.cierre) && Date.parse(t.cierre) < Date.now()) || /\bCERRADA\b/.test(t.mensaje || "") || /(compra|cotizaci[oó]n|convocatoria)[^.]{0,30}cerrad|ya no (recibe|acepta) (cotizaciones|ofertas)|fuera de plazo|no es posible (ingresar|enviar)/i.test(t.mensaje || ""));
  const yaFirmada = (t) => { if (!t || HECHA.includes(t.estado)) return false;
    const c = Date.parse(t.creado || 0) || 0, act = Date.parse(t.actualizado || 0) || c, l = leerFirmadas()[t.codigo], v = Date.parse(t.enviada_vista || 0) || 0;
    if (t.accion === "verificar" && ["en_cola", "tomado", "preparando"].includes(t.estado)) return true;   // el robot está confirmando el envío
    return (l && l >= act) || (v && v >= c); };   // si el robot la volvió a dejar lista (actualizó) DESPUÉS de firmar, reaparece
  function marcarFirmada(cod, avisar) {
    cod = String(cod || "").toUpperCase(); if (!cod) return;
    const o = leerFirmadas(); const nueva = !o[cod]; o[cod] = Date.now(); try { localStorage.setItem(FIRMADAS, JSON.stringify(o)); } catch {}
    if (R.token && nueva) api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "verificar", vista: true, dispositivo: dispositivo(false) }) }).catch(() => {});
    try { ABIERTAS[cod]?.w?.close(); } catch {}          // la pestaña de Mercado Público que abrió la app se cierra sola
    delete ABIERTAS[cod];
    R.oportTab = "firmar"; R.firIdx = 0;
    if (avisar && nueva) toast("✅ " + cod + " firmada · ya no está en Firmar. ¡Va la próxima!");
    if ($("#rbSheet")?.classList.contains("on")) pintarHoja(true);
  }
  window.addEventListener("cotizagil-firmada", (e) => marcarFirmada(e.detail, true));     // aviso de Firma rápida (pestaña de Mercado Público)
  /* ---------- ⭐ Seleccionadas (compartidas entre tus celulares, guardadas en la nube) ---------- */
  const SELK = "sdc:sel-juego";
  const leerSel = () => R.sel || (() => { try { return JSON.parse(localStorage.getItem(SELK)) || {}; } catch { return {}; } })();
  const guardarSel = (o) => { R.sel = o; try { localStorage.setItem(SELK, JSON.stringify(o)); } catch {} };
  const esSel = (cod) => !!leerSel()[cod];
  async function cargarSel() {
    try { const r = await api("seleccionadas"); guardarSel(r.sel || {}); } catch {}
    cargarMercado();
  }
  // 💹 costo de mercado real (lo busca el PC con IA para cada seleccionada)
  async function cargarMercado() {
    if (R._cargMk || (R.mercadoT && Date.now() - R.mercadoT < 60_000)) return; R._cargMk = true;
    try { R.mercado = (await api("mercado")).mercado || {}; R.mercadoT = Date.now(); pintarHoja(); } catch {} R._cargMk = false;
  }
  // 🧠 inteligencia de competencia: con qué % del presupuesto ganan los que ganan (de nuestras propias compras ya decididas)
  function intel() {
    const ts = R.data?.trabajos || [], v = [];
    for (const t of ts) { const g = segDe(t.codigo); if (g?.ganador_total && g.presupuesto) v.push({ r: g.ganador_total / g.presupuesto, seg: /^segundo/i.test(g.llamado || "") }); }
    const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    return { n: v.length, med: med(v.map((x) => x.r)), medSeg: med(v.filter((x) => x.seg).map((x) => x.r)), medPri: med(v.filter((x) => !x.seg).map((x) => x.r)), todos: v.map((x) => x.r) };
  }
  // 📒 Libro del juego (el ERP que nace): vendido, comprado, facturado, utilidad, por mes; y tu nivel de jugador
  const NIVELES = [[0, "🥉 Bronce"], [2e6, "🥈 Plata"], [10e6, "🥇 Oro"], [30e6, "💎 Diamante"], [100e6, "👑 Leyenda"]];
  // 🏆 Éxitos: la vitrina de casos de éxito. Se llena sola cada vez que ganas una Compra Ágil o licitación.
  function exitosBox(gan, montoG, utilG) {
    const n = gan.length;
    const cab = `<div class="rb-sec" style="margin-top:14px">🏆 Éxitos</div>`;
    if (!n) {
      return cab + `<div class="rb-op" style="text-align:center;padding:16px 12px">
        <div style="font-size:2rem">🌱</div><b>Aún no hay casos de éxito… todavía.</b>
        <div class="muted" style="font-size:.78rem;margin-top:4px">Cuando ganes tu primera Compra Ágil o licitación, aparece aquí sola, con su monto y su utilidad. Esta va a ser tu vitrina para mostrarle al mundo lo que logras.</div></div>`;
    }
    const corto2 = (x) => x >= 1e6 ? "$" + (x / 1e6).toFixed(x >= 1e7 ? 0 : 1).replace(".", ",") + "M" : clp(x);
    const breve = (s) => String(s || "").slice(0, 60);
    const cards = gan.slice(0, 50).map((t) => {
      const op = t.op || {}, inf = op.informe || {};
      const utilOK = inf && !inf.incompleto && inf.final != null;
      const util = utilOK ? Number(inf.final) : Math.round((Number(t.total) || 0) * 0.13);
      const f = (op.historial || []).find((h) => h.etapa === "ganada")?.t || t.actualizado || "";
      const cerr = op.etapa === "cerrado";
      return `<div class="rb-prov-oro" style="margin:6px 0">
        <div class="row" style="justify-content:space-between;align-items:baseline"><b>${esc(t.codigo)}</b><span class="rb-pill verde">${cerr ? "🥇 Cerrado en oro" : "🏆 Ganada"}</span></div>
        <div style="font-size:.8rem">${esc(breve(t.nombre))}</div>
        <div class="muted" style="font-size:.72rem">${esc(breve(t.organismo))}${f ? " · " + esc(new Date(f).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "2-digit" })) : ""}</div>
        <div class="row" style="justify-content:space-between;margin-top:4px"><span>💰 Venta <b>${clp(Number(t.total) || 0)}</b></span><span>📈 Utilidad <b class="rb-oro-t">${clp(util)}</b></span></div>
      </div>`;
    }).join("");
    return cab + `<div style="display:flex;gap:8px;margin:6px 0">
        <div class="rb-m oro" style="flex:1"><span>🏆 Casos</span><b>${n}</b></div>
        <div class="rb-m verde" style="flex:1"><span>💰 Ganado</span><b>${corto2(montoG)}</b></div>
        <div class="rb-m azul" style="flex:1"><span>📈 Utilidad</span><b>${corto2(utilG)}</b></div>
      </div>${cards}`;
  }
  function libroJuego(gan, env) {
    const vivas = gan.filter((t) => t.op?.etapa !== "rechazada");
    const fila = (t) => { const op = t.op || {}, inf = op.informe || {};
      const compra = Number(op.precio_acordado) || Number(inf.compras) || 0, util = inf.final != null && !inf.incompleto ? Number(inf.final) : null;
      const fact = !!(op.folio_factura || (op.docs || []).some((d) => d.tipo === "factura"));
      const f = (op.historial || [])[0]?.t || t.actualizado || "";
      return { mes: f.slice(0, 7), venta: Number(t.total) || 0, compra, util, fact, cerr: op.etapa === "cerrado", dej: segDe(t.codigo)?.dejado || 0 }; };
    const F = vivas.map(fila), sum = (k, L = F) => L.reduce((a, x) => a + (Number(x[k]) || 0), 0);
    const vend = sum("venta"), comp = sum("compra"), util = F.reduce((a, x) => a + (x.util ?? 0), 0), fact = sum("venta", F.filter((x) => x.fact)), dej = sum("dej");
    const meses = [...new Set(F.map((x) => x.mes).filter(Boolean))].sort().reverse().slice(0, 6);
    const nv = [...NIVELES].reverse().find(([m]) => vend >= m) || NIVELES[0], sig = NIVELES[NIVELES.indexOf(nv) + 1];
    const prog = sig ? Math.min(100, Math.round((vend - nv[0]) / (sig[0] - nv[0]) * 100)) : 100;
    const mesN = (m) => { const [a, b] = m.split("-"); return ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][+b - 1] + " " + a.slice(2); };
    return `<details class="rb-libro" ${R.libroAbierto ? "open" : ""} data-libro><summary><span>📒 Libro del juego</span><b>${nv[1]}</b></summary>
      <div class="rb-nivel"><div class="rb-env"><span>${nv[1]}${sig ? ` → ${sig[1]}` : ""}</span><span>${sig ? `faltan <b>${clp(sig[0] - vend)}</b> en ventas` : "nivel máximo"}</span></div><div class="rb-prob"><i style="width:${prog}%"></i></div></div>
      <div class="rb-mini"><div><small>Vendido (adjudicado)</small><b>${clp(vend)}</b></div><div><small>Comprado a proveedores</small><b>${clp(comp)}</b></div>
        <div><small>Facturado</small><b>${clp(fact)}</b></div><div><small>Utilidad confirmada</small><b style="color:${util < 0 ? "#ff8a80" : "#7ee2a0"}">${clp(util)}</b></div></div>
      ${dej ? `<div class="muted" style="font-size:.72rem;margin-top:6px">💸 Dejado en la mesa (pudimos cobrar más y ganar igual): <b style="color:#ffd88a">${clp(dej)}</b>. El motor ya sube la apuesta cuando hay pocos rivales.</div>` : ""}
      ${meses.length ? `<table class="rb-copias" style="margin-top:8px"><tr><td><b>Mes</b></td><td class="n"><b>Vendido</b></td><td class="n"><b>Utilidad</b></td></tr>${meses.map((m) => { const L = F.filter((x) => x.mes === m);
        return `<tr><td>${mesN(m)}</td><td class="n">${clp(sum("venta", L))}</td><td class="n">${clp(L.reduce((a, x) => a + (x.util ?? 0), 0))}</td></tr>`; }).join("")}</table>` : ""}
      <div class="muted" style="font-size:.68rem;margin-top:6px">${env.length} ofertas enviadas · ${vivas.length} negocios · ${F.filter((x) => x.cerr).length} cerrados en oro. Próximo: conexión con facturador SII, banco y factoring.</div></details>`;
  }
  // costo de la IA que no cuadra (menos de 1/4 del presupuesto: casi siempre leyó el precio de UNA unidad, sin la cantidad)
  const mkDudoso = (mk, pres) => !!(mk && pres && (mk.total_con_iva || 0) < pres * 0.25);
  const MIN_PRES = 250000;                                       // bajo esto el despacho y los gastos fijos se comen la utilidad
  const MARGEN_MIN = 0.12;                                       // utilidad mínima sobre la venta neta para que «dé»
  const fijosDe = (pres) => (pres < 150000 ? 12000 : pres < 1000000 ? 20000 : 35000);   // despacho y gastos que no dependen del precio
  const pisoDe = (costoNeto, pres) => costoNeto ? Math.ceil((costoNeto + fijosDe(pres)) / (1 - MARGEN_MIN) * 1.19 / 10) * 10 : 0;
  function datosOport(cod) {
    const x = (R.oport?.lista || []).find((y) => y.codigo === cod) || trabajo(cod) || {};
    return { codigo: cod, nombre: x.nombre, organismo: x.organismo, monto: x.monto, cierre: x.cierre, margen: x.margen };
  }
  async function ponerSel(cod, extra) {
    const s = { ...leerSel() }; s[cod] = { ...(s[cod] || { desde: new Date().toISOString() }), ...datosOport(cod), ...(extra || {}) };
    guardarSel(s);
    try { const r = await api("seleccionar", { method: "POST", body: JSON.stringify({ ...datosOport(cod), ...(extra || {}) }) }); if (r.sel) guardarSel(r.sel); } catch (e) { toast(e.message); }
  }
  async function quitarSel(cod) {
    const s = { ...leerSel() }; delete s[cod]; guardarSel(s);
    try { const r = await api("seleccionar", { method: "POST", body: JSON.stringify({ codigo: cod, quitar: true }) }); if (r.sel) guardarSel(r.sel); } catch (e) { toast(e.message); }
  }
  const selTimer = {}, selPend = {};
  function guardarSelLuego(cod, extra) {          // la barra guarda precio y costo en la nube sin saturar la red
    const s = { ...leerSel() }; if (!s[cod]) return; s[cod] = { ...s[cod], ...extra }; guardarSel(s);
    selPend[cod] = { ...(selPend[cod] || {}), ...extra };
    clearTimeout(selTimer[cod]);
    selTimer[cod] = setTimeout(() => { const e = selPend[cod]; delete selPend[cod];
      api("seleccionar", { method: "POST", body: JSON.stringify({ codigo: cod, ...e }) }).catch(() => {}); }, 900);
  }
  /* ---------- 📨 seguimiento en vivo (estado en Mercado Público) ---------- */
  // ✉ Gmail de la empresa: alertas de correos que hablan de tus compras (las lee el PC cada 2 min)
  async function cargarMail() {
    if (R._cargMail || (R.mailT && Date.now() - R.mailT < 45_000)) return; R._cargMail = true;
    try { const r = await api("correo-alertas"); const antes = (R.mailAl || []).filter((x) => !x.visto).length;
      R.mailAl = r.alertas || []; R.mailPC = !!r.correo_pc; R.waAuto = !!r.wa; R.mailT = Date.now();
      if (R.mailAl.filter((x) => !x.visto).length !== antes) pintarHojaSiAbierta(); } catch {} finally { R._cargMail = false; }
  }
  const mailChip = () => { setTimeout(cargarMail, 0); const n = (R.mailAl || []).filter((x) => !x.visto && Date.now() - Date.parse(x.t) < 3 * 864e5).length;
    return `<button class="rb-ico rb-mail" type="button" data-rb="mail-ver" aria-label="Correos" title="${R.mailPC ? "Gmail conectado" : "Conecta el correo en el panel del PC"}">${R.mailPC ? "✉" : "✉̸"}${n ? `<b>${n}</b>` : ""}</button>`; };
  function pantallaCorreos() {
    const L = R.mailAl || [];
    return `<div class="rb-paso"><div class="rb-env"><h2 class="rb-h" style="margin:0">✉ Correos de tus compras</h2><button class="btn small" type="button" data-rb="llamada-cerrar">← Volver</button></div>
      <div class="muted rb-sub">${R.mailPC ? "🟢 Gmail de la empresa conectado: el robot lee la bandeja cada 2 minutos y te avisa cuando un proveedor responde o el comprador pregunta por una compra." : "⚪ Falta conectar el Gmail de la empresa en el panel del PC (📧 Correo) para enviar y leer correos solos."}</div>
      ${L.map((x) => `<button class="rb-hist" type="button" data-rb="mail-abrir" data-c="${esc(x.codigo)}"><b>${x.quien === "proveedor" ? "📩" : "📨"} ${esc(x.de || "")} · ${esc(x.codigo)}</b><span>${esc((x.resumen || "").slice(0, 120))}${x.precio ? " · " + clp(x.precio) : ""} · ${esc(hace(x.t))}</span></button>`).join("") || `<div class="empty">Aún no llegan correos de tus compras.</div>`}</div>`;
  }
  async function cargarSeg(forzar) {
    if (R._cargandoSeg) return; R._cargandoSeg = true;
    try { const r = await api("seguimiento" + (forzar ? "?forzar=1" : "")); R.seg = { ...(R.seg || {}), ...(r.seguimiento || {}) }; R.segT = Date.now(); aCache("seg", { seg: R.seg }); } catch (e) { R.segErr = e.message; }
    R._cargandoSeg = false; pintarHoja();
  }
  const segDe = (cod) => (R.seg || {})[cod] || null;
  const descartada = (cod) => { const d = { ...(R.oport?.descartes || {}), ...(R.desc || {}) }; return !!d[cod]; };
  const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  function pantallaRubro(lista) {
    const c = leer(), ya = new Set(R.rubrosTmp || c.rubros || []);
    const vig = lista.filter((x) => Date.parse(x.cierre) - Date.now() > 30 * 60000);
    const cuenta = {}; vig.forEach((x) => { if (x.rubro) cuenta[x.rubro] = (cuenta[x.rubro] || 0) + 1; });
    const rubros = Object.keys(cuenta).filter((r) => !/^otro/i.test(r)).sort((a, b) => cuenta[b] - cuenta[a]);
    const pal = R.palabrasTmp ?? c.palabras ?? "";
    const ws = pal.split(/[,;\n]+/).map(norm).filter((w) => w.length > 2);
    const n = vig.filter((x) => ya.has(x.rubro) || (ws.length && ws.some((w) => norm(x.nombre).includes(w)))).length;
    return `<div class="rb-rubro">
      <div style="text-align:center;margin:18px 0 6px"><div style="font-size:2.4rem">🎯</div>
        <h2 style="margin:4px 0 4px;font-size:1.9rem">¿Cuál es tu rubro?</h2>
        <div class="muted" style="font-size:.86rem">Con esto busco y te muestro solo las oportunidades que puedes ganar. Elige uno o varios.</div></div>
      <div class="rb-rchips">${rubros.map((r) => `<button type="button" class="rb-rchip ${ya.has(r) ? "on" : ""}" data-rb="rubro-t" data-r="${esc(r)}">${esc(r)}<i>${cuenta[r]}</i></button>`).join("") || `<div class="empty"><span class="spinner"></span> Cargando rubros…</div>`}</div>
      <label class="muted" style="font-size:.78rem;display:block;margin-top:14px">¿Qué vendes? (palabras separadas por coma, ej. <i>neumáticos, toldos, pintura</i>)
        <input id="rbPalabras" value="${esc(pal)}" autocomplete="off" style="width:100%;margin-top:4px;padding:12px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.07);color:inherit;font:inherit"></label>
      <button class="btn rb-oro" type="button" data-rb="rubro-ok" style="width:100%;margin-top:16px;padding:15px;font-size:1.02rem">🔎 Buscar mis oportunidades${ya.size || ws.length ? ` · <b data-rb-n>${n}</b> vigentes` : ""}</button>
      <button class="btn small" type="button" data-rb="rubro-todo" style="width:100%;margin-top:8px;opacity:.8">Ver todas, sin filtrar por rubro</button></div>`;
  }
  function docsSIIg(t) {
      const op = t.op || {}, inf = op.informe || {}, F = (R.fichas || {})[t.codigo], W = (R.full || {})[t.codigo];
      if (!F && !(R._pidiendo || {})[t.codigo]) setTimeout(() => cargarDocs(t.codigo), 0);
      const items = (W?.items || []).length ? W.items.map((i) => ({ d: i.d, q: i.q, p: i.p })) : (F?.productos || []).map((x) => ({ d: x.nombre, q: x.cantidad, p: null }));
      const neto = t.neto || (t.total ? Math.round(t.total / 1.19) : null), iva = t.total && neto ? t.total - neto : null;
      const oc = segDe(t.codigo)?.oc || inf.oc || op.oc || "";
      const texto = [`RECEPTOR`, `RUT: ${F?.rut_organismo || "(ver OC)"}`, `Razón social: ${F?.organismo || t.organismo || ""}`, `Dirección de entrega: ${F?.direccion || inf.direccion || ""}`,
        `Referencia: Orden de compra ${oc} · Compra Ágil ${t.codigo}`, ``, `DETALLE`, ...items.map((i, k) => `${k + 1}. ${i.d} | Cant. ${i.q}${i.p ? ` | P. unit. ${clp(i.p)}` : ""}`),
        ``, `Neto: ${clp(neto)}  IVA 19%: ${clp(iva)}  Total: ${clp(t.total)}`].join("\n");
      return `<div class="rb-sec">🧾 Guía de despacho y factura (SII gratuito)</div>
        ${!F ? `<div class="muted" style="font-size:.74rem"><span class="spinner"></span> Trayendo los datos del organismo…</div>` : ""}
        <div class="rb-sii"><div><small>RUT receptor</small><b>${esc(F?.rut_organismo || "—")}</b> ${F?.rut_organismo ? `<button class="rb-cp" type="button" data-rb="cp" data-v="${esc(F.rut_organismo)}">Copiar</button>` : ""}</div>
          <div><small>Razón social</small><b>${esc(F?.organismo || t.organismo || "—")}</b></div>
          <div><small>Dirección de entrega</small><b>${esc(F?.direccion || inf.direccion || "—")}</b></div>
          <div><small>Referencia</small><b>OC ${esc(oc || "—")}</b> ${oc ? `<button class="rb-cp" type="button" data-rb="cp" data-v="${esc(oc)}">Copiar</button>` : ""}</div></div>
        <table class="rb-copias">${items.map((i, k) => `<tr><td>${k + 1}. ${esc(String(i.d || "").slice(0, 60))}</td><td class="n">${esc(i.q ?? "")}</td><td class="n">${i.p ? clp(i.p) : ""}</td></tr>`).join("")}
          <tr><td><b>Neto · IVA · Total</b></td><td class="n" colspan="2">${clp(neto)} · ${clp(iva)} · <b>${clp(t.total)}</b></td></tr></table>
        <div class="rb-row" style="margin-top:8px"><button class="btn small rb-oro" type="button" data-rb="cp" data-v="${esc(texto)}">📋 Copiar todo para el SII</button>
          <a class="btn small" href="https://www.sii.cl" target="_blank" rel="noopener">Abrir SII ↗</a></div>
        <div class="muted" style="font-size:.7rem;margin-top:4px">En sii.cl: Servicios online → Factura electrónica → Sistema de facturación gratuito → Emitir documento (Guía de despacho y luego Factura con referencia a la OC). Las emites tú con tu clave del SII.</div>
        <div class="rb-row"><label class="rb-lab" style="flex:1">Folio guía<input class="rb-neg-in" data-campo="folio_guia" data-c="${esc(t.codigo)}" value="${esc(op.folio_guia || "")}" inputmode="numeric"></label>
          <label class="rb-lab" style="flex:1">Folio factura<input class="rb-neg-in" data-campo="folio_factura" data-c="${esc(t.codigo)}" value="${esc(op.folio_factura || "")}" inputmode="numeric"></label></div>
        <div class="rb-acc"><button class="btn small" type="button" data-rb="neg-subir" data-tipo="guia" data-c="${esc(t.codigo)}">🚚 Subir guía PDF</button><button class="btn small" type="button" data-rb="neg-subir" data-tipo="factura" data-c="${esc(t.codigo)}">🧾 Subir factura PDF</button></div>
        <button class="btn rb-firmar" type="button" style="width:100%;margin-top:8px" data-rb="neg-etapa" data-e="despacho" data-c="${esc(t.codigo)}">✅ Documentos listos → Despacho</button>`;
    }
  // ======================= 🛠 EJECUTA: el portal de los socios ejecutadores =======================
  // El que ganó deriva el negocio (o lo ejecuta él). El ejecutador negocia con proveedores, fija el precio de compra,
  // pide la transferencia al inversionista, prepara la entrega y cierra con la guía y la factura firmadas.
  const ETAPAS_EJ = [["operacion", "💼 Oportunidades de negocio"], ["pago", "💸 Pago"], ["transporte", "🚚 Despacho"], ["despacho", "🛣 En trayecto"], ["entrega", "📦 Recepción"], ["cerrado", "🥇 Cerrados"]];
  const etEj = (t) => (["previa", "ganada", "inversionista"].includes(t.op?.etapa) ? "operacion" : t.op?.etapa === "documentos" ? "pago" : t.op?.etapa || "operacion");
  const TARIFA_KM_STGO = 900;            // 🚚 flete en Santiago: $900 por km
  const netoDe = (v) => (v ? Math.round(v / 1.19) : 0);
  const mailUrl = (to, su, body) => conex().gmail
    ? "https://mail.google.com/mail/?view=cm&fs=1&authuser=" + encodeURIComponent(conex().gmail) + "&to=" + encodeURIComponent(to || "") + "&su=" + encodeURIComponent(su) + "&body=" + encodeURIComponent(body)
    : "mailto:" + encodeURIComponent(to || "") + "?subject=" + encodeURIComponent(su) + "&body=" + encodeURIComponent(body);
  const waNum = (n) => { let d = String(n || "").replace(/\D/g, ""); if (d.length === 9 && d[0] === "9") d = "56" + d; if (d.length === 8) d = "569" + d; return d.length >= 10 ? d : ""; };
  const telNum = (n) => String(n || "").replace(/[^\d+]/g, "");
  const itemsTodo = (t) => { const a2 = Array.isArray(t.items) && t.items.length ? t.items : itemsDe(t); if (!a2.length && !(R._pidiendo || {})[t.codigo] && !(R.fichas || {})[t.codigo]) setTimeout(() => cargarDocs(t.codigo), 0); return a2; };
  const itemsDe = (t) => { const oc = t.oc_compra?.items || [], W = (R.full || {})[t.codigo], F = (R.fichas || {})[t.codigo], inf = t.op?.informe || {};
    if (oc.length) return oc.map((i) => ({ d: i.especificacion || i.nombre, q: i.cantidad, u: i.unidad, p: i.precio }));
    if ((W?.items || []).length) return W.items.map((i) => ({ d: i.d, q: i.q, p: i.p }));
    return ((inf.productos || []).length ? inf.productos : F?.productos || []).map((x) => ({ d: x.nombre + (x.descripcion ? " · " + String(x.descripcion).slice(0, 80) : ""), q: x.cantidad, p: null })); };
  // 🧮 números del negocio (lo que entra, lo que sale y lo que queda)
  function cuentasDe(t) {
    const op = t.op || {}, inf = op.informe || {};
    const venta = Number(t.oc_compra?.total || t.total) || 0, ventaN = Number(t.oc_compra?.neto || t.neto) || netoDe(venta);
    const compra = Number(op.precio_acordado) || 0, flete = Number(op.costo_transporte) || 0;
    const ivaD = venta - ventaN, ivaC = compra - netoDe(compra);
    const bruta = ventaN - netoDe(compra) - flete;
    return { venta, ventaN, compra, flete, ivaD, ivaC, iva: ivaD - ivaC, bruta, final: inf.final, inv: inf.inversionista, estimado: inf.compras || null };
  }
  // 🛒 lo que de verdad hay que comprar/contratar (interpretado por la IA del PC como experto del rubro)
  const queComprar = (t) => { const q = t.op?.informe?.que_comprar || [];
    if (q.length) return q.map((x) => ({ que: x.que || x.item || "", cantidad: x.cantidad, unidad: x.unidad || "", tipo: x.tipo || "", detalle: x.detalle || "", ojo: x.ojo || "" }));
    return itemsDe(t).map((x) => ({ que: String(x.d || "").slice(0, 140), cantidad: x.q, unidad: x.u || "", tipo: "", detalle: "", ojo: "" })); };
  const kProv = (n) => sinTilde(n).replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  const candsDe = (t) => { const inf = t.op?.informe || {}, vistos = new Set();
    return [...(inf.opciones || []), ...(t.op?.extras || [])].filter((o) => o.proveedor).map((o) => ({ ...o, k: kProv(o.proveedor) })).filter((o) => !vistos.has(o.k) && vistos.add(o.k)); };
  // ¿da el negocio con este proveedor? venta neta − compra neta − despacho estimado
  const daDe = (t, o) => { const op = t.op || {}, k = cuentasDe(t), q = (op.cotizaciones || {})[o.k], r = (op.respuestas || []).filter((x) => x.k === o.k && x.precio).pop();
    const v = q?.v || (r ? (r.incluye_iva ? r.precio : Math.round(r.precio * 1.19)) : null); if (!v) return null;
    return k.ventaN - netoDe(v) - (Number(op.costo_transporte) || (r?.costo_despacho || 0)); };
  const firmaMail = () => `\n\nSaludos,\n${persona()?.nombre || ""}\n${(empresaActual() || {}).razon_social || ""}${(empresaActual() || {}).rut ? " · RUT " + empresaActual().rut : ""}${(empresaActual() || {}).telefono ? "\n" + empresaActual().telefono : ""}`;
  function cuerpoCot(t, o) {
    const op = t.op || {}, dir = lugarDe(t) || op.informe?.direccion || "";
    const L = queComprar(t).map((x) => `- ${x.cantidad ?? ""} ${x.unidad || ""} ${x.que}${x.detalle ? ": " + String(x.detalle).slice(0, 200) : ""}`).join("\n");
    return `Hola${o.contacto ? " " + o.contacto : ""},\n\nTenemos una orden de compra del Estado (${t.oc_compra?.organismo || t.organismo || "organismo público"}) y necesitamos cotización con factura de:\n${L}\n\nEntrega / lugar del servicio: ${dir || "(a confirmar)"}${op.plazo_fecha ? "\nFecha comprometida: " + op.plazo_fecha : ""}\n\n¿Nos puede indicar precio total con IVA, disponibilidad, plazo y si despacha o ejecuta en el lugar? Pago por transferencia al confirmar.${firmaMail()}`;
  }
  function textoEntrega(t, modo) {
    const op = t.op || {}, oc = t.oc_compra || {}, dir = lugarDe(t) || op.informe?.direccion || "";
    return `Hola, confirmamos la compra ${t.codigo}${op.oc_codigo ? " (OC " + op.oc_codigo + ")" : ""} por ${clp(op.precio_acordado)}.\n${modo === "servicio" ? "Por favor coordinemos la ejecución del servicio" : "Por favor despáchenlo directo al cliente final"}:\n• Cliente: ${oc.organismo || t.organismo || ""}${oc.unidad ? " · " + oc.unidad : ""}\n• Dirección: ${dir}\n• Recibe: ${op.entrega_contacto || [oc.contacto, oc.fono, oc.mail].filter(Boolean).join(" · ") || "(te lo confirmo)"}${op.plazo_fecha ? "\n• Fecha comprometida: " + op.plazo_fecha : ""}\n\nDetalle:\n${queComprar(t).map((x) => `- ${x.cantidad ?? ""} ${x.unidad || ""} ${x.que}`).join("\n")}\n\nNecesitamos que el receptor firme la guía de despacho (recepción conforme) y nos envíen la foto. ¿Nos confirman fecha y hora?`;
  }
  // 📨 correos según el paso del negocio
  function correoTipo(t, tipo) {
    const op = t.op || {}, oc = t.oc_compra || {}, to = tipo === "entrega" ? (oc.mail || op.informe?.comprador?.email) : op.proveedor_email;
    const ref = `${t.codigo}${op.oc_codigo ? " · OC " + op.oc_codigo : ""}`;
    const comp = (op.docs || []).filter((d) => d.tipo === "comprobante").pop();
    const M = {
      banco: [`Datos para transferir · ${ref}`, `Hola,\n\nConfirmamos la compra ${ref} por ${clp(op.precio_acordado)}. Para transferir hoy, ¿nos envía los datos de su cuenta corriente? (banco, tipo de cuenta, número, RUT, titular y correo para el aviso).${firmaMail()}`],
      comprobante: [`Comprobante de pago · ${ref}`, `Hola,\n\nAdjuntamos el comprobante de transferencia por ${clp(op.precio_acordado)} de la compra ${ref}.\n¿Nos avisa cuándo está listo? Lo ideal es que lo despachen directo al cliente final; le enviamos los datos de entrega.${firmaMail()}`],
      despacho: [`Despacho al cliente final · ${ref}`, textoEntrega(t, "despacho") + firmaMail()],
      servicio: [`Coordinación del servicio · ${ref}`, textoEntrega(t, "servicio") + firmaMail()],
      entrega: [`Datos de entrega · ${ref}`, `Estimado/a ${oc.contacto || ""},\n\nPor la orden de compra ${op.oc_codigo || ""} (${t.codigo} · ${t.nombre || ""}) necesitamos confirmar los datos de entrega: dirección exacta, nombre y teléfono de quien recibe, y horario de recepción.\nQuedamos atentos para despachar a la brevedad.${firmaMail()}`],
    }[tipo];
    return M ? { to, asunto: M[0], cuerpo: M[1], tipo, k: tipo === "entrega" ? "cliente" : op.proveedor_k || kProv(op.proveedor), nombre: tipo === "entrega" ? oc.contacto || oc.organismo : op.proveedor,
      ...(tipo === "comprobante" && comp ? { adjunto_doc: { id: comp.id, nombre: comp.nombre, mime: comp.mime } } : {}) } : null;
  }
  async function enviarCorreos(cod, lista) {
    lista = lista.filter((x) => x && /@/.test(x.to || ""));
    if (!lista.length) { toast("Falta el correo del destinatario"); return false; }
    if (!R.mailPC && lista.length === 1) { const x = lista[0]; window.open(mailUrl(x.to, x.asunto, x.cuerpo), "_blank"); }
    try { const r = await api("correo-enviar", { method: "POST", body: JSON.stringify({ codigo: cod, lista }) });
      toast(r.pc ? `📤 ${lista.length} correo${lista.length > 1 ? "s" : ""} saliendo desde tu Gmail` : lista.length > 1 ? "📥 En cola: salen apenas el PC tenga el correo conectado (panel → 📧 Correo)" : "✉ Revisa y envía el correo · queda anotado");
      navigator.vibrate?.(12); R.ejecT = 0; await cargarEjecuta(); pintarHoja(true); return true; } catch (e) { toast(e.message); return false; }
  }
  const botonMail = (cod, o, c) => `<button class="btn small ${c ? "" : "rb-oro"}" type="button" data-rb="ej-mail" data-c="${esc(cod)}" data-k="${esc(o.k)}">${c?.via === "correo" ? "✉ Reenviar" : "✉ Enviar correo"}</button>`;
  // 📊 EERR del negocio cerrado: todo el registro (lo mismo que el Excel del inversionista)
  function eerrNegocio(t) {
    const op = t.op || {}, inf = op.informe || {}, k = cuentasDe(t), compraN = netoDe(k.compra);
    const margen = k.ventaN - compraN - k.flete, rep = ["inversionista", "comision", "julfior", "impuesto", "factoring"].filter((x) => inf[x]);
    const fila = (a, b, c) => `<tr><td>${a}</td><td class="n">${c ? `<b class="${b >= 0 ? "rb-vivo-t" : "rb-neg-t"}">${clp(b)}</b>` : clp(b)}</td></tr>`;
    const hist = (op.historial || []).map((h) => `<div class="rb-hito"><span>${esc(new Date(h.t).toLocaleDateString("es-CL", { day: "numeric", month: "short" }))}</span>${esc(({ previa: "📞 Vas 1°", ganada: "🏆 OC", operacion: "🤝 Proveedores", transporte: "🚚 Despacho", pago: "💸 Pago", despacho: "🛣 En trayecto", entrega: "📦 Recepción", cerrado: "🥇 Cerrado" })[h.etapa] || h.etapa)}</div>`).join("");
    return `<div class="rb-eerr"><div class="rb-env"><b>📊 Estado de resultados</b><span class="muted">${op.cerrado ? "cerrado " + esc(new Date(op.cerrado).toLocaleDateString("es-CL")) : ""}</span></div>
      <table class="rb-copias">${fila("Ingresos (venta neta)", k.ventaN)}${fila("− Costo de compra (neto)", -compraN)}${fila("− Despacho / flete", -k.flete)}${fila("= Margen bruto", margen, 1)}
        ${rep.map((x) => fila("− " + ({ inversionista: "Inversionista", comision: "Comisión", julfior: "Gestión", impuesto: "Impuesto estimado", factoring: "Factoring" })[x], -Math.round(inf[x]))).join("")}
        ${inf.final != null ? fila("= Utilidad final (Excel inversionista)", Math.round(inf.final), 1) : ""}
        ${fila("IVA débito − crédito", k.iva)}</table>
      <div class="rb-kv"><span>Proveedor <b>${esc(op.proveedor || "—")}</b></span><span>Despacho <b>${esc(op.transportista || (op.despacho_modo === "servicio" ? "lo hizo el proveedor" : "—"))}</b></span>${op.recibio_nombre ? `<span>Recibió <b>${esc(op.recibio_nombre)}</b></span>` : ""}</div>
      <div class="rb-hitos">${hist}</div>
      <div class="rb-row"><button class="btn small rb-firmar" type="button" data-rb="neg-archivo" data-t="excel" data-c="${esc(t.codigo)}">📊 Excel del inversionista</button><button class="btn small" type="button" data-rb="neg-archivo" data-t="informe" data-c="${esc(t.codigo)}">📄 Informe PDF</button>
        <button class="btn small" type="button" data-rb="ej-factoring" data-c="${esc(t.codigo)}">💰 Pedir simulación de factoring</button></div>
      ${(op.docs || []).length ? `<div class="rb-row">${op.docs.map((d) => `<button class="btn small" type="button" data-rb="neg-doc" data-c="${esc(t.codigo)}" data-id="${esc(d.id)}">${d.tipo === "foto" ? "📸" : d.tipo === "guia" ? "🚚" : d.tipo === "comprobante" ? "💸" : "📎"} ${esc(String(d.nombre).slice(0, 16))}</button>`).join("")}</div>` : ""}</div>`;
  }
  // 🃏 portada de cada negocio en Ejecuta: desliza → ver ahora · ← ver en otro momento
  const EJ_LUEGO = "sdc:ejLuego";
  const leerLuego = () => { try { return JSON.parse(localStorage.getItem(EJ_LUEGO)) || {}; } catch { return {}; } };
  function portadaEj(t) {
    const op = t.op || {}, k = cuentasDe(t), E = etEj(t), q = queComprar(t)[0], nuevas = (op.respuestas || []).filter((r) => !r.visto).length;
    const mejor = candsDe(t).map((o) => daDe(t, o)).filter((x) => x != null).sort((a, b) => b - a)[0];
    const dir = lugarDe(t) || op.informe?.direccion || "";
    return `<div class="rb-ejcard rb-swipe ${E === "despacho" ? "trayecto" : ""}" data-modo="ej" data-c="${esc(t.codigo)}"><span class="rb-sello si">VER AHORA</span><span class="rb-sello no">DESPUÉS</span>
      <div class="rb-env"><span style="font-size:.72rem"><b>${esc(t.codigo)}</b>${op.oc_codigo ? " · OC" : op.etapa === "previa" ? " · <b style='color:#5ef0b0'>vas 1°</b>" : ""}</span>
        <span>${nuevas ? `<span class="rb-pill verde"><i class="rb-luz"></i> ${nuevas} respuesta${nuevas > 1 ? "s" : ""}</span>` : ""}${E === "despacho" ? '<span class="rb-pill"><i class="rb-luz"></i> en trayecto</span>' : ""}${op.plazo_fecha ? ` <span class="rb-pill">${textoPlazo(op.plazo_fecha)}</span>` : ""}</span></div>
      <div class="rb-fnom" style="margin:4px 0 2px">${esc(t.nombre || "")}</div>
      <div class="muted" style="font-size:.72rem">${esc((t.oc_compra?.organismo || t.organismo || "").slice(0, 60))}${dir ? " · 📍 " + esc(dir.slice(0, 40)) : ""}</div>
      ${q ? `<div class="rb-qc mini"><span class="n">${esc(q.cantidad ?? "")}<small>${esc(q.unidad || "")}</small></span><div><b>${esc(q.que.slice(0, 90))}</b>${queComprar(t).length > 1 ? ` <span class="muted">+${queComprar(t).length - 1} más</span>` : ""}</div></div>` : ""}
      <div class="rb-kv"><span>Venta <b>${clp(k.venta)}</b></span>${mejor != null ? `<span class="${mejor > 0 ? "rb-vivo-t" : "rb-neg-t"}">Mejor oferta deja <b>${clp(mejor)}</b></span>` : `<span class="muted">${candsDe(t).length} proveedores</span>`}</div>
      <div class="rb-row"><button class="btn small" type="button" data-rb="ej-luego" data-c="${esc(t.codigo)}">⏰ Después</button>${op.oc_codigo ? `<button class="btn small" type="button" data-rb="ej-rechazar" data-c="${esc(t.codigo)}" data-oc="${esc(op.oc_codigo)}">✖ Rechazar</button>` : ""}<button class="btn small rb-oro" type="button" style="flex:1" data-rb="ej-ver" data-c="${esc(t.codigo)}">👀 Ver ahora</button></div></div>`;
  }
  // 📄 guía de despacho con acta de recepción conforme / factura (borrador): se abre lista para imprimir o compartir en PDF
  function docNegocio(t, tipo) {
    const op = t.op || {}, e = empresaActual() || {}, oc = t.oc_compra || {}, F = (R.fichas || {})[t.codigo] || {}, k = cuentasDe(t), it = itemsDe(t);
    const hoy = new Date().toLocaleDateString("es-CL"), ocN = op.oc_codigo || op.oc || op.informe?.oc || "";
    const receptor = { nombre: oc.organismo || F.organismo || t.organismo || "", unidad: oc.unidad || "", rut: oc.rut_organismo || F.rut_organismo || "", dir: oc.direccion || F.direccion || op.informe?.direccion || "" };
    const guia = tipo === "guia";
    const filas = it.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(String(i.d || "").slice(0, 160))}</td><td class=n>${esc(i.q ?? "")} ${esc(i.u || "")}</td>${guia ? "" : `<td class=n>${i.p ? clp(i.p) : ""}</td><td class=n>${i.p && i.q ? clp(i.p * i.q) : ""}</td>`}</tr>`).join("");
    const html = `<!doctype html><html lang=es><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${guia ? "Guía de despacho" : "Factura"} ${esc(t.codigo)}</title>
<style>body{font:12px/1.45 system-ui,Arial,sans-serif;color:#111;margin:18px;max-width:780px}h1{font-size:18px;margin:0}.box{border:1.5px solid #111;padding:8px 10px;border-radius:6px;margin:8px 0}
.top{display:flex;justify-content:space-between;gap:12px}.folio{border:2px solid #c00;color:#c00;padding:8px 12px;text-align:center;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:6px}
td,th{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}.n{text-align:right;white-space:nowrap}.firma{height:54px;border-bottom:1px solid #111}.aviso{font-size:10px;color:#a00;margin-top:6px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px}@media print{.np{display:none}}</style></head><body>
<div class=np style="margin-bottom:10px"><button onclick="print()" style="font-size:16px;padding:10px 16px">🖨 Imprimir / Guardar PDF</button></div>
<div class=top><div><h1>${esc(e.razon_social || "")}</h1><div>RUT ${esc(e.rut || "")}${e.giro ? " · " + esc(e.giro) : ""}</div><div>${esc(e.direccion || "")}</div></div>
<div class=folio>R.U.T. ${esc(e.rut || "")}<br>${guia ? "GUÍA DE DESPACHO" : "FACTURA"}<br>BORRADOR · N° ${esc((guia ? op.folio_guia : op.folio_factura) || "_____")}</div></div>
<div class="box grid"><div><b>Señor(es):</b> ${esc(receptor.nombre)}</div><div><b>RUT:</b> ${esc(receptor.rut)}</div><div><b>Unidad:</b> ${esc(receptor.unidad)}</div><div><b>Fecha:</b> ${hoy}</div>
<div style="grid-column:1/-1"><b>Dirección de entrega:</b> ${esc(receptor.dir)}</div><div><b>Referencia:</b> OC ${esc(ocN)}</div><div><b>Compra Ágil:</b> ${esc(t.codigo)}</div>
${guia ? `<div><b>Traslado:</b> venta (constituye venta)</div><div><b>Transportista:</b> ${esc(op.transportista || "")} ${op.transportista_tel ? "· " + esc(op.transportista_tel) : ""}</div><div><b>Patente:</b> ${esc(op.patente || "")}</div><div><b>Retiro en:</b> ${esc(op.origen_flete || op.proveedor || "")}</div>` : ""}</div>
<table><tr><th>#</th><th>Detalle</th><th class=n>Cant.</th>${guia ? "" : "<th class=n>P. unit. neto</th><th class=n>Total neto</th>"}</tr>${filas}</table>
${guia ? "" : `<table style="width:46%;margin-left:auto"><tr><td>Neto</td><td class=n>${clp(k.ventaN)}</td></tr><tr><td>IVA 19%</td><td class=n>${clp(k.ivaD)}</td></tr><tr><td><b>Total</b></td><td class=n><b>${clp(k.venta)}</b></td></tr></table>`}
${guia ? `<div class=box><b>ACTA DE RECEPCIÓN CONFORME</b><div class=grid style="margin-top:8px"><div>Recibí conforme (nombre):<div class=firma></div></div><div>RUT:<div class=firma></div></div><div>Firma y timbre:<div class=firma></div></div><div>Fecha y hora:<div class=firma></div></div></div>
<div style="margin-top:8px">Transportista (nombre y firma):<div class=firma></div></div></div>` : ""}
<div class=aviso>Borrador con los datos del negocio. El documento tributario válido (DTE ${guia ? "52" : "33"}) se emite en sii.cl → Sistema de facturación gratuito, con el mismo detalle; anota el folio en la app.</div>
</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    else { const u = URL.createObjectURL(new Blob([html], { type: "text/html" })); location.href = u; }
  }
  async function cargarEjecuta() {
    if (R._cargEj) return; R._cargEj = true;
    try { const [a, b] = await Promise.all([api("ejecuta?todos=1&ejecutor=" + miJug()), api("ejecutores")]); R.ejec = a.negocios || []; R.ejecutores = b.ejecutores || {}; R.ejecT = Date.now(); }
    catch (e) { R.ejec = R.ejec || []; toast(e.message); }
    R._cargEj = false; pintarHoja(true);
  }
  async function cargarEjecutores() { try { R.ejecutores = (await api("ejecutores")).ejecutores || {}; } catch {} pintarHoja(true); }
  const buscarEn = (q) => [["Google", "https://www.google.com/search?tbm=shop&q="], ["Marketplace", "https://www.facebook.com/marketplace/search/?query="], ["MercadoLibre", "https://listado.mercadolibre.cl/"], ["Sodimac", "https://www.sodimac.cl/sodimac-cl/search?Ntt="], ["Lider", "https://www.lider.cl/search?q="]]
    .map(([n, u]) => `<a class="rb-cp" href="${u}${encodeURIComponent(q)}" target="_blank" rel="noopener">${n}</a>`).join(" ");
  // 🛒 Facebook Marketplace: segunda opción cuando los proveedores autorizados no tienen stock o están caros.
  // Facebook no permite buscar por programa: se abre la búsqueda ya hecha (en el iPhone abre la app de Facebook).
  const qMk = (n) => String(n || "").split(/[,(;:]|\s-\s/)[0].replace(/\b\d+([.,]\d+)?\s*(unidades?|un|uds?|cajas?|kgs?|kilos?|lts?|litros?|m3|m2|mts?|metros?( c[uú]bicos)?|sacos?|ton(eladas)?|tons?)\b/gi, "").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  // 📍 Marketplace donde se ENTREGA: Facebook solo tiene 3 ciudades de Chile con dirección propia (radio 65 km);
  //    en el resto (Chiloé, Puerto Montt, Temuco…) se busca con la comuna en el texto.
  const sinTilde = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const ZONAS_MK = [
    ["concepcion", "Concepción", /biobio|bio-bio|nuble|concepcion|talcahuano|chillan|los angeles|coronel|lota|hualpen|san pedro de la paz|tome|penco|chiguayante|arauco|lebu|canete|curanilahue|mulchen|nacimiento|yumbel|cabrero|bulnes|san carlos|angol|renaico|collipulli|victoria|malleco/],
    ["antofagasta", "Antofagasta", /antofagasta|calama|tocopilla|mejillones|taltal|iquique|alto hospicio|tarapaca|arica|parinacota|pozo almonte/],
    ["santiagocl", "Santiago", /metropolitana|santiago|providencia|las condes|nunoa|maipu|puente alto|la florida|la reina|vitacura|lo barnechea|penalolen|quilicura|pudahuel|san bernardo|colina|lampa|buin|talagante|melipilla|penaflor|valparaiso|vina del mar|quilpue|villa alemana|san antonio|quillota|los andes|rancagua|o'?higgins|machali|san fernando|santa cruz|rengo/],
  ];
  const lugarDe = (t) => String(t?.oc_compra?.direccion || t?.op?.informe?.direccion || (R.fichas || {})[t?.codigo]?.direccion || "");
  function zonaMk(dir) {
    const d = sinTilde(dir), partes = String(dir || "").split(",").map((x) => x.trim()).filter(Boolean);
    const iR = partes.findIndex((x) => /regi[oó]n/i.test(x));
    const comuna = (iR > 0 ? partes[iR - 1] : partes.length > 1 ? partes[partes.length - 1] : "").replace(/^\d+\s*/, "");
    const z = d ? ZONAS_MK.find(([, , re]) => re.test(d)) : null;
    return { slug: z ? z[0] : null, ciudad: z ? z[1] : null, comuna };
  }
  const urlMk = (n, dir) => {
    const z = zonaMk(dir);
    if (z.slug) return `https://www.facebook.com/marketplace/${z.slug}/search/?query=` + encodeURIComponent(qMk(n));
    return "https://www.facebook.com/marketplace/search/?query=" + encodeURIComponent((qMk(n) + " " + (z.comuna || "")).trim());
  };
  function bloqueMarket(prods, dir) {
    const ps = (prods || []).filter((x) => x && x.nombre).slice(0, 12);
    if (!ps.length) return "";
    const z = zonaMk(dir);
    const dondeTxt = z.slug ? `📍 Busca en <b>${esc(z.ciudad)}</b> y 65 km a la redonda${z.comuna && sinTilde(z.comuna) !== sinTilde(z.ciudad) ? ` (entregas en ${esc(z.comuna)}: si queda lejos, toca 📍 en Marketplace y elige ${esc(z.comuna)})` : ""}.`
      : z.comuna ? `📍 Entregas en <b>${esc(z.comuna)}</b>: la búsqueda lleva la comuna. En Marketplace toca 📍 Ubicación → ${esc(z.comuna)} para ver solo vendedores de ahí.` : "";
    return `<details class="rb-det rb-mk"><summary>🛒 Segunda opción: proveedores locales en Facebook Marketplace</summary>
      <div class="muted" style="font-size:.7rem;margin:4px 0 6px">${dondeTxt} Cuando los proveedores autorizados no tienen stock, tardan o están caros.
        <b>¿Es confiable?</b> perfil con años y foto real, buenas calificaciones, que dé RUT y emita <b>factura</b>, ver el producto antes de pagar y nunca adelantar todo. Anota el precio acordado para ver si ahorraste.</div>
      ${ps.map((x) => `<div class="rb-env" style="gap:8px;margin:4px 0"><span style="font-size:.76rem;min-width:0">${esc(x.cantidad ?? "")} × ${esc(qMk(x.nombre))}</span>
        <a class="btn small" href="${urlMk(x.nombre, dir)}" target="_blank" rel="noopener" style="flex:none">🛒 Marketplace</a></div>`).join("")}</details>`;
  }
  // 📍 proveedor local encontrado por el robot (misma comuna / región de entrega) y qué tan confiable es
  const chipLocal = (o) => (o && (o.local || o.confianza) ? ` <span class="rb-cp" style="font-size:.66rem;font-weight:600">${o.local ? "📍 local" + (o.ciudad ? " · " + esc(String(o.ciudad).slice(0, 18)) : "") : "🌐"}${o.confianza ? " · " + ({ alta: "✅ confiable", media: "🟡 confianza media", baja: "⚠ verificar" }[sinTilde(o.confianza)] || esc(o.confianza)) : ""}</span>` : "")
    + (o && o.senales ? `<div class="muted" style="font-size:.68rem;font-weight:400">${esc(String(o.senales).slice(0, 160))}</div>` : "");
  const diasPlazo = (f) => { if (!f) return 99; const h = new Date(); h.setHours(12, 0, 0, 0); return Math.round((Date.parse(f + "T12:00") - h) / 86400000); };
  const textoPlazo = (f) => { const d = diasPlazo(f); return d < 0 ? `🔴 atrasado ${-d} día${d === -1 ? "" : "s"}` : d === 0 ? "🟠 es hoy" : d === 1 ? "🟡 mañana" : `🟢 quedan ${d} días`; };
  // 💬 conversación con el proveedor (WhatsApp / Marketplace): la IA saca el precio y escribe la siguiente respuesta
  const msgMk = (t) => `Hola! Vi tu publicación. Somos ${(empresaActual() || {}).razon_social || "una empresa"} y necesitamos con factura: ${queComprar(t).map((x) => `${x.cantidad ?? ""} ${x.unidad || ""} ${x.que}`.replace(/\s+/g, " ").trim()).join("; ")}. Entrega en ${lugarDe(t) || "(a confirmar)"}. ¿Precio total con IVA, plazo y si despachas? Gracias!`;
  function chatBox(t, o) {
    const cod = t.codigo, c = (t.op?.chats || {})[o.k]; const cont = (t.op?.contactados || {})[o.k] || {};
    const mk = c?.canal === "mk" || o.fuente === "marketplace";
    const abrir = mk ? (c?.link || o.link || urlMk(queComprar(t)[0]?.que || t.nombre || "", lugarDe(t))) : waNum(c?.tel || o.telefono) ? "https://wa.me/" + waNum(c?.tel || o.telefono) : "";
    const reb = cont.estado === "rebotó";
    if (!c && !reb && !mk) return "";
    const msgs = (c?.msgs || []).slice(-4).map((m) => `<div class="rb-burb ${m.de === "yo" ? "yo" : "el"}">${esc(String(m.txt || "").slice(0, 400))}${m.de === "yo" ? `<small>${m.auto ? "🤖 enviado solo" : m.enviado ? "✓ enviado" : "sin enviar"}</small>` : ""}</div>`).join("");
    const sug = c?.sugerido || (!c && (reb || mk) ? (mk ? msgMk(t) : "") : "");
    const urlSug = mk ? abrir : abrir ? abrir + "?text=" + encodeURIComponent(sug) : "";
    return `<div class="rb-chat">${reb ? `<div class="rb-rebote">📛 Rebotó su correo${cont.error ? ` <span class="muted">(${esc(String(cont.error).replace(/^el correo /, "").replace(/ rebotó$/, ""))})</span>` : ""} → ${R.waAuto && waNum(c?.tel || o.telefono) ? "🤖 ya le pedí el correo y el precio por WhatsApp" : waNum(c?.tel || o.telefono) ? "pídeselo por WhatsApp y de paso cotízale 👇" : "no tiene teléfono: búscalo o agrega otro proveedor"}</div>` : ""}
      ${cont.rescatado ? `<div class="rb-resp nueva">📧 Rescaté su correo <b>${esc(cont.rescatado)}</b> · la solicitud ${cont.estado === "en_cola" ? "está saliendo" : "salió"} de nuevo</div>` : ""}
      ${msgs}
      ${c?.pendiente ? `<div class="muted" style="font-size:.7rem">🤖 Leyendo su respuesta y preparando la siguiente…</div>` : ""}
      ${c?.precio ? `<div class="rb-resp nueva">💲 Precio que sacó la IA: <b>${clp(c.precio)}</b></div>` : ""}
      ${sug ? `<div class="rb-sugerido"><small>${c?.sugerido ? "🤖 La IA propone responder:" : "Mensaje listo:"}</small><div>${esc(sug)}</div>
        <div class="rb-row">${urlSug ? `<a class="btn small rb-oro" href="${esc(urlSug)}" target="_blank" rel="noopener" data-rb="chat-envie" data-c="${esc(cod)}" data-k="${esc(o.k)}" data-n="${esc(o.proveedor)}" data-canal="${mk ? "mk" : "wa"}" data-tel="${esc(c?.tel || o.telefono || "")}" data-v="${esc(sug)}">${mk ? "🛒 Copiar y abrir Marketplace" : "💬 Enviar por WhatsApp"}</a>` : ""}
          <button class="btn small" type="button" data-rb="cp" data-v="${esc(sug)}">Copiar</button></div></div>` : ""}
      <details class="rb-det" ${c && !c.pendiente && !c.sugerido && (c.msgs || []).length && c.msgs[c.msgs.length - 1].de === "yo" ? "open" : ""}><summary>📥 ¿Te respondió? Pega su mensaje y la IA le contesta</summary>
        <textarea class="rb-in" id="rbChat-${esc(cod)}-${esc(o.k)}" rows="3" placeholder="Pega aquí lo que te escribió ${esc(o.proveedor || "")}"></textarea>
        <button class="btn small rb-oro" type="button" data-rb="chat-pegar" data-c="${esc(cod)}" data-k="${esc(o.k)}" data-n="${esc(o.proveedor)}" data-canal="${mk ? "mk" : "wa"}" data-tel="${esc(c?.tel || o.telefono || "")}">🤖 Leer y responder</button></details></div>`;
  }
  const busqProyecto = (t) => { const p = t.op?.informe?.proyecto || {}; if (p.busqueda) return String(p.busqueda);
    const q = queComprar(t); return q.length === 1 ? String(q[0].que).split(/[,.(]/)[0].split(" ").slice(0, 6).join(" ") : String(t.nombre || q[0]?.que || "").split(/[,.(]/)[0].split(" ").slice(0, 6).join(" "); };
  function bloqueMk4(t) {
    const cod = t.codigo, ex = (t.op?.extras || []).filter((x) => x.fuente === "marketplace"), dir = lugarDe(t);
    return `<div class="rb-mision rb-mk4"><div class="rb-env"><b>🛒 Marketplace: conversa con 4 vendedores</b><b>${Math.min(ex.length, 4)}/4</b></div>
      <div class="muted" style="font-size:.7rem">1) Abre Marketplace ya filtrado por la zona de entrega · 2) elige 4 vendedores confiables (perfil antiguo, buenas calificaciones, que den factura) · 3) anótalos aquí: te dejo el mensaje listo y, cuando respondan, pegas su respuesta y la IA conversa hasta sacarle el precio.</div>
      <div class="rb-row"><a class="btn small" href="${urlMk(busqProyecto(t), dir)}" target="_blank" rel="noopener">🔎 Buscar «${esc(busqProyecto(t).slice(0, 34))}»${zonaMk(dir).ciudad ? " en " + esc(zonaMk(dir).ciudad) : ""}</a></div>
      <div class="muted" style="font-size:.66rem">Buscamos a <b>uno que haga todo el proyecto</b>${t.op?.informe?.proyecto?.rubro ? " (" + esc(t.op.informe.proyecto.rubro) + ")" : ""}: un solo pago y lo ejecuta completo. <b>¿Confiable?</b> perfil antiguo con foto real, buenas calificaciones, que dé RUT y factura; nunca adelantar todo.</div>
      ${ex.length < 6 ? `<div class="rb-row"><input class="rb-in" id="rbMkN-${esc(cod)}" placeholder="Nombre del vendedor" style="flex:1"><input class="rb-in" id="rbMkL-${esc(cod)}" placeholder="Link de la publicación (opcional)" style="flex:1"></div>
      <button class="btn small rb-oro" type="button" data-rb="mk-add" data-c="${esc(cod)}">➕ Agregar vendedor</button>` : ""}</div>`;
  }
  // 🔴 entrega en vivo con los lentes Ray-Ban Meta → Twitch: el inversionista mira y el video queda como prueba de entrega
  const TW = "sdc:twitch";
  const twCanal = (t) => (t.op?.twitch_canal || (() => { try { return localStorage.getItem(TW) || ""; } catch { return ""; } })()).replace(/^@/, "").trim();
  function bloqueVivo(t) {
    if (!tienePlan("premium")) return `<div class="muted" style="font-size:.7rem;margin:6px 0">🔒 Entrega en vivo con lentes Meta para inversionistas: plan Premium · <button class="rb-link" type="button" data-rb="planes"><u>ver planes</u></button></div>`;
    const op = t.op || {}, cod = t.codigo, canal = twCanal(t);
    if (!canal) return `<details class="rb-det rb-vivo"><summary>🔴 Transmitir la entrega en vivo (lentes Meta → Twitch)</summary>
      <div class="muted" style="font-size:.7rem">El inversionista la ve en directo y el video queda como prueba de entrega.</div>
      <div class="rb-row"><input class="rb-in" id="rbTw-${esc(cod)}" placeholder="Tu canal de Twitch (ej: pjanic_entregas)" style="flex:1"><button class="btn small rb-oro" type="button" data-rb="tw-guardar" data-c="${esc(cod)}">Guardar</button></div></details>`;
    const player = `https://player.twitch.tv/?channel=${encodeURIComponent(canal)}&parent=${encodeURIComponent(location.hostname)}&muted=true`;
    return `<div class="rb-vivo ${op.en_vivo ? "on" : ""}"><div class="rb-env"><b>${op.en_vivo ? '<i class="rb-luz rojo"></i> EN VIVO' : "🔴 Entrega en vivo"}</b><a class="muted" style="font-size:.7rem" href="https://www.twitch.tv/${encodeURIComponent(canal)}" target="_blank" rel="noopener">twitch.tv/${esc(canal)}</a></div>
      ${op.en_vivo ? `<div class="rb-tw"><iframe src="${player}" allowfullscreen loading="lazy" title="Twitch"></iframe></div>
        <div class="rb-row"><button class="btn small" type="button" data-rb="tw-fin" data-c="${esc(cod)}">⏹ Terminé la transmisión</button></div>`
      : `<div class="muted" style="font-size:.7rem">1) Ponte los Ray-Ban Meta · 2) en la app de Twitch: Crear → transmitir con los lentes (si tu app aún no lo tiene, transmite con la cámara del celular) · 3) toca el botón: el inversionista recibe el aviso con el link.</div>
        <div class="rb-row"><button class="btn rb-oro" type="button" data-rb="tw-inicio" data-c="${esc(cod)}" style="flex:1">🔴 Empezar en vivo</button><button class="btn small" type="button" data-rb="tw-cambiar" data-c="${esc(cod)}">Cambiar canal</button></div>`}
      ${!op.en_vivo && op.vivo_desde ? `<label class="rb-lab">🎞 Link del video guardado (prueba de entrega)<input class="rb-neg-in" data-campo="video_prueba" data-c="${esc(cod)}" value="${esc(op.video_prueba || "")}" placeholder="https://www.twitch.tv/videos/..."></label>
        <a class="btn small" href="https://dashboard.twitch.tv/u/${encodeURIComponent(canal)}/content/video-producer" target="_blank" rel="noopener">Buscar el video en Twitch</a>` : ""}
      ${op.video_prueba ? `<div class="rb-resp nueva">🎞 Prueba de entrega en video: <a href="${esc(op.video_prueba)}" target="_blank" rel="noopener">ver</a></div>` : ""}</div>`;
  }
  function tarjetaEj(t) {
    const op = t.op || {}, inf = op.informe || {}, et = op.etapa || "operacion", cod = t.codigo;
    const F = (R.fichas || {})[cod]; if (!F && !(R._pidiendo || {})[cod]) setTimeout(() => cargarDocs(cod), 0);
    const prods = (inf.productos || []).length ? inf.productos : (F?.productos || []);
    const estimado = inf.compras || null, compra = op.precio_acordado || null;
    const dif = estimado && compra ? estimado - compra : null;
    const telf = (n) => String(n || "").replace(/[^\d+]/g, "");
    const waN = (n) => { let d = String(n || "").replace(/\D/g, ""); if (d.length === 9 && d[0] === "9") d = "56" + d; if (d.length === 8) d = "569" + d; return d.length >= 10 ? d : ""; };
    const msgProv = `Hola, le escribo de ${(empresaActual() || {}).razon_social || "nuestra empresa"}. Necesito cotización con factura de:\n${prods.map((x) => `- ${x.cantidad ?? ""} ${x.nombre}`).join("\n")}\nEntrega en ${F?.direccion || inf.direccion || ""}. ¿Precio, stock y plazo? Gracias.`;
    const campo = (k, lab, v, ph, num) => `<label class="rb-lab">${lab}<input class="rb-neg-in" data-campo="${k}" data-c="${esc(cod)}" value="${esc(v ?? "")}" placeholder="${esc(ph || "")}" ${num ? 'inputmode="numeric"' : ""}></label>`;
    let cuerpo = "";
    const comp = inf.comprador || {};
    const msgCli = `Estimado/a ${comp.nombre || ""}, le escribimos por la orden de compra ${inf.oc || op.oc || ""} (${cod}) · ${t.nombre || ""}. ${op.incidencia ? op.incidencia + ". " : ""}Le proponemos entregar el ${op.plazo_fecha ? new Date(op.plazo_fecha + "T12:00").toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" }) : "(nueva fecha)"}. Quedamos atentos para confirmar. Saludos, ${(empresaActual() || {}).razon_social || ""}`;
    const plazoBox = !op.plazo_fecha ? `<div class="rb-plazo nuevo"><div class="rb-sec" style="margin-top:0">⏱ Primero: ¿en qué fecha entregas?</div>
        <div class="muted" style="font-size:.72rem">Pregunta el plazo al proveedor y comprométete. Cumplir tu palabra es lo más importante.</div>
        <label class="rb-lab">Fecha comprometida de entrega<input type="date" class="rb-neg-in" data-campo="plazo_fecha" data-c="${esc(cod)}"></label>
        ${campo("plazo_nota", "Qué te dijo el proveedor", op.plazo_nota, "Ej: tiene stock, despacha en 48 h")}</div>`
      : `<div class="rb-plazo ${diasPlazo(op.plazo_fecha) < 0 ? "tarde" : diasPlazo(op.plazo_fecha) <= 1 ? "pronto" : ""}"><div class="rb-env"><b>⏱ Entregas el ${esc(new Date(op.plazo_fecha + "T12:00").toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short" }))}</b><span>${textoPlazo(op.plazo_fecha)}</span></div>
        ${op.plazo_nota ? `<div class="muted" style="font-size:.72rem">${esc(op.plazo_nota)}</div>` : ""}
        ${op.incidencia ? `<div style="font-size:.74rem;color:#ffd88a;margin-top:4px">⚠ ${esc(op.incidencia)}</div>` : ""}
        <details class="rb-det"><summary>⚠ ¿Problema con el plazo o el stock? Avisar al cliente</summary>
          ${campo("incidencia", "Qué pasó", op.incidencia, "Ej: el proveedor no tiene stock hasta el lunes")}
          <label class="rb-lab">Nueva fecha<input type="date" class="rb-neg-in" data-campo="plazo_fecha" data-c="${esc(cod)}" value="${esc(op.plazo_fecha)}"></label>
          <div class="rb-row">${comp.telefono ? `<a class="btn small" href="tel:${esc(String(comp.telefono).replace(/[^\d+]/g, ""))}">📞 Llamar a ${esc(comp.nombre || "cliente")}</a>` : ""}
            ${comp.telefono ? `<a class="btn small" href="https://wa.me/${(() => { let d = String(comp.telefono).replace(/\D/g, ""); if (d.length === 9) d = "56" + d; return d; })()}?text=${encodeURIComponent(msgCli)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
            ${comp.email ? `<a class="btn small" href="mailto:${esc(comp.email)}?subject=${encodeURIComponent("OC " + (inf.oc || "") + " · plazo de entrega")}&body=${encodeURIComponent(msgCli)}">✉ Correo</a>` : ""}
            <button class="btn small" type="button" data-rb="cp" data-v="${esc(msgCli)}">Copiar mensaje</button></div>
          ${!comp.telefono && !comp.email ? `<div class="muted" style="font-size:.7rem">Sin contacto del comprador en el informe: búscalo en la OC.</div>` : ""}</details></div>`;
    const E = etEj(t), k = cuentasDe(t), dir = lugarDe(t) || F?.direccion || inf.direccion || "", z = zonaMk(dir);
    const enStgo = /metropolitana/i.test(sinTilde(dir)) || (z.slug === "santiagocl" && !/valparaiso|vina|quilpue|villa alemana|san antonio|quillota|los andes|rancagua|o'?higgins|machali|san fernando|santa cruz|rengo/.test(sinTilde(dir)));
    const empN = (empresaActual() || {}).razon_social || "nuestra empresa";
    const lineas = queComprar(t).map((x) => `- ${x.cantidad ?? ""} ${x.unidad || ""} ${x.que}${x.detalle ? " (" + String(x.detalle).slice(0, 140) + ")" : ""}`).join("\n");
    const ocN = op.oc_codigo || (String(op.oc || "").includes("-") ? op.oc : "");
    const docOC = (op.docs || []).filter((d) => d.tipo === "oc").pop();
    const verOC = docOC ? `<button class="btn small rb-oro" type="button" data-rb="neg-doc" data-c="${esc(cod)}" data-id="${esc(docOC.id)}">📄 OC ${esc(ocN)} en PDF</button>`
      : ocN ? `<a class="btn small" href="https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=${encodeURIComponent(ocN)}" target="_blank" rel="noopener">📄 Ver OC ${esc(ocN)}</a><span class="muted" style="font-size:.6rem;display:block">⟳ el robot está bajando el PDF</span>`
      : `<a class="btn small" href="${portalDe(cod)}" target="_blank" rel="noopener">📄 Ver la compra</a>`;
    const resp = op.respuestas || [];
    const cliResp = resp.filter((r) => r.quien !== "proveedor");
    const bloqueCliente = cliResp.length ? `<details class="rb-det" style="margin:6px 0"><summary>📨 El comprador escribió · ${cliResp.length} mensaje${cliResp.length > 1 ? "s" : ""} <span class="muted">(toca para ver)</span></summary>${cliResp.slice(-3).reverse().map((r) => `<div class="rb-resp ${r.visto ? "" : "nueva"}"><b>${esc(r.de_nombre || r.de)}</b> · ${esc(hace(r.t))}<div>${esc(r.resumen || r.asunto || "")}</div>${r.pide ? `<div class="muted">Pide: ${esc(r.pide)}</div>` : ""}</div>`).join("")}</details>` : "";
    const lista = `<div class="rb-comprar"><div class="rb-env"><b>🛒 LO QUE HAY QUE ${queComprar(t).some((x) => x.tipo === "servicio") ? "CONTRATAR" : "COMPRAR"}</b>${verOC}</div>
      ${inf.proyecto?.resumen ? `<div class="rb-proy">🎯 <b>El proyecto:</b> ${esc(inf.proyecto.resumen)}${inf.proyecto.rubro ? `<div class="muted">Lo hace todo: ${esc(inf.proyecto.rubro)} · un solo proveedor, un solo pago</div>` : ""}</div>` : ""}
      ${queComprar(t).map((x) => `<div class="rb-qc"><span class="n">${esc(x.cantidad ?? "")}<small>${esc(x.unidad || "")}</small></span><div><b>${esc(x.que)}</b>${x.tipo ? ` <span class="rb-cp">${x.tipo === "servicio" ? "🛠 servicio" : "📦 producto"}</span>` : ""}
        ${x.detalle ? `<div class="muted">${esc(String(x.detalle).slice(0, 180))}</div>` : ""}${x.ojo ? `<div class="rb-ojo">👁 ${esc(x.ojo)}</div>` : ""}</div></div>`).join("")}
      ${!(inf.que_comprar || []).length ? `<div class="muted" style="font-size:.66rem">⟳ El robot está interpretando la OC como experto del rubro…</div>` : ""}</div>`;
    const etapaHTML = (E) => { let cuerpoS = "";
    if (E === "operacion") {
      const C = candsDe(t), cont = op.contactados || {}, cots = op.cotizaciones || {}, desc = op.descartados || {};
      const hechos = C.filter((o) => cont[o.k]).length, meta = 4;
      const conMail = C.filter((o) => o.email && !cont[o.k] && !desc[o.k]);
      const ord = [...C].sort((a, b) => (desc[a.k] ? 1 : 0) - (desc[b.k] ? 1 : 0) || (daDe(t, b) ?? -1e12) - (daDe(t, a) ?? -1e12));
      const tarj = (o) => { const c = cont[o.k], q = cots[o.k], r = resp.filter((x) => x.k === o.k).pop(), u = daDe(t, o), pct = u != null && k.ventaN ? u / k.ventaN : null;
        const ver = u == null ? "" : pct >= 0.08 ? `<b class="rb-vivo-t">✅ DA +${clp(u)} (${Math.round(pct * 100)}%)</b>` : u > 0 ? `<b style="color:#f5cf6b">⚠ justo +${clp(u)}</b>` : `<b class="rb-neg-t">❌ NO DA ${clp(u)}</b>`;
        return `<div class="rb-op ${r ? "respondio" : c ? "on" : ""} ${desc[o.k] ? "fuera" : ""}"><div class="rb-env"><b>${r ? '<i class="rb-luz"></i>' : c ? "✅ " : ""}${esc(o.proveedor)}${chipLocal(o)}</b>${ver || (o.total_con_iva ? `<span class="muted" style="font-size:.7rem">IA ~${clp(o.total_con_iva)}</span>` : "")}</div>
          ${r ? `<div class="rb-resp nueva">📩 <b>Respondió</b> ${esc(hace(r.t))}: ${esc(r.resumen || "")}${r.precio ? ` · <b>${clp(r.precio)}</b>` : ""}${r.plazo ? ` · ${esc(r.plazo)}` : ""}${r.despacha ? " · 🚚 despacha" : ""}${r.cuenta ? " · 🏦 mandó su cuenta" : ""}</div>` : ""}
          <div class="rb-row">${o.email ? botonMail(cod, o, c) : ""}
            ${telNum(o.telefono) ? `<a class="btn small" href="tel:${esc(telNum(o.telefono))}" data-rb="ej-contacto" data-c="${esc(cod)}" data-k="${esc(o.k)}" data-n="${esc(o.proveedor)}" data-via="llamada">📞</a>` : ""}
            ${waNum(o.telefono) ? `<a class="btn small" href="https://wa.me/${waNum(o.telefono)}?text=${encodeURIComponent(cuerpoCot(t, o))}" target="_blank" rel="noopener" data-rb="ej-contacto" data-c="${esc(cod)}" data-k="${esc(o.k)}" data-n="${esc(o.proveedor)}" data-via="whatsapp">💬</a>` : ""}
            ${o.web ? `<a class="btn small" href="${esc(o.web)}" target="_blank" rel="noopener">🌐</a>` : ""}</div>
          ${c && !r && c.estado !== "rebotó" ? `<div class="muted" style="font-size:.68rem">${c.via === "correo" ? (c.estado === "en_cola" ? "📤 saliendo por tu Gmail…" : c.estado === "error" ? "⚠ no salió: " + esc(/ascii|codec/.test(c.error || "") ? "el correo del PC está mal configurado (panel → 📧 Correo)" : c.error || "") : "📤 correo enviado") : c.via === "llamada" ? "📞 llamado" : c.via === "marketplace" ? "🛒 Marketplace" : "💬 WhatsApp"} ${esc(hace(c.t))} · esperando respuesta</div>` : ""}
          ${(() => { const _cb = chatBox(t, o); return _cb ? `<details class="rb-det"><summary>💬 Conversación con ${esc((o.proveedor || "").split(" ")[0])}</summary>${_cb}</details>` : ""; })()}
          <label class="rb-lab" style="margin-top:4px">💲 Precio que te dio (total con IVA)<input class="rb-cot-in" inputmode="numeric" data-c="${esc(cod)}" data-k="${esc(o.k)}" data-n="${esc(o.proveedor)}" value="${q ? Number(q.v).toLocaleString("es-CL") : ""}" placeholder="${o.total_con_iva ? Number(o.total_con_iva).toLocaleString("es-CL") : "Ej: 850.000"}"></label>
          ${(q || r) && !desc[o.k] ? ((op.cerrados || {})[o.k]
            ? `<div class="rb-cerraste"><span>✅ Cerrado con ${esc(o.proveedor.split(" ")[0])} · <b>${clp(op.cerrados[o.k].precio)}</b></span><button class="btn small" type="button" data-rb="ej-descerrar" data-c="${esc(cod)}" data-k="${esc(o.k)}">Quitar</button></div>`
            : `<div class="rb-cerraste"><span>🤝 ¿Cerraste con ${esc(o.proveedor.split(" ")[0])}?</span><button class="btn small rb-oro" type="button" data-rb="ej-cerre" data-c="${esc(cod)}" data-k="${esc(o.k)}">Sí, cerré</button><button class="btn small" type="button" data-rb="ej-descartar" data-c="${esc(cod)}" data-k="${esc(o.k)}">No</button></div>`) : ""}</div>`; };
      cuerpoS = (op.etapa === "previa" ? `<div class="rb-sug" style="border-color:#5ef0b0">📞 <b>Aún sin OC:</b> vas 1°. Adelanta precios y stock con un toque, sin comprar todavía.</div>` : "") + bloqueCliente + `
      <div class="rb-mision"><div class="rb-env"><b>🔎 El robot cotiza con ${meta} proveedores por ti</b><b>${Math.min(hechos, meta)}/${meta}</b></div>
        <div class="rb-barra"><i style="width:${Math.min(100, hechos / meta * 100)}%"></i></div>
        ${conMail.length ? `<button class="btn rb-oro rb-big-btn" type="button" data-rb="ej-mail-todos" data-c="${esc(cod)}">📨 Que el robot les pida precio (${conMail.length}) · 1 toque</button>` : ""}
        <div class="muted" style="font-size:.7rem">${R.mailPC ? "El robot escribe y envía desde tu Gmail con la descripción exacta. Cuando respondan se enciende la luz 🟢 y lee el precio solo — tú no pides nada." : "Conecta el correo en el panel del PC (📧 Correo) para que el robot cotice y lea las respuestas solo."}</div></div>
      ${ord.map(tarj).join("") || `<div class="muted" style="font-size:.74rem">⟳ El robot está buscando proveedores… mientras, agrega uno o búscalo en Marketplace.</div>`}
      ${(() => { const cz = op.cerrados || {}, ks = Object.keys(cz); if (!ks.length) return ""; const tot = ks.reduce((s, kk) => s + (Number(cz[kk].precio) || 0), 0);
        return `<div class="rb-sug" style="border-color:#5ef0b0;margin-top:8px">🤝 <b>${ks.length} proveedor${ks.length > 1 ? "es" : ""} en esta misión</b> · ${ks.length > 1 ? "suman " : ""}<b>${clp(tot)}</b>${ks.length > 1 ? `<div class="muted" style="font-size:.7rem;margin-top:2px">${ks.map((kk) => cz[kk].proveedor.split(" ")[0] + " " + clp(cz[kk].precio)).join("  +  ")}</div>` : ""}
          <button class="btn rb-oro rb-big-btn" type="button" data-rb="ej-etapa" data-e="pago" data-c="${esc(cod)}" style="margin-top:6px">✅ Listo, ir a pagar ${clp(tot)}</button></div>`; })()}
      <details class="rb-det" ${C.length < 2 ? "open" : ""}><summary>➕ Agregar proveedor</summary>
        <label class="rb-lab">Nombre<input class="rb-in" id="rbPxN-${esc(cod)}" placeholder="Ej: Ferretería Castro"></label>
        <div class="rb-row"><label class="rb-lab" style="flex:1">Teléfono<input class="rb-in" id="rbPxT-${esc(cod)}" inputmode="tel" placeholder="+56 9 ..."></label><label class="rb-lab" style="flex:1">Correo<input class="rb-in" id="rbPxE-${esc(cod)}" inputmode="email" placeholder="ventas@..."></label></div>
        <button class="btn small rb-oro" type="button" data-rb="ej-prov-extra" data-c="${esc(cod)}">➕ Agregar a la misión</button></details>
      ${bloqueMk4(t)}
      <div class="rb-row"><button class="btn small" type="button" data-rb="cp" data-v="${esc(cuerpoCot(t, {}))}">📋 Copiar mensaje para Marketplace / WhatsApp</button></div>`;
    } else if (E === "pago") {
      const monto = (Number(op.precio_acordado) || 0);
      const datos = `Pago negocio ${cod}\nProveedor: ${op.proveedor || ""}\nMonto: ${clp(monto)}\n${op.banco_proveedor || "(faltan los datos de la cuenta)"}`;
      const docs = op.docs || [], comp = docs.filter((d) => d.tipo === "comprobante").pop();
      cuerpoS = `<div class="rb-sec">💸 Pagar a ${esc(op.proveedor || "proveedor")}</div>
      <div class="rb-pagar"><div class="rb-env"><span>Monto a transferir</span><b style="font-size:1.25rem">${clp(monto)}</b></div>
        <div class="muted" style="font-size:.74rem;white-space:pre-line">${op.banco_proveedor ? "🏦 " + esc(op.banco_proveedor) : "🏦 Falta su cuenta corriente para transferir."}</div></div>
      ${!op.banco_proveedor ? `<div class="rb-row">${op.proveedor_email ? `<button class="btn small rb-oro" type="button" data-rb="ej-mail-tipo" data-tipo="banco" data-c="${esc(cod)}">📨 Pedirle sus datos de transferencia</button>` : ""}
        ${waNum(op.proveedor_tel) ? `<a class="btn small" href="https://wa.me/${waNum(op.proveedor_tel)}?text=${encodeURIComponent(`Hola, confirmamos la compra ${cod} por ${clp(monto)}. ¿Me envías los datos de tu cuenta corriente (banco, tipo, número, RUT, titular y correo) para transferir? Gracias.`)}" target="_blank" rel="noopener">💬 Pedir por WhatsApp</a>` : ""}</div>` : ""}
      ${campo("banco_proveedor", "Datos de transferencia del proveedor", op.banco_proveedor, "Banco · tipo · N° cuenta · RUT · titular · correo")}
      <div class="rb-row"><button class="btn small" type="button" data-rb="cp" data-v="${esc(datos)}">📋 Copiar datos para transferir</button>
        ${op.pedido_transferencia ? `<span class="muted" style="font-size:.72rem">🔔 Inversionista avisado ${op.transferido ? "· ✅ pagado" : ""}</span>` : `<button class="btn small rb-oro" type="button" data-rb="ej-pedir-pago" data-c="${esc(cod)}">🔔 Avisar al inversionista: paga ${clp(monto)}</button>`}</div>
      ${campo("inversionista_tel", "WhatsApp del inversionista", op.inversionista_tel, "+56 9 ...")}
      <div class="muted" style="font-size:.68rem">🔐 El pago lo autoriza solo una persona: el dueño, desde su banco. La app deja todo listo y guarda el comprobante.</div>
      <div class="rb-row" style="margin-top:6px"><button class="btn small ${comp ? "rb-oro" : ""}" type="button" data-rb="neg-subir" data-tipo="comprobante" data-c="${esc(cod)}">${comp ? "✓ Comprobante subido" : "📎 Subir comprobante de pago"}</button>
        ${comp && op.proveedor_email ? `<button class="btn small" type="button" data-rb="ej-mail-tipo" data-tipo="comprobante" data-c="${esc(cod)}">📨 Enviar comprobante al proveedor</button>` : ""}</div>
      <button class="btn rb-oro rb-big-btn" type="button" data-rb="ej-etapa" data-e="transporte" data-d="proveedor_pagado" data-c="${esc(cod)}">✅ Pagado → Despacho</button>`;
    } else if (E === "transporte") {
      const servicio = queComprar(t).some((x) => x.tipo === "servicio");
      const modo = op.despacho_modo || (servicio ? "servicio" : "proveedor");
      const oc = t.oc_compra || {}, contacto = [oc.contacto, oc.fono, oc.mail].filter(Boolean).join(" · ") || op.entrega_contacto || "";
      const chip = (m, txt) => `<button type="button" class="${modo === m ? "on" : ""}" data-rb="ej-modo" data-m="${m}" data-c="${esc(cod)}">${txt}</button>`;
      const km = Number(op.km) || 0, tarifa = enStgo && km ? km * TARIFA_KM_STGO : null;
      const zonaFlete = z.slug ? `https://www.facebook.com/marketplace/${z.slug}/search/?query=${encodeURIComponent("fletes")}` : `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent("flete " + (z.comuna || ""))}`;
      const msgFlete = `Hola, necesito un flete para un trabajo de ${empN}:\n• Retiro: ${op.origen_flete || op.proveedor || "(dirección del proveedor)"}\n• Entrega: ${dir}${op.plazo_fecha ? "\n• Fecha: " + op.plazo_fecha : ""}\n• Carga:\n${lineas}\n¿Estás disponible y cuánto me cobras? El receptor debe firmar la guía de despacho y me mandas la foto. Gracias.`;
      cuerpoS = `<div class="rb-sec">🚚 ¿Cómo llega al cliente?</div>
      <div class="rb-etapas rb-modos">${chip("servicio", "🏭 El proveedor hace todo")}${chip("proveedor", "🚚 El proveedor despacha")}${chip("flete", "🛻 Contrato flete")}</div>
      <div class="rb-kv"><span>📍 <b>${esc(dir || "sin dirección")}</b></span>${contacto ? `<span>👤 ${esc(contacto)}</span>` : ""}</div>
      ${!dir || !contacto ? `<div class="rb-row">${(oc.mail || inf.comprador?.email) ? `<button class="btn small rb-oro" type="button" data-rb="ej-mail-tipo" data-tipo="entrega" data-c="${esc(cod)}">📨 Pedir datos de entrega al cliente</button>` : ""}</div>` : ""}
      ${campo("entrega_contacto", "Quién recibe (nombre · teléfono)", op.entrega_contacto || contacto, "Ej: Juan Pérez · +56 9 …")}
      ${modo === "flete" ? `${campo("origen_flete", "Dónde se retira", op.origen_flete, "Ej: Av. Matta 1234, Santiago")}
        ${campo("km", "Kilómetros del viaje", op.km || "", "Ej: 18", 1)}
        ${enStgo ? `<div class="rb-sug" style="border-color:#f5cf6b">📍 Región Metropolitana: <b>${clp(TARIFA_KM_STGO)}/km</b>${km ? ` → <b>${clp(tarifa)}</b> por ${km} km` : ""}. Ofrécele esa tarifa a tu fletero.</div>`
          : `<div class="rb-sug" style="border-color:#7c4dff">🧭 Región: busca fletes locales en Marketplace y mándales el trabajo.</div>`}
        <div class="rb-row"><a class="btn small rb-oro" href="${zonaFlete}" target="_blank" rel="noopener">🛒 Fletes en Marketplace</a><a class="btn small" href="https://wa.me/?text=${encodeURIComponent(msgFlete)}" target="_blank" rel="noopener">💬 Mandar el trabajo</a><button class="btn small" type="button" data-rb="cp" data-v="${esc(msgFlete)}">📋 Copiar</button></div>`
        : `<div class="rb-row">${op.proveedor_email ? `<button class="btn small rb-oro" type="button" data-rb="ej-mail-tipo" data-tipo="${modo === "servicio" ? "servicio" : "despacho"}" data-c="${esc(cod)}">📨 ${modo === "servicio" ? "Coordinar el servicio" : "Pedirle que despache al cliente"} (con los datos de la OC)</button>` : ""}
          ${waNum(op.proveedor_tel) ? `<a class="btn small" href="https://wa.me/${waNum(op.proveedor_tel)}?text=${encodeURIComponent(textoEntrega(t, modo))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}</div>
          <div class="muted" style="font-size:.7rem">${modo === "servicio" ? "💎 Lo mejor: le pagas al proveedor y él hace todo. Tú cobras." : "💎 Lo ideal: el proveedor despacha directo al cliente con la guía."}</div>`}
      <div class="rb-row"><div style="flex:1">${campo("transportista", modo === "servicio" ? "Quién ejecuta" : "Transporte / empresa", op.transportista, modo === "servicio" ? op.proveedor || "" : "Ej: Starken, Fletes Juan")}</div><div style="flex:1">${campo("transportista_tel", "Teléfono", op.transportista_tel, "+56 9 ...")}</div></div>
      ${modo !== "servicio" ? `<div class="rb-row"><div style="flex:1">${campo("vehiculo", "Vehículo", op.vehiculo, "Camión 3/4, furgón…")}</div><div style="flex:1">${campo("patente", "Patente / N° seguimiento", op.patente, "AB-CD-12")}</div></div>` : ""}
      ${campo("costo_transporte", "Costo del despacho (0 si lo incluye el proveedor)", op.costo_transporte != null ? Number(op.costo_transporte).toLocaleString("es-CL") : "", tarifa ? Number(tarifa).toLocaleString("es-CL") : "0", 1)}
      <button class="btn rb-oro rb-big-btn" type="button" data-rb="ej-etapa" data-e="despacho" data-c="${esc(cod)}">${modo === "servicio" ? "▶ Servicio en curso" : "🛣 Despachado"} → En trayecto</button>`;
    } else if (E === "despacho") {
      const msgT = `Hola ${op.transportista || ""}, te envío la guía de despacho del pedido ${cod} para ${(t.oc_compra?.organismo || t.organismo || "").slice(0, 60)} (${dir}). Que la firmen con nombre, RUT y fecha en "Recepción conforme" y me mandas la foto. ¡Gracias!`;
      const servi = (op.despacho_modo || (queComprar(t).some((x) => x.tipo === "servicio") ? "servicio" : "")) === "servicio";
      cuerpoS = `<div class="rb-trayecto"><i class="rb-luz grande"></i><div><b>${servi ? "SERVICIO EN CURSO" : "EN TRAYECTO"}</b><div class="muted">${esc(op.transportista || op.proveedor || "")}${op.vehiculo ? " · " + esc(op.vehiculo) : ""}${op.patente ? " · " + esc(op.patente) : ""}</div></div></div>
      <div class="rb-kv"><span>Despacho <b>${clp(op.costo_transporte || 0)}</b></span>${op.transportista_tel ? `<span><a href="tel:${esc(telNum(op.transportista_tel))}">📞 ${esc(op.transportista_tel)}</a></span>` : ""}<span>📍 ${esc(dir)}</span>${op.entrega_contacto ? `<span>👤 ${esc(op.entrega_contacto)}</span>` : ""}</div>
      <div class="rb-row"><button class="btn rb-oro" type="button" data-rb="ej-doc" data-t="guia" data-c="${esc(cod)}">📄 Guía + recepción conforme</button><button class="btn" type="button" data-rb="ej-doc" data-t="factura" data-c="${esc(cod)}">🧾 Factura (borrador)</button></div>
      <div class="rb-row"><a class="btn small" href="https://wa.me/${waNum(op.transportista_tel) || ""}?text=${encodeURIComponent(msgT)}" target="_blank" rel="noopener">💬 Mandar la guía al transportista</a></div>
      <details class="rb-det"><summary>🏛 Emitir en el SII (documento válido)</summary>${docsSIIg(t).replace(/<button class="btn rb-firmar"[^>]*data-e="despacho"[\s\S]*?<\/button>/, "")}</details>
      ${bloqueVivo(t)}
      <button class="btn rb-oro rb-big-btn" type="button" data-rb="ej-etapa" data-e="entrega" data-c="${esc(cod)}">📦 Llegó al cliente → Recepción</button>`;
    } else if (E === "entrega") { const docs = op.docs || [], hay = (tp) => docs.some((d) => d.tipo === tp);
      cuerpoS = `<div class="rb-sec">📦 Recepción conforme</div>
      <div class="muted" style="font-size:.72rem">Pide la foto de la guía firmada (nombre, RUT, fecha). Con eso cobras y cierras.</div>
      <div class="rb-row"><div style="flex:1">${campo("recibio_nombre", "Recibió", op.recibio_nombre, "Nombre")}</div><div style="flex:1">${campo("recibio_rut", "RUT", op.recibio_rut, "12.345.678-9")}</div></div>
      <div class="rb-row"><button class="btn small ${hay("guia") ? "rb-oro" : ""}" type="button" data-rb="neg-subir" data-tipo="guia" data-c="${esc(cod)}">${hay("guia") ? "✓" : "📸"} Guía firmada</button>
        <button class="btn small ${hay("factura") ? "rb-oro" : ""}" type="button" data-rb="neg-subir" data-tipo="factura" data-c="${esc(cod)}">${hay("factura") ? "✓" : "🧾"} Factura emitida</button></div>
      <button class="btn rb-oro rb-big-btn" type="button" data-rb="neg-subir" data-tipo="foto" data-cerrar="1" data-c="${esc(cod)}">🥇 Foto de la entrega y cerrar en oro</button>
      <div class="muted" style="font-size:.68rem">Al cerrar, el inversionista recibe «negocio OK» y su Excel se rehace con los costos reales.</div>
      ${bloqueVivo(t)}`;
    } else cuerpoS = eerrNegocio(t);
    return cuerpoS; };
    // 📦 el negocio en CAJAS: cada paso se abre al tocarlo; abierta solo la del paso en que vas
    const ORDEN = ["operacion", "pago", "transporte", "despacho", "entrega", "cerrado"], iE = ORDEN.indexOf(E);
    const est = (e) => (ORDEN.indexOf(e) < iE ? "hecho" : e === E ? "ahora" : "luego");
    const caja = (id, titulo, sub, estado, html, def) => { const key = cod + ":" + id, ab = (R.cajaAb || {})[key] ?? def;
      return `<details class="rb-caja ${estado}" data-caja="${esc(key)}" ${ab ? "open" : ""}><summary><span class="rb-caja-i">${estado === "hecho" || estado === "oro" ? "✓" : estado === "ahora" ? "●" : "○"}</span><span class="rb-caja-t">${titulo}</span><span class="rb-caja-s">${sub}</span></summary><div class="rb-caja-b">${html}</div></details>`; };
    const Cn = candsDe(t), contN = Cn.filter((o) => (op.contactados || {})[o.k]).length, respN = new Set((op.respuestas || []).filter((r) => r.quien === "proveedor" || r.precio).map((r) => r.k)).size;
    const X = calcNeg(t), elegido = op.precio_acordado && op.proveedor;
    const oroProv = elegido ? `<div class="rb-prov-oro"><div class="rb-env"><b>🥇 ${esc(op.proveedor)}</b><b>${clp(op.precio_acordado)}</b></div>
        <div class="muted" style="font-size:.72rem">${op.banco_proveedor ? "🏦 " + esc(op.banco_proveedor) : "🏦 falta su cuenta corriente o link de pago"}</div>
        <div class="rb-row">${!op.pedido_transferencia ? `<button class="btn small rb-oro" type="button" data-rb="ej-pedir-pago" data-c="${esc(cod)}">💼 Pedir la inversión: ${clp(X.capital)}</button>` : `<span class="rb-pill verde">${op.transferido ? "✅ pagado" : "🔔 inversionista avisado"}</span>`}</div></div>` : "";
    const cajas = [
      caja("orden", "📋 La orden", `${clp(k.venta)}${op.plazo_fecha ? " · entrega " + esc(new Date(op.plazo_fecha + "T12:00").toLocaleDateString("es-CL", { day: "numeric", month: "short" })) : " · falta fecha"}`, op.plazo_fecha ? "hecho" : "ahora", `<div class="rb-row" style="margin:4px 0 8px">${(() => { const d = (op.docs || []).filter((x) => x.tipo === "oc").pop(); return d ? `<button class="btn small rb-oro" type="button" data-rb="neg-doc" data-c="${esc(cod)}" data-id="${esc(d.id)}">📄 OC de Mercado Público</button>` : ""; })()}${t.pdf ? `<button class="btn small" type="button" data-rb="pdf" data-c="${esc(cod)}">📑 Cómo la ingresé</button>` : ""}${(t.lic_docs || []).slice(-4).map((d) => `<button class="btn small" type="button" data-rb="neg-doc" data-c="${esc(cod)}" data-id="${esc(d.id)}">📎 ${esc((d.nombre || d.tipo).slice(0, 22))}</button>`).join("")}</div>` + lista + plazoBox, !op.plazo_fecha && E === "operacion"),
      caja("links", "🔗 Dónde comprarlo al menor precio", op.precio_acordado ? `compra ${clp(op.precio_acordado)} · ${esc(String(op.proveedor || "").slice(0, 20))}` : "links por ítem · precio real", op.precio_acordado ? "hecho" : est("operacion"), cajaLinks(t), E === "operacion" && !op.precio_acordado),
      caja("prov", "🤝 A quién le compré", elegido ? `🥇 ${esc(String(op.proveedor).slice(0, 22))} · ${clp(op.precio_acordado)}` : `${contN}/${Cn.length} contactados · ${respN} respondieron`, elegido ? "oro" : est("operacion"), `${pagosHTML(t)}${X.compras ? excelVivo(t, X) : ""}<details style="margin-top:8px"><summary class="muted" style="font-size:.76rem;cursor:pointer">Más: pedir cotizaciones a proveedores por correo / WhatsApp</summary>${oroProv + etapaHTML("operacion")}</details>`, E === "operacion" && !!op.plazo_fecha),
      caja("inv", "💼 Inversionista y pago", op.transferido || op.proveedor_pagado ? "✅ pagado" : op.pedido_transferencia ? "🔔 esperando la inversión" : elegido ? "listo para pedir" : "después de elegir proveedor", op.transferido || op.proveedor_pagado ? "oro" : est("pago"), bloqueInversion(t, X) + (elegido ? etapaHTML("pago") : ""), E === "pago"),
      caja("excel", "📊 Excel en vivo", X.compras ? `utilidad ${clp(X.final)} · ${X.fuente}` : "esperando precio", X.compras ? "vivo" : "luego", excelVivo(t, X), false),
      caja("terreno", "🚚 Terreno (en vivo)", E === "despacho" ? (op.en_vivo ? "🔴 transmitiendo" : "en trayecto") : iE > 3 ? "✓ entregado" : "despacho y transmisión", est(E === "despacho" ? "despacho" : "transporte"), E === "despacho" ? etapaHTML("despacho") : etapaHTML("transporte") + bloqueVivo(t), E === "transporte" || E === "despacho"),
      caja("docs", "🧾 Guía, factura y recepción", (op.docs || []).some((d) => d.tipo === "guia") ? "✓ guía firmada" : "guía, factura y firma del cliente", est("entrega"), etapaHTML("entrega"), E === "entrega"),
      caja("fact", "💸 Factoring y reparto", repartoListo(op) ? "🥇 repartido" : op.cobrado ? "💰 llegó la plata · repartir" : op.cerrado ? "esperando el factoring" : "al cerrar", repartoListo(op) || E === "cerrado" ? "oro" : op.cobrado ? "ahora" : "luego", repartoFinal(t, X) + eerrNegocio(t), E === "cerrado" || !!op.cobrado),
    ].join("");
    const negHead = `<div class="rb-env" data-rb="ej-cerrar-card" data-c="${esc(cod)}" style="cursor:pointer"><div style="min-width:0"><div style="font-size:.74rem"><b>${esc(cod)}</b>${ocN ? " · OC " + esc(ocN) : ""} <span class="muted">▲ cerrar</span></div><div class="rb-fnom">${esc(t.nombre || "")}</div>
        <div class="muted" style="font-size:.72rem">${esc(t.oc_compra?.organismo || t.organismo || "")}${dir ? " · " + esc(dir.slice(0, 60)) : ""}</div></div>
        <div style="text-align:right"><div style="font-size:.62rem;opacity:.75">VENTA</div><b>${clp(k.venta)}</b></div></div>`;
    const envoltorio = (cuerpoHtml, pill) => `<div class="rb-neg ${E === "cerrado" ? "cerrado" : ""}">${negHead}${pill ? `<div class="rb-row" style="margin:6px 0"><button class="btn small rb-link" type="button" data-rb="ej-modo" data-m="" data-c="${esc(cod)}">← elegir</button>${pill}</div>` : ""}${cuerpoHtml}</div>`;
    if (!R.ejModo) {
      return `<div class="rb-neg ${E === "cerrado" ? "cerrado" : ""}">${negHead}
        <div class="rb-sec" style="margin-top:8px">¿Qué quieres ver de este negocio?</div>
        <div class="rb-card" data-rb="ej-modo" data-m="simulada" data-c="${esc(cod)}" style="cursor:pointer;border-color:#5aa9ff;background:rgba(90,169,255,.08)">
          <div class="rb-env"><b>🔵 Ejecución simulada</b><span class="muted">la del robot →</span></div>
          <div class="muted" style="font-size:.74rem">Lo que haría yo: me geolocalizo, busco los precios más baratos del producto y armo la ficha completa (Excel en vivo, inversionista, factoring y reparto). ¿Da o no da?</div></div>
        <div class="rb-card" data-rb="ej-modo" data-m="real" data-c="${esc(cod)}" style="cursor:pointer;border-color:#5ef0b0;background:rgba(63,220,138,.08);margin-top:8px">
          <div class="rb-env"><b>🟢 Ejecución real</b><span class="muted">la de ustedes →</span></div>
          <div class="muted" style="font-size:.74rem">Lo que se hizo de verdad: la OC, lo que se compró, la fecha comprometida de entrega y los contactos con el proveedor.</div></div>
        <div class="rb-card" data-rb="ej-modo" data-m="revision" data-c="${esc(cod)}" style="cursor:pointer;border-color:#f5cf6b;background:rgba(245,207,107,.08);margin-top:8px">
          <div class="rb-env"><b>🔍 Revisión</b><span class="muted">simulado vs real →</span></div>
          <div class="muted" style="font-size:.74rem">Lo que hicimos: compara la simulación con lo real, el ahorro o sobrecosto, la utilidad final y si se cumplió el plazo.</div></div></div>`;
    }
    if (R.ejModo === "revision") return envoltorio(ejRevision(t, X), `<span class="rb-pill" style="background:rgba(245,207,107,.15);color:#f5cf6b">🔍 Revisión</span>`);
    if (R.ejModo === "simulada") return envoltorio(ejSimulada(t, X), `<span class="rb-pill" style="background:rgba(90,169,255,.15);color:#5aa9ff">🔵 Simulada</span>`);
    return envoltorio(cajas, `<span class="rb-pill" style="background:rgba(63,220,138,.15);color:#3fdc8a">🟢 Real</span>`);
  }
  // 🔵 Ejecución simulada: la hace el robot (geolocaliza, busca el más barato) y arma la misma ficha
  function ejSimulada(t, X) {
    const op = t.op || {}, inf = op.informe || {}, dir = lugarDe(t) || inf.direccion || "";
    const prods = queComprar(t), r = ratingNeg(X.final);
    const precioItem = (x) => (x.precio_unitario || x.precio || x.valor || null);
    const filas = prods.map((x) => { const pu = precioItem(x); return `<div class="rb-qc"><span class="n">${esc(x.cantidad ?? "")}<small>${esc(x.unidad || "")}</small></span><div><b>${esc(x.que)}</b>${pu ? `<div class="rb-vivo-t" style="font-size:.78rem">más barato ≈ ${clp(pu)} c/u</div>` : `<div class="muted" style="font-size:.68rem">🤖 buscando el más barato geolocalizado…</div>`}</div></div>`; }).join("");
    return `<div class="rb-sug" style="border-color:#5aa9ff">📍 Me geolocalizo en <b>${esc(dir || "la zona de la OC")}</b> y busco en internet los precios más baratos de lo que pide la orden de compra.</div>
      <div class="rb-comprar"><div class="rb-env"><b>🔎 Lo que busco y su precio simulado</b></div>${filas || '<div class="muted">—</div>'}
        <div class="muted" style="font-size:.72rem;margin-top:4px">Costo estimado por el robot: <b>${X.compras ? clp(Math.round(X.compras)) : "buscando…"}</b>${X.fuente ? " · " + esc(X.fuente) : ""}</div></div>
      <div class="rb-card" style="margin-top:8px"><div class="rb-env"><b>${r.emoji} ¿Da o no da?</b><b class="${X.final > 0 ? "rb-vivo-t" : "rb-neg-t"}">${clp(Math.round(X.final))}</b></div><div class="muted" style="font-size:.74rem">${r.txt}</div></div>
      <div class="rb-sec">📊 Excel en vivo (simulado)</div>${excelVivo(t, X)}
      <div class="rb-sec">💼 Inversionista (simulado)</div>${bloqueInversion(t, X)}
      <div class="rb-sec">💸 Factoring y reparto (simulado)</div>${repartoFinal(t, X)}
      <div class="muted" style="font-size:.68rem;margin-top:8px">🚚 Terreno, 🧾 guía y factura se simulan aquí y se activan de verdad en la ejecución real. Esta simulación la ven el inversionista y el ejecutador.</div>`;
  }
  // 🔍 Revisión: compara lo simulado con lo real (ahorro/sobrecosto, utilidad, plazo cumplido)
  function ejRevision(t, X) {
    const op = t.op || {}, inf = op.informe || {}, k = cuentasDe(t), venta = k.venta;
    const costoSim = Number(inf.compras) || null, costoReal = Number(op.precio_acordado) || null;
    const dif = (costoSim != null && costoReal != null) ? costoSim - costoReal : null;
    const prov = op.proveedor || null, r = ratingNeg(X.final);
    const fecha = (d) => d ? new Date((String(d).length <= 10 ? d + "T12:00" : d)).toLocaleDateString("es-CL", { day: "numeric", month: "short" }) : null;
    const plazoOk = op.plazo_fecha && op.cerrado ? (Date.parse(op.cerrado) <= Date.parse(op.plazo_fecha + "T23:59")) : null;
    const fila = (a, v, cls) => `<tr><td>${a}</td><td class="n ${cls || ""}">${v}</td></tr>`;
    return `<div class="rb-card"><div class="rb-sec" style="margin-top:0">🔍 Lo que hicimos</div>
      <table class="rb-copias">
        ${fila("🧾 Venta (OC)", clp(venta))}
        ${fila("🔵 Costo simulado", costoSim != null ? clp(Math.round(costoSim)) : "—")}
        ${fila("🟢 Costo real (acordado)", costoReal != null ? clp(costoReal) : "aún no se cierra")}
        ${dif != null ? fila(dif >= 0 ? "✅ Ahorro vs simulación" : "⚠ Sobrecosto vs simulación", clp(Math.abs(Math.round(dif))), dif >= 0 ? "rb-vivo-t" : "rb-neg-t") : ""}
        ${fila("💰 Utilidad final", clp(Math.round(X.final)), X.final >= 0 ? "rb-vivo-t" : "rb-neg-t")}
      </table>
      <div class="rb-env" style="margin-top:6px"><b>${r.emoji} ${r.txt}</b></div>
      ${prov ? `<div class="muted" style="font-size:.74rem;margin-top:4px">🤝 Proveedor: <b>${esc(prov)}</b></div>` : ""}
      ${op.plazo_fecha ? `<div class="muted" style="font-size:.74rem">⏱ Comprometido: ${fecha(op.plazo_fecha)}${op.cerrado ? " · Cerrado: " + fecha(op.cerrado) : ""}${plazoOk === true ? " · ✅ a tiempo" : plazoOk === false ? " · 🔴 atrasado" : ""}</div>` : ""}
      <div class="muted" style="font-size:.68rem;margin-top:6px">Comparo la simulación (lo que estimé) con lo real (lo que se hizo): así vemos si el negocio salió como se planeó.</div></div>`;
  }
  // 🧮 el Excel del inversionista, en vivo (mismas fórmulas que la planilla: factoring, IVA, impuesto 27 %, comisión y reparto)
  const PARAM_NEG = { factoring: 0.04, impuesto: 0.03, comision: 0.04, aplica_comision: true, julfior: 0.844, inversionista: 0.156, recargo_sin_factura: 0.25, anticipo: 1, transporte: 0, ejecutador: 0.10 };
  function calcNeg(t) {
    const op = t.op || {}, inf = op.informe || {}, p = { ...PARAM_NEG, ...(op.param || {}) };
    const total = Number(t.oc_compra?.total || t.total) || 0;
    const cot = candsDe(t).map((o) => (op.cotizaciones || {})[o.k]?.v).filter(Boolean).sort((a, b) => a - b)[0];
    const compras = Number(op.precio_acordado) || cot || Number(inf.compras) || 0;
    const fuente = op.precio_acordado ? "precio acordado" : cot ? "mejor cotización" : inf.compras ? "estimado" : "sin precio";
    const transporte = Number(op.costo_transporte) || p.transporte || 0;
    const neto = Math.round(total / 1.19), iva = total - neto, factoring = total * p.factoring, ingreso = total - factoring;
    const conFactura = !op.sin_factura;                               // 🧾 sin factura = NO hay IVA crédito (no baja el IVA a pagar)
    const iva_compra = Array.isArray(op.pagos) && op.pagos.length ? op.pagos.reduce((s, x) => s + (x.factura ? (Number(x.monto) || 0) * 0.19 : 0), 0) : conFactura ? compras - compras / 1.19 : 0, iva_pagar = Math.max(0, iva - iva_compra), recargo = 0;
    const impuesto = Math.max(0, neto) * p.impuesto;                  // 🏛 PPM: % sobre la venta neta (no sobre la utilidad)
    const utilidad = ingreso - compras - iva_pagar - recargo - transporte, repartir = utilidad - impuesto;
    const comision = p.aplica_comision ? Math.max(0, repartir) * p.comision : 0, final = repartir - comision;
    const capital = compras * p.anticipo, invGan = final * p.inversionista, ejec = Math.max(0, final) * p.ejecutador, empresa = final - invGan - ejec;
    return { p, total, neto, iva, factoring, ingreso, compras, fuente, conFactura, transporte, iva_compra, iva_pagar, recargo, utilidad, impuesto, repartir, comision, final,
      capital, invGan, invRecibe: capital + invGan, invPct: capital ? invGan / capital : 0, ejec, empresa, jugador: comision };
  }
  // 🔥 ¿qué tan bueno es el negocio? (para saber si vale traer inversores)
  function ratingNeg(v) {
    if (v <= 0) return { emoji: "⛔", txt: "Pierdes — no ofertes", cls: "mal" };
    if (v < 80000) return { emoji: "😕", txt: "Flojo — no vale traer inversores", cls: "mal" };
    if (v < 300000) return { emoji: "🟡", txt: "Normalito", cls: "reg" };
    if (v < 800000) return { emoji: "✅", txt: "Bueno", cls: "ok" };
    if (v < 2000000) return { emoji: "🤑", txt: "Muy bueno", cls: "bien" };
    return { emoji: "🔥", txt: "¡Negocio de fuego!", cls: "fuego" };
  }
  function excelVivo(t, X) {
    if (!X.compras) return `<div class="muted" style="font-size:.74rem">El Excel se llena solo apenas haya un precio de proveedor (cotización o acordado).</div>`;
    const f = (a, v, cls, nota) => `<tr class="${cls || ""}"><td>${a}${nota ? `<small>${nota}</small>` : ""}</td><td class="n">${clp(Math.round(v))}</td></tr>`, pc = (x) => (x * 100).toLocaleString("es-CL", { maximumFractionDigits: 1 }) + "%";
    const _r = ratingNeg(X.final);
    return `<div class="rb-xl"><div class="rb-rating ${_r.cls}">${_r.emoji} <b>${_r.txt}</b><span>${clp(Math.round(X.final))} de utilidad final en este negocio</span></div><div class="rb-env"><b><i class="rb-luz"></i> NEGOCIO</b><span class="muted" style="font-size:.68rem">compras: ${esc(X.fuente)} · se recalcula con cada cambio</span></div>
      <table class="rb-copias">${f("Venta neta", X.neto)}${f("IVA (19 %)", X.iva)}${f("Total OC", X.total, "t")}${f("− Factoring", -X.factoring, "", pc(X.p.factoring))}${f("= Ingreso final", X.ingreso, "t")}
        ${f(X.conFactura ? "− Compras (con factura)" : "− Compras (sin factura)", -X.compras)}${f("− IVA a pagar al SII", -X.iva_pagar, "", X.conFactura ? "débito − crédito" : "sin crédito (sin factura)")}${X.transporte ? f("− Transporte", -X.transporte) : ""}${f("= Utilidad", X.utilidad, "t")}
        ${f("− PPM", -X.impuesto, "", pc(X.p.impuesto) + " de la venta")}${f("= Utilidad a repartir", X.repartir, "t")}${f("− Comisión jugador", -X.comision, "", pc(X.p.comision))}${f("= Utilidad final", X.final, "oro")}</table>
      ${(t.op?.pagos || []).length ? `<div class="muted" style="font-size:.72rem;margin:6px 0">🧾 IVA crédito según cada pago en «A quién le compré»: ${(t.op.pagos || []).map((p2) => `${esc(p2.nombre || "?")} ${p2.factura ? "con" : "sin"} factura`).join(" · ")}</div>` : `<div class="rb-row" style="margin:6px 0"><span class="muted" style="font-size:.72rem;align-self:center">Pago al proveedor:</span><button class="btn small ${X.conFactura ? "rb-oro" : ""}" type="button" data-rb="ej-factura" data-c="${esc(t.codigo)}" data-f="1">🧾 Con factura</button><button class="btn small ${X.conFactura ? "" : "rb-oro"}" type="button" data-rb="ej-factura" data-c="${esc(t.codigo)}" data-f="0">🚫 Sin factura</button><span class="muted" style="font-size:.68rem;align-self:center">· con factura su IVA es crédito y pagas menos IVA al SII</span></div>`}
      ${repartoHTML(t, X, true)}
      <div class="rb-row"><button class="btn small rb-firmar" type="button" data-rb="neg-archivo" data-t="excel" data-c="${esc(t.codigo)}">📊 Descargar la planilla</button><button class="btn small rb-oro" type="button" data-rb="inv-pdf" data-c="${esc(t.codigo)}">📄 PDF para inversionistas</button></div></div>`;
  }
  // 📄 Presentación ejecutiva para inversionistas (PDF descargable): cinta de la planilla, cronología del negocio día a día, pagos con/sin factura, IVA y reparto
  function presentacionInv(t, X) {
    const op = t.op || {}, inf = op.informe || {}, emp = empresaActual() || {}, oc = t.oc_compra || {};
    const f = (n) => (n < 0 ? "−" : "") + "$" + Math.round(Math.abs(n)).toLocaleString("es-CL"), pc = (x) => Math.round(x * 1000) / 10 + " %";
    const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"], MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const fd = (d) => `${DIAS[d.getDay()]} ${d.getDate()} ${MES[d.getMonth()]}`;
    const habil = (d, n) => { const x = new Date(d); let k = 0; while (k < n) { x.setDate(x.getDate() + 1); if (x.getDay() % 6) k++; } return x; };
    const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
    const plazo = op.plazo_fecha ? new Date(op.plazo_fecha + "T12:00") : null;
    const habilAtras = (d, n) => { const x = new Date(d); let k = 0; while (k < n) { x.setDate(x.getDate() - 1); if (x.getDay() % 6) k++; } return x; };
    const prod = plazo && plazo > hoy ? habilAtras(plazo, 2) : habil(hoy, 3);
    const carga = habil(prod, 1), desc = habil(carga, 1), fact = habil(desc, 1), pago = habil(fact, 1), f29 = new Date(fact.getFullYear(), fact.getMonth() + 1, 20, 12), fin = habil(f29, 7);
    const ant = X.compras * (X.p.anticipo ?? 1) * 0.5, saldo = X.compras - ant, prov = typeof op.proveedor === "object" ? op.proveedor?.nombre : op.proveedor;
    const sinF = (op.pagos_sin_factura || []).filter((x) => x && x.monto), sinT = sinF.reduce((a, x) => a + Number(x.monto || 0), 0);
    const pasos = [
      [hoy, op.transferido ? "Pagado el anticipo al proveedor" : "Hoy · se paga el anticipo al proveedor", -ant, `${prov ? "Proveedor " + prov + ". " : ""}50 % de la compra (${f(ant)}). ${X.capital ? "Capital del inversionista: " + f(X.capital) + "." : ""}`],
      [prod, "Producto listo en el proveedor", -saldo, `Se paga el saldo (${f(saldo)}) contra la guía de despacho${op.plazo_fecha ? " · entrega comprometida " + fd(plazo) : ""}.`],
      [carga, "Carga y despacho", 0, `Guía de despacho con el número de OC ${op.oc_codigo || ""}. ${lugarDe(t) || inf.direccion ? "Destino: " + (lugarDe(t) || inf.direccion) + "." : ""}`],
      [desc, "Descarga y recepción conforme", -X.transporte, `Firma de la contraparte técnica de ${oc.organismo || t.organismo || "la institución"}.${X.transporte ? " Transporte: " + f(X.transporte) + "." : ""}`],
      [fact, "Se factura y se cede al factoring", 0, `Factura por ${f(X.total)} con la recepción conforme adjunta.`],
      [pago, "Pagado: el factoring deposita", X.ingreso, `Ingreso final ${f(X.ingreso)} (total − ${pc(X.p.factoring)}).${sinT ? " Se pagan " + f(sinT) + " sin factura (deudas), que bajan la utilidad de " + f(X.final) + " a " + f(X.final - sinT) + "." : ""}`],
      [f29, "F29: IVA e impuesto", -(X.iva_pagar + X.impuesto), `IVA a pagar ${f(X.iva_pagar)} + impuesto ${f(X.impuesto)}.`],
      [fin, "Cierre y reparto", X.final - sinT, `Inversionista recibe ${f(X.invRecibe)} (capital ${f(X.capital)} + ganancia ${f(X.invGan)}, ${pc(X.invPct)}). Ejecutor ${f(X.ejec)}. Empresa ${f(X.empresa)}.`],
    ];
    const K = [["Neto", X.neto], ["IVA", X.iva], ["Total", X.total], ["Factoring " + pc(X.p.factoring), -X.factoring], ["Ingreso final", X.ingreso], ["Compras", -X.compras - X.transporte - sinT], ["Utilidad", X.utilidad - sinT], ["Impuesto", -X.impuesto], ["Utilidad a repartir", X.repartir - sinT], ["Comisión", -X.comision], ["Ut. final", X.final - sinT]];
    const tr = (a, v, b) => `<tr><td>${esc(a)}</td><td class="n${b ? " b" : ""}">${f(v)}</td></tr>`;
    const css = `body{font:13px/1.45 Inter,Arial,sans-serif;color:#121417;background:#fff;margin:0}.pg{max-width:820px;margin:0 auto;padding:22px 24px}h1{font-size:1.4rem;margin:0}.sub{color:#5b6a84;margin:2px 0 14px}.est{display:inline-block;background:#eef1f6;border-radius:999px;padding:3px 10px;font-size:.72rem;font-weight:700}
      .cinta{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:12px 0}.k{border:1px solid #d9dfe9;border-radius:10px;padding:8px 10px}.k small{display:block;color:#5b6a84;font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em}.k b{display:block;font-size:.98rem;margin-top:2px}.k.g b{color:#15803d}.k.r b{color:#c62828}.k.o b{color:#b07d10}
      .bar{height:9px;border-radius:5px;background:#eef1f6;overflow:hidden;display:flex;margin:6px 0 3px}.bar i{display:block;height:100%}.leg{font-size:.68rem;color:#5b6a84}.leg i{display:inline-block;width:8px;height:8px;border-radius:2px;margin:0 3px 0 8px}
      h2{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5b6a84;margin:16px 0 6px}table{width:100%;border-collapse:collapse;font-size:.84rem}td,th{padding:5px 4px;border-bottom:1px solid #e6eaf1;text-align:left;vertical-align:top}th{color:#5b6a84;font-size:.64rem;text-transform:uppercase;letter-spacing:.06em}td.n{text-align:right;white-space:nowrap}td.b{font-weight:700}
      .tl{list-style:none;margin:0;padding:0;position:relative}.tl:before{content:"";position:absolute;left:9px;top:6px;bottom:6px;width:2px;background:#e6eaf1}.tl li{position:relative;padding:0 0 9px 28px;break-inside:avoid}.tl li:before{content:"";position:absolute;left:3px;top:4px;width:11px;height:11px;border-radius:50%;background:#fff;border:2px solid #9aa3b2}.tl li:first-child:before{background:#1ed760;border-color:#1ed760}
      .d{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5b6a84}.t{font-weight:600}.m{font-weight:700}.m.in{color:#15803d}.m.out{color:#c62828}.o{color:#5b6a84;font-size:.78rem}.obs{background:#fff8e6;border-left:3px solid #b07d10;border-radius:6px;padding:7px 10px;font-size:.8rem;margin-top:6px}
      .dos{display:grid;grid-template-columns:1fr 1fr;gap:14px}.foot{color:#5b6a84;font-size:.66rem;margin-top:14px}.bt{position:fixed;right:14px;bottom:14px;display:flex;gap:8px}.bt button{background:#121417;color:#fff;border:0;border-radius:999px;padding:10px 16px;font:700 .85rem Inter,Arial,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}
      @media print{.bt{display:none}.pg{padding:0}}@page{size:A4;margin:12mm}@media(max-width:560px){.cinta{grid-template-columns:repeat(2,1fr)}.dos{grid-template-columns:1fr}}`;
    const base = Math.max(X.total, 1), seg = [[X.compras + X.transporte + sinT, "#3b6fd9"], [X.factoring, "#8a63d2"], [X.iva_pagar + X.impuesto, "#5b7a9f"], [X.comision, "#c08a3a"], [Math.max(X.final - sinT, 0), "#1ed760"]];
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Presentación inversionistas · ${esc(t.codigo)}</title><style>${css}</style></head><body><div class="pg" id="pg">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-end"><div><h1>Caja de la orden de compra</h1><div class="sub"><b>${esc(t.nombre || t.codigo)}</b> · ${esc(oc.organismo || t.organismo || "")}${op.oc_codigo ? " · OC " + esc(op.oc_codigo) : " · " + esc(t.codigo)} · ${esc(emp.razon_social || "")}</div></div><span class="est">● ${op.cerrado ? "Cerrado" : op.etapa ? "En ejecución · " + esc(op.etapa) : "Proyección"} · ${fd(hoy)}</span></div>
      <div class="sub" style="margin-top:-8px">🎮 Cotizó <b>${esc(t.persona || "—")}</b> · 🛠 Ejecuta <b>${esc(op.ejecutor_nombre || op.responsable || "—")}</b> · 💼 Invierte <b>${esc(op.inversionista_nombre || "—")}</b></div>
      <div class="cinta">${K.map((k) => `<div class="k ${/Ut\. final|Utilidad$/.test(k[0]) ? (k[1] >= 0 ? "g" : "r") : /Ingreso/.test(k[0]) ? "o" : k[1] < 0 ? "r" : ""}"><small>${esc(k[0])}</small><b>${f(k[1])}</b></div>`).join("")}</div>
      <div class="bar">${seg.map((x) => `<i style="width:${(x[0] / base * 100).toFixed(2)}%;background:${x[1]}"></i>`).join("")}</div>
      <div class="leg"><i style="background:#3b6fd9"></i>Compras<i style="background:#8a63d2"></i>Factoring<i style="background:#5b7a9f"></i>Impuestos<i style="background:#c08a3a"></i>Comisión<i style="background:#1ed760"></i>Utilidad final</div>
      <h2>Cronología del negocio</h2><ul class="tl">${pasos.map((p) => `<li><div class="d">${fd(p[0])}</div><div class="t">${esc(p[1])} ${p[2] ? `<span class="m ${p[2] > 0 ? "in" : "out"}">${f(p[2])}</span>` : ""}</div><div class="o">${esc(p[3])}</div></li>`).join("")}
        <li><div class="obs">Observación: de un total facturado de ${f(X.total)} quedan ${f(X.final - sinT)} de utilidad final (${(X.total ? (X.final - sinT) / X.total * 100 : 0).toFixed(1)} %). ${X.final - sinT > 0 ? "El negocio cierra positivo." : "El negocio queda negativo: revisar precio de compra."}</div></li></ul>
      <div class="dos"><div><h2>Pago con factura (totales con IVA)</h2><table><tr><th>Proveedor</th><th class="n">Total</th><th>Medio</th></tr>
        <tr><td>${esc(prov || "Proveedor por definir")}</td><td class="n">${f(X.compras)}</td><td>${esc(op.banco_proveedor ? "Transferencia" : "—")}</td></tr>${X.transporte ? `<tr><td>Transporte</td><td class="n">${f(X.transporte)}</td><td>Transferencia</td></tr>` : ""}
        <tr><td><b>Total</b></td><td class="n b">${f(X.compras + X.transporte)}</td><td style="color:#5b6a84">IVA incl. ${f(X.iva_compra)}</td></tr></table>
        <h2>Pago sin factura</h2><table><tr><th>Concepto</th><th class="n">Total</th><th>Medio</th></tr>${sinF.length ? sinF.map((x) => `<tr><td>${esc(x.que || x.concepto || "")}</td><td class="n">${f(x.monto)}</td><td>${esc(x.medio || "")}</td></tr>`).join("") : `<tr><td colspan="3" style="color:#5b6a84">Sin pagos sin factura</td></tr>`}<tr><td><b>Total</b></td><td class="n b">${f(sinT)}</td><td></td></tr></table></div>
      <div><h2>IVA</h2><table>${tr("IVA venta", X.iva)}${tr("IVA compra", X.iva_compra)}${tr("IVA a pagar", X.iva_pagar, true)}</table>
        <h2>Resultado ejecutivo</h2><table>${tr("Ingreso final del factoring", X.ingreso)}${tr("Pagos con factura", -(X.compras + X.transporte))}${tr("Pagos sin factura", -sinT)}${tr("Utilidad", X.utilidad - sinT, true)}${tr("Impuestos (IVA + PPM)", -(X.iva_pagar + X.impuesto))}${tr("Comisión", -X.comision)}${tr("Utilidad final", X.final - sinT, true)}</table>
        <h2>Reparto</h2><table>${tr("Inversionista " + (op.inversionista_nombre || "") + ": capital " + f(X.capital) + " + ganancia " + f(X.invGan) + " (" + pc(X.invPct) + ")", X.invRecibe, true)}${tr("Ejecutor " + (op.ejecutor_nombre || op.responsable || "") + " (" + pc(X.p.ejecutador) + ")", X.ejec)}${tr("Cotizador " + (t.persona || "") + " (comisión)", X.jugador)}${tr(emp.razon_social || "Empresa", X.empresa, true)}</table></div></div>
      <p class="foot">Presentación generada por CotizÁgil · Socios de Crecimiento · ${fd(hoy)} ${hoy.toTimeString().slice(0, 5)} · Compras: ${esc(X.fuente)}. Cifras en pesos chilenos; proyección sujeta a los precios finales del proveedor y a la fecha real de pago del factoring.</p></div>
      <div class="bt"><button type="button" id="bPdf">⬇ Descargar PDF</button><button type="button" onclick="window.print()">🖨 Imprimir</button></div>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
      <script>document.getElementById("bPdf").onclick=async function(){const b=this;b.textContent="Generando…";try{const el=document.getElementById("pg");const c=await html2canvas(el,{scale:2,backgroundColor:"#fff",useCORS:true});const {jsPDF}=window.jspdf;const pdf=new jsPDF({unit:"mm",format:"a4"});const W=210-20,H=297-20;const ph=c.width*H/W;let y=0,first=true;while(y<c.height){const h=Math.min(ph,c.height-y);const s=document.createElement("canvas");s.width=c.width;s.height=h;s.getContext("2d").drawImage(c,0,y,c.width,h,0,0,c.width,h);if(!first)pdf.addPage();pdf.addImage(s.toDataURL("image/jpeg",.92),"JPEG",10,10,W,h*W/c.width);y+=h;first=false;}pdf.save(${JSON.stringify("Presentacion_inversionistas_" + String(t.codigo).replace(/[^\w-]/g, "_") + ".pdf")});b.textContent="⬇ Descargar PDF";}catch(e){b.textContent="Usa Imprimir → Guardar como PDF";window.print();}};<\/script></body></html>`;
    return html;
  }
  // 📊 Ficha de una oferta ENVIADA: qué puede pasar, cuánto vale, excel previo + repartija, qué hacer
  function fichaEnviada(t) {
    const g = segDe(t.codigo) || {};
    const estado = g.ganada ? "🏆 Ya te seleccionaron — esta es tuya."
      : g.mi_lugar === 1 ? "🥇 Vas 1° por ahora: muy probable que te elijan."
      : g.mi_lugar ? `Vas ${g.mi_lugar}° por ahora.`
      : "⏳ En evaluación por el organismo.";
    let X = calcNeg(t), tv = t, estim = false;
    if (!X.compras && Number(t.total)) {
      estim = true;
      const comprasEst = Math.round(Number(t.total) / 1.19 * 0.70 * 1.19); // costo ≈ 70% de la venta neta (estimación hasta tener proveedor)
      tv = { ...t, op: { ...(t.op || {}), informe: { ...((t.op || {}).informe || {}), compras: comprasEst } } };
      X = calcNeg(tv);
    }
    const _r = ratingNeg(X.final);
    const pasos = g.ganada
      ? "Acepta la OC en Mercado Público → en Ejecuta pide precio a proveedores → elige el que deja más → avisa al inversionista → factura y simula factoring para cobrar antes."
      : g.mi_lugar === 1
      ? "Adelántate: en Ejecuta pide precio a proveedores por si te llaman o te seleccionan."
      : "Espera la evaluación. Si te seleccionan, pásala a Ejecuta y arrancamos el negocio.";
    const btn = t.op && t.op.etapa !== "rechazada"
      ? `<button class="btn small" type="button" data-rb="mail-abrir" data-c="${esc(t.codigo)}">🛠 Abrir en Ejecuta</button>`
      : g.ganada || g.mi_lugar === 1
      ? `<button class="btn small rb-oro" type="button" data-rb="env-ejecutar" data-e="${g.ganada ? "ganada" : "previa"}" data-c="${esc(t.codigo)}">➡ Pasar a Ejecuta</button>` : "";
    return `<details class="rb-det"><summary>📊 Qué puede pasar en este negocio · ${_r.emoji} ${clp(Math.round(X.final))} estimado</summary>
      <div style="font-size:.8rem;margin:4px 0 2px">${estado}</div>
      <div class="muted" style="font-size:.72rem;margin-bottom:4px">💵 El proyecto vale <b>${clp(Number(t.total) || 0)}</b>${estim ? " · <span style='color:#f5cf6b'>cifras estimadas — el costo real se afina en Ejecuta con el proveedor</span>" : ""}</div>
      ${excelVivo(tv, X)}
      <div class="rb-sec">🧭 Qué habría que hacer</div><div class="muted" style="font-size:.74rem">${pasos}</div>
      ${btn ? `<div class="rb-row" style="margin-top:6px">${btn}</div>` : ""}</details>`;
  }
  function repartoHTML(t, X, corto) {
    if (!X.compras) return "";
    const pc = (x) => Math.round(x * 1000) / 10 + "%";
    const fila = (ico, quien, monto, det) => `<div class="rb-rep"><span>${ico}</span><div><b>${quien}</b><small>${det}</small></div><b>${clp(Math.round(monto))}</b></div>`;
    return `<div class="rb-sec">🤝 Reparto: todos ganan</div>
      ${fila("💼", "Inversionista", X.invRecibe, `invierte ${clp(Math.round(X.capital))} → gana ${clp(Math.round(X.invGan))} (+${pc(X.invPct)})`)}
      ${fila("🚚", "Ejecutador", X.ejec, `${pc(X.p.ejecutador)} de la utilidad final`)}
      ${fila("🎮", "Cotizador", X.jugador, `comisión ${pc(X.p.comision)} por traer el negocio`)}
      ${fila("🏢", "Empresa", X.empresa, "el resto de la utilidad final")}
      ${corto ? "" : `${fila("🏛", "SII", X.iva_pagar + X.impuesto, "IVA a pagar + impuesto")}${fila("💰", "Factoring", X.factoring, pc(X.p.factoring) + " de la OC")}`}`;
  }
  // 💰 REPARTO FINAL CON 1 CLIC: llega la plata del factoring → cuánto le toca a cada uno, nómina lista y ✅ por pago
  const RP = ["rp_inversionista", "rp_ejecutador", "rp_jugador", "rp_sii"];
  const repartoListo = (op) => !!op.cobrado && RP.every((k) => op[k]);
  function lineasReparto(t, X) {
    const op = t.op || {}, emp = empresaActual() || {}, dif = op.cobrado ? Number(op.cobrado) - X.ingreso : 0;
    return [
      { k: "rp_inversionista", ico: "💼", quien: op.inversionista_nombre || "Inversionista", monto: X.invRecibe, banco: op.inversionista_banco, campo: "inversionista_banco", det: `capital ${clp(Math.round(X.capital))} + ganancia ${clp(Math.round(X.invGan))}` },
      { k: "rp_ejecutador", ico: "🚚", quien: op.ejecutor_nombre || "Ejecutador", monto: X.ejec, banco: op.ejecutor_banco, campo: "ejecutor_banco", det: `${Math.round(X.p.ejecutador * 100)}% de la utilidad final` },
      { k: "rp_jugador", ico: "🎮", quien: t.persona || "Cotizador", monto: X.jugador, banco: op.jugador_banco, campo: "jugador_banco", det: `comisión ${Math.round(X.p.comision * 100)}%` },
      { k: "rp_sii", ico: "🏛", quien: "Reserva impuestos (F29)", monto: X.iva_pagar + X.impuesto, banco: "Cuenta de impuestos de " + (emp.razon_social || "la empresa"), det: `IVA ${clp(Math.round(X.iva_pagar))} + impuesto ${clp(Math.round(X.impuesto))}` },
      { k: null, ico: "🏢", quien: emp.razon_social || "Empresa", monto: X.empresa + (X.compras - X.capital) + dif, banco: "queda en la cuenta operativa",
        det: `utilidad ${clp(Math.round(X.empresa))} + recupera su aporte a la compra ${clp(Math.round(X.compras - X.capital))}${dif ? ` · diferencia factoring ${dif > 0 ? "+" : ""}${clp(Math.round(dif))}` : ""}` },
    ];
  }
  function repartoFinal(t, X) {
    if (!X.compras) return repartoHTML(t, X);
    const op = t.op || {}, cod = t.codigo, L = lineasReparto(t, X), hechos = RP.filter((k) => op[k]).length;
    const cob = `<label class="rb-lab">💰 ¿Cuánto llegó del factoring a la cuenta?<input class="rb-neg-in" data-campo="cobrado" data-c="${esc(cod)}" inputmode="numeric" value="${op.cobrado ? Number(op.cobrado).toLocaleString("es-CL") : ""}" placeholder="Esperado ${Math.round(X.ingreso).toLocaleString("es-CL")}"></label>`;
    if (!op.cobrado) return `${repartoHTML(t, X)}<div class="rb-sec">💰 Reparto final</div><div class="muted" style="font-size:.72rem">Cuando el factoring deposite, anota el monto y la app arma la nómina de pagos para cada uno.</div>${cob}`;
    const fila = (x) => `<div class="rb-rep ${x.k && op[x.k] ? "pagado" : ""}"><span>${x.ico}</span><div><b>${esc(x.quien)}</b><small>${x.det}</small>
        ${x.campo ? `<input class="rb-neg-in rb-banco" data-campo="${x.campo}" data-c="${esc(cod)}" value="${esc(x.banco || "")}" placeholder="Banco · tipo · N° cuenta · RUT · correo">` : `<small>${esc(x.banco || "")}</small>`}</div>
      <div style="text-align:right"><b>${clp(Math.round(x.monto))}</b>${x.k ? `<label class="rb-pagado"><input type="checkbox" data-rb-chk="${x.k}" data-c="${esc(cod)}" ${op[x.k] ? "checked" : ""}> pagado</label>` : ""}</div></div>`;
    return `<div class="rb-sec">💰 Reparto final · ${hechos}/${RP.length} pagos</div>${cob}
      <div class="rb-barra"><i style="width:${hechos / RP.length * 100}%"></i></div>
      ${L.map(fila).join("")}
      <div class="rb-row"><button class="btn small rb-oro" type="button" data-rb="rep-nomina" data-c="${esc(cod)}">⬇ Nómina de pagos (Excel / banco)</button><button class="btn small" type="button" data-rb="rep-copiar" data-c="${esc(cod)}">📋 Copiar transferencias</button></div>
      ${repartoListo(op) ? `<div class="rb-resp nueva">🥇 <b>Negocio repartido.</b> Todos cobraron su parte.</div>` : `<div class="muted" style="font-size:.66rem">🔐 Las transferencias las autoriza el dueño desde su banco; aquí marcas ✅ cada una al hacerla.</div>`}`;
  }
  function nominaTexto(t, csv) {
    const X = calcNeg(t), L = lineasReparto(t, X).filter((x) => x.k && !(t.op || {})[x.k]);
    if (csv) return "\ufeffNombre;Monto;Datos bancarios;Glosa\n" + L.map((x) => [x.quien, Math.round(x.monto), x.banco || "", "Negocio " + t.codigo].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    return L.map((x) => `${x.quien}: ${clp(Math.round(x.monto))}\n${x.banco || "(faltan datos bancarios)"}\nGlosa: Negocio ${t.codigo}`).join("\n\n");
  }
  // 💼 lo que ve el inversionista en cada negocio: cuánto pone, cuánto recibe y a quién le paga
  function bloqueInversion(t, X) {
    const op = t.op || {}, emp = empresaActual() || {};
    if (!X.compras) return `<div class="muted" style="font-size:.74rem">Cuando haya precio de proveedor, aquí aparece cuánto invierte el inversionista y cuánto recibe.</div>`;
    return `<div class="rb-inv-c"><div class="rb-env"><span>Invierte</span><b>${clp(Math.round(X.capital))}</b></div><div class="rb-env"><span>Recibe al cobrar</span><b class="rb-vivo-t">${clp(Math.round(X.invRecibe))}</b></div>
      <div class="muted" style="font-size:.7rem">+${Math.round(X.invPct * 1000) / 10}% · el Estado paga a 30 días (o antes con factoring). Paga a ${esc(emp.razon_social || "la empresa")} y la empresa le paga al proveedor.</div>
      ${op.pedido_transferencia && !op.transferido ? `<div class="rb-sug" style="border-color:#f5cf6b">🏦 ${emp.banco ? esc(emp.banco) : "Faltan los datos de transferencia de la empresa (🏢 empresa → banco)."}</div>` : ""}</div>`;
  }
  // 👥 Inversionistas/brokers guardados + 💳 saldo estilo Betano (por dispositivo)
  const BROK = "sdc:brokers";
  const brokers = () => { try { return JSON.parse(localStorage.getItem(BROK)) || []; } catch { return []; } };
  const SALDO = "sdc:saldo";
  const saldoInv = () => { try { return Math.max(0, Number(JSON.parse(localStorage.getItem(SALDO))?.disp) || 0); } catch { return 0; } };
  const setSaldo = (d) => { try { localStorage.setItem(SALDO, JSON.stringify({ disp: Math.max(0, Math.round(d)) })); } catch {} };
  // 💳 WebPay: redirige a pagar y, al volver, cobra el abono confirmado por el servidor
  function irWebpay(url, token) {
    const f = document.createElement("form"); f.method = "POST"; f.action = url;
    const i = document.createElement("input"); i.type = "hidden"; i.name = "token_ws"; i.value = token; f.appendChild(i);
    document.body.appendChild(f); f.submit();
  }
  async function revisarWebpay() {
    const q = new URLSearchParams(location.search), w = q.get("webpay"); if (!w) return;
    try { history.replaceState(null, "", location.pathname + location.hash); } catch {}
    if (w === "ok") {
      const montoRet = Math.round(Number(q.get("monto")) || 0);   // el servidor solo lo manda si el pago quedó AUTORIZADO y abonado
      let ab = 0;
      try {
        const r = await api("webpay-cobrar", { method: "POST", body: JSON.stringify({ jugador: miJug() }) });
        ab = Math.round(Number(r?.abonado) || 0);
      } catch {}
      if (!ab && montoRet) ab = montoRet;   // 💳 respaldo: si el jugador no calza (PWA→Safari), usa el monto confirmado en el retorno
      if (ab > 0) { setSaldo(saldoInv() + ab); guardar({ portal: "inversion" }); toast("💳 Pago aprobado: +" + clp(ab) + " a tu saldo"); }
      else toast("Pago aprobado. Si no ves el saldo, recarga la app.");
    } else toast(w === "rechazado" ? "❌ El pago fue rechazado. Intenta de nuevo." : w === "cancelado" ? "Pago cancelado." : "No se pudo confirmar el pago.");
    pintarHoja(true);
  }
  const INVS = "sdc:inversiones";
  const inversiones = () => { try { return JSON.parse(localStorage.getItem(INVS)) || []; } catch { return []; } };
  const setInversiones = (a) => { try { localStorage.setItem(INVS, JSON.stringify(a)); } catch {} };
  const invTrab = () => inversiones().filter((x) => x.estado === "trabajando").map((x) => ({ t: { codigo: x.codigo, nombre: x.nombre }, X: { capital: x.capital, invGan: x.invGan } }));
  // 📲 mensaje claro para el inversionista: invierte X → recibe Y (+Z%) en ~5 días, con OC y link en vivo
  function msgOportunidad(t, X) {
    const emp = empresaActual() || {}, pct = Math.round((X.invPct || 0) * 1000) / 10;
    return `💰 OPORTUNIDAD DE INVERSIÓN\n${(t.nombre || t.codigo)}\n\n• Inviertes: ${clp(Math.round(X.capital))}\n• Recibes: ${clp(Math.round(X.invRecibe))}  (+${pct}%)\n• Plazo: ~5 días — te paga el FACTORING (no esperas al Estado)\n\nNegocio YA GANADO en Mercado Público${t.op?.oc_codigo ? " · OC " + t.op.oc_codigo : ""} por ${emp.razon_social || "la empresa"}. Tu plata paga solo los costos reales del proyecto.\n\n▶ Míralo en vivo y simula: ${location.origin}/#robot\n\nCuando confirmes te paso los datos para transferir${emp.banco ? ":\n" + emp.banco : "."}`;
  }
  // 💳 panel de saldo (cargar / retirar) — estilo Betano
  function panelSaldo() {
    const d = saldoInv(), emp = empresaActual() || {};
    const form = R.saldoForm ? `<div style="margin-top:8px;border-top:1px solid rgba(127,127,127,.2);padding-top:8px">
      <div class="rb-sec">${R.saldoForm === "cargar" ? "➕ Cargar saldo" : "➖ Retirar"}</div>
      <label class="rb-lab">Monto<input class="rb-in" id="rbSaldoMonto" inputmode="numeric" placeholder="$ 0" value="${R.saldoForm === "cargar" && R.saldoPrefill ? R.saldoPrefill : ""}"></label>
      ${R.saldoForm === "cargar" ? `<div class="muted" style="font-size:.7rem;line-height:1.5">Paga con tarjeta por <b>WebPay</b> y se abona al tiro a tu saldo. La plata va a la cuenta de <b>${esc(corta(emp.razon_social) || "PJANIC")}</b>.</div>
      <button class="btn small rb-oro" type="button" data-rb="saldo-simular" style="width:100%;margin-top:6px">🧪 Simular carga (modo prueba, sin WebPay)</button>
      <div class="rb-row" style="margin-top:6px"><button class="btn small" type="button" data-rb="saldo-webpay">💳 Pagar con WebPay</button><button class="btn small rb-link" type="button" data-rb="saldo-cancelar">Cancelar</button></div>
      <div class="muted" style="font-size:.64rem;margin-top:5px;opacity:.75">¿Transferiste a mano? <a data-rb="saldo-ok" style="text-decoration:underline;cursor:pointer">Confirmar carga manual</a></div></div>` : `<div class="muted" style="font-size:.7rem">Se descuenta de tu saldo y la empresa te transfiere.</div>
      <div class="rb-row" style="margin-top:6px"><button class="btn small rb-oro" type="button" data-rb="saldo-ok">Confirmar retiro</button><button class="btn small rb-link" type="button" data-rb="saldo-cancelar">Cancelar</button></div></div>`}` : "";
    return `<div class="rb-card" style="border-color:#5ef0b0;background:rgba(63,220,138,.06)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div><div class="muted" style="font-size:.64rem">💳 Tu saldo para invertir</div><b style="font-size:1.3rem">${clp(d)}</b></div>
        <div class="rb-row"><button class="btn small rb-oro" type="button" data-rb="saldo-cargar">➕ Cargar</button><button class="btn small" type="button" data-rb="saldo-retirar">➖ Retirar</button></div>
      </div>${form}</div>`;
  }
  // 🧮 Liquidación: reparto configurable de la ganancia entre inversionista y broker
  const BROKPCT = "sdc:brokerpct";
  const brokerPct = () => { try { const v = Number(localStorage.getItem(BROKPCT)); return isFinite(v) && v >= 0 && v <= 90 ? v : 30; } catch { return 30; } };
  const setBrokerPct = (p) => { try { localStorage.setItem(BROKPCT, String(Math.max(0, Math.min(90, Math.round(p))))); } catch {} };
  function panelLiquidacion(activos) {
    const bp = brokerPct(), f = bp / 100;
    const totCap = activos.reduce((a, x) => a + x.X.capital, 0), totG = activos.reduce((a, x) => a + x.X.invGan, 0);
    const comBroker = totG * f, recInv = totCap + totG * (1 - f);
    const filas = activos.map(({ t, X }) => `<tr><td>${esc((t.nombre || t.codigo).slice(0, 26))}</td><td class="n">${clp(Math.round(X.capital + X.invGan * (1 - f)))}</td><td class="n rb-vivo-t">${clp(Math.round(X.invGan * f))}</td></tr>`).join("");
    return `<details class="rb-det" ${R.liqAbierto ? "open" : ""}><summary>🧮 Liquidación · tu comisión de broker ${clp(Math.round(comBroker))}</summary>
      <div class="rb-sec">Reparto de la ganancia</div>
      <div class="rb-row" style="align-items:center;gap:10px;flex-wrap:wrap"><span class="muted" style="font-size:.74rem">Inversionista <b>${100 - bp}%</b></span><button class="btn small" type="button" data-rb="liq-menos">−</button><b>Broker ${bp}%</b><button class="btn small" type="button" data-rb="liq-mas">+</button></div>
      ${activos.length ? `<table class="rb-copias"><tr><td><b>Negocio</b></td><td class="n"><b>Inversionista</b></td><td class="n"><b>Tú (broker)</b></td></tr>${filas}
        <tr><td><b>Total</b></td><td class="n"><b>${clp(Math.round(recInv))}</b></td><td class="n"><b class="rb-vivo-t">${clp(Math.round(comBroker))}</b></td></tr></table>` : `<div class="muted" style="font-size:.72rem;margin-top:4px">Cuando haya inversión activa, aquí ves cuánto recibe el inversionista (capital + su parte) y cuánto queda para ti como broker.</div>`}
      <div class="muted" style="font-size:.66rem;margin-top:4px">De la ganancia del inversionista, <b>${bp}%</b> es tu comisión como broker. Ajusta con − / +.</div></details>`;
  }
  // 🟢 Mi plata trabajando: inversiones hechas desde el saldo (se liquidan con el factoring)
  function panelMisInversiones() {
    const trab = inversiones().filter((x) => x.estado === "trabajando");
    if (!trab.length) return "";
    const bp = brokerPct() / 100;
    return `<div class="rb-sec">🟢 Mi plata trabajando</div>${trab.map((x) => {
      const recibe = Math.round(x.capital + x.invGan * (1 - bp)), pct = x.capital ? Math.round((x.invGan * (1 - bp)) / x.capital * 1000) / 10 : 0;
      return `<div class="rb-inv activo"><div class="rb-env"><div style="min-width:0"><b>${esc((x.nombre || x.codigo).slice(0, 50))}</b><div class="muted" style="font-size:.68rem">Invertido ${hace(x.ts)}</div></div><div style="text-align:right"><div class="muted" style="font-size:.6rem">INVERTISTE</div><b>${clp(x.capital)}</b></div></div>
        <div class="rb-inv-flecha"><span>Recibirás</span><b class="rb-vivo-t">${clp(recibe)}</b><span class="rb-pill verde">+${pct}%</span></div>
        <div class="muted" style="font-size:.66rem">Lo paga el factoring, no esperas al Estado.</div>
        <div class="rb-row" style="margin-top:4px"><button class="btn small rb-oro" type="button" data-rb="inv-liquidar" data-id="${esc(x.id)}">✅ Liquidar — pagó el factoring</button></div></div>`;
    }).join("")}`;
  }
  // 📊 Historial/estadísticas del inversionista (estilo Betano): invertiste, recibiste, ROI
  function panelHistorial() {
    const liq = inversiones().filter((x) => x.estado === "liquidado");
    if (!liq.length) return "";
    const inv = liq.reduce((a, x) => a + x.capital, 0), rec = liq.reduce((a, x) => a + (x.neto || x.capital), 0);
    const gan = rec - inv, roi = inv ? Math.round(gan / inv * 1000) / 10 : 0, com = liq.reduce((a, x) => a + (x.com || 0), 0);
    return `<details class="rb-det"><summary>📊 Mi historial · ${liq.length} liquidada${liq.length > 1 ? "s" : ""} · +${clp(gan)} ganados</summary>
      <div style="display:flex;gap:8px;margin:6px 0;flex-wrap:wrap">
        <div style="flex:1;min-width:88px;background:rgba(127,127,127,.08);border-radius:10px;padding:8px"><div class="muted" style="font-size:.6rem">Invertiste</div><b>${clp(inv)}</b></div>
        <div style="flex:1;min-width:88px;background:rgba(63,220,138,.12);border-radius:10px;padding:8px"><div class="muted" style="font-size:.6rem">Recibiste</div><b class="rb-vivo-t">${clp(rec)}</b></div>
        <div style="flex:1;min-width:64px;background:rgba(245,207,107,.12);border-radius:10px;padding:8px"><div class="muted" style="font-size:.6rem">ROI</div><b>+${roi}%</b></div></div>
      <table class="rb-copias"><tr><td><b>Negocio</b></td><td class="n"><b>Invertiste</b></td><td class="n"><b>Recibiste</b></td></tr>
      ${liq.slice().reverse().map((x) => `<tr><td>${esc((x.nombre || x.codigo).slice(0, 24))}<div class="muted" style="font-size:.6rem">${hace(x.ts_liq || x.ts)}</div></td><td class="n">${clp(x.capital)}</td><td class="n rb-vivo-t">${clp(x.neto || x.capital)}</td></tr>`).join("")}</table>
      ${com ? `<div class="muted" style="font-size:.66rem;margin-top:4px">Comisión de broker acumulada: <b>${clp(com)}</b></div>` : ""}
      <div class="rb-row" style="margin-top:6px"><button class="btn small rb-link" type="button" data-rb="hist-limpiar">Borrar historial</button></div></details>`;
  }
  // 💼 PORTAL INVERSIONISTA: los negocios que necesitan capital, en vivo
  // 💡 Onboarding del inversor: ejemplo con números + por qué es real + saldo (estilo Betano)
  function inversorDidactico(L, tot, emp) {
    const ej = [...L].filter((x) => x.X && x.X.final > 0).sort((a, b) => b.X.final - a.X.final)[0], nombreEmp = esc(emp.razon_social || "la empresa");
    const ejemplo = ej ? `<div class="rb-inv-flecha" style="margin:6px 0"><span>Si inviertes</span><b>${clp(Math.round(ej.X.capital))}</b><span>recibes</span><b class="rb-vivo-t">${clp(Math.round(ej.X.invRecibe))}</b><span class="rb-pill verde">+${Math.round(ej.X.invPct * 1000) / 10}%</span></div>
      <div class="muted" style="font-size:.68rem">Ejemplo real: «${esc((ej.t.nombre || ej.t.codigo).slice(0, 40))}». Recibes tu capital + la ganancia en ~5 días.</div>`
      : `<div class="muted" style="font-size:.74rem">Ejemplo: inviertes <b>$3.000.000</b> en un negocio ya ganado → recibes tu capital + la ganancia que calcula el Excel de ese negocio (típico +10% a +20% en ~5 días). Cuando haya un negocio con precio, aquí ves tu número exacto.</div>`;
    return `<details class="rb-det" open style="border-color:#5ef0b0"><summary>💡 ¿Cómo funciona y por qué es real?</summary>
      ${ejemplo}
      <div class="rb-sec">Tu plata, paso a paso</div>
      <div class="muted" style="font-size:.74rem;line-height:1.6">
        1️⃣ 💸 <b>Inviertes</b> en un negocio <b>ya ganado</b> en Mercado Público por ${nombreEmp}. Tu dinero paga directo los costos del proyecto (proveedor, transporte, logística); no se usa para otra cosa.<br>
        2️⃣ 🛠 El <b>proveedor ejecuta y entrega</b>. Lo ves <b>en vivo</b> y te llegan notificaciones del estado de tu dinero.<br>
        3️⃣ 🧾 Se emite y <b>firma la factura</b> (la IA estima que ocurre al ~4º día).<br>
        4️⃣ 💰 Al <b>5º día</b>, el <b>factoring</b> (no el Estado) adelanta el pago y se <b>abona a tu saldo</b> tu capital + tu ganancia.
      </div>
      <div class="rb-sec">🔒 Por qué es seguro</div>
      <div class="muted" style="font-size:.72rem;line-height:1.55">El negocio <b>ya está adjudicado</b> antes de que pongas un peso · tu dinero <b>solo paga costos reales</b> del proyecto · ves <b>cada movimiento en tiempo real</b> · <b>el factoring</b> adelanta el pago de la factura (no esperas al Estado).</div>
      <div style="display:flex;gap:10px;margin-top:8px"><div style="flex:1;background:rgba(63,220,138,.12);border:1px solid rgba(63,220,138,.4);border-radius:12px;padding:8px 12px"><span style="font-size:.64rem;opacity:.8;display:block">Tu saldo trabajando</span><b style="font-size:1.1rem">${clp(Math.round(tot.c))}</b></div><div style="flex:1;background:rgba(245,207,107,.12);border:1px solid rgba(245,207,107,.4);border-radius:12px;padding:8px 12px"><span style="font-size:.64rem;opacity:.8;display:block">Por cobrar</span><b class="rb-vivo-t" style="font-size:1.1rem">+${clp(Math.round(tot.g))}</b></div></div>
      <div class="muted" style="font-size:.64rem;margin-top:4px">⚠️ Rentabilidad estimada, no garantizada. Las transferencias las autoriza el dueño de la empresa desde su banco.</div></details>`;
  }
  // --- Portal del inversionista estilo Betano: login → oportunidades → detalle → tracker ---
  const INVSES = "sdc:invsesion";
  const invSesion = () => { try { return JSON.parse(localStorage.getItem(INVSES)) || null; } catch { return null; } };
  function pantallaInvLogin() {
    return `<div class="rb-paso" style="max-width:420px;margin:0 auto">
      <div style="text-align:center;margin:12px 0"><div style="font-size:2.6rem">💼</div><h2 class="rb-h" style="margin:4px 0">Portal del Inversionista</h2><div class="muted" style="font-size:.78rem">Inicia sesión para ver las oportunidades de inversión.</div></div>
      <label class="rb-lab">Usuario<input class="rb-in" id="rbInvUsr" placeholder="Tu nombre" autocomplete="username"></label>
      <label class="rb-lab">Clave<input class="rb-in" id="rbInvPwd" type="password" placeholder="••••" autocomplete="current-password"></label>
      <button class="btn rb-oro rb-big-btn" type="button" data-rb="inv-entrar">Iniciar sesión</button>
      <div class="muted" style="font-size:.68rem;text-align:center;margin-top:6px">¿Primera vez? Pon un usuario y una clave: quedan registrados en este dispositivo.</div></div>`;
  }
  function pasoDe(cod) {
    const t = (R.ejec || []).find((x) => x.codigo === cod), op = (t && t.op) || {};
    let p = 0;
    if (["transporte", "despacho", "entrega"].includes(op.etapa)) p = 1;
    if (op.cobrado || ["documentos", "cerrado"].includes(op.etapa) || (op.transferido && op.proveedor_pagado)) p = 2;
    return p;
  }
  function trackerCards() {
    const trab = inversiones().filter((x) => x.estado === "trabajando");
    if (!trab.length) return "";
    const pasos = ["🛒 Preparando depósito a proveedor", "🚚 Productos despachados", "🏦 Dinero en banco"];
    return `<div class="rb-sec">📍 ¿Dónde está mi plata?</div>${trab.map((x) => {
      const paso = Math.max(pasoDe(x.codigo), x.paso || 0), recibe = Math.round(x.capital + x.invGan * (1 - brokerPct() / 100));
      return `<div class="rb-inv activo"><div class="rb-env"><div style="min-width:0"><b>${esc((x.nombre || x.codigo).slice(0, 46))}</b><div class="muted" style="font-size:.68rem">Invertiste ${clp(x.capital)} · recibirás ${clp(recibe)}</div></div></div>
        <div style="margin:8px 0">${pasos.map((pz, i) => `<div style="display:flex;align-items:center;gap:8px;opacity:${i <= paso ? 1 : .4};margin:3px 0"><span>${i < paso ? "✅" : i === paso ? "🔵" : "⚪"}</span><span style="font-size:.82rem;${i === paso ? "font-weight:700" : ""}">${pz}</span></div>`).join("")}</div>
        ${paso >= 2 ? `<button class="btn rb-oro rb-big-btn" type="button" data-rb="inv-liquidar" data-id="${esc(x.id)}">💰 Dinero en banco — cargar ${clp(recibe)} a mi saldo</button>` : `<div class="rb-row"><span class="muted" style="font-size:.68rem;align-self:center">Cuando el factoring pague, cargas tu saldo.</span><button class="btn small rb-link" type="button" data-rb="inv-avanzar" data-id="${esc(x.id)}" style="margin-left:auto">avanzar estado ▸</button></div>`}</div>`;
    }).join("")}`;
  }
  // 💼 Betano puro: el inversionista solo mete y saca; el seguimiento lo hace el broker
  function misInvSimple() {
    const trab = inversiones().filter((x) => x.estado === "trabajando");
    if (!trab.length) return "";
    return `<div class="rb-sec">💼 Mis inversiones</div>${trab.map((x) => {
      const cobra = Math.round(x.capital + x.invGan * (1 - brokerPct() / 100));
      return `<div class="rb-inv activo"><div class="rb-env"><div style="min-width:0"><b>${esc((x.nombre || x.codigo).slice(0, 46))}</b><div class="muted" style="font-size:.68rem">Invertiste ${clp(x.capital)} · 💰 en ~5 días</div></div><div style="text-align:right"><div class="muted" style="font-size:.6rem">COBRAS</div><b class="rb-vivo-t">${clp(cobra)}</b></div></div>
        <div class="rb-row" style="margin-top:4px"><button class="btn small" type="button" data-rb="inv-ejecutar" data-c="${esc(x.codigo)}">🚀 Ir a ejecutar</button><button class="btn small rb-oro" type="button" data-rb="inv-liquidar" data-id="${esc(x.id)}">💰 Cobrar a mi saldo</button></div></div>`;
    }).join("")}`;
  }
  function invDetalle(cod) {
    const t = (R.ejec || []).find((x) => x.codigo === cod);
    if (!t) { R.invVer = null; return portalInversion(); }
    const X = calcNeg(t), emp = empresaActual() || {}, cap = Math.round(X.capital), rec = Math.round(X.invRecibe), d = saldoInv();
    return `<div class="rb-paso">
      <button class="btn small rb-link" type="button" data-rb="inv-volver">← Oportunidades</button>
      <div class="rb-card" style="border-color:#5ef0b0;overflow:hidden;padding:0">
        <div style="height:96px;background:linear-gradient(135deg,#0b7d5b,#12b886);display:grid;place-items:center;color:#fff;font-size:2.4rem">📦</div>
        <div style="padding:14px">
          <h2 class="rb-h" style="margin:0 0 2px">${esc((t.nombre || t.codigo).slice(0, 60))}</h2>
          <div class="muted" style="font-size:.72rem">${esc((t.oc_compra?.organismo || t.organismo || "").slice(0, 50))}${t.op?.oc_codigo ? " · OC " + esc(t.op.oc_codigo) : ""}</div>
          <div class="rb-inv-flecha" style="margin:10px 0"><span>Inviertes</span><b>${clp(cap)}</b><span>recibes</span><b class="rb-vivo-t">${clp(rec)}</b><span class="rb-pill verde">+${Math.round(X.invPct * 1000) / 10}%</span></div>
          <div class="muted" style="font-size:.72rem;margin-bottom:8px">Te paga el <b>factoring</b> en ~5 días (no esperas al Estado). Tu plata paga solo los costos reales del proyecto.</div>
          ${d >= cap ? `<button class="btn rb-oro rb-big-btn" type="button" data-rb="inv-poner" data-c="${esc(cod)}">💸 Invertir ${clp(cap)} desde mi saldo</button>` : `<div class="rb-sug" style="border-color:#f5cf6b">💳 Te faltan ${clp(cap - d)} en tu saldo. Carga tu saldo para invertir en esta oportunidad.</div>
          <button class="btn rb-oro rb-big-btn" type="button" data-rb="inv-cargar-op" data-c="${esc(cod)}" data-m="${cap}">💳 Cargar mi saldo → transferir a ${esc(corta(emp.razon_social) || "PJANIC")}</button>`}
          ${brokers().length ? `<div class="rb-row" style="flex-wrap:wrap;margin-top:8px"><span class="muted" style="font-size:.66rem;align-self:center">📲 Enviar a:</span>${brokers().map((bk) => `<button class="btn small" type="button" data-rb="inv-enviar" data-c="${esc(t.codigo)}" data-tel="${esc(bk.tel || "")}" data-nom="${esc(bk.nombre)}">${esc(bk.nombre)}</button>`).join("")}<button class="btn small rb-link" type="button" data-rb="broker-nuevo">➕</button></div>` : `<div class="rb-row" style="margin-top:8px"><button class="btn small rb-link" type="button" data-rb="broker-nuevo">📲 Enviar a un inversionista</button></div>`}
          ${R.brokerForm ? `<div class="rb-card" style="padding:12px;margin-top:8px"><div class="rb-sec">➕ Nuevo inversionista</div><label class="rb-lab">Nombre<input class="rb-in" id="rbBkNom" placeholder="Ej: Nicolás"></label><label class="rb-lab">WhatsApp (opcional)<input class="rb-in" id="rbBkTel" inputmode="tel" placeholder="+56 9 ..."></label><div class="rb-row"><button class="btn small rb-oro" type="button" data-rb="broker-add">Guardar</button><button class="btn small rb-link" type="button" data-rb="broker-cancelar">Cancelar</button></div></div>` : ""}
        </div></div></div>`;
  }
  const esLicNeg = (t) => t.fuente === "licitacion" || /-L[A-Z]{1,2}\d{2}$/i.test(t.codigo || "");
  // 💼 Paso 1 del inversor: elegir EN QUÉ EMPRESA invertir (resumen + riesgo + oportunidades)
  function invEmpresas(opps) {
    const grupos = {};
    opps.forEach((o) => { const e = o.t.empresa || "principal"; (grupos[e] = grupos[e] || []).push(o); });
    const nomEmp = (id) => corta((R.empresas || {})[id]?.razon_social) || (id === "principal" ? ((empresaActual() || {}).razon_social || "PJANIC") : id);
    const cards = Object.entries(grupos).map(([id, arr]) => {
      const n = arr.length, fuego = arr.filter((x) => x.X.final >= 800000).length;
      const mejor = Math.round(Math.max(...arr.map((x) => x.X.invPct)) * 1000) / 10;
      const cap = arr.reduce((s, x) => s + x.X.capital, 0);
      const nLic = arr.filter((x) => esLicNeg(x.t)).length, nCa = n - nLic;
      return `<button type="button" class="rb-inv" style="width:100%;text-align:left;cursor:pointer;display:block" data-rb="inv-empresa" data-e="${esc(id)}">
        <div class="rb-env"><div style="min-width:0"><b>🏢 ${esc(nomEmp(id))}</b><div class="muted" style="font-size:.7rem">${n} oportunidad${n !== 1 ? "es" : ""} para invertir</div></div><span class="rb-pill verde">hasta +${mejor}%</span></div>
        <div class="rb-row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${fuego ? `<span class="rb-pill" style="background:rgba(245,190,70,.18);color:#f5cf6b">🔥 ${fuego} negocio${fuego !== 1 ? "s" : ""} fuego</span>` : ""}<span class="rb-pill">💰 ${clp(Math.round(cap))} disponible</span></div>
        <div class="rb-row" style="gap:6px;margin-top:5px;flex-wrap:wrap">${nLic ? `<span class="rb-pill">📑 ${nLic} licitación</span>` : ""}${nCa ? `<span class="rb-pill">🛒 ${nCa} compra ágil</span>` : ""}</div>
        <div class="muted" style="font-size:.63rem;margin-top:6px">Riesgo del comprador (ranking Mercado Público): <b>por evaluar</b> · tu plata la paga el factoring en ~5 días.</div></button>`;
    }).join("");
    return `<div class="rb-paso"><div class="rb-env"><h2 class="rb-h" style="margin:0">💼 ¿En qué empresa inviertes?</h2><button class="btn small rb-link" type="button" data-rb="inv-salir">salir</button></div>
      ${panelSaldo()}
      <div class="muted" style="font-size:.74rem;margin:6px 0 2px">Elige la empresa en cuyos negocios quieres poner tu plata. <b>Puedes invertir en cualquiera</b>, no solo en la tuya.</div>
      ${cards || `<div class="empty">No hay empresas con oportunidades ahora. Vuelve cuando un negocio tenga proveedor con precio.</div>`}
      ${misInvSimple()}${panelHistorial()}</div>`;
  }
  function portalInversion() {
    if (!tienePlan("premium")) return candado("premium", "💼 Inversión");
    const ses = invSesion();
    if (!ses) return pantallaInvLogin();
    if (!R.ejec) { cargarEjecuta(); return `<div class="empty"><span class="spinner"></span> Cargando oportunidades…</div>`; }
    const emp = empresaActual() || {};
    const noInt = (() => { try { return JSON.parse(localStorage.getItem("sdc:invno")) || {}; } catch { return {}; } })();
    const L = (R.ejec || []).filter((t) => t.op && t.op.etapa !== "rechazada").map((t) => ({ t, X: calcNeg(t) })).filter((x) => x.X.compras);
    const ids = new Set(inversiones().filter((x) => x.estado !== "liquidado").map((x) => x.codigo));
    const oportun = L.filter(({ t, X }) => X.final > 0 && !noInt[t.codigo] && !ids.has(t.codigo));
    if (R.invVer) return invDetalle(R.invVer);
    if (!R.invEmpSel) return invEmpresas(oportun);
    const oportun2 = oportun.filter(({ t }) => (t.empresa || "principal") === R.invEmpSel);
    const empSel = corta((R.empresas || {})[R.invEmpSel]?.razon_social) || (empresaActual() || {}).razon_social || "la empresa";
    const opCard = ({ t, X }) => `<div class="rb-inv"><div class="rb-env"><div style="min-width:0"><b>${esc((t.nombre || t.codigo).slice(0, 52))}</b><div class="muted" style="font-size:.7rem">${esLicNeg(t) ? "📑 Licitación · " : "🛒 Compra Ágil · "}${esc((t.oc_compra?.organismo || t.organismo || "").slice(0, 38))}</div></div><span class="rb-pill verde">+${Math.round(X.invPct * 1000) / 10}%</span></div>
      <div class="rb-inv-flecha"><span>Inviertes</span><b>${clp(Math.round(X.capital))}</b><span>cobras</span><b class="rb-vivo-t">${clp(Math.round(X.invRecibe))}</b></div>
      <div class="muted" style="font-size:.68rem;margin:2px 0 6px">💰 Cobras en ~5 días · pagado por el factoring</div>
      <button class="btn rb-oro rb-big-btn" type="button" data-rb="inv-ver" data-c="${esc(t.codigo)}">Ver inversión →</button></div>`;
    return `<div class="rb-paso"><div class="rb-env"><div style="min-width:0"><button class="btn small rb-link" type="button" data-rb="inv-cambiar-emp" style="padding-left:0">← Cambiar empresa</button><h2 class="rb-h" style="margin:2px 0 0">🏢 ${esc(empSel)}</h2></div><button class="btn small rb-link" type="button" data-rb="inv-salir">salir</button></div>
      ${panelSaldo()}
      ${misInvSimple()}
      ${oportun2.length ? `<div class="rb-sec">🔥 Oportunidades · ${esc(empSel)}</div>${oportun2.map(opCard).join("")}` : `<div class="empty">Esta empresa no tiene oportunidades con precio ahora.</div>`}
      ${panelHistorial()}
      ${panelLiquidacion(invTrab())}
      <div class="muted" style="font-size:.64rem;margin-top:8px">Montos según el Excel del negocio (inversionista ${PARAM_NEG.inversionista * 100}% de la utilidad final). Rentabilidad estimada; las transferencias las autoriza el dueño desde su banco.</div></div>`;
  }
  const FACT = "sdc:factorings";
  const factorings = () => { try { return JSON.parse(localStorage.getItem(FACT)) || []; } catch { return []; } };
  // 📒 ERP: libro de ventas y compras, IVA, flujo de caja y cómo separar la plata (3 cuentas)
  function libroERP(L) {
    const act = L.filter((t) => t.op?.oc_codigo || t.op?.oc);
    if (!act.length) return "";
    const S = act.reduce((a, t) => { const k = cuentasDe(t), op = t.op || {};
      a.v += k.venta; a.vn += k.ventaN; a.c += k.compra; a.f += k.flete; a.ivaD += k.ivaD; a.ivaC += k.ivaC; a.u += op.precio_acordado ? k.bruta : 0;
      if (!op.cobrado) a.cobrar += k.venta; if (op.precio_acordado && !op.proveedor_pagado) a.pagar += k.compra + k.flete; return a; },
      { v: 0, vn: 0, c: 0, f: 0, ivaD: 0, ivaC: 0, u: 0, cobrar: 0, pagar: 0 });
    const iva = S.ivaD - S.ivaC;
    return `<details class="rb-det rb-libro" ${R.libroEj ? "open" : ""} data-libroej><summary>📒 Libro y caja · ${act.length} OC · ventas ${cortoG(S.v)} · utilidad ${cortoG(S.u)}</summary>
      <table class="rb-copias"><tr><td>🧾 Ventas (OC)</td><td class="n">${clp(S.vn)} neto · ${clp(S.v)} total</td></tr>
        <tr><td>🛒 Compras acordadas</td><td class="n">${clp(netoDe(S.c))} neto · ${clp(S.c)} total</td></tr><tr><td>🚚 Fletes</td><td class="n">${clp(S.f)}</td></tr>
        <tr><td>🏛 IVA a pagar (débito − crédito)</td><td class="n"><b>${clp(iva)}</b></td></tr><tr><td>💰 Utilidad bruta (con compra acordada)</td><td class="n"><b class="${S.u >= 0 ? "rb-vivo-t" : "rb-neg-t"}">${clp(S.u)}</b></td></tr>
        <tr><td>⏳ Por cobrar al Estado</td><td class="n">${clp(S.cobrar)}</td></tr><tr><td>📤 Por pagar a proveedores y fletes</td><td class="n">${clp(S.pagar)}</td></tr></table>
      <div class="rb-sec">🏦 Separa la plata: 3 cuentas</div>
      <div class="muted" style="font-size:.72rem;line-height:1.5">1️⃣ <b>Cuenta corriente operativa</b> de la empresa: aquí paga el Estado y de aquí pagas proveedores y fletes.<br>
        2️⃣ <b>Cuenta de impuestos</b> (vista o ahorro): apenas cobras, aparta el IVA (${clp(iva)} ahora) y el PPM; se usa solo para el F29.<br>
        3️⃣ <b>Cuenta de utilidades e inversionista</b>: devuelves el capital del inversionista con su parte y guardas la utilidad de la empresa.</div>
      <div class="rb-sec">📊 Estado de resultados (todos los negocios)</div>
      <table class="rb-copias"><tr><td>Ingresos netos</td><td class="n">${clp(S.vn)}</td></tr><tr><td>− Costo de ventas</td><td class="n">${clp(-netoDe(S.c))}</td></tr><tr><td>− Despachos</td><td class="n">${clp(-S.f)}</td></tr>
        <tr><td><b>= Margen bruto</b></td><td class="n"><b class="${S.u >= 0 ? "rb-vivo-t" : "rb-neg-t"}">${clp(S.u)}</b></td></tr></table>
      <div class="muted" style="font-size:.68rem;margin-top:4px">🔐 Los pagos a proveedores los autoriza solo el dueño desde su banco; la plata del factoring llega a la cuenta operativa.</div>
      <details class="rb-det"><summary>💰 Factorings para pedir simulación (${factorings().length})</summary>
        <div class="muted" style="font-size:.7rem">Uno por línea: <b>Nombre | correo</b>. Desde cada negocio cerrado pides la simulación a todos con un toque.</div>
        <textarea class="rb-in" id="rbFactorings" rows="3" placeholder="Factoring Ejemplo | contacto@factoring.cl">${esc(factorings().map((f) => f.nombre + " | " + f.email).join("\n"))}</textarea>
        <button class="btn small" type="button" data-rb="ej-fact-guardar">Guardar</button></details>
      <div class="rb-row" style="margin-top:6px"><button class="btn small" type="button" data-rb="ej-csv">📊 Exportar libro (Excel / contador)</button><a class="btn small" href="https://www.sii.cl" target="_blank" rel="noopener">🏛 SII ↗</a></div></details>`;
  }
  // 📦 CONSOLIDADO: junta los cerrados de un período (default 5 días) y reparte todo junto (repartijo automático).
  //    Un "cerrado" es una compra que pasó por todo el proceso y el factoring YA te pagó.
  function cerradosPeriodo(L, dias) {
    const corte = Date.now() - dias * 864e5;
    return L.filter((t) => etEj(t) === "cerrado" && t.op?.cerrado && Date.parse(t.op.cerrado) >= corte)
            .sort((a, b) => Date.parse(b.op.cerrado) - Date.parse(a.op.cerrado));
  }
  function sumaConsolidado(items) {
    const S = { vn: 0, cn: 0, flete: 0, bruta: 0, inv: 0, comision: 0, gestion: 0, impuesto: 0, factoring: 0, final: 0 };
    for (const t of items) { const k = cuentasDe(t), inf = t.op?.informe || {};
      S.vn += k.ventaN; S.cn += netoDe(k.compra); S.flete += k.flete; S.bruta += k.bruta;
      S.inv += Number(inf.inversionista) || 0; S.comision += Number(inf.comision) || 0; S.gestion += Number(inf.julfior) || 0;
      S.impuesto += Number(inf.impuesto) || 0; S.factoring += Number(inf.factoring) || 0; S.final += Number(inf.final) || 0; }
    return S;
  }
  function barraConsolidado(L) {
    const dias = R.consDias || 5, items = cerradosPeriodo(L, dias);
    const btn = `<div class="rb-row" style="margin:8px 0"><button class="btn small ${R.consCerr ? "rb-oro" : ""}" type="button" data-rb="consolidar">📦 Consolidar últimos ${dias} días (${items.length})</button>${R.consCerr ? `<span class="rb-row" style="gap:4px">${[5, 7, 15, 30].map((d) => `<button class="btn small ${d === dias ? "rb-oro" : ""}" type="button" data-rb="cons-dias" data-d="${d}">${d}d</button>`).join("")}</span>` : ""}</div>`;
    if (!R.consCerr) return btn;
    if (!items.length) return btn + `<div class="empty">No hay cerrados en los últimos ${dias} días. Un «cerrado» es una compra que pasó por todo y el factoring ya te pagó.</div>`;
    const S = sumaConsolidado(items), f = (es) => new Date(es).toLocaleDateString("es-CL", { day: "numeric", month: "short" });
    const desde = f(items[items.length - 1].op.cerrado), hasta = f(items[0].op.cerrado);
    const fila = (a, b, fuerte) => `<tr><td>${a}</td><td class="n">${fuerte ? `<b class="${b >= 0 ? "rb-vivo-t" : "rb-neg-t"}">${clp(b)}</b>` : clp(b)}</td></tr>`;
    const rep = [["🏦 Inversionista", S.inv], ["🤝 Comisión", S.comision], ["🛠 Gestión", S.gestion], ["🏛 Impuesto estimado", S.impuesto], ["💰 Factoring", S.factoring]].filter((x) => x[1]);
    return btn + `<div class="rb-eerr">
      <div class="rb-env"><b>📦 Consolidado · ${items.length} cerrados</b><span class="muted">${desde} → ${hasta}</span></div>
      <table class="rb-copias">${fila("Ingresos (venta neta)", S.vn)}${fila("− Costo de compra (neto)", -S.cn)}${fila("− Despacho / flete", -S.flete)}${fila("= Margen bruto", S.bruta, 1)}</table>
      <div class="rb-sec">🤝 Repartijo automático</div>
      <table class="rb-copias">${rep.map(([a, b]) => fila(a, Math.round(b))).join("")}${fila("= Utilidad final de la empresa", Math.round(S.final), 1)}</table>
      <div class="rb-sec">Cerrados incluidos (${items.length})</div>
      <table class="rb-copias">${items.map((t) => `<tr><td>${esc((t.nombre || t.codigo).slice(0, 40))}<div class="muted" style="font-size:.66rem">${esc(t.codigo)} · ${f(t.op.cerrado)}</div></td><td class="n">${clp(Math.round((t.op?.informe || {}).final || 0))}</td></tr>`).join("")}</table>
      <div class="rb-row" style="margin-top:6px"><button class="btn small rb-firmar" type="button" data-rb="cons-csv" data-d="${dias}">📊 Exportar consolidado (Excel)</button></div>
      <div class="muted" style="font-size:.66rem;margin-top:4px">El repartijo es automático <b>por consolidado</b> (cada ${dias} días), no negocio por negocio: cada ${dias} días cierras el corte y cada socio recibe un solo pago. La frecuencia la defines tú según la liquidez.</div></div>`;
  }
  function portalEjecuta() {
    const yo = (R.ejecutores || {})[miJug()];
    if (!R.ejecutores) cargarEjecutores();
    if (!yo) return `<div class="rb-paso"><div class="rb-paso-n">🛠 Ejecuta</div><h2 class="rb-h">Hazte socio ejecutador</h2>
      <div class="muted rb-sub">Aquí llegan los negocios ganados que te asignen: negocias con proveedores, fijas el precio de compra, pides la transferencia, entregas y cierras con la guía y la factura firmadas.</div>
      <label class="rb-lab">Tu nombre<input class="rb-in" id="rbEjNom" value="${esc(persona()?.nombre || (dispositivo(false) === "iPhone" ? "" : dispositivo(false)))}" placeholder="Ej: Cristopher"></label>
      <label class="rb-lab">Tu WhatsApp<input class="rb-in" id="rbEjTel" inputmode="tel" value="${esc(persona()?.telefono || "")}" placeholder="+56 9 ..."></label>
      <button class="btn rb-oro rb-big-btn" type="button" data-rb="ej-registro">Entrar a Ejecuta</button></div>`;
    if (!R.ejec || Date.now() - (R.ejecT || 0) > 15000) setTimeout(cargarEjecuta, 0);
    const L = R.ejec || [], et = etEj;
    const tab = R.ejTab || "operacion";
    const cumplidos = L.filter((t) => et(t) === "cerrado" && t.op?.plazo_fecha && t.op?.cerrado && Date.parse(t.op.cerrado) <= Date.parse(t.op.plazo_fecha + "T23:59")).length;
    const atrasados = L.filter((t) => et(t) !== "cerrado" && t.op?.plazo_fecha && diasPlazo(t.op.plazo_fecha) < 0).length;
    const ahorro = L.reduce((s2, t) => s2 + (t.op?.informe?.compras && t.op?.precio_acordado ? t.op.informe.compras - t.op.precio_acordado : 0), 0);
    const cerr = L.filter((t) => et(t) === "cerrado").length;
    // 🎯 de a un negocio: abierto = solo ese (cada uno independiente); cerrado = una sola tarjeta para deslizar
    const abierto = R.ejec && L.find((t) => t.codigo === R.ejAbierto);
    if (abierto) {
      const mismos = L.filter((t) => et(t) === et(abierto)), i = mismos.indexOf(abierto);
      const ant = mismos[(i - 1 + mismos.length) % mismos.length], sig = mismos[(i + 1) % mismos.length];
      return `<div class="rb-foco"><button class="btn small" type="button" data-rb="ej-cerrar-card">← Todos</button>
        <span class="muted" style="font-size:.72rem">${(ETAPAS_EJ.find(([k]) => k === et(abierto)) || [])[1] || ""} · ${i + 1} de ${mismos.length}</span>
        ${mismos.length > 1 ? `<span><button class="btn small" type="button" data-rb="ej-ver" data-c="${esc(ant.codigo)}">◀</button> <button class="btn small" type="button" data-rb="ej-ver" data-c="${esc(sig.codigo)}">▶</button></span>` : "<span></span>"}</div>`
        + tarjetaEj(abierto);
    }
    return `<div class="rb-tira"><span>🛠 <b>${esc(yo.nombre)}</b></span><span>💰 <b class="${ahorro >= 0 ? "rb-vivo-t" : "rb-neg-t"}">${cortoG(ahorro)}</b> ahorro</span><span>🥇 <b>${cerr}</b>${cerr ? ` · ${cumplidos} a tiempo` : ""}</span><span>${atrasados ? `🔴 <b>${atrasados}</b> atrasado${atrasados > 1 ? "s" : ""}` : `⏳ <b>${L.length - cerr}</b>`}</span></div>
      ${libroERP(L)}
      <div class="rb-etapas">${ETAPAS_EJ.map(([k, n]) => `<button type="button" class="${tab === k ? "on" : ""}" data-rb="ej-tab" data-e="${k}">${n} ${L.filter((t) => et(t) === k).length}</button>`).join("")}</div>
      ${tab === "cerrado" ? barraConsolidado(L) : ""}
      ${!R.ejec ? `<div class="empty"><span class="spinner"></span></div>` : (() => {
        const luego = leerLuego(), resp = (t) => (t.op?.respuestas || []).filter((r) => !r.visto).length;
        const enTab = L.filter((t) => et(t) === tab).sort((a, b) => resp(b) - resp(a) || diasPlazo(a.op?.plazo_fecha) - diasPlazo(b.op?.plazo_fecha));
        if (!enTab.length) return `<div class="empty">${L.length ? "Nada en esta etapa." : "Aún no hay órdenes de compra. Cuando llegue una (o vayas 1°), queda anclada aquí sola."}</div>`;
        if (tab === "operacion") {   // 💼 Oportunidades de negocio: separadas en Con orden de compra vs Te pueden llamar
          const conOC = enTab.filter((t) => t.op?.oc_codigo || t.op?.oc);
          const llamar = enTab.filter((t) => !(t.op?.oc_codigo || t.op?.oc));
          const grupo = (titulo, arr) => arr.length ? `<div class="rb-sec">${titulo} · ${arr.length}</div>${arr.map(portadaEj).join("")}` : "";
          return grupo("📋 Con orden de compra", conOC) + grupo("📞 Te pueden llamar", llamar);
        }
        const ahora_ = enTab.filter((t) => !luego[t.codigo]), despues = enTab.filter((t) => luego[t.codigo]);
        const top = ahora_[0];
        return (top ? `<div class="muted" style="font-size:.72rem;text-align:center;margin:6px 0">Negocio <b>1 de ${ahora_.length}</b> · 👉 derecha = <b>ver ahora</b> · 👈 izquierda = <b>en otro momento</b></div>` + portadaEj(top)
            + (ahora_.length > 1 ? `<div class="rb-cola">${ahora_.slice(1).map((t) => `<button type="button" class="rb-cola-i" data-rb="ej-ver" data-c="${esc(t.codigo)}">${resp(t) ? '<i class="rb-luz"></i>' : ""}${esc((t.nombre || t.codigo).slice(0, 34))}</button>`).join("")}</div>` : "")
          : `<div class="empty">✅ Viste todos los de esta etapa.</div>`)
          + (despues.length ? `<details class="rb-det"><summary>⏰ Para después (${despues.length})</summary>${despues.map(portadaEj).join("")}</details>` : "");
      })()}`;
  }
  function vistaOport() {
    if (!R.oport) { cargarOport(); return `<div class="empty"><span class="spinner"></span> Cargando oportunidades…</div>`; }
    if ((R.oportViejo || Date.now() - (R.oportT || 0) > 10 * 60000) && !R._cargandoOport) setTimeout(cargarOport, 0);   // muestra lo guardado y actualiza por detrás
    const o = R.oport, ahora = Date.now();
    const tab = R.oportTab || "nuevas", filtro = R.oportFiltro || "real";
    // ---- 🎯 tu rubro: la base de todo. La primera vez se pregunta; después filtra y ordena las oportunidades
    const conf = leer();
    if (!conf.rubroListo || R.rubroEditar) return pantallaRubro(o.lista || []);
    const misR = new Set(conf.rubros || []), palabras = (conf.palabras || "").split(/[,;\n]+/).map(norm).filter((w) => w.length > 2);
    const mio = (x) => (!misR.size && !palabras.length) || misR.has(x.rubro) || (palabras.length && palabras.some((w) => norm(x.nombre).includes(w)));
    const lic = (x) => x.fuente === "licitacion";
    const trabajos = R.data?.trabajos || [];
    const vigente = (x) => Date.parse(x.cierre) - ahora > 30 * 60000;
    const lista = o.lista || [];
    const nuevas = lista.filter((x) => vigente(x) && !descartada(x.codigo) && !trabajo(x.codigo) && !x.ya_ofertada && !x.trabajada && !esSel(x.codigo) && !tomadaOtro(x.codigo));
    const ocultas = leerOcultas();
    const cierreDe = (t) => t.cierre || (lista.find((x) => x.codigo === t.codigo) || {}).cierre || (leerSel()[t.codigo] || {}).cierre;
    const cerrada = (t) => noFirmable(t)
      || (cierreDe(t) && Date.parse(cierreDe(t)) < ahora);
    const ultAct = (t) => Date.parse(t.actualizado || t.creado || 0) || 0;
    const oculto = (t) => { const o = ocultas[t.codigo]; return !!(o && (Date.parse(o) || 0) >= ultAct(t)); };   // si la ocultaste pero el robot la volvió a dejar lista DESPUÉS, reaparece
    const enFirma = trabajos.filter((t) => EN_FIRMA.includes(t.estado) && !oculto(t) && !yaFirmada(t) && !(cerrada(t) && !["tomado", "preparando"].includes(t.estado)));
    const aLimpiar = trabajos.filter((t) => EN_FIRMA.includes(t.estado) && !oculto(t) && !yaFirmada(t) && cerrada(t) && !["tomado", "preparando"].includes(t.estado));
    // 👀 listas REALES (el robot las dejó listas, con firma, no enviadas ni cerradas) que el estado local del celular esconde
    const ocultasListas = trabajos.filter((t) => ["firmar", "lista"].includes(t.estado) && t.firma?.precios?.length
      && !HECHA.includes(t.estado) && !(cerrada(t) && !["tomado", "preparando"].includes(t.estado)) && (oculto(t) || yaFirmada(t)));
    if (aLimpiar.length && !R._limpiando) { R._limpiando = true;
      setTimeout(async () => { for (const t of aLimpiar) await quitarFirma(t.codigo, null, "cerrada");
        toast(`🗑 Quité ${aLimpiar.length} compra${aLimpiar.length > 1 ? "s" : ""} ya cerrada${aLimpiar.length > 1 ? "s" : ""} de Firmar`); R._limpiando = false; }, 0); }
    const hechas = [...trabajos.filter((t) => HECHA.includes(t.estado) || yaFirmada(t)),
      ...lista.filter((x) => (x.ya_ofertada || x.trabajada) && !trabajo(x.codigo)).map((x) => ({ ...x, _oport: true }))];
    const papelera = lista.filter((x) => descartada(x.codigo));
    const esSeg = (x) => /^segundo/i.test(x.llamado || "");
    // 🏆 PRE-FILTRO GANADOR: solo pasan las que se pueden ganar Y dejan plata (las demás quedan fuera con su motivo)
    if (tab === "nuevas") cargarMercado();
    const evaluar = (x) => {
      const pres = Number(x.monto) || 0, hrs = (Date.parse(x.cierre) - ahora) / 3600000, seg = esSeg(x), of = x.ofertas ?? null, fuera = [];
      if (lic(x)) fuera.push("licitación (otro flujo)");
      if (x.tipo === "esp") fuera.push("especializado: difícil de abastecer a buen precio");
      else if ((x.viab ?? 1) < 0.85) fuera.push("rubro no reconocido: no sabemos abastecerlo bien");
      else if ((x.margen ?? 1) < 0.2) fuera.push("rubro de margen bajo (tecnología y similares)");
      if (pres && pres < MIN_PRES) fuera.push("compra chica: el despacho y los costos fijos se comen la utilidad");
      if (pres > TOPE_CA()) fuera.push("sobre 100 UTM");
      if (hrs < 6) fuera.push("cierra en menos de 6 h");
      if (!seg && of != null && of >= 6) fuera.push(`guerra de precios: ya hay ${of} cotizaciones`);
      const mk = (R.mercado || {})[x.codigo]; let m = null, util = null;
      const dudoso = mkDudoso(mk, pres);
      if (mk && pres && !dudoso) { const costo = mk.total_neto || (mk.total_con_iva || 0) / 1.19, venta = pres * (1 - (seg ? 0.02 : 0.06)) / 1.19;
        util = venta - costo - fijosDe(pres); m = venta ? util / venta : null;
        if (m != null && m < MARGEN_MIN) fuera.push(`no da: con el costo de mercado (${clp(mk.total_con_iva)}) queda ${Math.round(m * 100)}% de margen`); }
      return { fuera, m, util, mk, dudoso };
    };
    const EV = {}; for (const x of nuevas) EV[x.codigo] = evaluar(x);
    const EVg = (x) => EV[x.codigo] || evaluar(x);
    const reales = nuevas.filter((x) => mio(x) && !EV[x.codigo].fuera.length);
    const descartadas = nuevas.filter((x) => mio(x) && EV[x.codigo].fuera.length);
    const motivos = {}; for (const x of descartadas) { const k = EV[x.codigo].fuera[0].split(":")[0]; motivos[k] = (motivos[k] || 0) + 1; }
    const verif = reales.filter((x) => EV[x.codigo].m != null).length;
    // orden de prioridad (el mismo que usa el PC para verificar costos): 2° llamado, poca competencia, lo que ya vendemos, ganancia
    const prio = (x) => (esSeg(x) ? 4 : 0) + ((x.ofertas ?? 3) <= 1 ? 2 : (x.ofertas ?? 3) <= 3 ? 1 : 0) + (x.tipo === "exp" ? 2 : x.tipo === "rev" ? 1 : 0) + Math.min(2, (x.ganancia || 0) / 500000);
    const okV = reales.filter((x) => EV[x.codigo].m != null).sort((a, b) => EV[b.codigo].util - EV[a.codigo].util);
    const porV = reales.filter((x) => EV[x.codigo].m == null).sort((a, b) => prio(b) - prio(a));
    const esperan = Math.max(0, porV.length - 8);
    // 🔎 buscador por palabras clave: busca en TODAS las oportunidades (no solo en el filtro elegido)
    const qO = norm(R.oportQ || "").trim(), qW = qO.split(/[^a-z0-9ñ-]+/).filter((w) => w.length > 1);
    const pajaO = (x) => norm([x.codigo, x.nombre, x.organismo, x.descripcion, x.detalle, x.region, x.comuna, x.direccion, x.rubro, x.categoria,
      ...(Array.isArray(x.productos) ? x.productos.map((i) => i?.nombre || i?.descripcion || i) : []), ...(Array.isArray(x.items) ? x.items.map((i) => i?.nombre || i?.descripcion || i) : [])]
      .filter((v) => typeof v === "string").join(" "));
    const calzaO = (x) => { const h = pajaO(x); return qW.every((w) => h.includes(w) || (w.length > 4 && h.includes(w.replace(/(es|s)$/, "")))); };
    const verN = qW.length ? nuevas.filter(calzaO).sort((a, b) => (b.ganancia || 0) - (a.ganancia || 0))
      : filtro === "real" ? [...okV, ...porV.slice(0, 8)]
      : filtro === "fuera" ? descartadas
      : nuevas.filter((x) => (filtro === "todas" || mio(x)) && (filtro === "lic" ? lic(x) : !lic(x) && (filtro === "seg" ? esSeg(x) && x.tipo !== "esp"
      : filtro === "exp" ? x.tipo === "exp" : x.tipo !== "esp")))
      .sort((a, b) => { const poca = (x) => esSeg(x) && (x.ofertas ?? 9) <= 2;   // 2° llamado primero; los casi sin competencia, más arriba
        return (poca(b) - poca(a)) || (esSeg(b) - esSeg(a)) || (b.ganancia || 0) - (a.ganancia || 0); });
    const n = R.oportN || 40;
    const color = { exp: "#ffd88a", rev: "#9cc3ff", srv: "#d9c9ff", esp: "#999" };
    const fila = (x, modo) => {
      const h = Math.round((Date.parse(x.cierre) - ahora) / 3600000);
      return `<div class="rb-card rb-swipe" data-c="${esc(x.codigo)}" data-lic="${lic(x) ? 1 : ""}" data-modo="${modo}" style="padding:10px 12px;margin:6px 0">
        <span class="rb-sello si">${modo === "papelera" ? "RECUPERAR" : "SÍ"}</span><span class="rb-sello no">NO</span>
        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="min-width:42px;text-align:center"><b style="font-size:1.25rem">${x.puntaje ?? "—"}</b><div class="muted" style="font-size:.65rem">nota</div>
            ${lic(x) || modo === "papelera" ? "" : `<button type="button" class="rb-estrella ${esSel(x.codigo) ? "on" : ""}" data-rb="oport-sel" data-c="${esc(x.codigo)}" title="Seleccionar">${esSel(x.codigo) ? "★" : "☆"}</button>`}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:.78rem"><b>${esc(x.codigo)}</b> · ${lic(x) ? "📑 " : ""}<span style="color:${color[x.tipo] || "#999"}">${esc(x.etiqueta || "")}</span> · ${esc(x.rubro || "")}</div>
            <div class="rb-fnom">${esc(x.nombre)}</div>
            <div class="muted" style="font-size:.75rem">${/^segundo/i.test(x.llamado || "") ? `<b style="color:#ffb347">🔥 2° llamado</b>${(x.ofertas ?? 9) <= 2 ? '<span class="rb-chip">🎯 casi sin competencia</span>' : ""} · ` : ""}${esc(x.organismo)}${x.region ? " · " + esc(x.region.replace(/^Región (de |del |de la )?/i, "")) : ""}${x.ofertas != null && !lic(x) ? ` · ${x.ofertas ? x.ofertas + " cotizaciones" : "sin cotizaciones aún"}` : ""}</div>
            ${(() => { const e = EVg(x); if (!e || lic(x)) return "";
              return e.fuera.length ? `<div class="rb-chip-no">🚫 ${esc(e.fuera[0])}</div>` : e.dudoso ? `<div class="rb-chip-esp">⚠ Costo IA dudoso (${clp(e.mk.total_con_iva)} para Ppto. ${clp(x.monto)}): faltan cantidades, no lo cuento como verificado</div>` : e.m != null ? `<div class="rb-chip-si">✅ Da: ${Math.round(e.m * 100)}% de margen con costo real (${clp(e.mk.total_con_iva)}) · utilidad ≈ <b>${clp(e.util)}</b></div>` : `<div class="rb-chip-esp">⏳ Pasa el filtro · el PC está verificando el costo real</div>`; })()}
            <div style="font-size:.8rem;margin-top:3px">Gana ≈ <b class="rb-vivo-t" style="font-size:.95rem">${clp(x.ganancia)}</b> · Ppto. ${clp(x.monto)}${x.monto_estimado ? " (estimado)" : ""} · <span style="${h < 12 ? "color:#ff8a80;font-weight:700" : ""}">cierra en ${h} h</span></div>
          </div></div>
        <div class="row" style="margin-top:6px;gap:6px">${modo === "papelera"
          ? `<button class="btn small rb-firmar" type="button" data-rb="oport-restaurar" data-c="${esc(x.codigo)}">↩ Recuperar</button>`
          : `<button class="btn small" type="button" data-rb="oport-no" data-c="${esc(x.codigo)}">✕ No</button>
             <button class="btn small rb-firmar" type="button" data-rb="oport-si" data-c="${esc(x.codigo)}">${lic(x) ? "📑 Participar" : "✍ Preparar"}</button>`}
          <a class="btn small" href="${lic(x) ? `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(x.codigo)}` : portalDe(x.codigo)}" target="_blank" rel="noopener noreferrer">Ver ↗</a></div></div>`;
    };
    const hecha = (x) => x._oport
      ? `<div class="rb-card" style="padding:8px 12px;margin:6px 0;opacity:.8"><div style="font-size:.78rem"><b>${esc(x.codigo)}</b> · ${x.ya_ofertada ? "ya ofertada en el portal" : "trabajada por el robot"}</div><div>${esc(x.nombre)}</div></div>`
      : caja(x);
    const ordenF = (t) => ["firmar", "lic_revisar", "lic_lista", "lista"].includes(t.estado) ? 0 : ["requiere", "error"].includes(t.estado) ? 1 : 2;
    const selObj = leerSel();
    const enviadasCods = new Set(trabajos.filter((t) => HECHA.includes(t.estado) || yaFirmada(t)).map((t) => t.codigo));
    // Seleccionadas: las que elegiste y todavía no van al robot (cuando las mandas a firmar pasan a «Por firmar»)
    const selCerr = Object.keys(selObj).filter((c) => { const x = { ...selObj[c], ...(lista.find((y) => y.codigo === c) || {}) }; return x.cierre && Date.parse(x.cierre) < ahora; });
    if (selCerr.length && !R._limpSel) { R._limpSel = true;
      setTimeout(async () => { for (const c of selCerr) await quitarSel(c).catch(() => {}); toast(`🗑 Saqué ${selCerr.length} compra${selCerr.length > 1 ? "s" : ""} ya cerrada${selCerr.length > 1 ? "s" : ""}`); R._limpSel = false; pintarHoja(); }, 0); }
    const sel = Object.keys(selObj).filter((c) => !selCerr.includes(c) && deMiEmpresa(selObj[c]) && !(R.selFuera || {})[c] && !enviadasCods.has(c) && !trabajo(c) && !tomadaOtro(c) && !lista.find((x) => x.codigo === c && x.ya_ofertada))
      .map((c) => ({ ...selObj[c], ...(lista.find((x) => x.codigo === c) || {}), codigo: c, _sel: selObj[c] }))
      .sort((a, b) => (b._sel.desde || "").localeCompare(a._sel.desde || ""));        // la última que elegiste, primero
    if (!R.sel && !R._selPedido) { R._selPedido = true; cargarSel().then(pintarHoja); }
    const enviadosAll = trabajos.filter((t) => HECHA.includes(t.estado) || yaFirmada(t)).sort((a, b) => (b.actualizado || "").localeCompare(a.actualizado || ""));
    if ((tab === "hechas" || tab === "ganadas" || !R.seg) && enviadosAll.length && (!R.segT || Date.now() - R.segT > 60_000)) cargarSeg(false);
    const ganadasT = enviadosAll.filter((t) => segDe(t.codigo)?.ganada || t.op?.etapa === "previa" || t.op?.oc_codigo || t.externa);   // 📞 previa: vas 1°, antes de la OC
    const enviadosT = enviadosAll.filter((t) => !segDe(t.codigo)?.ganada);
    const tabs = [["nuevas", "👆 Por preparar", nuevas.length], ["sel", "⭐ Seleccionadas", sel.length], ["firmar", "✍ Por firmar", enFirma.length],
      ["hechas", "📨 Enviadas", enviadosT.length], ["ganadas", "🏆 Ganadas", ganadasT.length], ["papelera", "🗑 No deseadas", papelera.length]];
    const tarjetaSel = (x) => {
      const pres = Number(x.monto) || 0;
      const margenRubro = Number(x._sel.margen ?? x.margen) || 0.2;
      const costoEst = Math.round(pres / 1.19 * (1 - margenRubro));
      const mk0 = (R.mercado || {})[x.codigo], mk = mkDudoso(mk0, pres) ? null : mk0, costoMk = mk ? Math.round(mk.total_neto || (mk.total_con_iva || 0) / 1.19) : 0;
      const costo = Number(x._sel.costo) || costoMk || 0;
      const real = !!costo, piso = pisoDe(costo || costoEst, pres);
      // 1er llamado: tope = el presupuesto · 🔥 2° llamado: se desbloquea, se puede ofertar sobre el presupuesto hasta 100 UTM
      const tope = esSeg(x) ? TOPE_CA() : Math.min(pres, TOPE_CA()), precio0 = Math.round(Math.min(x._sel.precio || Math.max(pres * (1 - sugerido(x).d), real ? piso : 0), tope));
      const h = x.cierre ? Math.round((Date.parse(x.cierre) - ahora) / 3600000) : null;
      const of = x.ofertas ?? null, seg = esSeg(x);
      const rival = of === 0 ? `<span class="rb-rival solo">🎯 Vas solo</span>` : of != null && of <= 2 ? `<span class="rb-rival pocos">${of} rival${of === 1 ? "" : "es"}</span>`
        : of != null ? `<span class="rb-rival muchos">${of} rivales</span>` : "";
      const sg = sugerido(x), vSug = Math.min(tope, Math.max(Math.round(pres * (1 - sg.d) / 10) * 10, real ? piso : 0));
      const noDa = real && piso > tope;
      const chipMk = mk ? `<div class="rb-mkc ${noDa ? "mal" : ""}">💹 <b>Costo de mercado ${clp(mk.total_con_iva || costoMk * 1.19)}</b> c/IVA <span>(IA, ${mk.items?.reduce((s2, i) => s2 + (i.f || 0), 0) || "varias"} tiendas${mk.completo ? "" : ", incompleto"})</span><br>
          ${noDa ? `🔴 <b>No da:</b> para ganar plata necesitas cobrar al menos ${clp(piso)} y el tope es ${clp(tope)}. Pasa o busca otro proveedor.` : `🛡 Piso para ganar plata: <b>${clp(piso)}</b> (costo + despacho + ${Math.round(MARGEN_MIN * 100)}% mínimo)`}</div>`
        : mk0 ? `<div class="rb-mkc espera">⚠ La IA dio un costo que no cuadra (${clp(mk0.total_con_iva)} para un presupuesto de ${clp(pres)}): probablemente sin cantidades. Escribe tu costo real en «✎ Mi costo».</div>`
        : `<div class="rb-mkc espera">⏳ El PC está buscando el <b>costo real</b> en tiendas (aparece en unos minutos). Mientras, el costo es estimado.</div>`;
      return `<div class="rb-card rb-sel rb-swipe" data-modo="sel" data-c="${esc(x.codigo)}" data-pres="${pres}" data-costo="${costo || costoEst}" data-piso="${piso}" data-real="${real ? 1 : ""}" data-est="${costo ? 0 : 1}" data-of="${of ?? ""}" data-seg="${seg ? 1 : ""}" style="padding:14px;margin:6px 0">
        <span class="rb-sello si">APUESTO</span><span class="rb-sello no">PASO</span>
        <div class="rb-env"><div style="min-width:0"><div style="font-size:.76rem;opacity:.85"><b>${esc(x.codigo)}</b>${seg ? ` · <b style="color:#ffb347">🔥 2° llamado</b>` : ""}${h != null ? ` · <span style="${h < 12 ? "color:#ff8a80;font-weight:700" : ""}">cierra en ${h} h</span>` : ""}</div>
          <div style="margin:3px 0;font-weight:600">${esc(x.nombre || "Compra Ágil")}</div><div class="muted" style="font-size:.74rem">${esc(x.organismo || "")} · Ppto. <b>${clp(pres)}</b> ${rival}</div></div>
          <button type="button" class="rb-estrella on" data-rb="sel-quitar" data-c="${esc(x.codigo)}" title="Devolver a Por preparar">★</button></div>
        ${pres ? chipMk : ""}
        ${pres ? `<div style="margin-top:12px;display:flex;justify-content:space-between;align-items:flex-end;gap:8px"><div><span class="muted" style="font-size:.72rem;letter-spacing:.06em;text-transform:uppercase">Tu apuesta (con IVA)</span><br><span class="rb-precio rb-oro-t">${clp(precio0)}</span></div><span class="rb-pct"></span></div>
        <input type="range" class="rb-range" min="0" max="1000" step="1" data-lo="${Math.round(pres * 0.5)}" data-mid="${Math.round(Math.min(pres * 1.5, tope))}" data-hi="${tope}" value="0" data-v0="${precio0}">
        ${tope > pres * 1.5 ? `<div class="rb-escala" style="position:relative;display:block;height:15px"><span style="position:absolute;left:0">−50%</span><span style="position:absolute;left:37.5%;transform:translateX(-50%)">Ppto. ${cortoG(pres)}</span><span style="position:absolute;left:75%;transform:translateX(-50%)">+50%</span><span style="position:absolute;right:0;color:#f5cf6b">100 UTM</span></div>`
          : `<div class="rb-escala"><span>−50%</span><span>Ppto. ${cortoG(pres)}</span><span>${tope <= pres ? "tope" : tope < pres * 1.5 ? "100 UTM" : "+50%"}</span></div>`}
        <div class="rb-ticket">
          <div class="t"><span>🎰 Ticket de inversión</span><span class="rb-cuota">x—</span></div>
          <div class="g"><div><small>Inviertes</small><b class="rb-inv">—</b></div><div class="flecha">➜</div><div><small>Te pagan (neto)</small><b class="rb-neto">—</b></div></div>
          <div class="rb-prob"><i style="width:0"></i></div>
          <div class="rb-env" style="font-size:.72rem;opacity:.85"><span>Prob. de ganar (estimada) <b class="rb-pg">—</b></span><span>Margen <b class="rb-mar">—</b></span></div>
          <div class="rb-si-ganas"><div><div style="font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;opacity:.75">Si ganas te llevas</div><b class="rb-gan rb-vivo-t">—</b></div>
            <div style="text-align:right;font-size:.72rem;opacity:.85">Valor esperado<br><b class="rb-ev" style="font-size:.95rem">—</b></div></div>
        </div>
        <div class="rb-chips2"><button class="btn small" type="button" data-paso="-1">−1%</button>
          <button class="btn small rb-sugb" type="button" data-fijo="${vSug}" title="${esc(sg.por)}">💡 ${cortoG(vSug)}</button>
          <button class="btn small rb-soltar ${of != null && of <= 1 ? "brilla" : ""}" type="button" data-fijo="${pres}">🔓 Todo ${cortoG(pres)}</button>
          ${tope > pres ? `<button class="btn small rb-soltar" type="button" style="grid-column:1/-1;order:9" data-fijo="${tope}" title="Tope legal de la Compra Ágil">🚀 Soltar hasta 100 UTM · ${clp(tope)}</button>` : `<span class="muted" style="grid-column:1/-1;order:9;font-size:.68rem;text-align:center">🔒 1er llamado: el tope es el presupuesto · en 2° llamado se desbloquea hasta 100 UTM</span>`}
          <button class="btn small" type="button" data-paso="1">+1%</button></div>
        <div class="muted" style="font-size:.7rem;margin-top:4px">💡 ${esc(sg.por)}</div>
        <details class="rb-det"><summary>✎ Mi costo: <b class="rb-cvis">${clp(costo || costoEst)}</b> <span class="rb-cest">${Number(x._sel.costo) ? "(tuyo)" : costoMk ? "(mercado, IA)" : `(estimado ${Math.round(margenRubro * 100)}% margen)`}</span></summary>
          <input class="rb-costo rb-in" inputmode="numeric" value="${(costo || costoEst).toLocaleString("es-CL")}" style="margin-top:6px"></details>
        <div class="rb-bajo" style="display:none;color:#ff9a9a;font-size:.78rem;margin-top:6px">🔴 Bajo el piso (${clp(piso)}): ganarías la compra pero <b>perderías plata</b>. Sube la apuesta o consigue mejor costo.</div>
        ${tiraBorrador(x)}
        <div class="rb-sobre muted" style="display:none;color:#ffd88a;font-size:.78rem;margin-top:6px">⚠ Sobre el presupuesto (${clp(pres)}): se oferta igual, hasta el tope de 100 UTM (${clp(tope)}). El organismo puede preferir una más barata.</div>
        <button class="btn rb-firmar" type="button" style="width:100%;margin-top:10px;padding:14px;font-size:1rem" data-rb="sel-preparar" data-c="${esc(x.codigo)}">✍ Apostar y firmar <span class="rb-p2">${clp(precio0)}</span></button>
        <div class="muted" style="font-size:.68rem;margin-top:5px;text-align:center">el robot arma cotización y PDF y la deja en ✍ Firmar</div>`
        : `<div class="muted" style="margin-top:8px">Sin presupuesto conocido: abre la compra para ver el monto.</div>`}
      </div>`;
    };
    // ---- 🎯 precio sugerido según el llamado y la competencia (lección: en 2° llamado casi nadie compite)
    const sugerido = (x) => {
      const seg = esSeg(x), of = x.ofertas ?? null;
      let d = seg ? (of === 0 ? 0 : of === 1 ? 0.02 : of != null && of <= 3 ? 0.04 : 0.07) : (of != null && of <= 1 ? 0.04 : of != null && of <= 3 ? 0.06 : 0.09);
      const ic = intel(), mr = (seg ? ic.medSeg : ic.medPri) ?? ic.med;
      if (ic.n >= 3 && mr != null && !(seg && of === 0)) d = Math.max(0, Math.min(0.35, (d + (1 - mr + 0.01)) / 2));   // mezcla: regla + lo que realmente gana
      const por = seg ? (of === 0 ? "2° llamado y nadie ha cotizado: oferta el presupuesto completo"
        : of != null && of <= 3 ? `2° llamado con solo ${of} cotización${of === 1 ? "" : "es"}: pocos compiten, no regales margen`
        : "2° llamado: menos competencia que en el primero") : (of != null && of <= 3 ? `Primer llamado con ${of} cotizaciones` : "Primer llamado: más competencia, baja un poco más");
      return { d, por: por + (ic.n >= 3 && mr != null ? ` · 🧠 los que ganan cotizan ~${Math.round((1 - mr) * 100)}% bajo el presupuesto (${ic.n} casos)` : "") };
    };
    // ---- marcador: lo que motiva (ganado, utilidad, tasa de éxito, en juego)
    const decididas = enviadosAll.filter((t) => { const g = segDe(t.codigo); return g && (g.ganada || g.estado === "proveedor_seleccionado"); });
    const ganadasR = ganadasT.filter((t) => t.op?.etapa !== "previa");          // ya adjudicadas (sin las «vas 1°»)
    const ganadoMonto = ganadasR.reduce((s, t) => s + (Number(t.total) || 0), 0);
    const utilOk = (t) => t.op?.informe && !t.op.informe.incompleto && t.op.informe.final != null;
    const utilidadG = ganadasR.reduce((s, t) => s + (utilOk(t) ? Number(t.op.informe.final) : Math.round((Number(t.total) || 0) * 0.13)), 0);
    const enJuego = enviadosAll.filter((t) => ["publicada", "cerrada"].includes(segDe(t.codigo)?.estado)).reduce((s, t) => s + (Number(t.total) || 0), 0);
    const tasa = decididas.length ? Math.round(ganadasR.length / decididas.length * 100) : null;
    const corto = (n) => n >= 1e6 ? "$" + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + "M" : clp(n);
    // cartera: lo ofertado acumulado en el tiempo (la curva que crece)
    const puntos = (() => {
      const xs = [...enviadosAll].filter((t) => t.total).sort((a, b) => (a.actualizado || "").localeCompare(b.actualizado || ""));
      let acc = 0; const ys = xs.map((t) => (acc += Number(t.total) || 0));
      if (ys.length < 2) return "";
      const W = 300, H = 46, max = ys[ys.length - 1] || 1;
      const pts = ys.map((y, k) => [k / (ys.length - 1) * W, H - 4 - y / max * (H - 8)]);
      const linea = pts.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" ");
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="rbG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5cf6b" stop-opacity=".45"/><stop offset="1" stop-color="#f5cf6b" stop-opacity="0"/></linearGradient></defs>
        <polygon points="0,${H} ${linea} ${W},${H}" fill="url(#rbG)"/><polyline points="${linea}" fill="none" stroke="#f5cf6b" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
        <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3.5" fill="#fff6d6"/></svg>`;
    })();
    const cartera = enviadosAll.reduce((s, t) => s + (Number(t.total) || 0), 0);
    const semana = enviadosAll.filter((t) => Date.now() - Date.parse(t.actualizado || 0) < 7 * 86400000).reduce((s, t) => s + (Number(t.total) || 0), 0);
    const marcador = `<div class="rb-marcador">
      <div class="rb-cartera"><div class="rb-ctop"><div><span style="font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;opacity:.8">💼 Tu cartera ofertada</span><br>
        <b class="rb-oro-t" data-cnt="${cartera}" data-k="cartera" data-fmt="corto">${corto(cartera)}</b></div>
        <div style="text-align:right"><span class="rb-up">▲ ${corto(semana)}</span><div style="font-size:.66rem;opacity:.75">esta semana</div></div></div>${puntos}</div>
      <div class="rb-m oro"><span>🏆 Ganado</span><b class="rb-oro-t" data-cnt="${ganadoMonto}" data-k="ganado" data-fmt="corto">${corto(ganadoMonto)}</b><small>${ganadasR.length} adjudicada${ganadasR.length === 1 ? "" : "s"}</small></div>
      <div class="rb-m verde"><span>💰 Utilidad</span><b data-cnt="${utilidadG}" data-k="util" data-fmt="corto">${corto(utilidadG)}</b><small>${ganadasR.length && ganadasR.every(utilOk) ? "según informes" : "estimada · faltan precios"}</small></div>
      <div class="rb-m azul"><span>🎯 Tasa de éxito</span><b data-cnt="${tasa ?? 0}" data-k="tasa" data-fmt="pct">${tasa == null ? "—" : tasa + "%"}</b><small>${ganadasR.length} de ${decididas.length} resueltas</small></div>
      <div class="rb-m violeta"><span>⏳ En juego</span><b data-cnt="${enJuego}" data-k="juego" data-fmt="corto">${corto(enJuego)}</b><small>${enviadosAll.length - decididas.length} esperando resultado</small></div></div>${exitosBox(ganadasR, ganadoMonto, utilidadG)}${libroJuego(ganadasR, enviadosAll)}`;
    // ---- 🏆 negocios ganados por etapa
    const ETAPAS = [["previa", "📞 Vas 1°"], ["ganada", "🆕 OC ¿nos da?"], ["inversionista", "💼 Inversión"], ["operacion", "🛠 Proveedor"], ["transporte", "🚚 Transporte"], ["pago", "💳 Pagar"], ["documentos", "🧾 Guía y factura"],
      ["despacho", "🚚 Despacho"], ["entrega", "📸 Entrega"], ["cerrado", "🥇 Cerrados"], ["rechazada", "❌ No dio"]];
    const etapaDe = (t) => t.op?.etapa || "ganada";
    // 🧾 datos listos para el Sistema de Facturación Gratuito del SII (guía de despacho 52 y factura 33)
    const docsSII = docsSIIg;
    const netapa = R.netapa || (ganadasT.some((t) => t.op?.etapa === "previa") ? "previa" : "ganada");
    const tel = (n) => String(n || "").replace(/[^\d+]/g, "");
    const wa = (n) => { let d = String(n || "").replace(/\D/g, ""); if (d.length === 9 && d[0] === "9") d = "56" + d; if (d.length === 8) d = "569" + d; return d.length >= 10 ? d : ""; };
    const correo = (t, o) => {
      const inf = t.op?.informe || {};
      const lineas = (inf.productos || []).map((x) => `- ${x.cantidad} x ${x.nombre}${x.descripcion ? " (" + x.descripcion.slice(0, 90) + ")" : ""}`).join("\n");
      const cuerpo = `Hola${o.contacto ? " " + o.contacto : ""},\n\nNecesito cotización con factura de:\n${lineas}\n\nEntrega en: ${inf.direccion || ""} en ${inf.plazo_dias || "pocos"} días.\n` +
        `¿Me puedes indicar precio unitario, descuento por volumen o pago contado, plazo y costo de despacho?\n\nGracias,\n${R.data?.robot?.empresa || ""}`;
      return `mailto:${encodeURIComponent(o.email || "")}?subject=${encodeURIComponent("Cotización " + (t.nombre || t.codigo))}&body=${encodeURIComponent(cuerpo)}`;
    };
    const negocioCard = (t) => {
      const g = segDe(t.codigo) || {}, op = t.op || {}, inf = op.informe || {}, et = etapaDe(t);
      const idx = ETAPAS.findIndex(([k]) => k === et);
      const docs = (op.docs || []).map((d) => `<button class="btn small" type="button" data-rb="neg-doc" data-c="${esc(t.codigo)}" data-id="${esc(d.id)}">${d.tipo === "foto" ? "📸" : d.tipo === "guia" ? "🚚" : d.tipo === "factura" ? "🧾" : "📎"} ${esc(d.nombre).slice(0, 22)}</button>`).join("");
      const dejado = g.dejado ?? inf.dejado;
      const num = (v) => v == null ? "—" : clp(v);
      let cuerpoE = "";
      const btnInf = op.pedido_informe ? `<span class="muted" style="font-size:.74rem">⟳ el PC está armando el informe (proveedores y utilidad)…</span>`
        : `<button class="btn small" type="button" data-rb="neg-informe" data-c="${esc(t.codigo)}">${inf.final != null ? "↻ Recalcular" : "🧮 Armar informe"}</button>`;
      const archivos = inf.final != null ? `<button class="btn small rb-firmar" type="button" data-rb="neg-archivo" data-t="informe" data-c="${esc(t.codigo)}">📄 Informe PDF</button>
        <button class="btn small" type="button" data-rb="neg-archivo" data-t="excel" data-c="${esc(t.codigo)}">📊 Excel utilidad</button>` : "";
      if (et === "previa") {
        const emp = empresaActual() || {}, F = (R.fichas || {})[t.codigo];
        if (!F && !(R._pidiendo || {})[t.codigo]) setTimeout(() => cargarDocs(t.codigo), 0);
        const plazo = t.plazo || (F?.plazo_dias ? F.plazo_dias + " días" : "el plazo ofertado");
        const guion = `Hola, sí, le habla ${persona()?.nombre || emp.contacto || ""} de ${emp.razon_social || "nuestra empresa"}${emp.rut ? " (RUT " + emp.rut + ")" : ""}. Cotizamos la Compra Ágil ${t.codigo}${t.nombre ? " «" + t.nombre + "»" : ""} por ${clp(t.total)} con IVA, con entrega en ${plazo}${F?.direccion ? " en " + F.direccion : ""}. Confirmamos que tenemos disponibilidad y podemos cumplir. ¿Necesita algún dato o documento adicional para seleccionarnos?`;
        const ventaja = g.siguiente && g.mi_total ? g.siguiente - g.mi_total : null;
        cuerpoE = `<div class="rb-sug" style="border-color:#5ef0b0">📞 <b>Vas 1° en el portal${g.competidores ? ` de ${g.competidores}` : ""}</b>: el organismo te puede llamar o seleccionar en cualquier momento. Todo está preparado de antes.</div>
          <div class="rb-mini"><div><small>Tu oferta</small><b>${clp(g.mi_total || t.total)}</b></div><div><small>Presupuesto</small><b>${clp(g.presupuesto)}</b></div>
            <div><small>2° más barato</small><b>${clp(g.siguiente)}</b></div><div><small>Ventaja</small><b style="color:#7ee2a0">${ventaja != null ? clp(ventaja) : "—"}</b></div></div>
          <div class="rb-sec">🗣 Qué decir si te llaman</div><div class="rb-wa">${esc(guion)}</div>
          <div class="rb-row"><button class="btn small" type="button" data-rb="cp" data-v="${esc(guion)}">Copiar</button><button class="btn small rb-oro" type="button" data-rb="llamada-cod" data-c="${esc(t.codigo)}">📞 Me están llamando de esta</button></div>
          <details class="rb-det"><summary>💡 Si te preguntan…</summary><div class="muted" style="font-size:.74rem;line-height:1.5">
            • <b>¿Pueden bajar el precio?</b> No se cambia lo ofertado en el portal; ofrece mejor plazo o despacho incluido.<br>
            • <b>¿Cumplen la marca / especificación?</b> Revisa la ficha técnica que enviaste (📄 abajo) antes de responder.<br>
            • <b>¿Cuándo entregan?</b> ${esc(plazo)} desde que llegue la orden de compra.<br>
            • <b>Te seleccionan:</b> el robot te avisa y pasa a «🆕 OC ¿nos da?»; acepta la OC en Mercado Público cuando llegue.</div></details>
          ${(inf.opciones || []).length ? `<div class="rb-sec">🛒 Proveedores ya cotizados</div>${inf.opciones.map((o) => `<div class="rb-op"><div class="rb-env"><b>${esc(o.proveedor || "")}${chipLocal(o)}</b><b>${num(o.total_con_iva)}</b></div>
            <div class="rb-acc">${tel(o.telefono) ? `<a class="btn small" href="tel:${esc(tel(o.telefono))}">📞</a>` : ""}${wa(o.telefono) ? `<a class="btn small" href="https://wa.me/${wa(o.telefono)}" target="_blank" rel="noopener">💬</a>` : ""}<a class="btn small" href="${correo(t, o)}">✉ Confirmar stock</a></div></div>`).join("")}` : ""}
          ${bloqueMarket((inf.productos || []).length ? inf.productos : (F?.productos || []), lugarDe(t))}
          <div class="rb-acc">${archivos}${btnInf}${t.pdf ? `<button class="btn small" type="button" data-rb="pdf" data-c="${esc(t.codigo)}">📄 Mi oferta (PDF)</button>` : ""}${t.comprobante ? `<button class="btn small" type="button" data-rb="comprobante" data-c="${esc(t.codigo)}">🧾 Comprobante</button>` : ""}</div>`;
      }
      else if (et === "ganada") cuerpoE = (R.ocNo || {})[t.codigo] ? `<div class="rb-sec">¿Por qué no da?</div>
          <textarea class="rb-in" id="rbNo-${esc(t.codigo)}" rows="2" placeholder="Ej: el proveedor subió el precio, no hay stock, plazo imposible">${esc(op.motivo_no || "")}</textarea>
          <div class="muted" style="font-size:.7rem;margin-top:4px">Ojo: rechazar una orden de compra aceptada en el portal puede traer reclamos o sanciones; revisa las condiciones antes.</div>
          <div class="rb-row"><button class="btn small" type="button" data-rb="oc-volver" data-c="${esc(t.codigo)}">← Volver</button><button class="btn small" type="button" data-rb="oc-no" data-c="${esc(t.codigo)}" style="border-color:#ff8a80;color:#ffb3b9">Confirmar: no da</button></div>`
        : `<div class="muted" style="font-size:.72rem;text-align:center;margin-top:6px">👉 desliza: <b>nos da</b> · 👈 <b>no da</b></div>
          <div class="rb-acc">${archivos}${btnInf}</div>
          <div class="rb-row"><button class="btn small" type="button" data-rb="oc-pre-no" data-c="${esc(t.codigo)}">❌ No da</button><button class="btn rb-oro" type="button" style="flex:1" data-rb="oc-si" data-c="${esc(t.codigo)}">✅ Nos da → Inversión</button></div>`;
      else if (et === "inversionista") cuerpoE = `<div class="rb-mini"><div><small>Capital a invertir (90%)</small><b>${num(inf.anticipo)}</b></div><div><small>Gana inversionista (15,6%)</small><b style="color:#7ee2a0">${num(inf.inversionista)}</b></div>
          <div><small>JULFIOR (84,4%)</small><b>${num(inf.julfior)}</b></div><div><small>Rentabilidad</small><b>${inf.rentabilidad != null ? (inf.rentabilidad * 100).toFixed(1).replace(".", ",") + "%" : "—"}</b></div></div>
        <label class="muted" style="font-size:.74rem;display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" data-rb-com="aplica" data-c="${esc(t.codigo)}" ${op.aplica_comision !== false ? "checked" : ""}> Comisión del ingresador
          <select data-rb-com="pct" data-c="${esc(t.codigo)}" style="margin-left:auto;background:transparent;color:inherit;border:1px solid var(--line-soft);border-radius:8px;padding:3px">${[1,2,3,4,5,6,7,8,9,10].map((v) => `<option value="${v / 100}" ${Math.round((op.comision ?? 0.04) * 100) === v ? "selected" : ""}>${v}%</option>`).join("")}</select></label>
        <div class="rb-acc">${archivos}${btnInf}</div>
        <button class="btn rb-firmar" type="button" style="width:100%;margin-top:8px" data-rb="neg-etapa" data-e="operacion" data-c="${esc(t.codigo)}">✅ Inversión aprobada → Operación</button>`;
      else if (et === "operacion") cuerpoE = `${(inf.opciones || []).map((o, k) => `<div class="rb-op ${(op.opcion ?? inf.elegida ?? 0) === k ? "on" : ""}">
          <div class="rb-env"><b>Opción ${"AB"[k]} · ${esc(o.proveedor || "")}${chipLocal(o)}</b><b>${num(o.total_con_iva)}</b></div>
          <div class="muted" style="font-size:.72rem">${esc(o.cubre || "")}${o.despacho ? " · despacho " + esc(o.despacho) : ""}${o.plazo ? " · " + esc(o.plazo) : ""}</div>
          <div class="rb-acc">${tel(o.telefono) ? `<a class="btn small" href="tel:${esc(tel(o.telefono))}">📞 Llamar</a>` : ""}${wa(o.telefono) ? `<a class="btn small" href="https://wa.me/${wa(o.telefono)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
            <a class="btn small" href="${correo(t, o)}">✉ Pedir precio y descuento</a>${o.web ? `<a class="btn small" href="${esc(o.web)}" target="_blank" rel="noopener">🌐 Web</a>` : ""}
            ${(op.opcion ?? inf.elegida ?? 0) === k ? "" : `<button class="btn small" type="button" data-rb="neg-opcion" data-k="${k}" data-c="${esc(t.codigo)}">Elegir esta</button>`}</div></div>`).join("") || `<div class="muted" style="font-size:.78rem">Sin proveedores aún: toca «Armar informe».</div>`}
        ${bloqueMarket((inf.productos || []).length ? inf.productos : ((R.fichas || {})[t.codigo]?.productos || []), lugarDe(t))}
        ${inf.comprador?.email || inf.comprador?.telefono ? `<div class="muted" style="font-size:.74rem;margin-top:6px">Contacto del comprador: <b>${esc(inf.comprador.nombre || "")}</b> ${inf.comprador.telefono ? `· <a href="tel:${esc(tel(inf.comprador.telefono))}">${esc(inf.comprador.telefono)}</a>` : ""} ${inf.comprador.email ? `· <a href="mailto:${esc(inf.comprador.email)}">${esc(inf.comprador.email)}</a>` : ""}</div>` : ""}
        <div class="rb-prov-oro" style="margin-top:10px">
          <div class="rb-sec" style="margin-top:0">⚡ Elegí proveedor — rápido</div>
          <label class="rb-lab">Proveedor (nombre)<input class="rb-neg-in" data-campo="proveedor" data-c="${esc(t.codigo)}" value="${esc(op.proveedor || "")}" placeholder="Ej: Mario Salas"></label>
          <label class="rb-lab">¿Cuánto te cobró NETO? <span class="muted">(sin IVA)</span><input class="rb-neg-in" data-campo="precio_neto" data-c="${esc(t.codigo)}" inputmode="numeric" value="${op.precio_acordado ? Math.round(Number(op.precio_acordado) / 1.19).toLocaleString("es-CL") : ""}" placeholder="Ej: 630.000"></label>
          <label class="rb-lab">Total con IVA <span class="muted">(se calcula solo; o edítalo)</span><input class="rb-neg-in" data-campo="precio_acordado" data-c="${esc(t.codigo)}" inputmode="numeric" value="${op.precio_acordado ? Number(op.precio_acordado).toLocaleString("es-CL") : ""}" placeholder="${inf.compras ? Number(inf.compras).toLocaleString("es-CL") : ""}"></label>
          <div class="rb-row"><label class="rb-lab" style="flex:1">¿Cuándo le pagas?<input type="date" class="rb-neg-in" data-campo="fecha_pago" data-c="${esc(t.codigo)}" value="${esc(op.fecha_pago || "")}"></label><label class="rb-lab" style="flex:1">¿Cuándo termina?<input type="date" class="rb-neg-in" data-campo="plazo_fecha" data-c="${esc(t.codigo)}" value="${esc(op.plazo_fecha || "")}"></label></div>
          ${op.proveedor && op.precio_acordado ? `<div class="rb-pill verde" style="margin-top:6px">✅ ${esc(op.proveedor)} · ${clp(op.precio_acordado)}${op.fecha_pago ? " · pago " + esc(new Date(op.fecha_pago + "T12:00").toLocaleDateString("es-CL", { day: "numeric", month: "short" })) : ""} → ya está en 💼 Inversionista y Pago</div>` : `<div class="muted" style="font-size:.7rem;margin-top:4px">Llena esto y aparece solo en la caja 💼 Inversionista y Pago (tu Excel en vivo).</div>`}
        </div>
        <div class="rb-acc">${archivos}${btnInf}</div>
        <button class="btn rb-firmar" type="button" style="width:100%;margin-top:8px" data-rb="neg-etapa" data-e="pago" data-c="${esc(t.codigo)}">✅ Proveedor elegido → Pagar</button>`;
      else if (et === "pago") { const o = (inf.opciones || [])[op.opcion ?? inf.elegida ?? 0] || {}; const monto = op.precio_acordado || o.total_con_iva || inf.compras;
        cuerpoE = `<div class="rb-sec">💳 Pagar al proveedor</div>
          <div class="rb-op on"><div class="rb-env"><b>${esc(o.proveedor || op.proveedor || "Proveedor")}</b><b class="rb-oro-t" style="font-size:1.2rem">${num(monto)}</b></div>
            <div class="rb-acc">${tel(o.telefono) ? `<a class="btn small" href="tel:${esc(tel(o.telefono))}">📞</a>` : ""}${wa(o.telefono) ? `<a class="btn small" href="https://wa.me/${wa(o.telefono)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}${o.email ? `<a class="btn small" href="mailto:${esc(o.email)}">✉</a>` : ""}</div></div>
          ${op.pedido_transferencia ? `<div class="rb-sug" style="border-color:#f5cf6b">💸 <b>${esc(op.ejecutor_nombre || "El ejecutador")} pide transferir ${clp(op.precio_acordado)}</b> a ${esc(op.proveedor || "el proveedor")}${op.banco_proveedor ? `<br>${esc(op.banco_proveedor)}` : ""}${op.negociacion ? `<br><span class="muted">${esc(op.negociacion)}</span>` : ""}</div>` : ""}
          <label class="rb-lab">Medio de pago / N° transferencia<input class="rb-neg-in" data-campo="medio_pago" data-c="${esc(t.codigo)}" value="${esc(op.medio_pago || "")}" placeholder="Transferencia 123456"></label>
          <label class="muted rb-chk"><input type="checkbox" data-rb-chk="proveedor_pagado" data-c="${esc(t.codigo)}" ${op.proveedor_pagado ? "checked" : ""}> Proveedor pagado</label>
          <div class="rb-row"><button class="btn small" type="button" data-rb="recordar" data-min="manana" data-t="Pagar al proveedor ${esc(o.proveedor || "")} · ${esc(t.codigo)}" data-c="${esc(t.codigo)}">⏰ Recordarme mañana</button>
          <button class="btn rb-firmar" type="button" style="flex:1" data-rb="neg-etapa" data-e="despacho" data-c="${esc(t.codigo)}">✅ Transferido → Preparación</button></div>`; }
      else if (et === "documentos") cuerpoE = docsSII(t);
      else if (et === "despacho") cuerpoE = `<label class="muted" style="font-size:.74rem;display:block">Transporte (empresa / chofer)
          <input class="rb-neg-in" data-campo="transporte" data-c="${esc(t.codigo)}" value="${esc(op.transporte || "")}" placeholder="ej. Starken, camión propio" style="width:100%;margin-top:3px;padding:8px;border-radius:10px;border:1px solid var(--line-soft);background:rgba(255,255,255,.05);color:inherit;font:inherit"></label>
        <label class="muted" style="font-size:.74rem;display:block;margin-top:6px">Costo del transporte
          <input class="rb-neg-in" data-campo="costo_transporte" data-c="${esc(t.codigo)}" inputmode="numeric" value="${op.costo_transporte ? Number(op.costo_transporte).toLocaleString("es-CL") : ""}" style="width:100%;margin-top:3px;padding:8px;border-radius:10px;border:1px solid var(--line-soft);background:rgba(255,255,255,.05);color:inherit;font:inherit"></label>
        <div class="rb-acc"><button class="btn small" type="button" data-rb="neg-subir" data-tipo="guia" data-c="${esc(t.codigo)}">🚚 Subir guía de despacho</button><button class="btn small" type="button" data-rb="neg-subir" data-tipo="factura" data-c="${esc(t.codigo)}">🧾 Subir factura</button></div>
        <label class="muted" style="font-size:.76rem;display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" data-rb-chk="guia_firmada" data-c="${esc(t.codigo)}" ${op.guia_firmada ? "checked" : ""}> Guía de despacho firmada por el cliente</label>
        <label class="muted" style="font-size:.76rem;display:flex;gap:6px;align-items:center"><input type="checkbox" data-rb-chk="factura_firmada" data-c="${esc(t.codigo)}" ${op.factura_firmada ? "checked" : ""}> Factura recibida conforme</label>
        <button class="btn rb-firmar" type="button" style="width:100%;margin-top:8px" data-rb="neg-etapa" data-e="entrega" data-c="${esc(t.codigo)}">🚚 Despachado → Entrega</button>`;
      else if (et === "entrega") cuerpoE = `<div class="muted" style="font-size:.78rem">Cuando el cliente reciba, sube la foto de la entrega (con la guía firmada si puedes): el negocio queda <b>cerrado en oro</b>.</div>
        <button class="btn rb-firmar" type="button" style="width:100%;margin-top:8px;font-size:1rem" data-rb="neg-subir" data-tipo="foto" data-cerrar="1" data-c="${esc(t.codigo)}">📸 Subir foto de la entrega y cerrar</button>`;
      else if (et === "rechazada") cuerpoE = `<div class="rb-sug" style="border-color:#ff8a80">❌ No dio${op.motivo_no ? ": " + esc(op.motivo_no) : ""}</div>
        <button class="btn small" type="button" data-rb="neg-etapa" data-e="ganada" data-c="${esc(t.codigo)}">↩ Reconsiderar</button>`;
      else cuerpoE = `<div style="font-weight:900;font-size:1.05rem;margin-top:6px">🥇 Negocio cerrado${op.cerrado ? " · " + esc(new Date(op.cerrado).toLocaleDateString("es-CL")) : ""}</div>`;
      const desl = et === "ganada" && !(R.ocNo || {})[t.codigo];
      return `<div class="rb-neg ${et === "cerrado" ? "cerrado" : ""} ${desl ? "rb-swipe" : ""}" ${desl ? `data-modo="oc" data-c="${esc(t.codigo)}"` : ""}>
        ${desl ? '<span class="rb-sello si">NOS DA</span><span class="rb-sello no">NO DA</span>' : ""}
        <div class="rb-env"><div style="min-width:0"><div style="font-size:.76rem"><b>${esc(t.codigo)}</b> · ${et === "previa" ? `<b style="color:#5ef0b0">📞 vas 1°, antes de la OC</b>` : `OC <b>${esc(g.oc || inf.oc || op.oc || "—")}</b>`}</div>
          <div style="margin:2px 0;font-weight:700">${esc(t.nombre || "Compra Ágil")}</div><div class="muted" style="font-size:.72rem">${esc(t.organismo || "")}</div></div>
          <div style="text-align:right"><div style="font-size:.66rem;opacity:.8">VENTA</div><b>${clp(t.total)}</b></div></div>
        <div class="rb-prog">${ETAPAS.map((e, i) => `<i class="${i <= idx ? "ok" : ""}"></i>`).join("")}</div>
        <div class="rb-env" style="align-items:flex-end"><div><div style="font-size:.66rem;opacity:.8">UTILIDAD FINAL</div><div class="rb-big" style="${inf.incompleto ? "color:#ffd88a;font-size:1.1rem" : inf.final < 0 ? "color:#ff6b6b" : ""}">${inf.final == null ? "—" : inf.incompleto ? "⚠ por confirmar" : clp(inf.final)}</div></div>
          <div style="text-align:right;font-size:.74rem">${inf.rentabilidad != null ? `rentabilidad <b>${(inf.rentabilidad * 100).toFixed(1).replace(".", ",")}%</b>` : ""}${inf.margen != null ? `<br>margen <b>${(inf.margen * 100).toFixed(1).replace(".", ",")}%</b>` : ""}</div></div>
        ${dejado && et !== "previa" ? `<div class="rb-sug">💸 Podías cobrar hasta <b>${clp((t.total || 0) + dejado)}</b> y seguir ganando: quedaron <b>${clp(dejado)}</b> en la mesa. La barra ya sugiere precios más altos en segundos llamados.</div>` : ""}
        ${inf.error ? `<div class="muted" style="color:#ff9a9a;font-size:.74rem">Informe: ${esc(inf.error)}</div>` : ""}
        ${inf.incompleto ? `<div class="rb-sug" style="border-color:#ffb347">⚠ <b>Faltan precios de ${inf.faltan_precios || "algunos"} producto(s)</b>: la utilidad no es confiable. En 🛠 Operación pide cotización y escribe el precio acordado.</div>`
          : inf.final < 0 ? `<div class="rb-sug" style="border-color:#ff6b6b;background:rgba(255,90,90,.12)">🔴 <b>Con estos precios pierdes ${clp(-inf.final)}.</b> Negocia con el proveedor o busca otro antes de comprar.</div>` : ""}
        ${!["cerrado", "rechazada"].includes(et) ? (() => { if (!R.ejecutores && !R._pidEj) { R._pidEj = 1; setTimeout(cargarEjecutores, 0); }
          const ejs = Object.values(R.ejecutores || {});
          return `<div class="rb-ejrow"><span>👷 Ejecuta: <b>${esc(op.ejecutor_nombre || "sin asignar")}</b></span>
            <div class="rb-row">${[{ id: miJug(), nombre: "Yo" }, ...ejs.filter((e) => e.id !== miJug())].map((e) => `<button class="btn small ${op.ejecutor === e.id ? "rb-oro" : ""}" type="button" data-rb="neg-ejecutor" data-id="${esc(e.id)}" data-c="${esc(t.codigo)}">${esc(e.nombre)}</button>`).join("")}</div></div>`; })() : ""}
        ${cuerpoE}
        ${docs ? `<div class="rb-acc">${docs}</div>` : ""}</div>`;
    };
    const chipSeg = (t) => {
      const g = segDe(t.codigo);
      if (!g || g.pendiente) return `<span class="muted" style="font-size:.74rem">⟳ consultando Mercado Público…</span>`;
      if (g.error && !g.estado) return `<span class="muted" style="font-size:.74rem">sin respuesta de Mercado Público</span>`;
      const lugar = g.mi_lugar && g.competidores ? ` · tu precio es el ${g.mi_lugar}° más bajo de ${g.competidores}` : "";
      if (g.ganada) return `<span class="rb-badge" style="background:#16a34a;color:#fff">🏆 ¡Ganada!${g.oc ? " · OC " + esc(g.oc) : ""}</span>`;
      if (g.estado === "publicada") return `<span class="rb-badge">🟢 Abierta · recibiendo cotizaciones</span>`;
      if (g.estado === "cerrada") return `<span class="rb-badge" style="background:#7a5b00;color:#fff">⏳ Cerrada · el organismo está evaluando</span><div class="muted" style="font-size:.72rem;margin-top:3px">${g.ofertas || g.competidores || 0} ofertas${lugar}</div>`;
      if (g.estado === "proveedor_seleccionado") return `<span class="rb-badge" style="background:#5b6470;color:#fff">❌ Eligieron a otro</span><div class="muted" style="font-size:.72rem;margin-top:3px">${esc(g.ganador || "otro proveedor")}${g.ganador_total ? " por " + clp(g.ganador_total) : ""}${lugar}</div>`;
      if (["cancelada", "desierta"].includes(g.estado)) return `<span class="rb-badge" style="background:#5b6470;color:#fff">${esc(g.glosa || g.estado)}</span>${g.motivo ? `<div class="muted" style="font-size:.72rem">${esc(g.motivo)}</div>` : ""}`;
      return `<span class="rb-badge">${esc(g.glosa || g.estado || "—")}</span>`;
    };
    const enviado = (t) => {
      const g = segDe(t.codigo);
      return `<div class="rb-card ${g?.ganada ? "oro" : "verde"}" style="padding:10px 12px;margin:6px 0">
      <div class="rb-env"><div style="min-width:0"><div style="font-size:.78rem"><b>${esc(t.codigo)}</b> · ${t.estado === "confirmada" ? "★ Enviada y confirmada" : "✓ Enviada"}</div>
        <div style="margin:2px 0">${esc(t.nombre || "Compra Ágil")}</div>
        <div class="muted" style="font-size:.72rem">${t.fecha_envio ? "📅 " + esc(t.fecha_envio) + " · " : ""}${t.dispositivo ? "📱 " + esc(t.dispositivo) : "equipo no registrado"}</div></div>
        <b style="white-space:nowrap">${t.total ? clp(t.total) : ""}</b></div>
      <div style="margin-top:6px">${chipSeg(t)}</div>
      ${g?.ganada ? `<div class="rb-sug" style="border-color:#f5cf6b;margin-top:6px">🏆 <b>¡Proveedor seleccionado!</b> ${g.oc ? "Orden de compra <b>" + esc(g.oc) + "</b>: revísala y acéptala en Mercado Público." : "La orden de compra viene en camino."}</div>`
        : g?.mi_lugar === 1 && g?.estado && g.estado !== "publicada" ? `<div class="rb-sug" style="border-color:#5ef0b0;margin-top:6px">📞 <b>Vas 1°.</b> Te pueden llamar o seleccionar: adelanta proveedores en Ejecuta.</div>` : ""}
      ${g?.ganada || g?.mi_lugar === 1 ? `<details class="rb-det"><summary>🧭 Si sale la OC, ¿cómo actuamos?</summary><div class="muted" style="font-size:.72rem;line-height:1.5">
        1️⃣ Acepta la OC en Mercado Público (en 24–48 h).<br>2️⃣ En Ejecuta: pide precio a 4 proveedores con un toque y elige el que da más.<br>3️⃣ Pide su cuenta, avisa al inversionista y sube el comprobante.<br>
        4️⃣ Que el proveedor despache directo al cliente con la guía; recepción conforme firmada.<br>5️⃣ Factura en el SII y simulación de factoring para cobrar antes.</div></details>` : ""}
      ${fichaEnviada(t)}
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${t.comprobante ? `<button class="btn small rb-firmar" data-rb="comprobante" data-c="${esc(t.codigo)}" type="button">🧾 Comprobante PDF</button>` : ""}
        ${t.pdf ? `<button class="btn small" data-rb="pdf" data-c="${esc(t.codigo)}" type="button">Oferta PDF</button>` : ""}
        <a class="btn small" href="${portalDe(t.codigo)}" target="_blank" rel="noopener noreferrer">🔎 Revisar</a>
        <button class="btn small" type="button" data-rb="env-preguntar" data-c="${esc(t.codigo)}">🎙 Preguntar</button>
        ${t.op && t.op.etapa !== "rechazada" ? `<button class="btn small" type="button" data-rb="mail-abrir" data-c="${esc(t.codigo)}">🛠 En Ejecuta</button>`
          : g?.ganada || g?.mi_lugar === 1 ? `<button class="btn small rb-oro" type="button" data-rb="env-ejecutar" data-e="${g?.ganada ? "ganada" : "previa"}" data-c="${esc(t.codigo)}">➡ Pasar a Ejecuta</button>` : ""}</div></div>`;
    };
    let cuerpo;
    if (tab === "nuevas") cuerpo = `${bannerEmpresa()}${!persona()?.nombre ? `<div class="rb-p-desc">👤 ¿Quién juega en este celular? <span class="rb-row" style="margin-top:4px"><input id="rbPerNom" class="rb-in" placeholder="Tu nombre" style="flex:1"><button class="btn small rb-oro" type="button" data-rb="persona-guardar">OK</button></span></div>` : ""}<div class="rb-filtro-ganador">
        <div class="rb-env"><b>🏆 Pre-filtro ganador</b><span>✅ <b>${okV.length}</b> dan · ⏳ ${Math.min(8, porV.length)} verificando</span></div>
        <div class="muted" style="font-size:.7rem;margin-top:3px">Solo pasan las que se pueden ganar <b>y</b> dejan ≥${Math.round(MARGEN_MIN * 100)}%: sin guerra de precios, monto que soporta el despacho, abastecible y con tiempo. El PC verifica el costo real de las mejores en tiendas${esperan ? ` (${esperan} candidatas más en cola)` : ""}.</div>
        ${(() => { const f = R.oport?.oficial; if (!f) return ""; const c = f.ciclo; const t = !f.ticket ? "sin ticket: el robot aún no lo entregó (nube.json → ticket_api, reinicia el robot)" : f.error ? "error: " + esc(f.error) : c && !c.completo ? `leyendo Mercado Público… región ${c.region || 1} de 16, página ${c.siguiente}${c.total ? " de " + c.total : ""}${c.ultimo_error ? " · " + esc(c.ultimo_error) : ""} — toca ↻ otra vez` : f.n ? `${f.n} compras ágiles de la API oficial · ${f.fecha ? new Date(f.fecha).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) : ""}` : c && c.ultimo_error ? "error: " + esc(c.ultimo_error) : "sin datos todavía — toca ↻"; return `<div class="muted" style="font-size:.7rem;margin-top:3px">☁️ Fuente oficial: ${t}</div>`; })()}
        ${descartadas.length ? `<button class="btn small rb-link" type="button" data-rb="oport-filtro" data-f="${filtro === "fuera" ? "real" : "fuera"}" style="margin-top:4px">${filtro === "fuera" ? "← Volver a las reales" : `🚫 ${descartadas.length} fuera: ${Object.entries(motivos).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${esc(k)} (${v})`).join(" · ")}`}</button>` : ""}</div>
      <div class="rb-filtros">
        <button class="btn small ${filtro === "real" ? "rb-firmar" : ""}" type="button" data-rb="oport-filtro" data-f="real">🏆 Reales</button>
        <button class="btn small ${filtro === "mio" ? "rb-firmar" : ""}" type="button" data-rb="oport-filtro" data-f="mio">🎯 Mi rubro</button>
        <button class="btn small ${filtro === "seg" ? "rb-firmar" : ""}" type="button" data-rb="oport-filtro" data-f="seg">🔥 2° llamado</button>
        <button class="btn small ${filtro === "exp" ? "rb-firmar" : ""}" type="button" data-rb="oport-filtro" data-f="exp">★ Lo que ya vendemos</button>
        <button class="btn small ${filtro === "todas" ? "rb-firmar" : ""}" type="button" data-rb="oport-filtro" data-f="todas">🌐 Todas</button>
        <button class="btn small ${filtro === "lic" ? "rb-firmar" : ""}" type="button" data-rb="oport-filtro" data-f="lic">📑 Licitaciones</button>
        <button class="btn small" type="button" data-rb="rubro-editar">✏️ ${esc(((conf.rubros || []).length ? conf.rubros.length + " rubro" + (conf.rubros.length === 1 ? "" : "s") : "Rubro"))}</button>
        <button class="btn small" type="button" data-rb="oport-actualizar">↻ Buscar más</button>
        <span class="rb-oq ${qW.length ? "on" : ""}">🔎<input id="rbOportQ" type="search" value="${esc(R.oportQ || "")}" placeholder="Palabra clave" enterkeyhint="search" autocomplete="off">${qW.length ? `<button type="button" data-rb="oport-q-borrar" aria-label="Borrar">✕</button>` : ""}</span>
        <button class="btn small" type="button" data-rb="oport-tab" data-t="papelera">🗑 ${papelera.length}</button></div>
      ${qW.length ? `<div class="muted" style="font-size:.74rem;margin:-2px 0 4px;text-align:center">🔎 <b>${verN.length}</b> oportunidad${verN.length === 1 ? "" : "es"} con «${esc(R.oportQ.trim())}» en todas las vistas</div>` : ""}
      <div class="muted" style="font-size:.74rem;margin-bottom:4px;text-align:center">👉 desliza a la derecha = <b>me gusta</b> · 👈 a la izquierda = <b>no</b></div>
      ${verN.slice(0, n).map((x) => fila(x, "nuevas")).join("") || `<div class="empty">${qW.length ? `Ninguna oportunidad tiene «${esc(R.oportQ.trim())}». Prueba otra palabra o toca «↻ Buscar más».` : filtro === "real" ? "Ninguna pasa el filtro ganador ahora. Es mejor no jugar que jugar a pérdida: toca «↻ Buscar más», amplía tus rubros o revisa «2° llamado»." : "No quedan oportunidades en esta vista. Toca «↻ Buscar más»."}</div>`}
      ${verN.length > n ? `<button class="btn" style="width:100%;margin-top:8px" type="button" data-rb="oport-mas">Ver más (${verN.length - n} restantes)</button>` : ""}`;
    else if (tab === "firmar") cuerpo = enFirma.length ? (() => {
        // el jugador viene a firmar: primero las listas para firmar (la más nueva arriba); las que se preparan van al final
        const lista_ = (t) => t.estado === "firmar" && t.firma?.precios?.length ? 0 : ["requiere", "error"].includes(t.estado) ? 1 : 2;
        const L = [...enFirma].sort((a, b) => (lista_(a) - lista_(b)) || (b.creado || "").localeCompare(a.creado || ""));
        const enPrep = L.filter((t) => lista_(t) === 2).length;
        const k = Math.max(0, Math.min(L.length - 1, R.firIdx || 0)); R.firIdx = k;
        return `<div class="rb-env rb-sec"><button class="btn small" type="button" data-rb="fir-mover" data-d="-1" ${k ? "" : "disabled"}>‹</button><span>✍ Por firmar · <b>${k + 1}</b> de ${L.length}${enPrep ? ` <small style="opacity:.75">· ⏳ ${enPrep} preparándose</small>` : ""}</span><button class="btn small" type="button" data-rb="fir-mover" data-d="1" ${k < L.length - 1 ? "" : "disabled"}>›</button></div>
          <div class="muted" style="font-size:.72rem;text-align:center;margin-bottom:4px">👉 desliza a la derecha = <b>ir a firmar</b> · 👈 a la izquierda = <b>quitarla</b></div>${tarjetaFirma(L[k], k === 0)}`; })()
      : `<div class="empty">Nada por firmar. Desliza a la derecha en «Por preparar».${ocultasListas.length ? `<br><br><button class="btn rb-oro" type="button" data-rb="recuperar-firmas">👀 Mostrar ${ocultasListas.length} lista${ocultasListas.length > 1 ? "s" : ""} para firmar</button>` : ""}</div>`;
    else if (tab === "sel") cuerpo = sel.length ? (() => { const k = Math.max(0, Math.min(sel.length - 1, R.selIdx || 0)); R.selIdx = k;
        return `<div class="rb-env rb-sec"><button class="btn small" type="button" data-rb="sel-mover" data-d="-1" ${k ? "" : "disabled"}>‹</button><span>⭐ Juega el precio · <b>${k + 1}</b> de ${sel.length}</span><button class="btn small" type="button" data-rb="sel-mover" data-d="1" ${k < sel.length - 1 ? "" : "disabled"}>›</button></div>
          <div class="muted" style="font-size:.72rem;text-align:center;margin-bottom:4px">👉 desliza a la derecha = <b>apuesto y firmo</b> · 👈 a la izquierda = <b>paso</b></div>${tarjetaSel(sel[k])}`; })()
      : `<div class="empty">Desliza a la derecha las que te gusten en «👆 Por preparar» y aparecen aquí.</div>`;
    else if (tab === "hechas") cuerpo = enviadosT.length ? `<div class="row" style="justify-content:space-between;align-items:center;margin:6px 0"><span class="muted" style="font-size:.74rem">${enviadosT.length} enviadas · ${clp(enviadosT.reduce((s, t) => s + (Number(t.total) || 0), 0))} · estado en vivo de Mercado Público${R.segT ? " (" + esc(hace(new Date(R.segT).toISOString())) + ")" : ""}</span>
        <button class="btn small" type="button" data-rb="seg-actualizar">↻</button></div>${enviadosT.map(enviado).join("")}`
      : `<div class="empty">Aún no hay ofertas enviadas.</div>`;
    else if (tab === "ganadas") cuerpo = ganadasT.length ? `${(() => {      // 📦 todas las OC que llegaron (también las cotizadas fuera de la app) y cuánto deja cada una
        const ocs = ganadasT.filter((t) => t.op?.oc_codigo && etapaDe(t) !== "rechazada");
        if (!ocs.length) return "";
        const tot = ocs.reduce((a, t) => a + (Number(t.oc_compra?.total || t.total) || 0), 0);
        const dud = (t) => { const i = t.op?.informe || {}; return (Number(i.compras) || 0) > 2.5 * (Number(i.total) || Number(t.total) || 1); };   // costo 2,5× la venta = unidades mal leídas (kg vs saco)
        const listas = ocs.filter((t) => t.op?.informe?.final != null && !t.op.informe.incompleto && !dud(t));
        const util = listas.reduce((a, t) => a + (Number(t.op.informe.final) || 0), 0);
        const malas = listas.filter((t) => (Number(t.op.informe.final) || 0) <= 0).length;
        const calc = ocs.length - listas.length;
        return `<div class="rb-card" style="border-color:rgba(245,207,107,.45);padding:10px 12px">
          <div style="font-weight:700">📦 ${ocs.length} órdenes de compra · ${clp(tot)}</div>
          <div class="muted" style="font-size:.76rem;margin-top:2px">💰 utilidad calculada ${clp(util)} en ${listas.length}${calc ? ` · 💲 ${calc} sin costo confiable: abre cada una y pon el precio del proveedor` : ""}${malas ? ` · <b style="color:#ff8a80">⚠ ${malas} no deja ganancia: negocia el costo</b>` : ""}</div>
          <div style="margin-top:6px;display:grid;gap:3px">${ocs.map((t) => { const f = t.op?.informe?.final, inc = t.op?.informe?.incompleto;
            return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:.74rem"><span>${t.externa ? "🆕" : "🎮"} <b>${esc(t.op.oc_codigo)}</b> ${esc((t.oc_compra?.organismo || t.organismo || "").slice(0, 26))}</span>
              <span style="white-space:nowrap">${clp(t.oc_compra?.total || t.total)} · ${t.op?.pedido_informe ? "⟳" : f == null || inc ? `<span style="color:#f5cf6b">💲 falta costo</span>` : dud(t) ? `<span style="color:#f5cf6b">⚠ revisar unidades</span>` : `<b style="color:${f > 0 ? "#9be79b" : "#ff8a80"}">${f > 0 ? "+" : ""}${clp(f)}</b>`}</span></div>`; }).join("")}</div>
          <div class="muted" style="font-size:.66rem;margin-top:4px">🆕 cotizada fuera de la app · 🎮 jugada aquí. Llegan solas desde Mercado Público cada 10 min.</div></div>`; })()}<div class="rb-etapas">${ETAPAS.map(([k, n]) => `<button type="button" class="${netapa === k ? "on" : ""}" data-rb="neg-tab" data-e="${k}">${n} ${ganadasT.filter((t) => etapaDe(t) === k).length}</button>`).join("")}</div>
      ${ganadasT.filter((t) => etapaDe(t) === netapa).map(negocioCard).join("") || `<div class="empty">Nada en esta etapa.</div>`}`
      : `<div class="empty">${R._cargandoSeg ? "Revisando en Mercado Público…" : "Todavía no hay ganadas. Cuando el organismo te elija aparecen aquí con su orden de compra."}</div>`;
    else cuerpo = papelera.length ? `<div class="muted" style="font-size:.74rem;margin:6px 0">Desliza → o toca «Recuperar» para devolverla a Por preparar.</div>${papelera.map((x) => fila(x, "papelera")).join("")}`
      : `<div class="empty">La papelera está vacía.</div>`;
    const NAV = [["nuevas", "🎯", "Oportunidades", verN.length], ["sel", "⭐", "Jugar", sel.length], ["firmar", "✍", "Firmar", enFirma.length],
      ["hechas", "📨", "Enviadas", enviadosT.length], ["ganadas", "🏆", "Negocios", ganadasT.length]];
    const tira = `<div class="rb-tira"><span>🏆 <b class="rb-oro-t" data-cnt="${ganadoMonto}" data-k="ganado" data-fmt="corto">${corto(ganadoMonto)}</b></span>
      <span>💰 <b class="rb-vivo-t" data-cnt="${utilidadG}" data-k="util" data-fmt="corto">${corto(utilidadG)}</b></span>
      <span>🎯 <b>${tasa == null ? "—" : tasa + "%"}</b></span><span>⏳ <b>${corto(enJuego)}</b></span></div>`;
    const banLeg = leer().legado === undefined && R.hayLegado ? `<div class="rb-sug" style="border-color:#f5cf6b">🎮 Ahora <b>cada celular juega su propio juego</b>. ¿Este celular debe ver también las ofertas de antes (las de todos)?
      <div class="rb-row"><button class="btn small rb-oro" type="button" data-rb="legado" data-v="1">Sí, es el celular principal</button><button class="btn small" type="button" data-rb="legado" data-v="0">No, juego nuevo</button></div></div>` : "";
    return `${banLeg}${tab === "nuevas" ? tira : tab === "ganadas" ? marcador : ""}
      ${cuerpo}
      <nav class="rb-nav">${NAV.map(([k, i, t, c]) => `<button type="button" class="${tab === k || (tab === "papelera" && k === "nuevas") ? "on" : ""}" data-rb="oport-tab" data-t="${k}"><span class="i">${i}${c ? `<em>${c > 99 ? "99+" : c}</em>` : ""}</span><span class="t">${t}</span></button>`).join("")}</nav>`;
  }
  // la tarjeta se va al instante; la red trabaja por detrás (antes la pantalla esperaba a internet y se «atascaba»)
  function sacarTarjeta(el, dir) {
    if (!el) return;
    R.ultimoHtml = null;
    el.classList.add("vuela");
    el.style.transform = `translate3d(${dir * 115}%,0,0) rotate(${dir * 9}deg)`; el.style.opacity = "0";
    setTimeout(() => {
      el.style.maxHeight = el.offsetHeight + "px"; el.classList.add("cierra");
      requestAnimationFrame(() => { el.style.maxHeight = "0px"; el.style.marginTop = el.style.marginBottom = "0px"; el.style.paddingTop = el.style.paddingBottom = "0px"; });
      setTimeout(() => el.remove(), 240);
    }, 200);
  }
  function sumarTab(tab, d) {
    const i = $(`.rb-nav [data-t="${tab}"] em`, sheet); if (i) i.textContent = Math.max(0, (+i.textContent || 0) + d);
  }
  // ⭐ Jugar: derecha = apuesto y firmo (va al robot), izquierda = paso (vuelve a Oportunidades)
  async function selFirmar(c, b) {
    if (!c) return; const cod = c.dataset.c;
    const pres = +c.dataset.pres, r = c.querySelector(".rb-range"); const v = Math.min(c.dataset.v ? +c.dataset.v : precioDe(r), +r.dataset.hi || TOPE_CA());
    const descuento = Math.min(0.6, 1 - v / pres);          // negativo = sobre el presupuesto
    guardarSelLuego(cod, { precio: v });
    if (b) b.disabled = true;
    R.selFuera = { ...(R.selFuera || {}), [cod]: 1 }; R.barra = false;
    sacarTarjeta(c, 1); sumarTab("sel", -1); sumarTab("firmar", 1);
    setTimeout(() => pintarHoja(true), 460);                     // aparece la siguiente para seguir jugando
    try {
      const r = await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "firmar", descuento }) });
      toast(r._status === 409 ? "Ya estaba en manos del robot" : `✍ Apostaste ${clp(v)} · el robot la deja en Firmar`);
      refrescar();
    } catch (e) { toast(e.message); delete R.selFuera[cod]; pintarHoja(true); }
  }
  // 🏆 OC: «nos da» avanza a Inversión · «no da» la deja en ❌ con el motivo
  async function ocSi(cod, el) {
    if (el) sacarTarjeta(el, 1);
    try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, etapa: "inversionista", datos: { nos_da: true }, dispositivo: dispositivo(false) }) });
      toast("✅ ¡Nos da! Pasa a Inversión"); R.netapa = "inversionista"; await refrescar(); pintarHoja(true); } catch (e) { toast(e.message); }
  }
  async function cargarDocs(cod) {
    R._pidiendo = { ...(R._pidiendo || {}), [cod]: 1 };
    try { const [f, w] = await Promise.all([api("ficha?codigo=" + encodeURIComponent(cod)).catch(() => ({})), api("trabajo?codigo=" + encodeURIComponent(cod)).catch(() => ({}))]);
      R.fichas = { ...(R.fichas || {}), [cod]: f.ficha || { codigo: cod } }; R.full = { ...(R.full || {}), [cod]: w.trabajo || null }; } catch {}
    pintarHoja(true);
  }
  async function recordar(texto, min, cod) {
    let cuando;
    if (min === "manana") { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); cuando = d.toISOString(); }
    try { await api("recordar", { method: "POST", body: JSON.stringify({ texto, codigo: cod || null, ...(cuando ? { cuando } : { minutos: +min || 60 }) }) });
      toast("⏰ Te aviso " + (min === "manana" ? "mañana a las 9:00" : +min >= 60 ? "en " + Math.round(min / 60) + " h" : "en " + min + " min"));
      if (!R.push) suscribirPush(true); } catch (e) { toast(e.message); }
  }
  // ✍ Firmar: derecha = ir a firmar · izquierda = quitarla para siempre
  function irFirmar(cod) {
    const t = trabajo(cod); if (!t?.firma) { toast("Todavía no está lista para firmar"); return false; }
    api("mp-orden", { method: "POST", body: JSON.stringify({ codigo: cod }) }).catch(() => {});
    ABIERTAS[String(cod).toUpperCase()] = { w: null, t: Date.now() };
    if (esIOS && instalada()) { abrirEnSafari(cod); return true; }      // la app del inicio no tiene la extensión: va a Safari
    toast(firmaRapida() ? "Abriendo la compra: Firma rápida carga precios, detalle y PDF" : "Abriendo la compra: ahí toca tu marcador «Rellenar»");
    const w = window.open(portalDe(cod), "_blank");
    if (w) { try { w.opener = null; } catch {} ABIERTAS[String(cod).toUpperCase()].w = w; } else location.href = portalDe(cod);
    return true;
  }
  const OCULTAS = "sdc:ocultas";
  const leerOcultas = () => { try { return JSON.parse(localStorage.getItem(OCULTAS)) || {}; } catch { return {}; } };
  async function quitarFirma(cod, el, motivo) {
    const o = leerOcultas(); o[cod] = new Date().toISOString(); try { localStorage.setItem(OCULTAS, JSON.stringify(o)); } catch {}
    if (el) { sacarTarjeta(el, -1); sumarTab("firmar", -1); setTimeout(() => pintarHoja(true), 460); }
    const t = trabajo(cod);
    if (t && ["en_cola", "tomado"].includes(t.estado)) await api("cancelar", { method: "POST", body: JSON.stringify({ codigo: cod }) }).catch(() => {});
    api("olvidar", { method: "POST", body: JSON.stringify({ codigo: cod }) }).catch(() => {});
    api("oport-descartar", { method: "POST", body: JSON.stringify({ codigo: cod, descartar: true }) }).catch(() => {});   // no vuelve a aparecer
    if (!motivo) toast("🗑 Quitada: no vuelve a aparecer");
  }
  function selPasar(c) {
    const cod = c.dataset.c;
    R.selFuera = { ...(R.selFuera || {}), [cod]: 1 };
    sacarTarjeta(c, -1); sumarTab("sel", -1);
    toast("↩ La soltaste: vuelve a Oportunidades");
    quitarSel(cod).finally(() => { delete R.selFuera[cod]; });
    setTimeout(() => pintarHoja(true), 460);
  }
  async function oportDecidir(cod, si, el) {
    const x = (R.oport?.lista || []).find((y) => y.codigo === cod);
    const esLic = x?.fuente === "licitacion";
    const deTab = el?.dataset.modo === "papelera" ? "papelera" : "nuevas";
    sacarTarjeta(el, si ? 1 : -1); sumarTab(deTab, -1);
    try { navigator.vibrate?.(12); } catch {}
    if (si && !esLic) {                               // Compra Ágil: pasa a ⭐ Seleccionadas para elegir el precio
      sumarTab("sel", 1); R.selIdx = 0;                // en Jugar aparece primero la que acabas de elegir
      toast("⭐ A Seleccionadas: ahí juegas el precio");
      ponerSel(cod);
    } else if (si) {
      api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: esLic ? "licitar" : "firmar", ...(esLic ? {} : { descuento: leer().descuento ?? 0.08 }) }) })
        .then((r) => { toast(r._status === 409 ? "Ya estaba en manos del robot" : esLic ? "📑 El robot prepara la licitación" : "✍ El robot la deja lista para firmar"); refrescar(); })
        .catch((e) => toast(e.message));
    } else {
      sumarTab("papelera", 1);
      R.desc = { ...(R.desc || {}), [cod]: new Date().toISOString() };
      R.deshacer = cod;
      toast("🗑 A No deseadas");
      api("oport-descartar", { method: "POST", body: JSON.stringify({ codigo: cod, descartar: true }) }).catch((e) => toast(e.message));
    }
    if (!el) pintarHoja(true);
  }
  async function oportRestaurar(cod, el) {
    sacarTarjeta(el, 1); sumarTab("papelera", -1); sumarTab("nuevas", 1);
    if (R.desc) delete R.desc[cod];
    if (R.oport?.descartes) delete R.oport.descartes[cod];
    toast("↩ De vuelta en Por preparar");
    api("oport-descartar", { method: "POST", body: JSON.stringify({ codigo: cod, descartar: false }) }).catch((e) => toast(e.message));
    if (!el) pintarHoja(true);
  }
  // deslizar con el dedo (como Tinder): → sí, ← no. Sigue al dedo con rAF y acepta un «golpe» rápido.
  const BORDE = 28;
  (function swipe() {
    let el = null, x0 = 0, y0 = 0, dx = 0, horiz = null, t0 = 0, xs = [], raf = 0;
    const fin = () => { R.arrastrando = false; el = null; horiz = null; xs = []; cancelAnimationFrame(raf); raf = 0; };
    const pinta = () => {
      raf = 0; if (!el) return;
      el.style.transform = `translate3d(${dx}px,0,0) rotate(${dx / 28}deg)`;
      const papel = el.dataset.modo === "papelera", k = Math.min(1, Math.abs(dx) / 90);
      const si = el.querySelector(".rb-sello.si"), no = el.querySelector(".rb-sello.no");
      if (si) si.style.opacity = dx > 0 ? k : 0; if (no) no.style.opacity = papel || dx > 0 ? 0 : k;
    };
    sheet.addEventListener("pointerdown", (ev) => {
      R.toque = Date.now();
      if (ev.pointerType !== "mouse" && ev.clientX < BORDE) return;          // borde izquierdo = gesto «atrás»
      const c = ev.target.closest?.(".rb-swipe");
      if (!c || ev.target.closest("button,a,input,select,label,details,textarea")) return;
      el = c; x0 = ev.clientX; y0 = ev.clientY; dx = 0; horiz = null; t0 = performance.now(); xs = [[t0, x0]];
    }, { passive: true });
    sheet.addEventListener("pointermove", (ev) => {
      if (!el) return;
      R.toque = Date.now();
      dx = ev.clientX - x0; const dy = ev.clientY - y0;
      if (horiz === null && Math.abs(dx) + Math.abs(dy) > 8) {
        horiz = Math.abs(dx) > Math.abs(dy);
        if (horiz) { R.arrastrando = true; el.classList.remove("vuela"); el.style.willChange = "transform"; x0 += Math.sign(dx) * 8; dx = ev.clientX - x0; }
        else { el = null; return; }
      }
      if (!horiz) return;
      const t = performance.now(); xs.push([t, ev.clientX]); while (xs.length > 2 && t - xs[0][0] > 90) xs.shift();
      if (!raf) raf = requestAnimationFrame(pinta);
    }, { passive: true });
    const soltar = () => {
      if (!el) return fin();
      const c = el, papel = c.dataset.modo === "papelera";
      const [a, b] = [xs[0], xs[xs.length - 1]];
      const vel = a && b && b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0;      // px por ms
      const ancho = c.offsetWidth || 320;
      const derecha = horiz && (dx > ancho * 0.28 || (dx > 30 && vel > 0.45));
      const izquierda = horiz && (dx < -ancho * 0.28 || (dx < -30 && vel < -0.45));
      c.style.willChange = "";
      const modoSel = c.dataset.modo === "sel", modoOc = c.dataset.modo === "oc", modoFir = c.dataset.modo === "fir";
      if (c.dataset.modo === "llam") {
        c.classList.add("vuela"); c.style.transform = ""; c.querySelectorAll(".rb-sello").forEach((x) => (x.style.opacity = 0));
        if (derecha) confirmarLlamada(c.dataset.c); else if (izquierda) { R.llamada.idx = (R.llamada.idx || 0) + 1; if (R.llamada.idx >= (R.llamada.cands || []).length) R.llamada.cands = []; pintarHoja(true); }
        return fin();
      }
      if (c.dataset.modo === "ej") {
        c.classList.add("vuela"); c.style.transform = ""; c.querySelectorAll(".rb-sello").forEach((x) => (x.style.opacity = 0));
        const cc = c.dataset.c, l = leerLuego();
        if (derecha) { R.ejAbierto = cc; R.ejModo = null; delete l[cc]; try { localStorage.setItem(EJ_LUEGO, JSON.stringify(l)); } catch {} navigator.vibrate?.(10); setTimeout(() => pintarHoja(true), 120); }
        else if (izquierda) { l[cc] = Date.now(); try { localStorage.setItem(EJ_LUEGO, JSON.stringify(l)); } catch {} sacarTarjeta(c, -1); setTimeout(() => pintarHoja(true), 360); }
        return fin();
      }
      if (modoFir) {
        c.classList.add("vuela"); c.style.transform = ""; c.querySelectorAll(".rb-sello").forEach((x) => (x.style.opacity = 0));
        if (derecha) irFirmar(c.dataset.c); else if (izquierda) quitarFirma(c.dataset.c, c);
        return fin();
      }
      if (derecha && modoOc) { ocSi(c.dataset.c, c); }
      else if (izquierda && modoOc) { c.classList.add("vuela"); c.style.transform = ""; R.ocNo = { ...(R.ocNo || {}), [c.dataset.c]: 1 }; setTimeout(() => pintarHoja(true), 230); }
      else if (derecha) { modoSel ? selFirmar(c) : papel ? oportRestaurar(c.dataset.c, c) : oportDecidir(c.dataset.c, true, c); }
      else if (izquierda && modoSel) selPasar(c);
      else if (izquierda && !papel) oportDecidir(c.dataset.c, false, c);
      else if (horiz) { c.classList.add("vuela"); c.style.transform = ""; c.querySelectorAll(".rb-sello").forEach((x) => (x.style.opacity = 0)); }
      fin();
    };
    sheet.addEventListener("pointerup", soltar, { passive: true });
    sheet.addEventListener("pointercancel", soltar, { passive: true });
    sheet.addEventListener("scroll", () => { R.toque = Date.now(); }, { passive: true });
  })();
  // ⟵ deslizar desde el borde izquierdo = volver (la app del inicio del iPhone no tiene botón atrás)
  function atras() {
    if (R.detalle) R.detalle = null;
    else if (R.conf) R.conf = null;
    else if (R.pantalla) R.pantalla = null;
    else if (["ejecuta", "licita"].includes(leer().portal)) guardar({ portal: "juego" });
    else {
      const tab = R.oportTab || "nuevas";
      if (tab === "nuevas") return false;
      let prev = (R.tabHist || []).pop(); while (prev === tab) prev = (R.tabHist || []).pop();
      R.oportTab = prev || "nuevas"; guardar({ oportTab: R.oportTab }); R.oportN = 40;
    }
    sheet.scrollTop = 0; pintarHoja(true); return true;
  }
  (function bordeAtras() {
    let x0 = null, y0 = 0, dx = 0, ok = null, flecha = null;
    const pinta = (k) => {
      if (!flecha) { flecha = document.createElement("div"); flecha.id = "rbAtras"; flecha.textContent = "‹"; document.body.appendChild(flecha); }
      flecha.style.opacity = Math.min(1, k * 1.4); flecha.style.transform = `translate3d(${Math.min(70, dx * 0.55) - 40}px,-50%,0) scale(${0.7 + Math.min(1, k) * 0.4})`;
      flecha.classList.toggle("listo", k >= 1);
    };
    const quita = () => { if (flecha) { flecha.style.opacity = 0; flecha.style.transform = "translate3d(-40px,-50%,0) scale(.7)"; } x0 = null; ok = null; dx = 0; };
    sheet.addEventListener("touchstart", (e) => {
      const t = e.touches[0]; if (e.touches.length !== 1 || t.clientX > BORDE) return quita();
      x0 = t.clientX; y0 = t.clientY; dx = 0; ok = null;
    }, { passive: true });
    sheet.addEventListener("touchmove", (e) => {
      if (x0 === null) return; const t = e.touches[0]; dx = t.clientX - x0; const dy = t.clientY - y0;
      if (ok === null && Math.abs(dx) + Math.abs(dy) > 10) ok = dx > Math.abs(dy);
      if (ok) { R.toque = Date.now(); pinta(dx / 80); } else if (ok === false) quita();
    }, { passive: true });
    const fin = () => { const ir = ok && dx > 80; quita(); if (ir && !atras()) toast("Ya estás en el inicio del juego"); };
    sheet.addEventListener("touchend", fin, { passive: true });
    sheet.addEventListener("touchcancel", quita, { passive: true });
  })();
  async function cargarOport() {
    if (R._cargandoOport) return; R._cargandoOport = true;
    try {
      const o = await api("oportunidades"); o.descartes = o.descartes || {};
      const ya = Date.now() + 30 * 60000; o.lista = (o.lista || []).filter((x) => !x.cierre || Date.parse(x.cierre) > ya);
      R.oport = o; R.oportViejo = false; R.oportT = Date.now();
      setTimeout(() => aCache("oport2", o), 50);
    } catch (e) { if (!R.oport) R.oport = { lista: [], error: e.message }; toast(e.message); }
    R._cargandoOport = false; pintarHoja();
  }
  function vistaTablero(lista) {
    return `<div class="rb-tablero">${COLUMNAS.map(([titulo, estados]) => {
      const cs = lista.filter((t) => estados.includes(t.estado));
      return `<div class="rb-col"><h4>${titulo}<i>${cs.length}</i></h4>${cs.map(caja).join("") || '<div class="rb-vacio">Nada aquí</div>'}</div>`;
    }).join("")}</div>`;
  }

  function pantallaDetalle(cod) {
    const t = trabajo(cod);
    if (!t) { R.detalle = null; return pantallaLista(); }
    return `
      <div class="rb-sheet-head"><button class="btn small" type="button" data-rb="cerrar-det">← Volver</button><button class="rb-x" type="button" data-rb="cerrar" aria-label="Cerrar">✕</button></div>
      ${tarjeta(t)}
      ${t.historial?.length ? `<details class="rb-det" open><summary>Recorrido</summary><pre>${esc(t.historial.map((h) =>
        `${new Date(h.t).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}  ${est(h.estado).txt}${h.mensaje ? " · " + h.mensaje : ""}`).join("\n"))}</pre></details>` : ""}`;
  }

  // ---------- 🏢 ¿con qué empresa ofertas? (cada persona, sus datos: RUT, contacto, ficha técnica) ----------
  const corta = (n) => String(n || "").replace(/^(sociedad (de )?(inversiones )?(y gesti[oó]n )?|comercial(izadora)? |empresa )/i, "").replace(/\s+(spa|ltda\.?|s\.a\.|eirl|limitada)\.?$/i, "").slice(0, 26);
  // ================= 🏆 PORTADA: deseo de jugar · RUT de la empresa · conexiones (Gmail, WhatsApp, Marketplace) =================
  const PORT = "sdc:portada", CONEX = "sdc:conex";
  const portadaVista = () => { try { return sessionStorage.getItem(PORT) === "1"; } catch { return true; } };
  const conex = () => { try { return JSON.parse(localStorage.getItem(CONEX)) || {}; } catch { return {}; } };
  const rutLimpio = (r) => String(r || "").replace(/[^0-9kK]/g, "").toUpperCase();
  const rutOk = (r) => { const c = rutLimpio(r); if (c.length < 8) return false; const cuerpo = c.slice(0, -1), dv = c.slice(-1);
    let s2 = 0, m = 2; for (let i = cuerpo.length - 1; i >= 0; i--) { s2 += +cuerpo[i] * m; m = m === 7 ? 2 : m + 1; }
    const r2 = 11 - (s2 % 11), esp = r2 === 11 ? "0" : r2 === 10 ? "K" : String(r2); return esp === dv; };
  const rutFmt = (r) => { const c = rutLimpio(r); if (c.length < 2) return c; return c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + c.slice(-1); };
  // 🚪 ¿Qué vienes a hacer? — cada persona entra por su puerta (arregla que la portada hablaba solo de "juego")
  const ROL = "sdc:rol";
  const rolActual = () => { try { return localStorage.getItem(ROL); } catch { return null; } };
  const ROLES = {
    juego:     { ico: "🎮", corto: "Cotizador", portal: "juego",     h: "El Estado compra todos los días.<br><span>Cotiza y gana tu parte.</span>", sub: "Cotizas, el robot arma la oferta, la ficha y el PDF. Tú firmas con tu ClaveÚnica y cobras.", cta: "▶ ENTRAR A COTIZAR" },
    licita:    { ico: "📑", corto: "Licitador", portal: "licita",   h: "Las licitaciones grandes.<br><span>Postula y adjudícate proyectos.</span>", sub: "Compites por las licitaciones del Estado, montos mayores y proyectos de varios días.", cta: "▶ ENTRAR A LICITAR" },
    ejecuta:   { ico: "🛠", corto: "Ejecutor", portal: "ejecuta",   h: "Tú ejecutas los negocios.<br><span>Haces la pega y cobras.</span>", sub: "Ejecutas órdenes de compra ya ganadas: compras, entregas, instalas, y muestras el avance en vivo.", cta: "▶ ENTRAR A EJECUTAR" },
    inversion: { ico: "💰", corto: "Inversionista", portal: "inversion", h: "Pones la plata.<br><span>El negocio ya está ganado.</span>", sub: "Inviertes en negocios ya adjudicados y ves tu inversión crecer en tiempo real. Sin ClaveÚnica.", cta: "▶ ENTRAR A INVERTIR" },
  };
  // 👤 UX por roles: cada perfil ve SOLO sus portales (el inversor no ve licitaciones, etc.). El dueño ve todo.
  // 🎮 Todos cotizan: el ejecutor y el licitador también juegan (el negocio es de quien lo cotiza). El inversionista solo mira su plata.
  const PORTALES_ROL = { juego: ["juego"], licita: ["juego", "licita"], ejecuta: ["juego", "ejecuta", "inversion"], inversion: ["inversion"] };
  const TABS_PORTAL = [["juego", "🎮 Cotiza"], ["licita", "📑 Licita"], ["ejecuta", "🛠 Ejecuta"], ["inversion", "💼 Inversión"]];
  function portalesVisibles() {
    if (esDueno()) return ["juego", "licita", "ejecuta", "inversion"];       // el dueño/admin ve todos
    const r = rolActual();
    return (r && PORTALES_ROL[r]) ? PORTALES_ROL[r] : ["juego", "licita", "ejecuta", "inversion"];
  }
  function portalActivo() {
    const vis = portalesVisibles(), p = leer().portal || "juego";
    return vis.includes(p) ? p : vis[0];
  }
  function barraPortales() {
    const vis = portalesVisibles();
    if (vis.length <= 1) return `<div class="rb-portal" style="justify-content:center"><button type="button" data-rb="ver-roles" style="flex:0 1 auto;padding:7px 16px">⇄ Cambiar perfil</button></div>`;   // sectorizado: SIEMPRE un escape para cambiar de rol/portal
    const act = portalActivo();
    return `<div class="rb-portal">${TABS_PORTAL.filter(([p]) => vis.includes(p)).map(([p, lbl]) => `<button type="button" class="${act === p ? "on" : ""}" data-rb="portal" data-v="${p}">${lbl}</button>`).join("")}</div>`;
  }
  function selectorRol() {
    const puerta = (v, ico, t, sub) => `<button type="button" class="rb-puerta" data-rb="rol-elegir" data-v="${v}"><span class="rb-puerta-i">${ico}</span><span class="rb-puerta-t"><b>${t}</b><small>${sub}</small></span><span class="rb-puerta-f">›</span></button>`;
    return `<div class="rb-portada">
      <div class="rb-p-brillo"></div>
      <div class="rb-p-top"><span class="rb-p-logo">◆ Socios de Crecimiento</span>${R.verRoles ? `<button type="button" class="rb-p-cambiar" data-rb="roles-cerrar">✕ cerrar</button>` : ""}</div>
      <h1 class="rb-p-h">¿Qué quieres hacer?</h1>
      <div class="rb-p-sub">Toca tu perfil. Puedes ser más de uno.</div>
      <div class="rb-puertas">
        ${puerta("juego", "🎮", "Cotizador", "Cotizas Compras Ágiles del Estado. El robot arma la oferta; tú firmas con tu ClaveÚnica y cobras.")}
        ${puerta("licita", "📑", "Licitador", "Vas por las licitaciones grandes: postulas, compites y te adjudicas proyectos. (Portal en construcción.)")}
        ${puerta("ejecuta", "🛠", "Ejecutor", "Ejecutas las órdenes de compra ya ganadas: compras, entregas, instalas, y muestras el avance en vivo.")}
        ${puerta("inversion", "💰", "Inversionista", "Pones capital en negocios ya adjudicados y ves tu inversión crecer en tiempo real. Sin ClaveÚnica.")}
      </div>
      <div class="rb-p-nota" style="margin-top:14px">Puedes cambiar o sumar perfiles cuando quieras. <b>Pronto:</b> cada perfil con su plan (básico · medio · premium).</div>
    </div>`;
  }
  function pantallaPortada() {
    const rol = rolActual(); if (!rol) return selectorRol();
    const RC = ROLES[rol] || ROLES.juego;
    const L = (R.oport?.lista || []).filter((x) => x.fuente !== "licitacion" && Date.parse(x.cierre) - Date.now() > 3600000 && !x.ya_ofertada);
    const total = L.reduce((a, x) => a + (Number(x.monto) || 0), 0), seg = L.filter((x) => /^segundo/i.test(x.llamado || "")).length;
    const emp = empresaActual(), c = conex(), rut = R.rutTmp ?? (emp?.rut || "");
    const fmt = (n) => n >= 1e9 ? "$" + (n / 1e9).toFixed(1).replace(".", ",") + " mil M" : n >= 1e6 ? "$" + Math.round(n / 1e6).toLocaleString("es-CL") + "M" : clp(n);
    const btnC = (k, ico, nom, sub) => `<button type="button" class="rb-con ${c[k] ? "on" : ""}" data-rb="con" data-k="${k}"><span class="i">${ico}</span><span><b>${nom}</b><small>${c[k] ? "✓ " + esc(String(c[k]).slice(0, 28)) : sub}</small></span></button>`;
    return `<div class="rb-portada">
      <div class="rb-p-brillo"></div>
      <div class="rb-p-top"><span class="rb-p-logo">◆ Socios de Crecimiento</span><button type="button" class="rb-p-cambiar" data-rb="rol-cambiar">${RC.ico} ${RC.corto} · cambiar</button></div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:.8rem;margin:2px 0 6px;opacity:.9">🏢 <b>${esc(corta(emp?.razon_social) || "PJANIC")}</b>${persona()?.nombre ? ` · <button type="button" data-rb="persona-editar" style="background:none;border:none;color:inherit;font:inherit;padding:0;cursor:pointer">👤 usuario <b>${esc(persona().nombre.split(" ")[0])}</b></button>` : ` · <button type="button" data-rb="persona-editar" style="background:none;border:none;color:inherit;font:inherit;padding:0;cursor:pointer;text-decoration:underline">👤 ¿quién juega? →</button>`}</div>
      <h1 class="rb-p-h">${RC.h}</h1>
      <div class="rb-p-sub">${RC.sub}</div>
      <div class="rb-p-stats"><div><b>${L.length || "…"}</b><small>compras abiertas</small></div><div><b>${total ? fmt(total) : "…"}</b><small>en juego hoy</small></div><div><b>${seg || "…"}</b><small>🔥 2° llamado</small></div></div>
      <label class="rb-p-rut"><span>RUT de tu empresa</span><input id="rbRut" value="${esc(rutFmt(rut))}" placeholder="76.123.456-7" autocomplete="off" autocapitalize="characters" inputmode="text"></label>
      <button class="btn rb-oro rb-p-jugar" type="button" data-rb="portada-jugar">${RC.cta}</button>
      <div class="rb-p-nota">Sin formularios: con tu RUT descubro qué vende tu empresa y te muestro primero lo que puedes ganar.</div>
      <div class="rb-p-con-t">Conecta tus herramientas</div>
      <div class="rb-p-con">${btnC("gmail", "✉️", "Gmail", "correos a proveedores")}${btnC("whatsapp", "💬", "WhatsApp", "avisos y clientes")}${btnC("marketplace", "🛒", "Marketplace", "proveedores 2ª opción")}</div>
      ${R.conForm ? `<div class="rb-p-form"><input id="rbConV" placeholder="${R.conForm === "gmail" ? "tucorreo@gmail.com" : "+56 9 1234 5678"}" inputmode="${R.conForm === "gmail" ? "email" : "tel"}" autocapitalize="off" value="${esc(c[R.conForm] || "")}"><button class="btn small rb-oro" type="button" data-rb="con-ok">Conectar</button></div>` : ""}
    </div>`;
  }
  async function descubrirEmpresa(rut, nombre) {
    try {
      const r = await api("preguntar", { method: "POST", body: JSON.stringify({ tipo: "empresa", rut: rutFmt(rut), texto: nombre || "" }) });
      R.descubre = { id: r.id, desde: Date.now() }; pintarHoja(true);
      const espera = async () => {
        if (!R.descubre || R.descubre.id !== r.id) return;
        if (Date.now() - R.descubre.desde > 240000) { R.descubre = { ...R.descubre, error: "El PC no respondió a tiempo." }; return pintarHoja(true); }
        try { const q = (await api("respuesta?id=" + r.id)).pregunta;
          if (q?.estado === "lista" && q.respuesta) return aplicarDescubrimiento(q.respuesta);
          if (q?.estado === "error") { R.descubre = { ...R.descubre, error: q.error }; return pintarHoja(true); } } catch {}
        setTimeout(espera, 4000);
      };
      setTimeout(espera, 5000);
    } catch (e) { R.descubre = { error: e.message }; }
  }
  async function aplicarDescubrimiento(d) {
    R.descubre = null;
    const emp = empresaActual(); if (!emp) return;
    const nuevo = { id: emp.id, rut: emp.rut, perfil: { rubros: d.rubros, subrubros: d.subrubros, aperturas: d.aperturas, palabras: d.palabras, actividades: d.actividades, confianza: d.confianza },
      ...(d.giro ? { giro: d.giro } : {}), ...(d.descripcion ? { descripcion: d.descripcion } : {}), ...(d.web ? { web: d.web } : {}), ...(d.region ? { region: d.region } : {}) };
    if (d.razon_social && /^Empresa \d/.test(emp.razon_social || "")) nuevo.razon_social = d.razon_social;
    try { const r = await api("empresa", { method: "POST", body: JSON.stringify(nuevo) }); R.empresas = r.empresas; } catch {}
    if ((d.rubros || []).length) guardar({ rubros: d.rubros, palabras: (d.palabras || []).join(", "), rubroListo: 1 });
    toast((d.rubros || []).length ? "🔎 Listo: tu empresa juega en " + d.rubros.slice(0, 3).join(", ") : "🔎 No encontré bien el rubro: elígelo tú en ✏️");
    pintarHoja(true);
  }
  function bannerEmpresa() {
    const emp = empresaActual(), pf = emp?.perfil;
    if (R.descubre && !R.descubre.error) return `<div class="rb-p-desc"><span class="spinner"></span> 🔎 <b>Descubriendo qué hace tu empresa</b> con su RUT (giros del SII, web, sus ventas)… mientras, juega con las mejores de todos los rubros.</div>`;
    if (R.descubre?.error) return `<div class="rb-p-desc">⚠ ${esc(R.descubre.error)} <button class="btn small" type="button" data-rb="rubro-editar">Elegir rubros</button></div>`;
    if (!pf || R.ocultarPerfil) return "";
    const mios = new Set(leer().rubros || []);
    return `<details class="rb-p-desc" ${R.perfilAbierto ? "open" : ""}><summary>🏢 <b>${esc(corta(emp.razon_social))}</b> · ${esc((emp.descripcion || emp.giro || "").slice(0, 70))}</summary>
      <div class="rb-sec" style="margin-top:6px">Tus rubros</div><div class="rb-row">${(pf.rubros || []).map((r) => `<button type="button" class="rb-rchip ${mios.has(r) ? "on" : ""}" data-rb="rubro-t2" data-r="${esc(r)}">${esc(r)}</button>`).join("")}</div>
      ${(pf.subrubros || []).length ? `<div class="muted" style="font-size:.72rem;margin-top:4px">Vende: ${esc(pf.subrubros.slice(0, 10).join(" · "))}</div>` : ""}
      ${(pf.aperturas || []).length ? `<div class="rb-sec">🚀 Puedes abrirte a</div><div class="rb-row">${pf.aperturas.map((a) => `<button type="button" class="rb-rchip" data-rb="rubro-t2" data-r="${esc(a.rubro)}" title="${esc(a.por_que || "")}">＋ ${esc(a.rubro)}</button>`).join("")}</div>` : ""}
      <div class="rb-row" style="margin-top:6px"><button class="btn small" type="button" data-rb="rubro-editar">✏️ Afinar rubros</button><button class="btn small" type="button" data-rb="redescubrir">🔄 Volver a descubrir</button></div></details>`;
  }
  // 👤 ¿quién usa este celular? (cada persona su nombre: aparece arriba, en «Enviados» del PC, en Ejecuta y en el guion de llamada)
  const PERS = "sdc:persona";
  const persona = () => { try { return JSON.parse(localStorage.getItem(PERS)) || null; } catch { return null; } };
  function pantallaPersona() {
    const p = persona() || {}, d = (localStorage.getItem(DISP) || "").trim();
    const nom = p.nombre || (/^(iphone|ipad|android|celular)$/i.test(d) ? "" : d);
    return `<div class="rb-paso"><div class="rb-paso-n">Paso 1 de 3</div>
      <h2 class="rb-h">¿Quién usa este celular?</h2>
      <div class="muted rb-sub">Este dispositivo queda a <b>tu</b> nombre: tu juego, tus firmas y tus negocios. Otra persona en otro celular pone el suyo.</div>
      <label class="rb-lab">Tu nombre<input class="rb-in" id="rbPerNom" value="${esc(nom)}" placeholder="Ej: Nicolás" autocomplete="name"></label>
      <label class="rb-lab">Tu WhatsApp (opcional)<input class="rb-in" id="rbPerTel" value="${esc(p.telefono || "")}" inputmode="tel" placeholder="+56 9 ..."></label>
      <button class="btn rb-oro rb-big-btn" type="button" data-rb="persona-guardar">Este celular es mío →</button>
      ${p.nombre ? `<button class="btn small rb-link" type="button" data-rb="persona-cancelar">Cancelar</button>` : ""}</div>`;
  }
  function pantallaEmpresa() {
    if (!R.empresas) cargarEmpresas();
    const L = Object.values(R.empresas || {}), yo = miEmp(), f = R.empForm;
    const campo = (k, lab, ph, tipo) => `<label class="rb-lab">${lab}<input data-emp="${k}" value="${esc((f || {})[k] || "")}" placeholder="${esc(ph || "")}" ${tipo || ""}></label>`;
    const sel = (k, lab, opts) => `<label class="rb-lab">${lab}<select data-emp="${k}" style="width:100%;padding:8px;border-radius:8px">${["", ...opts].map((o) => `<option value="${esc(o)}" ${((f || {})[k] || "") === o ? "selected" : ""}>${o || "— elige —"}</option>`).join("")}</select></label>`;
    return `<div class="rb-paso"><div class="rb-paso-n">Paso 2 de 3 · 👤 ${esc(persona()?.nombre || "")}</div>
      <h2 class="rb-h">¿Con qué empresa ofertas?</h2>
      <div class="muted rb-sub">La cotización, la ficha técnica y el PDF salen con <b>sus</b> datos. Cada celular elige la suya.</div>
      ${!R.empresas ? `<div class="empty"><span class="spinner"></span></div>` : ""}
      ${f ? `<div class="rb-card" style="padding:14px">
          ${campo("razon_social", "Razón social *", "Ej. Comercial Los Andes SpA")}${campo("rut", "RUT empresa *", "76.123.456-7", 'inputmode="text" autocapitalize="characters"')}
          ${campo("giro", "Giro", "Venta de artículos de ferretería")}${campo("contacto", "Contacto (nombre)", "Nombre y apellido")}
          ${campo("telefono", "Teléfono", "+56 9 ...", 'inputmode="tel"')}${campo("email", "Correo", "ventas@empresa.cl", 'inputmode="email" autocapitalize="off"')}
          ${campo("direccion", "Dirección", "Calle 123")}${campo("comuna", "Comuna / ciudad", "Los Andes")}
          ${campo("representante", "Representante legal", "")}${campo("rut_representante", "RUT representante", "")}
          ${campo("despacho", "Condición de despacho", "Incluido, puesto en dirección del cliente")}
          <details class="rb-det" style="margin-top:8px" ${(f && (f.integridad || f.sello_mujer || f.representante_facultades)) ? "open" : ""}><summary>📑 Datos para licitaciones (el robot los reusa en los anexos)</summary>
            <div class="muted" style="font-size:.72rem;margin:4px 0">Llénalos una vez. Quedan guardados en tu empresa y el robot los reutiliza al preparar los anexos de cada licitación.</div>
            ${campo("representante_cargo", "Cargo del representante legal", "Ej. Gerente General")}
            ${sel("representante_facultades", "¿El representante puede ofertar y firmar contratos?", ["Sí", "No"])}
            ${sel("chileproveedores_habil", "¿Está hábil en Chileproveedores?", ["Sí", "No"])}
            ${sel("integridad", "¿Tiene Programa de Integridad documentado? (+5 pts)", ["Sí", "No"])}
            ${sel("inclusivo", "¿Contrata personas en situación de discapacidad? (+5 pts)", ["Sí", "No"])}
            ${sel("sello_mujer", "¿Tiene Sello Empresa Mujer en el portal? (+5 pts)", ["Sí", "No"])}
            ${sel("cert_16744", "¿Certificado Ley 16.744 vigente?", ["Sí", "No"])}
          </details>
          <input type="hidden" data-emp="id" value="${esc((f || {}).id || "")}">
          <button class="btn rb-oro rb-big-btn" type="button" data-rb="empresa-guardar">Guardar y usar esta empresa</button>
          <button class="btn small rb-link" type="button" data-rb="empresa-cancelar">Cancelar</button></div>`
      : `${L.map((e) => `<div class="rb-card rb-emp-c ${e.id === yo ? "on" : ""}"><div style="min-width:0"><b>${esc(e.razon_social)}</b><div class="muted" style="font-size:.74rem">RUT ${esc(e.rut || "")}${e.contacto ? " · contacto de la empresa: " + esc(e.contacto) : ""}</div></div>
          <div class="rb-row"><button class="btn small" type="button" data-rb="empresa-form" data-id="${esc(e.id)}">Editar</button><button class="btn small rb-oro" type="button" data-rb="empresa-usar" data-id="${esc(e.id)}">${e.id === yo ? "✓ En uso" : "Usar"}</button></div></div>`).join("")}
        <button class="btn rb-big-btn" type="button" data-rb="empresa-form">＋ Agregar otra empresa</button>`}
    </div>`;
  }
  // ---------- 💬 Chat con Claude: el cerebro de la app responde aquí mismo, con tu empresa y tus compras como contexto ----------
  const CHAT = "sdc:chat";
  const cargarChat = () => { try { return JSON.parse(localStorage.getItem(CHAT)) || { mensajes: [], codigo: null }; } catch { return { mensajes: [], codigo: null }; } };
  const guardarChat = () => { try { localStorage.setItem(CHAT, JSON.stringify({ ...R.chat, mensajes: (R.chat.mensajes || []).slice(-40) })); } catch {} };
  async function enviarClaude(txt) {
    R.chat = R.chat || cargarChat(); R.chat.mensajes.push({ rol: "yo", texto: txt, t: Date.now() }); R.chat.cargando = true; R.chat.error = null; guardarChat(); pintarHoja(true);
    try {
      const r = await api("cerebro", { method: "POST", body: JSON.stringify({ mensajes: R.chat.mensajes.slice(-16).map((m) => ({ rol: m.rol, texto: m.texto })), codigo: R.chat.codigo || null }) });
      R.chat.mensajes.push({ rol: "claude", texto: r.respuesta || "…", t: Date.now() }); try { navigator.vibrate?.(12); } catch {}
    } catch (e) { R.chat.error = /ANTHROPIC_API_KEY/.test(e.message) ? "Falta conectar mi cerebro: en Netlify → Site configuration → Environment variables, agrega ANTHROPIC_API_KEY (clave de console.anthropic.com). Con eso respondo aquí mismo." : e.message; }
    R.chat.cargando = false; guardarChat(); pintarHoja(true);
    setTimeout(() => { const f = $("#rbChatFin"); if (f) f.scrollIntoView({ block: "end" }); }, 30);
  }
  // 🎙 hablarle a Claude: dictado del celular (reconocimiento de voz del navegador) → texto → se envía al soltar
  let __rec = null;
  function dictarClaude() {
    R.chat = R.chat || cargarChat();
    if (__rec) { try { __rec.stop(); } catch {} return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return toast("Este navegador no tiene dictado");
    const rec = new SR(); rec.lang = "es-CL"; rec.interimResults = true; rec.continuous = false; __rec = rec;
    R.chat.oyendo = true; pintarHoja(true);
    let final = "";
    rec.onresult = (e) => { let parcial = ""; for (const r of e.results) { if (r.isFinal) final += r[0].transcript; else parcial += r[0].transcript; } const el = $("#rbChatIn"); if (el) el.value = (final + " " + parcial).trim(); };
    rec.onerror = () => { R.chat.oyendo = false; __rec = null; pintarHoja(true); };
    rec.onend = () => { R.chat.oyendo = false; __rec = null; const txt = final.trim(); if (txt) { const el = $("#rbChatIn"); if (el) el.value = ""; enviarClaude(txt); } else pintarHoja(true); };
    try { rec.start(); } catch { R.chat.oyendo = false; __rec = null; pintarHoja(true); }
  }
  function pantallaClaude() {
    const c = R.chat || (R.chat = cargarChat());
    const emp = empresaActual();
    const t = c.codigo ? (R.data?.trabajos || []).find((x) => x.codigo === c.codigo) : null;
    const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
    const licDocs = (t?.lic_docs || []).filter((d) => /pdf/i.test(d.mime || "")).length;
    const sug = t && esLic(t.codigo) ? ["Resume las bases: qué piden, plazos, garantías y criterios de evaluación", "Checklist de anexos y documentos que debo presentar", "¿Vale la pena? Dame los números y el precio para ganar", "Riesgos, multas y qué preguntar en el foro"] : [t ? `¿Cómo oferto ${t.codigo} para ganar sin perder plata?` : "¿Qué oportunidad me conviene jugar hoy?", "Calcúlame costos, HH y utilidad de esta compra", "¿Qué me falta para la licitación y cómo la ejecuto?", emp?.comision ? "¿Cuánto llevo en comisiones y qué OC faltan?" : "¿Qué servicio nuevo puedo vender con lo que ya hago?"];
    return `<div class="rb-env"><h2 class="rb-h" style="margin:0">💬 Claude</h2><div class="rb-row"><button class="btn small" type="button" data-rb="claude-limpiar" title="Borrar conversación">🗑</button><button class="btn small" type="button" data-rb="claude-cerrar">← Volver</button></div></div>
      <div class="muted rb-sub">Soy el cerebro de la app. Sé de ${emp ? "<b>" + esc(corta(emp.razon_social)) + "</b>" : "tu empresa"}${t ? " y de la compra <b>" + esc(t.codigo) + "</b>" : " y de tus compras"}. Pregúntame lo que le preguntarías a tu socio.${licDocs ? ` <b>Leo los ${licDocs} PDF de la licitación</b> (bases y anexos).` : ""}</div>
      <div class="rb-chat">${(c.mensajes || []).map((m) => `<div class="rb-msg ${m.rol === "yo" ? "yo" : "cl"}">${md(m.texto)}</div>`).join("") || `<div class="rb-chat-sug">${sug.map((q) => `<button type="button" class="rb-rchip" data-rb="claude-sug" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`}
        ${c.cargando ? `<div class="rb-msg cl"><span class="spinner"></span> pensando…</div>` : ""}${c.error ? `<div class="rb-msg err">⚠ ${esc(c.error)}</div>` : ""}<div id="rbChatFin"></div></div>
      <div class="rb-chat-in"><textarea id="rbChatIn" rows="2" placeholder="Escríbeme o dícta me…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.closest('.rb-chat-in').querySelector('[data-rb=claude-enviar]').click()}"></textarea>${("webkitSpeechRecognition" in window || "SpeechRecognition" in window) ? `<button class="btn ${R.chat?.oyendo ? "rb-oro" : ""}" type="button" data-rb="claude-mic" aria-label="Dictar" title="Hablar en vez de escribir">${R.chat?.oyendo ? "⏺" : "🎙"}</button>` : ""}<button class="btn rb-oro" type="button" data-rb="claude-enviar">Enviar</button></div>`;
  }
  // ---------- 📞 «Me llamaron»: escribe o graba qué te dijeron y el robot te dice si da o no ----------
  const HIST = "sdc:llamadas";
  const leerHist = () => { try { return JSON.parse(localStorage.getItem(HIST)) || []; } catch { return []; } };
  function buscarLocal(texto) {
    const n = (t) => norm(t);
    const cods = (String(texto).toUpperCase().match(COD_CA_G) || []);
    const ts = R.data?.trabajos || [];
    if (cods.length) return ts.filter((t) => cods.includes(t.codigo));
    const ws = n(texto).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 3 && !/^(llamaron|llamo|quiere|saber|sobre|oferta|compra|para|cliente|hola|como|tiene|dice|proveedor)$/.test(w));
    if (!ws.length) return [];
    return ts.map((t) => [ws.filter((w) => n((t.nombre || "") + " " + (t.organismo || "") + " " + t.codigo).includes(w.length > 5 ? w.slice(0, -1) : w)).length, t])
      .filter(([p]) => p).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, t]) => t);
  }
  // las compras a las que pudo referirse quien llamó: primero las ENVIADAS (con comprobante) y ganadas
  // 🔎 el asistente busca la compra en todos los juegos, en Ejecuta y en el informe global, por producto, organismo, ciudad u OC
  const VACIAS = new Set("llamaron llamo llamado llamada quiere queria saber sobre oferta ofertas compra compras agil para desde esta este estos estas cliente clientes hola como tiene tienen dice dijo dijeron proveedor ganaste ganamos gane ganada ganado aceptando aceptaron aceptada acepto aceptar estan estamos ellos ellas nosotros porque donde cuando unos unas solo algo mucho muchos hace hacer necesita necesitan pregunta preguntan preguntaron llamar llame orden".split(" "));
  const raiz = (w) => w.replace(/(es|s)$/, "").slice(0, Math.max(4, Math.min(w.length, 7)));
  function pajar(t) {
    const oc = t.oc_compra || {}, op = t.op || {}, inf = op.informe || {};
    return norm([t.nombre, t.organismo, t.codigo, t.detalle, (t.items || []).map((i) => i.d).join(" "), oc.organismo, oc.unidad, oc.direccion, oc.nombre, oc.descripcion,
      (oc.items || []).map((i) => `${i.nombre || ""} ${i.especificacion || ""}`).join(" "), op.oc_codigo, inf.direccion, (inf.que_comprar || []).map((x) => x.que).join(" "),
      (inf.productos || []).map((x) => x.nombre).join(" ")].filter(Boolean).join(" "));
  }
  function poolLlamada() {
    const m = new Map();
    for (const t of [...(R.data?.trabajos || []), ...(R.todos || []), ...(R.ejec || []), ...(R.global?.trabajos || [])]) if (t?.codigo && !m.has(t.codigo)) m.set(t.codigo, t);
    return [...m.values()];
  }
  function candidatasLlamada(texto) {
    const ts = poolLlamada();
    const cods = (String(texto).toUpperCase().match(/\d{1,8}-\d{1,8}-[A-Z]{2,3}\d{2}/g) || []);
    if (cods.length) { const x = ts.filter((t) => cods.includes(t.codigo) || cods.includes(t.op?.oc_codigo)).map((t) => t.codigo); if (x.length) return x; }
    const ws = [...new Set(norm(texto).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 3 && !VACIAS.has(w)).map(raiz))];
    if (!ws.length) return [];
    const pts = (t) => { const h = pajar(t); return ws.reduce((s2, w) => s2 + (h.includes(w) ? (w.length > 5 ? 2 : 1) : 0), 0); };
    const g = (t) => (t.op?.oc_codigo || segDe(t.codigo)?.ganada ? 3 : t.op ? 2 : HECHA.includes(t.estado) ? 1 : 0);
    return ts.map((t) => [pts(t), g(t), t]).filter(([p2]) => p2 > 0).sort((a, b) => b[0] - a[0] || b[1] - a[1] || (b[2].actualizado || "").localeCompare(a[2].actualizado || "")).slice(0, 6).map(([, , t]) => t.codigo);
  }
  function correoProveedores(t, F, W) {
    const inf = t.op?.informe || {};
    const prods = (F?.productos || []).length ? F.productos.map((x) => `- ${x.cantidad ?? ""} ${x.unidad || ""} ${x.nombre}${x.detalle ? " (" + String(x.detalle).slice(0, 110) + ")" : ""}`)
      : (W?.items || []).map((i) => `- ${i.q} x ${i.d}`);
    const emp = empresaActual() || {};
    return { asunto: `Solicitud de cotización · ${t.nombre || t.codigo}`.slice(0, 120),
      cuerpo: `Estimados,\n\nJunto con saludar, solicitamos cotización con factura de los siguientes productos:\n${prods.join("\n") || "- (ver detalle adjunto)"}\n\n` +
        `Entrega en: ${F?.direccion || inf.direccion || "(por confirmar)"}${F?.plazo_dias ? " · plazo " + F.plazo_dias + " días" : ""}.\n` +
        `Agradeceremos indicar precio unitario neto, descuento por volumen o pago contado, stock, plazo de entrega y costo de despacho.\n\n` +
        `Saludos cordiales,\n${emp.contacto || ""}\n${emp.razon_social || ""}${emp.telefono ? "\n" + emp.telefono : ""}${emp.email ? "\n" + emp.email : ""}` };
  }
  // 💎 planes de suscripción: Básico USD 20 · Medio USD 100 · Premium USD 1.000 al mes
  const NIVEL = { basico: 1, medio: 2, premium: 3 };
  const PLANES_INFO = [
    ["basico", "Básico", 20, ["🎮 Juego de Compra Ágil: oportunidades, deslizar y firmar rápido", "📞 Asistente «Me llamaron»", "Hasta 150 cotizaciones al mes", "1 usuario"]],
    ["medio", "Medio", 100, ["Todo lo del Básico", "🛠 Ejecuta: proveedores, correos automáticos, Marketplace, pago y despacho", "📑 Licitaciones (5 al mes) con lectura experta de bases y anexos firmados", "🌍 Informe global y 3 usuarios"]],
    ["premium", "Premium", 1000, ["Todo lo del Medio", "📑 Licitaciones ilimitadas + visualización del proyecto", "🔴 Entregas en vivo con lentes Meta para tus inversionistas", "☁️ Robot dedicado en la nube 24/7 · soporte directo"]],
  ];
  const esDueno = () => legado();
  const miPlan = () => esDueno() ? "premium" : (R.plan?.estado === "activo" ? R.plan.plan : null);
  // 🔓 Modo abierto: mientras lo usamos para ofertar, todo queda desbloqueado para todos.
  //    Al lanzar en App Store, pon ABIERTO_PARA_TODOS = false y vuelven los planes.
  const ABIERTO_PARA_TODOS = true;
  const tienePlan = (min) => ABIERTO_PARA_TODOS || (NIVEL[miPlan()] || 0) >= NIVEL[min];
  async function cargarPlan() {
    if (R._cargPlan) return; R._cargPlan = true;
    try { const r = await api("plan?jugador=" + miJug() + (esDueno() ? "&admin=1" : "")); R.plan = r.plan; R.planLinks = r.links || {}; R.planesTodos = r.todos || null; R.planT = Date.now(); pintarHojaSiAbierta(); } catch {} finally { R._cargPlan = false; }
  }
  function candado(min, que) {
    const n = PLANES_INFO.find((p) => p[0] === min);
    return `<div class="rb-candado"><div style="font-size:2rem">🔒</div><b>${esc(que)} es parte del plan ${n[1]}</b><div class="muted" style="font-size:.74rem">Desde USD ${n[2]} al mes.</div>
      <button class="btn rb-oro rb-big-btn" type="button" data-rb="planes">💎 Ver planes</button></div>`;
  }
  function pantallaPlanes() {
    if (!R.planT || Date.now() - R.planT > 60000) setTimeout(cargarPlan, 0);
    const actual = miPlan(), pedido = R.plan?.plan_pedido;
    return `<div class="rb-paso"><div class="rb-env"><h2 class="rb-h" style="margin:0">💎 Planes</h2><button class="btn small" type="button" data-rb="planes-cerrar">← Volver</button></div>
      <div class="muted rb-sub">${esDueno() ? "Eres el dueño: tienes todo activo. Así ven los planes tus clientes." : actual ? "Tu plan actual: <b>" + esc(PLANES_INFO.find((p) => p[0] === actual)[1]) + "</b>." : pedido ? "Pediste el plan <b>" + esc(pedido) + "</b>: se activa cuando se confirma el pago." : "Elige tu plan. Pago mensual en dólares (o su equivalente en pesos)."}</div>
      ${PLANES_INFO.map(([k, nom, usd, feats]) => `<div class="rb-plan-c ${k} ${actual === k ? "on" : ""}"><div class="rb-env"><b style="font-size:1.05rem">${nom}</b><b class="rb-precio">USD ${usd.toLocaleString("es-CL")}<small>/mes</small></b></div>
        <ul class="rb-ul">${feats.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        ${actual === k ? `<div class="rb-resp nueva">✅ Es tu plan</div>` : esDueno() ? "" : `<button class="btn ${k === "medio" ? "rb-oro" : ""} rb-big-btn" type="button" data-rb="plan-pedir" data-v="${k}">${pedido === k ? "⏳ Pedido · pagar" : "Quiero el " + nom}</button>`}</div>`).join("")}
      ${esDueno() ? `<div class="rb-sec">💳 Links de pago de cada plan</div><div class="muted" style="font-size:.72rem">Crea en Mercado Pago (o Flow) un link de suscripción mensual por plan y pégalo aquí. Al tocar «Quiero el plan», el cliente va directo a pagar.</div>
        ${PLANES_INFO.map(([k, nom, usd]) => `<label class="rb-lab">${nom} · USD ${usd.toLocaleString("es-CL")}/mes<input class="rb-in" id="rbPago-${k}" value="${esc((R.planLinks || {})[k] || "")}" placeholder="https://www.mercadopago.cl/subscriptions/..." inputmode="url" autocapitalize="off" autocorrect="off"></label>`).join("")}
        <div class="rb-row"><button class="btn rb-oro" type="button" data-rb="plan-links" style="flex:1">💾 Guardar links</button><a class="btn small" href="https://www.mercadopago.cl/subscription-plans/create" target="_blank" rel="noopener">Crear en Mercado Pago</a></div>` : ""}
      ${esDueno() ? bloqueNube() : ""}
      ${esDueno() && R.planesTodos ? `<div class="rb-sec">👑 Activar planes de tus clientes</div>${Object.entries(R.planesTodos).map(([j, x]) => `<div class="rb-op"><div class="rb-env"><b>${esc(x.nombre || "Juego " + j.slice(-4))}</b><span class="rb-pill">${esc(x.estado || "")} · ${esc(x.plan || x.plan_pedido || "")}</span></div>
        <div class="rb-row">${PLANES_INFO.map(([k, nom]) => `<button class="btn small ${x.plan === k && x.estado === "activo" ? "rb-oro" : ""}" type="button" data-rb="plan-activar" data-j="${esc(j)}" data-v="${k}">${nom}</button>`).join("")}${x.telefono ? `<a class="btn small" href="https://wa.me/${waNum(x.telefono)}" target="_blank" rel="noopener">💬</a>` : ""}</div></div>`).join("") || `<div class="muted" style="font-size:.74rem">Aún nadie ha pedido un plan.</div>`}` : ""}
    </div>`;
  }
  // ☁️ robot en la nube 24/7: funciona aunque el PC esté apagado
  async function cargarNube() {
    if (R._cargNube) return; R._cargNube = true;
    try { const [n, so] = await Promise.all([api("nube-estado"), api("nube-solicitudes").catch(() => ({}))]); R.nube = { ...n, solicitudes: so.solicitudes || [] }; R.nubeT = Date.now(); pintarHojaSiAbierta(); } catch {} finally { R._cargNube = false; }
  }
  // 🔐 CONECTAR MERCADO PÚBLICO DESDE EL CELULAR: RUN y ClaveÚnica se cifran aquí con la llave pública del robot del PC
  // (RSA-OAEP). La nube solo los pasa sellados: no los puede leer ni los guarda. El robot los escribe en ClaveÚnica
  // con el internet del PC (ClaveÚnica bloquea los servidores en la nube) y pregunta aquí el código o la empresa.
  async function cargarLoginMP() {
    clearTimeout(R.mplTimer);
    try { R.mpl = await api("mp-login"); R.mplErr = null; } catch (e) { R.mplErr = e.message; }
    const E = R.mpl?.estado, firma = E ? E.id + E.paso + E.t : "";
    if (firma !== R.mplFirma) { R.mplFirma = firma; pintarHojaSiAbierta(); }
    if (R.pantalla === "mplogin") R.mplTimer = setTimeout(cargarLoginMP, E && !["listo", "error", "cancelado", "bloqueada", "run_malo", "clave_mala"].includes(E.paso) ? 2000 : 6000);
    // 🛡 ClaveÚnica se bloquea al 3er intento: se cuentan los rechazos y se avisa ANTES de gastar el último
    if (E && E.id !== R.mplContado && ["clave_mala", "run_malo"].includes(E.paso)) { R.mplContado = E.id; guardar({ mplFallos: (leer().mplFallos || 0) + 1 }); pintarHojaSiAbierta(); }
    if (E && E.paso === "listo" && leer().mplFallos) guardar({ mplFallos: 0 });
  }
  function runValido(r) {                 // dígito verificador del RUN (módulo 11): un RUN mal escrito no gasta intentos
    const m = String(r).toUpperCase().replace(/[^0-9K]/g, "").match(/^(\d{7,8})([0-9K])$/); if (!m) return false;
    let s = 0, f = 2; for (let i = m[1].length - 1; i >= 0; i--) { s += +m[1][i] * f; f = f === 7 ? 2 : f + 1; }
    const dv = 11 - (s % 11); return m[2] === (dv === 11 ? "0" : dv === 10 ? "K" : String(dv));
  }
  async function sobreMP(obj) {
    const pub = R.mpl?.pub;
    if (!pub) throw new Error("El robot del PC aún no manda su llave: enciéndelo (con la versión nueva) y espera 10 segundos.");
    const der = Uint8Array.from(atob(pub), (c) => c.charCodeAt(0));
    const k = await crypto.subtle.importKey("spki", der, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, k, new TextEncoder().encode(JSON.stringify(obj))));
    let bin = ""; ct.forEach((x) => (bin += String.fromCharCode(x)));
    return btoa(bin);
  }
  // 🚪 al abrir la app (dueño): si la nube no tiene sesión de Mercado Público vigente, lo primero es conectarla
  function inicioLoginMP() {
    if (R.mplIni) return; R.mplIni = true;
    api("mp-login").then((x) => { R.mpl = x; pintarHojaSiAbierta(); }).catch(() => {});
  }
  // 🖥/☁️ barra de modo del dueño: elige dónde corre el robot, con luz 🟢 encendido / 🔴 apagado, y el botón de ingreso
  function barraMando(r, mp, conectado) {
    const M = R.nube?.mando || {}, pref = M.preferido || "";
    const enNube = /nube/i.test(r?.equipo || "");
    const luz = conectado ? "🟢" : "🔴";
    const estado = conectado
      ? (enNube ? "Robot andando en la nube" : "Robot andando en tu PC") + (r?.ocupado && r?.tarea ? " · " + esc(corta(r.tarea)) : r?.ocupado ? " · ocupado" : " · libre")
      : "Robot apagado — enciéndelo en tu PC (abre el robot)";
    const b = (v, t) => `<button type="button" class="${pref === v ? "on" : ""}" data-rb="robot-mando" data-v="${v}">${t}</button>`;
    return `<div class="rb-mando-barra">
      <div class="rb-mando-luz"><b>${luz} ${esc(estado)}</b></div>
      <div class="rb-etapas rb-modos" style="margin-top:6px">${b("pc", "🖥 PC")}${b("nube", "☁️ Nube")}${b("", "⚙ Auto")}</div>
      <button class="btn small rb-oro" type="button" data-rb="mp-safari" style="width:100%;margin-top:7px">🧑 Iniciar sesión en Mercado Público <small style="opacity:.85">(abre Safari)</small></button>
      <button class="btn small" type="button" data-rb="nube-pronto" style="width:100%;margin-top:6px;opacity:.5">☁️ Ingresar a la nube <small>(pronto)</small></button>
      ${conectado ? "" : `<div class="muted" style="font-size:.68rem;margin-top:5px">Si está en rojo: abre el robot en tu PC. Cuando se ponga 🟢, toca «Ingresar a Mercado Público».</div>`}
    </div>`;
  }
  function loginActivo() {
    const E = R.mpl?.estado;
    return E && Date.now() - Date.parse(E.t) < 360000 && !["listo", "error", "cancelado", "bloqueada", "run_malo", "clave_mala"].includes(E.paso) ? E : null;
  }
  function pantallaLoginMP() {
    if (!R.mplCarg) { R.mplCarg = true; setTimeout(cargarLoginMP, 0); }
    const L = R.mpl || {}, E = L.estado && Date.now() - Date.parse(L.estado.t) < 900000 ? L.estado : null, A = loginActivo();
    const foto = E?.foto ? `<details class="rb-ajustes" style="margin-top:10px"><summary>🖥 Ver la pantalla del robot</summary><img src="data:image/jpeg;base64,${E.foto}" alt="Pantalla del robot" style="width:100%;border-radius:10px;margin-top:6px"></details>` : "";
    const form = `<div class="label" style="margin-top:12px">RUN (tu RUT)</div>
        <input id="rbMplRun" class="rb-in" placeholder="12.345.678-9" autocomplete="username" autocapitalize="characters" inputmode="text" style="width:100%">
        <div class="label" style="margin-top:10px">ClaveÚnica</div>
        <input id="rbMplClave" class="rb-in" type="password" placeholder="Tu ClaveÚnica" autocomplete="current-password" style="width:100%">
        <button class="btn rb-oro" type="button" data-rb="mpl-enviar" style="width:100%;margin-top:12px">🔐 Conectar</button>
        <div class="muted" style="font-size:.7rem;margin-top:6px">⚠️ ClaveÚnica se bloquea al 3er intento fallido. El robot hace un solo intento por vez y nunca reintenta solo.</div>
        <div class="muted" style="font-size:.7rem;margin-top:8px">Se cifran en este celular con la llave del robot de tu PC: la nube no puede leerlos y no se guardan en ninguna parte.</div>`;
    let cuerpo;
    if (!A) {
      cuerpo = (E?.paso === "listo" ? `<div class="rb-resp nueva" style="margin:10px 0"><b>✅ Mercado Público conectado</b><div style="font-size:.78rem">${esc(E.mensaje || "El robot ya tiene tu sesión.")}</div></div>`
        : E?.paso === "error" ? `<div class="rb-alertas"><b>No se pudo conectar</b>${esc(E.mensaje || "")}</div>`
        : E?.paso === "run_malo" ? `<div class="rb-alertas"><b>🪪 El RUN no fue aceptado</b>${esc(E.mensaje || "")}<br>Revisa tu RUN y vuelve a intentar. El robot no reintentó solo.</div>`
        : E?.paso === "clave_mala" ? `<div class="rb-alertas"><b>🔑 RUN o ClaveÚnica incorrectos</b>ClaveÚnica dice: «${esc(E.mensaje || "")}».<br>ClaveÚnica no indica cuál de los dos está mal. Revisa ambos con calma: <b>al 3er intento fallido se bloquea</b>. El robot no reintenta solo.${(leer().mplFallos || 0) >= 2 ? `<br><b>Ya van ${leer().mplFallos} rechazos.</b> Te recomendamos recuperar tu clave antes de intentar otra vez: <a href="https://claveunica.gob.cl/" target="_blank" rel="noopener">claveunica.gob.cl → Recupera tu ClaveÚnica</a>` : ""}</div>`
        : E?.paso === "bloqueada" ? `<div class="rb-alertas"><b>🔒 Tu ClaveÚnica quedó bloqueada</b>Lo sentimos mucho: nunca fue la intención bloquearla. ClaveÚnica dice: «${esc(E.mensaje || "")}».<br><br><b>Cómo recuperarla:</b> entra a <a href="https://claveunica.gob.cl/" target="_blank" rel="noopener">claveunica.gob.cl</a> → «Recupera tu ClaveÚnica» y sigue los pasos (te llega un enlace a tu correo). Si no tienes acceso a ese correo, puedes pedir una nueva en una oficina del Registro Civil o ChileAtiende con tu cédula. Cuando la tengas, vuelve aquí y conectamos con calma.</div>`
        : E?.paso === "captcha" ? `<div class="rb-alertas"><b>🧩 ClaveÚnica pide una verificación</b>${esc(E.mensaje || "")}</div>` : "")
        + (L.pc_vivo === false ? `<div class="rb-alertas" style="margin-top:8px"><b>🖥 El robot del PC está apagado</b>Enciéndelo: ClaveÚnica solo deja entrar desde internet de casa u oficina, no desde servidores en la nube.</div>` : "")
        + (E?.paso === "listo" ? `<button class="btn small" type="button" data-rb="mpl-salir" style="width:100%;margin-top:8px">Volver</button><details class="rb-ajustes" style="margin-top:8px"><summary>Conectar otra vez</summary>${form}</details>` : form);
    } else if (A.paso === "codigo") {
      cuerpo = `<div class="rb-resp nueva" style="margin:10px 0"><b>🔢 ClaveÚnica pide un código</b><div style="font-size:.78rem">${esc(A.mensaje || "Escribe el código que te llegó.")}</div></div>
        <input id="rbMplCod" class="rb-in" placeholder="Código" inputmode="numeric" autocomplete="one-time-code" style="width:100%;font-size:1.3rem;letter-spacing:.2em;text-align:center">
        <button class="btn rb-oro" type="button" data-rb="mpl-codigo" style="width:100%;margin-top:10px">Enviar código</button>`;
    } else if (A.paso === "empresa") {
      cuerpo = `<div class="rb-resp nueva" style="margin:10px 0"><b>🏢 Elige con qué empresa entrar</b><div style="font-size:.78rem">${esc(A.mensaje || "")}</div></div>`
        + (A.opciones || []).map((o, i) => `<button class="btn small" type="button" data-rb="mpl-opcion" data-v="${i}" style="width:100%;margin:4px 0;text-align:left">${esc(o)}</button>`).join("");
    } else {
      cuerpo = `<div class="rb-op" style="margin:12px 0;text-align:center"><span class="spinner"></span><div style="margin-top:8px">${esc(A.mensaje || "Trabajando…")}</div></div>`;
    }
    return `<div class="rb-sheet-head"><h2 style="margin:0">🔐 Conectar Mercado Público</h2><button class="rb-x" type="button" data-rb="mpl-salir" aria-label="Volver">✕</button></div>
      <div class="muted" style="font-size:.78rem">Ingresa tu RUN y ClaveÚnica; si llega un código a tu correo, lo escribes aquí. El robot entra a Mercado Público por ti y deja la sesión en la nube para trabajar 24/7.</div>
      ${L.sesion_nube ? `<div class="rb-pill ${L.sesion_nube.ok ? "verde" : ""}" style="margin:8px 0;display:inline-block">${L.sesion_nube.ok ? "☁️ Nube conectada" : "☁️ Nube sin sesión"} · ${esc(hace(L.sesion_nube.t))}</div>` : ""}
      ${R.mplErr ? `<div class="rb-alertas"><b>Sin conexión</b>${esc(R.mplErr)}</div>` : ""}${cuerpo}${foto}
      ${A ? `<button class="btn small" type="button" data-rb="mpl-cancelar" style="width:100%;margin-top:10px">Cancelar</button>` : ""}`;
  }
  // ☁️ entrar directo a la pantalla del robot de la nube (la contraseña VNC va en el # : no viaja al servidor)
  function vistaDirecta() {
    const e = R.nube?.nube; if (!e?.vista) return null;
    const u = e.vista.includes("path=") ? e.vista : e.vista + (e.vista.includes("?") ? "&" : "?") + "path=websockify";
    return u.split("#")[0] + (e.clave ? "#&password=" + encodeURIComponent(String(e.clave).slice(0, 8)) : "");
  }
  async function entrarNube() {
    let u = vistaDirecta();
    if (u) { window.open(u, "_blank"); return; }
    const w = window.open("about:blank", "_blank");
    R.nubeT = 0; await cargarNube(); u = vistaDirecta();
    if (u && w) w.location.href = u; else { try { w && w.close(); } catch {} toast("El robot de la nube aún no está listo: 💎 Planes → ☁️ Robot en la nube"); }
  }
  function bloqueNube() {
    if (!R.nubeT || Date.now() - R.nubeT > 10000) setTimeout(cargarNube, 0);
    const N = R.nube || {}, e = N.nube, lat = N.latido, pq = N.paquete;
    const cmd = `curl -fsSL ${location.origin}/nube/instalar.sh | bash`;
    const pend = (N.solicitudes || []).filter((x) => x.estado === "pendiente");
    const solic = pend.map((x) => `<div class="rb-resp nueva" style="margin:6px 0"><b>☁️ Un servidor pide conectarse</b><div style="font-size:.74rem;margin:3px 0">IP <b>${esc(x.ip || "?")}</b>${x.nombre ? " · " + esc(x.nombre) : ""} · ${esc(hace(x.t))}<br>Apruébalo solo si esa IP es la de tu servidor en DigitalOcean.</div>
      <div class="rb-row"><button class="btn rb-oro" type="button" data-rb="nube-aprobar" data-v="${esc(x.id)}" style="flex:1">✅ Aprobar</button><button class="btn small" type="button" data-rb="nube-rechazar" data-v="${esc(x.id)}">✕</button></div></div>`).join("");
    const vivo = lat?.visto && Date.now() - Date.parse(lat.visto) < 120000, enNube = /nube/i.test(lat?.equipo || "");
    return `<div class="rb-sec">☁️ Robot en la nube 24/7</div>
      ${solic}${(() => { const M = N.mando || {}, eqs = N.equipos || {}, pref = M.preferido || "";
        const otros = Object.entries(eqs).filter(([k, v]) => k !== M.equipo && Date.now() - Date.parse(v.visto) < 120000).map(([k]) => k);
        const b2 = (v, t) => `<button type="button" class="${pref === v ? "on" : ""}" data-rb="robot-mando" data-v="${v}">${t}</button>`;
        return `<div class="rb-op"><div class="rb-env"><b>🎖 Robot a cargo</b><span class="muted" style="font-size:.7rem">${esc(M.equipo || "—")}</span></div>
          <div class="rb-etapas rb-modos">${b2("pc", "🖥 PC")}${b2("nube", "☁️ Nube")}${b2("", "⚙ Automático")}</div>
          <div class="muted" style="font-size:.68rem">Mercado Público acepta una sola sesión: trabaja un robot a la vez y el otro espera quieto.${otros.length ? ` En espera: ${otros.map(esc).join(", ")}.` : ""}</div></div>`; })()}
      <div class="rb-op"><div class="rb-env"><b>${vivo ? (enNube ? "🟢 Funcionando en la nube" : "🟡 Funcionando en tu PC") : "⚪ Robot apagado"}</b><span class="muted" style="font-size:.7rem">${esc(lat?.equipo || "")}${lat?.visto ? " · " + esc(hace(lat.visto)) : ""}</span></div>
      ${e ? `<div class="muted" style="font-size:.74rem;margin:4px 0">Servidor ${esc(e.host)} · instalado ${esc(hace(e.t))}</div>
        <div class="rb-row"><a class="btn rb-oro" href="${esc(vistaDirecta() || e.vista)}" target="_blank" rel="noopener" style="flex:1">☁️ Conectarme a la nube</a><a class="btn small" href="${esc(e.panel)}" target="_blank" rel="noopener">Panel</a></div>
        <div class="rb-kv"><span>Usuario <b>${esc(e.usuario)}</b></span><span>Clave <b>${esc(e.clave)}</b></span><button class="btn small" type="button" data-rb="nube-copiar" data-v="${esc(e.clave)}">📋</button></div>
        <div class="muted" style="font-size:.7rem">En la vista remota inicias sesión en Mercado Público una vez (como en el PC). Después el robot trabaja solo, aunque apagues el computador.</div>`
      : `<ol class="rb-ul" style="font-size:.76rem;line-height:1.5;padding-left:18px">
          <li>Crea un servidor Ubuntu 24.04 de 2–4 GB (DigitalOcean, Hetzner, Vultr…: ~USD 12–24/mes).</li>
          <li>En el PC: doble clic en <b>SUBIR_A_LA_NUBE</b> ${pq?.t ? `<span class="rb-pill verde">✓ subido ${esc(hace(pq.t))}</span>` : pq?.bajado ? `<span class="rb-pill verde">✓ descargado</span>` : ""}</li>
          <li>Pega este comando en «Startup scripts» al crear el servidor (o en su consola). Luego aprueba aquí la conexión:</li></ol>
        <div class="rb-cmd">${esc(cmd)}</div>
        <div class="rb-row"><button class="btn rb-oro" type="button" data-rb="nube-copiar" data-v="${esc(cmd)}" style="flex:1">📋 Copiar comando</button></div>
        <div class="muted" style="font-size:.68rem">Al terminar te llega un aviso y aquí aparece la vista remota con su clave.</div>`}</div>`;
  }
  // 🌍 informe global
  async function cargarGlobal() {
    if (R._cargGlobal) return R._cargGlobal;
    R._cargGlobal = (async () => { try { const r = await api("global"); R.global = { trabajos: r.trabajos || [], jugadores: r.jugadores || {} }; R.globalT = Date.now(); pintarHojaSiAbierta(); } catch {} finally { R._cargGlobal = null; } })();
    return R._cargGlobal;
  }
  // ---------- 📦 Órdenes de compra: una caja con SOLO las OC, en el orden en que se operan ----------
  function clasificarOC(t) {
    const o = t.op || {}, est = String(o.oc_estado || "");
    if (/cancelad|anulad|rechazad/i.test(est)) return "D";
    if (o.cerrado || o.cobrado || ["cerrado", "entrega", "entregado"].includes(o.etapa)) return "A";
    if (o.proveedor || o.precio_acordado || o.proveedor_pagado || ["pago", "transporte", "despacho"].includes(o.etapa)) return "B";
    return "C";
  }
  const OC_BLOQUES = { A: ["✅ Ya operadas", "entregadas o cerradas: cobrar y archivar"], B: ["🔧 En operación", "con proveedor acordado: pagar, despachar, pedir recepción"], C: ["🆕 OC nuevas", "ganadas esta semana: aceptar la OC en MP y cerrar proveedor"], D: ["⚠️ Canceladas · revisar", "la OC se canceló: no pagar ni comprar; verificar en MP"] };
  function pasoOC(t, b) {
    const o = t.op || {}, est = String(o.oc_estado || "");
    if (b === "D") return o.proveedor_pagado ? "Proveedor pagado con OC cancelada: recuperar o reasignar" : "Avisar al proveedor y cerrar";
    if (b === "A") return o.cobrado ? "Cobrado · archivar" : "Emitir factura y cobrar";
    if (b === "B") { if (!o.proveedor_pagado && o.precio_acordado) return "Pagar al proveedor " + clp(o.precio_acordado); if (/enviada a proveedor/i.test(est)) return "Aceptar la OC en MP y despachar"; if (o.etapa === "transporte" || o.etapa === "despacho") return "Confirmar entrega y pedir recepción conforme"; return "Pedir recepción conforme y facturar"; }
    return /enviada a proveedor/i.test(est) ? "Aceptar la OC en MP · buscar proveedor" : "Cerrar proveedor y agendar entrega";
  }
  function pantallaOC() {
    const todas = esDueno() && R.ocTodas !== false;
    const base = (R.todos || R.data?.trabajos || []).filter((t) => todas || deMiEmpresa(t));   // las OC son de la empresa, no de un juego
    const L = base.filter((t) => t.op && (t.op.oc_codigo || t.op.oc));
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = (t) => t.op?.plazo_fecha ? Math.floor((new Date(t.op.plazo_fecha + "T12:00") - hoy) / 86400000) : null;
    const grupos = { A: [], B: [], C: [], D: [] };
    for (const t of L) grupos[clasificarOC(t)].push(t);
    const llego = (t) => t.op?.oc_fecha || (t.op?.historial || []).find((h) => h.etapa === "ganada")?.t || t.actualizado || "";
    const ordenar = (xs) => xs.sort((a, b) => llego(a).localeCompare(llego(b)));   // 🕒 en el orden en que llegaron: así se atienden en parrilla
    const suma = (xs) => xs.reduce((s, t) => s + (Number(t.total) || 0), 0);
    const fila = (t, b) => { const o = t.op || {}, d = dias(t), emp = (R.empresas || {})[t.empresa || "principal"]; const tarde = d != null && d < 0;
      return `<div class="rb-card rb-oc-f" data-rb="det" data-c="${esc(t.codigo)}" style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;margin:6px 0;cursor:pointer">
        <div class="rb-oc-d ${tarde ? "tarde" : d != null && d <= 2 ? "pronto" : ""}">${d == null ? "<b>—</b><small>s/f</small>" : `<b>${Math.abs(d)}</b><small>${tarde ? "atrás" : d === 0 ? "hoy" : "días"}</small>`}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.nombre || t.codigo)}</b><b style="font-size:.9rem;white-space:nowrap">${clp(t.total)}</b></div>
          <div class="muted" style="font-size:.74rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.organismo || "")}${todas && emp ? " · " + esc(corta(emp.razon_social, 18)) : ""}</div>
          <div style="font-size:.74rem;margin-top:3px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="rb-oc-tag">OC ${esc(String(o.oc_codigo || o.oc))}</span>${o.oc_estado ? `<span class="rb-oc-tag ${/aceptada/i.test(o.oc_estado) ? "ok" : /cancelad/i.test(o.oc_estado) ? "mal" : ""}">${esc(o.oc_estado)}</span>` : ""}${o.proveedor ? `<span class="rb-oc-tag">${esc(corta(typeof o.proveedor === "object" ? o.proveedor.nombre || "" : o.proveedor, 16))}${o.proveedor_pagado ? " ✓ pagado" : ""}</span>` : ""}</div>
          <div style="font-size:.78rem;margin-top:4px;color:${b === "D" ? "#ff9a9a" : "var(--oro, #f5cf6b)"}">→ ${esc(pasoOC(t, b))}</div>
        </div></div>`; };
    const sel = R.ocB || "";
    const chips = Object.keys(OC_BLOQUES).map((k) => `<button type="button" class="rb-rchip ${sel === k ? "on" : ""}" data-rb="oc-bloque" data-b="${k}">${OC_BLOQUES[k][0].replace(/^\S+\s/, "")}<i>${grupos[k].length}</i></button>`).join("");
    const bloques = Object.keys(OC_BLOQUES).filter((k) => !sel || sel === k).map((k) => grupos[k].length ? `<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>${OC_BLOQUES[k][0]} · ${grupos[k].length}</b><span class="muted" style="font-size:.78rem">${clp(suma(grupos[k]))}</span></div><div class="muted" style="font-size:.72rem;margin-bottom:4px">${OC_BLOQUES[k][1]}</div>${ordenar(grupos[k]).map((t) => fila(t, k)).join("")}</div>` : "").join("");
    const vivas = [...grupos.A, ...grupos.B, ...grupos.C];
    return `<div class="rb-paso"><div class="rb-env"><h2 class="rb-h" style="margin:0">📦 Órdenes de compra</h2><button class="btn small" type="button" data-rb="oc-cerrar">← Volver</button></div>
      <div class="muted rb-sub">Solo las compras que ya tienen orden de compra, en el orden en que se operan: por plazo de entrega. ${esDueno() ? `<button class="btn small rb-link" type="button" data-rb="oc-todas">${todas ? "Todas las empresas" : "Solo mi empresa"} ▾</button>` : ""}</div>
      <div class="rb-marcador" style="margin:8px 0"><div class="rb-m oro"><span>📦 OC vivas</span><b>${vivas.length}</b><small>${clp(suma(vivas))} vendido</small></div><div class="rb-m verde"><span>🔧 En operación</span><b>${grupos.B.length}</b><small>${clp(suma(grupos.B))}</small></div><div class="rb-m"><span>🆕 Nuevas</span><b>${grupos.C.length}</b><small>${clp(suma(grupos.C))}</small></div></div>
      <div class="rb-rchips">${chips}</div>
      ${L.length ? bloques : `<div class="empty">Todavía no hay órdenes de compra${todas ? "" : " de tu empresa"}. Cuando te adjudiquen, aparecen aquí solas.</div>`}</div>`;
  }
  function pantallaGlobal() {
    if (!R.global || Date.now() - (R.globalT || 0) > 60000) setTimeout(cargarGlobal, 0);
    const G = R.global; if (!G) return `<div class="empty"><span class="spinner"></span> Juntando todo lo de la app…</div>`;
    const nom = (t) => { const e = G.jugadores[t.jugador] || (R.ejecutores || {})[t.jugador]; return e?.nombre || t.persona || t.dispositivo || (t.jugador ? "Juego " + t.jugador.slice(-4) : "Sin juego (antes)"); };
    const ganada = (t) => !!(t.op?.oc_codigo || segDe(t.codigo)?.ganada);
    const q = norm(R.globalQ || ""), fj = R.globalJ || "";
    const L = G.trabajos.filter((t) => (!fj || (t.jugador || "_") === fj) && (!q || pajar(t).includes(q) || norm(nom(t)).includes(q)));
    const por = {};
    for (const t of G.trabajos) { const k = t.jugador || "_"; const x = por[k] || (por[k] = { nombre: nom(t), tel: (G.jugadores[t.jugador] || {}).telefono, n: 0, env: 0, gan: 0, monto: 0, ult: "" });
      x.n++; if (HECHA.includes(t.estado)) { x.env++; x.monto += Number(t.total) || 0; } if (ganada(t)) x.gan++; if ((t.actualizado || "") > x.ult) x.ult = t.actualizado || ""; }
    const tot = Object.values(por).reduce((a, x) => ({ n: a.n + x.n, env: a.env + x.env, gan: a.gan + x.gan, monto: a.monto + x.monto }), { n: 0, env: 0, gan: 0, monto: 0 });
    return `<div class="rb-paso"><div class="rb-env"><h2 class="rb-h" style="margin:0">🌍 Informe global</h2><button class="btn small" type="button" data-rb="global-cerrar">← Volver</button></div>
      <div class="muted rb-sub">Todo lo que se ha ingresado en la app, en todos los juegos, y quién lo hizo. Cada juego sigue siendo independiente para jugar.</div>
      <div class="rb-tira"><span>📋 <b>${tot.n}</b> compras</span><span>📤 <b>${tot.env}</b> enviadas</span><span>🏆 <b>${tot.gan}</b> ganadas</span><span>💰 <b>${cortoG(tot.monto)}</b></span></div>
      <div class="rb-sec">👥 Por jugador</div>
      ${Object.entries(por).sort((a, b) => b[1].ult.localeCompare(a[1].ult)).map(([k, x]) => `<div class="rb-op ${fj === k ? "on" : ""}"><div class="rb-env"><button type="button" class="rb-link" data-rb="global-j" data-v="${esc(k)}"><b>${k === miJug() ? "⭐ " : ""}${esc(x.nombre)}</b></button><span class="muted" style="font-size:.7rem">${esc(hace(x.ult))}</span></div>
        <div class="rb-kv"><span>${x.n} compras</span><span>📤 ${x.env}</span><span>🏆 ${x.gan}</span><span>${cortoG(x.monto)}</span></div>
        ${x.tel && k !== miJug() ? `<div class="rb-row"><a class="btn small" href="tel:${esc(String(x.tel).replace(/[^\d+]/g, ""))}">📞 Llamar</a><a class="btn small" href="https://wa.me/${waNum(x.tel)}" target="_blank" rel="noopener">💬 WhatsApp</a></div>` : ""}</div>`).join("")}
      <div class="rb-sec">🔎 Buscar en todo ${fj ? `<button class="btn small" type="button" data-rb="global-j" data-v="">Ver todos</button>` : ""}</div>
      <input class="rb-in" id="rbGlobalQ" value="${esc(R.globalQ || "")}" placeholder="Producto, organismo, ciudad, código u OC (ej: rollos térmicos Osorno)" enterkeyhint="search">
      <div class="muted" style="font-size:.68rem;margin:4px 0">${L.length} resultado${L.length === 1 ? "" : "s"}</div>
      ${L.slice(0, 80).map((t) => `<button class="rb-hist rb-glob" type="button" data-rb="llam-si" data-c="${esc(t.codigo)}">
        <b>${ganada(t) ? "🏆 " : ""}${esc((t.nombre || t.codigo).slice(0, 70))}</b>
        <span>${esc(t.codigo)} · ${esc((t.oc_compra?.organismo || t.organismo || "").slice(0, 40))} · ${t.op?.etapa ? "🛠 " + esc(t.op.etapa) : esc(est(t.estado).txt)}${t.total ? " · " + clp(t.total) : ""} · 👤 ${esc(nom(t))} · ${esc(hace(t.actualizado))}</span></button>`).join("")}
    </div>`;
  }
  // ⚡ lo que puedes hacer con esa compra, sin buscar en otra parte
  const quienDe = (t) => { const e = (R.ejecutores || {})[t.jugador] || (R.global?.jugadores || {})[t.jugador]; return e ? e : t.persona ? { nombre: t.persona } : t.dispositivo ? { nombre: t.dispositivo } : null; };
  function barraAcciones(t) {
    const cod = t.codigo, op = t.op || {}, oc = t.oc_compra || {}, ocN = op.oc_codigo || "", enEj = (R.ejec || []).some((x) => x.codigo === cod) || !!op.etapa;
    const docOC = (op.docs || []).filter((d) => d.tipo === "oc").pop(), q = quienDe(t), yo = t.jugador && t.jugador === miJug();
    const tel = String(oc.fono || op.informe?.comprador?.telefono || "").replace(/[^\d+]/g, ""), mail = oc.mail || op.informe?.comprador?.email;
    return `<div class="rb-acciones">
      ${enEj ? `<button class="btn small rb-oro" type="button" data-rb="mail-abrir" data-c="${esc(cod)}">🛠 Abrir en Ejecuta</button>` : `<button class="btn small rb-oro" type="button" data-rb="env-ejecutar" data-c="${esc(cod)}" data-e="${ocN ? "ganada" : "previa"}">🛠 Pasar a Ejecuta</button>`}
      ${t.pdf ? `<button class="btn small rb-firmar" type="button" data-rb="pdf" data-c="${esc(cod)}">📑 Ficha técnica ingresada</button>` : ""}
      <button class="btn small" type="button" data-rb="inv-pdf" data-c="${esc(cod)}">📄 PDF inversionistas</button>
      ${docOC ? `<button class="btn small" type="button" data-rb="neg-doc" data-c="${esc(cod)}" data-id="${esc(docOC.id)}">📄 OC en PDF</button>` : ocN ? `<a class="btn small" href="https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=${encodeURIComponent(ocN)}" target="_blank" rel="noopener">📄 OC ${esc(ocN)}</a>` : `<a class="btn small" href="${portalDe(cod)}" target="_blank" rel="noopener">📄 Ver compra</a>`}
      ${tel ? `<a class="btn small" href="tel:${esc(tel)}">📞 Comprador</a>` : ""}${mail ? `<a class="btn small" href="mailto:${esc(mail)}?subject=${encodeURIComponent("OC " + (ocN || cod))}">✉ Comprador</a>` : ""}
      </div>${q ? `<div class="muted" style="font-size:.68rem;margin-top:4px">👤 La ingresó ${yo ? "tu juego" : "<b>" + esc(q.nombre || "otro juego") + "</b>"}${!yo && q.telefono ? ` · <a href="https://wa.me/${waNum(q.telefono)}?text=${encodeURIComponent("Hola " + (q.nombre || "") + ", te escribo por la compra " + cod + " (" + (t.nombre || "") + ")")}" target="_blank" rel="noopener">💬 escríbele</a>` : ""}</div>` : ""}`;
  }
  // 📊 Analizador de proyectos: Excel en vivo manual (producto, cantidad, compra/venta → utilidad y repartija)
  // 📊 Analizador de proyectos: varios productos (cantidad, compra y venta netos c/u) → Excel en vivo del proyecto completo
  const anlLineas = () => { const a = R.anl || (R.anl = { prod: "", lineas: [] }); if (!Array.isArray(a.lineas)) a.lineas = a.cant || a.compra || a.venta ? [{ prod: a.prod || "", cant: +a.cant || 0, compra: +a.compra || 0, venta: +a.venta || 0 }] : []; if (!a.lineas.length) a.lineas.push({ prod: "", cant: 0, compra: 0, venta: 0 }); return a; };
  const anlTot = (a) => { let v = 0, c = 0; for (const l of a.lineas) { const q = Math.max(0, +l.cant || 0); v += q * Math.max(0, +l.venta || 0); c += q * Math.max(0, +l.compra || 0); } return { ventaIVA: Math.round(v * 1.19), compraIVA: Math.round(c * 1.19), ventaN: Math.round(v), compraN: Math.round(c) }; };
  const anlT = (a) => { const T = anlTot(a); return { codigo: a.prod || a.lineas[0]?.prod || "Proyecto", nombre: a.prod || a.lineas.map((l) => l.prod).filter(Boolean).join(" + "), total: T.ventaIVA, items: a.lineas.filter((l) => l.prod || l.cant).map((l) => ({ d: l.prod, q: +l.cant || 0, p: +l.venta || 0 })), op: { precio_acordado: T.compraIVA, pagos: a.lineas.filter((l) => +l.compra && +l.cant).map((l) => ({ nombre: l.prov || l.prod || "Proveedor", monto: Math.round((+l.cant || 0) * (+l.compra || 0)), factura: true })), informe: {} } }; };
  function anlResultadoHTML(a) { const T = anlTot(a); const t = anlT(a); const listo = T.ventaIVA > 0 && T.compraIVA > 0; const m = T.ventaN ? Math.round((T.ventaN - T.compraN) / T.ventaN * 100) : 0;
    return `<div class="rb-kv" style="margin:8px 0"><span>Venta total c/IVA <b>${clp(T.ventaIVA)}</b></span><span>Compra total c/IVA <b>${clp(T.compraIVA)}</b></span>${listo ? `<span>Margen bruto <b>${m} %</b></span>` : ""}</div>${listo ? excelVivo(t, calcNeg(t)) : `<div class="muted" style="font-size:.78rem">Llena cantidad, compra y venta de al menos un producto para ver el Excel en vivo. 📈</div>`}`; }
  function pantallaAnalizador() {
    const a = anlLineas(); const num = (v) => (v ? Number(v).toLocaleString("es-CL") : "");
    const fila = (l, i) => `<div class="rb-llamar anl-linea" data-i="${i}" style="margin-bottom:8px"><div class="rb-env"><label class="rb-lab" style="flex:1">Producto ${i + 1}<input class="rb-in anl-in" data-i="${i}" data-anl="prod" value="${esc(l.prod || "")}" placeholder="Ej: Sillas plegables"></label>${a.lineas.length > 1 ? `<button class="btn small" type="button" data-rb="anl-quitar" data-i="${i}" title="Quitar" style="margin:18px 0 0 6px">🗑</button>` : ""}</div>
        <div class="rb-row"><label class="rb-lab" style="flex:1">Cantidad<input class="rb-in anl-in" data-i="${i}" data-anl="cant" inputmode="numeric" value="${+l.cant || ""}" placeholder="100"></label><label class="rb-lab" style="flex:1">💸 Compra neto c/u<input class="rb-in anl-in" data-i="${i}" data-anl="compra" inputmode="numeric" value="${num(+l.compra || 0)}" placeholder="2.000"></label><label class="rb-lab" style="flex:1">🏷️ Venta neto c/u<input class="rb-in anl-in" data-i="${i}" data-anl="venta" inputmode="numeric" value="${num(+l.venta || 0)}" placeholder="3.000"></label></div>
        <div class="muted" style="font-size:.72rem;margin-top:2px">${+l.cant && +l.venta ? `vende ${clp(Math.round(+l.cant * +l.venta * 1.19))} · compra ${clp(Math.round(+l.cant * (+l.compra || 0) * 1.19))} (c/IVA)` : ""}</div></div>`;
    return `<div class="rb-paso">
      <div class="rb-env"><h2 class="rb-h" style="margin:0">📊 Analizador de proyectos</h2><button class="btn small" type="button" data-rb="llamada-cerrar">← Volver</button></div>
      <div class="muted rb-sub">Pon los productos del proyecto con cantidad y precios <b>netos por unidad</b> (lo que te cuesta y a cuánto lo vendes). Te armo el <b>Excel en vivo</b> del proyecto completo: utilidad, IVA, factoring, impuestos y repartija.</div>
      <label class="rb-lab">Nombre del proyecto<input class="rb-in anl-in" data-anl="proy" value="${esc(a.prod || "")}" placeholder="Ej: Equipamiento sala de clases"></label>
      <div id="anlLineas">${a.lineas.map(fila).join("")}</div>
      <div class="rb-row" style="margin:4px 0 10px"><button class="btn small rb-oro" type="button" data-rb="anl-agregar">＋ Agregar producto</button><button class="btn small" type="button" data-rb="anl-limpiar">Limpiar</button><button class="btn small" type="button" data-rb="inv-pdf" data-c="Proyecto">📄 PDF inversionistas</button></div>
      <div id="anlResult">${anlResultadoHTML(a)}</div>
    </div>`;
  }
  function pantallaLlamada() {
    const q = R.llamada || {}, r = q.respuesta;
    const verd = r ? ({ si: ["✅ SÍ DA", "si"], no: ["❌ NO DA", "no"] }[r.da] || ["🤔 DEPENDE", "dep"]) : null;
    const cab = `<div class="rb-env"><h2 class="rb-h" style="margin:0">📞 Me llamaron</h2><button class="btn small" type="button" data-rb="llamada-cerrar">← Volver</button></div>`;
    const entrada = `<div class="rb-llamar"><textarea id="rbLlamada" rows="2" placeholder="Ej: me llamaron de fertilizantes de la municipalidad de Reinco">${esc(q.texto || "")}</textarea>
        <div class="rb-row"><button class="btn rb-mic ${R.dictando || R.grabando ? "on" : ""}" type="button" data-rb="llamada-mic">${R.dictando || R.grabando ? "⏹ Listo" : "🎤 Dictar"}</button>
          <button class="btn rb-oro" type="button" data-rb="llamada-buscar" style="flex:1">🔎 Buscar la compra</button></div></div>`;
    // 1) ¿cuál compra es? (de tus enviadas con comprobante)
    if (!q.confirmado) {
      const C = q.cands || null, k = q.idx || 0, cod = C && C[k], t = cod && trabajoG(cod), g = cod ? segDe(cod) || {} : {};
      const recientes = (R.data?.trabajos || []).filter((x) => HECHA.includes(x.estado)).slice(0, 8);
      return `<div class="rb-paso">${cab}
        <div class="muted rb-sub">Escribe o dicta quién te llamó y de qué. Busco en tus <b>ofertas enviadas</b> y te pregunto si es esa.</div>${entrada}
        ${C && t ? `<div class="rb-sec">¿Es esta compra? · ${k + 1} de ${C.length}</div>
          <div class="rb-card rb-swipe rb-cand" data-modo="llam" data-c="${esc(cod)}"><span class="rb-sello si">SÍ ES</span><span class="rb-sello no">OTRA</span>
            <div class="rb-env"><b style="font-size:.78rem">${esc(cod)}</b><span class="rb-pill">${g.ganada ? "🏆 ganada" : esc(g.glosa || est(t.estado).txt)}</span></div>
            <div class="rb-fnom">${esc(t.nombre || "")}</div><div class="muted" style="font-size:.74rem">${esc(t.organismo || "")}</div>
            <div class="rb-kv"><span>Ofertamos <b>${clp(t.total)}</b></span>${t.fecha_envio ? `<span>Enviada ${esc(t.fecha_envio)}</span>` : ""}${t.comprobante ? "<span>🧾 con comprobante</span>" : ""}</div>
            <div class="rb-row"><button class="btn small" type="button" data-rb="llam-no">❌ No, otra</button><button class="btn rb-oro" type="button" style="flex:1" data-rb="llam-si" data-c="${esc(cod)}">✅ Sí, es esta</button></div></div>
          ${C.length > 1 ? `<div class="rb-sec">Otras que calzan</div>${C.filter((x) => x !== cod).map((x) => { const y = trabajoG(x) || {}; return `<button class="rb-hist" type="button" data-rb="llam-si" data-c="${esc(x)}"><b>${esc((y.nombre || x).slice(0, 60))}</b><span>${esc((y.organismo || "").slice(0, 30))}${y.op?.oc_codigo ? " · 🏆 OC" : ""}</span></button>`; }).join("")}` : ""}`
        : C ? `<div class="rb-alertas"><b>No la encontré por esas palabras</b>Elige de tus enviadas recientes o escribe el ID que te dé el cliente.</div>
          ${recientes.map((x) => `<button class="rb-hist" type="button" data-rb="llam-si" data-c="${esc(x.codigo)}"><b>${esc((x.nombre || x.codigo).slice(0, 60))}</b><span>${clp(x.total)}</span></button>`).join("")}` : ""}
        ${leerHist().length && !C ? `<div class="rb-sec">Últimas consultas</div>${leerHist().slice(0, 5).map((h) => `<button class="rb-hist" type="button" data-rb="llamada-ver" data-id="${esc(h.id)}"><b>${esc((h.titular || h.texto || "").slice(0, 70))}</b><span>${esc(hace(h.t))}</span></button>`).join("")}` : ""}
      </div>`;
    }
    // 2) compra confirmada: si da o no, a quién comprarle y el correo listo para 3–4 proveedores
    const cod = q.confirmado, t = trabajoG(cod) || { codigo: cod }, inf = t.op?.informe || {}, g = segDe(cod) || {};
    const F = (R.fichas || {})[cod], W = (R.full || {})[cod];
    if (!F && !(R._pidiendo || {})[cod]) setTimeout(() => cargarDocs(cod), 0);
    const selc = (leerSel()[cod] || {}).costo;
    const finalLocal = inf.final != null && !inf.incompleto ? inf.final : selc && t.total ? Math.round(t.total / 1.19 - selc) : null;
    const provs = [...(inf.opciones || []).map((o) => ({ nombre: o.proveedor, email: o.email, telefono: o.telefono, web: o.web, precio_aprox: o.total_con_iva, nota: o.cubre })), ...((r || {}).proveedores || [])]
      .filter((o, i, a) => o.nombre && a.findIndex((x) => norm(x.nombre) === norm(o.nombre)) === i).slice(0, 6);
    const elegidos = q.provSel || Object.fromEntries(provs.slice(0, 4).map((o, i) => [i, !!o.email]));
    const correo = correoProveedores(t, F, W);
    const asunto = q.asunto ?? correo.asunto, cuerpo = q.cuerpo ?? correo.cuerpo;
    const bcc = provs.filter((o, i) => elegidos[i] && o.email).map((o) => o.email).join(",");
    const gmail = `googlegmail://co?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    const mailto = `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    const wa = r?.whatsapp ? `https://wa.me/?text=${encodeURIComponent(r.whatsapp)}` : "";
    return `<div class="rb-paso">${cab}
      <div class="rb-card" style="border-color:rgba(245,207,107,.6)"><div class="rb-env"><b style="font-size:.78rem">${esc(cod)}</b><button class="btn small" type="button" data-rb="llam-cambiar">Cambiar</button></div>
        <div class="rb-fnom">${esc(t.nombre || F?.nombre || "")}</div><div class="muted" style="font-size:.74rem">${esc(t.organismo || F?.organismo || "")}</div>
        <div class="rb-kv"><span>Ofertamos <b>${clp(t.total)}</b></span>${g.ganada ? `<span>🏆 ganada${g.oc ? " · OC " + esc(g.oc) : ""}</span>` : g.glosa ? `<span>${esc(g.glosa)}</span>` : ""}${g.mi_lugar ? `<span>${g.mi_lugar}° de ${g.competidores}</span>` : ""}</div>
        ${t.comprobante ? `<div class="rb-row"><button class="btn small" type="button" data-rb="comprobante" data-c="${esc(cod)}">🧾 Comprobante</button></div>` : ""}
        ${barraAcciones(t)}</div>
      ${briefHTML(cod, t)}
      ${(() => { const its = (Array.isArray(t.items) && t.items.length ? t.items : (F?.items || [])); if (!its.length) return "";
        const desc = (it) => it.d || it.descripcion || it.nombre || "", can = (it) => it.q || it.cantidad || "", uni = (it) => it.unidad || "", pre = (it) => it.p || it.precio || 0;
        return `<details class="rb-det" open><summary>📋 Requerimientos — ${its.length} ítem${its.length > 1 ? "s" : ""} (enumerados y detallados)</summary>
          <ol style="margin:6px 0 0;padding-left:20px;font-size:.82rem">${its.slice(0, 60).map((it) => `<li>${esc(desc(it))}${can(it) ? ` · <b>${esc(can(it))}</b>${uni(it) ? " " + esc(uni(it)) : ""}` : ""}${pre(it) ? ` · ${clp(pre(it))} c/u` : ""}</li>`).join("")}</ol>
          <button class="btn small" type="button" data-rb="cp" data-v="${esc(its.map((it, i) => `${i + 1}. ${desc(it)}${can(it) ? " — " + can(it) + (uni(it) ? " " + uni(it) : "") : ""}`).join("\n"))}" style="margin-top:6px">📋 Copiar lista para el cliente</button>
        </details>`; })()}
      <div class="rb-resp ${verd ? verd[1] : finalLocal == null ? "dep" : finalLocal > 0 ? "si" : "no"}">
        <div class="rb-verd">${verd ? verd[0] : finalLocal == null ? (R.data?.robot?.conectado ? "🤔 Calculando…" : "⏸️ Robot apagado") : finalLocal > 0 ? "✅ SÍ DA" : "❌ NO DA"}</div>
        ${finalLocal != null ? `<div class="rb-tit">Utilidad ${inf.final != null ? "según informe" : "con tu costo"}: <span class="${finalLocal < 0 ? "rb-neg-t" : "rb-vivo-t"}">${clp(finalLocal)}</span></div>` : ""}
        ${r?.por_que ? `<p>${esc(r.por_que)}</p>` : q.id && !r && !q.error && R.data?.robot?.conectado ? `<p class="muted"><span class="spinner"></span> El robot está revisando proveedores y precios…</p>` : finalLocal == null && !R.data?.robot?.conectado ? `<p class="muted" style="font-size:.74rem">⚠️ El robot está apagado — por eso no sale el veredicto automático. Usa el <b>🔬 Análisis del negocio</b> de aquí abajo: pones tu costo y te dice al tiro si DA y cuánto ganas (funciona sin robot).</p>` : ""}
        ${q.error ? `<p style="color:#ffb3b9">${esc(q.error)}</p>` : ""}
        ${r?.aviso ? `<div class="muted" style="font-size:.7rem">${esc(r.aviso)}</div>` : ""}
        ${r?.decirle_al_cliente ? `<div class="rb-sec">Dile al cliente</div><p>${esc(r.decirle_al_cliente)}</p>` : ""}
        ${r?.whatsapp ? `<div class="rb-row"><button class="btn small" type="button" data-rb="cp" data-v="${esc(r.whatsapp)}">Copiar WhatsApp</button><a class="btn small" href="${wa}" target="_blank" rel="noopener">💬 Enviar al cliente</a></div>` : ""}
      </div>
      ${(() => {
        const vta = Number(t.total) || 0, compra = Number(q.compraAnalisis) || 0;
        const syn = { total: vta, op: { precio_acordado: compra, informe: {} } };
        const X = (vta && compra) ? calcNeg(syn) : null, rt = X ? ratingNeg(X.final) : null;
        const ocHay = !!(g.oc || t.op?.oc_codigo || t.oc_compra?.oc_codigo);
        const resHTML = X ? `<div class="rb-verd" style="font-size:1.4rem">${rt.emoji} ${X.final > 0 ? "SÍ DA" : "NO DA"} · <span class="${X.final > 0 ? "rb-vivo-t" : "rb-neg-t"}">${clp(Math.round(X.final))}</span></div><div class="muted" style="font-size:.72rem">${esc(rt.txt)} · ganas ${clp(Math.round(X.final))} en este negocio</div>${excelVivo(syn, X)}` : `<div class="muted" style="font-size:.76rem">Pon tu costo y te digo al tiro si DA y cuánto ganas (Excel en vivo).</div>`;
        return `<div class="rb-sec">🔬 Análisis del negocio — ¿me interesa?</div>
      <div class="rb-card" style="border-color:rgba(120,180,255,.45)">
        <div style="font-size:.82rem"><b>📦 ${esc(t.nombre || F?.nombre || "este proyecto")}</b></div>
        <div class="rb-row" style="gap:6px;margin:6px 0;flex-wrap:wrap">
          <span class="rb-pill ${ocHay ? "verde" : ""}">${ocHay ? "✅ Con Orden de Compra" : "⚠️ Aún sin OC emitida"}</span>
          <span class="rb-pill">📋 ¿Piden ficha técnica? El robot lo confirma al leer las bases</span></div>
        <div class="rb-kv"><span>🏷️ Te pagan (venta) <b>${clp(vta)}</b> c/IVA</span></div>
        <label class="rb-lab">💸 ¿Cuánto te cuesta a ti? (con IVA — lo del proveedor)<input class="rb-in" id="rbCll" inputmode="numeric" value="${compra ? compra.toLocaleString("es-CL") : ""}" placeholder="Ej: 4.800.000"></label>
        <div id="cllResult" style="margin-top:8px">${resHTML}</div></div>`;
      })()}
      <div class="rb-sec">🏪 A quién comprarle</div>
      ${provs.length ? provs.map((o, i) => `<label class="rb-op ${elegidos[i] ? "on" : ""}" style="display:block"><div class="rb-env"><span><input type="checkbox" data-prov="${i}" ${elegidos[i] ? "checked" : ""} ${o.email ? "" : "disabled"}> <b>${esc(o.nombre)}</b></span>${o.precio_aprox ? `<b>${clp(o.precio_aprox)}</b>` : ""}</div>
          <div class="muted" style="font-size:.7rem">${o.email ? "✉ " + esc(o.email) : "sin correo"}${o.telefono ? " · 📞 " + esc(o.telefono) : ""}${o.nota ? " · " + esc(String(o.nota).slice(0, 80)) : ""}</div></label>`).join("")
        : `<div class="muted" style="font-size:.76rem">${q.id && !r ? "Buscando proveedores…" : "Sin proveedores todavía. El robot los busca con la IA (necesita saldo en OpenAI o una clave de Claude en el PC)."}</div>`}
      <div class="rb-sec">✉ Correo para pedir cotización (${provs.filter((o, i) => elegidos[i] && o.email).length} proveedores en copia oculta)</div>
      <input class="rb-in" id="rbAsunto" value="${esc(asunto)}">
      <textarea id="rbCuerpo" rows="9" style="margin-top:6px">${esc(cuerpo)}</textarea>
      <div class="rb-row"><a class="btn rb-oro" style="flex:1" href="${gmail}" data-rb="llam-gmail" data-bcc="${esc(bcc)}">✉ Abrir en Gmail</a><a class="btn small" href="${mailto}" data-rb="llam-mail" data-bcc="${esc(bcc)}">Otro correo</a>
        <button class="btn small" type="button" data-rb="cp" data-v="${esc(asunto + "\n\n" + cuerpo)}">Copiar</button></div>
      <div class="muted" style="font-size:.7rem;margin-top:4px">Se abre tu Gmail con el correo listo y los proveedores en copia oculta: tú revisas y presionas Enviar.</div>
      ${(() => {
        const empNom = empresaActual()?.razon_social || "nuestra empresa";
        const noDa = finalLocal != null && finalLocal <= 0;
        const prop = q.propCuerpo ?? `Estimado/a,

De parte de ${empNom}, agradecemos su contacto por "${t.nombre || F?.nombre || cod}" (${cod}).

${noDa ? "Lamentamos que el presupuesto no alcanzara para lo solicitado tal cual. Le proponemos una alternativa que sí se ajusta y mantiene la calidad:" : "Le hacemos llegar nuestra propuesta:"}${t.total ? "\n\nValor total: " + clp(t.total) + " (con IVA)." : ""}

Quedamos atentos para avanzar.

Saludos cordiales,
${empNom}`;
        return `<div class="rb-sec">📝 Armar propuesta para el cliente</div>
      <div class="muted" style="font-size:.72rem;margin-bottom:4px">Mándasela al tiro por WhatsApp o correo. Ideal cuando el presupuesto no alcanza: le propones una alternativa y el cliente queda con buena experiencia.</div>
      <div class="rb-row"><input class="rb-in" id="rbPropTel" inputmode="tel" placeholder="📞 WhatsApp del cliente" value="${esc(q.cliTel || "")}"><input class="rb-in" id="rbPropMail" inputmode="email" placeholder="✉ Correo del cliente" value="${esc(q.cliMail || "")}"></div>
      <textarea id="rbProp" rows="8" style="margin-top:6px">${esc(prop)}</textarea>
      <div class="rb-row"><button class="btn rb-oro" style="flex:1" type="button" data-rb="prop-wa">💬 Enviar por WhatsApp</button><button class="btn small" type="button" data-rb="prop-mail">✉ Correo</button><button class="btn small" type="button" data-rb="prop-cp">📋 Copiar</button></div>
      <div class="muted" style="font-size:.68rem;margin-top:4px">Se abre WhatsApp/correo con la propuesta lista: tú revisas y presionas Enviar.</div>`; })()}
      <div class="rb-sec">⏰ Recuérdamelo</div>
      <div class="rb-row"><button class="btn small" type="button" data-rb="recordar" data-min="120" data-t="${esc("Revisar respuestas de proveedores · " + cod)}" data-c="${esc(cod)}">Respuestas de proveedores en 2 h</button>
        <button class="btn small" type="button" data-rb="recordar" data-min="manana" data-t="${esc("Responder al cliente · " + (t.nombre || cod)).slice(0, 120)}" data-c="${esc(cod)}">Responder al cliente mañana 9:00</button></div>
    </div>`;
  }
  async function preguntarRobot(texto, audio, codigo) {
    if (!texto && !audio && !codigo) { toast("Escribe o dicta qué te dijeron"); return; }
    R.llamada = { ...(R.llamada || {}), texto, t: new Date().toISOString(), respuesta: null, error: null, id: null };
    pintarHoja(true);
    try {
      const r = await api("preguntar", { method: "POST", body: JSON.stringify({ texto, codigo, ...(audio || {}) }) });
      R.llamada.id = r.id;
      const h = leerHist(); h.unshift({ id: r.id, texto, t: R.llamada.t, codigo }); try { localStorage.setItem(HIST, JSON.stringify(h.slice(0, 20))); } catch {}
      esperarRespuesta(r.id);
    } catch (e) { R.llamada.error = e.message; }
    pintarHoja(true);
  }
  async function esperarRespuesta(id, n = 0) {
    if (!R.llamada || R.llamada.id !== id) return;
    try {
      const x = (await api("respuesta?id=" + id)).pregunta;
      if (x.estado === "lista" || x.estado === "error") {
        Object.assign(R.llamada, { respuesta: x.respuesta, error: x.error, transcripcion: x.transcripcion, texto: R.llamada.texto || x.transcripcion });
        const h = leerHist(); const k = h.find((y) => y.id === id); if (k) { k.titular = x.respuesta?.titular; try { localStorage.setItem(HIST, JSON.stringify(h)); } catch {} }
        try { navigator.vibrate?.([30, 40, 30]); } catch {}
        return pintarHoja(true);
      }
    } catch {}
    if (n > 100) { R.llamada.error = "El PC no respondió. ¿Está encendido el robot?"; return pintarHoja(true); }
    setTimeout(() => esperarRespuesta(id, n + 1), 3000);
  }
  // 🎤 dictado robusto: en iPhone el reconocimiento se corta solo, así que se reinicia hasta que tocas «Listo»
  function dictar() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return grabar();
    if (R.dictando) { R.dictParar = true; try { R.sr?.stop(); } catch {} return; }
    const base = ($("#rbLlamada")?.value || "").trim();
    let finales = "", parcial = "", inicio = Date.now();
    const pinta = () => { const ta = $("#rbLlamada"); if (ta) ta.value = [base, finales, parcial].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(); };
    const arrancar = () => {
      const sr = new SR(); sr.lang = "es-CL"; sr.interimResults = true; sr.continuous = !/iPhone|iPad|iPod/.test(navigator.userAgent); sr.maxAlternatives = 1;
      sr.onresult = (e) => { parcial = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) finales += " " + x[0].transcript; else parcial += x[0].transcript; } pinta(); };
      sr.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { R.dictParar = true; toast("Permite el micrófono para esta página (o usa el 🎤 del teclado)"); } };
      sr.onend = () => {
        finales += parcial ? " " + parcial : ""; parcial = ""; pinta();
        if (!R.dictParar && Date.now() - inicio < 90000) { try { arrancar(); return; } catch {} }       // sigue escuchando
        const v = ($("#rbLlamada")?.value || "").trim(); R.dictando = false; R.sr = null; R.dictParar = false;
        R.llamada = { ...(R.llamada || {}), texto: v }; pintarHoja(true); if (v) buscarLlamada(v);
      };
      sr.start(); R.sr = sr;
    };
    try { R.dictParar = false; arrancar(); R.dictando = true; R.llamada = { ...(R.llamada || {}), texto: base }; pintarHoja(true); navigator.vibrate?.(15); } catch { grabar(); }
  }
  function buscarLlamada(texto) {
    if (!texto) { toast("Escribe o dicta quién te llamó"); return; }
    R.llamada = { texto, cands: candidatasLlamada(texto), idx: 0 };
    pintarHoja(true);
    // también busca en Ejecuta y en el informe global (todos los juegos) y vuelve a ordenar
    Promise.all([R.ejec ? null : cargarEjecuta(), cargarGlobal()]).then(() => {
      if (R.llamada?.texto === texto && !R.llamada.confirmado) { R.llamada.cands = candidatasLlamada(texto); R.llamada.idx = 0; pintarHoja(true); }
    }).catch(() => {});
  }
  // 🧭 Brief instantáneo de «Me llamaron»: qué hay que hacer, dónde comprar (links), cómo lo haría (georreferenciado). Lo arma Claude en la nube, sin robot.
  async function briefLlamada(cod) {
    const t = trabajoG(cod); if (!t) return; R.brief = R.brief || {}; if (R.brief[cod]?.ok || R.brief[cod]?.cargando) return;
    R.brief[cod] = { cargando: true }; pintarHojaSiAbierta?.() ?? pintarHoja(true);
    try { const r = await api("cerebro", { method: "POST", body: JSON.stringify({ codigo: cod, empresa: miEmp(), modo: "llamada", mensajes: [{ rol: "yo", texto: "Brief de la llamada" }] }) });
      let j = null; try { j = JSON.parse(String(r.texto || r.respuesta || "").replace(/^[^{]*/, "").replace(/[^}]*$/, "")); } catch (e) {}
      R.brief[cod] = j ? { ok: true, ...j } : { error: "Claude no devolvió el brief" };
    } catch (e) { R.brief[cod] = { error: e.message }; }
    pintarHoja(true);
  }
  function briefHTML(cod, t) {
    const b = (R.brief || {})[cod]; const its = (Array.isArray(t.items) && t.items.length ? t.items : []).slice(0, 3);
    const q = (it) => encodeURIComponent(String(it.d || it.descripcion || it.nombre || "").replace(/\(.*?\)/g, "").split(/[,;·]/)[0].trim().slice(0, 50));
    const comuna = encodeURIComponent((t.oc_compra?.comuna || t.oc_compra?.direccion || t.organismo || "").split(/[,·]/)[0].trim());
    const tiendas = (it) => [["MercadoLibre", `https://listado.mercadolibre.cl/${q(it)}`], ["Sodimac", `https://www.sodimac.cl/sodimac-cl/search?Ntt=${q(it)}`], ["Google Shopping", `https://www.google.com/search?tbm=shop&q=${q(it)}`], ["Cerca de " + decodeURIComponent(comuna).slice(0, 18), `https://www.google.com/maps/search/${q(it)}+cerca+de+${comuna}`]];
    const oc = t.op?.oc_codigo || t.oc_compra?.oc_codigo; const docs = (t.lic_docs || []).slice(-6);
    return `<div class="rb-card" style="border-color:rgba(30,215,96,.45);margin-top:8px">
      <div class="rb-env"><b>🧭 Qué hay que hacer</b><span class="muted" style="font-size:.7rem">${b?.ok ? "Claude · al instante" : b?.cargando ? "pensando…" : ""}</span></div>
      ${b?.ok ? `<p style="margin:6px 0;font-size:.92rem"><b>${esc(b.que_hacer || "")}</b></p>${b.entrega ? `<div class="muted" style="font-size:.8rem">📍 ${esc(b.entrega)}</div>` : ""}` : b?.cargando ? `<p class="muted"><span class="spinner"></span> Leyendo la compra…</p>` : b?.error ? `<p class="muted" style="font-size:.78rem">⚠ ${esc(b.error)} <button class="btn small" type="button" data-rb="brief-reintentar" data-c="${esc(cod)}">Reintentar</button></p>` : ""}
      <div class="rb-row" style="margin-top:6px">${(() => { const d = (t.op?.docs || []).filter((x) => x.tipo === "oc").pop(); return oc ? (d ? `<button class="btn small rb-oro" type="button" data-rb="neg-doc" data-c="${esc(cod)}" data-id="${esc(d.id)}">📄 Ver OC ${esc(oc)}</button>` : `<span class="rb-pill">🏆 OC ${esc(oc)}</span>`) : ""; })()}<button class="btn small" type="button" data-rb="det" data-c="${esc(cod)}">Abrir en Ejecuta ›</button>${t.pdf ? `<button class="btn small" type="button" data-rb="pdf" data-c="${esc(cod)}">📑 Lo que ofertamos</button>` : ""}</div>
      ${docs.length ? `<div class="rb-sec" style="margin-top:8px">📎 Anexos de la compra</div><div class="rb-row">${docs.map((d) => `<button class="btn small" type="button" data-rb="neg-doc" data-c="${esc(cod)}" data-id="${esc(d.id)}">${esc((d.nombre || d.tipo).slice(0, 28))}</button>`).join("")}</div>` : `<div class="muted" style="font-size:.74rem;margin-top:6px">📎 Los anexos que subió el comprador se ven en la ficha de Mercado Público; si los descargas, súbelos en Ejecuta y Claude los lee.</div>`}
      <div class="rb-sec" style="margin-top:8px">🔗 Dónde comprarlo al menor precio · precio real → ¿da?</div>${cajaLinks(t)}
      ${(b?.donde_comprar || []).length ? `<div class="rb-row" style="margin-top:4px">${b.donde_comprar.slice(0, 4).map((d) => `<a class="btn small" href="${esc(d.url || "#")}" target="_blank" rel="noopener">${esc(d.nombre || d.url)} ↗</a>`).join("")}</div>` : ""}
      ${b?.ok && b.como_lo_haria ? `<div class="rb-sec" style="margin-top:8px">🚚 Cómo lo haría</div><p style="font-size:.84rem;margin:4px 0">${esc(b.como_lo_haria)}</p>${(b.ojo || []).length ? `<div class="muted" style="font-size:.76rem">⚠ ${b.ojo.slice(0, 3).map(esc).join(" · ")}</div>` : ""}${b.utilidad_estimada ? `<div style="font-size:.84rem;margin-top:4px">💰 Utilidad estimada: <b style="color:#1ed760">${esc(String(b.utilidad_estimada))}</b></div>` : ""}` : ""}
    </div>`;
  }
  function confirmarLlamada(cod) {
    const texto = R.llamada?.texto || "";
    R.llamada = { texto, confirmado: cod }; briefLlamada(cod);
    cargarDocs(cod);
    preguntarRobot(texto || "Me llamaron por esta compra", null, cod);
  }
  async function grabar() {
    if (R.grabando) { R.rec?.stop(); return; }
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
      const rec = new MediaRecorder(st, mime ? { mimeType: mime } : {}); const partes = [];
      rec.ondataavailable = (e) => e.data.size && partes.push(e.data);
      rec.onstop = async () => {
        st.getTracks().forEach((t) => t.stop()); R.grabando = false; R.rec = null;
        const blob = new Blob(partes, { type: rec.mimeType || mime || "audio/mp4" });
        if (blob.size < 2000) { toast("Audio muy corto"); return pintarHoja(true); }
        const b64 = await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(",")[1]); f.readAsDataURL(blob); });
        preguntarRobot(($("#rbLlamada")?.value || "").trim(), { audio_b64: b64, mime: blob.type });
      };
      rec.start(); R.rec = rec; R.grabando = true; pintarHoja(true);
      setTimeout(() => { if (R.rec === rec) rec.stop(); }, 90000);
    } catch (e) { toast("No pude usar el micrófono: " + (e.message || e)); }
  }

  /* ============ ◧ MODO EJECUTIVO: Inicio · Buscar · Biblioteca · Actividad (sobre los mismos datos del motor) ============ */
  const EXK = "sdc:exec";
  const execOn = () => { try { return localStorage.getItem(EXK) === "1"; } catch { return false; } };   // 🎮 por defecto la app clásica (Jugar); el modo ejecutivo se activa desde ⋯
  const exTab = () => R.exTab || "inicio";
  const EXI = {
    inicio: '<svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
    buscar: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    biblio: '<svg viewBox="0 0 24 24"><path d="M4 4v16M9 4v16M14 5l5 15"/></svg>',
    activ: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>',
    jugar: '<svg viewBox="0 0 24 24"><path d="M6 9h4M8 7v4M15 8h.01M18 10h.01M4 14a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2a3 3 0 0 1-5.5 1.7L13 15h-2l-1.5 2.7A3 3 0 0 1 4 16z"/></svg>',
  };
  const exSeg = (x) => /^segundo/i.test(x.llamado || "");
  const exHoras = (x) => x.cierre ? (Date.parse(x.cierre) - Date.now()) / 36e5 : null;
  const exCierreTxt = (x) => { const h = exHoras(x); if (h == null) return "sin fecha"; if (h < 0) return "cerrada"; if (h < 24) return "cierra hoy " + new Date(x.cierre).toTimeString().slice(0, 5); const d = Math.floor(h / 24); return `cierra en ${d} día${d > 1 ? "s" : ""}`; };
  const exColor = (x) => { const h = Math.abs([...String(x.rubro || x.nombre || "")].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 360; return `linear-gradient(160deg,hsl(${h} 28% 30%),#15171b)`; };
  const exMisOport = () => { const conf = leer(); const misR = new Set(conf.rubros || []), pal = (conf.palabras || "").split(/[,;\n]+/).map(norm).filter((w) => w.length > 2);
    const ingresada = (x) => { if (x.ya_ofertada || x.trabajada) return true; const t = (R.todos || R.data?.trabajos || []).find((y) => y.codigo === x.codigo); return !!t && !["rechazada", "error"].includes(t.estado); };   // 🏢 ya la metió alguien (cualquier usuario o empresa): no se muestra
    return (R.oport?.lista || []).filter((x) => x.fuente !== "licitacion" && exHoras(x) > 0.5 && !descartada(x.codigo) && !ingresada(x) && ((!misR.size && !pal.length) || misR.has(x.rubro) || pal.some((w) => norm(x.nombre).includes(w)))).sort((a2, b2) => (pideAdjunto(a2) ? 1 : 0) - (pideAdjunto(b2) ? 1 : 0)); };
  const exCover = (x) => `<button type="button" class="rb-ex-cov" data-rb="ex-ficha" data-c="${esc(x.codigo)}"><div class="art" style="background:${exColor(x)}">${exSeg(x) ? '<span class="tag" style="color:#6ea8ff">2° LLAMADO</span>' : exHoras(x) < 30 ? '<span class="tag" style="color:#ff8a65">CIERRA PRONTO</span>' : esSel(x.codigo) ? '<span class="tag">★ GUARDADA</span>' : ""}<b>${esc(x.nombre || x.codigo)}</b></div><div class="t">${esc(x.organismo || "")}</div><div class="m">${x.monto ? clp(x.monto) + " · " : ""}${exCierreTxt(x)}</div></button>`;
  const exFila = (x, extra) => { const d = x.cierre ? new Date(x.cierre) : null; const sel = leerSel()[x.codigo]; const t = trabajo(x.codigo);
    return `<div class="rb-ex-row" data-rb="${t ? "det" : "ex-ficha"}" data-c="${esc(x.codigo)}"><div class="d">${d ? `<b>${d.getDate()}</b><small>${["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][d.getMonth()]} ${d.toTimeString().slice(0, 5)}</small>` : "<b>—</b>"}</div><div class="tx"><b>${esc(x.nombre || x.codigo)}</b><span>${esc(x.organismo || "")}${x.region ? " · " + esc(String(x.region).replace("Región ", "").replace(" de Santiago", "")) : ""}</span><span>${esc(x.codigo)}${x.monto ? " · ppto. " + clp(x.monto) : ""}</span><div>${exSeg(x) ? '<span class="rb-ex-st info">2° llamado</span>' : ""}${exHoras(x) != null && exHoras(x) > 0 ? `<span class="rb-ex-st ${exHoras(x) < 30 ? "cierre" : ""}">${exCierreTxt(x)}</span>` : ""}${sel ? `<span class="rb-ex-st ${sel.revisar ? "doc" : ""}">${sel.revisar ? "⚠ revisar" : "guardada"}</span>` : ""}${!t && pideAdjunto(x) ? `<span class="rb-ex-st" title="El detalle está en un adjunto">📎 pide ver adjunto</span>` : ""}${t ? `<span class="rb-ex-st ${HECHA.includes(t.estado) ? "env" : t.estado === "firmar" ? "doc" : ""}">${HECHA.includes(t.estado) ? "oferta enviada" : t.estado === "firmar" ? "falta tu firma" : esc(t.estado)}</span>${trazaChips(t)}` : ""}${extra || ""}</div></div></div>`; };
  // 👤 Trazabilidad del negocio: quién cotizó (persona que la pidió), quién ejecuta y quién invierte
  const trazaDe = (t) => { const op = t.op || {}; const q = quienDe(t); return { cotizo: t.persona || q?.nombre || null, ejecuta: op.ejecutor_nombre || op.responsable || null, invierte: op.inversionista_nombre || null }; };
  const trazaChips = (t) => { const z = trazaDe(t); return `${z.cotizo ? `<span class="rb-ex-st" title="Cotizó">🎮 ${esc(z.cotizo.split(" ")[0])}</span>` : ""}${z.ejecuta ? `<span class="rb-ex-st info" title="Ejecuta">🛠 ${esc(z.ejecuta.split(" ")[0])}</span>` : ""}${z.invierte ? `<span class="rb-ex-st env" title="Invierte">💼 ${esc(z.invierte.split(" ")[0])}</span>` : ""}`; };
  function trazaHTML(t) {
    const z = trazaDe(t), op = t.op || {}; const gente = [...new Set([persona()?.nombre, ...Object.values(R.ejecutores || {}).map((e) => e?.nombre)].filter(Boolean))];
    const bot = (campo, actual) => gente.map((g) => `<button class="btn small ${actual === g ? "rb-oro" : ""}" type="button" data-rb="traza-set" data-campo="${campo}" data-v="${esc(g)}" data-c="${esc(t.codigo)}">${esc(g.split(" ")[0])}</button>`).join("");
    return `<div class="rb-traza" style="font-size:.8rem;margin-top:8px;display:grid;gap:4px">
      <div>🎮 Cotizó: <b>${esc(z.cotizo || "—")}</b> <span class="muted">· el negocio es suyo; decide quién lo ejecuta</span></div>
      <div class="rb-row" style="gap:4px;align-items:center">🛠 Ejecuta: ${bot("ejecutor_nombre", z.ejecuta)}${!z.ejecuta ? `<span class="muted">sin asignar</span>` : ""}</div>
      <div class="rb-row" style="gap:4px;align-items:center">💼 Invierte: ${bot("inversionista_nombre", z.invierte)}<button class="btn small ${z.invierte && !gente.includes(z.invierte) ? "rb-oro" : ""}" type="button" data-rb="traza-otro" data-campo="inversionista_nombre" data-c="${esc(t.codigo)}">${z.invierte && !gente.includes(z.invierte) ? esc(z.invierte) : "otro…"}</button></div></div>`;
  }
  function exPendientes() {      // tareas que requieren acción (para Actividad y el contador)
    const out = []; const ocu = leerOcultas(); const trabajos = (R.data?.trabajos || []).filter((t) => esMia(t) && !ocu[t.codigo]); const sel = leerSel();
    for (const t of trabajos) { if (t.estado === "firmar" && !yaFirmada(t) && !noFirmable(t)) out.push({ tipo: "doc", c: t.codigo, texto: `Falta tu firma · ${t.nombre || t.codigo}`, det: true }); }
    for (const [c, x] of Object.entries(sel)) if (x.revisar) out.push({ tipo: "cierre", c, texto: `Cambió mientras cotizabas · ${x.nombre || c}` });
    for (const t of trabajos) { if (!t.op || !(t.op.oc_codigo || t.op.oc)) continue; const b = clasificarOC(t); if (b === "A" && !t.op.cobrado) out.push({ tipo: "env", c: t.codigo, texto: `Cobrar · ${t.nombre || t.codigo}`, det: true }); if (b === "B" && t.op.precio_acordado && !t.op.proveedor_pagado) out.push({ tipo: "doc", c: t.codigo, texto: `Pagar al proveedor ${clp(t.op.precio_acordado)} · ${t.nombre || t.codigo}`, det: true }); if (b === "C") out.push({ tipo: "info", c: t.codigo, texto: `Aceptar la OC en MP · ${t.nombre || t.codigo}`, det: true }); if (b === "D" && t.op.proveedor_pagado) out.push({ tipo: "cierre", c: t.codigo, texto: `OC cancelada con proveedor pagado · ${t.nombre || t.codigo}`, det: true }); }
    for (const m of (R.mailAl || []).filter((x) => !x.visto).slice(0, 5)) out.push({ tipo: "info", c: m.codigo || "", texto: `Correo · ${m.asunto || m.resumen || ""}`.slice(0, 90), det: !!m.codigo });
    return out;
  }
  function navExec() {
    const n = exPendientes().length; const t = R.exFicha || R.detalle ? "" : exTab();
    return `<nav class="rb-ex-nav">${[["inicio", "Inicio", EXI.inicio], ["jugar", "Jugar", EXI.jugar], ["buscar", "Buscar", EXI.buscar], ["biblio", "Biblioteca", EXI.biblio], ["activ", "Actividad", EXI.activ]].map(([k, l, ic]) => `<button type="button" class="${t === k ? "on" : ""}" data-rb="ex-tab" data-t="${k}">${ic}${l}${k === "activ" && n ? `<span class="n">${n}</span>` : ""}</button>`).join("")}</nav>` + exContinuar();
  }
  function exContinuar() {
    const oc = leerOcultas(); const firmar = (R.data?.trabajos || []).filter((t) => t.estado === "firmar" && !yaFirmada(t) && !noFirmable(t) && esMia(t) && !oc[t.codigo]); if (!firmar.length || R.detalle || R.exFicha) return "";
    const t = firmar[0]; const otras = firmar.length - 1;
    return `<div class="rb-ex-cont"><button type="button" data-rb="det" data-c="${esc(t.codigo)}"><div style="width:38px;height:38px;border-radius:6px;background:${exColor(t)}"></div><div style="flex:1;min-width:0"><div style="font-size:.8rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Continuar cotización · ${esc(t.nombre || t.codigo)}</div><div class="bar"><i style="width:70%"></i></div><div style="font-size:.68rem;color:#9aa3b2">${clp(t.total)} · lista para rellenar y firmar${otras ? ` · ${otras} más en Biblioteca` : ""}</div></div>›</button></div>`;
  }
  function pantallaExec() {
    const tab = exTab(); if (!R.oport) cargarOport();
    if (tab === "jugar") { if (!["nuevas", "sel", "firmar", "papelera"].includes(R.oportTab || "nuevas")) R.oportTab = "nuevas"; return `<div class="rb-paso rb-ex-jugar">${vistaOport()}</div>`; }   // 🎮 el juego de siempre, dentro del modo ejecutivo
    return `<div class="rb-paso">${({ inicio: exInicio, buscar: exBuscar, biblio: exBiblio, activ: exActiv })[tab]()}</div>`;
  }
  /* ---- 👤 Perfiles del modo ejecutivo: cada uno entra y sabe qué hacer ---- */
  const PERFK = "sdc:perfil";
  const PERFILES = [["cotizador", "✍ Cotizador"], ["licitador", "📑 Licitador"], ["ejecutor", "🛠 Ejecutor"], ["inversionista", "💼 Inversionista"]];
  const perfil = () => { try { return localStorage.getItem(PERFK) || "cotizador"; } catch { return "cotizador"; } };
  const perfilBarra = () => `<div class="rb-ex-chips" style="margin:8px 0 2px">${PERFILES.map(([k, l]) => `<button type="button" class="${perfil() === k ? "on" : ""}" data-rb="ex-perfil" data-k="${k}">${l}</button>`).join("")}</div>`;
  const habilDesde = (d, n) => { const x = new Date(d); let k = 0; while (k < n) { x.setDate(x.getDate() + 1); if (x.getDay() % 6) k++; } return x; };
  const fcorta = (d) => d ? new Date(d).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short" }) : "—";
  const hoyMs = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const esLic = (c) => /-(LE|LP|LQ|LR|LS|L1|R1|CO)\d{2}$/i.test(String(c || ""));
  // 🛠 Plan de ejecución de una OC: lo simulado (fechas hábiles desde que se ganó) contra lo real (historial de etapas)
  function planOC(t) {
    const op = t.op || {}, h = op.historial || []; const real = (e) => h.find((x) => x.etapa === e)?.t || null;
    const inicio = real("ganada") || op.oc_fecha || t.actualizado || t.creado || new Date().toISOString();
    const pasos = [
      ["ganada", "OC aceptada en Mercado Público", 0, real("ganada") || (op.oc_codigo ? inicio : null)],
      ["inversionista", "Capital confirmado", 1, real("inversionista") || (op.nos_da || op.pedido_transferencia || op.inversionista_nombre ? null : "omitido")],
      ["operacion", "Proveedor cerrado y precio acordado", 2, real("operacion") || (op.precio_acordado ? real("transporte") || null : null)],
      ["pago", "Pago al proveedor", 3, real("pago") || (op.proveedor_pagado ? real("pago") : null)],
      ["despacho", "Despachado (guía)", op.plazo_fecha ? null : 6, real("despacho")],
      ["entrega", "Entregado y recepción conforme", op.plazo_fecha ? null : 7, real("entrega")],
      ["cerrado", "Factura emitida · negocio cerrado", op.plazo_fecha ? null : 9, real("cerrado") || (op.cerrado || null)],
      ["cobro", "Cobrado", op.plazo_fecha ? null : 39, op.cobrado ? (op.fecha_cobro || op.cerrado || null) : null],
    ];
    const plazo = op.plazo_fecha ? new Date(op.plazo_fecha + "T12:00") : null;
    return pasos.map((pp, i) => { let plan = pp[2] != null ? habilDesde(inicio, pp[2]) : plazo ? (i === 4 ? new Date(plazo.getTime() - 864e5) : i === 5 ? plazo : i === 6 ? habilDesde(plazo, 2) : new Date(plazo.getTime() + 32 * 864e5)) : null;
      const hecho = !!pp[3] || (pp[0] === "cobro" ? !!op.cobrado : ETAPAS_IDX(op.etapa) > ETAPAS_IDX(pp[0]));
      if (pp[3] === "omitido") return { k: pp[0], txt: pp[1] + " (sin inversionista: con capital propio)", plan, real: null, hecho: true, dif: null };
      const dif = pp[3] && plan ? Math.round((Date.parse(pp[3]) - plan.getTime()) / 864e5) : (!hecho && plan && plan.getTime() < hoyMs() ? Math.round((hoyMs() - plan.getTime()) / 864e5) : null);
      return { k: pp[0], txt: pp[1], plan, real: pp[3], hecho, dif }; });
  }
  const ETAPAS_IDX = (e) => ["previa", "ganada", "inversionista", "operacion", "transporte", "pago", "documentos", "despacho", "entrega", "cerrado"].indexOf(e || "previa");
  // 💰 cuánto da (rápido): presupuesto neto × margen del rubro − costos fijos de despacho; ofertas = competencia
  const daRapido = (x) => { const pres = Number(x.monto) || 0; if (!pres) return null; const m = x.margen ?? 0.25; const util = pres / 1.19 * (1 - (exSeg(x) ? 0.02 : 0.06)) * m - (typeof fijosDe === "function" ? fijosDe(pres) : 0); return { util: Math.round(util), m }; };
  const daChip = (x) => { const d = daRapido(x); if (!d || d.util <= 0) return ""; return `<span class="rb-ex-st ${d.util > 150000 ? "env" : ""}">da ~${clp(d.util)}</span>`; };
  // 📎 compras que no se pueden cotizar a ciegas: el detalle está en un adjunto («revisar solicitud», «según anexo»): van al final, con aviso
  const pideAdjunto = (x) => /revisar (la )?solicitud|seg[uú]n (anexo|archivo|adjunto|planilla|bases)|ver (anexo|adjunto|archivo)|detalle en (anexo|adjunto)|adjunto n[°º]/i.test(String(x.nombre || "") + " " + (x.items || []).map((i) => i.d || i.nombre || "").join(" "));
  function exJugar(op) {
    const idx = R.exJugarIdx || 0; const lista = op.filter((x) => !trabajo(x.codigo) && !pideAdjunto(x) && (daRapido(x)?.util ?? 1) > 0); const x = lista[idx % Math.max(1, lista.length)]; if (!x) return "";
    const d = daRapido(x); const h = exHoras(x); const of = x.ofertas ?? null;
    const vale = d && d.util > 150000 && (of == null || of < 6) && h > 6; const razon = !d ? "sin presupuesto publicado" : d.util <= 0 ? "con el margen del rubro no deja plata" : of >= 6 ? `ya hay ${of} ofertas` : h <= 6 ? "cierra en menos de 6 h" : d.util <= 150000 ? "deja poco para el despacho" : "";
    return `<div class="rb-ex-h2">🎮 Jugar <small>${idx % lista.length + 1} de ${lista.length} · ¿vale la pena?</small></div>
      <div class="rb-card" style="margin:0;padding:0;overflow:hidden"><div style="height:110px;background:${exColor(x)};padding:12px;display:flex;flex-direction:column;justify-content:flex-end"><div>${exSeg(x) ? '<span class="rb-ex-st info">2° llamado</span>' : ""}<span class="rb-ex-st ${h < 30 ? "cierre" : ""}">${exCierreTxt(x)}</span>${of != null ? `<span class="rb-ex-st">${of === 0 ? "sin rivales aún" : of + " oferta" + (of === 1 ? "" : "s")}</span>` : ""}</div><b style="font-size:1.05rem;line-height:1.2">${esc(x.nombre || x.codigo)}</b><span class="muted" style="font-size:.78rem">${esc(x.organismo || "")} · ${esc(x.codigo)}</span></div>
        <div style="padding:12px 14px"><div class="rb-env"><div><span class="muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.06em">Presupuesto</span><br><b style="font-size:1.2rem">${x.monto ? clp(x.monto) : "—"}</b></div><div style="text-align:right"><span class="muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.06em">Cuánto da</span><br><b style="font-size:1.2rem;color:${d && d.util > 0 ? "#1ed760" : "#ff6b6b"}">${d ? (d.util > 0 ? "~" + clp(d.util) : "no da") : "—"}</b></div></div>
        <div style="font-size:.84rem;margin-top:6px"><b style="color:${vale ? "#1ed760" : "#f4c95d"}">${vale ? "✅ Vale la pena" : "🤔 " + razon}</b>${d ? ` · margen del rubro ${Math.round(d.m * 100)} % (${esc(x.rubro || "")})` : ""}</div>
        <div class="rb-row" style="margin-top:10px;gap:8px"><button class="btn small" type="button" data-rb="ex-jugar-paso" style="flex:1">✕ Paso</button><button class="btn rb-oro" type="button" data-rb="oport-si" data-c="${esc(x.codigo)}" style="flex:2">⭐ Apuesto: prepárala</button></div>
        <div class="rb-row" style="margin-top:6px"><button class="btn small" type="button" data-rb="ex-ficha" data-c="${esc(x.codigo)}">Ficha ›</button><button class="btn small" type="button" data-rb="claude" data-c="${esc(x.codigo)}">💬 ¿Da?</button></div></div></div>`;
  }
  function exInicioCotizador(op, n) {
    const oc = leerOcultas(); const firmar = (R.data?.trabajos || []).filter((t) => t.estado === "firmar" && !yaFirmada(t) && !noFirmable(t) && esMia(t) && !oc[t.codigo]).sort((a, b) => (Date.parse(a.cierre || 0) || 9e15) - (Date.parse(b.cierre || 0) || 9e15));
    const hoy = hoyMs(); const envHoy = (R.data?.trabajos || []).filter((t) => HECHA.includes(t.estado) && Date.parse(t.fecha_envio || t.actualizado || 0) >= hoy).length;
    const meta = Number(localStorage.getItem("sdc:meta_dia") || 8); const pct = Math.min(100, Math.round(envHoy / meta * 100));
    const prep = op.slice(0, 6);
    return `<div class="rb-ex-h2">Hoy <small>meter y meter cotizaciones</small></div>
      <div class="rb-card" style="margin:0;padding:12px 14px"><div class="rb-env"><div><b style="font-size:1.6rem">${envHoy}</b> <span class="muted">de ${meta} enviadas hoy</span></div><div><b style="font-size:1.6rem;color:#f4c95d">${firmar.length}</b> <span class="muted">listas para firmar</span></div></div><div class="bar" style="height:6px;background:#2a2f38;border-radius:3px;margin-top:8px"><i style="display:block;height:100%;width:${pct}%;background:#1ed760;border-radius:3px"></i></div>
        ${firmar.length ? `<button class="btn rb-oro" type="button" data-rb="det" data-c="${esc(firmar[0].codigo)}" style="width:100%;margin-top:10px">▶ Siguiente: firmar ${esc(corta(firmar[0].nombre || firmar[0].codigo))} · ${clp(firmar[0].total)}</button>` : `<div class="muted" style="font-size:.82rem;margin-top:8px">Nada por firmar. Elige una oportunidad abajo y el robot te la deja lista.</div>`}</div>
      ${firmar.length ? `<div class="rb-ex-h2">Cola para firmar <small>${firmar.length} · 🗑 la saca del ambiente</small></div><div class="rb-card" style="padding:4px 14px;margin:0">${firmar.slice(0, 12).map((t) => exFila(t, `<button class="btn small" type="button" data-rb="ex-quitar" data-c="${esc(t.codigo)}" style="margin-left:auto;opacity:.8" title="Quitar">🗑</button>`)).join("")}</div>` : ""}
      <div class="rb-card" style="margin:0 0 10px;padding:12px 14px;border-color:rgba(30,215,96,.5)"><b>🎮 ¿Cómo se juega?</b><div class="muted" style="font-size:.82rem;margin-top:4px">1) <b>Jugar</b>: desliza → apuesto / ← paso. 2) En ⭐ Jugar pones tu <b>precio</b> con la herramienta (compra · venta · margen). 3) <b>Ir a firmar</b>: el robot la deja lista y tú la ingresas en MP. El ritmo de siempre.</div><button class="btn rb-oro" type="button" data-rb="ex-tab" data-t="jugar" style="width:100%;margin-top:8px">🎮 Ir a Jugar</button></div>
      ${exJugar(op)}
      <div class="rb-ex-h2">Para preparar ahora <small>cierran primero · cuánto da</small></div><div class="rb-card" style="padding:4px 14px;margin:0">${prep.length ? prep.map((x) => exFila(x, daChip(x) + `<button class="btn small rb-oro" type="button" data-rb="oport-si" data-c="${esc(x.codigo)}" style="margin-left:auto">✍ Preparar</button>`)).join("") : `<div class="muted" style="padding:10px 0;font-size:.85rem">${R.oport ? "Nada por cerrar en tus rubros. Toca Buscar." : "Cargando…"}</div>`}</div>`;
  }
  function exInicioLicitador() {
    const lista = (R.oport?.lista || []).filter((x) => x.fuente === "licitacion" || esLic(x.codigo)); const sel = leerSel();
    const L = lista.filter((x) => exHoras(x) > 0).sort((a, b) => exHoras(a) - exHoras(b));
    const dec = (c) => sel[c]?.decision || "";
    const fila = (x) => { const d = dec(x.codigo); const h = exHoras(x); const dias = h != null ? Math.floor(h / 24) : null;
      return `<div class="rb-card" style="margin:0 0 8px;padding:12px 14px;border-left:3px solid ${d === "si" ? "#1ed760" : d === "no" ? "#ff6b6b" : "#2a2f38"}"><div style="display:flex;justify-content:space-between;gap:8px"><div style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.nombre || x.codigo)}</b><span class="muted" style="font-size:.78rem">${esc(x.organismo || "")} · ${esc(x.codigo)}${x.monto ? " · " + clp(x.monto) : ""}</span></div><div style="text-align:right;white-space:nowrap"><b style="color:${h < 48 ? "#ff8a65" : "#f4c95d"}">${dias != null ? (dias < 1 ? "cierra hoy" : dias + " día" + (dias > 1 ? "s" : "")) : "—"}</b><br><span class="muted" style="font-size:.72rem">${x.cierre ? new Date(x.cierre).toLocaleDateString("es-CL", { day: "numeric", month: "short" }) : ""}</span></div></div>
        <div class="rb-row" style="margin-top:8px;gap:6px"><button class="btn small ${d === "si" ? "rb-oro" : ""}" type="button" data-rb="lic-dec" data-c="${esc(x.codigo)}" data-d="si">✅ Vamos</button><button class="btn small" type="button" data-rb="lic-dec" data-c="${esc(x.codigo)}" data-d="no" style="${d === "no" ? "border-color:#ff6b6b;color:#ff6b6b" : ""}">✖ No</button><button class="btn small" type="button" data-rb="lic-dec" data-c="${esc(x.codigo)}" data-d="despues">⏳ Después</button><button class="btn small" type="button" data-rb="claude" data-c="${esc(x.codigo)}">💬 ¿Entramos?</button><button class="btn small" type="button" data-rb="ex-ficha" data-c="${esc(x.codigo)}">Ficha ›</button></div>
        ${d === "si" ? `<div class="muted" style="font-size:.74rem;margin-top:6px">Checklist: bases leídas · anexos · garantía de seriedad · visita a terreno · consultas en el foro. El robot deja la ficha lista; tú ingresas y firmas en MP.</div>` : ""}</div>`; };
    const si = L.filter((x) => dec(x.codigo) === "si"), pend = L.filter((x) => !dec(x.codigo)), desp = L.filter((x) => dec(x.codigo) === "despues");
    return `<div class="rb-ex-h2">Licitaciones <small>tú y Claude deciden juntos</small></div>
      <div class="rb-card" style="margin:0 0 10px;padding:10px 14px"><div class="rb-env"><div><b style="font-size:1.4rem;color:#1ed760">${si.length}</b> <span class="muted">vamos</span></div><div><b style="font-size:1.4rem;color:#f4c95d">${pend.length}</b> <span class="muted">por decidir</span></div><div><b style="font-size:1.4rem">${desp.length}</b> <span class="muted">después</span></div></div></div>
      ${si.length ? `<div class="rb-ex-h2">En las que vamos <small>${si.length}</small></div>${si.map(fila).join("")}` : ""}
      <div class="rb-ex-h2">Por decidir <small>cierran primero</small></div>${pend.length ? pend.slice(0, 20).map(fila).join("") : `<div class="muted" style="font-size:.85rem">${R.oport ? "No hay licitaciones abiertas en tus rubros. Toca Buscar o pídele al robot licitaciones." : "Cargando…"}</div>`}
      ${desp.length ? `<div class="rb-ex-h2">Para después <small>${desp.length}</small></div>${desp.map(fila).join("")}` : ""}`;
  }
  // 🔗 Dónde comprarlo al menor precio: por ítem, links ordenados de menor a mayor precio (y el reemplazo si no está el exacto),
  //    los proveedores que el robot ya cotizó, y «precio real»: proveedor + unitario → se guarda y el Excel baja solo
  function cajaLinks(t) {
    const its = itemsTodo(t).slice(0, 4); const inf = t.op?.informe || {};
    const limpia = (it) => String(it.d || it.descripcion || it.nombre || "").replace(/\(.*?\)/g, "").replace(/seg[uú]n (eett|especificaci[oó]n).*/i, "").split(/[,;·]/)[0].trim().slice(0, 60);
    const qd = (it) => encodeURIComponent(limpia(it));
    const links = (it) => [["MercadoLibre · menor precio", `https://listado.mercadolibre.cl/${qd(it)}_OrderId_PRICE_ASC`], ["Google Shopping · menor precio", `https://www.google.com/search?tbm=shop&q=${qd(it)}&tbs=p_ord:p`], ["Sodimac", `https://www.sodimac.cl/sodimac-cl/search?Ntt=${qd(it)}`], ["Easy", `https://www.easy.cl/search?q=${qd(it)}`], ["Reemplazo (equivalente)", `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(limpia(it).split(" ").slice(0, 3).join(" ") + " similar")}&tbs=p_ord:p`]];
    const ops = (inf.opciones || []).filter((o) => o.proveedor).sort((a, b) => (a.total_con_iva || 9e15) - (b.total_con_iva || 9e15)).slice(0, 5);
    const P = t.op?.pagos || [];
    return `<div class="rb-links" data-c="${esc(t.codigo)}">
      ${its.map((it, i) => `<div style="font-size:.82rem;margin:6px 0 4px"><b>${i + 1}. ${esc(limpia(it) || "ítem")}</b> <span class="muted">· ${esc(String(it.q || it.cantidad || 1))} ${esc(it.unidad || "u")}${it.p ? " · ofertado " + clp(it.p) + " c/u" : ""}</span>
        <div class="rb-row" style="margin-top:3px;gap:4px">${links(it).map(([n, u]) => `<a class="btn small" href="${u}" target="_blank" rel="noopener">${n} ↗</a>`).join("")}</div>
        <div class="rb-row" style="margin-top:4px;gap:6px;align-items:center"><span class="muted" style="font-size:.74rem">precio real c/u</span><input class="rb-in lk-u" data-i="${i}" inputmode="numeric" placeholder="$" style="width:110px;text-align:right" value="${P[0]?.unit?.[i] ? Number(P[0].unit[i]).toLocaleString("es-CL") : ""}"></div></div>`).join("") || `<div class="muted" style="font-size:.78rem">Sin ítems detallados: anota el precio total abajo.</div>`}
      ${ops.length ? `<div class="rb-sec" style="margin-top:6px">🤖 Proveedores que el robot ya cotizó · de menor a mayor</div>${ops.map((o) => `<div class="rb-row" style="font-size:.8rem;gap:6px;margin:3px 0;align-items:center"><b style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.proveedor)}</b><span>${o.total_con_iva ? clp(o.total_con_iva) : "—"}</span>${o.web ? `<a class="btn small" href="${esc(/^https?:/.test(o.web) ? o.web : "https://" + o.web)}" target="_blank" rel="noopener">↗</a>` : ""}${o.telefono ? `<a class="btn small" href="tel:${esc(String(o.telefono).replace(/[^+\d]/g, ""))}">📞</a>` : ""}<button class="btn small" type="button" data-rb="lk-usar" data-c="${esc(t.codigo)}" data-n="${esc(o.proveedor)}" data-m="${Math.round((o.total_con_iva || 0) / 1.19)}">usar</button></div>`).join("")}` : ""}
      <div class="rb-row" style="margin-top:8px;gap:6px;align-items:center"><span class="muted" style="font-size:.74rem">Los precios que anoté son</span><button class="btn small lk-tipo ${(P[0]?.tipo || "bruto") === "bruto" ? "rb-oro" : ""}" type="button" data-rb="lk-tipo" data-c="${esc(t.codigo)}" data-v="bruto">Bruto (c/IVA, como en internet)</button><button class="btn small lk-tipo ${P[0]?.tipo === "neto" ? "rb-oro" : ""}" type="button" data-rb="lk-tipo" data-c="${esc(t.codigo)}" data-v="neto">Neto</button></div>
      <div class="rb-row" style="margin-top:6px;gap:6px;align-items:center"><input class="rb-in lk-prov" placeholder="Proveedor (ej. Jim Pro)" style="flex:1;min-width:120px" value="${esc(P[0]?.nombre || "")}"><button class="btn small rb-oro" type="button" data-rb="lk-guardar" data-c="${esc(t.codigo)}">💾 Precio real → ¿da?</button></div>
      <div class="muted" style="font-size:.72rem;margin-top:4px">Según la OC: cantidad × tu precio real = compra neta. Al guardar, el Excel de abajo te dice si da o no da.</div></div>`;
  }
  // 💸 A quién le compré: nombre y monto neto (varias personas), con o sin factura; de aquí sale el costo real del negocio
  function pagosHTML(t) {
    const op = t.op || {}; const P = Array.isArray(op.pagos) && op.pagos.length ? op.pagos : (op.precio_acordado ? [{ nombre: (typeof op.proveedor === "object" ? op.proveedor?.nombre : op.proveedor) || "Proveedor", monto: Math.round(op.sin_factura ? op.precio_acordado : op.precio_acordado / 1.19), factura: !op.sin_factura }] : []);
    const tot = P.reduce((a, x) => a + (Number(x.monto) || 0), 0), bruto = P.reduce((a, x) => a + (Number(x.monto) || 0) * (x.factura ? 1.19 : 1), 0);
    const X = calcNeg(t);
    return `<details class="rb-pagos" data-c="${esc(t.codigo)}"><summary style="cursor:pointer;font-size:.84rem;margin-top:8px"><b>💸 A quién le compré</b> <span class="muted">· ${P.length ? `${P.length} pago${P.length > 1 ? "s" : ""} · neto ${clp(tot)} · con IVA ${clp(Math.round(bruto))}` : "anota nombre y monto neto"}</span></summary>
      <div style="margin-top:6px">${(P.length ? P : [{ nombre: "", monto: "", factura: true }]).map((x, i) => `<div class="rb-row" style="gap:6px;margin:4px 0"><input class="rb-in pg-n" placeholder="Nombre (ej. tía Cemento)" value="${esc(x.nombre || "")}" style="flex:2;min-width:110px"><input class="rb-in pg-m" inputmode="numeric" placeholder="monto neto" value="${x.monto ? Number(x.monto).toLocaleString("es-CL") : ""}" style="flex:1;min-width:90px;text-align:right"><label style="font-size:.72rem;white-space:nowrap"><input type="checkbox" class="pg-f" ${x.factura !== false ? "checked" : ""}> factura</label></div>`).join("")}
      <div class="rb-row" style="margin-top:6px"><button class="btn small" type="button" data-rb="pg-mas" data-c="${esc(t.codigo)}">+ persona</button><button class="btn small rb-oro" type="button" data-rb="pg-guardar" data-c="${esc(t.codigo)}">Guardar</button><span class="muted" style="font-size:.74rem">venta ${clp(t.total)} → utilidad final <b style="color:${X.final >= 0 ? "#1ed760" : "#ff6b6b"}">${clp(Math.round(X.final))}</b></span></div></div></details>`;
  }
  function leerPagos(cod) { const box = document.querySelector(`.rb-pagos[data-c="${CSS.escape(cod)}"]`); if (!box) return []; return [...box.querySelectorAll(".rb-row")].map((r) => ({ nombre: (r.querySelector(".pg-n")?.value || "").trim().slice(0, 60), monto: Math.round(Number(String(r.querySelector(".pg-m")?.value || "").replace(/[^\d]/g, "")) || 0), factura: !!r.querySelector(".pg-f")?.checked })).filter((x) => x.nombre || x.monto); }
  function exInicioEjecutor() {
    const T = (R.data?.trabajos || []).filter((t) => t.op && (t.op.oc_codigo || t.op.oc) && clasificarOC(t) !== "D" && !t.op.cobrado).sort((a, b) => Date.parse(b.actualizado || 0) - Date.parse(a.actualizado || 0));
    const yo = persona()?.nombre; const mias = yo ? T.filter((t) => !t.op.responsable || t.op.responsable === yo || t.op.ejecutor_nombre === yo) : T;
    const card = (t) => { const P = planOC(t); const act = P.find((p) => !p.hecho) || P[P.length - 1]; const atraso = P.filter((p) => p.dif > 0).reduce((a, p) => Math.max(a, p.dif), 0); const hechos = P.filter((p) => p.hecho).length;
      return `<div class="rb-card" style="margin:0 0 10px;padding:12px 14px"><div style="display:flex;justify-content:space-between;gap:8px"><div style="min-width:0;cursor:pointer" data-rb="ex-oc" data-c="${esc(t.codigo)}"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.nombre || t.codigo)} <span class="muted" style="font-weight:500">›</span></b><span class="muted" style="font-size:.78rem">📄 OC ${esc(t.op.oc_codigo || t.op.oc || "")} · ${esc(t.organismo || t.oc_compra?.organismo || "")} · ${clp(t.oc_compra?.total || t.total)}</span></div><div style="text-align:right;white-space:nowrap"><b style="color:${atraso ? "#ff6b6b" : "#1ed760"}">${atraso ? atraso + " día" + (atraso > 1 ? "s" : "") + " atrás" : "al día"}</b><br><span class="muted" style="font-size:.72rem">${hechos}/${P.length} pasos</span></div></div>
        <div class="bar" style="height:6px;background:#2a2f38;border-radius:3px;margin:8px 0"><i style="display:block;height:100%;width:${Math.round(hechos / P.length * 100)}%;background:${atraso ? "#ff8a65" : "#1ed760"};border-radius:3px"></i></div>
        <div style="font-size:.84rem"><b>En qué estoy:</b> ${esc(act.txt)}${act.plan ? ` · simulado ${fcorta(act.plan)}` : ""}${act.dif > 0 ? ` · <span style="color:#ff6b6b">${act.dif} día${act.dif > 1 ? "s" : ""} de atraso</span>` : ""}</div>
        <details style="margin-top:6px"><summary class="muted" style="font-size:.76rem;cursor:pointer">Simulado vs real · ${P.length} pasos</summary><div style="font-size:.78rem;margin-top:6px">${P.map((p) => `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #2a2f38"><span>${p.hecho ? "✅" : p === act ? "▶" : "○"}</span><span style="flex:1">${esc(p.txt)}</span><span class="muted">${p.plan ? fcorta(p.plan) : "—"}</span><span style="min-width:70px;text-align:right;color:${p.dif > 0 ? "#ff6b6b" : p.dif < 0 ? "#1ed760" : "#9aa3b2"}">${p.real ? fcorta(p.real) + (p.dif ? ` (${p.dif > 0 ? "+" : ""}${p.dif}d)` : "") : p.dif > 0 ? `+${p.dif}d` : ""}</span></div>`).join("")}</div></details>
        ${trazaHTML(t)}
        <details ${!t.op.precio_acordado ? "open" : ""} style="margin-top:8px"><summary style="cursor:pointer;font-size:.84rem"><b>🔗 Dónde comprarlo al menor precio</b> <span class="muted">· links por ítem · precio real → ¿da?</span></summary>${cajaLinks(t)}</details>
        ${pagosHTML(t)}
        ${t.op.precio_acordado ? `<details style="margin-top:8px" open><summary style="cursor:pointer;font-size:.84rem"><b>📊 Excel en vivo</b> <span class="muted">· con el precio elegido</span></summary>${excelVivo(t, calcNeg(t))}</details>` : ""}
        <div class="rb-row" style="margin-top:8px"><button class="btn small rb-oro" type="button" data-rb="det" data-c="${esc(t.codigo)}">▶ Hacer este paso</button><button class="btn small" type="button" data-rb="inv-pdf" data-c="${esc(t.codigo)}">📄 Caja</button><button class="btn small" type="button" data-rb="claude" data-c="${esc(t.codigo)}">💬 Claude</button></div></div>`; };
    const otras = T.filter((t) => !mias.includes(t));
    return `<div class="rb-ex-h2">Mis órdenes en ejecución <small>${mias.length}</small></div>${mias.length ? mias.map(card).join("") : `<div class="muted" style="font-size:.85rem">No tienes órdenes de compra en ejecución. Cuando una cotización gane, aparece aquí con sus pasos.</div>`}
      ${otras.length ? `<div class="rb-ex-h2">De otros ejecutores <small>${otras.length}</small></div><div class="rb-card" style="padding:4px 14px;margin:0">${otras.map((t) => exFila(t, `<span class="rb-ex-st">${esc(t.op.responsable || t.op.ejecutor_nombre || "sin responsable")}</span>`)).join("")}</div>` : ""}`;
  }
  function exInicioInversionista() {
    const T = (R.data?.trabajos || []).filter((t) => t.op && (t.op.oc_codigo || t.op.oc) && clasificarOC(t) !== "D").map((t) => ({ t, X: calcNeg(t), P: planOC(t) })).filter((z) => z.X.capital > 0 || z.t.op.inversionista_nombre);
    const act = T.filter((z) => !z.t.op.cobrado), done = T.filter((z) => z.t.op.cobrado);
    const capital = act.reduce((a, z) => a + z.X.capital, 0), gan = act.reduce((a, z) => a + z.X.invGan, 0), meta = act.reduce((a, z) => a + z.X.invRecibe, 0);
    const card = (z) => { const { t, X, P } = z; const op = t.op; const puesto = (op.historial || []).find((h) => h.etapa === "inversionista")?.t || op.transferido || t.actualizado; const cobro = P[P.length - 1]; const fin = cobro.real || cobro.plan;
      const total = fin && puesto ? Math.max(1, Date.parse(fin) - Date.parse(puesto)) : 1; const pct = op.cobrado ? 100 : Math.min(99, Math.max(2, Math.round((Date.now() - Date.parse(puesto)) / total * 100)));
      const hechos = P.filter((p) => p.hecho).length; const paso = P.find((p) => !p.hecho);
      return `<div class="rb-card" style="margin:0 0 10px;padding:12px 14px"><div style="display:flex;justify-content:space-between;gap:8px"><div style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.nombre || t.codigo)}</b><span class="muted" style="font-size:.78rem">${esc(t.organismo || "")} · ${esc(t.codigo)}</span></div><div style="text-align:right;white-space:nowrap"><b style="color:#1ed760">${clp(X.invRecibe)}</b><br><span class="muted" style="font-size:.72rem">meta · capital ${clp(X.capital)}</span></div></div>
        <div class="bar" style="height:8px;background:#2a2f38;border-radius:4px;margin:8px 0 4px;position:relative"><i style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#f4c95d,#1ed760);border-radius:4px"></i></div>
        <div style="display:flex;justify-content:space-between;font-size:.74rem" class="muted"><span>puesto ${fcorta(puesto)}</span><span>${hechos}/${P.length} pasos</span><span>${op.cobrado ? "cobrado ✅" : "llega " + fcorta(fin)}</span></div>
        <div class="muted" style="font-size:.74rem;margin-top:4px">🎮 Cotizó ${esc(trazaDe(t).cotizo || "—")} · 🛠 Ejecuta ${esc(trazaDe(t).ejecuta || "—")} · 💼 Invierte ${esc(trazaDe(t).invierte || "—")}</div>
        <div style="font-size:.84rem;margin-top:6px"><b>Dónde está tu plata:</b> ${op.cobrado ? "cobrada, lista para repartir" : paso ? esc(paso.txt).toLowerCase() : "cerrando"} · ganancia proyectada <b style="color:#1ed760">${clp(X.invGan)}</b> (${(X.invPct * 100).toFixed(1)} %)${op.cobrado ? "" : ` · <span class="rb-reloj" data-t="${esc(puesto)}"></span> en juego`}</div>
        <div class="rb-row" style="margin-top:8px"><button class="btn small" type="button" data-rb="inv-pdf" data-c="${esc(t.codigo)}">📄 Caja y cronología</button><button class="btn small" type="button" data-rb="det" data-c="${esc(t.codigo)}">Ver OC ›</button><button class="btn small" type="button" data-rb="claude" data-c="${esc(t.codigo)}">💬 ¿Cómo va?</button></div></div>`; };
    return `<div class="rb-ex-h2">Tu plata, en vivo <small>${act.length} negocio${act.length === 1 ? "" : "s"} abiertos</small></div>
      <div class="rb-card" style="margin:0 0 10px;padding:12px 14px"><div class="rb-env"><div><span class="muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.06em">Capital en juego</span><br><b style="font-size:1.3rem">${clp(capital)}</b></div><div><span class="muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.06em">Ganancia proyectada</span><br><b style="font-size:1.3rem;color:#1ed760">${clp(gan)}</b></div><div><span class="muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.06em">Meta</span><br><b style="font-size:1.3rem;color:#f4c95d">${clp(meta)}</b></div></div></div>
      ${act.length ? act.map(card).join("") : `<div class="muted" style="font-size:.85rem">No hay capital puesto en negocios abiertos. Cuando una OC pida inversión, aparece aquí con su avance segundo a segundo.</div>`}
      ${done.length ? `<div class="rb-ex-h2">Cobrados <small>${done.length}</small></div>${done.slice(0, 8).map(card).join("")}` : ""}`;
  }
  function exReloj() {           // ⏱ segundo a segundo: tiempo con el capital puesto
    document.querySelectorAll(".rb-reloj").forEach((el) => { const ms = Date.now() - Date.parse(el.dataset.t); if (!(ms > 0)) return; const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), sg = Math.floor(ms % 6e4 / 1e3); el.textContent = `${d} d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sg).padStart(2, "0")}`; });
  }
  setInterval(exReloj, 1000);
  function exInicio() {
    const nom = persona()?.nombre || ""; const h = new Date().getHours(); const sal = h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
    const op = exMisOport().sort((a, b) => exHoras(a) - exHoras(b)); const prox = op.slice(0, 3); const seg = op.filter(exSeg); const savedC = Object.keys(leerSel()).map((c) => (R.oport?.lista || []).find((x) => x.codigo === c) || { codigo: c, ...leerSel()[c] });
    const n = exPendientes().length; const r = R.data?.robot;
    const pf = perfil(); const cuerpoPerfil = pf === "cotizador" ? exInicioCotizador(op, n) : pf === "licitador" ? exInicioLicitador() : pf === "ejecutor" ? exInicioEjecutor() : exInicioInversionista();
    return `<div class="rb-env"><div><div class="rb-ex-h1">${sal}${nom ? ", " + esc(nom) : ""}</div><div class="muted" style="font-size:.8rem">${new Date().toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })} · ${n ? `<b style="color:#ff8a65">${n} pendiente${n > 1 ? "s" : ""}</b>` : "sin pendientes"} · robot ${r?.conectado ? "🟢" : "⚫"}</div></div></div>
      ${perfilBarra()}${cuerpoPerfil}
      ${pf === "cotizador" ? "" : `<div class="rb-ex-h2">Próximos cierres <small>en tus rubros</small></div>`}${pf === "cotizador" ? "" : `<div class="rb-card" style="padding:4px 14px;margin:0">${prox.length ? prox.map((x) => exFila(x)).join("") : `<div class="muted" style="padding:10px 0;font-size:.85rem">${R.oport ? "Nada por cerrar en tus rubros. Toca Buscar para explorar." : "Cargando oportunidades…"}</div>`}</div>`}
      <div class="rb-ex-h2">Segundos llamados <small>menos competencia</small></div>${seg.length ? `<div class="rb-ex-carr">${seg.slice(0, 12).map(exCover).join("")}</div>` : `<div class="muted" style="font-size:.85rem">Hoy no hay segundos llamados en tus rubros.</div>`}
      <div class="rb-ex-h2">Oportunidades en tus rubros <small>${op.length}</small></div><div class="rb-ex-carr">${op.filter((x) => !exSeg(x)).slice(0, 14).map(exCover).join("") || `<div class="muted" style="font-size:.85rem">—</div>`}</div>
      <div class="rb-ex-h2">Guardadas recientemente <small>${savedC.length}</small></div>${savedC.length ? `<div class="rb-ex-carr">${savedC.slice(0, 12).map(exCover).join("")}</div>` : `<div class="muted" style="font-size:.85rem">Guarda una compra con ★ desde su ficha y aparece aquí.</div>`}
      <div style="margin-top:18px"><button class="btn rb-oro" type="button" data-rb="claude" style="width:100%">💬 Pregúntale a Claude sobre tu cartera</button></div>`;
  }
  function exBuscar() {
    const q = norm(R.exQ || ""); const f = R.exF || {}; const lista = (R.oport?.lista || []).filter((x) => x.fuente !== "licitacion" && exHoras(x) > 0);
    const rubros = [...new Set(lista.map((x) => x.rubro).filter(Boolean))].sort();
    const regiones = [...new Set(lista.map((x) => String(x.region || "").replace("Región ", "").replace(" de Santiago", "")).filter(Boolean))].sort();
    const L = lista.filter((x) => !(x.ya_ofertada || x.trabajada) && (!q || norm((x.nombre || "") + " " + (x.organismo || "") + " " + x.codigo + " " + (x.region || "")).includes(q)) && (!f.rubro || x.rubro === f.rubro) && (!f.seg || exSeg(x)) && (!f.reg || String(x.region || "").includes(f.reg)) && (!f.hoy || exHoras(x) < 24)).sort((a, b) => exHoras(a) - exHoras(b));
    const tomadas = q ? lista.filter((x) => (x.ya_ofertada || x.trabajada) && norm((x.nombre || "") + " " + x.codigo).includes(q)).slice(0, 5) : [];
    return `<div class="rb-ex-h1">Buscar</div><div class="muted" style="font-size:.8rem">Oportunidades abiertas por palabra, organismo o ID</div>
      <div class="rb-ex-search">${EXI.buscar}<input id="rbExQ" placeholder="Áridos, hospital, 2466-512…" value="${esc(R.exQ || "")}" autocomplete="off"></div>
      <div class="rb-ex-chips"><button type="button" class="${f.seg ? "on" : ""}" data-rb="ex-f" data-k="seg">2° llamado</button><button type="button" class="${f.hoy ? "on" : ""}" data-rb="ex-f" data-k="hoy">Cierra hoy</button>${rubros.map((r) => `<button type="button" class="${f.rubro === r ? "on" : ""}" data-rb="ex-f" data-k="rubro" data-v="${esc(r)}">${esc(r)}</button>`).join("")}</div>
      <div class="rb-ex-chips">${regiones.map((r) => `<button type="button" class="${f.reg === r ? "on" : ""}" data-rb="ex-f" data-k="reg" data-v="${esc(r)}">${esc(r)}</button>`).join("")}</div>
      <div class="rb-ex-h2">Resultados <small>${L.length}</small></div><div class="rb-card" style="padding:4px 14px;margin:0">${L.length ? L.slice(0, 80).map((x) => exFila(x)).join("") : `<div class="muted" style="padding:10px 0;font-size:.85rem">${R.oport ? "Nada con ese filtro." : "Cargando…"}</div>`}</div>
      ${tomadas.length ? `<div class="rb-ex-h2">Ya ingresadas <small>no se vuelven a ofertar</small></div><div class="rb-card" style="padding:4px 14px;margin:0;opacity:.7">${tomadas.map((x) => exFila(x, `<span class="rb-ex-st env">ya la metió ${esc(x.quien || "alguien del grupo")}</span>`)).join("")}</div>` : ""}`;
  }
  function exBiblio() {
    const k = R.exLib || "todas"; const ocu = leerOcultas(); const trabajos = (R.data?.trabajos || []).filter((t) => esMia(t) && !(ocu[t.codigo] && t.estado === "firmar")); const sel = leerSel(); const lista = R.oport?.lista || [];
    const filas = [];
    for (const [c, x] of Object.entries(sel)) { const t = trabajo(c); if (t) continue; const o = lista.find((y) => y.codigo === c) || { codigo: c, ...x }; filas.push({ k: "guardadas", t: Date.parse(x.actualizado || x.desde || 0), html: exFila(o, `<span class="rb-ex-st">MP: publicada</span><span class="rb-ex-st doc">${x.costo || x.flete || x.responsable ? "borrador" : "guardada"}</span>`) }); }
    for (const t of trabajos) { const oc = t.op && (t.op.oc_codigo || t.op.oc); const b = oc ? clasificarOC(t) : null; const inter = oc ? ({ A: "Entregada", B: "En operación", C: "OC nueva", D: "Revisar" })[b] : t.estado === "firmar" ? "Lista para firmar" : HECHA.includes(t.estado) ? "Enviada" : esc(t.estado);
      const mp = oc ? "OC " + (t.op.oc_estado || "emitida") : HECHA.includes(t.estado) ? "Oferta enviada" : "Publicada"; const kk = oc ? (b === "A" && !t.op.cobrado ? "cobrar" : b === "A" ? "cobradas" : "operacion") : t.estado === "firmar" ? "firmar" : HECHA.includes(t.estado) ? "enviadas" : "otras";
      filas.push({ k: kk, t: Date.parse(t.actualizado || t.creado || 0), html: `<div class="rb-ex-row" data-rb="det" data-c="${esc(t.codigo)}"><div class="d" style="background:${exColor(t)}"><b style="font-size:.66rem">${esc(corta((R.empresas || {})[t.empresa || "principal"]?.razon_social || "PJANIC").split(" ")[0].slice(0, 8))}</b></div><div class="tx"><b>${esc(t.nombre || t.codigo)}</b><span>${esc(t.organismo || "")} · ${esc(t.codigo)}</span><div><span class="rb-ex-st">MP: ${esc(mp)}</span><span class="rb-ex-st ${kk === "cobrar" ? "doc" : kk === "cobradas" || kk === "enviadas" ? "env" : kk === "operacion" ? "info" : kk === "firmar" ? "doc" : ""}">${inter}</span>${t.total ? `<span class="rb-ex-st">${clp(t.total)}</span>` : ""}${trazaChips(t)}</div></div></div>` }); }
    const chips = [["todas", "Todas"], ["guardadas", "Guardadas"], ["firmar", "Por firmar"], ["enviadas", "Enviadas"], ["operacion", "En operación"], ["cobrar", "Por cobrar"], ["cobradas", "Cobradas"]];
    const L = filas.filter((f) => k === "todas" || f.k === k).sort((a, b) => b.t - a.t);
    const emp = (R.empresas || {})[miEmp() || ""]; 
    return `<div class="rb-env"><div class="rb-ex-h1">Tu biblioteca</div><button class="btn small" type="button" data-rb="oc">📦 Caja de OC</button></div><div class="muted" style="font-size:.8rem">Estado oficial de Mercado Público · avance interno${emp ? ` · <button class="btn small" type="button" data-rb="ex-todas-emp" style="padding:1px 8px">${leer().todasEmp ? "Todas las empresas" : "Solo " + esc(corta(emp.razon_social))}</button>` : ""}</div>
      <div class="rb-ex-chips">${chips.map(([kk, l]) => `<button type="button" class="${k === kk ? "on" : ""}" data-rb="ex-lib" data-k="${kk}">${l}${kk !== "todas" ? ` <i style="opacity:.6">${filas.filter((f) => f.k === kk).length}</i>` : ""}</button>`).join("")}</div>
      <div class="rb-card" style="padding:4px 14px;margin:0">${L.length ? L.slice(0, 120).map((f) => f.html).join("") : `<div class="muted" style="padding:10px 0;font-size:.85rem">Aún no hay compras aquí.</div>`}</div>`;
  }
  function exActiv() {
    const P = exPendientes(); const col = { doc: "#f4c95d", cierre: "#ff8a65", env: "#4fd18b", info: "#6ea8ff" };
    return `<div class="rb-env"><div class="rb-ex-h1">Actividad</div><span class="muted" style="font-size:.8rem">${P.length} tarea${P.length === 1 ? "" : "s"}</span></div><div class="muted" style="font-size:.8rem">Solo lo que requiere tu acción. Cada una abre la compra o la tarea.</div>
      <div class="rb-card" style="padding:4px 14px;margin-top:10px">${P.length ? P.map((p) => `<div class="rb-ex-row" data-rb="${p.det ? "det" : "ex-ficha"}" data-c="${esc(p.c)}"><div class="d" style="color:${col[p.tipo] || "#fff"}">${p.tipo === "env" ? "💰" : p.tipo === "cierre" ? "⚠" : p.tipo === "info" ? "ℹ" : "✍"}</div><div class="tx"><b style="white-space:normal">${esc(p.texto)}</b><span>${esc(p.c)}</span></div></div>`).join("") : `<div class="muted" style="padding:14px 0;font-size:.85rem">Nada pendiente. 👌</div>`}</div>`;
  }
  // 📄 Orden de compra (modo ejecutivo): todo lo de la OC en una pantalla: OC de MP · cotización que ingresamos · PDF del inversor · anexos técnicos
  function ocExec(cod) {
    const t = trabajoG(cod); if (!t) { R.exOC = null; return ""; } const op = t.op || {}, oc = t.oc_compra || {}; const docOC = (op.docs || []).filter((d) => d.tipo === "oc").pop();
    const docs = [...(t.lic_docs || []), ...(op.docs || []).filter((d) => d.tipo !== "oc")]; const z = trazaDe(t); const X = calcNeg(t);
    const its = itemsTodo(t).slice(0, 40);
    const btn = (ok, html) => ok ? html : html.replace('class="btn', 'class="btn" disabled style="opacity:.45" data-x="').replace("data-rb=", "data-off=");
    return `<div class="rb-env"><button class="btn small" type="button" data-rb="ex-oc-volver">‹ Volver</button><span class="muted" style="font-size:.78rem">${esc(cod)}</span></div>
      <div style="border-radius:12px;background:${exColor(t)};padding:14px;margin:10px 0 12px"><div><span class="rb-ex-st env">OC ${esc(op.oc_codigo || op.oc || "")}</span>${op.oc_estado ? `<span class="rb-ex-st">${esc(op.oc_estado)}</span>` : ""}${op.plazo_fecha ? `<span class="rb-ex-st doc">entrega ${esc(new Date(op.plazo_fecha + "T12:00").toLocaleDateString("es-CL", { day: "numeric", month: "short" }))}</span>` : ""}</div>
        <div class="rb-ex-h1" style="font-size:1.15rem">${esc(t.nombre || cod)}</div><div class="muted" style="font-size:.8rem">${esc(oc.organismo || t.organismo || "")}${oc.direccion ? " · " + esc(oc.direccion) : ""}</div>
        <div style="margin-top:6px;font-size:.84rem"><b>${clp(t.total)}</b> con IVA · 🎮 ${esc(z.cotizo || "—")} · 🛠 ${esc(z.ejecuta || "—")} · 💼 ${esc(z.invierte || "—")}</div></div>
      <div class="rb-ex-h2">Documentos de esta orden</div>
      <div class="rb-card" style="padding:4px 14px;margin:0">
        <div class="rb-ex-row" ${docOC ? `data-rb="neg-doc" data-c="${esc(cod)}" data-id="${esc(docOC.id)}"` : ""} style="${docOC ? "" : "opacity:.5;cursor:default"}"><div class="d">📄</div><div class="tx"><b>Orden de compra de Mercado Público</b><span>${docOC ? "PDF oficial de la OC " + esc(op.oc_codigo || "") : "aún no está el PDF: el robot lo baja al aceptar la OC"}</span></div>${docOC ? "›" : ""}</div>
        <div class="rb-ex-row" ${t.pdf ? `data-rb="pdf" data-c="${esc(cod)}"` : ""} style="${t.pdf ? "" : "opacity:.5;cursor:default"}"><div class="d">📑</div><div class="tx"><b>Cotización que ingresamos</b><span>${t.pdf ? "el PDF con el que ofertamos (ficha técnica y precios)" : "sin PDF guardado"}</span></div>${t.pdf ? "›" : ""}</div>
        <div class="rb-ex-row" data-rb="inv-pdf" data-c="${esc(cod)}"><div class="d">💼</div><div class="tx"><b>PDF del inversor · simulación</b><span>caja, cronología y reparto${X.compras ? " · utilidad " + clp(Math.round(X.final)) : " · con precio estimado"}</span></div>›</div>
        ${docs.length ? docs.slice(-8).map((d) => `<div class="rb-ex-row" data-rb="neg-doc" data-c="${esc(cod)}" data-id="${esc(d.id)}"><div class="d">📎</div><div class="tx"><b>${esc((d.nombre || d.tipo).slice(0, 48))}</b><span>${esc(d.tipo || "anexo")}${d.kb ? " · " + d.kb + " KB" : ""}</span></div>›</div>`).join("") : `<div class="rb-ex-row" style="opacity:.6;cursor:default"><div class="d">📎</div><div class="tx"><b>Anexos técnicos</b><span>no hay anexos guardados · súbelos desde Ejecuta y Claude los lee</span></div></div>`}
      </div>
      ${its.length > 4 ? `<div class="rb-card" style="margin:12px 0 0;padding:4px 14px"><div class="rb-ex-row" data-rb="ex-items" data-c="${esc(cod)}"><div class="d">🧾</div><div class="tx"><b>${its.length} ítems · poner precios reales ítem por ítem</b><span>cada uno con su precio y proveedor · ¿da o no da? en vivo</span></div>›</div></div>` : ""}
      <div class="rb-ex-h2">🔗 Dónde comprarlo al menor precio <small>${its.length > 4 ? "primeros 4 ítems · los demás en la pantalla de ítems" : "busca, elige y anota el precio"}</small></div><div class="rb-card" style="margin:0">${cajaLinks(t)}</div>
      ${its.length ? `<div class="rb-ex-h2">Qué pide la orden <small>${its.length} ítem${its.length > 1 ? "s" : ""}</small></div><div class="rb-card" style="margin:0;font-size:.84rem"><ol style="margin:0;padding-left:18px">${its.map((it) => `<li>${esc(String(it.d || it.descripcion || it.nombre || ""))}${it.q || it.cantidad ? ` · <b>${esc(String(it.q || it.cantidad))}</b> ${esc(it.unidad || "")}` : ""}${it.p ? ` · ${clp(it.p)} c/u` : ""}</li>`).join("")}</ol></div>` : ""}
      <div class="rb-row" style="margin-top:12px"><button class="btn rb-oro" type="button" data-rb="ex-oc-volver" style="flex:1">‹ Volver a ejecutar</button><button class="btn" type="button" data-rb="claude" data-c="${esc(cod)}">💬 Claude</button></div>`;
  }
  // 🧾 Ítems de la OC, uno por uno: precio real por ítem (y proveedor si cambia) → ¿da o no da? en vivo, antes de guardar
  function itemsExec(cod) {
    const t = trabajoG(cod); if (!t) { R.exItems = null; return ""; } const op = t.op || {}; const its = itemsTodo(t);
    const P = op.pagos || []; const unitPrev = {}; P.forEach((pg) => (pg.unit || []).forEach((u, i) => { if (u) unitPrev[i] = { u, n: pg.nombre, tipo: pg.tipo || "bruto" }; }));
    const q = (it) => Number(it.q || it.cantidad || 1) || 1, d = (it) => String(it.d || it.descripcion || it.nombre || ""), of = (it) => Number(it.p || it.precio || 0) || 0;
    const ventaN = Math.round((Number(t.total) || 0) / 1.19);
    return `<div class="rb-env"><button class="btn small" type="button" data-rb="ex-items-volver">‹ Volver</button><span class="muted" style="font-size:.78rem">${esc(cod)} · ${its.length} ítems</span></div>
      <div class="rb-ex-h1" style="margin:8px 0 2px">Precios reales, ítem por ítem</div><div class="muted" style="font-size:.8rem">Anota lo que te cobra el proveedor por cada ítem. Abajo ves al tiro si da o no da.</div>
      <div class="rb-row" style="margin:8px 0;gap:6px;align-items:center"><span class="muted" style="font-size:.74rem">Precios</span><button class="btn small it-tipo rb-oro" type="button" data-v="bruto">Bruto (c/IVA)</button><button class="btn small it-tipo" type="button" data-v="neto">Neto</button><span class="muted" style="font-size:.74rem">· proveedor general:</span><input class="rb-in it-prov" placeholder="ej. Jim Pro" style="flex:1;min-width:100px" value="${esc(P[0]?.nombre || "")}"></div>
      <div class="rb-card rb-items" data-c="${esc(cod)}" style="padding:4px 12px;margin:0">${its.map((it, i) => `<div class="rb-ex-row it-row" data-i="${i}" style="cursor:default;align-items:flex-start"><div class="d" style="min-width:34px"><b>${i + 1}</b></div><div class="tx" style="flex:1"><b style="white-space:normal">${esc(d(it))}</b><span>${q(it)} ${esc(it.unidad || "u")}${of(it) ? " · ofertado " + clp(of(it)) + " c/u" : ""}</span>
          <div class="rb-row" style="margin-top:4px;gap:6px;align-items:center"><input class="rb-in it-u" inputmode="numeric" placeholder="precio real c/u" style="width:120px;text-align:right" value="${unitPrev[i] ? Number(unitPrev[i].u).toLocaleString("es-CL") : ""}"><input class="rb-in it-p" placeholder="proveedor (si es otro)" style="flex:1;min-width:90px" value="${esc(unitPrev[i]?.n && unitPrev[i].n !== (P[0]?.nombre || "") ? unitPrev[i].n : "")}"><span class="it-sub muted" style="font-size:.74rem;min-width:70px;text-align:right"></span></div></div></div>`).join("")}</div>
      <div class="rb-card" style="margin-top:10px"><div class="rb-env"><div><span class="muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.06em">Venta neta</span><br><b>${clp(ventaN)}</b></div><div><span class="muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.06em">Compra neta</span><br><b class="it-tot">—</b></div><div style="text-align:right"><span class="muted" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.06em">¿Da?</span><br><b class="it-da">pon precios</b></div></div>
        <div class="muted it-nota" style="font-size:.74rem;margin-top:4px">Sin precios todavía · ${its.filter((_, i) => unitPrev[i]).length}/${its.length} ítems con precio</div>
        <div class="rb-row" style="margin-top:8px"><button class="btn rb-oro" type="button" data-rb="it-guardar" data-c="${esc(cod)}" style="flex:1">💾 Guardar precios reales → Excel en vivo</button></div></div>`;
  }
  function itemsCalc(cod) {       // ¿da? en vivo mientras escribes
    const t = trabajoG(cod); const box = document.querySelector(`.rb-items[data-c="${CSS.escape(cod)}"]`); if (!t || !box) return null;
    const its = itemsTodo(t); const tipo = document.querySelector(".it-tipo.rb-oro")?.dataset.v || "bruto"; const aNeto = (v) => tipo === "bruto" ? v / 1.19 : v;
    let compraN = 0, con = 0; const unit = [], provs = {};
    box.querySelectorAll(".it-row").forEach((r) => { const i = +r.dataset.i, u = Math.round(Number(String(r.querySelector(".it-u").value).replace(/[^\d]/g, "")) || 0); const qn = Number(its[i]?.q || its[i]?.cantidad || 1) || 1; unit[i] = u; const sub = Math.round(aNeto(u) * qn); r.querySelector(".it-sub").textContent = u ? clp(sub) + " neto" : ""; if (u) { con++; compraN += sub; const pn = (r.querySelector(".it-p").value || "").trim() || (document.querySelector(".it-prov")?.value || "").trim() || "Proveedor"; provs[pn] = (provs[pn] || 0) + sub; } });
    const X = compraN ? calcNeg({ ...t, op: { ...(t.op || {}), precio_acordado: Math.round(compraN * 1.19), pagos: Object.entries(provs).map(([n, m]) => ({ nombre: n, monto: m, factura: true })) } }) : null;
    const tot = document.querySelector(".it-tot"), da = document.querySelector(".it-da"), nota = document.querySelector(".it-nota");
    if (tot) tot.textContent = compraN ? clp(compraN) : "—";
    if (da) { da.textContent = X ? (X.final > 0 ? "✅ SÍ DA" : "❌ NO DA") : "pon precios"; da.style.color = X ? (X.final > 0 ? "#1ed760" : "#ff6b6b") : ""; }
    if (nota) nota.textContent = X ? `Utilidad final ${clp(Math.round(X.final))} · margen ${Math.round((compraN ? (Math.round((Number(t.total) || 0) / 1.19) - compraN) / Math.max(1, Math.round((Number(t.total) || 0) / 1.19)) : 0) * 100)} % · ${con}/${its.length} ítems con precio${con < its.length ? " (faltan " + (its.length - con) + ")" : ""}` : `Sin precios todavía · 0/${its.length} ítems con precio`;
    return { compraN, unit, provs, tipo, con };
  }
  function fichaExec(cod) {
    const x = (R.oport?.lista || []).find((y) => y.codigo === cod) || { codigo: cod, ...(leerSel()[cod] || {}) }; const sel = leerSel()[cod]; const t = trabajo(cod);
    if (t) { R.exFicha = null; R.detalle = cod; setTimeout(() => pintarHoja(true), 0); return ""; }
    const ver = R.oport?.fecha ? new Date(R.oport.fecha).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) : "—";
    return `<div class="rb-env"><button class="btn small" type="button" data-rb="ex-volver">‹ Volver</button><div class="rb-row"><button class="btn small ${sel ? "rb-oro" : ""}" type="button" data-rb="oport-sel" data-c="${esc(cod)}">${sel ? "★ Guardada" : "☆ Guardar"}</button><button class="btn small" type="button" data-rb="claude" data-c="${esc(cod)}">💬 Claude</button></div></div>
      <div style="height:150px;border-radius:12px;background:${exColor(x)};display:flex;align-items:flex-end;padding:14px;margin:10px 0 12px"><div><div>${exSeg(x) ? '<span class="rb-ex-st info">2° llamado</span>' : ""}<span class="rb-ex-st ${exHoras(x) < 30 ? "cierre" : ""}">${exCierreTxt(x)}</span>${x.ofertas != null ? `<span class="rb-ex-st">${x.ofertas === 0 ? "sin rivales aún" : x.ofertas + " oferta" + (x.ofertas === 1 ? "" : "s")}</span>` : ""}</div><div class="rb-ex-h1" style="font-size:1.2rem">${esc(x.nombre || cod)}</div><div class="muted" style="font-size:.8rem">${esc(x.organismo || "")} · ${esc(cod)}</div></div></div>
      <div class="rb-card" style="margin:0"><div class="rb-ex-kv">
        <div>Qué piden</div><div>${esc(x.descripcion || x.nombre || "—")}<span class="rb-ex-src">↳ Ficha MP</span></div>
        <div>Cierra</div><div>${x.cierre ? new Date(x.cierre).toLocaleString("es-CL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "—"}</div>
        <div>Presupuesto</div><div>${x.monto ? clp(x.monto) + (x.monto_estimado && x.monto_estimado !== "False" ? " (estimado)" : " (publicado)") : "No publicado"}</div>
        <div>Región</div><div>${esc(x.region || "—")}</div>
        <div>Rubro</div><div>${esc(x.rubro || "—")}${x.etiqueta ? ` · ${esc(x.etiqueta)}` : ""}</div>
        <div>Verificado</div><div>Lista de Mercado Público de las <b>${ver}</b>${sel?.verificado?.cierre ? ` · al guardar: cierre ${String(sel.verificado.cierre).slice(5, 16).replace("T", " ")}` : ""}</div>
      </div></div>
      ${sel ? `<div class="rb-card" style="margin-top:10px"><b>Borrador</b>${tiraBorradorPublica(x, sel)}</div>` : ""}
      <div style="margin-top:12px" class="rb-row"><button class="btn rb-oro" type="button" data-rb="oport-si" data-c="${esc(cod)}" style="flex:1">✍ Preparar cotización con ${esc(corta((R.empresas || {})[miEmp() || "principal"]?.razon_social || "mi empresa"))}</button></div>
      <div class="muted" style="font-size:.74rem;margin-top:6px">El robot arma la oferta (precio por ítem, PDF, ficha) y la deja en «Por firmar». El envío y la firma los haces tú en Mercado Público.</div>`;
  }
  // 📋 Borrador de trabajo: empresa · responsable · flete · plazo · última verificación · cambios por revisar
  const tiraBorrador = (x) => {
    const sel = x._sel || {}; const gente = [...new Set([persona()?.nombre, ...Object.values(R.ejecutores || {}).map((e) => e?.nombre)].filter(Boolean))];
    if (sel.responsable && !gente.includes(sel.responsable)) gente.push(sel.responsable);
    const ver = sel.ultima_verificacion || sel.verificado?.t || R.oport?.fecha; const hhmm = ver ? new Date(ver).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) : "—";
    const emp = (R.empresas || {})[sel.empresa || miEmp() || "principal"]?.razon_social;
    const cambios = (sel.cambios || []).slice(-3).map((c) => c.campo === "cierre" ? `cierre ${String(c.antes).slice(5, 16).replace("T", " ")} → <b>${String(c.despues).slice(5, 16).replace("T", " ")}</b>` : c.campo === "presupuesto" ? `presupuesto ${clp(c.antes)} → <b>${clp(c.despues)}</b>` : "pasó a <b>2° llamado</b>");
    return `<div class="rb-bor" data-c="${esc(x.codigo)}">
      ${sel.revisar ? `<div class="rb-bor-al">⚠ <b>Cambió mientras cotizabas:</b> ${cambios.join(" · ")}. Tu borrador se conservó; revisa antes de aprobar. <button class="btn small" type="button" data-rb="sel-revisado" data-c="${esc(x.codigo)}">✓ Revisado</button></div>` : ""}
      <div class="rb-bor-g">
        <label>Empresa<b>${esc(corta(emp || "PJANIC"))}</b></label>
        <label>Responsable<select class="rb-bor-resp"><option value="">— sin asignar —</option>${gente.map((g) => `<option ${sel.responsable === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>
        <label>Flete (neto)<input class="rb-bor-flete rb-in" inputmode="numeric" value="${sel.flete ? Number(sel.flete).toLocaleString("es-CL") : ""}" placeholder="0"></label>
        <label>Plazo ofrecido<input class="rb-bor-plazo rb-in" value="${esc(sel.plazo || "")}" placeholder="ej. 3 días hábiles"></label>
      </div>
      <div class="muted" style="font-size:.7rem;margin-top:6px">Verificado en Mercado Público a las <b>${hhmm}</b>${sel.verificado?.cierre ? ` · cierre visto ${String(sel.verificado.cierre).slice(5, 16).replace("T", " ")}` : ""} · el borrador se guarda solo en la nube.</div>
    </div>`;
  };
  const tiraBorradorPublica = (x, sel) => tiraBorrador({ ...x, _sel: sel });
  function pantallaLista() {
    const r = R.data?.robot;
    const lista = R.data?.trabajos || [];
    const conectado = r?.conectado;
    const permiso = "Notification" in window ? Notification.permission : "unsupported";
    const pushPosible = "PushManager" in window && permiso !== "denied";
    const vista = { lista: vistaLista, cajas: vistaCajas, tablero: vistaTablero, oport: vistaOport }[R.vista] || vistaCajas;
    if (R.vista === "oport") {
      const mp = R.data?.mp, emp = empresaActual();
      if (!R.empresas) cargarEmpresas();
      const iconos = `<button class="rb-ico" type="button" data-rb="planes" aria-label="Planes" title="Planes">💎</button><button class="rb-ico" type="button" data-rb="analizador" aria-label="Analizador de proyectos" title="Analizador de proyectos — Excel en vivo">📊</button>${tienePlan("medio") ? `<button class="rb-ico" type="button" data-rb="global" aria-label="Informe global" title="Todo lo que se ha hecho en la app">🌍</button>` : ""}${mailChip()}<button class="rb-ico" type="button" data-rb="oc" aria-label="Órdenes de compra" title="Solo las órdenes de compra: operadas, en operación, nuevas">📦</button><button class="rb-ico rb-claude" type="button" data-rb="claude" aria-label="Chatear con Claude" title="Chatea con Claude, el cerebro de la app">💬</button><button class="rb-ico rb-tel" type="button" data-rb="llamada" aria-label="Me llamaron">📞</button>`;
      // ◧ modo ejecutivo: una sola línea limpia (empresa · quién · robot/MP · ⋯ · ✕); los íconos viven en el menú ⋯
      const cab = execOn() ? `<div class="rb-top2 rb-top-ex">
        <button class="rb-emp" type="button" data-rb="empresa-editar">🏢 <span>${esc(corta(emp?.razon_social) || "Mi empresa")}</span> ▾</button>
        <button class="rb-yo" type="button" data-rb="persona-editar" title="Quién usa este celular">👤 ${persona()?.nombre ? esc(persona().nombre.split(" ")[0].slice(0, 12)) : "¿quién?"}</button>
        <button type="button" class="rb-pcs" data-rb="ver-roles" title="${conectado ? "Robot conectado" : "Robot apagado"} · ${mp?.conectado ? "MP conectado" : "MP sin sesión"}"><i class="${conectado ? "on" : ""}"></i>${/nube/i.test(r?.equipo || "") ? "☁️" : "Robot"}<i class="${mp?.conectado ? "on" : ""}" style="margin-left:6px"></i>MP</button>
        <span style="flex:1"></span><button class="rb-ico" type="button" data-rb="ex-menu" aria-label="Más" title="Herramientas">⋯</button><button class="rb-ico" type="button" data-rb="cerrar" aria-label="Cerrar">✕</button></div>
        ${R.exMenu ? `<div class="rb-ex-menu">${iconos}<button class="rb-ico" type="button" data-rb="conectar-mp" title="Entrar a Mercado Público desde la app">🔑</button><button class="rb-ico" type="button" data-rb="informe-link" data-id="gensa" title="Link del informe para GENSA (Sí/No)">📋</button></div>` : ""}` : `<div class="rb-top2">
        <button class="rb-emp" type="button" data-rb="empresa-editar">🏢 <span>${esc(corta(emp?.razon_social) || "Mi empresa")}</span> ▾</button>
        <button class="rb-yo" type="button" data-rb="persona-editar" title="Quién usa este celular">👤 ${persona()?.nombre ? "usuario " + esc(persona().nombre.split(" ")[0].slice(0, 12)) : "¿quién?"}</button>
        <button type="button" class="rb-pcs" data-rb="ver-roles" title="¿Qué quieres hacer? · ${conectado ? "Robot conectado" : "Robot apagado"}"><i class="${conectado ? "on" : ""}"></i>${/nube/i.test(r?.equipo || "") ? "☁️" : "Robot"}</button><button type="button" class="rb-pcs" data-rb="conectar-mp" title="${mp?.conectado ? "Mercado Público conectado" : "Entrar a Mercado Público desde la app"}"><i class="${mp?.conectado ? "on" : ""}"></i>MP${mp?.conectado ? "" : " ▸"}</button>
        ${iconos}
        <button class="rb-ico" type="button" data-rb="cerrar" aria-label="Cerrar">✕</button></div>`;
      const cab2 = cab + `${execOn() ? "" : barraPortales()}${esDueno() ? (setTimeout(() => { if (!R.nubeT || Date.now() - R.nubeT > 60000) cargarNube(); inicioLoginMP(); }, 0), execOn() ? "" : barraMando(r, mp, conectado)) : ""}`;
      // 🏆 portada: cada vez que abres la app (y siempre que no haya empresa). Sin formularios: RUT → jugar.
      if (R.verRoles) return selectorRol();
      if (!miEmp() || !portadaVista()) { if (!R.oport) cargarOport(); return pantallaPortada(); }
      let cuerpo;
      if (R.personaEditar) cuerpo = pantallaPersona();
      else if (R.empresaEditar) cuerpo = pantallaEmpresa();
      else if (R.rubroEditar) { if (!R.oport) cargarOport(); cuerpo = `<div class="rb-paso-n" style="text-align:center;margin-top:10px">Paso 3 de 3</div>` + pantallaRubro(R.oport?.lista || []); }
      else if (R.pantalla === "llamada") cuerpo = pantallaLlamada();
      else if (R.pantalla === "claude") cuerpo = pantallaClaude();
      else if (R.pantalla === "analizador") cuerpo = pantallaAnalizador();
      else if (R.pantalla === "correos") cuerpo = pantallaCorreos();
      else if (R.pantalla === "global") cuerpo = pantallaGlobal();
      else if (R.pantalla === "oc") cuerpo = pantallaOC();
      else if (R.pantalla === "planes") cuerpo = pantallaPlanes();
      else if (R.pantalla === "mplogin") cuerpo = pantallaLoginMP();
      else if (execOn() && !R.exFicha) { if (!esDueno() && (!R.planT || Date.now() - R.planT > 300000)) setTimeout(cargarPlan, 0); cuerpo = pantallaExec(); }
      else if (execOn() && R.exItems) cuerpo = itemsExec(R.exItems);
      else if (execOn() && R.exOC) cuerpo = ocExec(R.exOC);
      else if (execOn() && R.exFicha) cuerpo = fichaExec(R.exFicha);
      else { if (!esDueno() && (!R.planT || Date.now() - R.planT > 300000)) setTimeout(cargarPlan, 0);
        const pa = portalActivo(); cuerpo = (pa === "ejecuta" ? (tienePlan("medio") ? portalEjecuta() : candado("medio", "🛠 Ejecuta")) : pa === "licita" ? (tienePlan("medio") ? portalLicita() : candado("medio", "📑 Licitaciones")) : pa === "inversion" ? portalInversion() : vistaOport()); }
      const mas = `<details class="rb-ajustes rb-mas"><summary>⚙ Más opciones</summary>
        ${!conectado ? `<div class="rb-alertas"><b>Robot apagado</b>${r?.visto ? "Visto " + esc(hace(r.visto)) + ". " : ""}Revisa 💎 Planes → ☁️ Robot en la nube.</div>` : ""}
        ${mp?.conectado ? "" : `<button class="btn small rb-oro" data-rb="conectar-mp" type="button" style="margin:8px 0">${/nube/i.test(r?.equipo || "") ? "☁️ Falta tu sesión de Mercado Público en la nube · abrir" : "Conectar tu Mercado Público"}</button>`}
        <div class="rb-row" style="margin:8px 0"><input id="rbCod" class="rb-in" placeholder="Preparar por código: 3704-203-COT26" autocomplete="off" autocapitalize="characters"><button class="btn small rb-oro" type="button" data-rb="nuevo">✍</button></div>
        ${!R.push && pushPosible && !(esIOS && !instalada()) ? `<button class="btn small" type="button" data-rb="avisos">🔔 Activar avisos</button>` : ""}
        ${esIOS && !instalada() ? `<button class="btn small" type="button" data-rb="copiar-enlace-app">📲 Copiar enlace para la app del inicio</button>` : `<button class="btn small" type="button" data-rb="copiar-enlace-app">📲 Copiar enlace para otro celular</button>`}
        <button class="btn small" type="button" data-rb="bienvenida">🧭 Instalación para otra persona</button>
        <button class="btn small" type="button" data-rb="exec-toggle">${execOn() ? "◧ Volver al modo clásico" : "◧ Modo ejecutivo (Inicio · Buscar · Biblioteca · Actividad)"}</button>
        <button class="btn small" type="button" data-rb="legado" data-v="${legado() ? "0" : "1"}">🎮 ${legado() ? "Ocultar" : "Ver"} las ofertas de antes (de todos)</button>
        <div class="rb-row" style="margin-top:8px">${VISTAS.filter(([k]) => k !== "oport").map(([k, n]) => `<button type="button" class="btn small" data-rb="vista" data-v="${k}">${n}</button>`).join("")}</div>
        <div class="label" style="margin-top:12px">Firma rápida ${firmaRapida() ? "✓ instalada" : "(recomendado)"}</div>
        <div class="muted" style="font-size:.74rem">iPhone: app gratis <b>Userscripts</b> (App Store) → actívala en Safari → toca <a href="/cotizagil-firma.user.js" target="_blank" rel="noopener">Instalar Firma rápida</a>. PC/Android: extensión <b>Tampermonkey</b> y el mismo enlace.</div>
        <div class="rb-row" style="margin-top:8px"><button class="btn small" type="button" data-rb="copiar-marcador">Copiar marcador «Rellenar» (sin extensión)</button>
          ${R.push ? `<button class="btn small" type="button" data-rb="push-probar">Probar aviso</button>` : ""}<button class="btn small" type="button" data-rb="desenlazar">Desenlazar</button></div>
      </details>`;
      return cab2 + cuerpo + (R.pantalla === "llamada" || R.pantalla === "claude" || R.pantalla === "oc" || R.pantalla === "analizador" || R.empresaEditar || R.rubroEditar || R.personaEditar ? "" : mas) + (execOn() ? navExec() : "");
    }
    return `
      <div class="rb-sheet-head"><h2 style="margin:0">Robot de ofertas</h2><button class="rb-x" type="button" data-rb="cerrar" aria-label="Cerrar">✕</button></div>
      <div class="rb-status ${conectado ? "on" : ""}"><span class="rb-dot"></span>
        <span>${!R.data ? (R.err ? esc(R.err) : '<span class="spinner"></span>') : conectado
          ? `Robot conectado${r.equipo ? " · " + esc(r.equipo) : ""}${r.ocupado && r.tarea ? " · " + esc(r.tarea) : " · libre"}`
          : `Robot apagado${r?.visto ? " · visto " + esc(hace(r.visto)) : ""}. Revisa 💎 Planes → ☁️ Robot en la nube.`}</span></div>
      ${R.data ? (() => { const mp = R.data.mp; return `<div class="rb-status ${mp?.conectado ? "on" : ""}" style="align-items:center"><span class="rb-dot"></span>
        <span style="flex:1">${mp?.conectado ? `Mercado Público conectado${mp.usuario ? " · " + esc(mp.usuario) : ""} · ${esc(hace(mp.visto))}`
          : `Mercado Público desconectado${mp?.visto ? " · visto " + esc(hace(mp.visto)) : ""}`}</span>
        ${mp?.conectado ? "" : `<button class="btn small rb-firmar" data-rb="conectar-mp" type="button">${/nube/i.test(R.data?.robot?.equipo || "") ? "☁️ Iniciar sesión en la nube" : "Conéctate a tu Mercado Público"}</button>`}</div>`; })() : ""}
      <div class="row" style="margin:6px 0 4px">
        <div class="field" style="flex:1;min-width:150px"><input id="rbCod" placeholder="Uno o varios códigos (ej. 3704-203-COT26, 1261-12-COT26)" autocomplete="off" autocapitalize="characters"></div>
        <button class="btn small rb-firmar" type="button" data-rb="nuevo">✍ Preparar</button>
      </div>
      ${(!R.push && pushPosible) || R.instalar || (esIOS && !instalada()) ? `<div class="row" style="margin-top:6px;gap:8px">
        ${!R.push && pushPosible && !(esIOS && !instalada()) ? `<button class="btn small" type="button" data-rb="avisos">🔔 Activar avisos (aunque la app esté cerrada)</button>` : ""}
        ${R.instalar ? `<button class="btn small" type="button" data-rb="instalar">📲 Instalar app</button>` : ""}
        ${esIOS && !instalada() ? `<div class="note" style="margin:0">En iPhone: toca <b>Compartir</b> → <b>Agregar a pantalla de inicio</b>. Desde ahí la app recibe avisos.</div>` : ""}
      </div>` : ""}
      ${lista.length || R.vista === "oport" ? (lista.length && R.vista !== "oport" ? kpis(lista) : "") + `<div class="rb-vistas" role="tablist">${VISTAS.map(([k, n]) =>
        `<button type="button" role="tab" aria-selected="${R.vista === k}" class="${R.vista === k ? "on" : ""}" data-rb="vista" data-v="${k}">${n}</button>`).join("")}</div>` + vista(lista) : ""}
      ${R.data && !lista.length ? `<div class="empty">Aún no hay ofertas. Toca «Hacer oferta» en una Compra Ágil.</div>` : ""}
      ${esIOS && !instalada() ? `<button class="btn rb-oro" type="button" data-rb="copiar-enlace-app" style="width:100%;margin-top:12px">📲 Copiar enlace para la app del inicio</button>` : ""}
      <details class="rb-ajustes"><summary>Ajustes</summary>
        <button class="btn small" type="button" data-rb="copiar-enlace-app" style="margin-top:10px">📲 Copiar enlace para la app del inicio (u otro celular)</button>
        <div class="field" style="margin-top:10px"><label class="muted" for="rbRemoto">Enlace de escritorio remoto (para dar el clic final desde el celular)</label>
          <input id="rbRemoto" value="${esc(leer().remoto || REMOTO_DEF)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        <div class="muted" style="margin-top:6px">Instala <b>Chrome Remote Desktop</b> en el PC y en el celular (gratis). Con «Dar el clic desde aquí» ves la ventana del robot y presionas Enviar tú mismo.</div>
        <div class="label" style="margin-top:14px">Firma rápida ${firmaRapida() ? "✓ instalada en este navegador" : "(recomendado)"}</div>
        <div class="muted">Con esto, «Ir a firmar» abre Mercado Público con los precios, el detalle y el PDF ya cargados, y al terminar el robot confirma solo. Tú solo envías, declaras y firmas.</div>
        <div class="muted" style="margin-top:6px">1) Instala la extensión gratuita <b>Tampermonkey</b> (Opera/Chrome/Edge en el PC; en Android usa Firefox o Edge). 2) Toca <a class="btn small rb-firmar" href="/cotizagil-firma.user.js" target="_blank" rel="noopener">Instalar Firma rápida</a> y confirma «Instalar». 3) Vuelve a abrir esta app una vez.</div>
        <div class="label" style="margin-top:14px">Botón «Rellenar» (alternativa sin extensión)</div>
        <div class="muted"><b>PC:</b> muestra la barra de favoritos (Ctrl+Shift+B) y arrastra este botón: <a class="btn small rb-firmar" href="${esc(marcador())}" data-rb="marcador-arrastrar">Rellenar</a></div>
        <div class="muted" style="margin-top:6px"><b>Celular (Chrome):</b> 1) toca <button class="btn small" type="button" data-rb="copiar-marcador">Copiar marcador</button> 2) toca ⋮ → ☆ para guardar esta página como favorito 3) ⋮ → Favoritos → mantén presionado el nuevo favorito → Editar: nombre <b>Rellenar</b>, y en URL borra todo y pega. Listo: en Mercado Público escribe «Rellenar» en la barra y toca el favorito.</div>
        <div class="row" style="margin-top:10px;gap:8px">
          <button class="btn small" type="button" data-rb="remoto">Guardar enlace</button>
          ${R.push ? `<button class="btn small" type="button" data-rb="push-probar">Probar aviso</button>` : ""}
          <button class="btn small" type="button" data-rb="desenlazar">Desenlazar</button>
        </div>
      </details>`;
  }

  function pintarHoja(forzar) {
    const box = $("#rbIn"); if (!box) return;
    clearTimeout(R.tUI); R.tUI = setTimeout(guardarUI, 500);   // 💾 recuerda dónde estás
    if (R.arrastrando || R.barra || (!forzar && Date.now() - R.toque < 900)) {     // no repintar bajo tu dedo
      clearTimeout(R.tPend); R.tPend = setTimeout(() => pintarHoja(), 700); return;
    }
    const html = !R.token ? pantallaEnlace() : R.conf ? pantallaConfirmar(R.conf) : R.detalle ? pantallaDetalle(R.detalle) : pantallaLista();
    if (html === R.ultimoHtml && box.childElementCount) return;
    R.ultimoHtml = html;
    const y = sheet.scrollTop;
    // el repintado cada pocos segundos no debe cerrar lo que la persona abrió
    const abiertos = new Set($$("details", box).map((d, i) => d.open && (d.closest("[id]")?.id || "") + d.className + i).filter(Boolean));
    const tabX = $(".rb-tablero", box)?.scrollLeft || 0;
    const mplV = $$("input[id^=rbMpl], input[id^=rbCap-]", box).map((i) => [i.id, i.value, document.activeElement === i]);   // 🔐 no borrar lo que escribes (incluye el código del captcha)
    box.innerHTML = html;
    mplV.forEach(([id, v, f]) => { const i = $("#" + id, box); if (i) { i.value = v; if (f) i.focus(); } });
    contar(box);
    $$("details", box).forEach((d, i) => { if (abiertos.has((d.closest("[id]")?.id || "") + d.className + i)) d.open = true; });
    const tab = $(".rb-tablero", box);
    if (tab && !R.tabInit) {            // la primera vez, el tablero se abre en lo que necesita tu clic
      R.tabInit = true;
      const col = $$(".rb-col", tab).find((c, i) => i >= 2 && i <= 3 && $(".rb-caja", c));
      if (col) tab.scrollLeft = col.offsetLeft - tab.offsetLeft - 4;
    } else if (tab) tab.scrollLeft = tabX;
    sheet.scrollTop = y;
    if (R.foco && !R.conf) {
      const el = document.getElementById("rb-" + R.foco);
      if (el) { el.scrollIntoView({ block: "center" }); R.foco = null; }
    }
    // 🧩 apenas aparece el captcha, te lleva ahí y deja el cursor listo para escribirlo
    const cap = box.querySelector('input[id^="rbCap-"]');
    if (cap) { if (R._capFoco !== cap.id) { R._capFoco = cap.id; cap.scrollIntoView({ block: "center" }); setTimeout(() => { try { cap.focus({ preventScroll: true }); } catch {} }, 60); } }
    else R._capFoco = null;
  }

  /* ---------------- acciones ---------------- */
  function pedirOferta(datos, accion = "ofertar") {
    const codigo = String(datos.codigo || "").trim().toUpperCase();
    if (!COD_CA.test(codigo)) { toast("El robot trabaja Compras Ágiles (código …-COT26)"); return; }
    if (!R.token) { abrir(); return; }
    R.conf = { ...datos, codigo, accion, editar: accion === "editar", descuento: leer().descuento ?? 0.08 };
    if (!sheet.classList.contains("on")) { sheet.classList.add("on"); back.classList.add("on"); }
    pintarHoja();
  }

  // uno o varios códigos: con uno se muestra la confirmación; con varios se preparan todos para firmar
  async function nuevos(texto) {
    const cods = [...new Set((String(texto || "").toUpperCase().match(COD_CA_G) || []))];
    if (cods.length <= 1) return pedirOferta({ codigo: cods[0] || texto });
    if (!R.token) { abrir(); return; }
    const descuento = leer().descuento ?? 0.08;
    if (!confirm(`¿Preparar ${cods.length} compras para firmar con ${Math.round(descuento * 100)}% bajo el presupuesto?`)) return;
    let ok = 0;
    for (const codigo of cods) {
      try { const r = await api("pedir", { method: "POST", body: JSON.stringify({ codigo, accion: "firmar", descuento }) }); if (r._status !== 409) ok++; }
      catch (e) { toast(codigo + ": " + e.message); }
    }
    toast(`${ok} de ${cods.length} en cola: el robot las deja listas para firmar`);
    const inp = $("#rbCod"); if (inp) inp.value = "";
    if (!R.push) suscribirPush(true);
    await refrescar();
  }

  async function confirmar(accion) {
    if (R.enCurso) return;
    const c = R.conf; if (!c) return;
    R.enCurso = true;
    $$('[data-rb="confirmar"],[data-rb="probar"]', sheet).forEach((b) => { b.disabled = true; });
    try {
      const r = await api("pedir", { method: "POST", body: JSON.stringify({
        codigo: c.codigo, accion: accion || "firmar", descuento: c.descuento,
        nombre: c.nombre, organismo: c.organismo, monto: c.monto,
      }) });
      if (r._status === 409) toast(r.aviso || "Ya está en manos del robot");
      else toast(accion === "ofertar" ? "Pedido enviado al robot (modo antiguo)" : "El robot la deja lista para firmar");
      R.conf = null; R.foco = c.codigo; if (R.vista !== "lista") R.detalle = c.codigo;
      if (!R.push) suscribirPush(true);
      await refrescar();
    } catch (e) { toast(e.message); }
    finally { R.enCurso = false; pintarHoja(); }
  }

  sheet.addEventListener("click", (ev) => {           // 👆👆 doble toque en la barra de arriba (fuera de un botón) = volver al inicio
    const barra = ev.target.closest(".rb-top2, .rb-portal, .rb-h"); if (!barra || ev.target.closest("button:not(.rb-portal button),a,input,textarea,select")) return;
    const n = Date.now(); if (n - (R._tapT || 0) < 400) { R._tapT = 0; volverAlOrigen(); } else R._tapT = n;
  });
  sheet.addEventListener("toggle", (ev) => { const d = ev.target; if (d?.dataset?.caja) { R.cajaAb = R.cajaAb || {}; R.cajaAb[d.dataset.caja] = d.open; } }, true);
  sheet.addEventListener("dblclick", (ev) => { if (ev.target.closest(".rb-top2, .rb-portal")) { ev.preventDefault(); volverAlOrigen(); } });
  sheet.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-rb]"); if (!b) return;
    R.toque = 0;                                     // un toque en un botón repinta al instante
    const a = b.dataset.rb, cod = b.dataset.c;
    if (a === "cerrar") return cerrar();
    if (a === "volver") { R.conf = null; return pintarHoja(); }
    if (a === "enlazar") { if (enlazar($("#rbTok")?.value)) pintarHoja(true); return; }
    if (a === "pegar-enlace") {
      let t = "";
      try { t = await navigator.clipboard.readText(); } catch {}
      const m = String(t || "").match(/enlazar=([A-Za-z0-9_-]{16,})/) || String(t || "").trim().match(/^([A-Za-z0-9_-]{16,})$/);
      if (!m) { toast("No hay un enlace copiado. Cópialo primero en Safari."); const i = $("#rbTok"); if (i) { i.focus(); } return; }
      if (enlazar(m[1])) pintarHoja(true);
      return;
    }
    if (a === "copiar-enlace-app") {
      const ok = await copiar(location.origin + "/#enlazar=" + R.token);
      toast(ok ? "✓ Copiado. Abre la app del inicio y toca «Pegar enlace y entrar»" : "No se pudo copiar");
      return;
    }
    if (a === "desenlazar") { R.token = null; R.data = null; guardar({ token: null }); return pintarHoja(); }
    if (a === "avisos") { if (await suscribirPush(true)) toast("Avisos activados en este teléfono"); return pintarHoja(); }
    if (a === "push-probar") { try { await api("push-probar", { method: "POST", body: "{}" }); toast("Aviso de prueba enviado"); } catch (e) { toast(e.message); } return; }
    if (a === "instalar") { const p = R.instalar; R.instalar = null; try { await p?.prompt(); } catch {} return pintarHoja(); }
    if (a === "vista") { R.vista = b.dataset.v; guardar({ vista: R.vista, v_cajas: 1 }); if (R.vista === "oport") R.oport = null; return pintarHoja(); }
    if (a === "rubro-t") {                      // ⚡ al instante: solo cambia el botón y el contador (sin repintar toda la pantalla)
      const set = new Set(R.rubrosTmp || leer().rubros || []); const r = b.dataset.r; set.has(r) ? set.delete(r) : set.add(r);
      R.rubrosTmp = [...set]; R.palabrasTmp = $("#rbPalabras")?.value ?? R.palabrasTmp;
      b.classList.toggle("on", set.has(r)); navigator.vibrate?.(8);
      const ws = String(R.palabrasTmp || "").split(/[,;\n]+/).map(norm).filter((w) => w.length > 2);
      const n = (R.oport?.lista || []).filter((x) => Date.parse(x.cierre) - Date.now() > 30 * 60000 && (set.has(x.rubro) || (ws.length && ws.some((w) => norm(x.nombre).includes(w))))).length;
      const ok = $('[data-rb="rubro-ok"]', sheet); if (ok) ok.innerHTML = `🔎 Buscar mis oportunidades${set.size || ws.length ? ` · <b data-rb-n>${n}</b> vigentes` : ""}`;
      return;
    }
    if (a === "rubro-editar") { R.rubroEditar = true; R.rubrosTmp = null; R.palabrasTmp = null; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "rubro-ok" || a === "rubro-todo") {
      const todo = a === "rubro-todo";
      guardar({ rubroListo: 1, rubros: todo ? [] : (R.rubrosTmp || leer().rubros || []), palabras: todo ? "" : ($("#rbPalabras")?.value || "").trim() });
      R.rubroEditar = false; R.rubrosTmp = null; R.palabrasTmp = null; R.oportFiltro = todo ? "todas" : "real"; R.oportTab = "nuevas"; sheet.scrollTop = 0;
      api("oportunidades-actualizar", { method: "POST", body: "{}" }).catch(() => {});      // el PC baja lo más nuevo del portal
      toast(todo ? "Mostrando todas las oportunidades" : "🔎 Buscando oportunidades de tu rubro…");
      return pintarHoja(true);
    }
    if (a === "oport-q-borrar") { R.oportQ = ""; R.oportN = 40; pintarHoja(true); return; }
    if (a === "oport-filtro") { R.oportFiltro = b.dataset.f; R.oportN = 40; return pintarHoja(); }
    if (a === "oport-tab") { if ((R.oportTab || "nuevas") !== b.dataset.t) R.tabHist = [...(R.tabHist || []), R.oportTab || "nuevas"].slice(-12); R.oportTab = b.dataset.t; guardar({ oportTab: R.oportTab }); R.oportN = 40; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "oport-mas") { R.oportN = (R.oportN || 40) + 40; return pintarHoja(); }
    if (a === "oport-sel") { if (esSel(cod)) await quitarSel(cod); else { toast("⭐ A Seleccionadas"); await ponerSel(cod); } return pintarHoja(); }
    if (a === "sel-quitar") { await quitarSel(cod); toast("↩ De vuelta en Por preparar"); return pintarHoja(); }
    if (a === "seg-actualizar") { toast("Consultando Mercado Público…"); return cargarSeg(true); }
    if (a === "neg-tab") { R.netapa = b.dataset.e; return pintarHoja(); }
    if (a === "neg-etapa" || a === "neg-opcion" || a === "neg-informe") {
      const cuerpo = { codigo: cod, dispositivo: dispositivo(false) };
      if (a === "neg-etapa") cuerpo.etapa = b.dataset.e;
      if (a === "neg-opcion") { cuerpo.datos = { opcion: +b.dataset.k }; cuerpo.pedir_informe = true; }
      if (a === "neg-informe") cuerpo.pedir_informe = true;
      try { await api("operacion", { method: "POST", body: JSON.stringify(cuerpo) });
        if (a === "neg-etapa") { R.netapa = b.dataset.e; toast("✓ Avanzó a " + (b.textContent.split("→")[1] || b.dataset.e).trim());
          const auto = { pago: ["Pagar al proveedor · " + cod, 1440], documentos: ["Emitir guía y factura en el SII · " + cod, 240], despacho: ["Confirmar despacho y guía firmada · " + cod, 1440], entrega: ["Subir foto de la entrega · " + cod, 1440] }[b.dataset.e];
          if (auto) api("recordar", { method: "POST", body: JSON.stringify({ codigo: cod, texto: auto[0], minutos: auto[1] }) }).catch(() => {}); }
        else toast("El PC recalcula el informe (1–2 min)");
        await refrescar(); pintarHoja(); } catch (e) { toast(e.message); }
      return;
    }
    if (a === "desglose-mail" || a === "desglose-copiar") {
      const t = trabajoG(cod); if (!t) return;
      const txt = desgloseTexto(t); try { await navigator.clipboard.writeText(txt); } catch (e) {}
      if (a === "desglose-copiar") { toast("📋 Desglose copiado"); return; }
      const mail = t.oc_compra?.mail || t.op?.informe?.comprador?.email || "";
      location.href = `mailto:${encodeURIComponent(mail)}?subject=${encodeURIComponent("Desglose cotización " + cod)}&body=${encodeURIComponent(txt)}`;
      toast("✉ Correo listo con el desglose (también copiado)"); return;
    }
    if (a === "informe-link") {
      const id = b.dataset.id || "gensa"; toast("Pidiendo el link…");
      try { const r = await api("informe-link?id=" + encodeURIComponent(id)); if (!r || !r.url) { toast("No pude obtener el link"); return; }
        const n = Object.values(r.resp || {}), si = n.filter((x) => x.decision === "si").length, no = n.filter((x) => x.decision === "no").length;
        try { await navigator.clipboard.writeText(r.url); } catch (e) {}
        if (navigator.share) { try { await navigator.share({ title: "Socios de Crecimiento · Informe " + id.toUpperCase(), url: r.url }); } catch (e) {} }
        toast(`📋 Link copiado · respuestas: ${si} sí · ${no} no`);
      } catch (e) { toast("No pude obtener el link"); } return;
    }
    if (a === "inv-pdf") {
      const t = trabajoG(cod) || (R.anl && { codigo: cod }); if (!t) { toast("No encuentro esa compra"); return; }
      let tt = t; if ((!t || !calcNeg(t).compras) && R.anl && (cod === "Proyecto" || R.anl.prod === cod)) tt = anlT(anlLineas());
      const X = calcNeg(tt); if (!X.compras) { toast("Falta el precio de compra para armar la presentación"); return; }
      const w = window.open("", "_blank"); if (!w) { toast("Permite ventanas emergentes para abrir el PDF"); return; }
      w.document.open(); w.document.write(presentacionInv(tt, X)); w.document.close(); return;
    }
    if (a === "neg-archivo" || a === "neg-doc") {
      const w = window.open("", "_blank");
      try { const r = await api(`archivo?codigo=${encodeURIComponent(cod)}&tipo=${a === "neg-doc" ? "doc&id=" + encodeURIComponent(b.dataset.id) : b.dataset.t}`);
        const u = URL.createObjectURL(await r.blob()); if (w) w.location = u; else location.href = u; } catch (e) { w?.close(); toast(e.message); }
      return;
    }
    if (a === "neg-subir") {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = b.dataset.tipo === "foto" ? "image/*" : "image/*,application/pdf";
      if (b.dataset.tipo === "foto") inp.setAttribute("capture", "environment");
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        toast("Subiendo…");
        try {
          const b64 = await achicar(f);
          await api("subir", { method: "POST", body: JSON.stringify({ codigo: cod, tipo: b.dataset.tipo, nombre: f.name, mime: b64.mime, b64: b64.data, cerrar: !!b.dataset.cerrar, dispositivo: dispositivo(false) }) });
          if (b.dataset.cerrar) { R.netapa = "cerrado"; R.ejTab = "cerrado"; toast("🥇 ¡Negocio cerrado en oro!"); } else toast("✓ Archivo guardado");
          if (leer().portal === "ejecuta") { R.ejecT = 0; cargarEjecuta(); } else { await refrescar(); pintarHoja(); }
        } catch (e) { toast(e.message); }
      };
      inp.click();
      return;
    }
    if (a === "comprobante") {
      const w = window.open("", "_blank");
      try { const r = await api("comprobante?codigo=" + encodeURIComponent(cod)); const u = URL.createObjectURL(await r.blob()); if (w) w.location = u; else location.href = u; }
      catch (e) { w?.close(); toast(e.message); }
      return;
    }
    if (a === "portal") { guardar({ portal: b.dataset.v }); R.pantalla = null; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "ej-tab") { R.ejTab = b.dataset.e; return pintarHoja(true); }
    if (a === "consolidar") { R.consCerr = !R.consCerr; return pintarHoja(true); }
    if (a === "cons-dias") { R.consDias = +b.dataset.d || 5; R.consCerr = true; return pintarHoja(true); }
    if (a === "cons-csv") {
      const L = R.ejec || [], dias = +b.dataset.d || 5, items = cerradosPeriodo(L, dias);
      const fila = (t) => { const k = cuentasDe(t), inf = t.op?.informe || {}; return [t.op?.oc_codigo || t.op?.oc || "", t.codigo, (t.oc_compra?.organismo || t.organismo || "").replace(/;/g, ","), t.op?.cerrado ? new Date(t.op.cerrado).toLocaleDateString("es-CL") : "", k.ventaN, netoDe(k.compra), k.flete, k.bruta, Math.round(inf.inversionista || 0), Math.round(inf.comision || 0), Math.round(inf.julfior || 0), Math.round(inf.impuesto || 0), Math.round(inf.factoring || 0), Math.round(inf.final || 0)].join(";"); };
      const csv = "﻿OC;Compra Ágil;Cliente;Cerrado;Venta neta;Compra neta;Flete;Margen bruto;Inversionista;Comisión;Gestión;Impuesto;Factoring;Utilidad final\n" + items.map(fila).join("\n");
      const u = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const x = document.createElement("a"); x.href = u; x.download = "consolidado_" + dias + "dias.csv"; x.click(); return;
    }
    const ejOp = async (datos, etapa, msg) => {
      try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, datos, ...(etapa ? { etapa } : {}), dispositivo: dispositivo(false) }) });
        if (msg) toast(msg); if (etapa) R.ejTab = etapa; R.ejecT = 0; await cargarEjecuta(); pintarHoja(true); } catch (e) { toast(e.message); }
    };
    if (a === "ej-factura") return ejOp({ sin_factura: b.dataset.f === "0" }, null, b.dataset.f === "0" ? "🚫 Compra SIN factura · no baja el IVA" : "🧾 Compra CON factura · baja el IVA");
    if (a === "chat-envie" || a === "chat-pegar" || a === "mk-add") {
      const chatApi = async (x, msg) => { try { const r = await api("chat", { method: "POST", body: JSON.stringify({ codigo: cod, ...x }) }); if (msg) toast(r.enviado ? "🤖 Enviado por WhatsApp" : msg); R.ejecT = 0; await cargarEjecuta(); pintarHoja(true); } catch (e) { toast(e.message); } };
      if (a === "chat-envie") { if (b.dataset.canal === "mk") copiar(b.dataset.v); navigator.vibrate?.(10);
        setTimeout(() => chatApi({ k: b.dataset.k, nombre: b.dataset.n, canal: b.dataset.canal, tel: b.dataset.tel, saliente: b.dataset.v, manual: true }, b.dataset.canal === "mk" ? "📋 Copiado: pégalo en el chat del vendedor" : "💬 Anotado"), 400); return; }
      if (a === "chat-pegar") { const v = ($("#rbChat-" + cod + "-" + b.dataset.k)?.value || "").trim(); if (!v) { toast("Pega primero lo que te respondió"); return; }
        return chatApi({ k: b.dataset.k, nombre: b.dataset.n, canal: b.dataset.canal, tel: b.dataset.tel, entrante: v }, "🤖 La IA lo está leyendo…"); }
      const n = ($("#rbMkN-" + cod)?.value || "").trim(); if (!n) { toast("Escribe el nombre del vendedor"); return; }
      return chatApi({ k: kProv(n), nombre: n, canal: "mk", link: ($("#rbMkL-" + cod)?.value || "").trim() }, "🛒 Vendedor agregado · mensaje listo");
    }
    if (a === "ej-contacto") {          // el enlace abre el correo / la llamada / WhatsApp; aquí se anota el punto de la misión
      const t = (R.ejec || []).find((x) => x.codigo === cod);
      if (t) { t.op = t.op || {}; t.op.contactados = { ...(t.op.contactados || {}), [b.dataset.k]: { via: b.dataset.via, t: new Date().toISOString(), nombre: b.dataset.n } }; }
      navigator.vibrate?.(10);
      if (b.dataset.via === "whatsapp") { const tt = (R.ejec || []).find((x) => x.codigo === cod), oo = tt && candsDe(tt).find((x) => x.k === b.dataset.k);
        if (tt && oo) api("chat", { method: "POST", body: JSON.stringify({ codigo: cod, k: oo.k, nombre: oo.proveedor, canal: "wa", tel: oo.telefono, saliente: cuerpoCot(tt, oo), manual: true }) }).catch(() => {}); }
      setTimeout(() => ejOp({ contactado: { k: b.dataset.k, via: b.dataset.via, nombre: b.dataset.n } }, null, b.dataset.via === "correo" ? "✉ +1 · correo listo para enviar" : "+1 a la misión"), 400);
      return;
    }
    const tEj = () => (R.ejec || []).find((x) => x.codigo === cod);
    if (a === "ej-ver") { R.ejAbierto = cod; R.ejModo = null; sheet.scrollTop = 0; { const tt = (R.ejec || []).find((x) => x.codigo === cod); if (tt) R.ejTab = etEj(tt); } const l = leerLuego(); delete l[cod]; try { localStorage.setItem(EJ_LUEGO, JSON.stringify(l)); } catch {}
      api("correo-visto", { method: "POST", body: JSON.stringify({ codigo: cod }) }).catch(() => {}); return pintarHoja(true); }
    if (a === "ej-luego") { const l = leerLuego(); l[cod] = Date.now(); try { localStorage.setItem(EJ_LUEGO, JSON.stringify(l)); } catch {} if (R.ejAbierto === cod) R.ejAbierto = null; toast("⏰ Queda para después"); return pintarHoja(true); }
    if (a === "ej-rechazar") {   // ✖ no dio: abre Mercado Público para que el dueño rechace la OC ahí (acto legal, no lo hace el robot)
      const oc = b.dataset.oc, url = oc ? `https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=${encodeURIComponent(oc)}` : portalDe(cod);
      try { window.open(url, "_blank", "noopener"); } catch { location.href = url; }
      toast("🧑 Abriendo Mercado Público: rechaza la OC ahí mismo (es tu decisión)"); return; }
    if (a === "ej-cerrar-card") { R.ejAbierto = null; return pintarHoja(true); }
    if (a === "ej-modo") { R.ejModo = b.dataset.m || null; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "ej-mail") { const t = tEj(), o = t && candsDe(t).find((x) => x.k === b.dataset.k); if (!o) return;
      return enviarCorreos(cod, [{ to: o.email, asunto: `Cotización con factura · ${t.nombre || cod}`, cuerpo: cuerpoCot(t, o), k: o.k, nombre: o.proveedor, tipo: "cotizacion" }]); }
    if (a === "ej-mail-todos") { const t = tEj(); if (!t) return; const cont = t.op?.contactados || {};
      return enviarCorreos(cod, candsDe(t).filter((o) => o.email && !cont[o.k]).slice(0, 6).map((o) => ({ to: o.email, asunto: `Cotización con factura · ${t.nombre || cod}`, cuerpo: cuerpoCot(t, o), k: o.k, nombre: o.proveedor, tipo: "cotizacion" }))); }
    if (a === "ej-mail-tipo") { const t = tEj(); if (!t) return; return enviarCorreos(cod, [correoTipo(t, b.dataset.tipo)]); }
    if (a === "ej-cerre") { const t = tEj(); if (!t) return; const o = candsDe(t).find((x) => x.k === b.dataset.k) || {}, op = t.op || {};
      const q = (op.cotizaciones || {})[b.dataset.k], r = (op.respuestas || []).filter((x) => x.k === b.dataset.k && x.precio).pop();
      const v = q?.v || (r ? (r.incluye_iva ? r.precio : Math.round(r.precio * 1.19)) : null);
      if (!v) { toast("Anota primero el precio que te dio"); return; }
      const banco = r?.cuenta ? [r.cuenta.banco, r.cuenta.tipo, r.cuenta.numero, r.cuenta.rut && "RUT " + r.cuenta.rut, r.cuenta.titular, r.cuenta.email].filter(Boolean).join(" · ") : "";
      // 🤝 ACUMULA: varios proveedores pueden sumar en la misma misión (no reemplaza, suma)
      const cerr = { ...(op.cerrados || {}) };
      cerr[b.dataset.k] = { proveedor: o.proveedor || q?.nombre || "Proveedor", k: b.dataset.k, email: o.email || "", tel: o.telefono || "", precio: v, banco };
      const ks = Object.keys(cerr), total = ks.reduce((s, kk) => s + (Number(cerr[kk].precio) || 0), 0);
      const nombres = ks.map((kk) => cerr[kk].proveedor).join(" + ");
      const bancos = ks.map((kk) => cerr[kk].banco ? cerr[kk].proveedor + ": " + cerr[kk].banco : "").filter(Boolean).join("\n");
      R.ejAbierto = cod;
      return ejOp({ cerrados: cerr, proveedor: nombres, proveedor_k: ks[0], proveedor_email: cerr[ks[0]].email, proveedor_tel: cerr[ks[0]].tel, precio_acordado: total,
        ...(bancos ? { banco_proveedor: bancos } : {}), ...(r?.despacha ? { despacho_modo: "proveedor" } : {}) }, null,
        ks.length > 1 ? `🤝 ${ks.length} proveedores · suman ${clp(total)}` : "🤝 Cerraste con " + (o.proveedor || "proveedor").split(" ")[0]); }
    if (a === "ej-descerrar") { const t = tEj(); if (!t) return; const op = t.op || {};
      const cerr = { ...(op.cerrados || {}) }; delete cerr[b.dataset.k];
      const ks = Object.keys(cerr), total = ks.reduce((s, kk) => s + (Number(cerr[kk].precio) || 0), 0);
      const nombres = ks.map((kk) => cerr[kk].proveedor).join(" + ");
      const bancos = ks.map((kk) => cerr[kk].banco ? cerr[kk].proveedor + ": " + cerr[kk].banco : "").filter(Boolean).join("\n");
      R.ejAbierto = cod;
      return ejOp({ cerrados: cerr, proveedor: nombres, proveedor_k: ks[0] || "", precio_acordado: total || null, banco_proveedor: bancos }, null, "Quitado de la misión"); }
    if (a === "ej-descartar") return ejOp({ descartar_k: b.dataset.k }, null, "Descartado");
    if (a === "ej-modo") return ejOp({ despacho_modo: b.dataset.m }, null, null);
    if (a === "ej-fact-guardar") { const L = ($("#rbFactorings")?.value || "").split(/\n+/).map((l) => l.split("|").map((x) => x.trim())).filter((x) => x[0] && /@/.test(x[1] || "")).map(([nombre, email]) => ({ nombre, email }));
      try { localStorage.setItem(FACT, JSON.stringify(L)); } catch {} toast(`💰 ${L.length} factoring guardados`); return pintarHoja(true); }
    if (a === "ej-factoring") { const t = tEj(); if (!t) return; const F = factorings(); if (!F.length) { R.libroEj = true; toast("Agrega los factorings en 📒 Libro y caja"); return pintarHoja(true); }
      const op = t.op || {}, e = empresaActual() || {};
      const cuerpo = `Hola,

Somos ${e.razon_social || ""}${e.rut ? " (RUT " + e.rut + ")" : ""}. Queremos una simulación de factoring para esta factura al Estado:
• Deudor: ${t.oc_compra?.organismo || t.organismo || ""}${t.oc_compra?.rut_organismo ? " · RUT " + t.oc_compra.rut_organismo : ""}
• Orden de compra: ${op.oc_codigo || ""} (Compra Ágil ${t.codigo})
• Monto factura: ${clp(cuentasDe(t).venta)} con IVA${op.folio_factura ? "\n• Factura N° " + op.folio_factura : ""}
• Recepción conforme: ${op.recibio_nombre ? "sí, firmada por " + op.recibio_nombre : "sí"}

¿Nos indican tasa, comisión, porcentaje anticipado, gastos y el monto líquido a recibir?${firmaMail()}`;
      return enviarCorreos(cod, F.slice(0, 6).map((f) => ({ to: f.email, asunto: `Simulación factoring · ${clp(cuentasDe(t).venta)} · ${t.oc_compra?.organismo || t.organismo || ""}`, cuerpo, k: "fact-" + kProv(f.nombre), nombre: f.nombre, tipo: "factoring" }))); }
    if (a === "env-ejecutar") { try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, etapa: b.dataset.e || "previa", pedir_informe: true, dispositivo: dispositivo(false) }) });
        guardar({ portal: "ejecuta" }); R.ejTab = "operacion"; R.ejAbierto = cod; R.ejecT = 0; toast("🛠 Pasó a Ejecuta · el robot busca proveedores"); await cargarEjecuta(); return pintarHoja(true); } catch (e) { toast(e.message); return; } }
    if (a === "env-preguntar") { R.pantalla = "llamada"; R.llamada = { texto: "" }; confirmarLlamada(cod);
      preguntarRobot("¿Qué pasa con esta cotización? ¿Vamos primeros o somos proveedor seleccionado? Si sale la orden de compra, ¿cómo actuamos antes de ejecutar?", null, cod); return; }
    if (a === "mail-ver") { R.pantalla = "correos"; api("correo-visto", { method: "POST", body: "{}" }).catch(() => {}); (R.mailAl || []).forEach((x) => (x.visto = true)); return pintarHoja(true); }
    if (a === "mail-abrir") { R.pantalla = null; guardar({ portal: "ejecuta" }); R.ejAbierto = cod; const t = (R.ejec || []).find((x) => x.codigo === cod); if (t) R.ejTab = etEj(t); return pintarHoja(true); }
    if (a === "ej-prov-extra") {
      const n = ($("#rbPxN-" + cod)?.value || "").trim(); if (!n) { toast("Escribe el nombre del proveedor"); return; }
      return ejOp({ proveedor_extra: { proveedor: n, telefono: ($("#rbPxT-" + cod)?.value || "").trim(), email: ($("#rbPxE-" + cod)?.value || "").trim() } }, null, "➕ Agregado a la misión");
    }
    if (a === "ej-elegir") return ejOp({ proveedor: b.dataset.n, precio_acordado: +b.dataset.v }, "transporte", "🏆 Proveedor elegido · ahora el transporte");
    if (a === "ej-pedir-pago") {
      const t = (R.ejec || []).find((x) => x.codigo === cod) || {}, op = t.op || {};
      const txt = `💸 Transferencia negocio ${cod} (${t.nombre || ""})\nProveedor: ${op.proveedor || ""} · ${clp(op.precio_acordado)}\nDatos: ${op.banco_proveedor || "(pedir al proveedor)"}\nFlete: ${op.transportista || ""} · ${clp(op.costo_transporte)}\nTotal a transferir: ${clp((+op.precio_acordado || 0) + (+op.costo_transporte || 0))}`;
      window.open("https://wa.me/" + (waNum(op.inversionista_tel) || "") + "?text=" + encodeURIComponent(txt), "_blank");
      return ejOp({ pedido_transferencia: true }, null, "💸 Pedido al inversionista");
    }
    if (a === "ej-doc") { const t = (R.ejec || []).find((x) => x.codigo === cod); if (t) docNegocio(t, b.dataset.t); return; }
    if (a === "ej-csv") {
      const L = R.ejec || [];
      const fila = (t) => { const k = cuentasDe(t), op = t.op || {}; return [op.oc_codigo || op.oc || "", t.codigo, (t.oc_compra?.organismo || t.organismo || "").replace(/;/g, ","), etEj(t), k.ventaN, k.ivaD, k.venta, op.proveedor || "", netoDe(k.compra), k.ivaC, k.compra, k.flete, k.bruta, op.cobrado ? "sí" : "no"].join(";"); };
      const csv = "\ufeffOC;Compra Ágil;Cliente;Etapa;Venta neta;IVA débito;Venta total;Proveedor;Compra neta;IVA crédito;Compra total;Flete;Utilidad bruta;Cobrado\n" + L.map(fila).join("\n");
      const u = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const x = document.createElement("a"); x.href = u; x.download = "libro_negocios.csv"; x.click(); return;
    }
    if (a === "ej-registro") {
      const nombre = ($("#rbEjNom")?.value || "").trim(); if (!nombre) { toast("Escribe tu nombre"); return; }
      try { const r = await api("ejecutor", { method: "POST", body: JSON.stringify({ id: miJug(), nombre, telefono: ($("#rbEjTel")?.value || "").trim() }) }); R.ejecutores = r.ejecutores; localStorage.setItem("sdc:dispositivo", nombre); toast("🛠 Listo, " + nombre); } catch (e) { toast(e.message); }
      return pintarHoja(true);
    }
    if (a === "ej-transferir" || a === "ej-etapa") {
      const datos = a === "ej-transferir" ? { pedido_transferencia: true } : b.dataset.d ? { [b.dataset.d]: true } : {};
      if (a === "ej-transferir") { const t = (R.ejec || []).find((x) => x.codigo === cod); if (!t?.op?.precio_acordado) { toast("Primero escribe el precio de compra"); return; } }
      try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, etapa: a === "ej-transferir" ? "pago" : b.dataset.e, datos, dispositivo: dispositivo(false) }) });
        R.ejTab = a === "ej-transferir" ? "pago" : b.dataset.e; toast(a === "ej-transferir" ? "💸 Pedido al inversionista" : "✓ Avanzó"); R.ejecT = 0; cargarEjecuta(); } catch (e) { toast(e.message); }
      return;
    }
    if (a === "neg-ejecutor") {
      const id = b.dataset.id;
      if (id === miJug() && !(R.ejecutores || {})[id]) { try { R.ejecutores = (await api("ejecutor", { method: "POST", body: JSON.stringify({ id, nombre: dispositivo(true) }) })).ejecutores; } catch {} }
      const e = (R.ejecutores || {})[id];
      try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, datos: { ejecutor: id, ejecutor_nombre: e?.nombre || "" } }) });
        toast("👷 Asignado a " + (e?.nombre || "ti")); await refrescar();
        if (e?.telefono && id !== miJug()) { const tr = trabajo(cod) || {}; const n = String(e.telefono).replace(/\D/g, "").replace(/^9(\d{8})$/, "569$1");
          window.open(`https://wa.me/${n}?text=${encodeURIComponent(`Hola ${e.nombre}, te asigné el negocio ${cod} (${tr.nombre || ""}) por ${clp(tr.total)}. Ábrelo en la app → 🛠 Ejecuta: ${location.origin}/#robot`)}`, "_blank"); }
        pintarHoja(true); } catch (er) { toast(er.message); }
      return;
    }
    if (a === "legado") { guardar({ legado: b.dataset.v === "1" }); R.ver = null; R.sel = null; R._selPedido = false; R.oport = null; toast(b.dataset.v === "1" ? "Este celular ve también lo anterior" : "🎮 Juego nuevo en este celular"); refrescar(); return pintarHoja(true); }
    if (a === "llamada") { R.pantalla = "llamada"; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "claude") { R.pantalla = "claude"; R.chat = R.chat || cargarChat(); if (cod) R.chat.codigo = cod; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "claude-cerrar") { R.pantalla = null; return pintarHoja(true); }
    if (a === "claude-limpiar") { R.chat = { mensajes: [], codigo: null }; guardarChat(); return pintarHoja(true); }
    if (a === "claude-enviar") { const el = $("#rbChatIn"); const txt = (el?.value || "").trim(); if (!txt) return; el.value = ""; return enviarClaude(txt); }
    if (a === "claude-sug") { return enviarClaude(b.dataset.q || ""); }
    if (a === "claude-mic") { return dictarClaude(); }
    if (a === "llamada-cod") { R.pantalla = "llamada"; R.llamada = { texto: "Me están llamando por la compra " + b.dataset.c }; sheet.scrollTop = 0; confirmarLlamada(b.dataset.c); return pintarHoja(true); }
    if (a === "llamada-cerrar") { R.pantalla = null; return pintarHoja(true); }
    if (a === "anl-agregar") { anlLineas().lineas.push({ prod: "", cant: 0, compra: 0, venta: 0 }); pintarHoja(true); setTimeout(() => { const ins = sheet.querySelectorAll(".anl-linea .anl-in[data-anl=prod]"); ins[ins.length - 1]?.focus(); }, 50); return; }
    if (a === "anl-quitar") { const L = anlLineas().lineas; L.splice(+b.dataset.i, 1); if (!L.length) L.push({ prod: "", cant: 0, compra: 0, venta: 0 }); return pintarHoja(true); }
    if (a === "anl-limpiar") { R.anl = { prod: "", lineas: [{ prod: "", cant: 0, compra: 0, venta: 0 }] }; return pintarHoja(true); }
    if (a === "analizador") { R.pantalla = "analizador"; R.anl = R.anl || { prod: "", cant: 0, compra: 0, venta: 0 }; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "prop-wa") { const msg = ($("#rbProp")?.value || "").trim(); if (!msg) { toast("Escribe la propuesta"); return; }
      const tel = waNum(($("#rbPropTel")?.value || "").trim());
      window.open(tel ? `https://wa.me/${tel}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank"); return; }
    if (a === "prop-mail") { const msg = ($("#rbProp")?.value || "").trim(); const mail = ($("#rbPropMail")?.value || "").trim();
      location.href = `mailto:${encodeURIComponent(mail)}?subject=${encodeURIComponent("Propuesta comercial")}&body=${encodeURIComponent(msg)}`; return; }
    if (a === "prop-cp") { const msg = ($("#rbProp")?.value || "").trim(); if (msg) { copiar(msg); toast("📋 Propuesta copiada"); } return; }
    if (a === "llamada-preguntar") return preguntarRobot(($("#rbLlamada")?.value || "").trim());
    if (a === "llamada-buscar") return buscarLlamada(($("#rbLlamada")?.value || "").trim());
    if (a === "llamada-mic") return dictar();
    if (a === "planes") { R.pantalla = "planes"; sheet.scrollTop = 0; cargarPlan(); return pintarHoja(true); }
    if (a === "planes-cerrar") { R.pantalla = null; return pintarHoja(true); }
    if (a === "plan-pedir") { const k = b.dataset.v, link = (R.planLinks || {})[k];
      try { const r = await api("plan", { method: "POST", body: JSON.stringify({ jugador: miJug(), plan: k, nombre: persona()?.nombre || "", telefono: persona()?.telefono || "" }) }); R.plan = r.plan; } catch (e) { toast(e.message); return; }
      if (link) window.open(link, "_blank"); else toast("💎 Plan pedido: te contactamos para el pago y se activa al confirmarlo");
      return pintarHoja(true); }
    if (a === "rep-nomina" || a === "rep-copiar") { const t = (R.ejec || []).find((x) => x.codigo === cod); if (!t) return;
      if (a === "rep-copiar") { const ok = await copiar(nominaTexto(t)); toast(ok ? "📋 Transferencias copiadas" : "No se pudo copiar"); return; }
      const url = URL.createObjectURL(new Blob([nominaTexto(t, true)], { type: "text/csv;charset=utf-8" })), el = document.createElement("a");
      el.href = url; el.download = `Nomina_${cod}.csv`; document.body.append(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); toast("⬇ Nómina descargada"); return; }
    if (a === "inv-descartar") { const n = (() => { try { return JSON.parse(localStorage.getItem("sdc:invno")) || {}; } catch { return {}; } })(); n[cod] = Date.now(); try { localStorage.setItem("sdc:invno", JSON.stringify(n)); } catch {} toast("Quitada de tus oportunidades"); return pintarHoja(true); }
    if (a === "inv-transferi") return ejOpVivo(cod, { transferido: true }, "✅ Inversión registrada: la empresa paga al proveedor");
    if (a === "broker-nuevo") { R.brokerForm = true; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "broker-cancelar") { R.brokerForm = false; return pintarHoja(true); }
    if (a === "broker-add") { const nom = ($("#rbBkNom")?.value || "").trim(), tel = ($("#rbBkTel")?.value || "").trim(); if (!nom) { toast("Falta el nombre"); return; } const Lb = brokers(); if (!Lb.some((x) => (x.nombre || "").toLowerCase() === nom.toLowerCase())) Lb.push({ nombre: nom, tel }); try { localStorage.setItem(BROK, JSON.stringify(Lb)); } catch {} R.brokerForm = false; toast("👥 Inversionista guardado: " + nom); return pintarHoja(true); }
    if (a === "inv-enviar") { const t = (R.ejec || []).find((x) => x.codigo === cod); if (!t) return; const X = calcNeg(t); const msg = msgOportunidad(t, X); const n = waNum(b.dataset.tel); window.open(n ? `https://wa.me/${n}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank"); toast("📲 Oportunidad enviada a " + (b.dataset.nom || "inversionista")); return; }
    if (a === "saldo-cargar") { R.saldoForm = "cargar"; return pintarHoja(true); }
    if (a === "saldo-webpay") {
      const v = Math.round(Number(($("#rbSaldoMonto")?.value || "").replace(/\D/g, "")) || 0);
      if (v < 50) { toast("Pon un monto (mínimo $50)"); return; }
      toast("Abriendo WebPay…");
      try { const r = await api("webpay-crear", { method: "POST", body: JSON.stringify({ monto: v, jugador: miJug() }) });
        if (r && r.url && r.token) irWebpay(r.url, r.token); else toast(r?.error || "WebPay no disponible ahora"); }
      catch (e) { toast(e.message); }
      return;
    }
    if (a === "saldo-simular") {   // 🧪 modo prueba: carga el saldo al tiro, sin pasar por WebPay
      const v = Math.round(Number(($("#rbSaldoMonto")?.value || "").replace(/\D/g, "")) || 0);
      if (v < 50) { toast("Pon un monto (mínimo $50)"); return; }
      setSaldo(saldoInv() + v); guardar({ portal: "inversion" }); R.saldoForm = null; R.saldoPrefill = 0;
      toast("🧪 Carga simulada: +" + clp(v) + " a tu saldo"); return pintarHoja(true);
    }
    if (a === "saldo-retirar") { R.saldoForm = "retirar"; return pintarHoja(true); }
    if (a === "saldo-cancelar") { R.saldoForm = null; R.saldoPrefill = 0; return pintarHoja(true); }
    if (a === "inv-entrar") { const u = ($("#rbInvUsr")?.value || "").trim(); if (!u) { toast("Pon tu usuario"); return; } try { localStorage.setItem(INVSES, JSON.stringify({ usuario: u, t: Date.now() })); } catch {} toast("Bienvenido, " + u); return pintarHoja(true); }
    if (a === "inv-salir") { try { localStorage.removeItem(INVSES); } catch {} R.invVer = null; R.invEmpSel = null; return pintarHoja(true); }
    if (a === "inv-empresa") { R.invEmpSel = b.dataset.e; R.invVer = null; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "inv-cambiar-emp") { R.invEmpSel = null; R.invVer = null; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "inv-ver") { R.invVer = cod; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "inv-volver") { R.invVer = null; return pintarHoja(true); }
    if (a === "inv-cargar-op") { R.saldoForm = "cargar"; R.saldoPrefill = Number(b.dataset.m) || 0; R.invVer = null; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "inv-avanzar") { const L2 = inversiones(); const e = L2.find((x) => x.id === b.dataset.id); if (e) { e.paso = Math.min(2, Math.max(pasoDe(e.codigo), e.paso || 0) + 1); setInversiones(L2); } return pintarHoja(true); }
    if (a === "inv-ejecutar") { guardar({ portal: "ejecuta" }); R.invVer = null; R.ejAbierto = cod; R.ejModo = null; const t = (R.ejec || []).find((x) => x.codigo === cod); if (t) R.ejTab = etEj(t); R.ejecT = 0; sheet.scrollTop = 0; toast("🛠 Vamos a ejecutar este negocio"); return pintarHoja(true); }
    if (a === "inv-poner") { const tr = (R.ejec || []).find((x) => x.codigo === cod); if (!tr) return; const X = calcNeg(tr); const cap = Math.round(X.capital); if (!cap) { toast("Este negocio aún no tiene monto"); return; } const d = saldoInv(); if (cap > d) { toast("Te falta saldo. Carga primero con ➕ Cargar."); return; } setSaldo(d - cap); const L2 = inversiones(); L2.push({ id: "i" + Date.now(), codigo: tr.codigo, nombre: tr.nombre || tr.codigo, capital: cap, invGan: Math.round(X.invGan), ts: Date.now(), estado: "trabajando" }); setInversiones(L2); R.invVer = null; toast("💸 Invertiste " + clp(cap) + " · tu plata está trabajando"); return pintarHoja(true); }
    if (a === "inv-liquidar") { const L2 = inversiones(); const e = L2.find((x) => x.id === b.dataset.id); if (!e || e.estado !== "trabajando") return; const bp = brokerPct() / 100; const netInv = Math.round(e.capital + e.invGan * (1 - bp)), com = Math.round(e.invGan * bp); e.estado = "liquidado"; e.ts_liq = Date.now(); e.neto = netInv; e.com = com; setInversiones(L2); setSaldo(saldoInv() + netInv); toast("💰 Pagó el factoring: +" + clp(netInv) + " a tu saldo" + (com ? " · comisión broker " + clp(com) : "")); return pintarHoja(true); }
    if (a === "hist-limpiar") { setInversiones(inversiones().filter((x) => x.estado !== "liquidado")); toast("Historial borrado"); return pintarHoja(true); }
    if (a === "liq-mas") { setBrokerPct(brokerPct() + 5); R.liqAbierto = true; return pintarHoja(true); }
    if (a === "liq-menos") { setBrokerPct(brokerPct() - 5); R.liqAbierto = true; return pintarHoja(true); }
    if (a === "saldo-ok") { const v = Math.round(Number(($("#rbSaldoMonto")?.value || "").replace(/\D/g, "")) || 0); if (!v) { toast("Pon un monto"); return; } const modo = R.saldoForm, d = saldoInv(); if (modo === "retirar" && v > d) { toast("No tienes saldo suficiente"); return; } setSaldo(modo === "cargar" ? d + v : d - v); R.saldoForm = null; R.saldoPrefill = 0; toast(modo === "cargar" ? "💳 Saldo cargado: " + clp(v) : "✅ Retiro registrado: " + clp(v)); return pintarHoja(true); }
    if (a === "nube-aprobar" || a === "nube-rechazar") {
      try { await api("nube-aprobar", { method: "POST", body: JSON.stringify({ id: b.dataset.v, rechazar: a === "nube-rechazar" }) }); toast(a === "nube-aprobar" ? "✅ Servidor aprobado: se está instalando" : "Solicitud rechazada"); R.nubeT = 0; await cargarNube(); } catch (e) { toast(e.message); } return; }
    if (a === "robot-mando") { try { await api("robot-mando", { method: "POST", body: JSON.stringify({ preferido: b.dataset.v || null }) }); toast(b.dataset.v ? `🎖 Manda ${b.dataset.v === "nube" ? "la nube" : "el PC"} (cambia en ~10 s)` : "⚙ Automático"); R.nubeT = 0; await cargarNube(); } catch (e) { toast(e.message); } return; }
    if (a === "nube-copiar") { const ok = await copiar(b.dataset.v || ""); toast(ok ? "📋 Copiado" : "No se pudo copiar"); return; }
    if (a === "plan-links") { const links = Object.fromEntries(PLANES_INFO.map(([k]) => [k, ($("#rbPago-" + k)?.value || "").trim()]));
      try { const r = await api("plan-links", { method: "POST", body: JSON.stringify({ links }) }); R.planLinks = r.links; toast("💳 Links de pago guardados"); pintarHoja(true); } catch (e) { toast(e.message); } return; }
    if (a === "plan-activar") { try { await api("plan", { method: "POST", body: JSON.stringify({ jugador: b.dataset.j, plan: b.dataset.v, activar: true }) }); toast("👑 Plan activado"); R.planT = 0; await cargarPlan(); } catch (e) { toast(e.message); } return; }
    if (a === "global") { R.pantalla = "global"; sheet.scrollTop = 0; cargarGlobal(); if (!R.ejecutores) cargarEjecuta(); return pintarHoja(true); }
    if (a === "global-cerrar") { R.pantalla = null; return pintarHoja(true); }
    if (a === "oc") { R.pantalla = "oc"; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "oc-cerrar") { R.pantalla = null; return pintarHoja(true); }
    if (a === "oc-bloque") { R.ocB = R.ocB === b.dataset.b ? "" : b.dataset.b; return pintarHoja(true); }
    if (a === "oc-todas") { R.ocTodas = !R.ocTodas; return pintarHoja(true); }
    if (a === "global-j") { R.globalJ = b.dataset.v || ""; return pintarHoja(true); }
    if (a === "llam-si") { if (R.pantalla !== "llamada") { R.pantalla = "llamada"; R.llamada = { texto: "" }; sheet.scrollTop = 0; } return confirmarLlamada(cod); }
    if (a === "llam-no") { R.llamada.idx = (R.llamada.idx || 0) + 1; if (R.llamada.idx >= (R.llamada.cands || []).length) R.llamada.cands = []; return pintarHoja(true); }
    if (a === "llam-cambiar") { R.llamada = { texto: R.llamada?.texto, cands: candidatasLlamada(R.llamada?.texto || ""), idx: 0 }; return pintarHoja(true); }
    if (a === "llam-gmail" || a === "llam-mail") {          // abre el correo con lo que escribiste (tú presionas Enviar)
      ev.preventDefault(); const q = R.llamada || {}; q.asunto = $("#rbAsunto")?.value || ""; q.cuerpo = $("#rbCuerpo")?.value || "";
      const qs = `bcc=${encodeURIComponent(b.dataset.bcc || "")}&subject=${encodeURIComponent(q.asunto)}&body=${encodeURIComponent(q.cuerpo)}`;
      if (a === "llam-mail") { location.href = "mailto:?" + qs; return; }
      if (esIOS) { location.href = "googlegmail://co?" + qs; setTimeout(() => { if (!document.hidden) toast("¿No se abrió? Instala Gmail o usa «Otro correo»"); }, 1800); }
      else window.open("https://mail.google.com/mail/?view=cm&fs=1&" + (conex().gmail ? "authuser=" + encodeURIComponent(conex().gmail) + "&" : "") + qs.replace("subject=", "su="), "_blank");
      return;
    }
    if (a === "llamada-ver") { const h = leerHist().find((x) => x.id === b.dataset.id); if (h) { R.llamada = { id: h.id, texto: h.texto, t: h.t, confirmado: h.codigo || null }; if (h.codigo) cargarDocs(h.codigo); esperarRespuesta(h.id); } return pintarHoja(true); }
    if (a === "recordar") return recordar(b.dataset.t, b.dataset.min, b.dataset.c);
    if (a === "ver-roles") { R.verRoles = true; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "roles-cerrar") { R.verRoles = false; return pintarHoja(true); }
    if (a === "rol-elegir") { try { localStorage.setItem(ROL, b.dataset.v); } catch (e) {} const rp = (ROLES[b.dataset.v] || {}).portal; if (rp) guardar({ portal: rp }); R.verRoles = false; sheet.scrollTop = 0; navigator.vibrate?.(10); return pintarHoja(true); }
    if (a === "rol-cambiar") { try { localStorage.removeItem(ROL); } catch (e) {} sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "portada-jugar") {
      const v = $("#rbRut")?.value || ""; R.rutTmp = v;
      if (!rutOk(v)) { toast("Revisa el RUT (ej. 76.123.456-7)"); $("#rbRut")?.focus(); return; }
      const limpio = rutLimpio(v); b.disabled = true; b.textContent = "⏳ Entrando…";
      if (!R.empresas) await cargarEmpresas();
      let e = Object.values(R.empresas || {}).find((x) => rutLimpio(x.rut) === limpio);
      try {
        if (!e) { const r = await api("empresa", { method: "POST", body: JSON.stringify({ rut: rutFmt(v), razon_social: "Empresa " + rutFmt(v) }) }); R.empresas = r.empresas; e = r.empresa; }
        guardar({ empresa: e.id, rubroListo: 1, ...(e.perfil?.rubros?.length && !(leer().rubros || []).length ? { rubros: e.perfil.rubros } : {}) });
        try { sessionStorage.setItem(PORT, "1"); } catch {}
        R.oportTab = "nuevas"; R.oportFiltro = "real"; R.ver = null; R.data = null; sheet.scrollTop = 0;
        if (!e.perfil || Date.now() - Date.parse(e.perfil.t || 0) > 30 * 86400000) descubrirEmpresa(v, /^Empresa \d/.test(e.razon_social) ? "" : e.razon_social);
        navigator.vibrate?.(20); refrescar();
      } catch (er) { toast(er.message); b.disabled = false; b.textContent = "▶ JUGAR"; }
      return pintarHoja(true);
    }
    if (a === "con") {
      const k = b.dataset.k;
      if (k === "marketplace") { const c = conex(); c.marketplace = "abierto"; try { localStorage.setItem(CONEX, JSON.stringify(c)); } catch {}
        window.open("https://www.facebook.com/marketplace/", "_blank", "noopener"); return pintarHoja(true); }
      R.rutTmp = $("#rbRut")?.value ?? R.rutTmp; R.conForm = R.conForm === k ? null : k; pintarHoja(true); setTimeout(() => $("#rbConV")?.focus(), 50); return;
    }
    if (a === "con-ok") {
      const v = ($("#rbConV")?.value || "").trim(), k = R.conForm; if (!v) return;
      if (k === "gmail" && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) { toast("Escribe un correo válido"); return; }
      const c = conex(); c[k] = v; try { localStorage.setItem(CONEX, JSON.stringify(c)); } catch {}
      if (k === "whatsapp") { const p0 = persona() || {}; try { localStorage.setItem(PERS, JSON.stringify({ ...p0, telefono: v })); } catch {} }
      R.rutTmp = $("#rbRut")?.value ?? R.rutTmp; R.conForm = null; toast(k === "gmail" ? "✉️ Gmail vinculado: los correos a proveedores salen desde ahí" : "💬 WhatsApp vinculado"); return pintarHoja(true);
    }
    if (a === "rubro-t2") { const set = new Set(leer().rubros || []); const r = b.dataset.r; set.has(r) ? set.delete(r) : set.add(r); guardar({ rubros: [...set], rubroListo: 1 }); R.perfilAbierto = true; navigator.vibrate?.(8); return pintarHoja(true); }
    if (a === "redescubrir") { const e = empresaActual(); if (e) descubrirEmpresa(e.rut, /^Empresa \d/.test(e.razon_social) ? "" : e.razon_social); return; }
    if (a === "persona-editar") { R.personaEditar = true; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "persona-cancelar") { R.personaEditar = false; return pintarHoja(true); }
    if (a === "persona-guardar") {
      const nombre = ($("#rbPerNom")?.value || "").trim().slice(0, 40); if (!nombre) { toast("Escribe tu nombre"); return; }
      const telefono = ($("#rbPerTel")?.value || "").trim().slice(0, 30);
      try { localStorage.setItem(PERS, JSON.stringify({ nombre, telefono, desde: new Date().toISOString() })); localStorage.setItem(DISP, nombre); } catch {}
      R.personaEditar = false; toast("👤 Listo: este celular es de " + nombre.split(" ")[0]);
      if (R.token) api("ejecutor", { method: "POST", body: JSON.stringify({ id: miJug(), nombre, telefono }) }).then((r) => { R.ejecutores = r.ejecutores; }).catch(() => {});   // 👤 todos los usuarios quedan registrados: así cada negocio dice quién lo cotizó, ejecuta e invierte
      sheet.scrollTop = 0; return pintarHoja(true);
    }
    if (a === "empresa-editar") { R.empresaEditar = true; R.empForm = null; R.empresas = null; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "empresa-form") { R.empForm = b.dataset.id ? { ...(R.empresas || {})[b.dataset.id] } : {}; return pintarHoja(true); }
    if (a === "empresa-cancelar") { R.empForm = null; return pintarHoja(true); }
    if (a === "empresa-usar") { guardar({ empresa: b.dataset.id }); aplicarRubrosEmp((R.empresas || {})[b.dataset.id]); R.oport = null; R.empresaEditar = false; R.ver = null; R.data = null; R.ultimoHtml = null; toast("🏢 Ofertas con " + corta((R.empresas || {})[b.dataset.id]?.razon_social)); refrescar(); return pintarHoja(true); }
    if (a === "empresa-guardar") {
      const d = {}; $$("[data-emp]", sheet).forEach((i) => { d[i.dataset.emp] = i.value.trim(); }); if (!d.id) delete d.id;
      if (!d.razon_social || !d.rut) { toast("Falta razón social y RUT"); return; }
      try { const r = await api("empresa", { method: "POST", body: JSON.stringify(d) }); R.empresas = r.empresas; R.empForm = null;
        guardar({ empresa: r.empresa.id }); R.empresaEditar = false; R.ver = null; R.data = null; toast("🏢 Listo: ofertas con " + corta(r.empresa.razon_social)); refrescar(); }
      catch (e) { toast(e.message); }
      return pintarHoja(true);
    }
    if (a === "bienvenida") { const u = location.origin + "/#enlazar=" + R.token; const txt = `Te invito a la app de Compras Ágiles:\n1) Abre este enlace en Safari (iPhone) o Chrome: ${u}\n2) Compartir → Agregar a pantalla de inicio.\n3) Elige o crea tu empresa y tu rubro.\n4) Para firmar rápido: instala la app gratis «Userscripts» (iPhone) o «Tampermonkey» (PC/Android) y abre ${location.origin}/cotizagil-firma.user.js`;
      const ok = await copiar(txt); toast(ok ? "✓ Invitación copiada: pégala en WhatsApp" : "No se pudo copiar"); return; }
    if (a === "oc-si") return ocSi(cod, b.closest(".rb-neg"));
    if (a === "oc-pre-no") { R.ocNo = { ...(R.ocNo || {}), [cod]: 1 }; return pintarHoja(true); }
    if (a === "oc-volver") { if (R.ocNo) delete R.ocNo[cod]; return pintarHoja(true); }
    if (a === "oc-no") {
      const m = ($(`#rbNo-${CSS.escape(cod)}`)?.value || "").trim();
      try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, etapa: "rechazada", datos: { nos_da: false, motivo_no: m }, dispositivo: dispositivo(false) }) });
        if (R.ocNo) delete R.ocNo[cod]; toast("❌ Marcada como «no da»"); await refrescar(); pintarHoja(true); } catch (e) { toast(e.message); }
      return;
    }
    if (a === "sel-mover") { R.selIdx = (R.selIdx || 0) + +b.dataset.d; return pintarHoja(true); }
    if (a === "sel-preparar") return selFirmar(b.closest(".rb-sel"), b);
    if (a === "oport-si") return oportDecidir(cod, true, b.closest(".rb-swipe"));
    if (a === "oport-no") return oportDecidir(cod, false, b.closest(".rb-swipe"));
    if (a === "oport-restaurar") return oportRestaurar(cod, b.closest(".rb-swipe"));
    if (a === "oport-actualizar") {
      try { await api("oportunidades-actualizar", { method: "POST", body: "{}" }); toast("El robot está bajando las oportunidades nuevas (1–2 min)"); }
      catch (e) { toast(e.message); }
      setTimeout(() => { R.oport = null; if (R.vista === "oport") pintarHoja(); }, 90000);
      return;
    }
    if (a === "lic-tab") { R.licTab = b.dataset.e; return pintarHoja(true); }
    if (a === "tw-guardar" || a === "tw-cambiar") {
      if (a === "tw-cambiar") { try { localStorage.removeItem(TW); } catch {} return ejOpVivo(cod, { twitch_canal: "" }); }
      const v = ($("#rbTw-" + cod)?.value || "").trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//, "").replace(/^@/, "").replace(/[^\w]/g, "");
      if (!v) { toast("Escribe el nombre de tu canal de Twitch"); return; }
      try { localStorage.setItem(TW, v); } catch {} return ejOpVivo(cod, { twitch_canal: v }, "📺 Canal guardado");
    }
    if (a === "tw-inicio") { const t = (R.ejec || []).find((x) => x.codigo === cod); const canal = t ? twCanal(t) : "";
      window.open(/iPhone|iPad|Android/.test(navigator.userAgent) ? "twitch://open" : "https://dashboard.twitch.tv/stream-manager", "_blank");
      return ejOpVivo(cod, { en_vivo: true, twitch_canal: canal }, "🔴 En vivo · el inversionista recibió el aviso"); }
    if (a === "tw-fin") return ejOpVivo(cod, { en_vivo: false }, "⏹ Listo · pega el link del video como prueba de entrega");
    if (a === "lic-codigo" || a === "lic-pegar") {
      let v = ($("#rbLicCod")?.value || "").trim();
      if (a === "lic-pegar") { try { v = (await navigator.clipboard.readText()).trim(); } catch { toast("Mantén apretado el campo y elige Pegar"); return; } const i = $("#rbLicCod"); if (i) i.value = v; }
      const m = v.toUpperCase().replace(/\s+/g, "").match(/\d{1,8}-\d{1,6}-[A-Z][A-Z0-9]{1,2}\d{2}/);
      if (!m) { if (a === "lic-codigo") toast("Ese código no se ve como una licitación (ej: 2585-77-LE26)"); return; }
      try { const r = await api("pedir", { method: "POST", body: JSON.stringify({ codigo: m[0], accion: "licitar" }) });
        toast(r._status === 409 ? "Ya está en manos del robot" : "🚀 " + m[0] + ": el robot baja las bases y las lee"); R.licTab = "prep"; R.foco = m[0]; await refrescar(); pintarHoja(true); } catch (e) { toast(e.message); }
      return;
    }
    if (a === "lic-ir") { const ok = await copiar(cod); toast(ok ? "📋 Código copiado: pégalo en el buscador si te lo pide" : cod);
      window.open(`https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(cod)}`, "_blank"); return; }
    if (a === "lic-no") { const n = licNo(); n[cod] = Date.now(); try { localStorage.setItem(LIC_NO, JSON.stringify(n)); } catch {} navigator.vibrate?.(8); return pintarHoja(true); }
    if (a === "lic-vamos") {
      try { const r = await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "licitar" }) });
        toast(r._status === 409 ? "Ya está en manos del robot" : "💚 ¡Vamos! El robot baja las bases y las lee como experto"); R.licTab = "prep"; await refrescar(); pintarHoja(true); } catch (e) { toast(e.message); }
      return;
    }
    if (a === "lic-vision") {
      try { await api("lic-vision", { method: "POST", body: JSON.stringify({ codigo: cod, vistas: ["exterior", "interior"] }) }); toast("🎨 El robot está dibujando el proyecto terminado"); await refrescar(); pintarHoja(true); } catch (e) { toast(e.message); }
      return;
    }
    if (a === "lic-preguntar") { R.pantalla = "llamada"; R.llamada = { texto: "" };
      preguntarRobot("Revisa las bases de esta licitación como experto legal y de negocio: ¿qué nos puede dejar fuera, qué garantías y multas hay, qué precio conviene y qué le preguntarías al comprador en el foro?", null, cod); return; }
    if (a === "firma-editar") { R.firmaEditar = !R.firmaEditar; return pintarHoja(true); }
    if (a === "firma-dibujar") { R.firmaDibujar = !R.firmaDibujar; return pintarHoja(true); }
    if (a === "firma-limpiar") { const cv = $("#rbFirCv"); if (cv && cv._ctx) { cv._ctx.save(); cv._ctx.setTransform(1, 0, 0, 1, 0, 0); cv._ctx.fillStyle = "#fff"; cv._ctx.fillRect(0, 0, cv.width, cv.height); cv._ctx.restore(); cv._dib = false; } return; }
    if (a === "firma-guardar-dibujo") {
      const nombre = ($("#rbFirN")?.value || "").trim(), rut = ($("#rbFirR")?.value || "").trim(), cargo = ($("#rbFirC")?.value || "").trim();
      if (!nombre || !rut) { toast("Escribe el nombre y el RUT de quien firma"); return; }
      const cv = $("#rbFirCv"); if (!cv || !cv._dib) { toast("Dibuja tu firma primero"); return; }
      try {
        const b64 = cv.toDataURL("image/jpeg", 0.92).split(",")[1];
        await api("firma-subir", { method: "POST", body: JSON.stringify({ b64, mime: "image/jpeg", nombre, rut, cargo }) });
        R.firmaEditar = false; R.firmaDibujar = false; R.firmaT = 0; toast("✍️ Firma guardada · el robot la limpia y la estampa"); cargarFirma(); pintarHoja(true);
      } catch (e) { toast(e.message || "No se pudo guardar la firma"); }
      return;
    }
    if (a === "firma-subir") {
      const nombre = ($("#rbFirN")?.value || "").trim(), rut = ($("#rbFirR")?.value || "").trim(), cargo = ($("#rbFirC")?.value || "").trim();
      if (!nombre || !rut) { toast("Escribe el nombre y el RUT de quien firma"); return; }
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        try {
          const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(f); });
          const k = Math.min(1, 1800 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
          cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          const b64 = cv.toDataURL("image/jpeg", 0.92).split(",")[1];
          await api("firma-subir", { method: "POST", body: JSON.stringify({ b64, mime: "image/jpeg", nombre, rut, cargo }) });
          R.firmaEditar = false; R.firmaT = 0; toast("✍️ Firma subida · el robot la limpia y la guarda para los anexos"); cargarFirma(); pintarHoja(true);
        } catch (e) { toast(e.message || "No se pudo subir la foto"); }
      };
      inp.click(); return;
    }
    if (a === "licitar") {
      if (!confirm(`¿Participar en la licitación ${cod}?\n\nEl robot baja la ficha y los anexos (te pedirá el código de la imagen), analiza las bases, fija el precio (presupuesto −17%) y llena los papeles. Después te pregunta si te parece el precio.`)) return;
      try { const r = await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "licitar" }) });
        toast(r._status === 409 ? "Ya está en manos del robot" : "El robot empezó con la licitación"); R.vista = "lista"; await refrescar(); }
      catch (e) { toast(e.message); }
      return;
    }
    if (a === "lic-anexos") {               // 📱 el celular sube los anexos que descargó del portal; el robot los absorbe y analiza
      const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true;
      inp.accept = ".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.jpg,.jpeg,.png,application/pdf,image/*";
      inp.onchange = async () => {
        const fs = [...(inp.files || [])]; if (!fs.length) return;
        let ok = 0, fallo = 0;
        for (let i = 0; i < fs.length; i++) {
          const f = fs[i];
          try {
            if (f.size > 4_300_000 && !f.type.startsWith("image/")) {     // 📦 pesado: sube por partes y el servidor lo arma
              await subirPorPartes(cod, f, (p, tot) => toast(`Subiendo ${i + 1}/${fs.length}: ${f.name.slice(0, 16)}… parte ${p}/${tot}`));
            } else {
              toast(`Subiendo ${i + 1}/${fs.length}: ${f.name.slice(0, 24)}…`);
              const b64 = await achicar(f);
              await api("lic-archivo", { method: "POST", body: JSON.stringify({ codigo: cod, tipo: "anexo", nombre: f.name, mime: b64.mime, b64: b64.data }) });
            }
            ok++;
          } catch (e) { fallo++; toast(`${f.name.slice(0, 20)}: ${e.message}`); }
        }
        if (!ok) { toast("No subió ninguno. Reintenta, o usa 📥 Bajar y analizar con el código."); return; }
        try {
          await api("lic-anexos-listo", { method: "POST", body: JSON.stringify({ codigo: cod }) });
          toast(`📂 Carpeta absorbida (${ok} archivo${ok > 1 ? "s" : ""}${fallo ? `, ${fallo} con error` : ""}): el robot los está analizando`);
          R.licTab = "prep"; await refrescar(); pintarHoja(true);
        } catch (e) { toast(e.message); }
      };
      inp.click();
      return;
    }
    if (a === "lic-go") {
      const raw = ($(`#rbLicGo-${CSS.escape(cod)}`)?.value || cod || "").trim().toUpperCase().replace(/\s+/g, "");
      const m = raw.match(/\d{1,8}-\d{1,6}-[A-Z][A-Z0-9]{1,2}\d{2}/);
      if (!m) { toast("Ese código no se ve como una licitación (ej: 2585-77-LE26)"); return; }
      try { const r = await api("pedir", { method: "POST", body: JSON.stringify({ codigo: m[0], accion: "licitar" }) });
        toast(r._status === 409 ? "Ya está en manos del robot" : "📥 " + m[0] + ": el robot baja las bases; te pedirá el código de la imagen"); R.licTab = "prep"; R.foco = m[0]; await refrescar(); pintarHoja(true); }
      catch (e) { toast(e.message); }
      return;
    }
    if (a === "lic-captcha") {
      const v = ($(`#rbCap-${CSS.escape(cod)}`)?.value || "").trim();
      if (!v) { toast("Escribe el código de la imagen"); return; }
      try { await api("captcha", { method: "POST", body: JSON.stringify({ codigo: cod, texto: v }) }); toast("Código enviado: el robot sigue"); await refrescar(); }
      catch (e) { toast(e.message); }
      return;
    }
    if (a === "lic-firmar") {
      const d = parseFloat(($(`#rbDesc-${CSS.escape(cod)}`)?.value || "17").replace(",", ".")) / 100;
      if (!confirm(`¿Apruebas el precio (${Math.round(d * 1000) / 10}% bajo el presupuesto)?\n\nEl robot firmará los anexos y el programa de integridad con la firma del representante legal.`)) return;
      try { await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "lic_firmar", descuento: d }) }); toast("Aprobada: el robot está firmando"); await refrescar(); }
      catch (e) { toast(e.message); }
      return;
    }
    if (a === "lic-ingresar") {
      if (!confirm("¿Ya iniciaste sesión en Mercado Público en el PC?\n\nEl robot cargará la oferta; la declaración jurada y el envío los haces tú.")) return;
      try { await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "lic_ingresar" }) }); toast("El robot ingresará la oferta"); await refrescar(); }
      catch (e) { toast(e.message); }
      return;
    }
    if (a === "lic-zip") {
      try {
        const r = await api("lic-zip?codigo=" + encodeURIComponent(cod));
        const url = URL.createObjectURL(await r.blob());
        const el = document.createElement("a"); el.href = url; el.download = `PJANIC_${cod}.zip`; document.body.append(el); el.click(); el.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } catch (e) { toast(e.message); }
      return;
    }
    if (a === "oport-preparar") {
      const x = (R.oport?.lista || []).find((y) => y.codigo === cod);
      return pedirOferta({ codigo: cod, nombre: x?.nombre, organismo: x?.organismo, monto: x?.monto });
    }
    if (a === "det") { R.detalle = cod; R.exFicha = null; sheet.scrollTop = 0; return pintarHoja(); }
    if (a === "cerrar-det") { R.detalle = null; return pintarHoja(); }
    if (a === "remoto") {
      const v = ($("#rbRemoto")?.value || "").trim();
      if (v && !/^https:\/\//i.test(v)) { toast("El enlace debe empezar con https://"); return; }
      guardar({ remoto: v || REMOTO_DEF }); toast("Enlace guardado"); return pintarHoja();
    }
    if (a === "desc") { R.conf.descuento = +b.dataset.d; guardar({ descuento: +b.dataset.d }); return pintarHoja(); }
    if (a === "confirmar") return confirmar();
    if (a === "antiguo") return confirmar("ofertar");
    if (a === "probar") return confirmar("probar");
    if (a === "nuevo") return nuevos($("#rbCod")?.value);
    if (a === "cp") { const ok = await copiar(b.dataset.v); b.textContent = ok ? "Copiado ✓" : "No se pudo"; b.classList.toggle("ok", ok); setTimeout(() => { b.textContent = "Copiar"; b.classList.remove("ok"); }, 1500); return; }
    if (a === "copiar-marcador") {
      const ok = await copiar(marcador());
      if (ok) alert("Marcador copiado.\n\n1) Toca ⋮ y luego ☆ para guardar esta página como favorito.\n2) ⋮ → Favoritos → mantén presionado ese favorito → Editar.\n3) Nombre: Rellenar. URL: borra todo y pega.\n\nPara usarlo: en Mercado Público escribe «Rellenar» en la barra de direcciones y toca el favorito.");
      else toast("No se pudo copiar");
      return;
    }
    if (a === "marcador-arrastrar") { ev.preventDefault(); toast("Arrástralo a la barra de favoritos; se usa en Mercado Público"); return; }
    if (a === "nube-entrar") { await entrarNube(); return; }
    if (a === "mp-safari") { try { window.open("https://www.mercadopublico.cl/", "_blank", "noopener"); } catch (e) { location.href = "https://www.mercadopublico.cl/"; } toast("🧑 Abriendo Mercado Público — entra con tu cuenta y firma ahí mismo"); return; }
    if (a === "nube-pronto") { toast("☁️ La nube la activamos más adelante (con los permisos). Por ahora el robot trabaja en tu PC."); return; }
    if (a === "mpl-abrir") { R.pantalla = "mplogin"; R.mplCarg = false; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "mpl-salir") { R.pantalla = null; clearTimeout(R.mplTimer); R.mplCarg = false; return pintarHoja(true); }
    if (a === "mpl-enviar") {
      const run = ($("#rbMplRun")?.value || "").replace(/[^0-9kK]/g, "").toUpperCase(), clave = $("#rbMplClave")?.value || "";
      if (run.length < 7 || !clave) return toast("Escribe tu RUN y tu ClaveÚnica");
      if (!runValido(run)) return toast("⚠️ Ese RUN no es válido: revisa los números y el dígito verificador (después del guion). No se envió nada.");
      if ((leer().mplFallos || 0) >= 2 && !confirm("⚠️ ClaveÚnica ya rechazó 2 intentos. Al TERCERO se BLOQUEA tu ClaveÚnica.\n\nSi no estás 100% seguro de la clave, mejor recupérala primero en claveunica.gob.cl.\n\n¿Seguro que quieres intentar?")) return;
      b.disabled = true;
      try {
        if (!R.mpl?.pub) await cargarLoginMP();
        const sobre = await sobreMP({ run, clave });
        $("#rbMplClave").value = ""; $("#rbMplRun").value = "";
        await api("mp-login", { method: "POST", body: JSON.stringify({ sobre }) });
        toast("🔐 Enviado cifrado al robot del PC"); R.mplFirma = null; await cargarLoginMP();
      } catch (e) { toast(e.message); } finally { b.disabled = false; }
      return;
    }
    if (a === "mpl-codigo") {
      const cod = ($("#rbMplCod")?.value || "").trim(), A = loginActivo();
      if (!cod || !A) return toast("Escribe el código");
      try { const sobre = await sobreMP({ codigo: cod }); $("#rbMplCod").value = ""; await api("mp-login-resp", { method: "POST", body: JSON.stringify({ id: A.id, sobre }) }); toast("Código enviado"); R.mplFirma = null; await cargarLoginMP(); } catch (e) { toast(e.message); }
      return;
    }
    if (a === "mpl-opcion") { const A = loginActivo(); if (!A) return; try { await api("mp-login-resp", { method: "POST", body: JSON.stringify({ id: A.id, opcion: +b.dataset.v }) }); toast("Elegida"); R.mplFirma = null; await cargarLoginMP(); } catch (e) { toast(e.message); } return; }
    if (a === "mpl-cancelar") { const A = loginActivo(); if (A) await api("mp-login-resp", { method: "POST", body: JSON.stringify({ id: A.id, cancelar: true }) }).catch(() => {}); toast("Cancelado"); return; }
    if (a === "conectar-mp") {
      // ☁️ si trabaja el robot de la nube, la sesión de Mercado Público se abre en SU navegador (vista remota)
      if (esDueno()) { R.pantalla = "mplogin"; R.mplCarg = false; sheet.scrollTop = 0; return pintarHoja(true); }
      if (esIOS && instalada()) { abrirEnSafari("conectar"); return; }
      window.open(location.origin + "/firmar.html#conectar", "_blank"); return;
    }
    if (a === "ir-firmar") return irFirmar(cod);
    if (a === "fir-quitar") return quitarFirma(cod, b.closest(".rb-firma"));
    if (a === "fir-mover") { R.firIdx = (R.firIdx || 0) + +b.dataset.d; return pintarHoja(true); }
    if (a === "recuperar-firmas") { try { localStorage.removeItem(OCULTAS); localStorage.removeItem(FIRMADAS); } catch {} R.firIdx = 0; toast("👀 Recuperé las listas para firmar"); return pintarHoja(true); }
    if (a === "__ir-firmar-viejo") {
      const t = trabajo(cod); if (!t?.firma) return;
      // iPhone con la app en la pantalla de inicio: la ventana interna NO tiene la extensión ni tu sesión.
      // Nunca se abre ahí: se ofrece abrir en Safari (toque directo del usuario) o copiar el enlace.
      api("mp-orden", { method: "POST", body: JSON.stringify({ codigo: cod }) }).catch(() => {});   // tu pestaña conectada salta sola a la compra
      ABIERTAS[String(cod).toUpperCase()] = { w: null, t: Date.now() };
      if (esIOS && instalada()) { abrirEnSafari(cod); return; }
      toast(firmaRapida() ? "Abriendo la compra: Firma rápida carga precios, detalle y PDF" : "Abriendo la compra: ahí toca tu marcador «Rellenar»");
      const w = window.open(portalDe(cod), "_blank");
      if (w) { try { w.opener = null; } catch {} ABIERTAS[String(cod).toUpperCase()].w = w; } else location.href = portalDe(cod);
      return;
    }
    if (a === "lk-tipo") { const box = document.querySelector(`.rb-links[data-c="${CSS.escape(cod)}"]`); box?.querySelectorAll(".lk-tipo").forEach((x) => x.classList.toggle("rb-oro", x === b)); return; }
    if (a === "lk-usar") { const box = document.querySelector(`.rb-links[data-c="${CSS.escape(cod)}"]`); if (box) { box.querySelector(".lk-prov").value = b.dataset.n; box.querySelectorAll(".lk-u").forEach((i) => (i.value = "")); } const pagos = [{ nombre: b.dataset.n, monto: Number(b.dataset.m) || 0, factura: true }];
      try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, datos: { pagos, precio_acordado: Math.round(pagos[0].monto * 1.19), proveedor: b.dataset.n }, dispositivo: dispositivo(false) }) }); toast("💾 Precio del robot guardado"); R.ejecT = 0; await refrescar(); } catch (e) { toast(e.message); } return pintarHoja(true); }
    if (a === "lk-guardar") {
      const t = trabajoG(cod); const box = document.querySelector(`.rb-links[data-c="${CSS.escape(cod)}"]`); if (!t || !box) return;
      const its = itemsTodo(t).slice(0, 4); const unit = []; let total = 0;
      const tipo = box.querySelector(".lk-tipo.rb-oro")?.dataset.v || "bruto"; const aNeto = (v) => tipo === "bruto" ? Math.round(v / 1.19) : v;
      box.querySelectorAll(".lk-u").forEach((inp) => { const i = +inp.dataset.i, u = Math.round(Number(String(inp.value).replace(/[^\d]/g, "")) || 0); unit[i] = u; const q = Number(its[i]?.q || its[i]?.cantidad || 1) || 1; total += aNeto(u) * q; });
      const nombre = (box.querySelector(".lk-prov")?.value || "Proveedor").trim().slice(0, 60); if (!total) { toast("Pon el precio real por unidad"); return; }
      const pagos = [{ nombre, monto: total, factura: true, unit, tipo }];
      try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, datos: { pagos, precio_acordado: Math.round(total * 1.19), proveedor: nombre }, dispositivo: dispositivo(false) }) }); const X = calcNeg({ ...t, op: { ...(t.op || {}), precio_acordado: Math.round(total * 1.19), pagos } }); toast((X.final > 0 ? "✅ SÍ DA · utilidad " : "❌ NO DA · ") + clp(Math.round(X.final))); R.ejecT = 0; await refrescar(); } catch (e) { toast(e.message); } return pintarHoja(true);
    }
    if (a === "traza-set" || a === "traza-otro") {
      let v = b.dataset.v; if (a === "traza-otro") { v = prompt("¿Quién invierte en este negocio?", "") || ""; v = v.trim().slice(0, 60); if (!v) return; }
      const campo = b.dataset.campo; const datos = { [campo]: v }; if (campo === "ejecutor_nombre") { const e = Object.values(R.ejecutores || {}).find((x) => x?.nombre === v); if (e) datos.ejecutor = e.id; if (v === persona()?.nombre) datos.ejecutor = miJug(); }
      try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, datos, dispositivo: dispositivo(false) }) }); toast((campo === "ejecutor_nombre" ? "🛠 Ejecuta " : "💼 Invierte ") + v); R.ejecT = 0; await refrescar(); } catch (e) { toast(e.message); } return pintarHoja(true);
    }
    if (a === "brief-reintentar") { R.brief[cod] = null; return briefLlamada(cod); }
    if (a === "pg-mas") { const box = document.querySelector(`.rb-pagos[data-c="${CSS.escape(cod)}"] > div`); if (box) box.insertAdjacentHTML("afterbegin", `<div class="rb-row" style="gap:6px;margin:4px 0"><input class="rb-in pg-n" placeholder="Nombre" style="flex:2;min-width:110px"><input class="rb-in pg-m" inputmode="numeric" placeholder="monto neto" style="flex:1;min-width:90px;text-align:right"><label style="font-size:.72rem;white-space:nowrap"><input type="checkbox" class="pg-f" checked> factura</label></div>`); return; }
    if (a === "pg-guardar") {
      const pagos = leerPagos(cod); if (!pagos.length) { toast("Anota al menos un nombre y monto"); return; }
      const t = trabajoG(cod); const datos = { pagos, precio_acordado: Math.round(pagos.reduce((s, x) => s + x.monto * (x.factura ? 1.19 : 1), 0)), proveedor: pagos.map((x) => x.nombre).filter(Boolean).join(" + ").slice(0, 120) };
      const etapa = t?.op?.etapa && ["ganada", "inversionista", "operacion"].includes(t.op.etapa) ? "transporte" : null;
      try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, datos, ...(etapa ? { etapa } : {}), dispositivo: dispositivo(false) }) }); toast("💸 Compras guardadas: el negocio se recalculó"); R.ejecT = 0; await refrescar(); } catch (e) { toast(e.message); } return pintarHoja(true);
    }
    if (a === "ex-jugar-paso") { const x = exMisOport().filter((y) => !trabajo(y.codigo))[(R.exJugarIdx || 0) % Math.max(1, exMisOport().filter((y) => !trabajo(y.codigo)).length)]; if (x) { api("oport-descartar", { method: "POST", body: JSON.stringify({ codigo: x.codigo, descartar: true }) }).catch(() => {}); R.desc = { ...(R.desc || {}), [x.codigo]: 1 }; toast("🗑 Paso: no vuelve a aparecer"); } return pintarHoja(true); }
    if (a === "ex-quitar") { await quitarFirma(cod, null, "exec"); toast("🗑 Quitada del ambiente"); return pintarHoja(true); }
    if (a === "ex-todas-emp") { guardar({ todasEmp: !leer().todasEmp }); return pintarHoja(true); }
    if (a === "ex-perfil") { try { localStorage.setItem(PERFK, b.dataset.k); } catch (e) {} R.exTab = "inicio"; return pintarHoja(true); }
    if (a === "lic-dec") {
      const x = (R.oport?.lista || []).find((y) => y.codigo === cod) || {}; const d = b.dataset.d; const prev = leerSel()[cod]?.decision;
      try { const r = await api("seleccionar", { method: "POST", body: JSON.stringify({ codigo: cod, nombre: x.nombre, organismo: x.organismo, monto: x.monto, cierre: x.cierre, decision: prev === d ? "" : d }) }); if (r.sel) guardarSel(r.sel); } catch (e) { toast(e.message); }
      toast(d === "si" ? "✅ Vamos: el robot prepara la ficha" : d === "no" ? "Descartada" : "⏳ Para después"); return pintarHoja(true);
    }
    if (a === "ex-menu") { R.exMenu = !R.exMenu; return pintarHoja(true); }
    if (a === "ex-tab") { R.exMenu = false; R.exTab = b.dataset.t; R.exFicha = null; R.detalle = null; R.pantalla = null; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "ex-ficha") { R.exFicha = cod; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "ex-volver") { R.exFicha = null; return pintarHoja(true); }
    if (a === "ex-oc") { R.exOC = cod; sheet.scrollTop = 0; return pintarHoja(true); }
    if (a === "ex-oc-volver") { R.exOC = null; return pintarHoja(true); }
    if (a === "ex-items") { R.exItems = cod; sheet.scrollTop = 0; pintarHoja(true); setTimeout(() => itemsCalc(cod), 50); return; }
    if (a === "ex-items-volver") { R.exItems = null; return pintarHoja(true); }
    if (a === "it-guardar") {
      const t = trabajoG(cod); const c = itemsCalc(cod); if (!t || !c || !c.compraN) { toast("Pon al menos un precio real"); return; }
      const nombreGral = (document.querySelector(".it-prov")?.value || "").trim(); const pagos = Object.entries(c.provs).map(([n, m]) => ({ nombre: n, monto: m, factura: true, tipo: c.tipo })); if (pagos[0]) pagos[0].unit = c.unit;
      const datos = { pagos, precio_acordado: Math.round(c.compraN * 1.19), proveedor: (nombreGral || pagos.map((x) => x.nombre).join(" + ")).slice(0, 120) };
      try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, datos, dispositivo: dispositivo(false) }) }); const X = calcNeg({ ...t, op: { ...(t.op || {}), precio_acordado: datos.precio_acordado, pagos } }); toast((X.final > 0 ? "✅ SÍ DA · utilidad " : "❌ NO DA · ") + clp(Math.round(X.final))); R.ejecT = 0; await refrescar(); } catch (e) { toast(e.message); }
      R.exItems = null; return pintarHoja(true);
    }
    if (a === "ex-f") { R.exF = R.exF || {}; const k = b.dataset.k; if (k === "seg" || k === "hoy") R.exF[k] = !R.exF[k]; else R.exF[k] = R.exF[k] === b.dataset.v ? "" : b.dataset.v; return pintarHoja(true); }
    if (a === "ex-lib") { R.exLib = b.dataset.k; return pintarHoja(true); }
    if (a === "exec-toggle") { try { localStorage.setItem(EXK, execOn() ? "0" : "1"); } catch {} R.exFicha = null; sheet.classList.toggle("rb-exec", execOn()); toast(execOn() ? "◧ Modo ejecutivo" : "Modo clásico"); return pintarHoja(true); }
    if (a === "sel-revisado") { const s = { ...leerSel() }; if (s[cod]) { s[cod] = { ...s[cod], revisar: false }; guardarSel(s); } api("seleccionar", { method: "POST", body: JSON.stringify({ codigo: cod, revisado: true }) }).catch(() => {}); toast("✓ Revisado · " + cod); return pintarHoja(true); }
    if (a === "reabrir") {
      try { const r = await api("reabrir", { method: "POST", body: JSON.stringify({ codigo: cod }) }); if (r.error) { toast(r.error); return; }
        const o = leerFirmadas(); delete o[cod]; try { localStorage.setItem(FIRMADAS, JSON.stringify(o)); } catch {}
        toast("↩ " + cod + " volvió a Firmar"); R.oportTab = "firmar"; await refrescar(); pintarHoja(true); } catch (e) { toast(e.message); }
      return;
    }
    if (a === "verificar") {
      try { await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "verificar", vista: true, dispositivo: dispositivo(true) }) }); marcarFirmada(cod, false); await refrescar(); }
      catch (e) { toast(e.message); }
      // ✅ desaparece de Firmar y te lleva a la siguiente (de tu empresa primero); si no queda, al Inicio
      { const yo = miEmp(); const cola = (R.data?.trabajos || []).filter((t) => t.estado === "firmar" && !yaFirmada(t) && !noFirmable(t) && t.codigo !== cod && esMia(t) && !leerOcultas()[t.codigo]).sort((a2, b2) => (a2.empresa === yo ? 0 : 1) - (b2.empresa === yo ? 0 : 1) || (Date.parse(a2.cierre || 0) || 9e15) - (Date.parse(b2.cierre || 0) || 9e15));
        R.detalle = cola[0]?.codigo || null; R.exFicha = null; if (!cola.length) R.exTab = "inicio"; R.firIdx = 0; toast(cola.length ? "✅ Enviada · siguiente: " + corta(cola[0].nombre || cola[0].codigo) : "✅ Enviada · no queda nada por firmar 👌"); sheet.scrollTop = 0; }
      return pintarHoja(true);
    }
    if (a === "ofertar" || a === "editar") {
      const t = trabajo(cod) || {};
      return pedirOferta({ codigo: cod, nombre: t.nombre, organismo: t.organismo, monto: t.monto }, a);
    }
    if (a === "cancelar" || a === "olvidar") {
      try { await api(a, { method: "POST", body: JSON.stringify({ codigo: cod }) }); await refrescar(); }
      catch (e) { toast(e.message); }
      return;
    }
    if (a === "pdf") {
      const w = window.open("", "_blank");
      try {
        const r = await api("pdf?codigo=" + encodeURIComponent(cod));
        const url = URL.createObjectURL(await r.blob());
        if (w) w.location = url; else location.href = url;
      } catch (e) { w?.close(); toast(e.message); }
    }
  });
  // probabilidad de ganar (estimada): menos rivales y precio más bajo bajo el presupuesto = más chances
  function probGanar(of, seg, precio, pres) {
    if (!pres) return 0;
    const n = of == null || of === "" ? 3 : Math.min(+of, 6);
    const base = [0.82, 0.56, 0.42, 0.33, 0.27, 0.23, 0.2][n] + (seg ? 0.04 : 0);
    if (precio > pres) return Math.max(0.02, Math.min(0.5, (n === 0 ? 0.7 : base * 0.45) * Math.pow(pres / precio, 4)));
    const d = 1 - precio / pres;
    let p = base + (d - 0.05) * 1.6;
    const ic = intel();
    if (ic.n >= 3) { const r = precio / pres, bajo = ic.todos.filter((w) => r <= w).length / ic.n; p = (p + bajo) / 2; }   // ¿cuántos ganadores reales habrían perdido contra este precio?
    return Math.max(0.05, Math.min(0.95, p));
  }
  function pintarSel(c, guardarAhora) {
    const r = c.querySelector(".rb-range"); if (!r) return;
    if (r.dataset.v0) { r.value = posDe(r, +r.dataset.v0); if (!c.dataset.v) c.dataset.v = r.dataset.v0; delete r.dataset.v0; }
    const pres = +c.dataset.pres, v = c.dataset.v ? +c.dataset.v : precioDe(r), ve = Math.min(v, +r.dataset.hi || v);
    const costo = +(c.querySelector(".rb-costo")?.value || "").replace(/\D/g, "") || +c.dataset.costo || 0;
    const q = (k) => c.querySelector(k);
    q(".rb-precio").textContent = clp(v);
    const p = q(".rb-pct"), d = v / pres - 1;
    p.textContent = (d > 0 ? "+" : "") + (d * 100).toFixed(1).replace(".", ",") + "% vs ppto."; p.className = "rb-pct " + (d < 0 ? "baja" : "sube");
    const neto = ve / 1.19, gan = neto - costo, mar = neto ? gan / neto : 0;
    const pg = probGanar(c.dataset.of, !!c.dataset.seg, ve, pres);
    q(".rb-neto").textContent = clp(neto); q(".rb-inv").textContent = clp(costo); const cv = q(".rb-cvis"); if (cv) cv.textContent = clp(costo);
    q(".rb-cuota").textContent = costo > 0 ? "x" + (neto / costo).toFixed(2).replace(".", ",") : "x—";
    const g = q(".rb-gan"); g.textContent = (gan >= 0 ? "+" : "") + clp(gan); g.style.color = gan < 0 ? "#ff8a80" : "";
    const m = q(".rb-mar"); m.textContent = (mar * 100).toFixed(1).replace(".", ",") + "%"; m.style.color = mar < 0 ? "#ff8a80" : mar < 0.08 ? "#ffd88a" : "#7ee2a0";
    q(".rb-pg").textContent = Math.round(pg * 100) + "%"; q(".rb-prob i").style.width = Math.round(pg * 100) + "%";
    q(".rb-ev").textContent = clp(Math.max(0, gan) * pg);
    q(".rb-sobre").style.display = v > pres ? "block" : "none";
    q(".rb-p2").textContent = clp(ve);
    const pct = r.value / 10, piso = +c.dataset.piso || 0, pp = piso ? Math.min(100, Math.max(0, posDe(r, piso) / 10)) : 0;
    r.style.background = piso && c.dataset.real
      ? `linear-gradient(90deg,rgba(255,90,90,.55) 0 ${pp}%,transparent ${pp}%),linear-gradient(90deg,#c48f17,#f5cf6b ${pct}%,rgba(255,255,255,.12) ${pct}%)`
      : `linear-gradient(90deg,#c48f17,#f5cf6b ${pct}%,rgba(255,255,255,.12) ${pct}%)`;
    const bajo = q(".rb-bajo"); if (bajo) bajo.style.display = c.dataset.real && piso && ve < piso ? "block" : "none";
    if (guardarAhora) guardarSelLuego(c.dataset.c, { precio: v });
  }
  sheet.addEventListener("input", (ev) => {
    const c = ev.target.closest?.(".rb-sel"); if (!c || !ev.target.classList.contains("rb-costo")) return;
    const n = ev.target.value.replace(/\D/g, ""); ev.target.value = n ? (+n).toLocaleString("es-CL") : "";
    const e = c.querySelector(".rb-cest"); if (e) e.textContent = "";
    pintarSel(c, false); guardarSelLuego(c.dataset.c, { costo: +n || null });
  });
  sheet.addEventListener("input", (ev) => {           // 💲 precio de licitación en vivo · 🔎 búsqueda global
    const el = ev.target;
    if (el.id === "rbOportQ") { R.oportQ = el.value; R.oportN = 40; clearTimeout(R._oq); R._oq = setTimeout(() => { const pos = el.selectionStart; pintarHoja(true); const n = $("#rbOportQ"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } }, 350); return; }
    if (el.id === "rbGlobalQ") { R.globalQ = el.value; clearTimeout(R._gq); R._gq = setTimeout(() => { const pos = el.selectionStart; pintarHoja(true); const n = $("#rbGlobalQ"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } }, 350); return; }
    if (!el.classList?.contains("rb-rango")) return;
    const box = el.closest(".rb-precio-lic"); if (!box) return;
    const d = (+el.value || 0) / 100, pres = +box.dataset.pres || 0, cant = +box.dataset.cant || 1;
    const neto_max = box.dataset.coniva === "1" ? pres / 1.19 : pres, unit = Math.floor(neto_max * (1 - d) / cant / 10) * 10, neto = unit * cant;
    box.querySelector('[data-v="desc"]').textContent = (+el.value).toLocaleString("es-CL"); box.querySelector('[data-v="unit"]').textContent = clp(unit); box.querySelector('[data-v="total"]').textContent = clp(Math.round(neto * 1.19));
  });
  sheet.addEventListener("input", (ev) => {            // 🔎 Buscar (modo ejecutivo) en vivo
    if (ev.target.id !== "rbExQ") return; R.exQ = ev.target.value; const pos = sheet.scrollTop; R.toque = 0; pintarHoja(true); sheet.scrollTop = pos; const q = $("#rbExQ"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  });
  sheet.addEventListener("change", (ev) => {           // 📋 borrador: responsable · flete · plazo
    const b = ev.target.closest?.(".rb-bor"); if (!b) return; const cod = b.dataset.c;
    if (ev.target.classList.contains("rb-bor-resp")) { guardarSelLuego(cod, { responsable: ev.target.value || "" }); toast(ev.target.value ? "Responsable: " + ev.target.value : "Sin responsable"); }
    if (ev.target.classList.contains("rb-bor-flete")) { const n = ev.target.value.replace(/\D/g, ""); ev.target.value = n ? (+n).toLocaleString("es-CL") : ""; guardarSelLuego(cod, { flete: n ? +n : null }); }
    if (ev.target.classList.contains("rb-bor-plazo")) guardarSelLuego(cod, { plazo: ev.target.value.trim() });
  });
  sheet.addEventListener("change", async (ev) => {
    const el = ev.target, cod = el.dataset?.c; if (!cod) return;
    let datos = null, informe = false;
    if (el.classList.contains("rb-cot-in")) { const v = +(el.value || "").replace(/\D/g, "") || 0; el.value = v ? v.toLocaleString("es-CL") : "";
      datos = { cotizacion: { k: el.dataset.k, v, nombre: el.dataset.n } }; }
    if (el.dataset.campo === "precio_neto") { const n = +(el.value || "").replace(/\D/g, "") || 0; el.value = n ? n.toLocaleString("es-CL") : ""; datos = { precio_acordado: Math.round(n * 1.19) }; informe = true; }
    else if (el.classList.contains("rb-neg-in")) { const txt = !["precio_acordado", "costo_transporte", "km", "cobrado"].includes(el.dataset.campo);
      const v = txt ? el.value : +(el.value || "").replace(/\D/g, "") || null; datos = { [el.dataset.campo]: v }; informe = !txt; }
    if (el.type === "date") el.blur();
    if (el.dataset.rbChk) datos = { [el.dataset.rbChk]: el.checked };
    if (el.dataset.rbCom === "aplica") { datos = { aplica_comision: el.checked }; informe = true; }
    if (el.dataset.rbCom === "pct") { datos = { comision: +el.value, aplica_comision: true }; informe = true; }
    if (!datos) return;
    if (el.dataset.campo === "km") informe = false;
    try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, datos, pedir_informe: informe }) }); toast(datos.cotizacion ? "💲 Precio anotado" : informe ? "Guardado · el PC recalcula la utilidad" : "Guardado"); if (leer().portal === "ejecuta") { R.ejecT = 0; cargarEjecuta(); } else await refrescar(); }
    catch (e) { toast(e.message); }
  });
  sheet.addEventListener("change", (ev) => {           // 🧾 checklist "Datos de ingreso" (se guarda local)
    const el = ev.target, k = el.dataset?.rbIng, cod = el.dataset?.c; if (!k || !cod) return;
    const all = leerIng(); all[cod] = { ...(all[cod] || {}), [k]: el.checked };
    try { localStorage.setItem(ING, JSON.stringify(all)); } catch {}
    pintarHoja(true);
  });
  sheet.addEventListener("input", (ev) => {
    const id = ev.target.id, q = R.llamada; if (!q) return;
    if (id === "rbAsunto") q.asunto = ev.target.value; else if (id === "rbCuerpo") q.cuerpo = ev.target.value; else if (id === "rbLlamada") q.texto = ev.target.value;
  });
  sheet.addEventListener("change", (ev) => {
    if (ev.target.dataset?.prov == null || !R.llamada) return;
    const q = R.llamada; q.provSel = { ...(q.provSel || Object.fromEntries($$("[data-prov]", sheet).map((x) => [x.dataset.prov, x.checked]))), [ev.target.dataset.prov]: ev.target.checked };
    q.asunto = $("#rbAsunto")?.value; q.cuerpo = $("#rbCuerpo")?.value; pintarHoja(true);
  });
  sheet.addEventListener("toggle", (ev) => { if (ev.target?.dataset && "libro" in ev.target.dataset) R.libroAbierto = ev.target.open;
    if (ev.target?.classList?.contains("rb-p-desc")) R.perfilAbierto = ev.target.open;
    if (ev.target?.dataset && "libroej" in ev.target.dataset) R.libroEj = ev.target.open; }, true);
  sheet.addEventListener("focusin", (ev) => { if (ev.target.classList?.contains("rb-costo") || ev.target.classList?.contains("rb-neg-in")) R.barra = true; });
  sheet.addEventListener("focusout", (ev) => { if (ev.target.classList?.contains("rb-costo") || ev.target.classList?.contains("rb-neg-in")) setTimeout(() => { R.barra = false; }, 300); });
  // fotos grandes se achican antes de subir (máx. ~1600 px, JPEG), los PDF van tal cual
  // 📦 sube un archivo pesado en pedazos (el servidor los junta): así entran los anexos de más de 4,5 MB
  function bytesAB64(u8) { let s = ""; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
  async function subirPorPartes(cod, f, aviso) {
    const u8 = new Uint8Array(await f.arrayBuffer());
    const TROZO = 3_000_000;                        // ~3 MB crudos → ~4 MB en base64, bajo el límite de la request
    const total = Math.ceil(u8.length / TROZO) || 1;
    const up = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    for (let idx = 0; idx < total; idx++) {
      aviso && aviso(idx + 1, total);
      await api("lic-archivo", { method: "POST", body: JSON.stringify({ codigo: cod, tipo: "anexo", nombre: f.name, mime: f.type || "application/pdf", up, idx, total, b64: bytesAB64(u8.subarray(idx * TROZO, (idx + 1) * TROZO)) }) });
    }
  }
  async function achicar(f) {
    const leerB64 = (blob) => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = mal; r.readAsDataURL(blob); });
    if (!f.type.startsWith("image/") || f.size < 900_000) { if (f.size > 4_500_000) throw new Error("pesa " + (f.size / 1e6).toFixed(1) + " MB (máx 4,5 — comprime o sube por separado)"); return { data: await leerB64(f), mime: f.type || "application/pdf" }; }
    const img = await createImageBitmap(f); const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.82));
    return { data: await leerB64(blob), mime: "image/jpeg" };
  }
  // mientras mueves la barra no se repinta la pantalla (si no, la barra «salta»)
  sheet.addEventListener("pointerdown", (ev) => { if (ev.target.classList?.contains("rb-range")) R.barra = true; });
  ["pointerup", "pointercancel"].forEach((n) => document.addEventListener(n, () => { if (R.barra) setTimeout(() => { R.barra = false; }, 400); }));
  let rafSel = 0;
  sheet.addEventListener("input", (ev) => { const c = ev.target.closest?.(".rb-sel"); if (!c || !ev.target.classList.contains("rb-range")) return;
    delete c.dataset.v; R.toque = Date.now(); if (!rafSel) rafSel = requestAnimationFrame(() => { rafSel = 0; pintarSel(c, true); }); });
  // 📝 Armar propuesta: guarda lo que escribes (tel, correo, texto) para que no se borre al refrescar la pantalla
  sheet.addEventListener("input", (ev) => {
    const el = ev.target, q = R.llamada; if (!q) return;
    if (el.id === "rbPropTel") q.cliTel = el.value;
    else if (el.id === "rbPropMail") q.cliMail = el.value;
    else if (el.id === "rbProp") q.propCuerpo = el.value;
    clearTimeout(R.tUI); R.tUI = setTimeout(guardarUI, 500);
  });
  // 🔬 Análisis del negocio en la llamada: pones tu costo y ves al tiro si DA y cuánto ganas (Excel en vivo, sin robot)
  sheet.addEventListener("input", (ev) => {
    const el = ev.target; if (el.id !== "rbCll") return; const q = R.llamada; if (!q) return;
    const compra = +(el.value || "").replace(/\D/g, "") || 0; q.compraAnalisis = compra;
    const t = trabajoG(q.confirmado) || {}, vta = Number(t.total) || 0;
    const syn = { total: vta, op: { precio_acordado: compra, informe: {} } };
    const res = sheet.querySelector("#cllResult"); if (!res) return;
    if (vta && compra) { const X = calcNeg(syn), rt = ratingNeg(X.final);
      res.innerHTML = `<div class="rb-verd" style="font-size:1.4rem">${rt.emoji} ${X.final > 0 ? "SÍ DA" : "NO DA"} · <span class="${X.final > 0 ? "rb-vivo-t" : "rb-neg-t"}">${clp(Math.round(X.final))}</span></div><div class="muted" style="font-size:.72rem">${esc(rt.txt)} · ganas ${clp(Math.round(X.final))} en este negocio</div>` + excelVivo(syn, X);
    } else res.innerHTML = `<div class="muted" style="font-size:.76rem">Pon tu costo y te digo al tiro si DA y cuánto ganas (Excel en vivo).</div>`;
    clearTimeout(R.tUI); R.tUI = setTimeout(guardarUI, 500);
  });
  // 📊 Analizador de proyectos: recalcula el Excel en vivo al teclear (sin re-render, para no perder el foco)
  sheet.addEventListener("input", (ev) => {
    const el = ev.target; if (!el.classList?.contains("anl-in")) return;
    const a = anlLineas(); const k = el.dataset.anl; const i2 = +el.dataset.i;
    if (k === "proy") a.prod = el.value;
    else if (k === "prod") { if (a.lineas[i2]) a.lineas[i2].prod = el.value; }
    else if (a.lineas[i2]) a.lineas[i2][k] = +(el.value || "").replace(/\D/g, "") || 0;
    const res = sheet.querySelector("#anlResult"); if (res) res.innerHTML = anlResultadoHTML(a);
    const lin = el.closest(".anl-linea"); if (lin && a.lineas[i2]) { const l = a.lineas[i2]; const m = lin.querySelector(".muted"); if (m) m.textContent = +l.cant && +l.venta ? `vende ${clp(Math.round(+l.cant * +l.venta * 1.19))} · compra ${clp(Math.round(+l.cant * (+l.compra || 0) * 1.19))} (c/IVA)` : ""; }
    clearTimeout(R.tUI); R.tUI = setTimeout(guardarUI, 500);
  });
  sheet.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("[data-paso],[data-fijo]"); if (!b) return;
    const c = b.closest(".rb-sel"); if (!c) return; const r = c.querySelector(".rb-range");
    const base = c.dataset.v ? +c.dataset.v : precioDe(r), lo = +r.dataset.lo, hi = +r.dataset.hi;
    const nv = b.dataset.fijo ? Math.max(lo, Math.min(hi, +b.dataset.fijo)) : Math.max(lo, Math.min(hi, Math.round(base * (1 + b.dataset.paso / 100) / 10) * 10));
    r.value = posDe(r, nv); c.dataset.v = nv; pintarSel(c, true);
  });
  new MutationObserver(() => sheet.querySelectorAll(".rb-sel").forEach((c) => { if (!c.dataset.ok) { c.dataset.ok = 1; pintarSel(c, false); } }))
    .observe(sheet, { childList: true, subtree: true });
  sheet.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.id?.startsWith("rbCap-")) {
      ev.preventDefault();
      ev.target.closest(".rb-alertas")?.querySelector('[data-rb="lic-captcha"]')?.click();
      return;
    }
    if (ev.key !== "Enter") return;
    if (ev.target.id === "rbTok") { if (enlazar(ev.target.value)) pintarHoja(); }
    if (ev.target.id === "rbCod") nuevos(ev.target.value);
  });

  /* ---------------- botones dentro de la app ---------------- */
  const montoDeTexto = (s) => {
    const m = String(s || "").match(/\$\s*([\d.,]+)\s*(MM|M|mil)?/i);
    if (!m) return null;
    let v = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
    const u = (m[2] || "").toLowerCase();
    if (u === "mm") v *= 1e6; else if (u === "m") v *= 1e6; else if (u === "mil") v *= 1e3;
    return v > 1000 ? v : null;
  };
  function botonPara(codigo, extra) {
    const t = trabajo(codigo);
    if (t && t.estado !== "cancelada") {
      return `<button class="btn small" type="button" data-rb-ver="${esc(codigo)}" style="padding:6px 10px">${badge(t)}</button>`;
    }
    return `<button class="btn small rb-firmar" type="button" data-rb-ofertar="${esc(codigo)}" ${extra || ""}>✍ Preparar oferta</button>`;
  }
  function decorarLista() {
    $$("#oppList article.opp").forEach((card) => {
      const q = $("[data-quote]", card); if (!q) return;
      const cod = q.dataset.quote;
      if (!COD_CA.test(cod)) return;
      let slot = $(".rb-slot", card);
      if (!slot) { slot = document.createElement("span"); slot.className = "rb-slot"; q.after(slot); }
      const html = botonPara(cod);
      if (slot.dataset.h !== html) { slot.innerHTML = html; slot.dataset.h = html; }
    });
  }
  function decorarCotizador() {
    const sec = $("#v-cotizar"); if (!sec) return;
    let box = $("#rbCot");
    if (!box) {
      box = document.createElement("div"); box.id = "rbCot"; box.className = "card";
      box.style.borderColor = "rgba(232,49,63,.45)";
      const lead = $(".lead", sec); (lead || sec.firstChild).after(box);
    }
    const cod = ($("#q_id")?.value || "").trim().toUpperCase();
    const t = cod && trabajo(cod);
    const html = !COD_CA.test(cod)
      ? `<div class="row" style="justify-content:space-between"><div><h3 style="margin:0">Robot de ofertas</h3><div class="muted">Escribe un código de Compra Ágil y el robot del PC prepara la oferta completa.</div></div><button class="btn small" type="button" data-rb-abrir>Abrir robot</button></div>`
      : `<div class="row" style="justify-content:space-between;flex-wrap:nowrap"><div style="min-width:0"><h3 style="margin:0">Robot de ofertas</h3><div class="muted">${t ? esc(est(t.estado).txt) + (t.total ? " · " + clp(t.total) : "") : "Lee adjuntos, calcula el precio y carga todo en Mercado Público. Tú das el clic final."}</div></div>${botonPara(cod)}</div>`;
    if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
  }
  function decorarInicio() {
    const acts = $("#dealBox .deal-actions"); if (!acts) return;
    const id = $("#dealCard .id")?.textContent || "";
    const m = id.match(/\d{1,8}-\d{1,8}-COT\d{2}/i);
    let slot = $("#rbDeal");
    if (!slot) { slot = document.createElement("div"); slot.id = "rbDeal"; slot.style.marginTop = "10px"; acts.after(slot); }
    const html = m ? botonPara(m[0].toUpperCase(), 'style="width:100%"') : "";
    if (slot.dataset.h !== html) { slot.innerHTML = html; slot.dataset.h = html; }
  }
  function pintar() {
    const lista = R.data?.trabajos || [];
    const atn = lista.filter((t) => ["lista", "firmar", "requiere", "lic_captcha", "lic_revisar"].includes(t.estado)).length;
    chip.classList.toggle("on", !!R.data?.robot?.conectado);
    chip.classList.toggle("atn", atn > 0);
    chip.innerHTML = `<span class="rb-dot"></span><span>Robot</span>${atn ? `<span class="rb-n">${atn}</span>` : ""}`;
    decorarLista(); decorarCotizador(); decorarInicio();
    if (sheet.classList.contains("on") && !sheet.contains(document.activeElement?.closest?.("input,textarea") || null)) pintarHoja();
  }

  function datosDesdeTarjeta(el, cod) {
    const card = el.closest("article.opp, #dealBox, #v-cotizar");
    if (!card) return { codigo: cod };
    if (card.id === "v-cotizar") return { codigo: cod, nombre: $("#q_name")?.value, organismo: $("#q_org")?.value, monto: (() => { try { const d = JSON.parse(localStorage.getItem("sdc:detalle")); return d?.codigo === cod ? d.monto : null; } catch { return null; } })() };
    const nombre = $("h3", card)?.textContent?.trim();
    const meta = card.id === "dealBox" ? $("#dealCard .muted", card)?.textContent : $(".meta span", card)?.textContent;
    const montoTxt = card.id === "dealBox" ? $(".deal-figs b", card)?.textContent : $$(".meta span", card).map((s) => s.textContent).find((s) => s.includes("$"));
    return { codigo: cod, nombre, organismo: (meta || "").split(" · ")[0], monto: montoDeTexto(montoTxt) };
  }
  document.addEventListener("click", (ev) => {
    const o = ev.target.closest("[data-rb-ofertar]");
    if (o) { ev.preventDefault(); return pedirOferta(datosDesdeTarjeta(o, o.dataset.rbOfertar)); }
    const v = ev.target.closest("[data-rb-ver]");
    if (v) { ev.preventDefault(); return abrir(v.dataset.rbVer); }
    if (ev.target.closest("[data-rb-abrir]")) { ev.preventDefault(); abrir(); }
  });

  // la app repinta sus listas a su ritmo: volvemos a poner los botones cuando cambian
  const obs = new MutationObserver(() => { obs.disconnect(); try { decorarLista(); decorarInicio(); } finally { observar(); } });
  function observar() {
    ["#oppList", "#dealCard"].forEach((s) => { const el = $(s); if (el) obs.observe(el, { childList: true, subtree: true }); });
  }
  observar();
  $("#q_id")?.addEventListener("input", decorarCotizador);
  window.addEventListener("hashchange", () => setTimeout(decorarCotizador, 0));

  pintar();
  refrescar();
  desdeHash();
  setTimeout(revisarWebpay, 500);               // 💳 si volvemos de WebPay, cobra el abono y lo suma al saldo
  // app del inicio (iPhone/Android): abre directo en el robot, que es donde se trabaja
  if (instalada() && !location.hash.includes("robot")) setTimeout(() => { if (!sheet.classList.contains("on")) abrir(); }, 250);
  // si ya dio permiso antes, renueva la suscripción en silencio (por si el teléfono la cambió)
  if (R.token && "Notification" in window && Notification.permission === "granted") suscribirPush(false);
})();
