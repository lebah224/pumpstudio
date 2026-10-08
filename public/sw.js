// Service worker de TokenStudio : affiche les alertes d'ordres envoyées par le serveur, même studio fermé.
// Il ne met rien en cache et ne voit aucune donnée du studio : il reçoit seulement le texte de la notification.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'TokenStudio', {
    body: d.body || '', icon: '/icon-192.png', badge: '/badge-72.png', tag: d.tag || 'tokenstudio', renotify: true,
    data: { url: d.url || '/app' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const u = new URL((e.notification.data && e.notification.data.url) || '/app', self.location.origin);
  // anciennes alertes (« /?page=… ») : l'outil vit désormais sur /app
  if (u.pathname === '/') u.pathname = '/app';
  const url = u.href;
  const app = self.location.origin + '/app';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url === app || c.url.startsWith(app + '?') || c.url.startsWith(app + '#') || c.url.startsWith(app + '/')) { c.postMessage({ type: 'ts-open', url }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
