import { useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../ui/Toast';
import { categories } from '../../services/api';
import { formatPrice, formatDate } from '../../utils/helpers';
import './CommunityFeed.css';

const PLACEHOLDER_IMG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"%3E%3Crect fill="%231f1f2e" width="72" height="72" rx="8"/%3E%3Ctext x="36" y="40" text-anchor="middle" fill="%236B6B7B" font-size="11"%3E📦%3C/text%3E%3C/svg%3E';

export default function CommunityFeed({ items, onItemClick }) {
  const { isAuthenticated } = useAuth();
  const { addToast } = useToast();

  const activeItems = useMemo(() =>
    (items || []).filter((i) => i.status === 'active')
  , [items]);

  const stats = useMemo(() => {
    const views = activeItems.reduce((sum, i) => sum + (i.views || 0), 0);
    const catIds = new Set(activeItems.map((i) => i.category).filter(Boolean));
    return { listings: activeItems.length, views, categories: catIds.size };
  }, [activeItems]);

  const recent = useMemo(() =>
    [...activeItems]
      .sort((a, b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0))
      .slice(0, 6)
  , [activeItems]);

  const handleJoin = () => {
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }));
      return;
    }
    addToast('You are part of the community', 'success');
  };

  const categoryName = (id) => categories.find((c) => c.id === id)?.name || 'General';

  return (
    <section className="community-feed">
      <div className="community-feed-header">
        <div className="community-feed-heading">
          <span className="community-feed-eyebrow">TradeHub Community</span>
          <h3 className="community-feed-title">Fresh from the community</h3>
          <p className="community-feed-subtitle">New listings from neighbors near you</p>
        </div>
        <button type="button" className="community-join-btn" onClick={handleJoin}>
          Join the community
        </button>
      </div>

      <div className="community-stats">
        <div className="community-stat">
          <strong>{stats.listings}</strong>
          <span>Active listings</span>
        </div>
        <div className="community-stat">
          <strong>{stats.views.toLocaleString()}</strong>
          <span>Total views</span>
        </div>
        <div className="community-stat">
          <strong>{stats.categories}</strong>
          <span>Categories</span>
        </div>
      </div>

      {recent.length === 0 ? (
        <div className="community-empty">Be the first to list something in your area.</div>
      ) : (
        <ul className="community-activity">
          {recent.map((item) => (
            <li key={item.id} className="community-activity-item" onClick={() => onItemClick && onItemClick(item)}>
              <img
                className="community-activity-thumb"
                src={item.images?.[0] || PLACEHOLDER_IMG}
                alt={item.title}
                loading="lazy"
              />
              <div className="community-activity-info">
                <div className="community-activity-title">{item.title}</div>
                <div className="community-activity-meta">
                  <span className="community-activity-price">{formatPrice(item.price)}</span>
                  <span>·</span>
                  <span>{categoryName(item.category)}</span>
                  <span>·</span>
                  <span>{formatDate(item.createdAt || item.created_at)}</span>
                </div>
              </div>
              <span className="community-activity-arrow">→</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
