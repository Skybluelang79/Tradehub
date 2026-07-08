const STORAGE_KEYS = {
  USER: 'tradehub_user',
  ITEMS: 'tradehub_items',
  FAVORITES: 'tradehub_favorites',
  NOTIFICATIONS: 'tradehub_notifications',
  SETTINGS: 'tradehub_settings',
  PAYMENT_METHODS: 'tradehub_payment_methods',
  TRANSACTIONS: 'tradehub_transactions',
};

export const storage = {
  get: (key, defaultValue = null) => {
    try {
      const item = localStorage.getItem(STORAGE_KEYS[key] || key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  set: (key, value) => {
    try {
      localStorage.setItem(STORAGE_KEYS[key] || key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove: (key) => {
    try {
      localStorage.removeItem(STORAGE_KEYS[key] || key);
      return true;
    } catch {
      return false;
    }
  },

  clear: () => {
    try {
      Object.values(STORAGE_KEYS).forEach((key) => {
        localStorage.removeItem(key);
      });
      return true;
    } catch {
      return false;
    }
  },
};

export const geolocation = {
  getCurrentPosition: () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000,
      });
    });
  },

  calculateDistance: (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },
};
