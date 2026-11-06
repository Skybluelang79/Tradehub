import { useState, useEffect, useRef, useCallback } from 'react';
import { formatPrice } from '../../utils/helpers';
import { api } from '../../services/client';
import './PremiumSeller.css';

const premiumSellers = [
  {
    id: 1, name: 'Alex Olajide',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=AlexOlajide',
    tagline: 'Celebrity-style bags & shoes',
    rating: 4.9, reviews: 186, sales: 412, verified: true,
    badge: 'Elite Seller', badgeColor: '#E94560', responseTime: '< 15m',
    items: [
      { title: 'Celebrity-Style Leather Bag', price: 285000, img: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=300&q=80' },
      { title: 'Luxury Sneaker Pair', price: 195000, img: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=300&q=80' },
    ],
  },
  {
    id: 2, name: 'Adaeze Okafor',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=AdaezeOkafor',
    tagline: 'Luxury fashion curator',
    rating: 4.9, reviews: 142, sales: 367, verified: true,
    badge: 'Top Seller', badgeColor: '#A78BFA', responseTime: '< 30m',
    items: [
      { title: 'Vintage Structured Handbag', price: 145000, img: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=300&q=80' },
      { title: 'Italian Silk Scarf', price: 48000, img: 'https://images.unsplash.com/photo-1601924994987-69e26d50dc64?w=300&q=80' },
    ],
  },
  {
    id: 3, name: 'Ibrahim Musa',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=IbrahimMusa',
    tagline: 'Certified electronics reseller',
    rating: 4.8, reviews: 203, sales: 512, verified: true,
    badge: 'Power Seller', badgeColor: '#4ADE80', responseTime: '< 1h',
    items: [
      { title: 'iPhone 15 Pro Max', price: 1250000, img: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=300&q=80' },
      { title: 'AirPods Pro 2', price: 285000, img: 'https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=300&q=80' },
    ],
  },
];

const PLATFORM_FEE_RATE = 0.02;

const perks = [
  { icon: '👑', title: 'Priority Listing', desc: 'Your items appear first in search results' },
  { icon: '⭐', title: 'Gold Seller Badge', desc: 'Stand out with a gold verified badge' },
  { icon: '📊', title: 'Seller Analytics', desc: 'Track views, clicks, and conversion rates' },
  { icon: '🚀', title: '7 Featured Slots', desc: 'Keep seven listings featured at once' },
  { icon: '📦', title: '120 Listings', desc: 'List up to 120 items for 90 days each' },
  { icon: '🏷️', title: 'Reduced 2% Fee', desc: 'Gold cuts the transaction fee from 4% to 2%' },
];

const plans = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    displayPrice: 'Free',
    period: '',
    color: '#6B6B7B',
    features: ['30 listings', '6 photos per listing', '30-day listings', '4% transaction fee', 'Standard support'],
    cta: 'Current Plan',
  },
  {
    id: 'premium',
    name: 'Gold',
    price: 9.99,
    displayPrice: '$9.99',
    period: '/mo',
    color: '#FBBF24',
    features: ['120 listings', '10 photos + 1 video', '90-day listings', '7 featured slots', 'Auctions auto-approved', '2% escrow fee', 'Real-time analytics', 'Distress sales pinned'],
    cta: 'Subscribe',
    badge: 'Best Value',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 24.99,
    displayPrice: '$24.99',
    period: '/mo',
    color: '#A78BFA',
    features: ['Unlimited listings', 'Everything in Gold', '2% escrow fee', 'Priority support', 'Custom storefront'],
    cta: 'Subscribe',
    badge: 'For Power Sellers',
  },
];

function useAnimatedCounter(target, duration = 1500, enabled = true) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const startTime = performance.now();
    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [target, duration, enabled]);
  return value;
}

