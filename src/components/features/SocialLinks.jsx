import './SocialLinks.css';

const PLATFORMS = [
  { id: 'facebook', name: 'Facebook', url: 'https://facebook.com/tradehub', color: '#1877F2' },
  { id: 'instagram', name: 'Instagram', url: 'https://instagram.com/tradehub', color: '#E4405F' },
  { id: 'x', name: 'X (Twitter)', url: 'https://x.com/tradehub', color: '#7A8599' },
  { id: 'tiktok', name: 'TikTok', url: 'https://tiktok.com/@tradehub', color: '#25F4EE' },
  { id: 'whatsapp', name: 'WhatsApp', url: 'https://whatsapp.com/channel/tradehub', color: '#25D366' },
  { id: 'telegram', name: 'Telegram', url: 'https://t.me/tradehub', color: '#26A5E4' },
];

function PlatformIcon({ id }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  switch (id) {
    case 'facebook':
      return (
        <svg {...common}>
          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="20" height="20" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      );
    case 'x':
      return (
        <svg {...common}>
          <path d="M4 4l16 16" />
          <path d="M20 4L4 20" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg {...common}>
          <path d="M9 12a4 4 0 1 0 4 4V4c.7 2.5 3 4 5.5 4" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg {...common}>
          <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l2-5.5A8.5 8.5 0 1 1 21 11.5z" />
          <path d="M9.5 9.5c.3 2 2 3.7 4 4l1.2-1.2 1.8 1" />
        </svg>
      );
    case 'telegram':
      return (
        <svg {...common}>
          <path d="M22 2L11 13" />
          <path d="M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function SocialLinks() {
  return (
    <section className="social-links">
      <div className="social-links-header">
        <h3 className="social-links-title">Connect With Us</h3>
        <p className="social-links-sub">Follow TradeHub for new drops, deals &amp; community updates</p>
      </div>
      <div className="social-links-row">
        {PLATFORMS.map((p) => (
          <a
            key={p.id}
            className="social-link"
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ '--brand': p.color }}
            aria-label={p.name}
            title={p.name}
          >
            <PlatformIcon id={p.id} />
          </a>
        ))}
      </div>
    </section>
  );
}
