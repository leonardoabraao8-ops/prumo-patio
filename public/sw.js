/* Pátio Prumo — só avisos. Não guarda cópia do app nem intercepta a rede:
   o app continua sendo o index.html de sempre. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Pátio Prumo", {
    body: d.body || "",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: "icone-192.png",
    badge: "icone-192.png",
    data: { url: d.url || "/" }
  }));
});

/* tocar no aviso abre o Pátio já na ficha do veículo */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin);
  const id = alvo.searchParams.get("v");
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const j of janelas) {
      if (new URL(j.url).origin === self.location.origin) {
        await j.focus();
        if (id) j.postMessage({ abrir: id });
        return;
      }
    }
    await self.clients.openWindow(alvo.href);
  })());
});
