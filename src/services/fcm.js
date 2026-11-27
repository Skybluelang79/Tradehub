import { requestFCMPermission, onFCMMessage } from '../config/firebase';
import { api } from './client';

let fcmToken = null;
let unsubscribeMessage = null;
let serviceWorkerRegistration = null;

const PUSH_SCOPE = `${import.meta.env.BASE_URL}firebase-cloud-messaging-push-scope/`;

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
  const url = new URL(`${PUSH_SCOPE}firebase-messaging-sw.js`, window.location.origin);
  Object.entries(firebaseConfigParams()).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  serviceWorkerRegistration = await navigator.serviceWorker.register(url.pathname + url.search, {
    scope: PUSH_SCOPE,
  });
  return serviceWorkerRegistration;
}

async function pushPreferenceEnabled() {
  try {
    const { settings } = await api.settings.get();
    return settings?.notif_push !== 0 && settings?.notif_push !== false;
  } catch {
    return true;
  }
}

export async function initializeFCM({ prompt = false, persistToken = true } = {}) {
  try {
    if (!prompt && !(await pushPreferenceEnabled())) {
      cleanupFCM();
      return null;
    }
    const registration = await registerMessagingServiceWorker();
    const token = await requestFCMPermission({ prompt, serviceWorkerRegistration: registration });
    if (!token) {
      cleanupFCM();
      return null;
    }
    fcmToken = token;
    if (persistToken) await api.fcm.saveToken(token);
    setupMessageListener();
    return token;
  } catch {
    return null;
  }
}

export async function enableFCM() {
  const token = await initializeFCM({ prompt: true, persistToken: false });
  if (!token) return null;
  await api.settings.update({ notif_push: true });
  await api.fcm.saveToken(token);
  setupMessageListener();
  return token;
}

export async function disableFCM() {
  await api.settings.update({ notif_push: false });
  try {
    await api.fcm.removeToken();
  } finally {
    cleanupFCM();
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
      const icon = new URL(`${import.meta.env.BASE_URL}icon-192.png`, window.location.origin).href;
      new Notification(title, {
        icon,
        badge: icon,
        ...options,
      });
    } catch {}
  }
}

export function getFCMToken() {
  return fcmToken;
}

export function cleanupFCM() {
  if (unsubscribeMessage) {
    unsubscribeMessage();
    unsubscribeMessage = null;
  }
  fcmToken = null;
}

export default { initializeFCM, enableFCM, disableFCM, getFCMToken, cleanupFCM };
