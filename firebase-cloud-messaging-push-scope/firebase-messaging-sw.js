const params = new URLSearchParams(self.location.search);

const firebaseConfig = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId) {
  importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  function appUrl() {
    return new URL('../', self.registration.scope).href;
  }

  function iconUrl() {
    return new URL('../icon-192.png', self.registration.scope).href;
  }

  messaging.onBackgroundMessage((payload) => {
    const notification = payload.notification || {};
    const title = notification.title || payload.data?.title || 'TradeHub';
    const body = notification.body || payload.data?.body || 'You have a new update.';
    self.registration.showNotification(title, {
      body,
      icon: notification.image || iconUrl(),
      badge: iconUrl(),
      data: { ...(payload.data || {}), url: payload.data?.url || appUrl() },
      tag: payload.data?.type || 'tradehub',
    });
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = event.notification.data?.url || appUrl();
    const url = new URL(target, appUrl()).href;
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }));
  });
}
