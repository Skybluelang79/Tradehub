import './AuthGate.css';

const ICONS = {
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  tag: (
    <>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </>
  ),
  card: (
    <>
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </>
  ),
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
};

const openAuth = (view) => {
  window.dispatchEvent(new CustomEvent('openAuthModal', { detail: view }));
};

export default function AuthGate({ copy }) {
  const { icon, title, text, perks = [] } = copy;

  return (
    <div className="auth-gate-overlay">
      <div className="auth-gate-popup" role="dialog" aria-modal="true" aria-labelledby="auth-gate-title">
        <div className="auth-gate-icon">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {ICONS[icon] || ICONS.user}
          </svg>
        </div>

        <h2 className="auth-gate-title" id="auth-gate-title">{title}</h2>
        <p className="auth-gate-text">{text}</p>

        {perks.length > 0 && (
          <ul className="auth-gate-perks">
            {perks.map((perk) => (
              <li key={perk}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="auth-gate-btn" onClick={() => openAuth('signup')}>
          Create Account
        </button>
        <button type="button" className="auth-gate-link" onClick={() => openAuth('login')}>
          Already have an account? <strong>Sign in</strong>
        </button>

        <p className="auth-gate-fine">Free forever. No credit card required.</p>
      </div>
    </div>
  );
}
