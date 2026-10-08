import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { mockTransactions, mockReviews, mockPaymentMethods, currentUser } from '../services/api';
import { storage, geolocation } from '../services/storage';
import { generateId } from '../utils/helpers';
import { api } from '../services/client';
import { useAuth } from './AuthContext';

const AppContext = createContext();
const DEFAULT_LOCATION = { lat: 40.7128, lng: -74.006 };

// Fixture conversations use ids like "conv-1"; the server issues UUIDs. Dropping
// the fixtures on read means anyone who visited before the API hydration existed
// does not keep seeing the demo chat out of localStorage.
function readConversations() {
  const stored = storage.get('conversations', []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((c) => !/^conv-\d+$/.test(c?.id || ''));
}

function readMessages() {
  const stored = storage.get('messages', {});
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const out = {};
  for (const [key, list] of Object.entries(stored)) {
    if (/^conv-\d+$/.test(key)) continue;
    if (Array.isArray(list)) out[key] = list;
  }
  return out;
}

// The API answers with snake_case rows; the whole UI reads camelCase. Every
// path that takes an item from the server (list, create, update) goes through
// this one mapper so the shapes can never drift apart.
function normalizeItem(item) {
  return {
    ...item,
    sellerId: item.seller_id,
    location: {
      lat: item.location_lat || 40.7128,
      lng: item.location_lng || -74.006,
      address: item.location_address || '',
    },
    salePrice: item.sale_price,
    saleEndsAt: item.sale_ends_at,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    images: item.images || [],
    isAuction: !!item.is_auction,
    startingBid: item.starting_bid,
    minIncrement: item.min_increment,
    auctionEndsAt: item.auction_ends_at,
    auctionStatus: item.auction_status,
    currentBid: item.current_bid,
    currentBidderId: item.current_bidder_id,
  };
}

// Build the POST /api/items payload from the form-shaped object AddListing
// produces (camelCase, strings for numbers).
function toServerItem(item, images, status = 'active') {
  const payload = {
    title: item.title,
    description: item.description || '',
    price: Number(item.price),
    category: item.category,
    condition: item.condition || 'good',
    images,
    quantity: parseInt(item.quantity, 10) || 1,
    currency: item.currency || 'NGN',
    boosted: !!item.boosted,
    is_auction: !!item.isAuction,
    status,
  };
  if (item.salePrice != null && item.salePrice !== '') payload.sale_price = Number(item.salePrice);
  if (item.saleEndsAt) payload.sale_ends_at = item.saleEndsAt;
  if (item.location) {
    payload.location = {
      lat: Number(item.location.lat) || undefined,
      lng: Number(item.location.lng) || undefined,
      address: item.location.address || '',
    };
  }
  if (Array.isArray(item.variants)) {
    payload.variants = item.variants
      .filter((v) => v && v.name)
      .map((v) => ({ name: v.name, values: (v.values || []).map(String) }));
  }
  if (item.boostExpiresAt) payload.boost_expires_at = item.boostExpiresAt;
  if (item.isAuction) {
    if (item.startingBid != null) payload.starting_bid = Number(item.startingBid);
    if (item.minIncrement != null) payload.min_increment = Number(item.minIncrement);
    if (item.auctionEndsAt) payload.auction_ends_at = item.auctionEndsAt;
  }
  return payload;
}

// Partial updates (mark sold, boost, unpublish, edit listing) map from the
// camelCase shapes used across the UI onto the snake_case PUT schema. Keys
// that are absent stay absent so the server keeps its current values.
const UPDATE_FIELD_MAP = {
  title: 'title',
  description: 'description',
  price: 'price',
  category: 'category',
  condition: 'condition',
  images: 'images',
  quantity: 'quantity',
  status: 'status',
  boosted: 'boosted',
  currency: 'currency',
  salePrice: 'sale_price',
  saleEndsAt: 'sale_ends_at',
  boostExpiresAt: 'boost_expires_at',
  isAuction: 'is_auction',
  startingBid: 'starting_bid',
  minIncrement: 'min_increment',
  auctionEndsAt: 'auction_ends_at',
  auctionStatus: 'auction_status',
};

function toServerUpdates(updates) {
  const out = {};
  for (const [key, serverKey] of Object.entries(UPDATE_FIELD_MAP)) {
    if (key in updates) out[serverKey] = updates[key];
  }
  if ('variants' in updates) {
    out.variants = (updates.variants || [])
      .filter((v) => v && v.name)
      .map((v) => ({ name: v.name, values: (v.values || []).map(String) }));
  }
  if ('location' in updates && updates.location) {
    out.location = {
      lat: Number(updates.location.lat) || undefined,
      lng: Number(updates.location.lng) || undefined,
      address: updates.location.address || '',
    };
  }
  return out;
}

async function dataUrlToFile(dataUrl, index) {
  const blob = await (await fetch(dataUrl)).blob();
  const type = (dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/png');
  const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return new File([blob], `listing-${index}.${ext}`, { type });
}

// Listings are edited in the browser as compressed data URLs. They have to be
// uploaded before the item is saved: the API stores URLs, not payloads.
async function persistImages(images) {
  const list = (images || []).filter(Boolean);
  if (!list.length) return [];

  const out = new Array(list.length);
  const pending = [];
  list.forEach((src, i) => {
    if (typeof src === 'string' && src.startsWith('data:image/')) pending.push(i);
    else out[i] = src;
  });

  if (pending.length) {
    const files = await Promise.all(pending.map((i, idx) => dataUrlToFile(list[i], idx)));
    const res = await api.upload.images(files);
    if (!res || !Array.isArray(res.files) || res.files.length !== pending.length) {
      throw new Error(res?.error || 'Could not upload listing images');
    }
    pending.forEach((imageIndex, idx) => { out[imageIndex] = res.files[idx].url; });
  }

  return out.filter(Boolean);
}

export function AppProvider({ children }) {
  const { user: authUser } = useAuth();
  // Deliberately null when signed out. Defaulting to the demo account's id
  // made conversation participant lookups pick the wrong side of the chat.
  const currentUserId = authUser?.id || null;

  const [activeTab, setActiveTab] = useState('home');
  // Listings live in the database, so start empty and let the API fill this in.
// Seeding from a cached fixture made deleted listings reappear forever: an
// empty API response looked like "no update" instead of "nothing for sale".
const [items, setItems] = useState([]);
  // Conversations, messages and users are seeded empty rather than from the
  // mock fixtures. The fixtures describe a single demo account, so seeding them
  // made every real conversation render under the same placeholder name.
  const [conversations, setConversations] = useState(() => readConversations());
  const [messages, setMessages] = useState(() => readMessages());
  const [transactions, setTransactions] = useState(() => storage.get('transactions', mockTransactions));
  const [reviews, setReviews] = useState(() => storage.get('reviews', mockReviews));
  const [paymentMethods, setPaymentMethods] = useState(() => storage.get('paymentMethods', mockPaymentMethods));
  const [favorites, setFavorites] = useState(() => storage.get('favorites', []));
  const [cart, setCart] = useState([]);
  const [notifications, setNotifications] = useState(() => storage.get('notifications', []));
  const [users, setUsers] = useState(() => storage.get('users', []));
  const [templates, setTemplates] = useState(() => storage.get('templates', []));
  const [sales, setSales] = useState(() => storage.get('sales', []));
  const [userLocation, setUserLocation] = useState(DEFAULT_LOCATION);
  const [locationLoading, setLocationLoading] = useState(() => !!navigator.geolocation);
  
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  
  const [filters, setFilters] = useState({
    distance: 25,
    category: 'all',
    sort: 'newest',
    search: '',
    minPrice: '',
    maxPrice: '',
    condition: 'all',
  });

  // Listings are no longer cached: the API is the only source, so nothing reads
  // this key. Clear it once for browsers still holding fixtures from earlier
  // builds, and stop writing it.
  useEffect(() => {
    storage.remove('items');
  }, []);

  useEffect(() => {
    storage.set('conversations', conversations);
    storage.set('messages', messages);
  }, [conversations, messages]);

  useEffect(() => {
    storage.set('favorites', favorites);
  }, [favorites]);

  useEffect(() => {
    if (!authUser) {
      queueMicrotask(() => setCart([]));
      return;
    }
    let cancelled = false;
    api.payments.cart.get()
      .then((r) => { if (!cancelled && Array.isArray(r.items)) setCart(r.items); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [authUser]);

  // Notifications are server state (offers, sales, saved-search alerts...).
  // The localStorage copy only seeds the UI before the first response lands,
  // and a light poll keeps alerts arriving while the app is open.
  useEffect(() => {
    if (!authUser?.id) return undefined;
    let alive = true;
    const loadNotifications = () =>
      api.notifications.list()
        .then((data) => {
          if (!alive) return;
          setNotifications((data.notifications || []).map((n) => {
            let parsed = n.data;
            if (typeof parsed === 'string') {
              try { parsed = JSON.parse(parsed); } catch { parsed = null; }
            }
            return {
              id: n.id,
              type: n.type,
              title: n.title,
              body: n.body || '',
              data: parsed && parsed !== '{}' ? parsed : null,
              read: !!n.read,
              createdAt: n.created_at,
            };
          }));
        })
        .catch(() => {});
    loadNotifications();
    const timer = setInterval(loadNotifications, 45000);
    return () => { alive = false; clearInterval(timer); };
  }, [authUser?.id]);

  useEffect(() => {
    storage.set('notifications', notifications);
  }, [notifications]);

  useEffect(() => {
    storage.set('transactions', transactions);
  }, [transactions]);

  useEffect(() => {
    storage.set('reviews', reviews);
  }, [reviews]);

  useEffect(() => {
    storage.set('paymentMethods', paymentMethods);
  }, [paymentMethods]);

  useEffect(() => {
    storage.set('users', users);
  }, [users]);

  useEffect(() => {
    storage.set('templates', templates);
  }, [templates]);

  useEffect(() => {
    storage.set('sales', sales);
  }, [sales]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationLoading(false);
      },
      () => {
        setUserLocation(DEFAULT_LOCATION);
        setLocationLoading(false);
      }
    );
  }, []);

  useEffect(() => {
    const fetchItems = async () => {
      try {
        const data = await api.items.list({ limit: 100 });
        const normalized = (data.items || []).map(normalizeItem);
        setItems(normalized);
      } catch (err) {
        console.log('Could not load listings:', err?.message);
      }
    };
    fetchItems();
  }, []);

  // The conversation list is per-account server state, so it has to come from
  // the API rather than a fixture. Names for the other party arrive alongside
  // each row, so the same response also seeds the user directory that
  // getUser() reads.
  useEffect(() => {
    if (!authUser?.id) return;
    let cancelled = false;

    const fetchConversations = async () => {
      try {
        const data = await api.chat.conversations();
        if (cancelled) return;

        const rows = data.conversations || [];
        setConversations(rows.map((c) => ({
          id: c.id,
          itemId: c.item_id,
          participants: [c.buyer_id, c.seller_id],
          lastMessage: c.last_message || '',
          lastMessageTime: c.last_message_time || c.created_at,
          unreadCount: c.unread_count || 0,
          pinned: !!c.pinned,
          muted: !!c.muted,
        })));

        setUsers((prev) => {
          const byId = new Map(prev.map((u) => [u.id, u]));
          for (const c of rows) {
            const otherId = c.buyer_id === authUser.id ? c.seller_id : c.buyer_id;
            // A conversation without a resolved name must not be cached: this
            // directory is persisted, so a placeholder written once would win
            // over the real seller data on every later lookup.
            if (!otherId || !c.other_name || byId.has(otherId)) continue;
            byId.set(otherId, {
              id: otherId,
              name: c.other_name,
              avatar: c.other_avatar || null,
              verified: !!c.other_verified,
            });
          }
          return Array.from(byId.values());
        });
      } catch (err) {
        // Leave the list empty rather than substituting demo conversations.
        if (!cancelled) console.log('Could not load conversations:', err?.message || err);
      }
    };

    fetchConversations();
    return () => { cancelled = true; };
  }, [authUser?.id]);

  // Listen for socket incoming messages from Chat.jsx
  useEffect(() => {
    const handler = (e) => {
      const { conversationId, message } = e.detail;

      const exists = (messages[conversationId] || []).some((m) => m.id === message.id);
      if (exists) return;

      const type = message.type || 'text';
      let preview = message.text;
      if (type === 'file') {
        const att = message.attachments && message.attachments.length > 0
          ? message.attachments[0].filename
          : 'Attachment';
        preview = `📎 ${att}`;
      } else if (message.encrypted) {
        preview = '🔒 Encrypted message';
      } else if (type === 'call') {
        preview = `📞 ${message.text}`;
      }

      setMessages((prev) => ({
        ...prev,
        [conversationId]: [...(prev[conversationId] || []), message],
      }));
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === conversationId
            ? { ...conv, lastMessage: preview, lastMessageTime: message.time || message.created_at, unreadCount: conv.unreadCount + 1 }
            : conv
        )
      );
    };
    window.addEventListener('app_add_message', handler);
    return () => window.removeEventListener('app_add_message', handler);
  }, [messages]);

  const getDistanceFromUser = useCallback((lat, lng) => {
    if (!userLocation) return null;
    return geolocation.calculateDistance(userLocation.lat, userLocation.lng, lat, lng);
  }, [userLocation]);

  const filteredItems = items.filter((item) => {
    if (item.status !== 'active') return false;
    
    const distance = getDistanceFromUser(item.location.lat, item.location.lng);
    if (distance && distance > filters.distance) return false;

    if (filters.category !== 'all' && item.category.toLowerCase() !== filters.category) return false;

    if (filters.condition && filters.condition !== 'all' && item.condition !== filters.condition) return false;

    if (filters.minPrice && Number(item.price) < Number(filters.minPrice)) return false;

    if (filters.maxPrice && Number(item.price) > Number(filters.maxPrice)) return false;

    if (filters.search) {
      const search = filters.search.toLowerCase();
      if (!item.title.toLowerCase().includes(search) && !item.description.toLowerCase().includes(search)) {
        return false;
      }
    }

    return true;
  }).sort((a, b) => {
    switch (filters.sort) {
      case 'newest':
        return new Date(b.createdAt) - new Date(a.createdAt);
      case 'oldest':
        return new Date(a.createdAt) - new Date(b.createdAt);
      case 'price_low':
        return a.price - b.price;
      case 'price_high':
        return b.price - a.price;
      case 'popular':
        return (b.views || 0) - (a.views || 0) || (b.favorites || 0) - (a.favorites || 0);
      case 'nearest': {
        const distA = getDistanceFromUser(a.location.lat, a.location.lng) || Infinity;
        const distB = getDistanceFromUser(b.location.lat, b.location.lng) || Infinity;
        return distA - distB;
      }
      default:
        return 0;
    }
  });

  const getUser = useCallback((userId) => {
    if (!userId) return null;
    // The signed-in account is not in the conversation-seeded directory, so a
    // seller looking at their own listing resolved to 'Unknown user'. The auth
    // record is authoritative and always carries a name.
    if (userId === currentUserId && authUser?.name) {
      return {
        id: authUser.id,
        name: authUser.name,
        avatar: authUser.avatar || null,
        rating: authUser.rating || 0,
        verified: !!authUser.verified,
        identityVerified: !!authUser.identity_verified,
        location: authUser.location || null,
      };
    }
    // Skip unresolved entries rather than returning them: the directory is
    // persisted to localStorage, so a name-less row would otherwise mask the
    // real profile the listings below already carry.
    const found = users.find((u) => u.id === userId && u.name);
    if (found) return found;
    const fromItems = items.find(i => i.sellerId === userId);
    if (fromItems?.seller_name) {
      return {
        id: userId,
        name: fromItems.seller_name,
        avatar: fromItems.seller_avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
        rating: fromItems.seller_rating || 0,
        verified: !!fromItems.seller_verified,
        identityVerified: !!fromItems.seller_identity_verified,
        location: fromItems.location || { lat: 40.7128, lng: -74.006, address: '' },
      };
    }
    // Keep the id rather than a generic name: several sellers with no resolved
    // profile would otherwise render as one indistinguishable row.
    return { id: userId, name: `Seller ${String(userId).slice(-4)}`, avatar: null, verified: false };
  }, [users, items, currentUserId, authUser]);

  const addNotification = useCallback((notification) => {
    const newNotification = {
      ...notification,
      id: generateId(),
      read: false,
      createdAt: new Date().toISOString(),
    };
    setNotifications((prev) => [newNotification, ...prev]);
  }, []);

  const addItem = useCallback(async (item, status = 'active') => {
    const images = await persistImages(item.images);
    const created = await api.items.create(toServerItem(item, images, status));
    const newItem = {
      ...normalizeItem(created.item),
      variants: item.variants || [],
      // The list endpoint joins the users table and returns these; the create
      // response does not, so carry them over from the signed-in account.
      seller_name: item.seller_name || authUser?.name || '',
      seller_avatar: item.seller_avatar || authUser?.avatar || '',
      seller_rating: item.seller_rating ?? authUser?.rating ?? 0,
      seller_verified: item.seller_verified ?? !!authUser?.verified,
      seller_identity_verified: item.seller_identity_verified ?? !!authUser?.identity_verified,
    };
    setItems((prev) => [newItem, ...prev]);
    if (status === 'active') {
      addNotification({
        type: 'system',
        title: 'Listing Created',
        body: `"${newItem.title}" is now live!`,
      });
    }
    return newItem;
  }, [addNotification, authUser]);

  const updateItem = useCallback(async (itemId, updates) => {
    const applied = updates.images
      ? { ...updates, images: await persistImages(updates.images).catch((err) => {
          console.warn('Could not upload listing images:', err?.message);
          return updates.images;
        }) }
      : updates;
    setItems((prev) => prev.map((item) => item.id === itemId ? { ...item, ...applied } : item));
    try {
      await api.items.update(itemId, toServerUpdates(applied));
    } catch (err) {
      // Keep the local change so the UI still reflects the tap, but say so:
      // silently losing "mark as sold" is how stale listings happen.
      console.warn('Could not save listing change:', err?.message);
    }
  }, []);

  const deleteItem = useCallback((itemId) => {
    const item = items.find((i) => i.id === itemId);
    setItems((prev) => prev.filter((item) => item.id !== itemId));
    api.items.delete(itemId).catch((err) => {
      console.warn('Could not delete listing:', err?.message);
    });
    if (item) {
      addNotification({
        type: 'system',
        title: 'Listing Deleted',
        body: `"${item.title}" has been removed.`,
      });
    }
  }, [items, addNotification]);

  const getUserListings = useCallback((userId) => {
    return items.filter((item) => item.sellerId === userId);
  }, [items]);

  const getUserDrafts = useCallback((userId) => {
    return items.filter((item) => item.sellerId === userId && item.status === 'draft');
  }, [items]);

  const getUserActiveListings = useCallback((userId) => {
    return items.filter((item) => item.sellerId === userId && item.status === 'active');
  }, [items]);

  const getItemAnalytics = useCallback((itemId) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return null;
    return {
      views: item.views || 0,
      favorites: item.favorites || 0,
      conversations: conversations.filter((c) => c.itemId === itemId).length,
      status: item.status,
      createdAt: item.createdAt,
      boosted: item.boosted || false,
    };
  }, [items, conversations]);

  const boostItem = useCallback((itemId, duration = 7) => {
    setItems((prev) => prev.map((item) => {
      if (item.id === itemId) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + duration);
        return {
          ...item,
          boosted: true,
          boostExpiresAt: expiresAt.toISOString(),
        };
      }
      return item;
    }));
    const item = items.find((i) => i.id === itemId);
    if (item) {
      addNotification({
        type: 'system',
        title: 'Listing Boosted',
        body: `"${item.title}" is now boosted for ${duration} days!`,
      });
    }
  }, [items, addNotification]);

  const markAsSold = useCallback((itemId, buyerId) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    setItems((prev) => prev.map((i) =>
      i.id === itemId ? { ...i, status: 'sold' } : i
    ));
    const saleRecord = {
      id: generateId(),
      itemId,
      itemTitle: item.title,
      itemImage: item.images[0],
      price: item.salePrice || item.price,
      buyerId: buyerId || 'unknown',
      sellerId: currentUserId,
      soldAt: new Date().toISOString(),
    };
    setSales((prev) => [saleRecord, ...prev]);
    addNotification({
      type: 'sale',
      title: 'Item Sold!',
      body: `"${item.title}" has been marked as sold.`,
    });
  }, [items, currentUserId, addNotification]);

  const getSoldItems = useCallback((userId) => {
    return sales.filter((s) => s.sellerId === userId);
  }, [sales]);

  const getTotalRevenue = useCallback((userId) => {
    return sales
      .filter((s) => s.sellerId === userId)
      .reduce((sum, s) => sum + s.price, 0);
  }, [sales]);

  const saveTemplate = useCallback((template) => {
    const newTemplate = {
      ...template,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    setTemplates((prev) => [newTemplate, ...prev]);
    return newTemplate;
  }, []);

  const deleteTemplate = useCallback((templateId) => {
    setTemplates((prev) => prev.filter((t) => t.id !== templateId));
  }, []);

  const getTemplates = useCallback(() => {
    return templates;
  }, [templates]);

  const getBoostedItems = useCallback(() => {
    const now = new Date();
    return items.filter((item) => {
      if (!item.boosted || !item.boostExpiresAt) return false;
      return new Date(item.boostExpiresAt) > now;
    });
  }, [items]);

  const sendMessage = useCallback((conversationId, text, encryptionMeta = null, options = {}) => {
    const type = options.type || 'text';
    const newMessage = {
      id: generateId(),
      senderId: currentUserId,
      text: type === 'file' ? '' : (encryptionMeta ? '(encrypted)' : text),
      type,
      time: new Date().toISOString(),
      read: false,
      delivered: false,
      attachments: options.attachments || [],
      replyTo: options.replyTo || null,
      ...(encryptionMeta ? { encrypted: true, ciphertext: encryptionMeta.ciphertext, iv: encryptionMeta.iv, localText: text } : {}),
    };

    setMessages((prev) => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] || []), newMessage],
    }));

    let preview = newMessage.text;
    if (type === 'file') {
      const att = (options.attachments || [])[0];
      preview = `📎 ${att?.filename || 'Attachment'}`;
    } else if (encryptionMeta) {
      preview = '🔒 Encrypted message';
    } else if (type === 'call') {
      preview = `📞 ${text}`;
    }

    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === conversationId
          ? { ...conv, lastMessage: preview, lastMessageTime: newMessage.time }
          : conv
      )
    );

    return newMessage.id;
  }, [currentUserId]);

  // Used to roll back an optimistic bubble when persisting the message fails.
  const removeMessage = useCallback((conversationId, messageId) => {
    setMessages((prev) => {
      const list = prev[conversationId];
      if (!Array.isArray(list)) return prev;
      return { ...prev, [conversationId]: list.filter((m) => m.id !== messageId) };
    });
  }, []);

  const markConversationRead = useCallback((conversationId) => {
    setConversations((prev) =>
      prev.map((c) => c.id === conversationId ? { ...c, unreadCount: 0 } : c)
    );
  }, []);

  const hydrateMessages = useCallback((conversationId, incoming) => {
    setMessages((prev) => {
      const byId = new Map((prev[conversationId] || []).map((m) => [m.id, m]));
      for (const m of incoming) {
        if (m && m.id && !byId.has(m.id)) byId.set(m.id, m);
      }
      const merged = [...byId.values()].sort(
        (a, b) => new Date(a.time || 0).getTime() - new Date(b.time || 0).getTime()
      );
      return { ...prev, [conversationId]: merged };
    });
  }, []);

  const addConversation = useCallback((itemId, sellerId) => {
    const existingConv = conversations.find(
      (c) => c.itemId === itemId && c.participants.includes(currentUserId)
    );

    if (existingConv) return existingConv;

    const newConv = {
      id: generateId(),
      itemId,
      participants: [currentUserId, sellerId],
      lastMessage: '',
      lastMessageTime: new Date().toISOString(),
      unreadCount: 0,
    };

    setConversations((prev) => [newConv, ...prev]);
    setMessages((prev) => ({ ...prev, [newConv.id]: [] }));
    return newConv;
  }, [conversations, currentUserId]);

  const incrementItemViews = useCallback((itemId) => {
    setItems((prev) => prev.map((item) =>
      item.id === itemId ? { ...item, views: (item.views || 0) + 1 } : item
    ));
  }, []);

  const toggleFavorite = useCallback((itemId) => {
    setFavorites((prev) => {
      if (prev.includes(itemId)) {
        return prev.filter((id) => id !== itemId);
      }
      return [...prev, itemId];
    });
  }, []);

  const isFavorite = useCallback((itemId) => {
    return favorites.includes(itemId);
  }, [favorites]);

  const refreshCart = useCallback(async () => {
    try {
      const r = await api.payments.cart.get();
      if (Array.isArray(r.items)) setCart(r.items);
    } catch {}
  }, []);

  const addToCart = useCallback(async (itemId, quantity = 1) => {
    const r = await api.payments.cart.add(itemId, quantity);
    if (Array.isArray(r.items)) setCart(r.items);
    return r;
  }, []);

  const cartCount = cart.length;
  const cartSubtotalCents = cart.reduce((sum, it) => sum + Math.round((it.sale_price || it.price) * it.quantity * 100), 0);

  const addPaymentMethod = useCallback((method) => {
    const newMethod = {
      ...method,
      id: generateId(),
    };
    if (newMethod.isDefault) {
      setPaymentMethods((prev) => prev.map((m) => ({ ...m, isDefault: false })));
    }
    setPaymentMethods((prev) => [...prev, newMethod]);
  }, []);

  const removePaymentMethod = useCallback((methodId) => {
    setPaymentMethods((prev) => prev.filter((m) => m.id !== methodId));
  }, []);

  const setDefaultPaymentMethod = useCallback((methodId) => {
    setPaymentMethods((prev) =>
      prev.map((m) => ({ ...m, isDefault: m.id === methodId }))
    );
  }, []);

  const addTransaction = useCallback((transaction) => {
    const newTransaction = {
      ...transaction,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    setTransactions((prev) => [newTransaction, ...prev]);
    return newTransaction;
  }, []);

  const completeTransaction = useCallback((transactionId) => {
    setTransactions((prev) => {
      const txn = prev.find((t) => t.id === transactionId);
      if (txn) {
        addNotification({
          type: 'sale',
          title: 'Payment Released',
          body: `Payment for "${txn.itemTitle}" has been released.`,
        });
      }
      return prev.map((t) =>
        t.id === transactionId
          ? { ...t, status: 'completed', completedAt: new Date().toISOString() }
          : t
      );
    });
  }, [addNotification]);

  const refundTransaction = useCallback((transactionId) => {
    setTransactions((prev) => {
      const txn = prev.find((t) => t.id === transactionId);
      if (txn) {
        addNotification({
          type: 'system',
          title: 'Payment Refunded',
          body: `Payment for "${txn.itemTitle}" has been refunded.`,
        });
      }
      return prev.map((t) =>
        t.id === transactionId
          ? { ...t, status: 'refunded', completedAt: null }
          : t
      );
    });
  }, [addNotification]);

  const addReview = useCallback((review) => {
    const newReview = {
      ...review,
      id: generateId(),
      reviewerId: currentUserId,
      createdAt: new Date().toISOString(),
      verified: true,
    };
    setReviews((prev) => [...prev, newReview]);
    return newReview;
  }, [currentUserId]);

  const getReviewsForUser = useCallback((userId) => {
    return reviews.filter((r) => r.revieweeId === userId);
  }, [reviews]);

  const getUserRating = useCallback((userId) => {
    const userReviews = getReviewsForUser(userId);
    if (userReviews.length === 0) return 0;
    const sum = userReviews.reduce((acc, r) => acc + r.rating, 0);
    return parseFloat((sum / userReviews.length).toFixed(1));
  }, [getReviewsForUser]);

  const markNotificationRead = useCallback((notificationId) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );
    api.notifications.markRead(notificationId).catch(() => {});
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    api.notifications.markAllRead().catch(() => {});
  }, []);

  const unreadNotificationsCount = notifications.filter((n) => !n.read).length;
  const unreadMessagesCount = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const value = {
    currentUser,
    currentUserId,
    activeTab,
    setActiveTab,
    items,
    filteredItems,
    addItem,
    updateItem,
    deleteItem,
    selectedItem,
    setSelectedItem,
    incrementItemViews,
    getUser,
    userLocation,
    locationLoading,
    conversations,
    messages,
    sendMessage,
    removeMessage,
    hydrateMessages,
    addConversation,
    markConversationRead,
    selectedConversation,
    setSelectedConversation,
    filters,
    setFilters,
    viewMode,
    setViewMode,
    getDistanceFromUser,
    favorites,
    toggleFavorite,
    isFavorite,
    transactions,
    addTransaction,
    completeTransaction,
    refundTransaction,
    reviews,
    addReview,
    getReviewsForUser,
    getUserRating,
    paymentMethods,
    addPaymentMethod,
    removePaymentMethod,
    setDefaultPaymentMethod,
    notifications,
    addNotification,
    markNotificationRead,
    markAllNotificationsRead,
    unreadNotificationsCount,
    unreadMessagesCount,
    users,
    setUsers,
    getUserListings,
    getUserDrafts,
    getUserActiveListings,
    getItemAnalytics,
    boostItem,
    getBoostedItems,
    markAsSold,
    getSoldItems,
    getTotalRevenue,
    sales,
    saveTemplate,
    deleteTemplate,
    getTemplates,
    templates,
    cart,
    cartCount,
    cartSubtotalCents,
    refreshCart,
    addToCart,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
