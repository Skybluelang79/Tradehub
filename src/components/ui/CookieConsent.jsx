import { useTranslation } from '../../context/LanguageContext';
import { useCookie } from '../../context/CookieContext';
import { X, Cookie, Settings, Check } from './Icons';
import './CookieConsent.css';

export default function CookieConsent() {
  const { t } = useTranslation();
  const {
    showBanner,
    showCustomize,
    preferences,
    setPreferences,
    acceptAll,
    rejectAll,
    savePreferences,
    openCustomize,
    setShowCustomize,
  } = useCookie();

  if (!showBanner) return null;

  const togglePref = (key) => {
    if (key === 'necessary') return;
    setPreferences((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const prefItems = [
    { key: 'necessary', label: t('cookie.necessary'), locked: true },
    { key: 'analytics', label: t('cookie.analytics') },
    { key: 'marketing', label: t('cookie.marketing') },
    { key: 'preferences', label: t('cookie.preferences') },
  ];

  return (
    <div className="cookie-consent-overlay">
      <div className={`cookie-consent ${showCustomize ? 'cookie-consent--expanded' : ''}`}>
        <div className="cookie-consent__header">
          <Cookie size={20} />
          <span>{t('cookie.title')}</span>
        </div>

        <p className="cookie-consent__message">
          {t('cookie.message')}
        </p>

        {showCustomize && (
          <div className="cookie-consent__preferences">
            {prefItems.map((item) => (
              <label key={item.key} className={`cookie-pref ${item.locked ? 'cookie-pref--locked' : ''}`}>
                <div className="cookie-pref__info">
                  <span className="cookie-pref__name">{item.label}</span>
                  {item.locked && <span className="cookie-pref__badge">{t('cookie.necessary')}</span>}
                </div>
                <div
                  className={`cookie-toggle ${preferences[item.key] ? 'cookie-toggle--on' : ''}`}
                  onClick={() => togglePref(item.key)}
                >
                  <div className="cookie-toggle__thumb" />
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="cookie-consent__actions">
          {showCustomize ? (
            <>
              <button className="cookie-btn cookie-btn--primary" onClick={savePreferences}>
                <Check size={16} />
                {t('cookie.save')}
              </button>
              <button className="cookie-btn cookie-btn--ghost" onClick={() => setShowCustomize(false)}>
                {t('general.back')}
              </button>
            </>
          ) : (
            <>
              <button className="cookie-btn cookie-btn--primary" onClick={acceptAll}>
                {t('cookie.accept')}
              </button>
              <button className="cookie-btn cookie-btn--secondary" onClick={rejectAll}>
                {t('cookie.reject')}
              </button>
              <button className="cookie-btn cookie-btn--ghost" onClick={openCustomize}>
                <Settings size={14} />
                {t('cookie.customize')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
