import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Header } from '../components/layout';
import { Avatar, Rating, Button } from '../components/ui';
import Modal from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { api } from '../services/client';
import {
  PinIcon, SettingsIcon, LogOutIcon, EditIcon, ShieldIcon, HelpIcon,
  BellIcon, MoonIcon, GlobeIcon, MapPinIcon, EyeIcon, HeartIcon,
  TrashIcon, ZapIcon, TrendingUpIcon, MessageIcon, ClockIcon,
  CheckIcon, CameraIcon,
} from '../components/ui/Icons';
import { useApp } from '../context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from '../context/LanguageContext';
import { formatDate, formatPrice } from '../utils/helpers';
import { categories } from '../services/api';
import AddListing from './AddListing';
import '../styles/globals.css';
import './Profile.css';

const conditionLabels = {
  new: 'New',
  like_new: 'Like New',
  good: 'Good',
  fair: 'Fair',
};

const LANGUAGE_TO_CODE = {
  English: 'en',
  French: 'fr',
  Spanish: 'es',
  German: 'de',
};
const CODE_TO_LANGUAGE = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
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
    deleteItem, updateItem, boostItem, getUserListings,
    getUserDrafts, getUserActiveListings, getItemAnalytics,
    conversations, getSoldItems, getTotalRevenue,
    deleteTemplate, templates,
  } = useApp();
  const { user: authUser, logout, updateProfile, changePassword, deleteAccount, resendVerification } = useAuth();
  const { toggleTheme, setTheme } = useTheme();
  const { setLang } = useTranslation();
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

  const userItems = useMemo(() => getUserListings(currentUser.id), [getUserListings, currentUser.id]);
  const userDrafts = useMemo(() => getUserDrafts(currentUser.id), [getUserDrafts, currentUser.id]);
  const userActiveItems = useMemo(() => getUserActiveListings(currentUser.id), [getUserActiveListings, currentUser.id]);

  const [activeTab, setActiveTabState] = useState('listings');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', bio: '', phone: '', locationAddress: '' });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showAnalytics, setShowAnalytics] = useState(null);
  const [editItemId, setEditItemId] = useState(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkForm, setBulkForm] = useState({ price: '', category: '', condition: '', quantity: '' });
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showBoostModal, setShowBoostModal] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [verificationSending, setVerificationSending] = useState(false);
  const avatarInputRef = useRef(null);

  const [settings, setSettings] = useState({
    notifications: true,
    darkMode: true,
    locationEnabled: true,
    distanceUnit: 'km',
    language: 'English',
    profileVisibility: 'public',
    currency: 'USD',
  });

  const SETTINGS_TABS = [
    { id: 'general', label: 'General', icon: '⚙' },
    { id: 'notifications', label: 'Notifications', icon: '🔔' },
    { id: 'preferences', label: 'Preferences', icon: '✨' },
    { id: 'searches', label: 'Saved Searches', icon: '🔍' },
  ];
  const [settingsTab, setSettingsTab] = useState('general');

  const [notifPrefs, setNotifPrefs] = useState({
    messages: true,
    priceDrops: true,
    followers: true,
    boosts: true,
  });

  const [savedSearches, setSavedSearches] = useState([]);

  const loadSavedSearches = useCallback(async () => {
    try {
      const { searches } = await api.searches.list();
      setSavedSearches(searches || []);
    } catch {}
  }, []);

  useEffect(() => {
    if (showSettingsModal) loadSavedSearches();
  }, [showSettingsModal, loadSavedSearches]);

  const removeSavedSearch = async (id) => {
    try {
      await api.searches.remove(id);
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
      addToast('Search removed', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const SETTING_KEY_MAP = {
    notifications: 'notifications',
    darkMode: 'dark_mode',
    locationEnabled: 'location_enabled',
    distanceUnit: 'distance_unit',
    language: 'language',
    profileVisibility: 'profile_visibility',
    currency: 'currency',
  };

  const NOTIF_KEY_MAP = {
    messages: 'notif_messages',
    priceDrops: 'notif_price_drops',
    followers: 'notif_followers',
    boosts: 'notif_boosts',
  };

  useEffect(() => {
    if (!authUser) return;
    api.settings.get().then(({ settings: s }) => {
      if (!s) return;
      setSettings({
        notifications: !!s.notifications,
        darkMode: !!s.dark_mode,
        locationEnabled: !!s.location_enabled,
        distanceUnit: s.distance_unit || 'km',
        language: s.language || 'English',
        profileVisibility: s.profile_visibility || 'public',
        currency: s.currency || 'USD',
      });
      setNotifPrefs({
        messages: !!s.notif_messages,
        priceDrops: !!s.notif_price_drops,
        followers: !!s.notif_followers,
        boosts: !!s.notif_boosts,
      });
      if (s.dark_mode === 1) setTheme(true);
      const langCode = LANGUAGE_TO_CODE[s.language];
      if (langCode) setLang(langCode);
    }).catch(() => {});
  }, [authUser, setTheme, setLang]);

  const userReviews = useMemo(() => getReviewsForUser(currentUser.id), [getReviewsForUser, currentUser.id]);
  const userRating = useMemo(() => getUserRating(currentUser.id), [getUserRating, currentUser.id]);

  const totalItemViews = userActiveItems.reduce((sum, i) => sum + (i.views || 0), 0);
  const totalItemFavorites = userActiveItems.reduce((sum, i) => sum + (i.favorites || 0), 0);
  const totalConversations = conversations.filter((c) =>
    userActiveItems.some((i) => i.id === c.itemId)
  ).length;

  const [sellerStats, setSellerStats] = useState(null);

  useEffect(() => {
    if (!authUser || (activeTab !== 'analytics' && activeTab !== 'dashboard')) return;
    let cancelled = false;
    api.payments.sellerAnalytics()
      .then((r) => { if (!cancelled) setSellerStats(r); })
      .catch((err) => console.error('Failed to load seller analytics:', err));
    return () => { cancelled = true; };
  }, [authUser, activeTab, items]);

  useEffect(() => {
    if (showEditModal) {
      setEditForm({
        name: currentUser.name || '',
        bio: currentUser.bio || '',
        phone: currentUser.phone || '',
        locationAddress: currentUser.location?.address || '',
      });
    }
  }, [showEditModal, currentUser.name, currentUser.bio, currentUser.phone, currentUser.location]);

  const handleDeleteItem = (itemId) => {
    deleteItem(itemId);
    setShowDeleteConfirm(null);
    addToast('Listing deleted', 'success');
  };

  const toggleBulkMode = () => {
    setBulkMode((m) => !m);
    setSelectedIds([]);
  };

  const toggleSelectItem = (id) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const confirmBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      await api.items.bulkDelete(selectedIds);
      selectedIds.forEach((id) => deleteItem(id));
      addToast(`${selectedIds.length} listing${selectedIds.length > 1 ? 's' : ''} deleted`, 'success');
      setShowBulkDeleteConfirm(false);
      setSelectedIds([]);
      setBulkMode(false);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const confirmBulkUpdate = async () => {
    if (selectedIds.length === 0) return;
    const updates = {};
    if (bulkForm.price !== '') updates.price = Number(bulkForm.price);
    if (bulkForm.category) updates.category = bulkForm.category;
    if (bulkForm.condition) updates.condition = bulkForm.condition;
    if (bulkForm.quantity !== '') updates.quantity = Number(bulkForm.quantity);
    setBulkBusy(true);
    try {
      const res = await api.items.bulkUpdate(selectedIds, updates);
      selectedIds.forEach((id) => updateItem(id, updates));
      addToast(`${res.updated} listing${res.updated > 1 ? 's' : ''} updated`, 'success');
      setShowBulkEditModal(false);
      setBulkForm({ price: '', category: '', condition: '', quantity: '' });
      setSelectedIds([]);
      setBulkMode(false);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBoostItem = (itemId, days) => {
    boostItem(itemId, days);
    setShowBoostModal(null);
    addToast(`Listing boosted for ${days} days!`, 'success');
  };

  const handleMenuClick = (action) => {
    switch (action) {
      case 'edit':
        setEditForm({
          name: currentUser.name,
          bio: currentUser.bio,
          phone: currentUser.phone,
          locationAddress: currentUser.location?.address || '',
        });
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
      const payload = { name: editForm.name, bio: editForm.bio, phone: editForm.phone };
      const currentAddress = currentUser.location?.address || '';
      if (editForm.locationAddress !== currentAddress) {
        payload.location = {
          ...(currentUser.location || {}),
          address: editForm.locationAddress,
        };
      }
      const result = await updateProfile(payload);
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
    api.settings.update({ [SETTING_KEY_MAP[key]]: newValue }).catch(() => {});
    addToast(`${key} ${newValue ? 'enabled' : 'disabled'}`, 'info');
  };

  const handleNotifToggle = (key) => {
    const newValue = !notifPrefs[key];
    setNotifPrefs((prev) => ({ ...prev, [key]: newValue }));
    api.settings.update({ [NOTIF_KEY_MAP[key]]: newValue }).catch(() => {});
  };

  const handleSettingValue = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    api.settings.update({ [SETTING_KEY_MAP[key]]: value }).catch(() => {});
    if (key === 'language') {
      const langCode = LANGUAGE_TO_CODE[value];
      if (langCode) setLang(langCode);
    }
    addToast('Preference saved', 'success');
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const res = await api.upload.single(file);
      if (!res?.file?.url) throw new Error('Upload failed');
      const result = await updateProfile({ avatar: res.file.url });
      if (result?.success === false) throw new Error(result.error || 'Failed to update profile');
      addToast('Profile photo updated', 'success');
    } catch (err) {
      addToast(err.message || 'Failed to upload photo', 'error');
    } finally {
      setAvatarUploading(false);
      e.target.value = '';
    }
  };

  const handleChangePassword = async () => {
    if (passwordForm.newPassword.length < 6) {
      addToast('Password must be at least 6 characters', 'error');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirm) {
      addToast('Passwords do not match', 'error');
      return;
    }
    const result = await changePassword(passwordForm.currentPassword, passwordForm.newPassword);
    if (result?.success === false) {
      addToast(result.error || 'Failed to change password', 'error');
      return;
    }
    addToast('Password changed successfully', 'success');
    setPasswordForm({ currentPassword: '', newPassword: '', confirm: '' });
    setShowPasswordModal(false);
  };

  const handleDeleteAccount = async () => {
    const result = await deleteAccount(deleteAccountPassword);
    if (result?.success === false) {
      addToast(result.error || 'Failed to delete account', 'error');
      return;
    }
    addToast('Account deleted', 'success');
    setShowDeleteAccountModal(false);
    setActiveTab('home');
  };

  const handleResendVerification = async () => {
    setVerificationSending(true);
    const result = await resendVerification();
    setVerificationSending(false);
    addToast(
      result?.success === false ? (result.error || 'Failed to send') : 'Verification email sent',
      result?.success === false ? 'error' : 'success'
    );
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

  const isLoggedIn = !!authUser;

  if (!isLoggedIn) {
    return (
      <div className="page">
        <Header title="Profile" />
        <div className="profile-page">
          <div className="profile-guest-hero">
            <div className="guest-hero-bg" />
            <div className="guest-hero-content">
              <div className="guest-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <h2 className="guest-title">Welcome to TradeHub</h2>
              <p className="guest-subtitle">Sign in to buy, sell, and manage your listings</p>

              <div className="guest-features">
                <div className="guest-feature">
                  <div className="guest-feature-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </div>
                  <span>Secure Transactions</span>
                </div>
                <div className="guest-feature">
                  <div className="guest-feature-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <span>In-App Chat</span>
                </div>
                <div className="guest-feature">
                  <div className="guest-feature-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <span>Fast Listings</span>
                </div>
              </div>

              <div className="guest-actions">
                <button className="guest-btn guest-btn--primary" onClick={() => window.dispatchEvent(new CustomEvent('openAuthModal'))}>
                  Sign In
                </button>
                <button className="guest-btn guest-btn--secondary" onClick={() => window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'signup' }))}>
                  Create Account
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
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
          {currentUser.location?.address && currentUser.location.address !== 'Not set' && (
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

        {!currentUser.verified && (
          <div className="verify-banner">
            <ShieldIcon size={16} />
            <span>Verify your email to build trust with buyers.</span>
            <button className="verify-banner-btn" onClick={handleResendVerification} disabled={verificationSending}>
              {verificationSending ? 'Sending...' : 'Send verification'}
            </button>
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
                  <div className="listings-section-header">
                    <h4 className="listings-section-title">
                      Active ({userActiveItems.length})
                    </h4>
                    {userActiveItems.length > 1 && (
                      <button className={`bulk-toggle-btn ${bulkMode ? 'active' : ''}`} onClick={toggleBulkMode}>
                        {bulkMode ? 'Done' : 'Bulk edit'}
                      </button>
                    )}
                  </div>
                  <div className="listings-list">
                    {userActiveItems.map((item) => {
                      const isSelected = selectedIds.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          className={`listing-card ${bulkMode ? 'bulk-mode' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={bulkMode ? () => toggleSelectItem(item.id) : undefined}
                        >
                          {bulkMode && (
                            <div className={`bulk-checkbox ${isSelected ? 'checked' : ''}`}>
                              <CheckIcon size={14} />
                            </div>
                          )}
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
                      );
                    })}
                  </div>
                  {bulkMode && (
                    <div className="bulk-action-bar">
                      <span className="bulk-count">{selectedIds.length} selected</span>
                      <div className="bulk-actions">
                        <button className="bulk-action-btn" disabled={selectedIds.length === 0} onClick={() => setShowBulkEditModal(true)}>
                          <EditIcon size={15} /> Edit
                        </button>
                        <button className="bulk-action-btn danger" disabled={selectedIds.length === 0} onClick={() => setShowBulkDeleteConfirm(true)}>
                          <TrashIcon size={15} /> Delete
                        </button>
                        <button className="bulk-action-btn select-all" disabled={selectedIds.length === userActiveItems.length} onClick={() => setSelectedIds(userActiveItems.map((i) => i.id))}>
                          Select all
                        </button>
                      </div>
                    </div>
                  )}
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
                    <span className="analytics-value">{(sellerStats?.totals?.views ?? totalItemViews).toLocaleString()}</span>
                    <span className="analytics-label">Total Views</span>
                  </div>
                  <div className="analytics-card">
                    <HeartIcon size={20} />
                    <span className="analytics-value">{(sellerStats?.totals?.favorites ?? totalItemFavorites).toLocaleString()}</span>
                    <span className="analytics-label">Total Favorites</span>
                  </div>
                  <div className="analytics-card">
                    <MessageIcon size={20} />
                    <span className="analytics-value">{totalConversations}</span>
                    <span className="analytics-label">Inquiries</span>
                  </div>
                  <div className="analytics-card">
                    <ZapIcon size={20} />
                    <span className="analytics-value">{sellerStats?.revenue?.sold ?? 0}</span>
                    <span className="analytics-label">Items Sold</span>
                  </div>
                  <div className="analytics-card">
                    <span className="analytics-value">{formatPrice(sellerStats?.revenue?.completed ?? 0)}</span>
                    <span className="analytics-label">Earned</span>
                  </div>
                  <div className="analytics-card">
                    <span className="analytics-value">{(sellerStats?.totals?.active ?? userActiveItems.length)}</span>
                    <span className="analytics-label">Active Items</span>
                  </div>
                </div>
              </div>

              {(sellerStats?.perItem?.length > 0) && (
                <div className="analytics-per-item">
                  <h4 className="analytics-section-title">Per Listing Breakdown</h4>
                  {(sellerStats.perItem).map((item) => (
                    <div key={item.id} className="analytics-row">
                      <div className="analytics-row-info">
                        <img src={item.image || PLACEHOLDER_IMG} alt={item.title} className="analytics-row-img" />
                        <div>
                          <div className="analytics-row-title">{item.title}</div>
                          <div className="analytics-row-price">
                            {item.status === 'sold' ? (
                              <span style={{ color: 'var(--success)' }}>Sold × {item.sold_count}</span>
                            ) : (
                              <span className="status-badge">{item.status}</span>
                            )}
                          </div>
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
                        <div className="analytics-stat" title="Sales">
                          <ZapIcon size={14} />
                          <span>{item.sold_count || 0}</span>
                        </div>
                        <div className="analytics-stat" title="Earned">
                          <span>{formatPrice(item.revenue || 0)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!sellerStats?.perItem?.length && userActiveItems.length === 0 && (
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
                    <span className="dashboard-card-value">{formatPrice(sellerStats?.revenue?.completed ?? getTotalRevenue(currentUser.id))}</span>
                    <span className="dashboard-card-label">Total Revenue</span>
                  </div>
                  <div className="dashboard-card dashboard-card--sales">
                    <span className="dashboard-card-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    <span className="dashboard-card-value">{sellerStats?.revenue?.sold ?? getSoldItems(currentUser.id).length}</span>
                    <span className="dashboard-card-label">Items Sold</span>
                  </div>
                  <div className="dashboard-card dashboard-card--active">
                    <span className="dashboard-card-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    </span>
                    <span className="dashboard-card-value">{sellerStats?.totals?.active ?? userActiveItems.length}</span>
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

              {(sellerStats?.sales?.length > 0) && (
                <div className="dashboard-section">
                  <h4 className="analytics-section-title">Recent Sales</h4>
                  <div className="sales-list">
                    {(sellerStats.sales).slice(0, 5).map((sale) => (
                      <div key={sale.id} className="sale-card">
                        <img src={sale.item_image || PLACEHOLDER_IMG} alt={sale.item_title} className="sale-card-img" />
                        <div className="sale-card-body">
                          <h4 className="sale-card-title">{sale.item_title}</h4>
                          <span className="sale-card-price">{formatPrice(sale.net_amount ?? sale.amount)}</span>
                          <span className="sale-card-date">
                            {sale.completed_at ? new Date(sale.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
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

              {!sellerStats?.sales?.length && templates.length === 0 && (
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
            <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={handleAvatarChange} />
            <button className="change-avatar-btn" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
              <CameraIcon size={14} />
              {avatarUploading ? 'Uploading...' : 'Change Photo'}
            </button>
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
          <div className="input-group">
            <label className="input-label">Location</label>
            <input type="text" className="input" value={editForm.locationAddress} onChange={(e) => setEditForm({ ...editForm, locationAddress: e.target.value })} placeholder="e.g. Manhattan, NYC" />
          </div>
          <Button block onClick={handleEditSave}>Save Changes</Button>
        </div>
      </Modal>

      <Modal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} title="Settings">
        <div className="settings-tabs">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`settings-tab ${settingsTab === tab.id ? 'active' : ''}`}
              onClick={() => setSettingsTab(tab.id)}
            >
              <span className="settings-tab-icon">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {settingsTab === 'general' && (
          <div className="settings-list">
            <div className="settings-group-title">General</div>
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
        )}

        {settingsTab === 'notifications' && (
          <div className="settings-list">
            <div className="settings-group-title">Notification Preferences</div>
            {[
              { key: 'messages', label: 'New Messages', desc: 'Notify when someone messages you' },
              { key: 'priceDrops', label: 'Price Drops', desc: 'Alerts when a saved item drops in price' },
              { key: 'followers', label: 'New Followers', desc: 'Notify when someone follows you' },
              { key: 'boosts', label: 'Listing Boosts', desc: 'Updates about boosted listings' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="setting-item" onClick={() => handleNotifToggle(key)}>
                <div className="setting-icon"><BellIcon size={20} /></div>
                <div className="setting-text">
                  <div className="setting-title">{label}</div>
                  <div className="setting-desc">{desc}</div>
                </div>
                <div className={`toggle ${notifPrefs[key] ? 'active' : ''}`} />
              </div>
            ))}
          </div>
        )}

        {settingsTab === 'preferences' && (
          <div className="settings-list">
            <div className="settings-group-title">Preferences</div>
            <div className="setting-item">
              <div className="setting-icon"><MapPinIcon size={20} /></div>
              <div className="setting-text">
                <div className="setting-title">Distance Unit</div>
                <div className="setting-desc">Measurement unit for distances</div>
              </div>
              <div className="segmented">
                {['km', 'mi'].map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    className={`segmented-btn ${settings.distanceUnit === unit ? 'active' : ''}`}
                    onClick={() => handleSettingValue('distanceUnit', unit)}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-item">
              <div className="setting-icon"><GlobeIcon size={20} /></div>
              <div className="setting-text">
                <div className="setting-title">Language</div>
                <div className="setting-desc">App language</div>
              </div>
              <select className="setting-select" value={settings.language} onChange={(e) => handleSettingValue('language', e.target.value)}>
                <option value="English">English</option>
                <option value="French">Français</option>
                <option value="Spanish">Español</option>
                <option value="German">Deutsch</option>
              </select>
            </div>
            <div className="setting-item">
              <div className="setting-icon"><span className="currency-icon">$</span></div>
              <div className="setting-text">
                <div className="setting-title">Currency</div>
                <div className="setting-desc">Display currency for prices</div>
              </div>
              <select className="setting-select" value={settings.currency} onChange={(e) => handleSettingValue('currency', e.target.value)}>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="CAD">CAD (C$)</option>
                <option value="AUD">AUD (A$)</option>
                <option value="JPY">JPY (¥)</option>
              </select>
            </div>
            <div className="setting-item">
              <div className="setting-icon"><ShieldIcon size={20} /></div>
              <div className="setting-text">
                <div className="setting-title">Profile Visibility</div>
                <div className="setting-desc">Who can see your profile</div>
              </div>
              <select className="setting-select" value={settings.profileVisibility} onChange={(e) => handleSettingValue('profileVisibility', e.target.value)}>
                <option value="public">Public</option>
                <option value="contacts">Contacts</option>
                <option value="private">Private</option>
              </select>
            </div>
          </div>
        )}

        {settingsTab === 'searches' && (
          <div className="settings-list">
            <div className="settings-group-title">Saved Searches</div>
            {savedSearches.length === 0 ? (
              <div className="setting-item">
                <div className="setting-icon"><ZapIcon size={20} /></div>
                <div className="setting-text">
                  <div className="setting-title">No saved searches</div>
                  <div className="setting-desc">Use the "Save" button in the search bar to get alerts on new matches.</div>
                </div>
              </div>
            ) : (
              savedSearches.map((s) => {
                const summary = [
                  s.query && `"${s.query}"`,
                  s.category || null,
                  s.min_price && s.max_price ? `$${s.min_price}–$${s.max_price}` : s.min_price ? `From $${s.min_price}` : s.max_price ? `Up to $${s.max_price}` : null,
                ].filter(Boolean).join(' · ');
                return (
                  <div key={s.id} className="setting-item">
                    <div className="setting-icon"><ZapIcon size={20} /></div>
                    <div className="setting-text">
                      <div className="setting-title">{s.name}</div>
                      <div className="setting-desc">{summary || 'General search'}</div>
                    </div>
                    <button className="delete-search-btn" onClick={() => removeSavedSearch(s.id)} aria-label="Delete search">
                      <TrashIcon size={16} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </Modal>

      <Modal isOpen={showPrivacyModal} onClose={() => setShowPrivacyModal(false)} title="Privacy & Security">
        <div className="settings-list">
          <div className="setting-item">
            <div className="setting-icon"><ShieldIcon size={20} /></div>
            <div className="setting-text">
              <div className="setting-title">Email Verification</div>
              <div className="setting-desc">
                {currentUser.verified ? 'Your email is verified' : 'Verify your email address'}
              </div>
            </div>
            {currentUser.verified ? (
              <span className="verified-badge"><CheckIcon size={14} /> Verified</span>
            ) : (
              <Button size="sm" onClick={handleResendVerification} disabled={verificationSending}>
                {verificationSending ? 'Sending...' : 'Resend'}
              </Button>
            )}
          </div>
          <div className="setting-item" onClick={() => { setShowPasswordModal(true); setShowPrivacyModal(false); }}>
            <div className="setting-icon"><ShieldIcon size={20} /></div>
            <div className="setting-text">
              <div className="setting-title">Change Password</div>
              <div className="setting-desc">Update your account password</div>
            </div>
            <Button size="sm">Change</Button>
          </div>
          <div className="setting-item" onClick={() => { setShowSettingsModal(true); setShowPrivacyModal(false); }}>
            <div className="setting-icon"><GlobeIcon size={20} /></div>
            <div className="setting-text">
              <div className="setting-title">Profile Visibility</div>
              <div className="setting-desc">Who can see your profile</div>
            </div>
            <span className="setting-value">{settings.profileVisibility}</span>
          </div>
          <div className="setting-item">
            <div className="setting-icon"><ShieldIcon size={20} /></div>
            <div className="setting-text">
              <div className="setting-title">Two-Factor Auth</div>
              <div className="setting-desc">Add extra security</div>
            </div>
            <Button size="sm" onClick={() => addToast('Two-factor auth coming soon', 'info')}>Enable</Button>
          </div>
          <div className="setting-item danger-setting-item" onClick={() => { setShowDeleteAccountModal(true); setShowPrivacyModal(false); }}>
            <div className="setting-icon"><TrashIcon size={20} /></div>
            <div className="setting-text">
              <div className="setting-title">Delete Account</div>
              <div className="setting-desc">Permanently delete your account and data</div>
            </div>
            <Button size="sm" style={{ background: 'var(--error)', color: 'white' }}>Delete</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showPasswordModal} onClose={() => setShowPasswordModal(false)} title="Change Password">
        <div className="settings-form">
          <div className="input-group">
            <label className="input-label">Current Password</label>
            <input
              type="password"
              className="input"
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
            />
          </div>
          <div className="input-group">
            <label className="input-label">New Password</label>
            <input
              type="password"
              className="input"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
            />
          </div>
          <div className="input-group">
            <label className="input-label">Confirm New Password</label>
            <input
              type="password"
              className="input"
              value={passwordForm.confirm}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
            />
          </div>
          <Button block onClick={handleChangePassword}>Update Password</Button>
        </div>
      </Modal>

      <Modal isOpen={showDeleteAccountModal} onClose={() => setShowDeleteAccountModal(false)} title="Delete Account">
        <div className="delete-confirm">
          <p className="delete-confirm-text">
            This will permanently delete your account, listings, and all associated data. This action cannot be undone.
          </p>
          <div className="input-group">
            <label className="input-label">Enter your password to confirm</label>
            <input
              type="password"
              className="input"
              value={deleteAccountPassword}
              onChange={(e) => setDeleteAccountPassword(e.target.value)}
            />
          </div>
          <div className="delete-confirm-actions">
            <Button variant="secondary" block onClick={() => setShowDeleteAccountModal(false)}>Cancel</Button>
            <Button block onClick={handleDeleteAccount} style={{ background: 'var(--error)', color: 'white' }}>Delete Account</Button>
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

      <Modal isOpen={showBulkDeleteConfirm} onClose={() => setShowBulkDeleteConfirm(false)} title="Delete Selected">
        <div className="delete-confirm">
          <p className="delete-confirm-text">
            Are you sure you want to delete {selectedIds.length} selected listing{selectedIds.length > 1 ? 's' : ''}? This action cannot be undone.
          </p>
          <div className="delete-confirm-actions">
            <Button variant="secondary" block onClick={() => setShowBulkDeleteConfirm(false)} disabled={bulkBusy}>Cancel</Button>
            <Button block onClick={confirmBulkDelete} disabled={bulkBusy} style={{ background: 'var(--error)', color: 'white' }}>
              {bulkBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showBulkEditModal} onClose={() => setShowBulkEditModal(false)} title={`Edit ${selectedIds.length} Listing${selectedIds.length > 1 ? 's' : ''}`}>
        <div className="settings-form">
          <p className="bulk-edit-hint">Only fill in the fields you want to change. Empty fields are left untouched.</p>
          <div className="input-group">
            <label className="input-label">Price ($)</label>
            <input type="number" min="0" className="input" value={bulkForm.price} onChange={(e) => setBulkForm({ ...bulkForm, price: e.target.value })} placeholder="Leave empty to keep" />
          </div>
          <div className="input-group">
            <label className="input-label">Category</label>
            <select className="input" value={bulkForm.category} onChange={(e) => setBulkForm({ ...bulkForm, category: e.target.value })}>
              <option value="">Keep current</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Condition</label>
            <select className="input" value={bulkForm.condition} onChange={(e) => setBulkForm({ ...bulkForm, condition: e.target.value })}>
              <option value="">Keep current</option>
              {[{ value: 'new', label: 'New' }, { value: 'like_new', label: 'Like New' }, { value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }].map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Quantity</label>
            <input type="number" min="1" className="input" value={bulkForm.quantity} onChange={(e) => setBulkForm({ ...bulkForm, quantity: e.target.value })} placeholder="Leave empty to keep" />
          </div>
          <Button block onClick={confirmBulkUpdate} disabled={bulkBusy || selectedIds.length === 0}>
            {bulkBusy ? 'Updating…' : 'Apply Changes'}
          </Button>
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
