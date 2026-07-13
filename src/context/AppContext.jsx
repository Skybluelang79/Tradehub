import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { mockItems, mockUsers, mockConversations, mockMessages, mockTransactions, mockReviews, mockPaymentMethods, currentUser } from '../services/api';
import { storage, geolocation } from '../services/storage';
import { generateId } from '../utils/helpers';
import { api } from '../services/client';

const AppContext = createContext();

export function AppProvider({ children }) {
  const [activeTab, setActiveTab] = useState('home');
  const [items, setItems] = useState(() => storage.get('items', mockItems));
  const [conversations, setConversations] = useState(() => storage.get('conversations', mockConversations));
  const [messages, setMessages] = useState(() => storage.get('messages', mockMessages));
  const [transactions, setTransactions] = useState(() => storage.get('transactions', mockTransactions));
  const [reviews, setReviews] = useState(() => storage.get('reviews', mockReviews));
  const [paymentMethods, setPaymentMethods] = useState(() => storage.get('paymentMethods', mockPaymentMethods));
  const [favorites, setFavorites] = useState(() => storage.get('favorites', []));
  const [notifications, setNotifications] = useState(() => storage.get('notifications', []));
  const [users, setUsers] = useState(() => storage.get('users', []));
  const [templates, setTemplates] = useState(() => storage.get('templates', []));
  const [sales, setSales] = useState(() => storage.get('sales', []));
  const [userLocation, setUserLocation] = useState(null);
  const [locationLoading, setLocationLoading] = useState(true);
  
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  
  const [filters, setFilters] = useState({
    distance: 25,
    category: 'all',
    sort: 'newest',
    search: '',
  });

  useEffect(() => {
    storage.set('items', items);
  }, [items]);

  useEffect(() => {
    storage.set('conversations', conversations);
    storage.set('messages', messages);
  }, [conversations, messages]);

  useEffect(() => {
    storage.set('favorites', favorites);
  }, [favorites]);

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
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setLocationLoading(false);
        },
        () => {
          setUserLocation({ lat: 40.7128, lng: -74.006 });
          setLocationLoading(false);
        }
      );
    } else {
      setUserLocation({ lat: 40.7128, lng: -74.006 });
      setLocationLoading(false);
    }
  }, []);

  useEffect(() => {
    const fetchItems = async () => {
      try {
        const data = await api.items.list({ limit: 100 });
        if (data.items && data.items.length > 0) {
          const normalized = data.items.map(item => ({
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
          }));
          setItems(normalized);
        }
      } catch (err) {
        console.log('Using mock items (backend not available)');
      }
    };
    fetchItems();
  }, []);

  const getDistanceFromUser = useCallback((lat, lng) => {
    if (!userLocation) return null;
    return geolocation.calculateDistance(userLocation.lat, userLocation.lng, lat, lng);
  }, [userLocation]);

  const filteredItems = items.filter((item) => {
    if (item.status !== 'active') return false;
    
    const distance = getDistanceFromUser(item.location.lat, item.location.lng);
    if (distance && distance > filters.distance) return false;

    if (filters.category !== 'all' && item.category.toLowerCase() !== filters.category) return false;

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
      case 'nearest':
        const distA = getDistanceFromUser(a.location.lat, a.location.lng) || Infinity;
        const distB = getDistanceFromUser(b.location.lat, b.location.lng) || Infinity;
        return distA - distB;
      default:
        return 0;
    }
  });

  const getUser = useCallback((userId) => {
    const found = users.find((u) => u.id === userId);
    if (found) return found;
    const mock = mockUsers.find((u) => u.id === userId);
    if (mock) return mock;
    const fromItems = items.find(i => i.sellerId === userId);
    if (fromItems?.seller_name) {
      return {
        id: userId,
        name: fromItems.seller_name,
        avatar: fromItems.seller_avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
        rating: fromItems.seller_rating || 0,
        verified: !!fromItems.seller_verified,
        location: fromItems.location || { lat: 40.7128, lng: -74.006, address: '' },
      };
    }
    return currentUser;
  }, [users, items]);

  const addNotification = useCallback((notification) => {
    const newNotification = {
      ...notification,
      id: generateId(),
      read: false,
      createdAt: new Date().toISOString(),
    };
    setNotifications((prev) => [newNotification, ...prev]);
  }, []);

  const addItem = useCallback((item, status = 'active') => {
    const newItem = {
      ...item,
      id: generateId(),
      sellerId: currentUser.id,
      createdAt: new Date().toISOString(),
      status,
      views: 0,
      favorites: 0,
      boosted: false,
      boostExpiresAt: null,
      quantity: item.quantity || 1,
      salePrice: item.salePrice || null,
      saleEndsAt: item.saleEndsAt || null,
      variants: item.variants || [],
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
  }, [addNotification]);

  const updateItem = useCallback((itemId, updates) => {
    setItems((prev) => prev.map((item) => item.id === itemId ? { ...item, ...updates } : item));
  }, []);

  const deleteItem = useCallback((itemId) => {
    const item = items.find((i) => i.id === itemId);
    setItems((prev) => prev.filter((item) => item.id !== itemId));
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
      sellerId: currentUser.id,
      soldAt: new Date().toISOString(),
    };
    setSales((prev) => [saleRecord, ...prev]);
    addNotification({
      type: 'sale',
      title: 'Item Sold!',
      body: `"${item.title}" has been marked as sold.`,
    });
  }, [items, currentUser.id, addNotification]);

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

  const sendMessage = useCallback((conversationId, text, encryptionMeta = null) => {
    const newMessage = {
      id: generateId(),
      senderId: currentUser.id,
      text: encryptionMeta ? '(encrypted)' : text,
      time: new Date().toISOString(),
      read: false,
      ...(encryptionMeta ? { encrypted: true, ciphertext: encryptionMeta.ciphertext, iv: encryptionMeta.iv } : {}),
    };

    setMessages((prev) => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] || []), newMessage],
    }));

    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === conversationId
          ? { ...conv, lastMessage: text, lastMessageTime: newMessage.time }
          : conv
      )
    );
  }, [currentUser.id]);

  const markConversationRead = useCallback((conversationId) => {
    setConversations((prev) =>
      prev.map((c) => c.id === conversationId ? { ...c, unreadCount: 0 } : c)
    );
  }, []);

  const addConversation = useCallback((itemId, sellerId) => {
    const existingConv = conversations.find(
      (c) => c.itemId === itemId && c.participants.includes(currentUser.id)
    );

    if (existingConv) return existingConv;

    const newConv = {
      id: generateId(),
      itemId,
      participants: [currentUser.id, sellerId],
      lastMessage: '',
      lastMessageTime: new Date().toISOString(),
      unreadCount: 0,
    };

    setConversations((prev) => [newConv, ...prev]);
    setMessages((prev) => ({ ...prev, [newConv.id]: [] }));
    return newConv;
  }, [conversations]);

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
      reviewerId: currentUser.id,
      createdAt: new Date().toISOString(),
      verified: true,
    };
    setReviews((prev) => [...prev, newReview]);
    return newReview;
  }, []);

  const getReviewsForUser = useCallback((userId) => {
    return reviews.filter((r) => r.revieweeId === userId);
  }, [reviews]);

  const getUserRating = useCallback((userId) => {
    const userReviews = getReviewsForUser(userId);
    if (userReviews.length === 0) return 0;
    const sum = userReviews.reduce((acc, r) => acc + r.rating, 0);
    return (sum / userReviews.length).toFixed(1);
  }, [getReviewsForUser]);

  const markNotificationRead = useCallback((notificationId) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const unreadNotificationsCount = notifications.filter((n) => !n.read).length;
  const unreadMessagesCount = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const value = {
    currentUser,
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
