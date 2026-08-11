import './Logo.css';

export function TradeHubLogo({ size = 40, className = '' }) {
  return (
    <svg
      className={`th-logo ${className}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="TradeHub logo"
    >
      <defs>
        <linearGradient id="th-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#DCC086" />
          <stop offset="100%" stopColor="#A8883B" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#th-logo-grad)" />
      <path
        d="M13 15h22 M13 15v20 M13 25h9 M35 15v20"
        stroke="#241D12"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TradeHubWordmark({ size = 28, className = '' }) {
  return (
    <span className={`th-wordmark ${className}`} style={{ fontSize: size }}>
      Trade<span className="th-wordmark-accent">Hub</span>
    </span>
  );
}

export function TradeHubBrand({ size = 40, textSize = 28, className = '' }) {
  return (
    <span className={`th-brand ${className}`}>
      <TradeHubLogo size={size} />
      <TradeHubWordmark size={textSize} />
    </span>
  );
}
