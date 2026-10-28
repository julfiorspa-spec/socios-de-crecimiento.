/* CotizÁgil · service worker
   - Hace la app instalable en el celular (Android e iPhone) y que abra aunque no haya señal.
   - Recibe los avisos push del robot aunque la app esté cerrada.
   Nunca guarda en caché las llamadas al robot (/bot/...). */
const CACHE = "cotizagil-v4";
const BASICOS = ["/", "/public/robot.js", "/manifest.webmanifest", "/icon-180.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICOS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Red primero (siempre lo más nuevo); si no hay señal, la última copia guardada.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/bot")
      || url.pathname.startsWith("/.netlify")) return;
  e.respondWith((async () => {
    try {
      const r = await fetch(req, { cache: "no-cache" });   // siempre revisa si hay versión nueva
      if (r.ok && (req.mode === "navigate" || BASICOS.includes(url.pathname))) {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/" : req, copia)).catch(() => {});
      }
      return r;
    } catch (err) {
      const c = await caches.match(req.mode === "navigate" ? "/" : req);
      if (c) return c;
      throw err;
    }
  })());
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "CotizÁgil", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "CotizÁgil", {
    body: d.body || "",
    tag: d.tag || "cotizagil",
    renotify: true,
    requireInteraction: !!d.urgente,
    vibrate: d.urgente ? [180, 90, 180, 90, 180] : [120],
    icon: "/icon-512.png",
    badge: "/icon-180.png",
    data: { url: d.url || "/#robot" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || "/#robot", location.origin).href;
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of abiertas) {
      if (new URL(c.url).origin === location.origin) {
        c.postMessage({ tipo: "abrir", url: destino });
        return c.focus();
      }
    }
    return self.clients.openWindow(destino);
  })());
});
