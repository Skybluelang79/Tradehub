import { useState, useEffect } from 'react';
import { ShieldIcon, BellIcon, LockIcon, GlobeIcon, SaveIcon, ServerIcon } from './Icons.jsx';
import Modal from '../../components/ui/Modal.jsx';
import LanguageSwitcher from '../../components/ui/LanguageSwitcher.jsx';
import { api } from '../../services/client.js';
import { useToast } from '../../components/ui/Toast.jsx';
import './AdminSettings.css';

const STORAGE_KEY = 'tradehub_admin_settings';

const defaultSettings = {
  siteName: 'TradeHub',
  siteUrl: 'https://tradehub.app',
  supportEmail: 'support@tradehub.app',
  maintenanceMode: false,
  currency: 'NGN',
  termsUrl: '',
  privacyUrl: '',
  aboutText: '',
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
  aiEnabled: true,
  aiProvider: 'openai',
  aiModel: 'gpt-4o-mini',
  aiBaseUrl: '',
  aiApiKey: '',
  aiApiKeySet: false,
  aiApiKeySource: 'none',
  aiReady: false,
  aiPromptListing: '',
  aiPromptSearch: '',
  aiPromptQuestion: '',
  aiClearKey: false,
};

const AI_DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  'openai-compatible': 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  google: 'gemini-1.5-flash',
};

const BACKEND_KEYS = {
  site_name: 'siteName',
  support_email: 'supportEmail',
  maintenance_mode: 'maintenanceMode',
  platform_fee_percent: 'transactionFeePercent',
  currency: 'currency',
  terms_url: 'termsUrl',
  privacy_url: 'privacyUrl',
  about_text: 'aboutText',
  ai_enabled: 'aiEnabled',
  ai_provider: 'aiProvider',
  ai_model: 'aiModel',
  ai_base_url: 'aiBaseUrl',
  ai_prompt_listing: 'aiPromptListing',
  ai_prompt_search: 'aiPromptSearch',
  ai_prompt_question: 'aiPromptQuestion',
  ai_api_key_set: 'aiApiKeySet',
  ai_api_key_source: 'aiApiKeySource',
  ai_ready: 'aiReady',
};

const toServerPayload = (s) => ({
  site_name: s.siteName,
  support_email: s.supportEmail,
  maintenance_mode: s.maintenanceMode ? '1' : '0',
  platform_fee_percent: String(s.transactionFeePercent),
  currency: s.currency,
  terms_url: s.termsUrl,
  privacy_url: s.privacyUrl,
  about_text: s.aboutText,
  ai_enabled: s.aiEnabled ? '1' : '0',
  ai_provider: s.aiProvider,
  ai_model: s.aiModel,
  ai_base_url: s.aiBaseUrl,
  ai_prompt_listing: s.aiPromptListing,
  ai_prompt_search: s.aiPromptSearch,
  ai_prompt_question: s.aiPromptQuestion,
  ...(s.aiApiKey.trim() ? { ai_api_key: s.aiApiKey.trim() } : {}),
  ...(s.aiClearKey ? { ai_api_key_clear: '1' } : {}),
});

