import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'tradehub_cookie_consent';

const defaultPreferences = {
  necessary: true,
  analytics: false,
  marketing: false,
  preferences: false,
};

const CookieContext = createContext();

export function CookieProvider({ children }) {
  const [consent, setConsent] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  });

  const [showBanner, setShowBanner] = useState(() => {
    return !localStorage.getItem(STORAGE_KEY);
  });

  const [showCustomize, setShowCustomize] = useState(false);

  const [preferences, setPreferences] = useState({ ...defaultPreferences });

  useEffect(() => {
    if (consent) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
      setShowBanner(false);
    }
  }, [consent]);

  const acceptAll = useCallback(() => {
    setConsent({
      accepted: true,
      preferences: {
        necessary: true,
        analytics: true,
        marketing: true,
        preferences: true,
      },
    });
  }, []);

  const rejectAll = useCallback(() => {
    setConsent({
      accepted: false,
      preferences: { ...defaultPreferences },
    });
  }, []);

  const savePreferences = useCallback(() => {
    setConsent({
      accepted: true,
      preferences: { ...preferences },
    });
    setShowCustomize(false);
  }, [preferences]);

  const openCustomize = useCallback(() => {
    if (consent) {
      setPreferences({ ...consent.preferences });
    }
    setShowCustomize(true);
  }, [consent]);

  const value = {
    consent,
    showBanner,
    showCustomize,
    preferences,
    setPreferences,
    acceptAll,
    rejectAll,
    savePreferences,
    openCustomize,
    setShowCustomize,
  };

  return (
    <CookieContext.Provider value={value}>
      {children}
    </CookieContext.Provider>
  );
}

export function useCookie() {
  const context = useContext(CookieContext);
  if (!context) {
    throw new Error('useCookie must be used within CookieProvider');
  }
  return context;
}
