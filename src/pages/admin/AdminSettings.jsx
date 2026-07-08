import { useState, useEffect } from 'react';
import { ShieldIcon, BellIcon, LockIcon, GlobeIcon, PaletteIcon, SaveIcon } from './Icons.jsx';
import Modal from '../../components/ui/Modal.jsx';
import LanguageSwitcher from '../../components/ui/LanguageSwitcher.jsx';
import './AdminSettings.css';

const STORAGE_KEY = 'tradehub_admin_settings';

const defaultSettings = {
  siteName: 'TradeHub',
  siteUrl: 'https://tradehub.app',
  supportEmail: 'support@tradehub.app',
  maintenanceMode: false,
  registrationEnabled: true,
  emailVerification: true,
  twoFactorAuth: false,
  sessionTimeout: 30,
  maxLoginAttempts: 5,
  apiRateLimit: 100,
  itemsPerPage: 20,
  maxImagesPerItem: 6,
  maxListingPrice: 100000,
  transactionFeePercent: 2.5,
  buyerProtectionEnabled: true,
  pushNotifications: true,
  emailNotifications: true,
  weeklyDigest: true,
  marketingEmails: false,
  cookieConsentEnabled: true,
  cookieAnalytics: false,
  cookieMarketing: false,
  cookiePreferences: false,
};

