import { useState, useRef, useCallback } from 'react';
import { Header } from '../components/layout';
import { useApp } from '../context';
import './Notifications.css';

export default function Notifications({ onClose }) {
  const { 
    notifications, 
    markNotificationRead, 
    markAllNotificationsRead,
    unreadNotificationsCount 
  } = useApp();
  const [filter, setFilter] = useState('all');
  const [swipedId, setSwipedId] = useState(null);
  const touchStartX = useRef(null);

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
      default: return '#ef4444';
    }
  };

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
    const date = new Date(dateString);
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
          {['all', 'unread', 'message', 'sale'].map((f) => (
            <button
              key={f}
              className={`filter-chip ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' && 'All'}
              {f === 'unread' && 'Unread'}
              {f === 'message' && 'Messages'}
              {f === 'sale' && 'Sales'}
            </button>
          ))}
        </div>

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
                onClick={() => markNotificationRead(notification.id)}
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
                  <span className="notification-time">{formatTime(notification.createdAt)}</span>
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
