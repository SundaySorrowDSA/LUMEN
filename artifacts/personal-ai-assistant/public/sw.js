self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Lumen reminder', {
      body: data.body || 'You have a reminder.',
      tag: data.reminderId ? `lumen-reminder-${data.reminderId}` : 'lumen-reminder',
      data: { url: self.registration.scope },
    }),
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