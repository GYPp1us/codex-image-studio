// Only public offline assets are cached. Requests, sessions and pictures stay on the server.
const CACHE = "studio-offline-v1";
const OFFLINE = ["/static/offline.html", "/static/offline.css", "/static/icons/icon-192.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("studio-offline-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if(event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if(event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/static/offline.html")));
  } else if(OFFLINE.includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname)));
  }
});
