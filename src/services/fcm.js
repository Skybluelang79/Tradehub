import { requestFCMPermission, onFCMMessage } from '../config/firebase';
import { api } from './client';

let fcmToken = null;
let unsubscribeMessage = null;

export async function initializeFCM() {
  try {
    fcmToken = await requestFCMPermission();
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

export function cleanupFCM() {
  if (unsubscribeMessage) {
    unsubscribeMessage();
    unsubscribeMessage = null;
  }
  fcmToken = null;
}

export default { initializeFCM, getFCMToken, cleanupFCM };
