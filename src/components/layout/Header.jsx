import { SearchIcon, BellIcon, HeartIcon, ArrowLeftIcon, MoonIcon } from '../ui/Icons';
import { useApp } from '../../context';
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
}) {
  const variantClass = transparent ? 'header--transparent' : '';
  const { unreadNotificationsCount } = useApp();
  const { isDark, toggleTheme } = useTheme();

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
          {title && <h1 className="header-title">{title}</h1>}
          {subtitle && <p className="header-subtitle">{subtitle}</p>}
        </div>

        <div className="header-right">
          <button className="theme-toggle-btn" onClick={toggleTheme} title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
            <MoonIcon size={16} />
          </button>
          <button className="header-btn" onClick={() => window.dispatchEvent(new CustomEvent('openNotifications'))}>
            <BellIcon size={20} count={unreadNotificationsCount} />
          </button>
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
