import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'tradehub_language';

const locales = {
  en: () => import('../data/locales/en.json'),
  es: () => import('../data/locales/es.json'),
  fr: () => import('../data/locales/fr.json'),
  de: () => import('../data/locales/de.json'),
};

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || 'en';
  });
  const [translations, setTranslations] = useState({});

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    locales[lang]().then((mod) => setTranslations(mod.default || mod));
  }, [lang]);

  const t = useCallback((key, params = {}) => {
    let text = translations[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, v);
      });
    }
    return text;
  }, [translations]);

  const value = { lang, setLang, t };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within LanguageProvider');
  }
  return context;
}
