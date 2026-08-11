import { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { api } from '../../services/client';
import { DollarIcon, CheckIcon, BanIcon, DownloadIcon, AlertIcon } from './Icons.jsx';
import './AdminTransactions.css';
import './AdminPayouts.css';

const fmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

const STATUS_META = {
  pending: { label: 'Pending', cls: 'status-pending' },
  approved: { label: 'Approved', cls: 'status-approved' },
  completed: { label: 'Completed', cls: 'status-completed' },
  cancelled: { label: 'Cancelled', cls: 'status-cancelled' },
  rejected: { label: 'Rejected', cls: 'status-refunded' },
};

export default function AdminPayouts() {
  const { isAdminAuth } = useAdmin();
  const [payouts, setPayouts] = useState([]);
  const [awaiting, setAwaiting] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState('all');
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [giftAmount, setGiftAmount] = useState('25');
  const [giftCount, setGiftCount] = useState('1');
  const [issuedCodes, setIssuedCodes] = useState([]);
  const [giftBusy, setGiftBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const refresh = useCallback(async () => {
    if (!isAdminAuth) {
      window.dispatchEvent(new CustomEvent('adminSessionExpired'));
      return;
    }
    setLoading(true);
    try {
      const [p, t] = await Promise.all([api.payouts.all(), api.admin.transactions()]);
      setPayouts(p.payouts || []);
      setAwaiting((t.transactions || []).filter((tx) => tx.status === 'awaiting_payment'));
    } catch (err) {
      console.error('Failed to load payouts:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdminAuth]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      await refresh();
    } catch (err) {
      alert(`Action failed: ${err.message || 'unknown error'}`);
    } finally {
      setBusy('');
    }
  };

  const handleStatus = (id, status) => act(`status-${id}-${status}`, () => api.payouts.updateStatus(id, { status }));

  const handleConfirmFunds = (txnId) => act(`fund-${txnId}`, () => api.payments.confirmFunds(txnId));

  const handleIssueGiftCards = async () => {
    const amountCents = Math.round(parseFloat(giftAmount || '0') * 100);
    const count = parseInt(giftCount, 10) || 1;
    if (!amountCents || amountCents < 100) {
      alert('Amount must be at least $1.00');
      return;
    }
    setGiftBusy(true);
    try {
      const res = await api.payments.issueGiftCards({ amountCents, count });
      setIssuedCodes(res.codes || []);
    } catch (err) {
      alert(`Could not issue gift cards: ${err.message}`);
    } finally {
      setGiftBusy(false);
    }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  const pendingCount = payouts.filter((p) => p.status === 'pending').length;
  const paidOut = payouts.filter((p) => p.status === 'completed').reduce((s, p) => s + (p.amount_cents || 0), 0);

  const visiblePayouts = filter === 'all' ? payouts : payouts.filter((p) => p.status === filter);

  return (
    <div className="admin-payouts">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Payout Management</h1>
          <p>Approve payouts, confirm manual funds, and issue gift cards</p>
        </div>
        <button className="btn-primary" onClick={() => { setIssuedCodes([]); setShowGiftModal(true); }}>
          Issue Gift Card
        </button>
      </div>

      <div className="tx-stats-grid">
        <div className="tx-stat-card">
          <div className="tx-stat-icon warning">
            <AlertIcon size={24} />
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{pendingCount}</span>
            <span className="tx-stat-label">Pending Payouts</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon">
            <DollarIcon size={24} />
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{fmt(paidOut)}</span>
            <span className="tx-stat-label">Total Paid Out</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon blue">
            <DownloadIcon size={24} />
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{awaiting.length}</span>
            <span className="tx-stat-label">Awaiting Funds</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon success">
            <CheckIcon size={24} />
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{payouts.length}</span>
            <span className="tx-stat-label">Total Requests</span>
          </div>
        </div>
      </div>

      <div className="payout-section">
        <div className="payout-section-header">
          <h2>Awaiting Funds (Bank / Crypto)</h2>
          <p>Confirm when the buyer's bank transfer or crypto payment arrives</p>
        </div>
        {awaiting.length === 0 ? (
          <div className="empty-state">
            <DollarIcon size={48} />
            <h3>Nothing awaiting payment</h3>
            <p>Bank and crypto payments will appear here once a buyer starts checkout</p>
          </div>
        ) : (
          <div className="transactions-table-container">
            <table className="transactions-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {awaiting.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      <span className="tx-item">{tx.item_title || tx.id.slice(0, 8)}</span>
                    </td>
                    <td>
                      <span className="tx-amount">{fmt(Math.round((tx.amount || 0) * 100))}</span>
                    </td>
                    <td><span className="tx-fee">{tx.method}</span></td>
                    <td><span className="tx-id">{tx.provider_ref || '-'}</span></td>
                    <td>{tx.created_at || ''}</td>
                    <td>
                      <button
                        className="btn-primary btn-sm"
                        disabled={busy === `fund-${tx.id}`}
                        onClick={() => handleConfirmFunds(tx.id)}
                      >
                        <CheckIcon size={16} />
                        {busy === `fund-${tx.id}` ? 'Confirming...' : 'Confirm Funds'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="payout-section">
        <div className="payout-section-header payout-section-header--row">
          <div>
            <h2>Payout Requests</h2>
            <p>Review and process seller withdrawal requests</p>
          </div>
          <div className="filter-group">
            {['all', 'pending', 'approved', 'completed', 'rejected', 'cancelled'].map((f) => (
              <button key={f} className={`filter-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="empty-state">
            <p>Loading...</p>
          </div>
        ) : visiblePayouts.length === 0 ? (
          <div className="empty-state">
            <DollarIcon size={48} />
            <h3>No payout requests</h3>
            <p>Seller payout requests will appear here</p>
          </div>
        ) : (
          <div className="transactions-table-container">
            <table className="transactions-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Details</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visiblePayouts.map((p) => {
                  const meta = STATUS_META[p.status] || { label: p.status, cls: '' };
                  let details = {};
                  try { details = JSON.parse(p.method_details || '{}'); } catch {}
                  const detailText = Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(' · ');
                  return (
                    <tr key={p.id}>
                      <td><span className="tx-id">{p.user_id.slice(0, 12)}</span></td>
                      <td><span className="tx-amount">{fmt(p.amount_cents)}</span></td>
                      <td><span className="tx-fee">{p.method}</span></td>
                      <td className="payout-details-cell">{detailText || '-'}</td>
                      <td><span className={`status-badge ${meta.cls}`}>{meta.label}</span></td>
                      <td>{p.created_at || ''}</td>
                      <td>
                        <div className="payout-actions">
                          {p.status === 'pending' && (
                            <>
                              <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => handleStatus(p.id, 'approved')}>
                                Approve
                              </button>
                              <button className="btn-primary btn-sm btn-success" disabled={!!busy} onClick={() => handleStatus(p.id, 'completed')}>
                                <CheckIcon size={16} />
                                Pay
                              </button>
                              <button className="btn-danger btn-sm" disabled={!!busy} onClick={() => handleStatus(p.id, 'rejected')}>
                                <BanIcon size={16} />
                                Reject
                              </button>
                            </>
                          )}
                          {p.status === 'approved' && (
                            <button className="btn-primary btn-sm btn-success" disabled={!!busy} onClick={() => handleStatus(p.id, 'completed')}>
                              <CheckIcon size={16} />
                              Mark Paid
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showGiftModal && (
        <div className="gift-modal-overlay" onClick={() => { if (!giftBusy) setShowGiftModal(false); }}>
          <div className="gift-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gift-modal-header">
              <h3>Issue Gift Card</h3>
              <button className="gift-modal-close" onClick={() => { if (!giftBusy) setShowGiftModal(false); }}>×</button>
            </div>
            {issuedCodes.length === 0 ? (
              <div className="gift-modal-body">
                <label className="gift-label">Amount (USD)</label>
                <input
                  type="number"
                  className="gift-input"
                  min="1"
                  value={giftAmount}
                  onChange={(e) => setGiftAmount(e.target.value)}
                />
                <label className="gift-label">Number of codes</label>
                <input
                  type="number"
                  className="gift-input"
                  min="1"
                  max="100"
                  value={giftCount}
                  onChange={(e) => setGiftCount(e.target.value)}
                />
                <button className="btn-primary gift-issue-btn" disabled={giftBusy} onClick={handleIssueGiftCards}>
                  {giftBusy ? 'Generating...' : 'Generate Codes'}
                </button>
              </div>
            ) : (
              <div className="gift-modal-body">
                <p className="gift-note">
                  {issuedCodes.length} code{issuedCodes.length > 1 ? 's' : ''} issued at {fmt(parseFloat(giftAmount || '0') * 100)} each. Share securely — redeemed once.
                </p>
                <div className="gift-codes">
                  {issuedCodes.map((code) => (
                    <div key={code} className="gift-code-row">
                      <span className="gift-code">{code}</span>
                      <button className="btn-secondary btn-sm" onClick={() => copyCode(code)}>
                        {copied === code ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  ))}
                </div>
                <button className="btn-primary gift-issue-btn" onClick={() => { setIssuedCodes([]); setShowGiftModal(false); }}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
