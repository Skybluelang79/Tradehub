import { useState } from 'react';
import { Header } from '../components/layout';
import { Avatar, Rating, Button } from '../components/ui';
import Modal from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { PinIcon, SettingsIcon, LogOutIcon, EditIcon, ShieldIcon, HelpIcon, BellIcon, MoonIcon, GlobeIcon, MapPinIcon } from '../components/ui/Icons';
import { useApp } from '../context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { formatDate } from '../utils/helpers';
import '../styles/globals.css';
import './Profile.css';

export default function Profile() {
  const { items, getReviewsForUser, getUserRating, setActiveTab } = useApp();
  const { user: authUser, logout, updateProfile } = useAuth();
  const { toggleTheme } = useTheme();
  const { addToast } = useToast();
  
  const currentUser = authUser || {
    id: 'guest',
    name: 'Guest User',
    email: '',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=guest',
    rating: 0,
    verified: false,
    location: { address: 'Not set' },
    bio: '',
    phone: '',
    joined: new Date().toISOString().split('T')[0],
    listings: 0,
  };

  const userItems = items.filter((item) => item.sellerId === currentUser.id);
  
  const [activeTab, setActiveTabState] = useState('reviews');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', bio: '', phone: '' });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  
  const [settings, setSettings] = useState({
    notifications: true,
    darkMode: true,
    locationEnabled: true,
    distanceUnit: 'km',
    language: 'English',
  });

  const userReviews = getReviewsForUser(currentUser.id);
  const userRating = getUserRating(currentUser.id);

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

  const handleEditSave = () => {
    if (authUser) {
      updateProfile({ name: editForm.name, bio: editForm.bio, phone: editForm.phone });
    }
    addToast('Profile updated successfully', 'success');
    setShowEditModal(false);
  };

  const handleSettingToggle = (key) => {
    const newValue = !settings[key];
    setSettings({ ...settings, [key]: newValue });
    if (key === 'darkMode') toggleTheme();
    addToast(`${key} ${newValue ? 'enabled' : 'disabled'}`, 'info');
  };

  const menuItems = [
    { icon: EditIcon, title: 'Edit Profile', subtitle: 'Update your information', action: 'edit' },
    { icon: ShieldIcon, title: 'Privacy & Security', subtitle: 'Manage your privacy settings', action: 'privacy' },
    { icon: SettingsIcon, title: 'Settings', subtitle: 'App preferences', action: 'settings' },
    { icon: HelpIcon, title: 'Help & Support', subtitle: 'Get help with TradeHub', action: 'help' },
  ];

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
          <div className="profile-location">
            <PinIcon size={16} />
            <span>{currentUser.location.address}</span>
          </div>

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
        <button className={`profile-tab ${activeTab === 'reviews' ? 'active' : ''}`} onClick={() => setActiveTabState('reviews')}>
          Reviews
        </button>
        <button className={`profile-tab ${activeTab === 'listings' ? 'active' : ''}`} onClick={() => setActiveTabState('listings')}>
          My Listings
        </button>
        <button className={`profile-tab ${activeTab === 'menu' ? 'active' : ''}`} onClick={() => setActiveTabState('menu')}>
          Settings
        </button>
      </div>

        <div className="profile-tab-content">
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

          {activeTab === 'listings' && (
            <>
              {userItems.length === 0 ? (
                <div className="empty-state">
                  <h3 className="empty-title">No listings yet</h3>
                  <p className="empty-text">Start selling by creating your first listing</p>
                </div>
              ) : (
                <div className="listings-grid-mini">
                  {userItems.map((item) => (
                    <img key={item.id} src={item.images[0]} alt={item.title} className="listing-thumb-mini" />
                  ))}
                </div>
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
    </div>
  );
}
