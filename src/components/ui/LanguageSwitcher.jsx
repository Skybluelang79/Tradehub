import { useTranslation } from '../../context/LanguageContext';
import { Globe } from './Icons';
import './LanguageSwitcher.css';

const languages = [
  { code: 'en', labelKey: 'language.en' },
  { code: 'es', labelKey: 'language.es' },
  { code: 'fr', labelKey: 'language.fr' },
  { code: 'de', labelKey: 'language.de' },
];

export default function LanguageSwitcher({ compact = false }) {
  const { lang, setLang, t } = useTranslation();

  return (
    <div className={`language-switcher ${compact ? 'language-switcher--compact' : ''}`}>
      {!compact && <span className="language-switcher__label">{t('language.select')}</span>}
      <div className="language-switcher__options">
        {languages.map((l) => (
          <button
            key={l.code}
            className={`language-switcher__btn ${lang === l.code ? 'language-switcher__btn--active' : ''}`}
            onClick={() => setLang(l.code)}
          >
            {compact && lang === l.code && <Globe size={14} />}
            {t(l.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
