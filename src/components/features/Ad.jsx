import { useState, useMemo, useEffect } from 'react';
import './Ad.css';

const banners = [
  {
    images: [
      'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800',
      'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800',
      'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800',
    ],
    title: 'Upgrade Your Tech Today!',
    desc: 'Get 20% off on all electronics',
    cta: 'Shop Now',
  },
  {
    images: [
      'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800',
      'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800',
      'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=800',
    ],
    title: 'Streetwear Drop',
    desc: 'Limited edition sneakers — up to 40% off',
    cta: 'Explore',
  },
  {
    images: [
      'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
      'https://images.unsplash.com/photo-1546868871-af0de0ae72e6?w=800',
      'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=800',
    ],
    title: 'Premium Finds',
    desc: 'Curated luxury items starting at $49',
    cta: 'Browse',
  },
];

const pushes = [
  { title: 'Premium Seller?', desc: 'Get verified and appear first!', btn: 'Upgrade' },
  { title: 'List for Free!', desc: 'Zero fees on your first 10 listings', btn: 'Start Selling' },
  { title: 'Safe Trading', desc: 'Escrow protection for every transaction', btn: 'Learn More' },
  { title: 'Refer a Friend', desc: 'Earn $10 credit for each referral', btn: 'Invite' },
];

export function AdBanner({ className = '' }) {
  const [currentAd, setCurrentAd] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const banner = useMemo(() => banners[Math.floor(Math.random() * banners.length)], []);

  if (dismissed) return null;

  return (
    <div className={`ad-banner ${className}`}>
      <button className="ad-dismiss" onClick={() => setDismissed(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="ad-content">
        <img src={banner.images[currentAd]} alt="Advertisement" className="ad-image" />
        <div className="ad-overlay">
          <span className="ad-label">Sponsored</span>
          <h4 className="ad-title">{banner.title}</h4>
          <p className="ad-description">{banner.desc}</p>
          <button className="ad-cta">{banner.cta}</button>
        </div>
      </div>
      <div className="ad-dots">
        {banner.images.map((_, index) => (
          <button
            key={index}
            className={`ad-dot ${index === currentAd ? 'active' : ''}`}
            onClick={() => setCurrentAd(index)}
          />
        ))}
      </div>
    </div>
  );
}

export function AdCard({ title, subtitle, className = '' }) {
  const [dismissed, setDismissed] = useState(false);
  const card = useMemo(() => {
    const cards = [
      { title: 'Featured Deal', subtitle: 'Limited time offer', icon: 'star' },
      { title: 'Flash Sale', subtitle: 'Prices dropping fast! ⚡', icon: 'clock' },
      { title: 'New Arrivals', subtitle: 'Fresh inventory daily', icon: 'package' },
    ];
    return cards[Math.floor(Math.random() * cards.length)];
  }, []);

  if (dismissed) return null;

  return (
    <div className={`ad-card ${className}`}>
      <button className="ad-card-dismiss" onClick={() => setDismissed(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="ad-card-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
          <path d="M4 6v12c0 1.1.9 2 2 2h14v-4" />
          <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
        </svg>
      </div>
      <h4 className="ad-card-title">{title || card.title}</h4>
      <p className="ad-card-subtitle">{subtitle || card.subtitle}</p>
      <button className="ad-card-btn">Learn More</button>
      <span className="ad-card-sponsored">Sponsored</span>
    </div>
  );
}

export function AdInline({ className = '', text = 'Promoted Content' }) {
  return (
    <div className={`ad-inline ${className}`}>
      <span className="ad-inline-badge">Ad</span>
      <span className="ad-inline-text">{text}</span>
    </div>
  );
}

export function AdPush({ className = '' }) {
  const [dismissed, setDismissed] = useState(false);
  const push = useMemo(() => pushes[Math.floor(Math.random() * pushes.length)], []);

  if (dismissed) return null;

  return (
    <div className={`ad-push ${className}`}>
      <button className="ad-push-dismiss" onClick={() => setDismissed(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="ad-push-content">
        <div className="ad-push-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </div>
        <div className="ad-push-text">
          <strong>{push.title}</strong>
          <span>{push.desc}</span>
        </div>
        <button className="ad-push-btn">{push.btn}</button>
      </div>
    </div>
  );
}
