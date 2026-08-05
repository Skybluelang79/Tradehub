import { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { api } from '../../services/client';
import { AlertIcon, CheckIcon, BanIcon, ShieldIcon, DollarIcon } from './Icons.jsx';
import './AdminTransactions.css';
import './AdminPayouts.css';

const fmt = (amount) => `$${Number(amount || 0).toFixed(2)}`;

const STATUS_META = {
  open: { label: 'Open', cls: 'status-pending' },
  resolved: { label: 'Resolved', cls: 'status-completed' },
};

const TxnBadge = ({ status }) => {
  const meta = {
    pending: { label: 'Escrow', cls: 'status-pending' },
    awaiting_payment: { label: 'Awaiting Payment', cls: 'status-pending' },
    completed: { label: 'Completed', cls: 'status-completed' },
    disputed: { label: 'Disputed', cls: 'status-refunded' },
    refunded: { label: 'Refunded', cls: 'status-refunded' },
  }[status] || { label: status, cls: 'status-pending' };
  return <span className={`status-badge ${meta.cls}`}>{meta.label}</span>;
};

export default function AdminDisputes() {
  const { isAdminAuth } = useAdmin();
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [resolveAction, setResolveAction] = useState('refund_buyer');
  const [resolveNote, setResolveNote] = useState('');

  const refresh = useCallback(async () => {
    if (!isAdminAuth) return;
    setLoading(true);
    try {
      const r = await api.disputes.all();
      setDisputes(r.disputes || []);
    } catch (err) {
      console.error('Failed to load disputes:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdminAuth]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleResolve = async () => {
    if (!selected) return;
    setBusy(`resolve-${selected.id}`);
    try {
      await api.disputes.resolve(selected.id, { action: resolveAction, resolution: resolveNote });
      setSelected(null);
      setResolveNote('');
      await refresh();
    } catch (err) {
      alert(`Could not resolve dispute: ${err.message || 'unknown error'}`);
    } finally {
      setBusy('');
    }
  };

  const openCount = disputes.filter((d) => d.status === 'open').length;
  const visible = filter === 'all' ? disputes : disputes.filter((d) => d.status === filter);

  return (
    <div className="admin-payouts">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Dispute Resolution</h1>
          <p>Review disputes and release funds or refund buyers</p>
        </div>
      </div>

      <div className="tx-stats-grid">
        <div className="tx-stat-card">
          <div className="tx-stat-icon warning">
            <AlertIcon size={24} />
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{openCount}</span>
            <span className="tx-stat-label">Open Disputes</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon">
            <ShieldIcon size={24} />
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{disputes.length}</span>
            <span className="tx-stat-label">Total Disputes</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon success">
            <DollarIcon size={24} />
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">
              {fmt(disputes.filter((d) => d.status === 'open').reduce((s, d) => s + (d.amount || 0), 0))}
            </span>
            <span className="tx-stat-label">In Review</span>
          </div>
        </div>
      </div>

      <div className="payout-actions" style={{ margin: '16px 0' }}>
        {['all', 'open', 'resolved'].map((s) => (
          <button
            key={s}
            className={`btn-sm ${filter === s ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="admin-table-wrap">
        {loading ? (
          <div className="empty-state">Loading disputes…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-title">No disputes</h3>
            <p className="empty-text">Disputes opened by buyers or sellers will appear here</p>
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Amount</th>
                <th>Opened By</th>
                <th>Buyer → Seller</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => (
                <tr key={d.id}>
                  <td className="gc-code-cell">{d.item_title}</td>
                  <td>{fmt(d.amount)}</td>
                  <td>{d.opener_name || d.opened_by}</td>
                  <td>{d.buyer_name || d.buyer_id} → {d.seller_name || d.seller_id}</td>
                  <td className="gc-design-note" title={d.description}>{d.reason}</td>
                  <td>
                    <span className={`status-badge ${(STATUS_META[d.status] || {}).cls}`}>
                      {(STATUS_META[d.status] || {}).label || d.status}
                    </span>
                    <TxnBadge status={d.txn_status} />
                  </td>
                  <td>{d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}</td>
                  <td>
                    <div className="payout-actions">
                      {d.status === 'open' && (
                        <button className="btn-sm btn-primary" disabled={!!busy} onClick={() => { setSelected(d); setResolveAction('refund_buyer'); setResolveNote(''); }}>
                          <CheckIcon size={14} /> Resolve
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="gift-modal-overlay" onClick={() => { if (!busy) setSelected(null); }}>
          <div className="gift-modal gc-brand-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gift-modal-header">
              <h3>Resolve Dispute</h3>
              <button className="gift-modal-close" onClick={() => { if (!busy) setSelected(null); }}>×</button>
            </div>
            <div className="gift-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>{selected.item_title}</strong> · {fmt(selected.amount)} ·
                Buyer: {selected.buyer_name || selected.buyer_id} · Seller: {selected.seller_name || selected.seller_id}
              </p>
              <div>
                <label className="gift-label">Reason</label>
                <div style={{ fontSize: 13, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <strong>{selected.reason}</strong>
                  {selected.description && <p style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{selected.description}</p>}
                </div>
              </div>
              <div>
                <label className="gift-label">Decision</label>
                <select className="input" value={resolveAction} onChange={(e) => setResolveAction(e.target.value)} style={{ width: '100%' }}>
                  <option value="refund_buyer">Refund the buyer (return to escrow → buyer balance)</option>
                  <option value="release_seller">Release payment to the seller</option>
                </select>
              </div>
              <div>
                <label className="gift-label">Resolution note</label>
                <textarea
                  className="input"
                  rows="2"
                  style={{ width: '100%' }}
                  placeholder="Optional note for the record…"
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                />
              </div>
              <div className="payout-actions" style={{ justifyContent: 'flex-end' }}>
                <button className="btn-sm btn-secondary" disabled={!!busy} onClick={() => setSelected(null)}>
                  Cancel
                </button>
                <button className="btn-sm btn-primary" disabled={!!busy} onClick={handleResolve}>
                  {resolveAction === 'refund_buyer' ? <BanIcon size={14} /> : <CheckIcon size={14} />}
                  {busy ? 'Resolving…' : resolveAction === 'refund_buyer' ? 'Refund Buyer' : 'Release to Seller'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
