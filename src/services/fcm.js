import { requestFCMPermission, onFCMMessage } from '../config/firebase';
import { api } from './client';

let fcmToken = null;
let unsubscribeMessage = null;
let serviceWorkerRegistration = null;

function firebaseConfigParams() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  };
}

async function registerMessagingServiceWorker() {
  if (serviceWorkerRegistration || !('serviceWorker' in navigator)) {
    return serviceWorkerRegistration;
  }
  const url = new URL(`${import.meta.env.BASE_URL}firebase-messaging-sw.js`, window.location.origin);
  Object.entries(firebaseConfigParams()).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  serviceWorkerRegistration = await navigator.serviceWorker.register(url.pathname + url.search, {
    scope: import.meta.env.BASE_URL,
  });
  return serviceWorkerRegistration;
}

export async function initializeFCM({ prompt = false } = {}) {
  try {
    const registration = await registerMessagingServiceWorker();
    fcmToken = await requestFCMPermission({ prompt, serviceWorkerRegistration: registration });
    if (fcmToken) {
      await api.fcm.saveToken(fcmToken);
      setupMessageListener();
    }
    return fcmToken;
  } catch {
    return null;
  }
}

function setupMessageListener() {
  if (unsubscribeMessage) unsubscribeMessage();
  unsubscribeMessage = onFCMMessage((payload) => {
    const { title, body, image } = payload.notification || {};
    if (title && body) {
      showBrowserNotification(title, { body, image });
    }
    window.dispatchEvent(new CustomEvent('fcm:message', { detail: payload }));
  });
}

function showBrowserNotification(title, options = {}) {
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, {
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        ...options,
      });
    } catch {}
  }
}

export function getFCMToken() {
  return fcmToken;
}

export async function disableFCM() {
  try {
    await api.fcm.removeToken();
  } catch {}
  cleanupFCM();
}

export function cleanupFCM() {
  if (unsubscribeMessage) {
    unsubscribeMessage();
    unsubscribeMessage = null;
  }
  fcmToken = null;
}

export default { initializeFCM, disableFCM, getFCMToken, cleanupFCM };
