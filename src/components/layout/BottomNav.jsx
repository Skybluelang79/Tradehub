import { useState, useCallback } from 'react';
import './BottomNav.css';

function Particles({ items }) {
  if (!items.length) return null;
  return items.map((p) => {
    const rad = (p.angle * Math.PI) / 180;
    const dx = Math.cos(rad) * p.dist;
    const dy = Math.sin(rad) * p.dist;
    return (
      <span
        key={p.id}
        className="nav-particle"
        style={{
          '--dx': `${dx}px`,
          '--dy': `${dy}px`,
          background: p.color,
          width: p.size,
          height: p.size,
        }}
      />
    );
  });
}

const bootstrapIcons = {
  home: 'bi-house-door',
  chat: 'bi-chat-dots',
  add: 'bi-plus-lg',
  payments: 'bi-credit-card',
  profile: 'bi-person',
};

const navItems = [
  { id: 'home', label: 'Browse', icon: bootstrapIcons.home },
  { id: 'chat', label: 'Chat', icon: bootstrapIcons.chat, badge: true },
  { id: 'add', label: 'Sell', icon: bootstrapIcons.add, isAction: true },
  { id: 'payments', label: 'Payments', icon: bootstrapIcons.payments },
  { id: 'profile', label: 'Profile', icon: bootstrapIcons.profile },
];

function RippleEffect({ x, y }) {
  return (
    <span
      className="nav-ripple"
      style={{ left: x, top: y }}
    />
  );
}

export default function BottomNav({ activeTab, onTabChange, onSellClick, unreadCount = 0 }) {
  const [ripples, setRipples] = useState({});
  const [bouncing, setBouncing] = useState(false);
  const [particles, setParticles] = useState([]);

  const handleClick = useCallback((id, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rippleId = `${id}-${Date.now()}`;

    setRipples((prev) => ({
      ...prev,
      [id]: [...(prev[id] || []).slice(-3), { id: rippleId, x, y }],
    }));

    if (id === 'add') {
      setBouncing(true);
      setTimeout(() => setBouncing(false), 400);

      const colors = ['var(--accent)', '#ff6b8a', '#ffd700', '#fff'];
      const newParticles = Array.from({ length: 8 }, (_, i) => ({
        id: `${Date.now()}-${i}`,
        angle: (i * 45) + Math.random() * 20 - 10,
        dist: 28 + Math.random() * 24,
        color: colors[i % colors.length],
        size: 4 + Math.random() * 4,
      }));
      setParticles(newParticles);
      setTimeout(() => setParticles([]), 800);
    }

    setTimeout(() => {
      setRipples((prev) => {
        const current = prev[id] || [];
        return {
          ...prev,
          [id]: current.filter((r) => r.id !== rippleId),
        };
      });
    }, 600);

    if ('vibrate' in navigator) navigator.vibrate(10);

    if (id === 'add' && typeof onSellClick === 'function') {
      onSellClick();
    }
    onTabChange(id);
  }, [onTabChange, onSellClick]);

  return (
    <nav className="bottom-nav">
      {navItems.map(({ id, label, icon, badge, isAction }) => {
        const isActive = activeTab === id;
        const itemRipples = ripples[id] || [];

        if (isAction) {
          return (
            <button
              key={id}
              className={`nav-item nav-item--action ${isActive ? 'active' : ''}`}
              onClick={(e) => handleClick(id, e)}
              aria-label={label}
            >
              <div className={`nav-add-btn ${bouncing ? 'nav-add-btn--bounce' : ''}`}>
                <i className={`bi ${icon} nav-add-icon ${isActive ? 'nav-add-icon--rotated' : ''}`} />
                <span className="nav-add-glow" />
                <span className="nav-add-pulse" />
                <Particles items={particles} />
              </div>
              <span className="nav-label">{label}</span>
            </button>
          );
        }

        return (
          <button
            key={id}
            className={`nav-item ${isActive ? 'active' : ''}`}
            onClick={(e) => handleClick(id, e)}
            aria-label={label}
          >
            <span className="nav-item-wrapper">
              {badge && unreadCount > 0 && (
                <span className="nav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
              <i className={`bi ${icon} nav-icon ${isActive ? 'nav-icon--active' : ''}`} />
              {itemRipples.map((r) => (
                <RippleEffect key={r.id} x={r.x} y={r.y} />
              ))}
            </span>
            <span className="nav-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
