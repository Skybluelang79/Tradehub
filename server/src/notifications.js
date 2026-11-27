import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import logger from './logger.js';
import { sendPushNotification } from './firebase.js';

const PUSH_PREFERENCE_BY_TYPE = {
  message: 'notif_messages',
  price_drop: 'notif_price_drops',
  follow: 'notif_followers',
  follower: 'notif_followers',
  boost: 'notif_boosts',
  saved_search: 'notif_saved_searches',
};

function serializeData(data) {
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data || {});
  } catch {
    return '{}';
  }
}

function parseData(data) {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data || '{}');
    } catch {
      return {};
    }
  }
  return data || {};
}

async function sendPushFromNotification(userId, type, title, body, data) {
  try {
    const settings = db.prepare(`
      SELECT fcm_token, notifications, notif_push, notif_messages, notif_price_drops,
             notif_followers, notif_boosts, notif_saved_searches
      FROM user_settings WHERE user_id = ?
    `).get(userId);
    if (!settings || settings.notifications === 0 || settings.notif_push === 0 || !settings.fcm_token) {
      return null;
    }
    const preferenceKey = PUSH_PREFERENCE_BY_TYPE[type];
    if (preferenceKey && settings[preferenceKey] === 0) return null;
    return await sendPushNotification(settings.fcm_token, {
      title,
      body,
      data: { ...parseData(data), type },
    });
  } catch (err) {
    logger.warn(`Push notification skipped for ${userId}: ${err.message}`);
    return null;
  }
}

export function notify(userId, type, title, body, data = {}) {
  const serialized = serializeData(data);
  db.prepare(
    'INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(uuidv4(), userId, type, title, body, serialized);
  void sendPushFromNotification(userId, type, title, body, data);
}

export default notify;
