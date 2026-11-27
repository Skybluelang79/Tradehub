const params = new URLSearchParams(self.location.search);

const firebaseConfig = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId) {
  importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js');
  importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js');

  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  function iconUrl() {
    return new URL('icon-192.png', self.registration.scope).href;
  }

  messaging.onBackgroundMessage((payload) => {
    const notification = payload.notification || {};
    const title = notification.title || payload.data?.title || 'TradeHub';
    const body = notification.body || payload.data?.body || 'You have a new update.';
    self.registration.showNotification(title, {
      body,
      icon: notification.image || iconUrl(),
      badge: iconUrl(),
      data: payload.data || {},
      tag: payload.data?.type || 'tradehub',
    });
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = event.notification.data?.url || self.registration.scope;
    const url = new URL(target, self.registration.scope).href;
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }));
  });
}
