const API_BASE = '/api';

let authToken = localStorage.getItem('tradehub_token') || null;

function setToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('tradehub_token', token);
  } else {
    localStorage.removeItem('tradehub_token');
  }
}

function getToken() {
  return authToken;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

function uploadFile(file) {
  const formData = new FormData();
  formData.append('images', file);
  return fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  }).then(r => r.json());
}

export { setToken, getToken };

export const api = {
  auth: {
    signup: (data) => request('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
    login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    me: () => request('/auth/me'),
    updateProfile: (data) => request('/auth/me', { method: 'PUT', body: JSON.stringify(data) }),
    changePassword: (data) => request('/auth/change-password', { method: 'PUT', body: JSON.stringify(data) }),
    forgotPassword: (data) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(data) }),
  },

  items: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request(`/items?${qs}`);
    },
    get: (id) => request(`/items/${id}`),
    create: (data) => request('/items', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/items/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => request(`/items/${id}`, { method: 'DELETE' }),
    favorite: (id) => request(`/items/${id}/favorite`, { method: 'POST' }),
    byUser: (userId) => request(`/items/user/${userId}`),
    drafts: (userId) => request(`/items/user/${userId}/drafts`),
  },

  chat: {
    conversations: () => request('/chat'),
    create: (itemId, sellerId) => request('/chat', { method: 'POST', body: JSON.stringify({ itemId, sellerId }) }),
    messages: (convId) => request(`/chat/${convId}/messages`),
    send: (convId, text) => request(`/chat/${convId}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
    unreadCount: () => request('/chat/unread/count'),
  },

  payments: {
    methods: () => request('/payments/methods'),
    addMethod: (data) => request('/payments/methods', { method: 'POST', body: JSON.stringify(data) }),
    setDefault: (id) => request(`/payments/methods/${id}/default`, { method: 'PUT' }),
    removeMethod: (id) => request(`/payments/methods/${id}`, { method: 'DELETE' }),
    createIntent: (data) => request('/payments/create-intent', { method: 'POST', body: JSON.stringify(data) }),
    confirm: (txnId) => request(`/payments/confirm/${txnId}`, { method: 'POST' }),
    transactions: (filter) => request(`/payments/transactions?filter=${filter || 'all'}`),
    refund: (txnId) => request(`/payments/refund/${txnId}`, { method: 'POST' }),
  },

  reviews: {
    forUser: (userId) => request(`/reviews/user/${userId}`),
    create: (data) => request('/reviews', { method: 'POST', body: JSON.stringify(data) }),
  },

  notifications: {
    list: () => request('/notifications'),
    unreadCount: () => request('/notifications/unread/count'),
    markRead: (id) => request(`/notifications/${id}/read`, { method: 'PUT' }),
    markAllRead: () => request('/notifications/read-all', { method: 'PUT' }),
  },

  templates: {
    list: () => request('/templates'),
    create: (data) => request('/templates', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id) => request(`/templates/${id}`, { method: 'DELETE' }),
  },

  reports: {
    create: (data) => request('/reports', { method: 'POST', body: JSON.stringify(data) }),
    list: () => request('/reports'),
    resolve: (id, action) => request(`/reports/${id}/resolve`, { method: 'PUT', body: JSON.stringify({ action }) }),
  },

  admin: {
    login: (data) => request('/admin/login', { method: 'POST', body: JSON.stringify(data) }),
    dashboard: () => request('/admin/dashboard'),
    users: () => request('/admin/users'),
    verifyUser: (id) => request(`/admin/users/${id}/verify`, { method: 'PUT' }),
    deleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
    listings: () => request('/admin/listings'),
    updateListingStatus: (id, status) => request(`/admin/listings/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    transactions: () => request('/admin/transactions'),
  },

  upload: {
    images: (files) => {
      const formData = new FormData();
      files.forEach(f => formData.append('images', f));
      return fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      }).then(r => r.json());
    },
    single: (file) => {
      const formData = new FormData();
      formData.append('image', file);
      return fetch(`${API_BASE}/upload/single`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      }).then(r => r.json());
    },
  },
};

export default api;
