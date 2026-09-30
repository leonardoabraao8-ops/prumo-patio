/* Pátio Prumo — só avisos. Não guarda cópia do app nem intercepta a rede:
   o app continua sendo o index.html de sempre. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

/* toque curto (~3 s) nos avisos de antes da hora, longo (~5 s) nos de atraso.
   O navegador não deixa o aviso escolher o som: fora do Pátio toca o som do
   sistema; com o Pátio aberto em alguma aba, é ela que toca o alarme. */
const VIBRA = {
  curto: [600, 200, 600, 200, 600, 200, 600],
  longo: [800, 200, 800, 200, 800, 200, 800, 200, 800, 200, 800]
};
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  const alerta = d.alerta === "longo" ? "longo" : "curto";
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || "Pátio Prumo", {
      body: d.body || "",
      tag: d.tag || undefined,
      renotify: !!d.tag,
      silent: false,
      requireInteraction: !!d.insistente,
      vibrate: VIBRA[alerta],
      icon: "icone-192.png",
      badge: "icone-192.png",
      data: { url: d.url || "/" }
    });
    /* uma aba só toca, de preferência a que está na frente */
    const janelas = (await self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .filter(j => new URL(j.url).origin === self.location.origin);
    const j = janelas.find(x => x.focused) || janelas.find(x => x.visibilityState === "visible") || janelas[0];
    if (j) j.postMessage({ tocar: alerta });
  })());
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
