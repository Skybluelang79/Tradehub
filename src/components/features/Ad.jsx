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

const brandAds = [
  {
    brand: 'Apple',
    tagline: 'iPhone 16 Pro. Built for Apple Intelligence.',
    offer: 'Up to $600 trade-in credit',
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #2d2d44 40%, #0a0a14 100%)',
    accentColor: '#007AFF',
    logoSvg: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    ),
    image: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=800&q=80',
  },
  {
    brand: 'Samsung',
    tagline: 'Galaxy S25 Ultra. The next era of mobile AI.',
    offer: 'Free Galaxy Buds with pre-order',
    gradient: 'linear-gradient(135deg, #0c0c1d 0%, #1a1a3e 40%, #0d0d2b 100%)',
    accentColor: '#1428A0',
    logoSvg: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
        <path d="M3.609 1.814L13.792 12l-6.102 6.125a.86.86 0 0 0 0 1.214.86.86 0 0 0 1.214 0L15.61 12.63a.86.86 0 0 0 0-1.214L8.72.593a.86.86 0 0 0-1.214 0 .86.86 0 0 0-.021 1.221zM20.391 1.814a.86.86 0 0 0-1.214 0l-6.89 10.417 6.102 6.125a.86.86 0 0 0 1.214 0 .86.86 0 0 0 0-1.214l-6.102-6.125 6.89-10.417a.86.86 0 0 0 .004-1.221z" />
      </svg>
    ),
    image: 'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=800&q=80',
  },
  {
    brand: 'Nike',
    tagline: 'Air Max Dn. Feel the rush of Dynamic Air.',
    offer: 'Exclusive early access for TradeHub members',
    gradient: 'linear-gradient(135deg, #111 0%, #1a1a1a 40%, #0a0a0a 100%)',
    accentColor: '#FA5400',
    logoSvg: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
        <path d="M21.527 7.108c-.282-.52-1.002-.825-1.98-.825-1.08 0-2.552.46-4.372 1.357-1.82.898-3.537 1.918-5.154 3.062C8.4 11.85 7.08 12.854 6.058 13.718c-.51.433-.955.833-1.33 1.198-.376.366-.67.693-.887.984-.109.146-.206.283-.292.41l-.074.106-.006.008a.364.364 0 0 0-.087.27l.003.027v.033l.001.031v.027l-.002.025-.003.028-.005.033-.012.043-.02.056-.032.072-.044.08-.056.08-.062.072-.06.056-.003.004.55 1.264.012-.027.065-.133.072-.127.082-.116.09-.1.094-.082.064-.045.057-.025.052-.005h.008l.05.007.045.014.043.02.038.026.033.03.026.032.02.034.012.033.005.031v.012l-.002.035-.01.034-.02.033-.028.03-.035.026-.038.02-.043.013-.043.007-.045-.001-.042-.01-.04-.017-.035-.025-.033-.03-.028-.034-.023-.037-.015-.037-.009-.035v-.034l.006-.04.014-.035.024-.032.03-.028.037-.023.04-.018.043-.012.043-.005.044.003.043.01.04.018.036.025.03.033.026.037.016.037.009.035.003.035-.001.035-.01.036-.016.034-.025.032-.03.028-.038.023-.04.017-.043.01-.044.004-.044-.003-.04-.01-.038-.018-.034-.026-.028-.034-.023-.037-.014-.038-.008-.036v-.035l.006-.039.014-.035.023-.032.03-.028.038-.023.04-.018.043-.012.043-.005.044.003.042.01.04.018.036.025.03.033.025.038.016.037.009.035.003.035-.001.035-.01.035-.016.034-.025.03-.03.027-.038.024-.04.017-.043.01-.043.004-.044-.003-.042-.01-.038-.018-.034-.026-.028-.034-.023-.037-.014-.037-.008-.036v-.034l.005-.04.014-.034.024-.033.03-.027.038-.024.04-.017.043-.013.043-.004.044.003.043.01.04.018.036.025.03.033.026.037.016.037.009.035.003.035v-.011l.003-.033.01-.035.018-.033.027-.03.034-.026.04-.02.043-.013.044-.004.044.003.042.01.04.018.036.025.03.033.026.037.016.037.009.035.003.035l-.001.035-.01.034-.016.035-.025.03-.03.028-.037.024-.04.017-.043.01-.043.005-.044-.003-.042-.01-.04-.018-.036-.025-.03-.033-.026-.037-.016-.037-.009-.035-.003-.035.001-.035.01-.035.017-.034.025-.03.03-.028.037-.023.04-.018.043-.012.043-.005.044.003.043.01.04.018.036.025.03.033.026.037.016.037.009.035.003.035l-.001.035-.01.034-.016.035-.025.03-.03.028-.037.023-.04.018-.043.012-.043.005-.044-.003-.042-.01-.04-.018-.036-.025-.03-.033-.026-.037-.016-.037-.009-.035-.003-.035.001-.035.01-.035.017-.034.025-.03.03-.028.037-.023.04-.018.043-.012.043-.005.044.003.043.01.04.018.036.025.03.033.026.037.016.037.009.035.003.035l-.001.035-.01.034-.016.035-.025.03-.03.028-.037.023-.04.018-.043.012-.043.005-.044-.003-.042-.01-.04-.018-.036-.025-.03-.033-.026-.037-.016-.037-.009-.035-.003-.035.001-.035.01-.035.017-.034.025-.03.03-.028.037-.023.04-.018.043-.012.043-.005.044.003.043.01.04.018.036.025.03.033.026.037.016.037.009.035.003.035" />
      </svg>
    ),
    image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80',
  },
];

export function BrandSponsor({ className = '' }) {
  const [dismissed, setDismissed] = useState(false);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent(prev => (prev + 1) % brandAds.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  if (dismissed) return null;

  const ad = brandAds[current];

  return (
    <div
      className={`brand-sponsor ${className}`}
      style={{ background: ad.gradient }}
    >
      <button className="brand-sponsor-dismiss" onClick={() => setDismissed(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="brand-sponsor-inner">
        <div className="brand-sponsor-left">
          <span className="brand-sponsor-badge">Sponsored</span>
          <div className="brand-sponsor-logo" style={{ color: ad.accentColor }}>
            {ad.logoSvg}
          </div>
          <h3 className="brand-sponsor-name">{ad.brand}</h3>
          <p className="brand-sponsor-tagline">{ad.tagline}</p>
          <p className="brand-sponsor-offer" style={{ color: ad.accentColor }}>{ad.offer}</p>
          <button className="brand-sponsor-cta" style={{ background: ad.accentColor }}>
            Shop Now
          </button>
        </div>
        <div className="brand-sponsor-right">
          <img src={ad.image} alt={ad.brand} className="brand-sponsor-image" />
          <div className="brand-sponsor-image-glow" style={{ background: ad.accentColor }} />
        </div>
      </div>

      <div className="brand-sponsor-dots">
        {brandAds.map((_, i) => (
          <button
            key={i}
            className={`brand-sponsor-dot ${i === current ? 'active' : ''}`}
            style={i === current ? { background: ad.accentColor } : {}}
            onClick={() => setCurrent(i)}
          />
        ))}
      </div>
    </div>
  );
}
