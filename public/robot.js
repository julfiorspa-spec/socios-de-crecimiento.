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
  const VISTAS = [["lista", "Lista"], ["cajas", "Cajas"], ["tablero", "Tablero"]];
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
              vista: leer().vista || "cajas", detalle: null, push: false, instalar: null };

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
    } catch (e) {
      R.err = e.message;
      if (e.auth) { R.token = null; guardar({ token: null }); }
    }
    pintar();
    const activos = (R.data?.trabajos || []).some((t) => est(t.estado).activo);
    const abierto = $("#rbSheet")?.classList.contains("on");
    if (!document.hidden) R.timer = setTimeout(refrescar, activos || abierto ? POLL_RAPIDO : POLL_LENTO);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refrescar(); });

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

  function tarjeta(t) {
    const e = est(t.estado);
    const enviada = t.estado === "enviada" || t.estado === "confirmada";
    const portal = `https://compra-agil.mercadopublico.cl/resumen-cotizacion/${encodeURIComponent(t.codigo)}`;
    const acts = [];
    if (t.estado === "en_cola" || t.estado === "tomado") acts.push(`<button class="btn small danger" data-rb="cancelar" data-c="${esc(t.codigo)}" type="button">Cancelar</button>`);
    const firmable = t.estado === "firmar" && t.firma?.precios?.length;
    if (firmable) {
      acts.push(`<button class="btn small rb-firmar" data-rb="ir-firmar" data-c="${esc(t.codigo)}" type="button">✍ Ir a firmar</button>`);
      acts.push(`<button class="btn small" data-rb="verificar" data-c="${esc(t.codigo)}" type="button">Ya la firmé</button>`);
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
    const atn = lista.filter((t) => ["lista", "firmar", "requiere"].includes(t.estado));
    const enCurso = lista.filter((t) => est(t.estado).activo && !atn.includes(t));
    const resto = lista.filter((t) => !atn.includes(t) && !enCurso.includes(t));
    return `${atn.length ? `<div class="label">Necesitan tu acción</div>${atn.map(tarjeta).join("")}` : ""}
      ${enCurso.length ? `<div class="label">En curso</div>${enCurso.map(tarjeta).join("")}` : ""}
      ${resto.length ? `<div class="label">Ofertas</div>${resto.map(tarjeta).join("")}` : ""}`;
  }
  function vistaCajas(lista) {
    const orden = (t) => t.estado === "lista" || t.estado === "firmar" ? 0 : t.estado === "requiere" || t.estado === "error" ? 1 : est(t.estado).activo ? 2 : 3;
    return `<div class="rb-cajas">${[...lista].sort((a, b) => orden(a) - orden(b)).map(caja).join("")}</div>`;
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
    const vista = { lista: vistaLista, cajas: vistaCajas, tablero: vistaTablero }[R.vista] || vistaCajas;
    return `
      <div class="rb-sheet-head"><h2 style="margin:0">Robot de ofertas</h2><button class="rb-x" type="button" data-rb="cerrar" aria-label="Cerrar">✕</button></div>
      <div class="rb-status ${conectado ? "on" : ""}"><span class="rb-dot"></span>
        <span>${!R.data ? (R.err ? esc(R.err) : '<span class="spinner"></span>') : conectado
          ? `PC conectado${r.equipo ? " · " + esc(r.equipo) : ""}${r.ocupado && r.tarea ? " · " + esc(r.tarea) : " · libre"}`
          : `PC desconectado${r?.visto ? " · visto " + esc(hace(r.visto)) : ""}. Abre el panel del robot en el PC.`}</span></div>
      <div class="row" style="margin:6px 0 4px">
        <div class="field" style="flex:1;min-width:150px"><input id="rbCod" placeholder="Uno o varios códigos (ej. 3704-203-COT26, 1261-12-COT26)" autocomplete="off" autocapitalize="characters"></div>
        <button class="btn small rb-firmar" type="button" data-rb="nuevo">✍ Preparar</button>
      </div>
      ${(!R.push && pushPosible) || R.instalar || (esIOS && !instalada()) ? `<div class="row" style="margin-top:6px;gap:8px">
        ${!R.push && pushPosible && !(esIOS && !instalada()) ? `<button class="btn small" type="button" data-rb="avisos">🔔 Activar avisos (aunque la app esté cerrada)</button>` : ""}
        ${R.instalar ? `<button class="btn small" type="button" data-rb="instalar">📲 Instalar app</button>` : ""}
        ${esIOS && !instalada() ? `<div class="note" style="margin:0">En iPhone: toca <b>Compartir</b> → <b>Agregar a pantalla de inicio</b>. Desde ahí la app recibe avisos.</div>` : ""}
      </div>` : ""}
      ${lista.length ? kpis(lista) + `<div class="rb-vistas" role="tablist">${VISTAS.map(([k, n]) =>
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
    const box = $("#rbIn"); if (!box) return;
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
    if (a === "vista") { R.vista = b.dataset.v; guardar({ vista: R.vista }); return pintarHoja(); }
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
    if (a === "ir-firmar") {
      const t = trabajo(cod); if (!t?.firma) return;
      toast(firmaRapida() ? "Abriendo la compra: Firma rápida carga precios, detalle y PDF" : "Abriendo la compra: ahí toca tu marcador «Rellenar»");
      // iPhone con la app en la pantalla de inicio: abrir en Safari de verdad (ahí funciona Firma rápida y está tu sesión)
      if (esIOS && instalada()) {
        const t0 = Date.now();
        location.href = "x-safari-" + portalDe(cod);
        setTimeout(() => {                       // si este iPhone no acepta abrir Safari así, se abre como siempre
          if (document.visibilityState === "visible" && Date.now() - t0 < 4000) window.open(portalDe(cod), "_blank");
        }, 1800);
        return;
      }
      const w = window.open(portalDe(cod), "_blank");
      if (w) { try { w.opener = null; } catch {} } else location.href = portalDe(cod);
      return;
    }
    if (a === "verificar") {
      try { await api("pedir", { method: "POST", body: JSON.stringify({ codigo: cod, accion: "verificar" }) }); toast("El robot revisará el portal"); await refrescar(); }
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
  sheet.addEventListener("keydown", (ev) => {
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
    const atn = lista.filter((t) => ["lista", "firmar", "requiere"].includes(t.estado)).length;
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
