import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { mockItems, mockUsers, mockConversations, mockMessages, mockTransactions, mockReviews, mockPaymentMethods, currentUser } from '../services/api';
import { storage, geolocation } from '../services/storage';
import { generateId } from '../utils/helpers';

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
    return mockUsers.find((u) => u.id === userId) || currentUser;
  }, []);

  const addItem = useCallback((item) => {
    const newItem = {
      ...item,
      id: generateId(),
      sellerId: currentUser.id,
      createdAt: new Date().toISOString(),
      status: 'active',
      views: 0,
      favorites: 0,
    };
    setItems((prev) => [newItem, ...prev]);
    addNotification({
      type: 'system',
      title: 'Listing Created',
      body: `"${newItem.title}" is now live!`,
    });
    return newItem;
  }, [addNotification]);

  const updateItem = useCallback((itemId, updates) => {
    setItems((prev) => prev.map((item) => item.id === itemId ? { ...item, ...updates } : item));
  }, []);

  const deleteItem = useCallback((itemId) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId));
  }, []);

  const sendMessage = useCallback((conversationId, text) => {
    const newMessage = {
      id: generateId(),
      senderId: currentUser.id,
      text,
      time: new Date().toISOString(),
      read: false,
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

  const addNotification = useCallback((notification) => {
    const newNotification = {
      ...notification,
      id: generateId(),
      read: false,
      createdAt: new Date().toISOString(),
    };
    setNotifications((prev) => [newNotification, ...prev]);
  }, []);

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
