import { useState, useEffect, useRef, useCallback } from 'react';
import './PremiumSeller.css';

const premiumSellers = [
  {
    id: 1, name: 'Sarah Chen',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah',
    tagline: 'Vintage fashion specialist',
    rating: 4.9, reviews: 142, sales: 387, verified: true,
    badge: 'Top Seller', badgeColor: '#E94560', responseTime: '< 1h',
    items: [
      { title: 'Designer Leather Bag', price: 280, img: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=300&q=80' },
      { title: 'Vintage Silk Scarf', price: 65, img: 'https://images.unsplash.com/photo-1601924994987-69e26d50dc64?w=300&q=80' },
    ],
  },
  {
    id: 2, name: 'Mike Johnson',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Mike',
    tagline: 'Certified electronics reseller',
    rating: 4.8, reviews: 203, sales: 512, verified: true,
    badge: 'Power Seller', badgeColor: '#007AFF', responseTime: '< 30m',
    items: [
      { title: 'MacBook Pro M3', price: 1650, img: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=300&q=80' },
      { title: 'AirPods Pro 2', price: 180, img: 'https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=300&q=80' },
    ],
  },
  {
    id: 3, name: 'Lisa Park',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lisa',
    tagline: 'Home & lifestyle curator',
    rating: 4.9, reviews: 98, sales: 245, verified: true,
    badge: 'Rising Star', badgeColor: '#4ADE80', responseTime: '< 2h',
    items: [
      { title: 'Mid-Century Lamp', price: 120, img: 'https://images.unsplash.com/photo-1507473885765-e6ed057ab6fe?w=300&q=80' },
      { title: 'Ceramic Vase Set', price: 45, img: 'https://images.unsplash.com/photo-1612196808214-b7e239e5bb6a?w=300&q=80' },
    ],
  },
];

const perks = [
  { icon: '👑', title: 'Priority Listing', desc: 'Your items appear first in search results' },
  { icon: '⭐', title: 'Premium Badge', desc: 'Stand out with a gold verified badge' },
  { icon: '📊', title: 'Seller Analytics', desc: 'Track views, clicks, and conversion rates' },
  { icon: '🚀', title: 'Free Boosts', desc: '2 free listing boosts per month' },
  { icon: '💬', title: 'Priority Support', desc: 'Direct line to our seller success team' },
  { icon: '🏷️', title: 'Lower Fees', desc: '2% fee instead of 3% on all transactions' },
];

const plans = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    period: '',
    color: '#6B6B7B',
    features: ['5 listings', '3% transaction fee', 'Basic search visibility', 'Standard support'],
    cta: 'Current Plan',
    current: true,
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 9.99,
    period: '/mo',
    color: '#FBBF24',
    features: ['Unlimited listings', '2% transaction fee', 'Priority search ranking', 'Premium badge', '2 free boosts/mo', 'Analytics dashboard'],
    cta: 'Start Free Trial',
    badge: 'Most Popular',
    savings: 'Save 1% per sale',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 24.99,
    period: '/mo',
    color: '#A78BFA',
    features: ['Everything in Premium', '1.5% transaction fee', 'Featured on homepage', 'API access', 'Priority support', 'Custom storefront'],
    cta: 'Start Free Trial',
    badge: 'For Power Sellers',
    savings: 'Save 1.5% per sale',
  },
];

