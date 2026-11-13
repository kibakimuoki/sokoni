// build: 202611130716
// Sokoni service worker. It makes the app installable and gives a friendly page when there is no connection.
// It deliberately caches almost nothing: live listings, prices, orders, payments and every private file ALWAYS come fresh from the server.
const VERSION = "sokoni-shell-v2";
const SHELL = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// Push notifications: the server sends an encrypted message; we show it, and open the right page when it is tapped.
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "Sokoni", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Sokoni", { body: d.body || "", icon: d.icon || "/icons/icon-192.png", badge: "/icons/favicon-32.png", tag: d.tag || undefined, renotify: !!d.tag, requireInteraction: !!d.urgent, data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => { for (const c of cs) { if ("focus" in c) { try { c.navigate(url); } catch (x) { /* ignore */ } return c.focus(); } } return self.clients.openWindow(url); }));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;              // other sites (maps, fonts) and anything that changes data: not ours to touch
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return; // live data and private files are never cached
  if (req.mode === "navigate") { e.respondWith(fetch(req).catch(() => caches.match("/offline.html"))); return; } // always the newest app; the offline page only if the network is truly down
  if (SHELL.includes(url.pathname) || url.pathname.startsWith("/icons/")) e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; })));
});
