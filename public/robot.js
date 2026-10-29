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
  const RELLENAR_PERSONAL = "(async()=>{const g=\"__TOKEN__\",x=\"https://cotizagil.netlify.app/bot/\",a=t=>{let e=document.getElementById(\"cotizagil-aviso\");e||(e=document.createElement(\"div\"),e.id=\"cotizagil-aviso\",e.style.cssText=\"position:fixed;left:10px;right:10px;bottom:10px;z-index:2147483647;background:#0b1c3c;color:#fff;border:2px solid #7c4dff;border-radius:14px;padding:12px;font:15px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)\",e.onclick=()=>e.remove(),document.body.append(e)),e.innerHTML=\"<b>CotizÁgil</b><br>\"+t+\"<br><small style='opacity:.7'>(toca para cerrar)</small>\"},c=(location.pathname.match(/resumen-cotizacion\\/([\\w-]+)/)||[])[1];if(!c){a(\"Abre primero la compra en Mercado Público (botón «Ir a firmar» de la app).\");return}a(\"Cargando tu oferta…\");let l;try{l=((await fetch(x+\"estado\",{headers:{\"x-robot-token\":g}}).then(e=>e.json())).trabajos||[]).find(e=>e.codigo===c.toUpperCase())}catch(t){a(\"No pude conectar con la app: \"+t.message);return}if(!l||!l.firma){a(\"No hay una oferta lista para firmar de \"+c+\".\");return}const n=l.firma,d=t=>new Promise(e=>setTimeout(e,t)),v=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,\"value\").set,P=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,\"value\").set,u=async(t,e,o)=>{t.focus(),o.call(t,\"\"),t.dispatchEvent(new Event(\"input\",{bubbles:!0})),o.call(t,String(e)),t.dispatchEvent(new Event(\"input\",{bubbles:!0})),t.dispatchEvent(new Event(\"change\",{bubbles:!0})),t.blur(),await d(200)},w=t=>{for(let e=t,o=0;o<9&&e;o++,e=e.parentElement){const i=e.innerText||\"\",h=/Valor unitario/.test(i),y=/Despacho/i.test(i);if(h&&!y)return\"i\";if(y&&!h)return\"d\";if(h&&y)return\"?\"}return\"\"};let r=[],f=[];for(let t=0;t<40;t++){const e=[...document.querySelectorAll(\"main input[type=text]:not([disabled]), main input:not([type]):not([disabled])\")];if(r=e.filter(o=>w(o)===\"i\"),f=e.filter(o=>w(o)===\"d\"),r.length)break;await d(500)}if(!r.length){a(\"No veo el formulario. Presiona «Participar» y vuelve a tocar Rellenar.\");return}if(r.length!==n.precios.length){a(\"⚠ El formulario tiene \"+r.length+\" ítems y la oferta \"+n.precios.length+\". No toqué nada.\");return}for(let t=0;t<r.length;t++)await u(r[t],n.precios[t],v);f[0]&&await u(f[0],n.despacho||0,v);const T=document.querySelector(\"main textarea\");T&&n.detalle&&await u(T,n.detalle.slice(0,255),P);const p=n.adjunto||\"Oferta_\"+c+\".pdf\";let b=document.body.innerText.includes(p);if(!b&&l.pdf)try{const t=await fetch(x+\"pdf?codigo=\"+encodeURIComponent(c),{headers:{\"x-robot-token\":g}}).then(i=>i.blob()),e=new DataTransfer;e.items.add(new File([t],p,{type:\"application/pdf\"}));const o=document.querySelector(\"input[type=file]\");o.files=e.files,o.dispatchEvent(new Event(\"change\",{bubbles:!0}));for(let i=0;i<40&&!document.body.innerText.includes(p);i++)await d(500);b=document.body.innerText.includes(p)}catch{}await d(600);const E=[...document.body.innerText.matchAll(/Monto total\\s*\\n*\\s*\\$\\s*([\\d.]+)/g)].pop(),s=E?+E[1].replace(/\\./g,\"\"):null,m=t=>\"$\"+Math.round(t).toLocaleString(\"es-CL\"),j=s!=null&&Math.abs(s-n.total)<=50,k=[...document.querySelectorAll(\"button\")].find(t=>/Enviar cotizaci/i.test(t.innerText));k&&k.scrollIntoView({block:\"center\"}),a((j?\"✓ Total \"+m(s)+\" = oferta.\":\"⚠ Total portal \"+(s==null?\"?\":m(s))+\" · oferta \"+m(n.total)+\". Revisa.\")+\"<br>\"+(b?\"✓ PDF adjunto.\":\"⚠ Adjunta el PDF a mano.\")+\"<br><b>Ahora tú: Enviar cotización → declaración → firmar.</b>\")})();";
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
  const leer = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const guardar = (o) => { try { localStorage.setItem(KEY, JSON.stringify({ ...leer(), ...o })); } catch {} };
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
  `;
  document.head.appendChild(css);

  /* ---------------- estado ---------------- */
  const R = { token: leer().token || null, data: null, err: null, previos: {}, timer: null, enCurso: false, foco: null,
              vista: (leer().v_cajas ? leer().vista : "oport") || "oport", detalle: null, push: false, instalar: null };

  async function api(ruta, opt = {}) {
    if (!R.token) throw new Error("Robot sin enlazar");
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
      x.pedido = Date.now();
      try { await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "verificar", dispositivo: dispositivo(false) }) }); } catch {}
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
  function pintarHojaSiAbierta() { if (sheet?.classList.contains("on")) pintarHoja(); }

  /* ---------------- ciclo de consulta ---------------- */
  async function refrescar() {
    clearTimeout(R.timer);
    if (!R.token) { pintar(); return; }
    try {
      R.data = await api("estado"); R.err = null;
      revisarCambios(R.data.trabajos || []);
      cerrarEnviadas(R.data.trabajos || []);
    } catch (e) {
      R.err = e.message;
      if (e.auth) { R.token = null; guardar({ token: null }); }
    }
    pintar();
    const activos = (R.data?.trabajos || []).some((t) => est(t.estado).activo);
    const abierto = $("#rbSheet")?.classList.contains("on");
    if (!document.hidden) R.timer = setTimeout(refrescar, activos || abierto ? POLL_RAPIDO : POLL_LENTO);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { ocultaDesde = Date.now(); return; }
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
    const m = location.hash.match(/enlazar=([A-Za-z0-9_-]{16,})/);
    const r = location.hash.match(/^#robot(?:=([A-Za-z0-9-]+))?$/);
    if (!m && !r) return;
    if (m) enlazar(m[1]);
    history.replaceState(null, "", location.pathname + "#inicio");
    const cod = r?.[1] ? decodeURIComponent(r[1]).toUpperCase() : null;
    setTimeout(() => abrir(null, cod && cod !== "PRUEBA" ? cod : null), 400);
  }
  window.addEventListener("hashchange", desdeHash);

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
    R.foco = foco || null; R.conf = null; R.detalle = detalle || (foco && R.vista !== "lista" ? foco : null);
    sheet.classList.add("on"); back.classList.add("on");
    pintarHoja(); refrescar(); estadoPush().then(pintarHojaSiAbierta);
  }
  function cerrar() { sheet.classList.remove("on"); back.classList.remove("on"); R.conf = null; R.detalle = null; }

  function badge(t) {
    const e = est(t.estado);
    return `<span class="rb-badge ${e.cls}">${e.cls === "azul" && e.activo ? '<span class="spinner"></span>' : ""}${esc(e.txt)}</span>`;
  }

  /* ---------- licitaciones ---------- */
  function tarjetaLic(t) {
    const e = est(t.estado), L = t.lic || {}, c = esc(t.codigo);
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
      ${captcha}${aprobar}${alertas}
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
    if (t.estado === "probada") acts.push(`<button class="btn small rb-go" data-rb="ofertar" data-c="${esc(t.codigo)}" type="button">Preparar para firmar</button>`);
    if (["requiere", "error", "cancelada"].includes(t.estado)) acts.push(`<button class="btn small" data-rb="ofertar" data-c="${esc(t.codigo)}" type="button">Reintentar</button>`);
    if (t.estado === "lista") acts.unshift(`<a class="btn small rb-remoto" href="${esc(leer().remoto || REMOTO_DEF)}" target="_blank" rel="noopener noreferrer">Dar el clic desde aquí ↗</a>`);
    if (t.pdf) acts.push(`<button class="btn small" data-rb="pdf" data-c="${esc(t.codigo)}" type="button">Ver PDF</button>`);
    acts.push(`<a class="btn small" href="${portal}" target="_blank" rel="noopener noreferrer">Mercado Público ↗</a>`);
    if (!e.activo) acts.push(`<button class="btn small" data-rb="olvidar" data-c="${esc(t.codigo)}" type="button" aria-label="Quitar de la lista">Quitar</button>`);
    const msg = t.estado === "lista"
      ? "Todo cargado en el PC. Presiona «Enviar cotización», marca la declaración y «Aceptar y enviar» (en el PC o desde aquí con escritorio remoto). El robot confirma solo."
      : firmable ? (t.firma.aviso || null) : t.mensaje;
    const al = firmable ? (t.firma.alertas || []) : [];
    const alertasHtml = al.length ? `<div class="rb-alertas"><b>Revisa antes de firmar</b><ul style="margin:0;padding:0">${al.map((a) =>
      `<li class="${a.nivel === "rojo" ? "rojo" : ""}">${a.nivel === "rojo" ? "⛔" : "⚠"} ${esc(a.texto)}</li>`).join("")}</ul></div>` : "";
    const pasos = firmable && firmaRapida() ? `<ol class="rb-pasos">
        <li><b>Ir a firmar</b> abre la compra: <b>Firma rápida</b> carga sola los precios, el detalle y el PDF.</li>
        <li>Tú presionas <b>Enviar cotización</b>, marcas la <b>declaración</b> y <b>firmas</b>. El robot lo confirma solo.</li></ol>` : firmable ? `<div class="rb-msg" style="color:#d9c9ff">Más rápido: instala <b>Firma rápida</b> (Robot → Ajustes) y «Ir a firmar» te deja el formulario listo con el PDF.</div><ol class="rb-pasos">
        <li><b>Ir a firmar</b> abre la compra en Mercado Público.</li>
        <li>Ahí toca tu marcador <b>Rellenar</b> (en el celular: escribe «Rellenar» en la barra de direcciones y toca el marcador). Se llenan solos el precio, el detalle y el <b>PDF</b>.</li>
        <li>Tú: <b>Enviar cotización</b> → <b>declaración</b> → <b>firmar</b>. Vuelve y toca <b>Ya la firmé</b>.</li></ol>
      <button type="button" class="btn small" data-rb="copiar-marcador" style="margin-top:8px">¿Primera vez en este teléfono? Copiar marcador Rellenar</button>
      <details class="rb-det"><summary>Copiar datos a mano</summary><table class="rb-copias">
        ${t.firma.precios.map((v, k) => `<tr><td>Ítem ${k + 1}${t.items?.[k]?.d && t.items.length === t.firma.precios.length ? " · " + esc(t.items[k].d.slice(0, 40)) : ""}</td><td class="n">${clp(v)}</td><td><button type="button" class="rb-cp" data-rb="cp" data-v="${v}">Copiar</button></td></tr>`).join("")}
        <tr><td>Despacho</td><td class="n">${clp(t.firma.despacho || 0)}</td><td><button type="button" class="rb-cp" data-rb="cp" data-v="${t.firma.despacho || 0}">Copiar</button></td></tr>
        <tr><td colspan="2">Detalle (${(t.firma.detalle || "").length} car.)</td><td><button type="button" class="rb-cp" data-rb="cp" data-v="${esc(t.firma.detalle || "")}">Copiar</button></td></tr>
        <tr><td>Total esperado</td><td class="n">${clp(t.firma.total)}</td><td></td></tr></table></details>` : "";
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
      ${alertasHtml}
      ${pasos}
      ${t.detalle || (t.items && t.items.length) ? `<details class="rb-det"><summary>Detalle de la oferta</summary><pre>${esc(
        (t.items || []).map((i, k) => `${k + 1}. ${i.d} — ${i.q} x ${clp(i.p)}`).join("\n") + (t.detalle ? "\n\n" + t.detalle : ""))}</pre></details>` : ""}
      <div class="rb-acts">${acts.join("")}</div>
      <div class="rb-line" style="margin-top:8px">${esc(hace(t.actualizado))}</div>
    </div>`;
  }

  function pantallaEnlace() {
    return `
      <div class="rb-sheet-head"><h2 style="margin:0">Conecta tu robot</h2><button class="rb-x" type="button" data-rb="cerrar" aria-label="Cerrar">✕</button></div>
      <p class="lead" style="margin:8px 0 14px">El robot trabaja en tu PC con tu sesión de Mercado Público. Desde aquí le pides ofertas y ves cómo avanzan.</p>
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
      ${!R.data?.robot?.conectado ? `<div class="note" style="border-left-color:var(--warn)">El robot del PC está desconectado. El pedido queda en cola y parte apenas se encienda el panel en el PC.</div>` : ""}
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
  /* ---------- ⭐ Seleccionadas (compartidas entre tus celulares, guardadas en la nube) ---------- */
  const SELK = "sdc:seleccionadas";
  const leerSel = () => R.sel || (() => { try { return JSON.parse(localStorage.getItem(SELK)) || {}; } catch { return {}; } })();
  const guardarSel = (o) => { R.sel = o; try { localStorage.setItem(SELK, JSON.stringify(o)); } catch {} };
  const esSel = (cod) => !!leerSel()[cod];
  async function cargarSel() {
    try { const r = await api("seleccionadas"); guardarSel(r.sel || {}); } catch {}
  }
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
  async function cargarSeg(forzar) {
    if (R._cargandoSeg) return; R._cargandoSeg = true;
    try { const r = await api("seguimiento" + (forzar ? "?forzar=1" : "")); R.seg = r.seguimiento || {}; R.segT = Date.now(); } catch (e) { R.segErr = e.message; }
    R._cargandoSeg = false; pintarHoja();
  }
  const segDe = (cod) => (R.seg || {})[cod] || null;
  const descartada = (cod) => { const d = { ...(R.oport?.descartes || {}), ...(R.desc || {}) }; return !!d[cod]; };
  function vistaOport() {
    if (!R.oport) { cargarOport(); return `<div class="empty"><span class="spinner"></span> Cargando oportunidades…</div>`; }
    const o = R.oport, ahora = Date.now();
    const tab = R.oportTab || "nuevas", filtro = R.oportFiltro || "todas";
    const lic = (x) => x.fuente === "licitacion";
    const trabajos = R.data?.trabajos || [];
    const vigente = (x) => Date.parse(x.cierre) - ahora > 30 * 60000;
    const lista = o.lista || [];
    const nuevas = lista.filter((x) => vigente(x) && !descartada(x.codigo) && !trabajo(x.codigo) && !x.ya_ofertada && !x.trabajada && !esSel(x.codigo));
    const enFirma = trabajos.filter((t) => EN_FIRMA.includes(t.estado));
    const hechas = [...trabajos.filter((t) => HECHA.includes(t.estado)),
      ...lista.filter((x) => (x.ya_ofertada || x.trabajada) && !trabajo(x.codigo)).map((x) => ({ ...x, _oport: true }))];
    const papelera = lista.filter((x) => descartada(x.codigo));
    const esSeg = (x) => /^segundo/i.test(x.llamado || "");
    const verN = nuevas.filter((x) => filtro === "lic" ? lic(x) : !lic(x) && (filtro === "seg" ? esSeg(x) && x.tipo !== "esp"
      : filtro === "exp" ? x.tipo === "exp" : x.tipo !== "esp"))
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
            <div style="margin:2px 0">${esc(x.nombre)}</div>
            <div class="muted" style="font-size:.75rem">${/^segundo/i.test(x.llamado || "") ? `<b style="color:#ffb347">🔥 2° llamado</b>${(x.ofertas ?? 9) <= 2 ? '<span class="rb-chip">🎯 casi sin competencia</span>' : ""} · ` : ""}${esc(x.organismo)}${x.region ? " · " + esc(x.region.replace(/^Región (de |del |de la )?/i, "")) : ""}${x.ofertas != null && !lic(x) ? ` · ${x.ofertas ? x.ofertas + " cotizaciones" : "sin cotizaciones aún"}` : ""}</div>
            <div style="font-size:.8rem;margin-top:3px">Gana ≈ <b>${clp(x.ganancia)}</b> · Ppto. ${clp(x.monto)}${x.monto_estimado ? " (estimado)" : ""} · <span style="${h < 12 ? "color:#ff8a80;font-weight:700" : ""}">cierra en ${h} h</span></div>
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
    const enviadasCods = new Set(trabajos.filter((t) => HECHA.includes(t.estado)).map((t) => t.codigo));
    // Seleccionadas: las que elegiste y todavía no van al robot (cuando las mandas a firmar pasan a «Por firmar»)
    const sel = Object.keys(selObj).filter((c) => !enviadasCods.has(c) && !trabajo(c) && !lista.find((x) => x.codigo === c && x.ya_ofertada))
      .map((c) => ({ ...selObj[c], ...(lista.find((x) => x.codigo === c) || {}), codigo: c, _sel: selObj[c] }))
      .sort((a, b) => (a.cierre || "9").localeCompare(b.cierre || "9"));
    if (!R.sel && !R._selPedido) { R._selPedido = true; cargarSel().then(pintarHoja); }
    const enviadosAll = trabajos.filter((t) => HECHA.includes(t.estado)).sort((a, b) => (b.actualizado || "").localeCompare(a.actualizado || ""));
    if ((tab === "hechas" || tab === "ganadas" || !R.seg) && enviadosAll.length && (!R.segT || Date.now() - R.segT > 60_000)) cargarSeg(false);
    const ganadasT = enviadosAll.filter((t) => segDe(t.codigo)?.ganada);
    const enviadosT = enviadosAll.filter((t) => !segDe(t.codigo)?.ganada);
    const tabs = [["nuevas", "👆 Por preparar", nuevas.length], ["sel", "⭐ Seleccionadas", sel.length], ["firmar", "✍ Por firmar", enFirma.length],
      ["hechas", "📨 Enviadas", enviadosT.length], ["ganadas", "🏆 Ganadas", ganadasT.length], ["papelera", "🗑 No deseadas", papelera.length]];
    const tarjetaSel = (x) => {
      const pres = Number(x.monto) || 0;
      const margenRubro = Number(x._sel.margen ?? x.margen) || 0.2;
      const costoEst = Math.round(pres / 1.19 * (1 - margenRubro));
      const costo = Number(x._sel.costo) || 0;
      const precio0 = Math.round(Math.min(x._sel.precio || pres * (1 - (leer().descuento ?? 0.08)), pres * 1.5));
      const h = x.cierre ? Math.round((Date.parse(x.cierre) - ahora) / 3600000) : null;
      return `<div class="rb-card rb-sel" data-c="${esc(x.codigo)}" data-pres="${pres}" data-costo="${costo || costoEst}" data-est="${costo ? 0 : 1}" style="padding:12px;margin:8px 0">
        <div class="rb-env"><div style="min-width:0"><div style="font-size:.78rem"><b>${esc(x.codigo)}</b>${h != null ? ` · <span style="${h < 12 ? "color:#ff8a80;font-weight:700" : ""}">cierra en ${h} h</span>` : ""}</div>
          <div style="margin:2px 0">${esc(x.nombre || "Compra Ágil")}</div><div class="muted" style="font-size:.74rem">${esc(x.organismo || "")} · Ppto. <b>${clp(pres)}</b></div></div>
          <button type="button" class="rb-estrella on" data-rb="sel-quitar" data-c="${esc(x.codigo)}" title="Devolver a Por preparar">★</button></div>
        ${pres ? `<div style="margin-top:10px"><span class="muted" style="font-size:.74rem">Tu precio con IVA</span><br><span class="rb-precio">${clp(precio0)}</span><span class="rb-pct"></span></div>
        <input type="range" class="rb-range" min="${Math.round(pres * 0.5)}" max="${Math.round(pres * 1.5)}" step="${Math.max(10, Math.round(pres / 2000 / 10) * 10)}" value="${precio0}">
        <div class="rb-escala"><span>−50%</span><span>Presupuesto ${clp(pres)}</span><span>+50%</span></div>
        ${(() => { const sg = sugerido(x); const v = Math.round(pres * (1 - sg.d)); return `<div class="rb-sug">💡 <b>Sugerido ${clp(v)}</b> (${sg.d ? "−" + Math.round(sg.d * 100) + "%" : "presupuesto completo"}) · ${esc(sg.por)}
          <button class="btn small" type="button" data-fijo="${v}" style="margin-left:6px">Usar</button></div>`; })()}
        <div class="rb-pasos2"><button class="btn small" type="button" data-paso="-10">−10%</button><button class="btn small" type="button" data-paso="-5">−5%</button><button class="btn small" type="button" data-paso="-1">−1%</button>
          <button class="btn small" type="button" data-paso="1">+1%</button><button class="btn small" type="button" data-paso="5">+5%</button><button class="btn small" type="button" data-paso="10">+10%</button></div>
        <div class="rb-mini"><div><small>Ganancia</small><b class="rb-gan">—</b></div><div><small>Margen</small><b class="rb-mar">—</b></div>
          <div><small>Neto (sin IVA)</small><b class="rb-neto">—</b></div><div><small>Bajo el presupuesto</small><b class="rb-bajo">—</b></div></div>
        <label class="muted" style="font-size:.72rem;display:block">Mi costo neto total <span class="rb-cest">${costo ? "" : `(estimado ${Math.round(margenRubro * 100)}% margen del rubro)`}</span>
          <input class="rb-costo" inputmode="numeric" value="${(costo || costoEst).toLocaleString("es-CL")}" style="width:100%;margin-top:3px;padding:8px;border-radius:10px;border:1px solid var(--line-soft);background:rgba(255,255,255,.05);color:inherit;font:inherit"></label>
        <div class="rb-sobre muted" style="display:none;color:#ff9a9a;font-size:.78rem;margin-top:6px">⚠ Supera el presupuesto: se ofertará el presupuesto (${clp(pres)}).</div>
        <button class="btn rb-firmar" type="button" style="width:100%;margin-top:8px" data-rb="sel-preparar" data-c="${esc(x.codigo)}">✍ Firmar con <span class="rb-p2">${clp(Math.min(precio0, pres))}</span></button>
        <div class="muted" style="font-size:.7rem;margin-top:4px;text-align:center">el robot arma cotización y PDF y la deja en ✍ Por firmar</div>`
        : `<div class="muted" style="margin-top:8px">Sin presupuesto conocido: abre la compra para ver el monto.</div>`}
      </div>`;
    };
    // ---- 🎯 precio sugerido según el llamado y la competencia (lección: en 2° llamado casi nadie compite)
    const sugerido = (x) => {
      const seg = esSeg(x), of = x.ofertas ?? null;
      const d = seg ? (of === 0 ? 0 : of === 1 ? 0.02 : of != null && of <= 3 ? 0.04 : 0.07) : (of != null && of <= 1 ? 0.04 : of != null && of <= 3 ? 0.06 : 0.09);
      const por = seg ? (of === 0 ? "2° llamado y nadie ha cotizado: oferta el presupuesto completo"
        : of != null && of <= 3 ? `2° llamado con solo ${of} cotización${of === 1 ? "" : "es"}: pocos compiten, no regales margen`
        : "2° llamado: menos competencia que en el primero") : (of != null && of <= 3 ? `Primer llamado con ${of} cotizaciones` : "Primer llamado: más competencia, baja un poco más");
      return { d, por };
    };
    // ---- marcador: lo que motiva (ganado, utilidad, tasa de éxito, en juego)
    const decididas = enviadosAll.filter((t) => { const g = segDe(t.codigo); return g && (g.ganada || g.estado === "proveedor_seleccionado"); });
    const ganadoMonto = ganadasT.reduce((s, t) => s + (Number(t.total) || 0), 0);
    const utilidadG = ganadasT.reduce((s, t) => s + (Number(t.op?.informe?.final) || Math.round((Number(t.total) || 0) * 0.13)), 0);
    const enJuego = enviadosAll.filter((t) => ["publicada", "cerrada"].includes(segDe(t.codigo)?.estado)).reduce((s, t) => s + (Number(t.total) || 0), 0);
    const tasa = decididas.length ? Math.round(ganadasT.length / decididas.length * 100) : null;
    const corto = (n) => n >= 1e6 ? "$" + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + "M" : clp(n);
    const marcador = `<div class="rb-marcador">
      <div class="rb-m oro"><span>🏆 Ganado</span><b>${corto(ganadoMonto)}</b><small>${ganadasT.length} adjudicada${ganadasT.length === 1 ? "" : "s"}</small></div>
      <div class="rb-m verde"><span>💰 Utilidad</span><b>${corto(utilidadG)}</b><small>${ganadasT.some((t) => t.op?.informe?.final != null) ? "según informes" : "estimada"}</small></div>
      <div class="rb-m azul"><span>🎯 Tasa de éxito</span><b>${tasa == null ? "—" : tasa + "%"}</b><small>${ganadasT.length} de ${decididas.length} resueltas</small></div>
      <div class="rb-m violeta"><span>⏳ En juego</span><b>${corto(enJuego)}</b><small>${enviadosAll.length - decididas.length} esperando resultado</small></div></div>`;
    // ---- 🏆 negocios ganados por etapa
    const ETAPAS = [["ganada", "🏆 Nuevas"], ["inversionista", "💼 Inversionista"], ["operacion", "🛠 Operación"], ["despacho", "🚚 Despacho"], ["entrega", "📸 Entrega"], ["cerrado", "🥇 Cerrados"]];
    const etapaDe = (t) => t.op?.etapa || "ganada";
    const netapa = R.netapa || "ganada";
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
      if (et === "ganada") cuerpoE = `<div class="rb-acc">${archivos}${btnInf}</div>
        <button class="btn rb-firmar" type="button" style="width:100%;margin-top:8px" data-rb="neg-etapa" data-e="inversionista" data-c="${esc(t.codigo)}">💼 Pasar a Inversionista</button>`;
      else if (et === "inversionista") cuerpoE = `<div class="rb-mini"><div><small>Capital a invertir (90%)</small><b>${num(inf.anticipo)}</b></div><div><small>Gana inversionista (15,6%)</small><b style="color:#7ee2a0">${num(inf.inversionista)}</b></div>
          <div><small>JULFIOR (84,4%)</small><b>${num(inf.julfior)}</b></div><div><small>Rentabilidad</small><b>${inf.rentabilidad != null ? (inf.rentabilidad * 100).toFixed(1).replace(".", ",") + "%" : "—"}</b></div></div>
        <label class="muted" style="font-size:.74rem;display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" data-rb-com="aplica" data-c="${esc(t.codigo)}" ${op.aplica_comision !== false ? "checked" : ""}> Comisión del ingresador
          <select data-rb-com="pct" data-c="${esc(t.codigo)}" style="margin-left:auto;background:transparent;color:inherit;border:1px solid var(--line-soft);border-radius:8px;padding:3px">${[1,2,3,4,5,6,7,8,9,10].map((v) => `<option value="${v / 100}" ${Math.round((op.comision ?? 0.04) * 100) === v ? "selected" : ""}>${v}%</option>`).join("")}</select></label>
        <div class="rb-acc">${archivos}${btnInf}</div>
        <button class="btn rb-firmar" type="button" style="width:100%;margin-top:8px" data-rb="neg-etapa" data-e="operacion" data-c="${esc(t.codigo)}">✅ Inversión aprobada → Operación</button>`;
      else if (et === "operacion") cuerpoE = `${(inf.opciones || []).map((o, k) => `<div class="rb-op ${(op.opcion ?? inf.elegida ?? 0) === k ? "on" : ""}">
          <div class="rb-env"><b>Opción ${"AB"[k]} · ${esc(o.proveedor || "")}</b><b>${num(o.total_con_iva)}</b></div>
          <div class="muted" style="font-size:.72rem">${esc(o.cubre || "")}${o.despacho ? " · despacho " + esc(o.despacho) : ""}${o.plazo ? " · " + esc(o.plazo) : ""}</div>
          <div class="rb-acc">${tel(o.telefono) ? `<a class="btn small" href="tel:${esc(tel(o.telefono))}">📞 Llamar</a>` : ""}${wa(o.telefono) ? `<a class="btn small" href="https://wa.me/${wa(o.telefono)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
            <a class="btn small" href="${correo(t, o)}">✉ Pedir precio y descuento</a>${o.web ? `<a class="btn small" href="${esc(o.web)}" target="_blank" rel="noopener">🌐 Web</a>` : ""}
            ${(op.opcion ?? inf.elegida ?? 0) === k ? "" : `<button class="btn small" type="button" data-rb="neg-opcion" data-k="${k}" data-c="${esc(t.codigo)}">Elegir esta</button>`}</div></div>`).join("") || `<div class="muted" style="font-size:.78rem">Sin proveedores aún: toca «Armar informe».</div>`}
        ${inf.comprador?.email || inf.comprador?.telefono ? `<div class="muted" style="font-size:.74rem;margin-top:6px">Contacto del comprador: <b>${esc(inf.comprador.nombre || "")}</b> ${inf.comprador.telefono ? `· <a href="tel:${esc(tel(inf.comprador.telefono))}">${esc(inf.comprador.telefono)}</a>` : ""} ${inf.comprador.email ? `· <a href="mailto:${esc(inf.comprador.email)}">${esc(inf.comprador.email)}</a>` : ""}</div>` : ""}
        <label class="muted" style="font-size:.74rem;display:block;margin-top:8px">Precio final acordado con el proveedor (con IVA)
          <input class="rb-neg-in" data-campo="precio_acordado" data-c="${esc(t.codigo)}" inputmode="numeric" value="${op.precio_acordado ? Number(op.precio_acordado).toLocaleString("es-CL") : ""}" placeholder="${inf.compras ? Number(inf.compras).toLocaleString("es-CL") : ""}" style="width:100%;margin-top:3px;padding:8px;border-radius:10px;border:1px solid var(--line-soft);background:rgba(255,255,255,.05);color:inherit;font:inherit"></label>
        <div class="rb-acc">${archivos}${btnInf}</div>
        <button class="btn rb-firmar" type="button" style="width:100%;margin-top:8px" data-rb="neg-etapa" data-e="despacho" data-c="${esc(t.codigo)}">✅ Compra hecha → Despacho</button>`;
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
      else cuerpoE = `<div style="font-weight:900;font-size:1.05rem;margin-top:6px">🥇 Negocio cerrado${op.cerrado ? " · " + esc(new Date(op.cerrado).toLocaleDateString("es-CL")) : ""}</div>`;
      return `<div class="rb-neg ${et === "cerrado" ? "cerrado" : ""}">
        <div class="rb-env"><div style="min-width:0"><div style="font-size:.76rem"><b>${esc(t.codigo)}</b> · OC <b>${esc(g.oc || inf.oc || op.oc || "—")}</b></div>
          <div style="margin:2px 0;font-weight:700">${esc(t.nombre || "Compra Ágil")}</div><div class="muted" style="font-size:.72rem">${esc(t.organismo || "")}</div></div>
          <div style="text-align:right"><div style="font-size:.66rem;opacity:.8">VENTA</div><b>${clp(t.total)}</b></div></div>
        <div class="rb-prog">${ETAPAS.map((e, i) => `<i class="${i <= idx ? "ok" : ""}"></i>`).join("")}</div>
        <div class="rb-env" style="align-items:flex-end"><div><div style="font-size:.66rem;opacity:.8">UTILIDAD FINAL</div><div class="rb-big">${inf.final != null ? clp(inf.final) : "—"}</div></div>
          <div style="text-align:right;font-size:.74rem">${inf.rentabilidad != null ? `rentabilidad <b>${(inf.rentabilidad * 100).toFixed(1).replace(".", ",")}%</b>` : ""}${inf.margen != null ? `<br>margen <b>${(inf.margen * 100).toFixed(1).replace(".", ",")}%</b>` : ""}</div></div>
        ${dejado ? `<div class="rb-sug">💸 Podías cobrar hasta <b>${clp((t.total || 0) + dejado)}</b> y seguir ganando: quedaron <b>${clp(dejado)}</b> en la mesa. La barra ya sugiere precios más altos en segundos llamados.</div>` : ""}
        ${inf.error ? `<div class="muted" style="color:#ff9a9a;font-size:.74rem">Informe: ${esc(inf.error)}</div>` : ""}
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
      ${g?.ganada ? `<div style="margin-top:6px;font-size:.8rem">El organismo emitió la <b>orden de compra ${esc(g.oc || "")}</b>. Revísala y acéptala en Mercado Público.</div>` : ""}
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${t.comprobante ? `<button class="btn small rb-firmar" data-rb="comprobante" data-c="${esc(t.codigo)}" type="button">🧾 Comprobante PDF</button>` : ""}
        ${t.pdf ? `<button class="btn small" data-rb="pdf" data-c="${esc(t.codigo)}" type="button">Oferta PDF</button>` : ""}
        <a class="btn small" href="${portalDe(t.codigo)}" target="_blank" rel="noopener noreferrer">Mercado Público ↗</a></div></div>`;
    };
    let cuerpo;
    if (tab === "nuevas") cuerpo = `<div class="row" style="gap:6px;margin:6px 0">
        <button class="btn small ${filtro === "seg" ? "rb-firmar" : ""}" type="button" data-rb="oport-filtro" data-f="seg">🔥 2° llamado</button>
        <button class="btn small ${filtro === "exp" ? "rb-firmar" : ""}" type="button" data-rb="oport-filtro" data-f="exp">★ Lo que ya vendemos</button>
        <button class="btn small ${filtro === "todas" ? "rb-firmar" : ""}" type="button" data-rb="oport-filtro" data-f="todas">Compras Ágiles</button>
        <button class="btn small ${filtro === "lic" ? "rb-firmar" : ""}" type="button" data-rb="oport-filtro" data-f="lic">📑 Licitaciones</button>
        <button class="btn small" type="button" data-rb="oport-actualizar">↻ Buscar más</button></div>
      <div class="muted" style="font-size:.74rem;margin-bottom:4px">Desliza → <b>me gusta</b> (pasa a ⭐ Seleccionadas para elegir el precio) · ← <b>no</b> (va a No deseadas)</div>
      ${verN.slice(0, n).map((x) => fila(x, "nuevas")).join("") || `<div class="empty">No quedan oportunidades en esta vista. Toca «↻ Buscar más».</div>`}
      ${verN.length > n ? `<button class="btn" style="width:100%;margin-top:8px" type="button" data-rb="oport-mas">Ver más (${verN.length - n} restantes)</button>` : ""}`;
    else if (tab === "firmar") cuerpo = enFirma.length ? `<div class="rb-cajas">${[...enFirma].sort((a, b) => ordenF(a) - ordenF(b)).map(caja).join("")}</div>`
      : `<div class="empty">Nada por firmar. Desliza a la derecha en «Por preparar».</div>`;
    else if (tab === "sel") cuerpo = sel.length ? `<div class="muted" style="font-size:.74rem;margin:6px 0">Ajusta el precio con la barra (hasta 50% bajo o sobre el presupuesto) mirando ganancia y margen. «Firmar» la manda al robot.</div>${sel.map(tarjetaSel).join("")}`
      : `<div class="empty">Desliza a la derecha las que te gusten en «👆 Por preparar» y aparecen aquí.</div>`;
    else if (tab === "hechas") cuerpo = enviadosT.length ? `<div class="row" style="justify-content:space-between;align-items:center;margin:6px 0"><span class="muted" style="font-size:.74rem">${enviadosT.length} enviadas · ${clp(enviadosT.reduce((s, t) => s + (Number(t.total) || 0), 0))} · estado en vivo de Mercado Público${R.segT ? " (" + esc(hace(new Date(R.segT).toISOString())) + ")" : ""}</span>
        <button class="btn small" type="button" data-rb="seg-actualizar">↻</button></div>${enviadosT.map(enviado).join("")}`
      : `<div class="empty">Aún no hay ofertas enviadas.</div>`;
    else if (tab === "ganadas") cuerpo = ganadasT.length ? `<div class="rb-etapas">${ETAPAS.map(([k, n]) => `<button type="button" class="${netapa === k ? "on" : ""}" data-rb="neg-tab" data-e="${k}">${n} ${ganadasT.filter((t) => etapaDe(t) === k).length}</button>`).join("")}</div>
      ${ganadasT.filter((t) => etapaDe(t) === netapa).map(negocioCard).join("") || `<div class="empty">Nada en esta etapa.</div>`}`
      : `<div class="empty">${R._cargandoSeg ? "Revisando en Mercado Público…" : "Todavía no hay ganadas. Cuando el organismo te elija aparecen aquí con su orden de compra."}</div>`;
    else cuerpo = papelera.length ? `<div class="muted" style="font-size:.74rem;margin:6px 0">Desliza → o toca «Recuperar» para devolverla a Por preparar.</div>${papelera.map((x) => fila(x, "papelera")).join("")}`
      : `<div class="empty">La papelera está vacía.</div>`;
    return `<div class="muted" style="font-size:.78rem;margin:6px 0">Ordenadas por ganancia estimada · ${o.fecha ? "actualizado " + esc(hace(o.fecha)) : "sin datos aún"}${o.resumen ? ` · ${o.resumen.total} vigentes en el portal` : ""}</div>
      ${marcador}
      <div class="rb-otabs">${tabs.map(([k, t, c]) => `<button type="button" class="${tab === k ? "on" : ""}" data-rb="oport-tab" data-t="${k}">${t}<i>${c}</i></button>`).join("")}</div>
      ${cuerpo}`;
  }
  async function oportDecidir(cod, si, el) {
    const x = (R.oport?.lista || []).find((y) => y.codigo === cod);
    const esLic = x?.fuente === "licitacion";
    if (el) { el.style.transition = "transform .25s ease, opacity .25s"; el.style.transform = `translateX(${si ? 130 : -130}%) rotate(${si ? 12 : -12}deg)`; el.style.opacity = "0"; }
    if (si && !esLic) {                               // Compra Ágil: pasa a ⭐ Seleccionadas para elegir el precio
      toast("⭐ A Seleccionadas: ahí eliges el precio y firmas");
      await ponerSel(cod);
    } else if (si) {
      try {
        const r = await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: esLic ? "licitar" : "firmar", ...(esLic ? {} : { descuento: leer().descuento ?? 0.08 }) }) });
        toast(r._status === 409 ? "Ya estaba en manos del robot" : esLic ? "📑 El robot prepara la licitación" : "✍ El robot la deja lista para firmar");
        await refrescar();
      } catch (e) { toast(e.message); }
    } else {
      R.desc = { ...(R.desc || {}), [cod]: new Date().toISOString() };
      R.deshacer = cod;
      toast("🗑 A No deseadas");
      api("oport-descartar", { method: "POST", body: JSON.stringify({ codigo: cod, descartar: true }) }).catch((e) => toast(e.message));
    }
    setTimeout(pintarHoja, el ? 260 : 0);
  }
  async function oportRestaurar(cod, el) {
    if (el) { el.style.transition = "transform .25s ease, opacity .25s"; el.style.transform = "translateX(130%)"; el.style.opacity = "0"; }
    if (R.desc) delete R.desc[cod];
    if (R.oport?.descartes) delete R.oport.descartes[cod];
    toast("↩ De vuelta en Por preparar");
    api("oport-descartar", { method: "POST", body: JSON.stringify({ codigo: cod, descartar: false }) }).catch((e) => toast(e.message));
    setTimeout(pintarHoja, el ? 260 : 0);
  }
  // deslizar con el dedo (como Tinder): → sí, ← no
  (function swipe() {
    let el = null, x0 = 0, y0 = 0, dx = 0, horiz = null;
    const fin = () => { R.arrastrando = false; el = null; horiz = null; };
    document.addEventListener("pointerdown", (ev) => {
      const c = ev.target.closest?.(".rb-swipe");
      if (!c || ev.target.closest("button,a,input")) return;
      el = c; x0 = ev.clientX; y0 = ev.clientY; dx = 0; horiz = null;
    }, { passive: true });
    document.addEventListener("pointermove", (ev) => {
      if (!el) return;
      dx = ev.clientX - x0; const dy = ev.clientY - y0;
      if (horiz === null && Math.abs(dx) + Math.abs(dy) > 12) horiz = Math.abs(dx) > Math.abs(dy) * 1.2;
      if (!horiz) return;
      R.arrastrando = true;
      el.style.transition = "none";
      el.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
      const papel = el.dataset.modo === "papelera";
      el.querySelector(".rb-sello.si").style.opacity = Math.max(0, Math.min(1, dx / 100));
      el.querySelector(".rb-sello.no").style.opacity = papel ? 0 : Math.max(0, Math.min(1, -dx / 100));
    }, { passive: true });
    const soltar = () => {
      if (!el) return;
      const c = el, papel = c.dataset.modo === "papelera";
      if (horiz && dx > 100) { papel ? oportRestaurar(c.dataset.c, c) : oportDecidir(c.dataset.c, true, c); }
      else if (horiz && dx < -100 && !papel) oportDecidir(c.dataset.c, false, c);
      else { c.style.transition = "transform .2s"; c.style.transform = ""; c.querySelectorAll(".rb-sello").forEach((s) => (s.style.opacity = 0)); }
      fin();
    };
    document.addEventListener("pointerup", soltar, { passive: true });
    document.addEventListener("pointercancel", soltar, { passive: true });
  })();
  async function cargarOport() {
    if (R._cargandoOport) return; R._cargandoOport = true;
    try { R.oport = await api("oportunidades"); R.oport.descartes = R.oport.descartes || {}; } catch (e) { R.oport = { lista: [], error: e.message }; toast(e.message); }
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

  function pantallaLista() {
    const r = R.data?.robot;
    const lista = R.data?.trabajos || [];
    const conectado = r?.conectado;
    const permiso = "Notification" in window ? Notification.permission : "unsupported";
    const pushPosible = "PushManager" in window && permiso !== "denied";
    const vista = { lista: vistaLista, cajas: vistaCajas, tablero: vistaTablero, oport: vistaOport }[R.vista] || vistaCajas;
    return `
      <div class="rb-sheet-head"><h2 style="margin:0">Robot de ofertas</h2><button class="rb-x" type="button" data-rb="cerrar" aria-label="Cerrar">✕</button></div>
      <div class="rb-status ${conectado ? "on" : ""}"><span class="rb-dot"></span>
        <span>${!R.data ? (R.err ? esc(R.err) : '<span class="spinner"></span>') : conectado
          ? `PC conectado${r.equipo ? " · " + esc(r.equipo) : ""}${r.ocupado && r.tarea ? " · " + esc(r.tarea) : " · libre"}`
          : `PC desconectado${r?.visto ? " · visto " + esc(hace(r.visto)) : ""}. Abre el panel del robot en el PC.`}</span></div>
      ${R.data ? (() => { const mp = R.data.mp; return `<div class="rb-status ${mp?.conectado ? "on" : ""}" style="align-items:center"><span class="rb-dot"></span>
        <span style="flex:1">${mp?.conectado ? `Mercado Público conectado en Safari · ${esc(hace(mp.visto))}`
          : `Mercado Público desconectado${mp?.visto ? " · visto " + esc(hace(mp.visto)) : ""}`}</span>
        ${mp?.conectado ? "" : `<button class="btn small rb-firmar" data-rb="conectar-mp" type="button">Conéctate a tu Mercado Público</button>`}</div>`; })() : ""}
      <div class="row" style="margin:6px 0 4px">
        <div class="field" style="flex:1;min-width:150px"><input id="rbCod" placeholder="Uno o varios códigos (ej. 3704-203-COT26, 1261-12-COT26)" autocomplete="off" autocapitalize="characters"></div>
        <button class="btn small rb-firmar" type="button" data-rb="nuevo">✍ Preparar</button>
      </div>
      ${(!R.push && pushPosible) || R.instalar || (esIOS && !instalada()) ? `<div class="row" style="margin-top:6px;gap:8px">
        ${!R.push && pushPosible && !(esIOS && !instalada()) ? `<button class="btn small" type="button" data-rb="avisos">🔔 Activar avisos (aunque la app esté cerrada)</button>` : ""}
        ${R.instalar ? `<button class="btn small" type="button" data-rb="instalar">📲 Instalar app</button>` : ""}
        ${esIOS && !instalada() ? `<div class="note" style="margin:0">En iPhone: toca <b>Compartir</b> → <b>Agregar a pantalla de inicio</b>. Desde ahí la app recibe avisos.</div>` : ""}
      </div>` : ""}
      ${lista.length || R.vista === "oport" ? (lista.length ? kpis(lista) : "") + `<div class="rb-vistas" role="tablist">${VISTAS.map(([k, n]) =>
        `<button type="button" role="tab" aria-selected="${R.vista === k}" class="${R.vista === k ? "on" : ""}" data-rb="vista" data-v="${k}">${n}</button>`).join("")}</div>` + vista(lista) : ""}
      ${R.data && !lista.length ? `<div class="empty">Aún no hay ofertas. Toca «Hacer oferta» en una Compra Ágil.</div>` : ""}
      <details class="rb-ajustes"><summary>Ajustes</summary>
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

  function pintarHoja() {
    const box = $("#rbIn"); if (!box || R.arrastrando || R.barra) return;
    const y = sheet.scrollTop;
    // el repintado cada pocos segundos no debe cerrar lo que la persona abrió
    const abiertos = new Set($$("details", box).map((d, i) => d.open && (d.closest("[id]")?.id || "") + d.className + i).filter(Boolean));
    const tabX = $(".rb-tablero", box)?.scrollLeft || 0;
    box.innerHTML = !R.token ? pantallaEnlace() : R.conf ? pantallaConfirmar(R.conf)
      : R.detalle ? pantallaDetalle(R.detalle) : pantallaLista();
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

  sheet.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-rb]"); if (!b) return;
    const a = b.dataset.rb, cod = b.dataset.c;
    if (a === "cerrar") return cerrar();
    if (a === "volver") { R.conf = null; return pintarHoja(); }
    if (a === "enlazar") { if (enlazar($("#rbTok")?.value)) pintarHoja(); return; }
    if (a === "desenlazar") { R.token = null; R.data = null; guardar({ token: null }); return pintarHoja(); }
    if (a === "avisos") { if (await suscribirPush(true)) toast("Avisos activados en este teléfono"); return pintarHoja(); }
    if (a === "push-probar") { try { await api("push-probar", { method: "POST", body: "{}" }); toast("Aviso de prueba enviado"); } catch (e) { toast(e.message); } return; }
    if (a === "instalar") { const p = R.instalar; R.instalar = null; try { await p?.prompt(); } catch {} return pintarHoja(); }
    if (a === "vista") { R.vista = b.dataset.v; guardar({ vista: R.vista, v_cajas: 1 }); if (R.vista === "oport") R.oport = null; return pintarHoja(); }
    if (a === "oport-filtro") { R.oportFiltro = b.dataset.f; R.oportN = 40; return pintarHoja(); }
    if (a === "oport-tab") { R.oportTab = b.dataset.t; R.oportN = 40; sheet.scrollTop = 0; return pintarHoja(); }
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
        if (a === "neg-etapa") { R.netapa = b.dataset.e; toast("✓ Avanzó a " + (b.textContent.split("→")[1] || b.dataset.e).trim()); } else toast("El PC recalcula el informe (1–2 min)");
        await refrescar(); pintarHoja(); } catch (e) { toast(e.message); }
      return;
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
          if (b.dataset.cerrar) { R.netapa = "cerrado"; toast("🥇 ¡Negocio cerrado en oro!"); } else toast("✓ Archivo guardado");
          await refrescar(); pintarHoja();
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
    if (a === "sel-preparar") {
      const c = b.closest(".rb-sel"); const pres = +c.dataset.pres; const v = Math.min(+c.querySelector(".rb-range").value, pres);
      const descuento = Math.max(0, Math.min(0.6, 1 - v / pres));
      guardarSelLuego(cod, { precio: v });
      b.disabled = true;
      try {
        const r = await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "firmar", descuento }) });
        toast(r._status === 409 ? "Ya estaba en manos del robot" : `✍ El robot la prepara por ${clp(v)} · la verás en Por firmar`);
        R.oportTab = "firmar"; R.barra = false; sheet.scrollTop = 0;
        await refrescar(); pintarHoja();
      } catch (e) { toast(e.message); b.disabled = false; }
      return;
    }
    if (a === "oport-si") return oportDecidir(cod, true, b.closest(".rb-swipe"));
    if (a === "oport-no") return oportDecidir(cod, false, b.closest(".rb-swipe"));
    if (a === "oport-restaurar") return oportRestaurar(cod, b.closest(".rb-swipe"));
    if (a === "oport-actualizar") {
      try { await api("oportunidades-actualizar", { method: "POST", body: "{}" }); toast("El robot está bajando las oportunidades nuevas (1–2 min)"); }
      catch (e) { toast(e.message); }
      setTimeout(() => { R.oport = null; if (R.vista === "oport") pintarHoja(); }, 90000);
      return;
    }
    if (a === "licitar") {
      if (!confirm(`¿Participar en la licitación ${cod}?\n\nEl robot baja la ficha y los anexos (te pedirá el código de la imagen), analiza las bases, fija el precio (presupuesto −17%) y llena los papeles. Después te pregunta si te parece el precio.`)) return;
      try { const r = await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "licitar" }) });
        toast(r._status === 409 ? "Ya está en manos del robot" : "El robot empezó con la licitación"); R.vista = "lista"; await refrescar(); }
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
    if (a === "det") { R.detalle = cod; sheet.scrollTop = 0; return pintarHoja(); }
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
    if (a === "conectar-mp") {
      if (esIOS && instalada()) { abrirEnSafari("conectar"); return; }
      window.open(location.origin + "/firmar.html#conectar", "_blank"); return;
    }
    if (a === "ir-firmar") {
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
    if (a === "verificar") {
      try { await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "verificar", dispositivo: dispositivo(true) }) }); toast("El robot revisará el portal"); await refrescar(); }
      catch (e) { toast(e.message); }
      return;
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
  function pintarSel(c, guardarAhora) {
    const r = c.querySelector(".rb-range"); if (!r) return;
    const pres = +c.dataset.pres, v = +r.value, ve = Math.min(v, pres);
    const costo = +(c.querySelector(".rb-costo")?.value || "").replace(/\D/g, "") || +c.dataset.costo || 0;
    c.querySelector(".rb-precio").textContent = clp(v);
    const p = c.querySelector(".rb-pct"), d = v / pres - 1;
    p.textContent = (d > 0 ? "+" : "") + (d * 100).toFixed(1).replace(".", ",") + "% vs presupuesto"; p.className = "rb-pct " + (d < 0 ? "baja" : "sube");
    const neto = ve / 1.19, gan = neto - costo, mar = neto ? gan / neto : 0;
    c.querySelector(".rb-neto").textContent = clp(neto);
    const g = c.querySelector(".rb-gan"); g.textContent = clp(gan); g.style.color = gan < 0 ? "#ff8a80" : "#7ee2a0";
    const m = c.querySelector(".rb-mar"); m.textContent = (mar * 100).toFixed(1).replace(".", ",") + "%"; m.style.color = mar < 0 ? "#ff8a80" : mar < 0.08 ? "#ffd88a" : "#7ee2a0";
    c.querySelector(".rb-bajo").textContent = ((1 - ve / pres) * 100).toFixed(1).replace(".", ",") + "%";
    c.querySelector(".rb-sobre").style.display = v > pres ? "block" : "none";
    c.querySelector(".rb-p2").textContent = clp(ve);
    const pct = (v - r.min) / (r.max - r.min) * 100; r.style.background = `linear-gradient(90deg,#7c4dff ${pct}%,#2a3550 ${pct}%)`;
    if (guardarAhora) guardarSelLuego(c.dataset.c, { precio: v });
  }
  sheet.addEventListener("input", (ev) => {
    const c = ev.target.closest?.(".rb-sel"); if (!c || !ev.target.classList.contains("rb-costo")) return;
    const n = ev.target.value.replace(/\D/g, ""); ev.target.value = n ? (+n).toLocaleString("es-CL") : "";
    const e = c.querySelector(".rb-cest"); if (e) e.textContent = "";
    pintarSel(c, false); guardarSelLuego(c.dataset.c, { costo: +n || null });
  });
  sheet.addEventListener("change", async (ev) => {
    const el = ev.target, cod = el.dataset?.c; if (!cod) return;
    let datos = null, informe = false;
    if (el.classList.contains("rb-neg-in")) { const v = el.dataset.campo === "transporte" ? el.value : +(el.value || "").replace(/\D/g, "") || null; datos = { [el.dataset.campo]: v }; informe = el.dataset.campo !== "transporte"; }
    if (el.dataset.rbChk) datos = { [el.dataset.rbChk]: el.checked };
    if (el.dataset.rbCom === "aplica") { datos = { aplica_comision: el.checked }; informe = true; }
    if (el.dataset.rbCom === "pct") { datos = { comision: +el.value, aplica_comision: true }; informe = true; }
    if (!datos) return;
    try { await api("operacion", { method: "POST", body: JSON.stringify({ codigo: cod, datos, pedir_informe: informe }) }); toast(informe ? "Guardado · el PC recalcula la utilidad" : "Guardado"); await refrescar(); }
    catch (e) { toast(e.message); }
  });
  sheet.addEventListener("focusin", (ev) => { if (ev.target.classList?.contains("rb-costo") || ev.target.classList?.contains("rb-neg-in")) R.barra = true; });
  sheet.addEventListener("focusout", (ev) => { if (ev.target.classList?.contains("rb-costo") || ev.target.classList?.contains("rb-neg-in")) setTimeout(() => { R.barra = false; }, 300); });
  // fotos grandes se achican antes de subir (máx. ~1600 px, JPEG), los PDF van tal cual
  async function achicar(f) {
    const leerB64 = (blob) => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = mal; r.readAsDataURL(blob); });
    if (!f.type.startsWith("image/") || f.size < 900_000) { if (f.size > 4_400_000) throw new Error("El archivo pesa más de 4 MB"); return { data: await leerB64(f), mime: f.type || "application/pdf" }; }
    const img = await createImageBitmap(f); const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.82));
    return { data: await leerB64(blob), mime: "image/jpeg" };
  }
  // mientras mueves la barra no se repinta la pantalla (si no, la barra «salta»)
  sheet.addEventListener("pointerdown", (ev) => { if (ev.target.classList?.contains("rb-range")) R.barra = true; });
  ["pointerup", "pointercancel"].forEach((n) => document.addEventListener(n, () => { if (R.barra) setTimeout(() => { R.barra = false; }, 400); }));
  sheet.addEventListener("input", (ev) => { const c = ev.target.closest?.(".rb-sel"); if (c && ev.target.classList.contains("rb-range")) pintarSel(c, true); });
  sheet.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("[data-paso],[data-fijo]"); if (!b) return;
    const c = b.closest(".rb-sel"); if (!c) return; const r = c.querySelector(".rb-range");
    r.value = b.dataset.fijo ? Math.max(+r.min, Math.min(+r.max, +b.dataset.fijo)) : Math.max(+r.min, Math.min(+r.max, Math.round(+r.value * (1 + b.dataset.paso / 100)))); pintarSel(c, true);
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
    if (sheet.classList.contains("on") && !sheet.contains(document.activeElement?.closest?.("input") || null)) pintarHoja();
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
  // si ya dio permiso antes, renueva la suscripción en silencio (por si el teléfono la cambió)
  if (R.token && "Notification" in window && Notification.permission === "granted") suscribirPush(false);
})();