function useAnimatedCounter(target, duration = 1500, enabled = true) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let start = 0;
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
  const [monthlySales, setMonthlySales] = useState(20);
  const [avgPrice, setAvgPrice] = useState(75);
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

  const monthlyRevenue = monthlySales * avgPrice;
  const freeFee = monthlyRevenue * 0.03;
  const premiumFee = monthlyRevenue * 0.02;
  const proFee = monthlyRevenue * 0.015;
  const premiumSavings = useAnimatedCounter(Math.round(freeFee - premiumFee), 1200, showUpgrade);
  const proSavings = useAnimatedCounter(Math.round(freeFee - proFee), 1200, showUpgrade);

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
    setSelectedPlan(planId);
    setShowUpgrade(true);
    spawnParticles();
  };

  const handleConfirmUpgrade = () => {
    setUpgradeStep(1);
    spawnParticles();
    setTimeout(() => setUpgradeStep(2), 1500);
    setTimeout(() => setUpgradeStep(3), 3000);
  };

  const handleDismissUpgrade = () => {
    setShowUpgrade(false);
    setUpgradeStep(0);
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
          <h3 className="premium-seller-title">Premium Sellers</h3>
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
                    <span className="premium-mini-item-price">${item.price}</span>
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
          <span className="premium-perks-toggle-text">{showAllPerks ? 'Hide' : 'See all'} Premium Benefits</span>
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

      {/* ── BECOME A PREMIUM SELLER ── */}
      <div className="premium-upgrade-section">
        <button className="premium-upgrade-header" onClick={() => setShowUpgrade(!showUpgrade)}>
          <div className="premium-upgrade-header-left">
            <div className="premium-upgrade-crown">👑</div>
            <div>
              <h4 className="premium-upgrade-title">Become a Premium Seller</h4>
              <p className="premium-upgrade-sub">First 3 months free — cancel anytime</p>
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
                  <label>Avg. Price ($)</label>
                  <div className="premium-calc-slider-row">
                    <input type="range" min="10" max="500" step="5" value={avgPrice}
                      onChange={(e) => setAvgPrice(Number(e.target.value))} className="premium-slider" />
                    <span className="premium-calc-val">${avgPrice}</span>
                  </div>
                </div>
              </div>
              <div className="premium-calc-results">
                <div className="premium-calc-result">
                  <span className="premium-calc-result-label">Revenue</span>
                  <span className="premium-calc-result-value">${monthlyRevenue.toLocaleString()}</span>
                </div>
                <div className="premium-calc-result free">
                  <span className="premium-calc-result-label">Free fees (3%)</span>
                  <span className="premium-calc-result-value">-${freeFee.toFixed(0)}</span>
                </div>
                <div className="premium-calc-result premium">
                  <span className="premium-calc-result-label">Premium fees (2%)</span>
                  <span className="premium-calc-result-value">-${premiumFee.toFixed(0)}</span>
                </div>
                <div className="premium-calc-result savings">
                  <span className="premium-calc-result-label">You save</span>
                  <span className="premium-calc-result-value">${premiumSavings}/mo</span>
                </div>
              </div>
            </div>

            {/* Plan Comparison */}
            <div className="premium-plans">
              {plans.map((plan) => (
                <div key={plan.id}
                  className={`premium-plan-card ${selectedPlan === plan.id ? 'selected' : ''} ${plan.current ? 'current' : ''}`}
                  onClick={() => !plan.current && setSelectedPlan(plan.id)}
                  style={{ '--plan-color': plan.color }}>
                  {plan.badge && <span className="premium-plan-badge" style={{ background: plan.color }}>{plan.badge}</span>}
                  <div className="premium-plan-header">
                    <h5 className="premium-plan-name">{plan.name}</h5>
                    <div className="premium-plan-price">
                      {plan.price === 0 ? 'Free' : <>
                        <span className="premium-plan-amount">${plan.price}</span>
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
                    disabled={plan.current}
                    style={!plan.current ? { background: plan.color } : {}}
                    onClick={(e) => { e.stopPropagation(); handleUpgradeClick(plan.id); }}>
                    {plan.cta}
                  </button>
                </div>
              ))}
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
                      <p>Start your free 3-month trial. No charge until trial ends.</p>
                      <div className="premium-modal-plan-summary">
                        <span>{plans.find(p => p.id === selectedPlan)?.name} Plan</span>
                        <strong>${plans.find(p => p.id === selectedPlan)?.price}/mo</strong>
                      </div>
                      <button className="premium-modal-confirm" onClick={handleConfirmUpgrade}
                        style={{ background: plans.find(p => p.id === selectedPlan)?.color }}>
                        Confirm Free Trial
                      </button>
                      <button className="premium-modal-cancel" onClick={handleDismissUpgrade}>Maybe later</button>
                    </div>
                  )}

                  {upgradeStep === 1 && (
                    <div className="premium-modal-content">
                      <div className="premium-modal-spinner" />
                      <h3>Setting up your account...</h3>
                      <p>Activating premium features</p>
                    </div>
                  )}

                  {upgradeStep === 2 && (
                    <div className="premium-modal-content">
                      <div className="premium-modal-success">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                      </div>
                      <h3>You're Premium!</h3>
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
