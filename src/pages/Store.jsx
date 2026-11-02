import { useState, useEffect, useCallback } from 'react';
import { Header } from '../components/layout';
import { Avatar, Rating } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context';
import { api } from '../services/client';
import { ItemsGrid } from '../components/features';
import { formatDate } from '../utils/helpers';
import './SellerProfile.css';

const PinIconSvg = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const CalendarIconSvg = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const normalizeItems = (listings, user) => (listings || []).map((item) => ({
  ...item,
  sellerId: user?.id,
  seller_name: user?.name,
  images: item.images || [],
  location: { lat: 0, lng: 0, address: user?.location_address || '' },
  salePrice: item.sale_price,
  saleEndsAt: null,
  createdAt: item.created_at,
  isAuction: false,
  boosted: false,
  startingBid: item.price,
  currentBid: item.price,
  condition: item.condition,
  quantity: 1,
}));

export default function Store({ slug, onBack, onItemOpen }) {
  const { isAuthenticated } = useAuth();
  const { addToast } = useToast();
  const { addConversation, setActiveTab } = useApp();

  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
    if (!slug) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.storefront.bySlug(slug)
      .then((data) => {
        if (cancelled) return;
        setStore(data);
        setFollowing(!!data.isFollowing);
        setFollowerCount(data.followerCount || 0);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Could not load this store');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [slug]);

  const toggleFollow = useCallback(async () => {
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }));
      return;
    }
    if (!store?.user?.id) return;
    setFollowBusy(true);
    try {
      const res = following
        ? await api.follows.unfollow(store.user.id)
        : await api.follows.follow(store.user.id);
      setFollowing(res.isFollowing);
      setFollowerCount(res.followerCount);
      addToast(res.isFollowing ? `You are now following ${store.user.name}` : `You unfollowed ${store.user.name}`, 'success');
    } catch (err) {
      addToast(err.message || 'Could not update follow', 'error');
    } finally {
      setFollowBusy(false);
    }
  }, [isAuthenticated, following, store, addToast]);

  const handleMessage = () => {
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }));
      return;
    }
    if (!store?.user?.id) return;
    addConversation(null, store.user.id);
    setActiveTab('chat');
  };

  const user = store?.user;
  const listings = normalizeItems(store?.listings, user);
  const stats = store?.stats || {};

  return (
    <div className="seller-profile">
      <div className="seller-profile-topbar">
        <Header
          title={user ? user.name : 'Store'}
          subtitle={store?.user?.store_description || 'Storefront'}
          leftComponent={(
            <button className="header-btn" onClick={onBack} aria-label="Back">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )}
        />
      </div>

      <div className="seller-profile-content">
        {loading && <div className="seller-profile-state">Loading store…</div>}

        {error && (
          <div className="seller-profile-state">
            <p>{error}</p>
            <button className="seller-profile-state-btn" onClick={onBack}>Back to home</button>
          </div>
        )}

        {!loading && !error && user && (
          <>
            {user.store_banner && (
              <div
                role="img"
                aria-label={`${user.name} store banner`}
                style={{
                  height: 180,
                  borderRadius: 12,
                  backgroundImage: `url(${user.store_banner})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  marginBottom: 16,
                }}
              />
            )}

            <div className="seller-profile-card">
              <div className="seller-profile-head">
                <Avatar src={user.avatar} alt={user.name} size="xl" verified={user.verified} />
                <div className="seller-profile-head-info">
                  <div className="seller-profile-name">{user.name}</div>
                  {user.identity_verified && (
                    <span className="seller-profile-identity-badge" title="Identity verified">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
                        <path d="M9 12l2 2 4-4" />
                      </svg>
                      Verified Seller
                    </span>
                  )}
                  <div className="seller-profile-rating">
                    <Rating value={user.rating || 0} showValue={false} size="sm" />
                    <span className="seller-profile-rating-num">
                      {user.rating ? Number(user.rating).toFixed(1) : 'New'}
                    </span>
                    <span className="seller-profile-reviews-count">({user.review_count || 0} reviews)</span>
                  </div>
                  {(user.store_description || user.bio) && (
                    <p className="seller-profile-bio">{user.store_description || user.bio}</p>
                  )}
                </div>
              </div>

              <div className="seller-profile-meta">
                {user.location_address && (
                  <span className="seller-profile-meta-item"><PinIconSvg /> {user.location_address}</span>
                )}
                <span className="seller-profile-meta-item">
                  <CalendarIconSvg /> Member since {formatDate(user.created_at)}
                </span>
              </div>

              <div className="seller-profile-stats">
                <div className="seller-profile-stat">
                  <span className="seller-profile-stat-value">{stats.active_listings || 0}</span>
                  <span className="seller-profile-stat-label">Active</span>
                </div>
                <div className="seller-profile-stat">
                  <span className="seller-profile-stat-value">{stats.sold_listings || 0}</span>
                  <span className="seller-profile-stat-label">Sold</span>
                </div>
                <div className="seller-profile-stat">
                  <span className="seller-profile-stat-value">{followerCount}</span>
                  <span className="seller-profile-stat-label">Followers</span>
                </div>
                <div className="seller-profile-stat">
                  <span className="seller-profile-stat-value">{store.followingCount || 0}</span>
                  <span className="seller-profile-stat-label">Following</span>
                </div>
              </div>

              <div className="seller-profile-actions">
                <button
                  className={`seller-profile-follow ${following ? 'is-following' : ''}`}
                  onClick={toggleFollow}
                  disabled={followBusy}
                >
                  {followBusy ? '…' : following ? 'Following' : 'Follow'}
                </button>
                <button className="seller-profile-message" onClick={handleMessage}>
                  Message
                </button>
              </div>
            </div>

            <div className="seller-profile-section">
              <div className="seller-profile-section-head">
                <h3 className="seller-profile-section-title">
                  Listings
                  <span className="seller-profile-section-count">({stats.total_listings || 0})</span>
                </h3>
                <span className="seller-profile-section-count">/store/{user.store_slug}</span>
              </div>
              {listings.length > 0 ? (
                <ItemsGrid items={listings} onItemClick={onItemOpen} viewMode="grid" />
              ) : (
                <div className="seller-profile-state">No active listings yet.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
