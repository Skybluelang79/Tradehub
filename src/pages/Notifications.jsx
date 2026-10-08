import { useState, useRef, useCallback, useEffect } from 'react';
import { Header } from '../components/layout';
import { useApp } from '../context';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { api } from '../services/client';
import { categories } from '../services/api';
import { formatPrice } from '../utils/helpers';
import './Notifications.css';

export default function Notifications({ onClose }) {
  const { 
    notifications, 
    markNotificationRead, 
    markAllNotificationsRead,
    unreadNotificationsCount,
    setFilters,
    setActiveTab,
    items,
    setSelectedItem,
  } = useApp();
  const { isAuthenticated } = useAuth();
  const { addToast } = useToast();
  const [filter, setFilter] = useState('all');
  const [swipedId, setSwipedId] = useState(null);
  const [savedSearches, setSavedSearches] = useState(null);
  const touchStartX = useRef(null);

  // Saved searches and their alerts live on the server; localStorage only
  // holds the pre-login copy.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let cancelled = false;
    api.searches.list()
      .then((data) => { if (!cancelled) setSavedSearches(data.searches || []); })
      .catch(() => { if (!cancelled) setSavedSearches([]); });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const describeSearch = (s) => {
    const parts = [];
    parts.push(s.query ? `“${s.query}”` : 'Any keyword');
    const categoryName = categories.find((c) => c.id === s.category)?.name;
    if (categoryName) parts.push(categoryName);
    if (s.min_price != null && s.max_price != null) parts.push(`${formatPrice(s.min_price)} – ${formatPrice(s.max_price)}`);
    else if (s.min_price != null) parts.push(`From ${formatPrice(s.min_price)}`);
    else if (s.max_price != null) parts.push(`Up to ${formatPrice(s.max_price)}`);
    return parts.join(' · ');
  };

  const runSavedSearch = (s) => {
    setFilters((prev) => ({
      ...prev,
      search: s.query || '',
      category: s.category || 'all',
      minPrice: s.min_price ?? '',
      maxPrice: s.max_price ?? '',
    }));
    setActiveTab('home');
    if (onClose) onClose();
    addToast(`Showing results for “${s.name}”`, 'success');
  };

  const deleteSavedSearch = (id) => {
    const previous = savedSearches || [];
    setSavedSearches(previous.filter((s) => s.id !== id));
    api.searches.remove(id).catch(() => {
      setSavedSearches(previous);
      addToast('Could not delete saved search', 'error');
    });
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'all') return true;
    if (filter === 'unread') return !n.read;
    return n.type === filter;
  });

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'message':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        );
      case 'sale':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        );
      case 'offer':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        );
      case 'system':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        );
      case 'review':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        );
      case 'price_drop':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
            <polyline points="17 18 23 18 23 12" />
          </svg>
        );
      case 'saved_search':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        );
      default:
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        );
    }
  };

  const getIconColor = (type) => {
    switch (type) {
      case 'message': return '#3b82f6';
      case 'sale': return '#10b981';
      case 'offer': return '#f59e0b';
      case 'review': return '#8b5cf6';
      case 'price_drop': return '#3b82f6';
      case 'saved_search': return '#10b981';
      default: return '#ef4444';
    }
  };

  // Tapping an alert marks it read and, when it points at a listing, opens
  // that listing instead of leaving the user on the notifications screen.
  const openNotification = useCallback((notification) => {
    markNotificationRead(notification.id);
    const itemId = notification.data?.itemId;
    if (!itemId) return;
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    setSelectedItem(item);
    setActiveTab('home');
    if (onClose) onClose();
  }, [markNotificationRead, items, setSelectedItem, setActiveTab, onClose]);

  const handleTouchStart = useCallback((e, id) => {
    touchStartX.current = { x: e.touches[0].clientX, id };
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (!touchStartX.current) return;
    const diff = touchStartX.current.x - e.changedTouches[0].clientX;
    if (diff > 80) {
      setSwipedId(touchStartX.current.id);
      setTimeout(() => {
        markNotificationRead(touchStartX.current.id);
        setSwipedId(null);
      }, 300);
    }
    touchStartX.current = null;
  }, [markNotificationRead]);

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = now - date;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  if (!isAuthenticated) {
    return (
      <div className="notifications-page">
        <Header
          title="Notifications"
          leftComponent={
            onClose && (
              <button className="header-btn" onClick={onClose}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </button>
            )
          }
        />
        <div className="auth-gate">
          <div className="auth-gate-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>
          <h3 className="auth-gate-title">Sign in for notifications</h3>
          <p className="auth-gate-text">Get notified about messages, offers, sales, and more.</p>
          <button
            className="auth-gate-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }))}
          >
            Sign In
          </button>
          <button
            className="auth-gate-link"
            onClick={() => window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'signup' }))}
          >
            Create an account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="notifications-page">
      <Header
        title="Notifications"
        leftComponent={
          onClose && (
            <button className="header-btn" onClick={onClose}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )
        }
        rightComponent={
          unreadNotificationsCount > 0 && (
            <button 
              className="mark-all-read-btn"
              onClick={markAllNotificationsRead}
            >
              Mark all read
            </button>
          )
        }
      />

      <div className="notifications-content">
        <div className="notifications-filters">
          {['all', 'unread', 'message', 'sale', 'price_drop', 'saved_search'].map((f) => (
            <button
              key={f}
              className={`filter-chip ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' && 'All'}
              {f === 'unread' && 'Unread'}
              {f === 'message' && 'Messages'}
              {f === 'sale' && 'Sales'}
              {f === 'price_drop' && 'Price drops'}
              {f === 'saved_search' && 'Search alerts'}
            </button>
          ))}
        </div>

        {isAuthenticated && savedSearches && savedSearches.length > 0 && (
          <div className="saved-searches-section">
            <div className="saved-searches-header">
              <h3 className="saved-searches-title">Saved searches</h3>
              <span className="saved-searches-count">{savedSearches.length} of 50</span>
            </div>
            {savedSearches.map((s) => (
              <div key={s.id} className="saved-search-card">
                <div className="saved-search-info">
                  <p className="saved-search-name">{s.name}</p>
                  <p className="saved-search-meta">{describeSearch(s)}</p>
                </div>
                <div className="saved-search-actions">
                  <button className="saved-search-run" onClick={() => runSavedSearch(s)}>
                    Run
                  </button>
                  <button
                    className="saved-search-delete"
                    onClick={() => deleteSavedSearch(s.id)}
                    aria-label={`Delete saved search ${s.name}`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredNotifications.length === 0 ? (
          <div className="empty-notifications">
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <h3>No notifications</h3>
            <p>You're all caught up!</p>
          </div>
        ) : (
          <div className="notifications-list">
            {filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                className={`notification-item ${!notification.read ? 'unread' : ''} ${swipedId === notification.id ? 'swiped' : ''}`}
                onClick={() => openNotification(notification)}
                onTouchStart={(e) => handleTouchStart(e, notification.id)}
                onTouchEnd={handleTouchEnd}
              >
                <div 
                  className="notification-icon"
                  style={{ backgroundColor: `${getIconColor(notification.type)}20`, color: getIconColor(notification.type) }}
                >
                  {getNotificationIcon(notification.type)}
                </div>
                <div className="notification-content">
                  <p className="notification-title">{notification.title}</p>
                  <p className="notification-message">{notification.body || notification.message}</p>
                  <span className="notification-time">{formatTime(notification.createdAt || notification.created_at)}</span>
                </div>
                {!notification.read && <div className="unread-dot" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
