/* Service worker mínimo: NO guarda páginas ni datos del CRM (todo es en vivo y
 * por organización). Solo guarda la pantalla «Sin conexión» y la muestra cuando
 * una navegación falla por falta de red. */
const CACHE = "dashfort-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.open(CACHE).then((c) => c.match(OFFLINE_URL)).then((r) => r || Response.error()))
  );
});