const applyServerSettings = (s, server) => {
  const next = { ...s };
  for (const [serverKey, uiKey] of Object.entries(BACKEND_KEYS)) {
    const v = server[serverKey];
    if (v === undefined || v === null) continue;
    if (['maintenanceMode', 'aiEnabled', 'aiApiKeySet', 'aiReady'].includes(uiKey)) {
      next[uiKey] = String(v) === '1' || v === true;
    } else if (uiKey === 'transactionFeePercent') next[uiKey] = parseFloat(v) || 0;
    else next[uiKey] = String(v);
  }
  return next;
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [promptDefaults, setPromptDefaults] = useState({});
  const { addToast } = useToast();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api.admin.settingsGet();
        if (!active) return;
        setSettings((prev) => applyServerSettings(prev, data.settings || {}));
        setPromptDefaults(data.ai_prompt_defaults || {});
      } catch (err) {
        if (active) addToast(err.message || 'Failed to load settings', 'error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [addToast]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const handleToggle = (key) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleProviderChange = (provider) => {
    setSettings((prev) => {
      const knownModels = Object.values(AI_DEFAULT_MODELS);
      return {
        ...prev,
        aiProvider: provider,
        aiModel: !prev.aiModel || knownModels.includes(prev.aiModel)
          ? AI_DEFAULT_MODELS[provider]
          : prev.aiModel,
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = await api.admin.settingsUpdate(toServerPayload(settings));
      setSettings((prev) => {
        const next = { ...applyServerSettings(prev, data.settings || {}), aiApiKey: '', aiClearKey: false };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      setPromptDefaults(data.ai_prompt_defaults || promptDefaults);
      setShowSaveModal(true);
      setTimeout(() => setShowSaveModal(false), 2000);
    } catch (err) {
      addToast(err.message || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'General', icon: GlobeIcon },
    { id: 'security', label: 'Security', icon: LockIcon },
    { id: 'listing', label: 'Listings', icon: ShieldIcon },
    { id: 'payments', label: 'Payments', icon: BellIcon },
    { id: 'ai', label: 'AI', icon: ServerIcon },
    { id: 'notifications', label: 'Notifications', icon: BellIcon },
    { id: 'cookies', label: 'Cookies & Language', icon: GlobeIcon },
  ];

  return (
    <div className="admin-settings">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Settings</h1>
          <p>{loading ? 'Loading settings…' : 'Configure your platform settings'}</p>
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={loading || saving}>
          <SaveIcon size={16} />
          {saving ? 'Saving…' : 'Save Changes'}
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
                    disabled={loading}
                    onChange={(e) => handleChange('siteName', e.target.value)}
                  />
                </div>
                <div className="setting-item">
                  <label>Site URL</label>
                  <input
                    type="url"
                    value={settings.siteUrl}
                    disabled={loading}
                    onChange={(e) => handleChange('siteUrl', e.target.value)}
                  />
                </div>
                <div className="setting-item">
                  <label>Support Email</label>
                  <input
                    type="email"
                    value={settings.supportEmail}
                    disabled={loading}
                    onChange={(e) => handleChange('supportEmail', e.target.value)}
                  />
                </div>
                <div className="setting-item">
                  <label>Currency</label>
                  <input
                    type="text"
                    value="NGN"
                    readOnly
                    disabled={loading}
                    title="TradeHub prices are fixed to Nigerian naira"
                  />
                </div>
                <div className="setting-item">
                  <label>Terms URL</label>
                  <input
                    type="url"
                    value={settings.termsUrl}
                    disabled={loading}
                    onChange={(e) => handleChange('termsUrl', e.target.value)}
                  />
                </div>
                <div className="setting-item">
                  <label>Privacy URL</label>
                  <input
                    type="url"
                    value={settings.privacyUrl}
                    disabled={loading}
                    onChange={(e) => handleChange('privacyUrl', e.target.value)}
                  />
                </div>
                <div className="setting-item">
                  <label>About Text</label>
                  <textarea
                    rows="3"
                    value={settings.aboutText}
                    disabled={loading}
                    onChange={(e) => handleChange('aboutText', e.target.value)}
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                    disabled={loading}
                    onChange={(e) => handleChange('sessionTimeout', parseInt(e.target.value))}
                  />
                </div>
                <div className="setting-item">
                  <label>Max Login Attempts</label>
                  <input
                    type="number"
                    value={settings.maxLoginAttempts}
                    disabled={loading}
                    onChange={(e) => handleChange('maxLoginAttempts', parseInt(e.target.value))}
                  />
                </div>
                <div className="setting-item">
                  <label>API Rate Limit (requests/minute)</label>
                  <input
                    type="number"
                    value={settings.apiRateLimit}
                    disabled={loading}
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
                    disabled={loading}
                    onChange={(e) => handleChange('itemsPerPage', parseInt(e.target.value))}
                  />
                </div>
                <div className="setting-item">
                  <label>Max Images Per Listing</label>
                  <input
                    type="number"
                    value={settings.maxImagesPerItem}
                    disabled={loading}
                    onChange={(e) => handleChange('maxImagesPerItem', parseInt(e.target.value))}
                  />
                </div>
                <div className="setting-item">
                  <label>Max Listing Price (₦)</label>
                  <input
                    type="number"
                    value={settings.maxListingPrice}
                    disabled={loading}
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
                    disabled={loading}
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
                      disabled={loading}
                      onChange={() => handleToggle('buyerProtectionEnabled')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="settings-section">
              <h2>AI Settings</h2>
              <div className="setting-group">
                <h3>Provider & Model</h3>
                <div className="toggle-item">
                  <div>
                    <span className="toggle-label">Enable AI Features</span>
                    <span className="toggle-description">
                      {settings.aiReady ? 'AI is configured and ready' : 'Add an API key to activate AI features'}
                    </span>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={settings.aiEnabled}
                      disabled={loading}
                      onChange={() => handleToggle('aiEnabled')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <div className="setting-item">
                  <label>Provider</label>
                  <select
                    value={settings.aiProvider}
                    disabled={loading}
                    onChange={(e) => handleProviderChange(e.target.value)}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="openai-compatible">OpenAI-compatible (OpenRouter, Groq, local)</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google Gemini</option>
                  </select>
                </div>
                <div className="setting-item">
                  <label>Model</label>
                  <input
                    type="text"
                    value={settings.aiModel}
                    disabled={loading}
                    placeholder="e.g. gpt-4o-mini"
                    onChange={(e) => handleChange('aiModel', e.target.value)}
                  />
                </div>
                <div className="setting-item">
                  <label>API Base URL</label>
                  <input
                    type="url"
                    value={settings.aiBaseUrl}
                    disabled={loading}
                    placeholder="Leave blank to use the provider default"
                    onChange={(e) => handleChange('aiBaseUrl', e.target.value)}
                  />
                  <span className="setting-hint">Use the full API root, e.g. https://api.openai.com/v1</span>
                </div>
                <div className="setting-item">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={settings.aiApiKey}
                    disabled={loading || settings.aiClearKey}
                    placeholder={settings.aiApiKeySet ? 'Leave blank to keep the saved key' : 'Enter provider API key'}
                    autoComplete="new-password"
                    onChange={(e) => handleChange('aiApiKey', e.target.value)}
                  />
                  <span className="setting-hint">
                    {settings.aiApiKeySource === 'environment'
                      ? 'A key is already provided by the server environment.'
                      : settings.aiApiKeySet
                        ? 'A key is saved. It is never sent back to this page.'
                        : 'The key is stored on the server and never returned by the API.'}
                  </span>
                  {settings.aiApiKeySet && (
                    <label className="ai-clear-key">
                      <input
                        type="checkbox"
                        checked={settings.aiClearKey}
                        disabled={loading}
                        onChange={() => handleToggle('aiClearKey')}
                      />
                      Remove the saved key
                    </label>
                  )}
                </div>
              </div>
              <div className="setting-group">
                <h3>System Prompts</h3>
                <div className="setting-item">
                  <label>Listing Generator Prompt</label>
                  <textarea
                    rows="6"
                    value={settings.aiPromptListing}
                    disabled={loading}
                    placeholder={promptDefaults.listing || 'Using the built-in prompt'}
                    onChange={(e) => handleChange('aiPromptListing', e.target.value)}
                  />
                  <span className="setting-hint">Leave blank to use the built-in prompt. It must return the required JSON shape.</span>
                </div>
                <div className="setting-item">
                  <label>Search Parser Prompt</label>
                  <textarea
                    rows="6"
                    value={settings.aiPromptSearch}
                    disabled={loading}
                    placeholder={promptDefaults.search || 'Using the built-in prompt'}
                    onChange={(e) => handleChange('aiPromptSearch', e.target.value)}
                  />
                  <span className="setting-hint">Leave blank to use the built-in prompt. Use {'{{categories}}'} for the category list.</span>
                </div>
                <div className="setting-item">
                  <label>Listing Q&A Prompt</label>
                  <textarea
                    rows="6"
                    value={settings.aiPromptQuestion}
                    disabled={loading}
                    placeholder={promptDefaults.question || 'Using the built-in prompt'}
                    onChange={(e) => handleChange('aiPromptQuestion', e.target.value)}
                  />
                  <span className="setting-hint">Leave blank to use the built-in prompt.</span>
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
                      disabled={loading}
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
