import { useState, useCallback, useEffect } from 'react';
import { useCookie } from '../../context/CookieContext';
import { useTranslation } from '../../context/LanguageContext';
import LanguageSwitcher from './LanguageSwitcher';
import { Check } from './Icons';
import './OnboardingGate.css';

const LOCATION_STORAGE_KEY = 'tradehub_location_granted';

export default function OnboardingGate({ children }) {
  const { t } = useTranslation();
  const { consent, acceptAll, rejectAll, showCustomize, preferences, setPreferences, savePreferences, openCustomize, setShowCustomize } = useCookie();

  const [locationGranted, setLocationGranted] = useState(() => {
    return localStorage.getItem(LOCATION_STORAGE_KEY) === 'true';
  });
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState('');

  const cookiesDone = consent !== null;
  const isReady = cookiesDone && locationGranted;

  const skipLocation = useCallback(() => {
    localStorage.setItem(LOCATION_STORAGE_KEY, 'true');
    setLocationGranted(true);
  }, []);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      skipLocation();
      return;
    }
    setLocationLoading(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      () => {
        localStorage.setItem(LOCATION_STORAGE_KEY, 'true');
        setLocationGranted(true);
        setLocationLoading(false);
      },
      () => {
        skipLocation();
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }, [skipLocation]);

  useEffect(() => {
    if (locationGranted && !cookiesDone) {
      acceptAll();
    }
  }, [locationGranted]);

  if (isReady) {
    return children;
  }

  return (
    <div className="onboarding-gate">
      <div className="onboarding-card">
        <div className="onboarding-header">
          <h1>TradeHub</h1>
          <p>Buy & Sell Locally</p>
        </div>

        <div className="onboarding-steps">
          <div className={`onboarding-step ${cookiesDone ? 'step--done' : 'step--active'}`}>
            <div className="step-indicator">
              {cookiesDone ? <Check size={18} /> : <span>1</span>}
            </div>
            <div className="step-content">
              <h3>{t('cookie.title')}</h3>
              <p className="step-desc">{t('cookie.message')}</p>

              {!cookiesDone && (
                <div className="step-actions">
                  <div className="cookie-buttons">
                    <button className="gate-btn gate-btn--primary" onClick={acceptAll}>
                      {t('cookie.accept')}
                    </button>
                    <button className="gate-btn gate-btn--secondary" onClick={rejectAll}>
                      {t('cookie.reject')}
                    </button>
                    <button className="gate-btn gate-btn--ghost" onClick={openCustomize}>
                      {t('cookie.customize')}
                    </button>
                  </div>

                  {showCustomize && (
                    <div className="gate-cookie-customize">
                      {[
                        { key: 'necessary', label: t('cookie.necessary'), locked: true },
                        { key: 'analytics', label: t('cookie.analytics') },
                        { key: 'marketing', label: t('cookie.marketing') },
                        { key: 'preferences', label: t('cookie.preferences') },
                      ].map((item) => (
                        <label key={item.key} className={`gate-cookie-pref ${item.locked ? 'pref--locked' : ''}`}>
                          <span>{item.label}</span>
                          <div
                            className={`pref-toggle ${preferences[item.key] ? 'pref-toggle--on' : ''}`}
                            onClick={() => !item.locked && setPreferences((p) => ({ ...p, [item.key]: !p[item.key] }))}
                          >
                            <div className="pref-toggle__thumb" />
                          </div>
                        </label>
                      ))}
                      <button className="gate-btn gate-btn--primary" onClick={savePreferences} style={{ marginTop: 8 }}>
                        <Check size={14} />
                        {t('cookie.save')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {cookiesDone && <p className="step-done-text">{t('cookie.accept')}d</p>}
            </div>
          </div>

          <div className={`onboarding-step ${locationGranted ? 'step--done' : cookiesDone ? 'step--active' : 'step--disabled'}`}>
            <div className="step-indicator">
              {locationGranted ? <Check size={18} /> : <span>2</span>}
            </div>
            <div className="step-content">
              <h3>Location Access</h3>
              <p className="step-desc">Share your location to discover items near you</p>

              {!locationGranted && cookiesDone && (
                <div className="step-actions">
                  <button
                    className="gate-btn gate-btn--primary"
                    onClick={requestLocation}
                    disabled={locationLoading}
                  >
                    {locationLoading ? 'Getting location...' : 'Share Location'}
                  </button>
                  <button
                    className="gate-btn gate-btn--ghost"
                    onClick={skipLocation}
                  >
                    Skip — use default location
                  </button>
                  {locationError && <p className="step-error">{locationError}</p>}
                </div>
              )}

              {locationGranted && <p className="step-done-text">Location shared</p>}
            </div>
          </div>
        </div>

        <div className="onboarding-footer">
          <LanguageSwitcher compact />
        </div>
      </div>
    </div>
  );
}
