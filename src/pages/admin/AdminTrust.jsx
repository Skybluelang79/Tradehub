import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { api } from '../../services/client';
import { AlertIcon, BanIcon, CheckIcon, ShieldIcon } from './Icons.jsx';
import './AdminTransactions.css';
import './AdminPayouts.css';

const displayDate = (value) => {
  if (!value) return '—';
  const normalized = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};

const statusClass = (status) => {
  if (['completed', 'approved', 'upheld', 'resolved'].includes(status)) return 'status-completed';
  if (['declined', 'rejected', 'overturned', 'refunded'].includes(status)) return 'status-refunded';
  return 'status-pending';
};

export default function AdminTrust() {
  const { isAdminAuth } = useAdmin();
  const [tab, setTab] = useState('appeals');
  const [data, setData] = useState({ appeals: [], returns: [], strikes: [], events: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [strikeForm, setStrikeForm] = useState({ userId: '', reason: '', severity: 'low', description: '' });

  const refresh = useCallback(async () => {
    if (!isAdminAuth) {
      window.dispatchEvent(new CustomEvent('adminSessionExpired'));
      return;
    }
    setLoading(true);
    try {
      const [appeals, returns, strikes, events] = await Promise.allSettled([
        api.admin.appeals(),
        api.admin.returns(),
        api.admin.strikes(),
        api.admin.paymentEvents(),
      ]);
      setData({
        appeals: appeals.status === 'fulfilled' ? appeals.value.appeals || [] : [],
        returns: returns.status === 'fulfilled' ? returns.value.returns || [] : [],
        strikes: strikes.status === 'fulfilled' ? strikes.value.strikes || [] : [],
        events: events.status === 'fulfilled' ? events.value.events || [] : [],
      });
    } finally {
      setLoading(false);
    }
  }, [isAdminAuth]);

  useEffect(() => { refresh(); }, [refresh]);

  const resolveAppeal = async (id, action) => {
    setBusy(`${action}-${id}`);
    try {
      await api.admin.resolveAppeal(id, { action, note: '' });
      await refresh();
    } finally {
      setBusy('');
    }
  };

  const createStrike = async (e) => {
    e.preventDefault();
    if (!strikeForm.userId || !strikeForm.reason) return;
    setBusy('create-strike');
    try {
      await api.admin.createStrike(strikeForm);
      setStrikeForm({ userId: '', reason: '', severity: 'low', description: '' });
      await refresh();
    } finally {
      setBusy('');
    }
  };

  const pendingAppeals = data.appeals.filter((appeal) => appeal.status === 'pending');
  const openReturns = data.returns.filter((item) => ['requested', 'approved'].includes(item.status));

  return (
    <div className="admin-payouts">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Trust &amp; Safety</h1>
          <p>Review appeals, returns, strikes, and payment security events</p>
        </div>
      </div>

      <div className="tx-stats-grid">
        <div className="tx-stat-card">
          <div className="tx-stat-icon warning"><AlertIcon size={24} /></div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{pendingAppeals.length}</span>
            <span className="tx-stat-label">Pending Appeals</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon"><ShieldIcon size={24} /></div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{openReturns.length}</span>
            <span className="tx-stat-label">Open Returns</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon warning"><BanIcon size={24} /></div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{data.strikes.filter((strike) => ['active', 'appealed'].includes(strike.status)).length}</span>
            <span className="tx-stat-label">Active Strikes</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon success"><CheckIcon size={24} /></div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{data.events.length}</span>
            <span className="tx-stat-label">Payment Events</span>
          </div>
        </div>
      </div>

      <div className="payout-actions" style={{ margin: '16px 0' }}>
        {[
          ['appeals', 'Appeals'],
          ['returns', 'Returns'],
          ['strikes', 'Strikes'],
          ['events', 'Payment Events'],
        ].map(([key, label]) => (
          <button key={key} className={`btn-sm ${tab === key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'strikes' && (
        <form className="admin-filter-bar" style={{ gap: 8, marginBottom: 16 }} onSubmit={createStrike}>
          <input
            className="gift-input"
            placeholder="User ID"
            value={strikeForm.userId}
            onChange={(e) => setStrikeForm({ ...strikeForm, userId: e.target.value })}
          />
          <input
            className="gift-input"
            placeholder="Reason"
            value={strikeForm.reason}
            onChange={(e) => setStrikeForm({ ...strikeForm, reason: e.target.value })}
          />
          <select
            className="gift-input"
            value={strikeForm.severity}
            onChange={(e) => setStrikeForm({ ...strikeForm, severity: e.target.value })}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button className="btn-sm btn-primary" type="submit" disabled={!!busy || !strikeForm.userId || !strikeForm.reason}>
            Issue strike
          </button>
        </form>
      )}

      <div className="admin-table-wrap">
        {loading ? (
          <div className="empty-state">Loading trust data…</div>
        ) : !data[tab].length ? (
          <div className="empty-state">
            <h3 className="empty-title">Nothing here</h3>
            <p className="empty-text">Trust records will appear as activity happens.</p>
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                {tab === 'appeals' && <th>Strike</th>}
                {tab === 'returns' && <th>Order</th>}
                {tab === 'strikes' && <th>User</th>}
                {tab === 'events' && <th>Event</th>}
                <th>Status / Detail</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data[tab].map((row) => (
                <tr key={row.id}>
                  {tab === 'appeals' && (
                    <td>
                      <strong>{row.strike_reason || 'Strike appeal'}</strong>
                      <div className="listing-seller">{row.reason}</div>
                    </td>
                  )}
                  {tab === 'returns' && (
                    <td>
                      <strong>{row.item_title || row.transaction_id}</strong>
                      <div className="listing-seller">{row.rma_number}</div>
                    </td>
                  )}
                  {tab === 'strikes' && (
                    <td>
                      <strong>{row.user_id}</strong>
                      <div className="listing-seller">{row.reason}</div>
                    </td>
                  )}
                  {tab === 'events' && (
                    <td>
                      <strong>{row.event_type}</strong>
                      <div className="listing-seller">{row.message || row.txn_id}</div>
                    </td>
                  )}
                  <td><span className={`status-badge ${statusClass(row.status || row.level)}`}>{row.status || row.level || '—'}</span></td>
                  <td>{displayDate(row.created_at)}</td>
                  <td>
                    {tab === 'appeals' && row.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-sm btn-success" disabled={!!busy} onClick={() => resolveAppeal(row.id, 'approve')}>Approve</button>
                        <button className="btn-sm btn-danger" disabled={!!busy} onClick={() => resolveAppeal(row.id, 'reject')}>Reject</button>
                      </div>
                    )}
                    {tab !== 'appeals' && '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
