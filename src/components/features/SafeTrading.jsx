import { useState } from 'react';
import './SafeTrading.css';

const features = [
  {
    id: 'escrow',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </svg>
    ),
    title: 'Escrow Protection',
    desc: 'Your payment is held securely until you confirm delivery. No release without your approval.',
    detail: 'When you buy on TradeHub, your money goes into a secure escrow account. The seller only receives payment after you inspect and approve the item. If there\'s any issue, you can raise a dispute within 48 hours for a full refund.',
    color: '#4ADE80',
  },
  {
    id: 'verified',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12l2 2 4-4" />
        <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
      </svg>
    ),
    title: 'Verified Sellers',
    desc: 'Every seller is identity-checked. Look for the blue checkmark for extra trust.',
    detail: 'Verified sellers have submitted government ID and proof of address. They carry a trust score based on transaction history, response time, and buyer reviews. Filter search results to only show verified sellers.',
    color: '#007AFF',
  },
  {
    id: 'dispute',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: 'Dispute Resolution',
    desc: 'Dedicated support team resolves disputes within 24 hours. Fair outcomes guaranteed.',
    detail: 'Our trained mediators review evidence from both buyer and seller — photos, chat logs, and tracking info. Most disputes are resolved within 24 hours. 98% of buyers report satisfaction with the outcome.',
    color: '#A78BFA',
  },
  {
    id: 'payment',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
    title: 'Secure Payments',
    desc: 'PCI-DSS compliant. We never store your card details. Stripe-powered encryption.',
    detail: 'All transactions are processed through Stripe with 256-bit SSL encryption. Your financial data never touches our servers. Supports Apple Pay, Google Pay, and all major credit cards.',
    color: '#FBBF24',
  },
];

const stats = [
  { value: '50K+', label: 'Protected Transactions', icon: '🛡️' },
  { value: '99.2%', label: 'Successful Deliveries', icon: '📦' },
  { value: '<24h', label: 'Dispute Resolution', icon: '⚡' },
  { value: '4.8', label: 'Average Trust Score', icon: '⭐' },
];

export default function SafeTrading() {
  const [expanded, setExpanded] = useState(null);
  const [activeStat, setActiveStat] = useState(null);

  return (
    <div className="safe-trading">
      <div className="safe-trading-header">
        <div className="safe-trading-shield">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <div className="safe-trading-title-group">
          <h3 className="safe-trading-title">Safe Trading</h3>
          <p className="safe-trading-subtitle">Every transaction is protected end-to-end</p>
        </div>
      </div>

      <div className="safe-trading-stats">
        {stats.map((stat, i) => (
          <button
            key={i}
            className={`safe-stat ${activeStat === i ? 'active' : ''}`}
            onClick={() => setActiveStat(activeStat === i ? null : i)}
          >
            <span className="safe-stat-icon">{stat.icon}</span>
            <span className="safe-stat-value">{stat.value}</span>
            <span className="safe-stat-label">{stat.label}</span>
          </button>
        ))}
      </div>

      <div className="safe-trading-features">
        {features.map((f) => (
          <button
            key={f.id}
            className={`safe-feature ${expanded === f.id ? 'expanded' : ''}`}
            onClick={() => setExpanded(expanded === f.id ? null : f.id)}
          >
            <div className="safe-feature-main">
              <div className="safe-feature-icon" style={{ color: f.color, background: `${f.color}15` }}>
                {f.icon}
              </div>
              <div className="safe-feature-text">
                <h4 className="safe-feature-title">{f.title}</h4>
                <p className="safe-feature-desc">{f.desc}</p>
              </div>
              <div className={`safe-feature-chevron ${expanded === f.id ? 'rotated' : ''}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </div>
            {expanded === f.id && (
              <div className="safe-feature-detail">
                <p>{f.detail}</p>
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="safe-trading-footer">
        <div className="safe-footer-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>TradeHub Buyer Protection</span>
        </div>
        <p className="safe-footer-text">
          Every purchase is backed by our guarantee. If your item doesn't match the listing or never arrives, we'll refund you in full.
        </p>
      </div>
    </div>
  );
}
