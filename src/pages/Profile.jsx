import { useState, useEffect, useMemo } from 'react';
import { Header } from '../components/layout';
import { Avatar, Rating, Button } from '../components/ui';
import Modal from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import {
  PinIcon, SettingsIcon, LogOutIcon, EditIcon, ShieldIcon, HelpIcon,
  BellIcon, MoonIcon, GlobeIcon, MapPinIcon, EyeIcon, HeartIcon,
  TrashIcon, ZapIcon, TrendingUpIcon, MessageIcon, ClockIcon,
} from '../components/ui/Icons';
import { useApp } from '../context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { formatDate, formatPrice } from '../utils/helpers';
import AddListing from './AddListing';
import '../styles/globals.css';
import './Profile.css';

const conditionLabels = {
  new: 'New',
  like_new: 'Like New',
  good: 'Good',
  fair: 'Fair',
};

const PLACEHOLDER_IMG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"%3E%3Crect fill="%231f1f2e" width="72" height="72" rx="8"/%3E%3Ctext x="36" y="40" text-anchor="middle" fill="%236B6B7B" font-size="11"%3E📦%3C/text%3E%3C/svg%3E';

function firstImage(item) {
  if (!item) return PLACEHOLDER_IMG;
  if (Array.isArray(item.images) && item.images.length > 0) return item.images[0];
  return PLACEHOLDER_IMG;
}

