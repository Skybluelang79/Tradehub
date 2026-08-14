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

const StarsIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
  </svg>
);

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

export default function SellerProfile({ userId, onClose, onItemOpen }) {
  const { isAuthenticated } = useAuth();
  const { addToast } = useToast();
  const { addConversation, setActiveTab } = useApp();

  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([api.follows.storefront(userId), api.reviews.forUser(userId)])
      .then(([store, rev]) => {
        if (cancelled) return;
        setProfile(store);
        setReviews(rev.reviews || []);
        setFollowing(!!store.isFollowing);
        setFollowerCount(store.followerCount || 0);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Could not load this seller');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  const toggleFollow = useCallback(async () => {
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }));
      return;
    }
    setFollowBusy(true);
    try {
      const res = following
        ? await api.follows.unfollow(userId)
        : await api.follows.follow(userId);
      setFollowing(res.isFollowing);
      setFollowerCount(res.followerCount);
      addToast(res.isFollowing ? `You are now following ${profile?.user?.name}` : `You unfollowed ${profile?.user?.name}`, 'success');
    } catch (err) {
      addToast(err.message || 'Could not update follow', 'error');
    } finally {
      setFollowBusy(false);
    }
  }, [isAuthenticated, following, userId, profile, addToast]);

  const handleMessage = () => {
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }));
      return;
    }
    addConversation(null, userId);
    setActiveTab('chat');
    if (onClose) onClose();
  };

  const handleItemClick = (item) => {
    if (onItemOpen) onItemOpen(item);
  };

  const user = profile?.user;
  const listings = normalizeItems(profile?.listings, user);
  const stats = profile?.stats || {};
  const rating = user?.rating || 0;

  return (
    <div className="seller-profile">
      <div className="seller-profile-topbar">
        <Header
          title="Seller Profile"
          subtitle={loading || error ? 'Storefront' : `${user.name}'s storefront`}
          leftComponent={
            <button className="header-btn" onClick={onClose} aria-label="Back">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          }
        />
      </div>

      <div className="seller-profile-content">
        {loading && (
          <div className="seller-profile-state">Loading seller profile…</div>
        )}

        {error && (
          <div className="seller-profile-state">
            <p>{error}</p>
            <button className="seller-profile-state-btn" onClick={onClose}>Back</button>
          </div>
        )}

        {!loading && !error && user && (
          <>
            <div className="seller-profile-card">
              <div className="seller-profile-head">
                <Avatar src={user.avatar} alt={user.name} size="xl" verified={user.verified} />
                <div className="seller-profile-head-info">
                  <div className="seller-profile-name">
                    {user.name}
                    {user.verified && (
                      <span className="seller-profile-verified" title="Verified seller">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <div className="seller-profile-rating">
                    <Rating value={rating} showValue={false} size="sm" />
                    <span className="seller-profile-rating-num">
                      {rating ? rating.toFixed(1) : 'New'}
                    </span>
                    <span className="seller-profile-reviews-count">
                      ({user.review_count || reviews.length} reviews)
                    </span>
                  </div>
                  {user.bio && <p className="seller-profile-bio">{user.bio}</p>}
                </div>
              </div>

              <div className="seller-profile-meta">
                {user.location_address && (
                  <span className="seller-profile-meta-item">
                    <PinIconSvg /> {user.location_address}
                  </span>
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
                  <span className="seller-profile-stat-value">{profile.followingCount || 0}</span>
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
              </div>
              {listings.length > 0 ? (
                <ItemsGrid items={listings} onItemClick={handleItemClick} viewMode="grid" />
              ) : (
                <div className="seller-profile-state">No active listings yet.</div>
              )}
            </div>

            <div className="seller-profile-section">
              <div className="seller-profile-section-head">
                <h3 className="seller-profile-section-title">
                  Seller Reviews
                  <span className="seller-profile-section-count">({reviews.length})</span>
                </h3>
                {reviews.length > 3 && (
                  <button className="seller-profile-see-all" onClick={() => setShowAllReviews((v) => !v)}>
                    {showAllReviews ? 'Show Less' : 'See All'}
                  </button>
                )}
              </div>
              {reviews.length > 0 ? (
                <div className="seller-profile-reviews">
                  {(showAllReviews ? reviews : reviews.slice(0, 3)).map((review) => (
                    <div key={review.id} className="seller-profile-review">
                      <div className="seller-profile-review-head">
                        <Avatar src={review.reviewer_avatar} alt={review.reviewer_name} size="sm" />
                        <span className="seller-profile-review-name">{review.reviewer_name}</span>
                        <Rating value={review.rating} size="sm" />
                        {!!review.verified && (
                          <span className="seller-profile-review-verified">
                            <StarsIcon size={12} /> Verified purchase
                          </span>
                        )}
                      </div>
                      {review.text && <p className="seller-profile-review-text">{review.text}</p>}
                      <span className="seller-profile-review-date">{formatDate(review.created_at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="seller-profile-state">No reviews yet.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
