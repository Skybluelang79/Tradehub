import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/client';
import { useToast } from '../ui/Toast';
import { formatDate } from '../../utils/helpers';
import './Referrals.css';

const PLACEHOLDER_IMG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"%3E%3Crect fill="%231f1f2e" width="48" height="48" rx="8"/%3E%3Ctext x="24" y="29" text-anchor="middle" fill="%236B6B7B" font-size="14"%3E%@%3C/text%3E%3C/svg%3E';

export default function Referrals() {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.referrals.my();
      if (res && (res.code || res.error)) setData(res);
    } catch (err) {
      addToast(err.message || 'Could not load referrals', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    load();
  }, [load]);

  if (!loading && !data?.code) {
    return (
      <div className="referrals-empty">
        <p>Sign in to view your referral program.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="referrals-loading">Loading...</div>;
  }

  const link = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?ref=${data.code}`
    : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      addToast('Referral link copied!', 'success');
    } catch {
      addToast('Could not copy link', 'error');
    }
  };

  const reward = (data.rewardCents || 1000) / 100;

  return (
    <div className="referrals">
      <div className="referrals-hero">
        <div className="referrals-info">
          <h3>Refer &amp; Earn</h3>
          <p>Share your code and earn <strong>${reward.toFixed(2)}</strong> in store credit for every friend who joins and completes their first purchase.</p>
        </div>
        <div className="referrals-code-card">
          <span className="referrals-code-label">Your code</span>
          <div className="referrals-code">{data.code}</div>
          <button type="button" className="referrals-copy-btn" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </div>

      <div className="referrals-stats">
        <div className="referrals-stat">
          <span className="referrals-stat-value">{data.referredCount || 0}</span>
          <span className="referrals-stat-label">Friends joined</span>
        </div>
        <div className="referrals-stat">
          <span className="referrals-stat-value">${((data.earnedCents || 0) / 100).toFixed(2)}</span>
          <span className="referrals-stat-label">Credit earned</span>
        </div>
      </div>

      {data.list && data.list.length > 0 && (
        <div className="referrals-list">
          <h4>Referral history</h4>
          {data.list.map((r) => (
            <div className="referral-item" key={r.created_at + r.referred_name}>
              <img src={r.referred_avatar || PLACEHOLDER_IMG} alt={r.referred_name || 'User'} className="referral-avatar" />
              <div className="referral-main">
                <span className="referral-name">{r.referred_name || 'Invited user'}</span>
                <span className="referral-date">Joined {formatDate(r.created_at)}</span>
              </div>
              <span className={`referral-status referral-status--${r.status}`}>
                {r.status === 'credited' ? `$${(r.reward_cents / 100).toFixed(2)} earned` : 'Pending first purchase'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}