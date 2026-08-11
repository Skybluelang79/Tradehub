import { SearchIcon, BellIcon, HeartIcon, ArrowLeftIcon, MoonIcon, HomeIcon } from '../ui/Icons';
import { TradeHubBrand } from '../ui/Logo';
import { useApp } from '../../context';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import './Header.css';

export default function Header({
  title,
  subtitle,
  variant = 'default',
  showBack = false,
  onBack,
  leftComponent,
  rightComponent,
  transparent = false,
  brand = false,
}) {
  const variantClass = transparent ? 'header--transparent' : '';
  const { unreadNotificationsCount, activeTab, selectedItem } = useApp();
  const { isAuthenticated } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const goHome = () => {
    window.dispatchEvent(new CustomEvent('goHome'));
  };

  const showHomeBtn = activeTab !== 'home' || !!selectedItem;

  return (
    <header className={`header ${variantClass}`}>
      <div className={`header-inner ${variant === 'centered' ? 'header--centered' : ''}`}>
        <div className="header-left">
          {showBack && (
            <button className="header-btn" onClick={onBack}>
              <ArrowLeftIcon size={20} />
            </button>
          )}
          {leftComponent}
          {brand ? (
            <div className="header-brand-wrap">
              <button className="header-brand" onClick={goHome} aria-label="TradeHub home">
                <TradeHubBrand size={36} textSize={24} />
              </button>
              {subtitle && <p className="header-subtitle">{subtitle}</p>}
            </div>
          ) : (
            <>
              {title && <h1 className="header-title">{title}</h1>}
              {subtitle && <p className="header-subtitle">{subtitle}</p>}
            </>
          )}
        </div>

        <div className="header-right">
          {showHomeBtn && (
            <button className="header-btn" onClick={goHome} title="Go to Homepage">
              <HomeIcon size={20} />
            </button>
          )}
          <button className="theme-toggle-btn" onClick={toggleTheme} title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
            <MoonIcon size={16} />
          </button>
          {isAuthenticated && (
            <button className="header-btn" onClick={() => window.dispatchEvent(new CustomEvent('openNotifications'))}>
              <BellIcon size={20} count={unreadNotificationsCount} />
            </button>
          )}
          <button className="header-btn" onClick={() => window.dispatchEvent(new CustomEvent('openFavorites'))}>
            <HeartIcon size={20} />
          </button>
          {rightComponent}
        </div>
      </div>
    </header>
  );
}

export function SearchHeader({ value, onChange, placeholder, onFilter, onBack }) {
  return (
    <header className="header">
      <div className="search-header">
        {onBack && (
          <button className="header-btn" onClick={onBack}>
            <ArrowLeftIcon size={20} />
          </button>
        )}
        <div style={{ position: 'relative', flex: 1 }}>
          <SearchIcon size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            className="input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder || 'Search...'}
            style={{ paddingLeft: 44 }}
          />
        </div>
        {onFilter && (
          <button className="header-btn header-btn--primary" onClick={onFilter}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