export default function Profile() {
  const {
    items, getReviewsForUser, getUserRating, setActiveTab,
    deleteItem, boostItem, getUserListings,
    getUserDrafts, getUserActiveListings, getItemAnalytics,
    conversations, getSoldItems, getTotalRevenue, sales,
    saveTemplate, deleteTemplate, getTemplates, templates,
  } = useApp();
  const { user: authUser, logout, updateProfile } = useAuth();
  const { toggleTheme } = useTheme();
  const { addToast } = useToast();

  const normalizeUser = (u) => {
    if (!u) return null;
    return {
      ...u,
      location: u.location || {
        lat: u.location_lat || 40.7128,
        lng: u.location_lng || -74.006,
        address: u.location_address || 'Not set',
      },
      joined: u.joined || u.joinedDate || (u.created_at ? new Date(u.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]),
      reviewCount: u.reviewCount ?? u.review_count ?? 0,
    };
  };

  const normalizedAuth = normalizeUser(authUser);

  const currentUser = normalizedAuth || {
    id: 'guest',
    name: 'Guest User',
    email: '',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=guest',
    rating: 0,
    verified: false,
    location: { lat: 40.7128, lng: -74.006, address: 'Not set' },
    bio: '',
    phone: '',
    joined: new Date().toISOString().split('T')[0],
    reviewCount: 0,
  };

  const userItems = useMemo(() => getUserListings(currentUser.id), [getUserListings, currentUser.id, items]);
  const userDrafts = useMemo(() => getUserDrafts(currentUser.id), [getUserDrafts, currentUser.id, items]);
  const userActiveItems = useMemo(() => getUserActiveListings(currentUser.id), [getUserActiveListings, currentUser.id, items]);

  const [activeTab, setActiveTabState] = useState('listings');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', bio: '', phone: '' });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showAnalytics, setShowAnalytics] = useState(null);
  const [editItemId, setEditItemId] = useState(null);
  const [showBoostModal, setShowBoostModal] = useState(null);

  const [settings, setSettings] = useState({
    notifications: true,
    darkMode: true,
    locationEnabled: true,
    distanceUnit: 'km',
    language: 'English',
  });

  const userReviews = useMemo(() => getReviewsForUser(currentUser.id), [getReviewsForUser, currentUser.id, reviews]);
  const userRating = useMemo(() => getUserRating(currentUser.id), [getUserRating, currentUser.id, reviews]);

  const totalItemViews = userActiveItems.reduce((sum, i) => sum + (i.views || 0), 0);
  const totalItemFavorites = userActiveItems.reduce((sum, i) => sum + (i.favorites || 0), 0);
  const totalConversations = conversations.filter((c) =>
    userActiveItems.some((i) => i.id === c.itemId)
  ).length;

  useEffect(() => {
    if (showEditModal) {
      setEditForm({
        name: currentUser.name || '',
        bio: currentUser.bio || '',
        phone: currentUser.phone || '',
      });
    }
  }, [showEditModal, currentUser.name, currentUser.bio, currentUser.phone]);

  const handleDeleteItem = (itemId) => {
    deleteItem(itemId);
    setShowDeleteConfirm(null);
    addToast('Listing deleted', 'success');
  };

  const handleBoostItem = (itemId, days) => {
    boostItem(itemId, days);
    setShowBoostModal(null);
    addToast(`Listing boosted for ${days} days!`, 'success');
  };

  const handleMenuClick = (action) => {
    switch (action) {
      case 'edit':
        setEditForm({ name: currentUser.name, bio: currentUser.bio, phone: currentUser.phone });
        setShowEditModal(true);
        break;
      case 'privacy':
        setShowPrivacyModal(true);
        break;
      case 'settings':
        setShowSettingsModal(true);
        break;
      case 'help':
        setShowHelpModal(true);
        break;
      case 'logout':
        logout();
        addToast('Logged out successfully', 'success');
        setActiveTab('home');
        break;
    }
  };

  const handleEditSave = async () => {
    if (authUser) {
      const result = await updateProfile({ name: editForm.name, bio: editForm.bio, phone: editForm.phone });
      if (result?.success === false) {
        addToast(result.error || 'Failed to update profile', 'error');
        return;
      }
    }
    addToast('Profile updated successfully', 'success');
    setShowEditModal(false);
  };

  const handleSettingToggle = (key) => {
    const newValue = !settings[key];
    setSettings((prev) => ({ ...prev, [key]: newValue }));
    if (key === 'darkMode') toggleTheme();
    addToast(`${key} ${newValue ? 'enabled' : 'disabled'}`, 'info');
  };

  const menuItems = [
    { icon: EditIcon, title: 'Edit Profile', subtitle: 'Update your information', action: 'edit' },
    { icon: ShieldIcon, title: 'Privacy & Security', subtitle: 'Manage your privacy settings', action: 'privacy' },
    { icon: SettingsIcon, title: 'Settings', subtitle: 'App preferences', action: 'settings' },
    { icon: HelpIcon, title: 'Help & Support', subtitle: 'Get help with TradeHub', action: 'help' },
  ];

  if (editItemId) {
    return (
      <AddListing
        editItemId={editItemId}
        onEditComplete={() => setEditItemId(null)}
      />
    );
  }

  return (
    <div className="page">
      <Header
        title="Profile"
        rightComponent={
          <button className="header-btn" onClick={() => setShowSettingsModal(true)}>
            <SettingsIcon size={20} />
          </button>
        }
      />

      <div className="profile-page">
        <div className="profile-header-section">
          <div className="profile-avatar-large">
            <img src={currentUser.avatar} alt={currentUser.name} />
            {currentUser.verified && (
              <div className="profile-verified-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            )}
          </div>
          <h1 className="profile-name">{currentUser.name}</h1>
          {currentUser.location?.address && (
            <div className="profile-location">
              <PinIcon size={16} />
              <span>{currentUser.location.address}</span>
            </div>
          )}

          <div className="profile-stats-grid">
            <div className="profile-stat">
              <div className="profile-stat-value">{userItems.length}</div>
              <div className="profile-stat-label">Listings</div>
            </div>
            <div className="profile-stat">
              <div className="profile-stat-value">{userReviews.length}</div>
              <div className="profile-stat-label">Reviews</div>
            </div>
            <div className="profile-stat">
              <div className="profile-stat-value">{userRating || 'New'}</div>
              <div className="profile-stat-label">Rating</div>
            </div>
          </div>

          {userRating > 0 && (
            <div className="profile-rating-row">
              <Rating value={userRating} />
              <span className="profile-rating-count">({userReviews.length} reviews)</span>
            </div>
          )}
        </div>

        {!authUser && (
          <div className="login-prompt">
            <p>Sign in to access all features</p>
            <Button onClick={() => { window.dispatchEvent(new CustomEvent('openAuthModal')); setActiveTab('home'); }}>
              Sign In
            </Button>
          </div>
        )}

        <div className="profile-tabs">
          <button className={`profile-tab ${activeTab === 'listings' ? 'active' : ''}`} onClick={() => setActiveTabState('listings')}>
            Listings
          </button>
          <button className={`profile-tab ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTabState('dashboard')}>
            Dashboard
          </button>
          <button className={`profile-tab ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTabState('analytics')}>
            Analytics
          </button>
          <button className={`profile-tab ${activeTab === 'reviews' ? 'active' : ''}`} onClick={() => setActiveTabState('reviews')}>
            Reviews
          </button>
          <button className={`profile-tab ${activeTab === 'menu' ? 'active' : ''}`} onClick={() => setActiveTabState('menu')}>
            Settings
          </button>
        </div>

        <div className="profile-tab-content">
          {activeTab === 'listings' && (
            <>
              {userDrafts.length > 0 && (
                <div className="listings-section">
                  <h4 className="listings-section-title">
                    <ClockIcon size={16} />
                    Drafts ({userDrafts.length})
                  </h4>
                  <div className="listings-list">
                    {userDrafts.map((item) => (
                      <div key={item.id} className="listing-card">
                        <img src={firstImage(item)} alt={item.title} className="listing-card-img" />
                        <div className="listing-card-body">
                          <h4 className="listing-card-title">{item.title}</h4>
                          <span className="listing-card-price">{formatPrice(item.price)}</span>
                          <span className="listing-card-status draft">Draft</span>
                        </div>
                        <div className="listing-card-actions">
                          <button className="listing-action-btn" onClick={() => setEditItemId(item.id)} title="Edit">
                            <EditIcon size={16} />
                          </button>
                          <button className="listing-action-btn danger" onClick={() => setShowDeleteConfirm(item.id)} title="Delete">
                            <TrashIcon size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {userActiveItems.length === 0 && userDrafts.length === 0 ? (
                <div className="empty-state">
                  <h3 className="empty-title">No listings yet</h3>
                  <p className="empty-text">Start selling by creating your first listing</p>
                </div>
              ) : (
                <div className="listings-section">
                  <h4 className="listings-section-title">
                    Active ({userActiveItems.length})
                  </h4>
                  <div className="listings-list">
                    {userActiveItems.map((item) => (
                      <div key={item.id} className="listing-card">
                        <img src={firstImage(item)} alt={item.title} className="listing-card-img" />
                        <div className="listing-card-body">
                          <h4 className="listing-card-title">{item.title}</h4>
                          <span className="listing-card-price">{formatPrice(item.price)}</span>
                          <div className="listing-card-meta">
                            <span><EyeIcon size={12} /> {item.views || 0}</span>
                            <span><HeartIcon size={12} /> {item.favorites || 0}</span>
                            {item.boosted && <span className="boost-badge">Boosted</span>}
                          </div>
                          <span className={`listing-card-status ${item.condition}`}>
                            {conditionLabels[item.condition] || item.condition}
                          </span>
                        </div>
                        <div className="listing-card-actions">
                          <button className="listing-action-btn" onClick={() => setShowAnalytics(item.id)} title="Analytics">
                            <TrendingUpIcon size={16} />
                          </button>
                          <button className="listing-action-btn" onClick={() => setShowBoostModal(item.id)} title="Boost">
                            <ZapIcon size={16} />
                          </button>
                          <button className="listing-action-btn" onClick={() => setEditItemId(item.id)} title="Edit">
                            <EditIcon size={16} />
                          </button>
                          <button className="listing-action-btn danger" onClick={() => setShowDeleteConfirm(item.id)} title="Delete">
                            <TrashIcon size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'analytics' && (
            <div className="analytics-dashboard">
              <div className="analytics-summary">
                <h4 className="analytics-section-title">Seller Performance</h4>
                <div className="analytics-grid">
                  <div className="analytics-card">
                    <EyeIcon size={20} />
                    <span className="analytics-value">{totalItemViews}</span>
                    <span className="analytics-label">Total Views</span>
                  </div>
                  <div className="analytics-card">
                    <HeartIcon size={20} />
                    <span className="analytics-value">{totalItemFavorites}</span>
                    <span className="analytics-label">Total Favorites</span>
                  </div>
                  <div className="analytics-card">
                    <MessageIcon size={20} />
                    <span className="analytics-value">{totalConversations}</span>
                    <span className="analytics-label">Inquiries</span>
                  </div>
                  <div className="analytics-card">
                    <span className="analytics-value">{userActiveItems.length}</span>
                    <span className="analytics-label">Active Items</span>
                  </div>
                </div>
              </div>

              {userActiveItems.length > 0 && (
                <div className="analytics-per-item">
                  <h4 className="analytics-section-title">Per Listing Breakdown</h4>
                  {userActiveItems.map((item) => (
                    <div key={item.id} className="analytics-row">
                      <div className="analytics-row-info">
                        <img src={firstImage(item)} alt={item.title} className="analytics-row-img" />
                        <div>
                          <div className="analytics-row-title">{item.title}</div>
                          <div className="analytics-row-price">{formatPrice(item.price)}</div>
                        </div>
                      </div>
                      <div className="analytics-row-stats">
                        <div className="analytics-stat" title="Views">
                          <EyeIcon size={14} />
                          <span>{item.views || 0}</span>
                        </div>
                        <div className="analytics-stat" title="Favorites">
                          <HeartIcon size={14} />
                          <span>{item.favorites || 0}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {userActiveItems.length === 0 && (
                <div className="empty-state">
                  <h3 className="empty-title">No analytics data</h3>
                  <p className="empty-text">Create listings to see your performance</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="seller-dashboard">
              <div className="dashboard-summary">
                <h4 className="analytics-section-title">Seller Dashboard</h4>
                <div className="dashboard-grid">
                  <div className="dashboard-card dashboard-card--revenue">
                    <span className="dashboard-card-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                        <line x1="12" y1="1" x2="12" y2="23" />
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                    </span>
                    <span className="dashboard-card-value">${getTotalRevenue(currentUser.id).toLocaleString()}</span>
                    <span className="dashboard-card-label">Total Revenue</span>
                  </div>
                  <div className="dashboard-card dashboard-card--sales">
                    <span className="dashboard-card-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    <span className="dashboard-card-value">{getSoldItems(currentUser.id).length}</span>
                    <span className="dashboard-card-label">Items Sold</span>
                  </div>
                  <div className="dashboard-card dashboard-card--active">
                    <span className="dashboard-card-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    </span>
                    <span className="dashboard-card-value">{userActiveItems.length}</span>
                    <span className="dashboard-card-label">Active</span>
                  </div>
                  <div className="dashboard-card dashboard-card--drafts">
                    <span className="dashboard-card-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </span>
                    <span className="dashboard-card-value">{templates.length}</span>
                    <span className="dashboard-card-label">Templates</span>
                  </div>
                </div>
              </div>

              {sales.length > 0 && (
                <div className="dashboard-section">
                  <h4 className="analytics-section-title">Recent Sales</h4>
                  <div className="sales-list">
                    {sales.slice(0, 5).map((sale) => (
                      <div key={sale.id} className="sale-card">
                        <img src={sale.itemImage || PLACEHOLDER_IMG} alt={sale.itemTitle} className="sale-card-img" />
                        <div className="sale-card-body">
                          <h4 className="sale-card-title">{sale.itemTitle}</h4>
                          <span className="sale-card-price">${sale.price}</span>
                          <span className="sale-card-date">
                            {new Date(sale.soldAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {templates.length > 0 && (
                <div className="dashboard-section">
                  <h4 className="analytics-section-title">Saved Templates</h4>
                  <div className="templates-list">
                    {templates.map((tmpl) => (
                      <div key={tmpl.id} className="template-card">
                        <div className="template-card-header">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span className="template-card-name">{tmpl.name}</span>
                        </div>
                        <div className="template-card-meta">
                          <span>{tmpl.category}</span>
                          <span>${tmpl.price}</span>
                        </div>
                        <button className="template-card-delete" onClick={() => deleteTemplate(tmpl.id)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sales.length === 0 && templates.length === 0 && (
                <div className="empty-state" style={{ marginTop: 20 }}>
                  <h3 className="empty-title">No sales yet</h3>
                  <p className="empty-text">Your sold items and revenue will appear here</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'reviews' && (
            <>
              {userReviews.length === 0 ? (
                <div className="empty-state">
                  <h3 className="empty-title">No reviews yet</h3>
                  <p className="empty-text">Complete transactions to receive reviews</p>
                </div>
              ) : (
                userReviews.map((review) => (
                  <div key={review.id} className="review-card">
                    <div className="review-header">
                      <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${review.reviewerId}`} alt="Reviewer" className="review-avatar" />
                      <div className="review-user-info">
                        <div className="review-user-name">User {review.reviewerId.slice(-4)}</div>
                        <div className="review-date">{formatDate(review.createdAt)}</div>
                      </div>
                      <Rating value={review.rating} size="sm" />
                    </div>
                    <p className="review-text">{review.text}</p>
                    {review.verified && (
                      <span className="verified-review-badge">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Verified Transaction
                      </span>
                    )}
                  </div>
                ))
              )}
            </>
          )}

          {activeTab === 'menu' && (
            <div className="menu-section">
              {menuItems.map((item) => (
                <div key={item.action} className="menu-item" onClick={() => handleMenuClick(item.action)}>
                  <div className="menu-icon"><item.icon size={20} /></div>
                  <div className="menu-text">
                    <div className="menu-title">{item.title}</div>
                    <div className="menu-subtitle">{item.subtitle}</div>
                  </div>
                  <div className="menu-arrow">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </div>
              ))}
              <div className="menu-item danger-menu-item" onClick={() => handleMenuClick('logout')}>
                <div className="menu-icon"><LogOutIcon size={20} /></div>
                <div className="menu-text">
                  <div className="menu-title">Log Out</div>
                  <div className="menu-subtitle">Sign out of your account</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Profile">
        <div className="settings-form">
          <div className="settings-avatar-edit">
            <img src={currentUser.avatar} alt={currentUser.name} />
            <button className="change-avatar-btn">Change Photo</button>
          </div>
          <div className="input-group">
            <label className="input-label">Name</label>
            <input type="text" className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </div>
          <div className="input-group">
            <label className="input-label">Bio</label>
            <textarea className="input" value={editForm.bio} onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })} />
          </div>
          <div className="input-group">
            <label className="input-label">Phone</label>
            <input type="tel" className="input" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          </div>
          <Button block onClick={handleEditSave}>Save Changes</Button>
        </div>
      </Modal>

      <Modal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} title="Settings">
        <div className="settings-list">
          <div className="setting-item" onClick={() => handleSettingToggle('notifications')}>
            <div className="setting-icon"><BellIcon size={20} /></div>
            <div className="setting-text">
              <div className="setting-title">Notifications</div>
              <div className="setting-desc">Receive push notifications</div>
            </div>
            <div className={`toggle ${settings.notifications ? 'active' : ''}`} />
          </div>
          <div className="setting-item" onClick={() => handleSettingToggle('darkMode')}>
            <div className="setting-icon"><MoonIcon size={20} /></div>
            <div className="setting-text">
              <div className="setting-title">Dark Mode</div>
              <div className="setting-desc">Enable dark theme</div>
            </div>
            <div className={`toggle ${settings.darkMode ? 'active' : ''}`} />
          </div>
          <div className="setting-item" onClick={() => handleSettingToggle('locationEnabled')}>
            <div className="setting-icon"><MapPinIcon size={20} /></div>
            <div className="setting-text">
              <div className="setting-title">Location</div>
              <div className="setting-desc">Allow location access</div>
            </div>
            <div className={`toggle ${settings.locationEnabled ? 'active' : ''}`} />
          </div>
        </div>
      </Modal>

      <Modal isOpen={showPrivacyModal} onClose={() => setShowPrivacyModal(false)} title="Privacy & Security">
        <div className="settings-list">
          <div className="setting-item">
            <div className="setting-icon"><ShieldIcon size={20} /></div>
            <div className="setting-text">
              <div className="setting-title">Two-Factor Auth</div>
              <div className="setting-desc">Add extra security</div>
            </div>
            <Button size="sm">Enable</Button>
          </div>
          <div className="setting-item">
            <div className="setting-icon"><GlobeIcon size={20} /></div>
            <div className="setting-text">
              <div className="setting-title">Profile Visibility</div>
              <div className="setting-desc">Who can see your profile</div>
            </div>
            <span className="setting-value">Public</span>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} title="Help & Support">
        <div className="help-options">
          <div className="help-item">FAQ</div>
          <div className="help-item">Contact Us</div>
          <div className="help-item">Report a Problem</div>
          <div className="help-item">Terms of Service</div>
          <div className="help-item">Privacy Policy</div>
        </div>
      </Modal>

      <Modal isOpen={!!showDeleteConfirm} onClose={() => setShowDeleteConfirm(null)} title="Delete Listing">
        <div className="delete-confirm">
          <p className="delete-confirm-text">Are you sure you want to delete this listing? This action cannot be undone.</p>
          <div className="delete-confirm-actions">
            <Button variant="secondary" block onClick={() => setShowDeleteConfirm(null)}>Cancel</Button>
            <Button block onClick={() => handleDeleteItem(showDeleteConfirm)} style={{ background: 'var(--error)', color: 'white' }}>Delete</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!showAnalytics} onClose={() => setShowAnalytics(null)} title="Listing Analytics">
        {showAnalytics && (() => {
          const analytics = getItemAnalytics(showAnalytics);
          const item = items.find((i) => i.id === showAnalytics);
          if (!analytics || !item) return <p>No data available</p>;
          return (
            <div className="analytics-detail">
              <div className="analytics-detail-item">
                <img src={firstImage(item)} alt={item.title} className="analytics-detail-img" />
                <div>
                  <h4 className="analytics-detail-title">{item.title}</h4>
                  <span className="analytics-detail-price">{formatPrice(item.price)}</span>
                </div>
              </div>
              <div className="analytics-detail-grid">
                <div className="analytics-detail-card">
                  <EyeIcon size={18} />
                  <span className="analytics-detail-value">{analytics.views}</span>
                  <span className="analytics-detail-label">Views</span>
                </div>
                <div className="analytics-detail-card">
                  <HeartIcon size={18} />
                  <span className="analytics-detail-value">{analytics.favorites}</span>
                  <span className="analytics-detail-label">Favorites</span>
                </div>
                <div className="analytics-detail-card">
                  <MessageIcon size={18} />
                  <span className="analytics-detail-value">{analytics.conversations}</span>
                  <span className="analytics-detail-label">Inquiries</span>
                </div>
                <div className="analytics-detail-card">
                  <ClockIcon size={18} />
                  <span className="analytics-detail-value">{formatDate(analytics.createdAt)}</span>
                  <span className="analytics-detail-label">Listed</span>
                </div>
              </div>
              {analytics.boosted && <span className="boost-badge boost-badge--lg">Currently Boosted</span>}
            </div>
          );
        })()}
      </Modal>

      <Modal isOpen={!!showBoostModal} onClose={() => setShowBoostModal(null)} title="Boost Listing">
        <div className="boost-modal">
          <p className="boost-modal-text">Boost your listing to appear at the top of search results and get more visibility.</p>
          <div className="boost-modal-options">
            {[3, 7, 14, 30].map((days) => (
              <button
                key={days}
                className="boost-modal-option"
                onClick={() => handleBoostItem(showBoostModal, days)}
              >
                <ZapIcon size={20} />
                <div>
                  <strong>{days} Days</strong>
                  <span>${days === 3 ? '2.99' : days === 7 ? '4.99' : days === 14 ? '8.99' : '14.99'}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
