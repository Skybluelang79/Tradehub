import './Badge.css';

export function Badge({ children, variant = 'primary', className = '', ...props }) {
  return (
    <span className={`badge badge--${variant} ${className}`} {...props}>
      {children}
    </span>
  );
}

export function Avatar({ src, alt, size = 'md', online = false, verified = false, className = '' }) {
  return (
    <div className={`avatar avatar--${size} ${online ? 'avatar-online' : ''} ${className}`}>
      <img src={src} alt={alt || 'Avatar'} />
      {verified && (
        <div className="avatar-verified">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
    </div>
  );
}

export function Rating({ value, max = 5, showValue = true, size = 'sm' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div style={{ display: 'flex', gap: '2px' }}>
        {[...Array(max)].map((_, i) => (
          <svg
            key={i}
            width={size === 'sm' ? 14 : 18}
            height={size === 'sm' ? 14 : 18}
            viewBox="0 0 24 24"
            fill={i < Math.round(value) ? '#FBBF24' : 'none'}
            stroke={i < Math.round(value) ? '#FBBF24' : 'var(--border)'}
            strokeWidth="2"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        ))}
      </div>
      {showValue && (
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>
          {value > 0 ? value.toFixed(1) : 'New'}
        </span>
      )}
    </div>
  );
}