export default function PremiumSeller() {
  const [currentSeller, setCurrentSeller] = useState(0);
  const [showAllPerks, setShowAllPerks] = useState(false);
  const [activePerk, setActivePerk] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('premium');
  const [currentPlan, setCurrentPlan] = useState('free');
  const [upgradeError, setUpgradeError] = useState('');
  const [monthlySales, setMonthlySales] = useState(20);
  const [avgPrice, setAvgPrice] = useState(45000);
  const [upgradeStep, setUpgradeStep] = useState(0);
  const [particles, setParticles] = useState([]);
  const particleTimerRef = useRef(null);

  const seller = premiumSellers[currentSeller];

  useEffect(() => {
    const t = setInterval(() => {
      setCurrentSeller(prev => (prev + 1) % premiumSellers.length);
    }, 6000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!api.subscription?.current) return;
    api.subscription.current()
      .then((res) => {
        if (res.subscription?.plan) setCurrentPlan(res.subscription.plan);
      })
      .catch(() => {});
  }, []);

  const monthlyRevenue = monthlySales * avgPrice;
  const platformFee = monthlyRevenue * PLATFORM_FEE_RATE;
  const sellerPayout = useAnimatedCounter(Math.round(monthlyRevenue - platformFee), 1200, showUpgrade);

  const spawnParticles = useCallback(() => {
    const newParticles = Array.from({ length: 12 }, (_, i) => ({
      id: Date.now() + i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 4 + Math.random() * 6,
      duration: 1 + Math.random() * 1.5,
      delay: Math.random() * 0.3,
    }));
    setParticles(newParticles);
    clearTimeout(particleTimerRef.current);
    particleTimerRef.current = setTimeout(() => setParticles([]), 2500);
  }, []);

  const handleUpgradeClick = (planId) => {
    if (planId === currentPlan || planId === 'free') return;
    setSelectedPlan(planId);
    setUpgradeError('');
    setShowUpgrade(true);
    spawnParticles();
  };

  const handleConfirmUpgrade = async () => {
    setUpgradeStep(1);
    setUpgradeError('');
    spawnParticles();
    try {
      const res = await api.subscription.upgrade(selectedPlan);
      if (res.requires_payment) {
        if (res.authorizationUrl) {
          window.location.href = res.authorizationUrl;
          return;
        }
        throw new Error('Could not start checkout. Please try again.');
      }
      setCurrentPlan(res.subscription?.plan || selectedPlan);
      setUpgradeStep(2);
      setTimeout(() => setUpgradeStep(3), 1500);
    } catch (err) {
      setUpgradeStep(0);
      setUpgradeError(err.message || 'Could not start your subscription.');
    }
  };

  const handleDismissUpgrade = () => {
    setShowUpgrade(false);
    setUpgradeStep(0);
    setUpgradeError('');
  };

  return (
    <div className="premium-seller">
      <div className="premium-seller-bg">
        <div className="premium-orb premium-orb-1" />
        <div className="premium-orb premium-orb-2" />
        <div className="premium-shimmer" />
      </div>

      <div className="premium-seller-header">
        <div className="premium-seller-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </div>
        <div className="premium-seller-title-group">
          <h3 className="premium-seller-title">Gold Sellers</h3>
          <p className="premium-seller-subtitle">Top-rated sellers you can trust</p>
        </div>
      </div>

      <div className="premium-seller-spotlight">
        <div className="premium-spotlight-card" key={seller.id}>
          <div className="premium-spotlight-avatar-wrap">
            <img src={seller.avatar} alt={seller.name} className="premium-spotlight-avatar" />
            <div className="premium-spotlight-ring" style={{ borderColor: seller.badgeColor }} />
            {seller.verified && (
              <div className="premium-spotlight-check">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
              </div>
            )}
          </div>
          <div className="premium-spotlight-info">
            <div className="premium-spotlight-name-row">
              <span className="premium-spotlight-name">{seller.name}</span>
              <span className="premium-spotlight-badge" style={{ background: `${seller.badgeColor}20`, color: seller.badgeColor }}>{seller.badge}</span>
            </div>
            <span className="premium-spotlight-tagline">{seller.tagline}</span>
            <div className="premium-spotlight-stats">
              <div className="premium-stat-item"><span className="premium-stat-val">⭐ {seller.rating}</span><span className="premium-stat-lbl">{seller.reviews} reviews</span></div>
              <div className="premium-stat-divider" />
              <div className="premium-stat-item"><span className="premium-stat-val">{seller.sales}</span><span className="premium-stat-lbl">sales</span></div>
              <div className="premium-stat-divider" />
              <div className="premium-stat-item"><span className="premium-stat-val">{seller.responseTime}</span><span className="premium-stat-lbl">response</span></div>
            </div>
            <div className="premium-spotlight-items">
              {seller.items.map((item, i) => (
                <div key={i} className="premium-mini-item">
                  <img src={item.img} alt={item.title} />
                  <div className="premium-mini-item-info">
                    <span className="premium-mini-item-title">{item.title}</span>
                    <span className="premium-mini-item-price">{formatPrice(item.price)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="premium-spotlight-dots">
            {premiumSellers.map((_, i) => (
              <button key={i} className={`premium-dot ${i === currentSeller ? 'active' : ''}`}
                style={i === currentSeller ? { background: seller.badgeColor } : {}}
                onClick={() => setCurrentSeller(i)} />
            ))}
          </div>
        </div>
      </div>

      <div className="premium-seller-perks">
        <button className="premium-perks-toggle" onClick={() => setShowAllPerks(!showAllPerks)}>
          <span className="premium-perks-toggle-icon">💎</span>
          <span className="premium-perks-toggle-text">{showAllPerks ? 'Hide' : 'See all'} Gold Benefits</span>
          <svg className={`premium-perks-chevron ${showAllPerks ? 'rotated' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        <div className={`premium-perks-grid ${showAllPerks ? 'visible' : ''}`}>
          {perks.map((perk, i) => (
            <button key={i} className={`premium-perk ${activePerk === i ? 'active' : ''}`}
              onClick={() => setActivePerk(activePerk === i ? null : i)}
              style={{ animationDelay: `${i * 50}ms` }}>
              <span className="premium-perk-icon">{perk.icon}</span>
              <div className="premium-perk-text"><strong>{perk.title}</strong><span>{perk.desc}</span></div>
            </button>
          ))}
        </div>
      </div>

      {/* BECOME A GOLD SELLER */}
      <div className="premium-upgrade-section">
        <button className="premium-upgrade-header" onClick={() => setShowUpgrade(!showUpgrade)}>
          <div className="premium-upgrade-header-left">
            <div className="premium-upgrade-crown">👑</div>
            <div>
              <h4 className="premium-upgrade-title">Become a Gold Seller</h4>
              <p className="premium-upgrade-sub">$9.99/month · cancel anytime</p>
            </div>
          </div>
          <svg className={`premium-upgrade-chevron ${showUpgrade ? 'rotated' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
        </button>

        {showUpgrade && (
          <div className="premium-upgrade-body">
            {/* Earnings Calculator */}
            <div className="premium-calculator">
              <h5 className="premium-calc-title">💰 Earnings Calculator</h5>
              <div className="premium-calc-inputs">
                <div className="premium-calc-field">
                  <label>Monthly Sales</label>
                  <div className="premium-calc-slider-row">
                    <input type="range" min="5" max="100" value={monthlySales}
                      onChange={(e) => setMonthlySales(Number(e.target.value))} className="premium-slider" />
                    <span className="premium-calc-val">{monthlySales}</span>
                  </div>
                </div>
                <div className="premium-calc-field">
                  <label>Avg. Price (₦)</label>
                  <div className="premium-calc-slider-row">
                    <input type="range" min="5000" max="500000" step="5000" value={avgPrice}
                      onChange={(e) => setAvgPrice(Number(e.target.value))} className="premium-slider" />
                    <span className="premium-calc-val">{formatPrice(avgPrice)}</span>
                  </div>
                </div>
              </div>
              <div className="premium-calc-results">
                <div className="premium-calc-result">
                  <span className="premium-calc-result-label">Revenue</span>
                  <span className="premium-calc-result-value">{formatPrice(monthlyRevenue)}</span>
                </div>
                <div className="premium-calc-result free">
                  <span className="premium-calc-result-label">Gold fee (2%)</span>
                  <span className="premium-calc-result-value">-{formatPrice(platformFee)}</span>
                </div>
                <div className="premium-calc-result savings">
                  <span className="premium-calc-result-label">You keep</span>
                  <span className="premium-calc-result-value">{formatPrice(sellerPayout)}/mo</span>
                </div>
              </div>
            </div>

            {/* Plan Comparison */}
            <div className="premium-plans">
              {plans.map((plan) => {
                const isCurrent = currentPlan === plan.id;
                return (
                  <div key={plan.id}
                    className={`premium-plan-card ${selectedPlan === plan.id ? 'selected' : ''} ${isCurrent ? 'current' : ''}`}
                    onClick={() => !isCurrent && plan.id !== 'free' && setSelectedPlan(plan.id)}
                    style={{ '--plan-color': plan.color }}>
                    {plan.badge && <span className="premium-plan-badge" style={{ background: plan.color }}>{plan.badge}</span>}
                    <div className="premium-plan-header">
                      <h5 className="premium-plan-name">{plan.name}</h5>
                      <div className="premium-plan-price">
                        {plan.price === 0 ? 'Free' : <>
                          <span className="premium-plan-amount">{plan.displayPrice}</span>
                          <span className="premium-plan-period">{plan.period}</span>
                        </>}
                      </div>
                      {plan.savings && <span className="premium-plan-savings" style={{ color: plan.color }}>{plan.savings}</span>}
                    </div>
                    <ul className="premium-plan-features">
                      {plan.features.map((f, i) => (
                        <li key={i}>
                          <svg viewBox="0 0 24 24" fill="none" stroke={plan.color} strokeWidth="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12" /></svg>
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button className="premium-plan-cta"
                      disabled={isCurrent || plan.id === 'free'}
                      style={!isCurrent && plan.id !== 'free' ? { background: plan.color } : {}}
                      onClick={(e) => { e.stopPropagation(); handleUpgradeClick(plan.id); }}>
                      {isCurrent ? 'Current Plan' : plan.cta}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Upgrade Modal */}
            {showUpgrade && (
              <div className="premium-modal-overlay" onClick={handleDismissUpgrade}>
                <div className="premium-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="premium-modal-particles">
                    {particles.map(p => (
                      <span key={p.id} className="premium-particle" style={{
                        left: `${p.x}%`, top: `${p.y}%`,
                        width: p.size, height: p.size,
                        animationDuration: `${p.duration}s`,
                        animationDelay: `${p.delay}s`,
                      }} />
                    ))}
                  </div>

                  {upgradeStep === 0 && (
                    <div className="premium-modal-content">
                      <div className="premium-modal-icon">👑</div>
                      <h3>Upgrade to {plans.find(p => p.id === selectedPlan)?.name}</h3>
                      <p>Unlock seller tools and lower fees. The NGN equivalent is charged at checkout.</p>
                      <div className="premium-modal-plan-summary">
                        <span>{plans.find(p => p.id === selectedPlan)?.name} Plan</span>
                        <strong>{plans.find(p => p.id === selectedPlan)?.displayPrice}/mo</strong>
                      </div>
                      {upgradeError && <p className="premium-modal-error">{upgradeError}</p>}
                      <button className="premium-modal-confirm" onClick={handleConfirmUpgrade}
                        style={{ background: plans.find(p => p.id === selectedPlan)?.color }}>
                        Continue to Payment
                      </button>
                      <button className="premium-modal-cancel" onClick={handleDismissUpgrade}>Maybe later</button>
                    </div>
                  )}

                  {upgradeStep === 1 && (
                    <div className="premium-modal-content">
                      <div className="premium-modal-spinner" />
                      <h3>Setting up your account...</h3>
                      <p>Activating Gold features</p>
                    </div>
                  )}

                  {upgradeStep === 2 && (
                    <div className="premium-modal-content">
                      <div className="premium-modal-success">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                      </div>
                      <h3>You're all set!</h3>
                      <p>All benefits are now active. Welcome aboard!</p>
                    </div>
                  )}

                  {upgradeStep === 3 && (
                    <div className="premium-modal-content">
                      <div className="premium-modal-unlocked">
                        {perks.slice(0, 4).map((p, i) => (
                          <span key={i} className="premium-unlocked-item" style={{ animationDelay: `${i * 150}ms` }}>
                            {p.icon} {p.title}
                          </span>
                        ))}
                      </div>
                      <button className="premium-modal-done" onClick={handleDismissUpgrade}>Start Selling</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
