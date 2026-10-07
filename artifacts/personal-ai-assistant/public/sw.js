self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    (async () => {
      // Push services can queue a notification while the phone is offline. Check
      // the current server state at delivery time so a queued alert stays hushed.
      const response = await fetch(new URL('/api/push/privacy', self.location.origin), {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      const privacy = await response.json();
      if (privacy.darkMode) return;

      const dueAt = Date.parse(data.dueAt);
      if (!Number.isFinite(dueAt) || Date.now() - dueAt > 3 * 60 * 1000) return;

      await self.registration.showNotification(data.title || 'Lumen reminder', {
        body: data.body || 'You have a reminder.',
        tag: data.reminderId ? `lumen-reminder-${data.reminderId}` : 'lumen-reminder',
        data: { url: self.registration.scope },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
      return existing ? existing.focus() : clients.openWindow(self.registration.scope);
    }),
  );
});