const API_BASE = import.meta.env.VITE_API_URL || '/api';

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
  const token = options.asAdmin
    ? (localStorage.getItem('tradehub_admin_token') || null)
    : authToken;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    if (options.asAdmin && (res.status === 401 || res.status === 403)) {
      localStorage.removeItem('tradehub_admin_token');
      window.dispatchEvent(new CustomEvent('adminSessionExpired'));
    }
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

function adminRequest(path, options = {}) {
  return request(path, { ...options, asAdmin: true });
}

async function adminDownload(path, filename) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('tradehub_admin_token') || ''}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { setToken, getToken };

export const api = {
  auth: {
    signup: (data) => request('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
    login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    social: (data) => request('/auth/social', { method: 'POST', body: JSON.stringify(data) }),
    firebaseSignup: (data) => request('/firebase/firebase/signup', { method: 'POST', body: JSON.stringify(data) }),
    firebaseLink: (data) => request('/firebase/firebase/link', { method: 'POST', body: JSON.stringify(data) }),
    me: () => request('/auth/me'),
    updateProfile: (data) => request('/auth/me', { method: 'PUT', body: JSON.stringify(data) }),
    changePassword: (data) => request('/auth/change-password', { method: 'PUT', body: JSON.stringify(data) }),
    forgotPassword: (data) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(data) }),
    resetPassword: (data) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }),
    verifyEmail: (token) => request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
    resendVerification: () => request('/auth/resend-verification', { method: 'POST' }),
    deleteAccount: (data) => request('/auth/me', { method: 'DELETE', body: JSON.stringify(data) }),
  },

  settings: {
    get: () => request('/settings'),
    update: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),
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
    bid: (id, amount) => request(`/items/${id}/bid`, { method: 'POST', body: JSON.stringify({ amount }) }),
    bids: (id) => request(`/items/${id}/bids`),
    byUser: (userId) => request(`/items/user/${userId}`),
    drafts: (userId) => request(`/items/user/${userId}/drafts`),
    bulkUpdate: (ids, updates) => request('/items/bulk/update', { method: 'PUT', body: JSON.stringify({ ids, updates }) }),
    bulkDelete: (ids) => request('/items/bulk/delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  },

  chat: {
    conversations: () => request('/chat'),
    create: (itemId, sellerId) => request('/chat', { method: 'POST', body: JSON.stringify({ itemId, sellerId }) }),
    messages: (convId) => request(`/chat/${convId}/messages`),
    send: (convId, text) => request(`/chat/${convId}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
    unreadCount: () => request('/chat/unread/count'),
  },

  payments: {
    cart: {
      get: () => request('/payments/cart'),
      add: (itemId, quantity = 1) => request('/payments/cart', { method: 'POST', body: JSON.stringify({ itemId, quantity }) }),
      update: (itemId, quantity) => request(`/payments/cart/${itemId}`, { method: 'PUT', body: JSON.stringify({ quantity }) }),
      remove: (itemId) => request(`/payments/cart/${itemId}`, { method: 'DELETE' }),
      clear: () => request('/payments/cart', { method: 'DELETE' }),
      checkout: (data) => request('/payments/cart/checkout', { method: 'POST', body: JSON.stringify(data) }),
    },
    methods: () => request('/payments/methods'),
    addMethod: (data) => request('/payments/methods', { method: 'POST', body: JSON.stringify(data) }),
    setDefault: (id) => request(`/payments/methods/${id}/default`, { method: 'PUT' }),
    removeMethod: (id) => request(`/payments/methods/${id}`, { method: 'DELETE' }),
    wallet: () => request('/payments/wallet'),
    options: () => request('/payments/options'),
    issueGiftCards: (data) => adminRequest('/payments/gift-cards/issue', { method: 'POST', body: JSON.stringify(data) }),
    redeemGiftCard: (code) => request('/payments/gift-cards/redeem', { method: 'POST', body: JSON.stringify({ code }) }),
    giftCardBrands: () => request('/payments/gift-cards/brands'),
    giftCardMall: () => request('/payments/gift-cards/mall'),
    submitGiftCardDesign: (data) => request('/payments/gift-cards/designs', { method: 'POST', body: JSON.stringify(data) }),
    giftCardDesigns: (params) => adminRequest(`/payments/gift-cards/designs?status=${params?.status || 'all'}`),
    updateGiftCardDesign: (id, status) => adminRequest(`/payments/gift-cards/designs/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    allGiftCardBrands: () => adminRequest('/payments/gift-cards/brands/all'),
    createGiftCardBrand: (data) => adminRequest('/payments/gift-cards/brands', { method: 'POST', body: JSON.stringify(data) }),
    updateGiftCardBrand: (id, data) => adminRequest(`/payments/gift-cards/brands/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteGiftCardBrand: (id) => adminRequest(`/payments/gift-cards/brands/${id}`, { method: 'DELETE' }),
    giftCardAnalytics: () => adminRequest('/payments/gift-cards/analytics'),
    giftCardList: (params) => adminRequest(`/payments/gift-cards/list?status=${params?.status || 'all'}&limit=${params?.limit || 50}`),
    voidGiftCard: (id) => adminRequest(`/payments/gift-cards/${id}/void`, { method: 'POST' }),
    resetGiftCard: (id) => adminRequest(`/payments/gift-cards/${id}/reset`, { method: 'POST' }),
    confirmFunds: (txnId) => adminRequest(`/payments/admin/fund-confirmed/${txnId}`, { method: 'POST' }),
    createIntent: (data) => request('/payments/create-intent', { method: 'POST', body: JSON.stringify(data) }),
    verify: (reference) => request(`/payments/verify/${reference}`, { method: 'POST' }),
    confirm: (txnId) => request(`/payments/confirm/${txnId}`, { method: 'POST' }),
    transactions: (filter) => request(`/payments/transactions?filter=${filter || 'all'}`),
    sellerAnalytics: () => request('/payments/analytics/seller'),
    refund: (txnId) => request(`/payments/refund/${txnId}`, { method: 'POST' }),
  },

  disputes: {
    open: (data) => request('/disputes', { method: 'POST', body: JSON.stringify(data) }),
    list: () => request('/disputes'),
    get: (id) => request(`/disputes/${id}`),
    all: () => adminRequest('/disputes'),
    resolve: (id, data) => adminRequest(`/disputes/${id}/resolve`, { method: 'PUT', body: JSON.stringify(data) }),
  },

  subscription: {
    current: () => request('/subscription/current'),
    plans: () => request('/subscription/plans'),
    benefits: () => request('/subscription/benefits'),
    upgrade: (plan) => request('/subscription/upgrade', { method: 'POST', body: JSON.stringify({ plan }) }),
    verifyUpgrade: (reference) => request(`/subscription/upgrade/verify/${reference}`),
    cancel: () => request('/subscription/cancel', { method: 'POST' }),
  },

  payouts: {
    balance: () => request('/payouts/balance'),
    list: () => request('/payouts'),
    request: (data) => request('/payouts', { method: 'POST', body: JSON.stringify(data) }),
    cancel: (id) => request(`/payouts/${id}/cancel`, { method: 'POST' }),
    all: () => adminRequest('/payouts/all'),
    updateStatus: (id, data) => adminRequest(`/payouts/${id}/status`, { method: 'PUT', body: JSON.stringify(data) }),
  },

  reviews: {
    forUser: (userId) => request(`/reviews/user/${userId}`),
    create: (data) => request('/reviews', { method: 'POST', body: JSON.stringify(data) }),
  },

  follows: {
    storefront: (userId) => request(`/follows/storefront/${userId}`),
    status: (userId) => request(`/follows/status/${userId}`),
    follow: (userId) => request(`/follows/${userId}/follow`, { method: 'POST' }),
    unfollow: (userId) => request(`/follows/${userId}/follow`, { method: 'DELETE' }),
  },

  notifications: {
    list: () => request('/notifications'),
    unreadCount: () => request('/notifications/unread/count'),
    markRead: (id) => request(`/notifications/${id}/read`, { method: 'PUT' }),
    markAllRead: () => request('/notifications/read-all', { method: 'PUT' }),
  },

  searches: {
    list: () => request('/searches'),
    create: (data) => request('/searches', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/searches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/searches/${id}`, { method: 'DELETE' }),
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

  offers: {
    create: (data) => request('/offers', { method: 'POST', body: JSON.stringify(data) }),
    incoming: () => request('/offers/incoming'),
    outgoing: () => request('/offers/outgoing'),
    byItem: (itemId) => request(`/offers/item/${itemId}`),
    accept: (id) => request(`/offers/${id}/accept`, { method: 'POST' }),
    decline: (id, note = '') => request(`/offers/${id}/decline`, { method: 'POST', body: JSON.stringify({ note }) }),
    counter: (id, data) => request(`/offers/${id}/counter`, { method: 'POST', body: JSON.stringify(data) }),
    cancel: (id) => request(`/offers/${id}/cancel`, { method: 'POST' }),
  },

  verification: {
    status: () => request('/verification/status'),
    submit: (data) => request('/verification', { method: 'POST', body: JSON.stringify(data) }),
  },

  admin: {
    login: (data) => request('/admin/login', { method: 'POST', body: JSON.stringify(data) }),
    dashboard: () => adminRequest('/admin/dashboard'),
    users: (params = {}) => adminRequest(`/admin/users?${new URLSearchParams(params).toString()}`),
    userDetail: (id) => adminRequest(`/admin/users/${id}`),
    verifyUser: (id) => adminRequest(`/admin/users/${id}/verify`, { method: 'PUT' }),
    updateUserStatus: (id, status, reason = '') => adminRequest(`/admin/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, reason }) }),
    toggleAdmin: (id) => adminRequest(`/admin/users/${id}/promote`, { method: 'PUT' }),
    resetPassword: (id) => adminRequest(`/admin/users/${id}/reset-password`, { method: 'POST' }),
    deleteUser: (id) => adminRequest(`/admin/users/${id}`, { method: 'DELETE' }),
    listings: (params = {}) => adminRequest(`/admin/listings?${new URLSearchParams(params).toString()}`),
    updateListingStatus: (id, status) => adminRequest(`/admin/listings/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    transactions: (params = {}) => adminRequest(`/admin/transactions?${new URLSearchParams(params).toString()}`),
    reports: (params = {}) => adminRequest(`/admin/reports?${new URLSearchParams(params).toString()}`),
    resolveReport: (id, action) => adminRequest(`/admin/reports/${id}/resolve`, { method: 'PUT', body: JSON.stringify({ action }) }),
    auditLogs: (params = {}) => adminRequest(`/admin/audit-logs?${new URLSearchParams(params).toString()}`),
    exportCsv: (kind) => adminDownload(`/admin/export/${kind}`, `${kind}-${Date.now()}.csv`),
    refundTransaction: (id) => adminRequest(`/admin/transactions/${id}/refund`, { method: 'POST' }),
    promotions: () => adminRequest('/admin/promotions'),
    createPromotion: (data) => adminRequest('/admin/promotions', { method: 'POST', body: JSON.stringify(data) }),
    updatePromotion: (id, data) => adminRequest(`/admin/promotions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deletePromotion: (id) => adminRequest(`/admin/promotions/${id}`, { method: 'DELETE' }),
    systemInfo: () => adminRequest('/admin/system-info'),
    broadcast: (data) => adminRequest('/admin/broadcast', { method: 'POST', body: JSON.stringify(data) }),
    settingsGet: () => adminRequest('/admin/settings'),
    settingsUpdate: (data) => adminRequest('/admin/settings', { method: 'PUT', body: JSON.stringify(data) }),
    backup: () => adminDownload('/admin/backup', `tradehub-backup-${Date.now()}.db`),
restore: (data) => adminRequest('/admin/backup', { method: 'POST', body: JSON.stringify({ data }) }),
    verifications: (params = {}) => adminRequest(`/admin/verifications?${new URLSearchParams(params).toString()}`),
    verificationApprove: (id) => adminRequest(`/admin/verifications/${id}/approve`, { method: 'POST' }),
    verificationReject: (id, note = '') => adminRequest(`/admin/verifications/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) }),
  },

  fcm: {
    saveToken: (token) => request('/fcm/fcm-token', { method: 'POST', body: JSON.stringify({ token }) }),
    removeToken: () => request('/fcm/fcm-token', { method: 'DELETE' }),
  },

  referrals: {
    my: () => request('/referrals/my'),
    generateCode: () => request('/referrals/code', { method: 'POST' }),
  },

  ai: {
    listing: (data) => request('/ai/listing', { method: 'POST', body: JSON.stringify(data) }),
    parse: (query) => request('/ai/parse', { method: 'POST', body: JSON.stringify({ query }) }),
    question: (itemId, question) => request('/ai/question', { method: 'POST', body: JSON.stringify({ itemId, question }) }),
    priceGuide: (itemId) => request('/ai/price-guide', { method: 'POST', body: JSON.stringify({ itemId }) }),
    recommendations: (params = {}) => request(`/ai/recommendations?${new URLSearchParams(params).toString()}`),
  },

  firebase: {
    sendEmail: (data) => request('/firebase/firebase/send-email', { method: 'POST', body: JSON.stringify(data) }),
    sendPush: (data) => request('/firebase/firebase/push', { method: 'POST', body: JSON.stringify(data) }),
  },

  upload: {
    images: async (files) => {
      const { compressImage } = await import('../utils/imageCompression');
      const formData = new FormData();
      for (const f of files) {
        let file = f;
        try { file = await compressImage(f, { maxWidth: 1280, maxHeight: 1280, quality: 0.82 }); } catch {}
        formData.append('images', file);
      }
      return fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      }).then(r => r.json());
    },
    single: async (file) => {
      const { compressImage } = await import('../utils/imageCompression');
      const formData = new FormData();
      let out = file;
      try { out = await compressImage(file, { maxWidth: 1280, maxHeight: 1280, quality: 0.82 }); } catch {}
      formData.append('image', out);
      return fetch(`${API_BASE}/upload/single`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      }).then(r => r.json());
    },
  },
};

export default api;