const AdminSettings = () => {
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });
  const [showSaveModal, setShowSaveModal] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const handleToggle = (key) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setShowSaveModal(true);
    setTimeout(() => setShowSaveModal(false), 2000);
  };

  const tabs = [
    { id: 'general', label: 'General', icon: GlobeIcon },
    { id: 'security', label: 'Security', icon: LockIcon },
    { id: 'listing', label: 'Listings', icon: ShieldIcon },
    { id: 'payments', label: 'Payments', icon: BellIcon },
    { id: 'notifications', label: 'Notifications', icon: BellIcon },
    { id: 'cookies', label: 'Cookies & Language', icon: GlobeIcon },
  ];

  return (
    <div className="admin-settings">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Settings</h1>
          <p>Configure your platform settings</p>
        </div>
        <button className="btn-primary" onClick={handleSave}>
          <SaveIcon size={16} />
          Save Changes
        </button>
      </div>

      <div className="settings-layout">
        <div className="settings-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settings-content">
          {activeTab === 'general' && (
            <div className="settings-section">
              <h2>General Settings</h2>
              <div className="setting-group">
                <div className="setting-item">
                  <label>Site Name</label>
                  <input
                    type="text"
                    value={settings.siteName}
                    onChange={(e) => handleChange('siteName', e.target.value)}
                  />
                </div>
                <div className="setting-item">
                  <label>Site URL</label>
                  <input
                    type="url"
                    value={settings.siteUrl}
                    onChange={(e) => handleChange('siteUrl', e.target.value)}
                  />
                </div>
                <div className="setting-item">
                  <label>Support Email</label>
                  <input
                    type="email"
                    value={settings.supportEmail}
                    onChange={(e) => handleChange('supportEmail', e.target.value)}
                  />
                </div>
              </div>
              <div className="setting-group">
                <h3>System Status</h3>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Maintenance Mode</span>
                    <span className="toggle-description">Disable site for non-admin users</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.maintenanceMode}
                      onChange={() => handleToggle('maintenanceMode')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">User Registration</span>
                    <span className="toggle-description">Allow new users to sign up</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.registrationEnabled}
                      onChange={() => handleToggle('registrationEnabled')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Email Verification</span>
                    <span className="toggle-description">Require email verification for new accounts</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.emailVerification}
                      onChange={() => handleToggle('emailVerification')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="settings-section">
              <h2>Security Settings</h2>
              <div className="setting-group">
                <h3>Authentication</h3>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Two-Factor Authentication</span>
                    <span className="toggle-description">Require 2FA for admin accounts</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.twoFactorAuth}
                      onChange={() => handleToggle('twoFactorAuth')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
              <div className="setting-group">
                <h3>Session & Rate Limits</h3>
                <div className="setting-item">
                  <label>Session Timeout (minutes)</label>
                  <input
                    type="number"
                    value={settings.sessionTimeout}
                    onChange={(e) => handleChange('sessionTimeout', parseInt(e.target.value))}
                  />
                </div>
                <div className="setting-item">
                  <label>Max Login Attempts</label>
                  <input
                    type="number"
                    value={settings.maxLoginAttempts}
                    onChange={(e) => handleChange('maxLoginAttempts', parseInt(e.target.value))}
                  />
                </div>
                <div className="setting-item">
                  <label>API Rate Limit (requests/minute)</label>
                  <input
                    type="number"
                    value={settings.apiRateLimit}
                    onChange={(e) => handleChange('apiRateLimit', parseInt(e.target.value))}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'listing' && (
            <div className="settings-section">
              <h2>Listing Settings</h2>
              <div className="setting-group">
                <div className="setting-item">
                  <label>Items Per Page</label>
                  <input
                    type="number"
                    value={settings.itemsPerPage}
                    onChange={(e) => handleChange('itemsPerPage', parseInt(e.target.value))}
                  />
                </div>
                <div className="setting-item">
                  <label>Max Images Per Listing</label>
                  <input
                    type="number"
                    value={settings.maxImagesPerItem}
                    onChange={(e) => handleChange('maxImagesPerItem', parseInt(e.target.value))}
                  />
                </div>
                <div className="setting-item">
                  <label>Max Listing Price ($)</label>
                  <input
                    type="number"
                    value={settings.maxListingPrice}
                    onChange={(e) => handleChange('maxListingPrice', parseInt(e.target.value))}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'payments' && (
            <div className="settings-section">
              <h2>Payment Settings</h2>
              <div className="setting-group">
                <div className="setting-item">
                  <label>Transaction Fee (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={settings.transactionFeePercent}
                    onChange={(e) => handleChange('transactionFeePercent', parseFloat(e.target.value))}
                  />
                </div>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Buyer Protection</span>
                    <span className="toggle-description">Enable buyer protection for all transactions</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.buyerProtectionEnabled}
                      onChange={() => handleToggle('buyerProtectionEnabled')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="settings-section">
              <h2>Notification Settings</h2>
              <div className="setting-group">
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Push Notifications</span>
                    <span className="toggle-description">Enable push notifications</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.pushNotifications}
                      onChange={() => handleToggle('pushNotifications')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Email Notifications</span>
                    <span className="toggle-description">Receive notifications via email</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.emailNotifications}
                      onChange={() => handleToggle('emailNotifications')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Weekly Digest</span>
                    <span className="toggle-description">Receive weekly summary emails</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.weeklyDigest}
                      onChange={() => handleToggle('weeklyDigest')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Marketing Emails</span>
                    <span className="toggle-description">Receive promotional emails</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.marketingEmails}
                      onChange={() => handleToggle('marketingEmails')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'cookies' && (
            <div className="settings-section">
              <h2>Cookies & Language</h2>
              <div className="setting-group">
                <h3>Cookie Consent</h3>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Cookie Consent Banner</span>
                    <span className="toggle-description">Show cookie consent banner to users</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.cookieConsentEnabled}
                      onChange={() => handleToggle('cookieConsentEnabled')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Analytics Cookies</span>
                    <span className="toggle-description">Allow analytics tracking cookies</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.cookieAnalytics}
                      onChange={() => handleToggle('cookieAnalytics')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Marketing Cookies</span>
                    <span className="toggle-description">Allow marketing and advertising cookies</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.cookieMarketing}
                      onChange={() => handleToggle('cookieMarketing')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Preference Cookies</span>
                    <span className="toggle-description">Allow preference and customization cookies</span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.cookiePreferences}
                      onChange={() => handleToggle('cookiePreferences')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
              <div className="setting-group">
                <h3>Language Settings</h3>
                <div className="setting-item">
                  <label>Default Language</label>
                  <LanguageSwitcher />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        title="Settings Saved"
      >
        <div className="save-modal">
          <div className="save-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <p>Settings have been saved successfully!</p>
        </div>
      </Modal>
    </div>
  );
};

export default AdminSettings;
