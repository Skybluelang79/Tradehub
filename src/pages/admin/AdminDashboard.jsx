import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { api } from '../../services/client';
import './AdminDashboard.css';

const fmtMoney = (v) => {
  const n = Number(v || 0);
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const fmtCentsMoney = (v) => fmtMoney((v || 0) / 100);

const AdminDashboard = ({ onNavigate }) => {
  const { adminToken } = useAdmin();
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!adminToken) return;
    let cancelled = false;
    api.admin.dashboard()
      .then((r) => { if (!cancelled) setData(r); })
      .catch((err) => { if (!cancelled) addToast(err.message || 'Failed to load dashboard', 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [adminToken, addToast]);

  useEffect(load, [load]);

  const moderationAction = async (fn, message) => {
    try {
      await fn();
      addToast(message, 'success');
      load();
    } catch (err) {
      addToast(err.message || 'Action failed', 'error');
    }
  };

  const stats = useMemo(() => {
    const s = data?.stats || {};
    return [
      { label: 'Users', value: (s.totalUsers || 0).toLocaleString(), icon: 'users', color: '#3B82F6' },
      { label: 'Active Listings', value: (s.activeItems || 0).toLocaleString(), icon: 'package', color: '#10B981' },
      { label: 'Transactions', value: (s.totalTransactions || 0).toLocaleString(), icon: 'dollar', color: '#F59E0B' },
      { label: 'Revenue', value: fmtMoney(s.totalRevenue), icon: 'chart', color: '#8B5CF6' },
      { label: 'Platform Fees', value: fmtMoney(s.totalFees), icon: 'fee', color: '#EC4899' },
      { label: 'Paid Out', value: fmtCentsMoney(s.paidOut), icon: 'payout', color: '#06B6D4' },
    ];
  }, [data]);

  const revenueMax = useMemo(() => Math.max(...(data?.revenueByDay || []).map((r) => Number(r.revenue)), 1), [data]);
  const signupMax = useMemo(() => Math.max(...(data?.userSignupsByDay || []).map((r) => Number(r.count)), 1), [data]);
  const catMax = useMemo(() => Math.max(...(data?.topCategories || []).map((c) => c.count), 1), [data]);

  const transactionStatus = (status) => {
    const map = { pending: 'pending', completed: 'completed', refunded: 'refunded', awaiting_payment: 'pending' };
    return map[status] || 'pending';
  };

  if (loading && !data) {
    return (
      <div className="admin-dashboard">
        <div className="admin-dashboard-header"><div><h1>Dashboard</h1><p>Loading real-time metrics…</p></div></div>
        <div className="empty-state">Loading dashboard…</div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p>Real-time overview of your marketplace</p>
        </div>
        <div className="header-actions">
          <span className="live-badge">
            <span className="live-dot" />
            Live
          </span>
        </div>
      </div>

      <div className="stats-grid">
        {stats.map((stat, index) => (
          <div key={stat.label} className="stat-card" style={{ animationDelay: `${index * 0.05}s` }}>
            <div className="stat-icon" style={{ backgroundColor: `${stat.color}18`, color: stat.color }}>
              {stat.icon === 'users' && (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              )}
              {stat.icon === 'package' && (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.29 7 12 12 20.71 7" />
                  <line x1="12" y1="22" x2="12" y2="12" />
                </svg>
              )}
              {stat.icon === 'dollar' && (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              )}
              {stat.icon === 'chart' && (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              )}
              {stat.icon === 'fee' && (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M15 9.354a4 4 0 1 0 0 5.292" />
                </svg>
              )}
              {stat.icon === 'payout' && (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
              )}
            </div>
            <div className="stat-info">
              <span className="stat-value">{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card chart-card">
          <div className="card-header">
            <h3>Revenue (last 30 days)</h3>
            <span className="card-badge">{(data?.stats?.totalTransactions || 0).toLocaleString()} total txns</span>
          </div>
          <div className="chart-container">
            {data?.revenueByDay?.length ? (
              <div className="bar-chart">
                {data.revenueByDay.slice(-14).map((item, index) => (
                  <div key={item.date} className="bar-item" title={`${item.date}: ${fmtMoney(item.revenue)}`}>
                    <div className="bar" style={{ height: `${(item.revenue / revenueMax) * 100}%`, animationDelay: `${index * 0.05}s` }}>
                      <span className="bar-value">{fmtMoney(item.revenue)}</span>
                    </div>
                    <span className="bar-label">{item.date ? new Date(item.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : ''}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No revenue yet</div>
            )}
          </div>
        </div>

        <div className="dashboard-card chart-card">
          <div className="card-header">
            <h3>New Users (last 30 days)</h3>
            <span className="card-badge">{data?.stats?.totalUsers || 0} total</span>
          </div>
          <div className="chart-container">
            {data?.userSignupsByDay?.length ? (
              <div className="bar-chart">
                {data.userSignupsByDay.slice(-14).map((item, index) => (
                  <div key={item.date} className="bar-item" title={`${item.date}: ${item.count}`}>
                    <div className="bar user-bar" style={{ height: `${(item.count / signupMax) * 100}%`, animationDelay: `${index * 0.05}s` }}>
                      <span className="bar-value">{item.count}</span>
                    </div>
                    <span className="bar-label">{item.date ? new Date(item.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : ''}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No signups yet</div>
            )}
          </div>
        </div>

        <div className="dashboard-card chart-card">
          <div className="card-header">
            <h3>Categories</h3>
            <span className="card-badge">{data?.topCategories?.length || 0}</span>
          </div>
          <div className="chart-container category-container">
            {data?.topCategories?.length ? (
              <div className="category-list">
                {data.topCategories.map((cat, i) => (
                  <div key={cat.category} className="category-row">
                    <div className="category-row-header">
                      <span className="category-name">{cat.category}</span>
                      <span className="category-count">{cat.count}</span>
                    </div>
                    <div className="category-bar-track">
                      <div
                        className="category-bar-fill"
                        style={{
                          width: `${(cat.count / catMax) * 100}%`,
                          animationDelay: `${i * 0.06}s`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">No active items yet</div>
            )}
          </div>
        </div>

        <div className="dashboard-card chart-card">
          <div className="card-header">
            <h3>Health Checks</h3>
            <span className="card-badge">{data?.stats?.openDisputes || 0} disputes</span>
          </div>
          <div className="chart-container health-container">
            <div className="health-row">
              <span>Pending reports</span>
              <strong>{data?.stats?.pendingReports || 0}</strong>
            </div>
            <div className="health-row">
              <span>Open disputes</span>
              <strong>{data?.stats?.openDisputes || 0}</strong>
            </div>
            <div className="health-row">
              <span>Pending payouts</span>
              <strong>{fmtCentsMoney(data?.stats?.pendingPayouts)}</strong>
            </div>
            <div className="health-row">
              <span>Active wallets</span>
              <strong>{data?.stats?.activeWallets || 0}</strong>
            </div>
            <div className="health-row">
              <span>Gift cards issued</span>
              <strong>{data?.stats?.giftCardsIssued || 0} ({data?.stats?.giftCardsRedeemed || 0} redeemed)</strong>
            </div>
          </div>
        </div>

        <div className="dashboard-card moderation-card">
          <div className="card-header">
            <h3>Moderation Queue</h3>
            <span className="card-badge">
              {(data?.stats?.pendingReports || 0) + (data?.stats?.openDisputes || 0) + (data?.stats?.flaggedListings || 0)} items
            </span>
          </div>
          <div className="moderation-list">
            {(data?.recentPendingReports?.length || data?.recentFlagged?.length || data?.recentDisputes?.length) === 0 && (
              <div className="empty-state">Queue is clear</div>
            )}

            {data?.recentFlagged?.map((item) => (
              <div key={`flag-${item.id}`} className="moderation-item">
                <div className="moderation-info">
                  <span className="moderation-title">{item.title}</span>
                  <span className="moderation-meta">Flagged · {fmtMoney(item.price)}</span>
                </div>
                <div className="moderation-actions">
                  <button
                    className="moderation-btn approve"
                    onClick={() => moderationAction(() => api.admin.updateListingStatus(item.id, 'active'), 'Listing approved')}
                  >
                    Approve
                  </button>
                  <button
                    className="moderation-btn remove"
                    onClick={() => moderationAction(() => api.admin.updateListingStatus(item.id, 'removed'), 'Listing removed')}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}

            {data?.recentPendingReports?.map((report) => (
              <div key={`report-${report.type}-${report.id}`} className="moderation-item">
                <div className="moderation-info">
                  <span className="moderation-title">{report.target}</span>
                  <span className="moderation-meta">{report.type} report · {report.reason}</span>
                </div>
                <button
                  className="moderation-btn clear"
                  onClick={() => moderationAction(() => api.admin.resolveReport(report.id, 'dismiss'), 'Report dismissed')}
                >
                  Clear
                </button>
              </div>
            ))}

            {data?.recentDisputes?.map((dispute) => (
              <div key={`dispute-${dispute.id}`} className="moderation-item">
                <div className="moderation-info">
                  <span className="moderation-title">{dispute.item_title || 'Dispute'}</span>
                  <span className="moderation-meta">Dispute · {dispute.reason}</span>
                </div>
                <span className="moderation-open">Open</span>
              </div>
            ))}
          </div>
          <div className="moderation-footer">
            <button className="moderation-link" onClick={() => onNavigate && onNavigate('/admin/reports')}>View reports</button>
            <button className="moderation-link" onClick={() => onNavigate && onNavigate('/admin/listings')}>View listings</button>
            <button className="moderation-link" onClick={() => onNavigate && onNavigate('/admin/disputes')}>View disputes</button>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="card-header">
            <h3>Recent Transactions</h3>
          </div>
          <div className="transaction-list">
            {data?.recentTransactions?.length === 0 && <div className="empty-state">No transactions yet</div>}
            {data?.recentTransactions?.map((tx) => (
              <div key={tx.id} className="transaction-item">
                <div className="transaction-info">
                  <span className="transaction-item-name">{tx.item_title}</span>
                  <span className="transaction-meta">
                    {tx.buyer_name || tx.buyer_id} → {tx.seller_name || tx.seller_id}
                  </span>
                </div>
                <div className="transaction-details">
                  <span className="transaction-amount">{fmtMoney(tx.amount)}</span>
                  <span className={`transaction-status ${transactionStatus(tx.status)}`}>{tx.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-card">
          <div className="card-header">
            <h3>Top Viewed Items</h3>
            <span className="card-badge">{data?.topViewedItems?.length || 0}</span>
          </div>
          <div className="top-items-list">
            {data?.topViewedItems?.length === 0 && <div className="empty-state">No items yet</div>}
            {data?.topViewedItems?.map((item, i) => (
              <div key={item.id} className="top-item-row">
                <span className="top-item-rank">#{i + 1}</span>
                <div className="top-item-info">
                  <span className="top-item-title">{item.title}</span>
                  <span className="top-item-meta">{fmtMoney(item.price)} · {item.views || 0} views</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="quick-stats">
        <div className="quick-stat-card">
          <h4>Total Views</h4>
          <span className="quick-stat-value">{(data?.stats?.totalViews || 0).toLocaleString()}</span>
        </div>
        <div className="quick-stat-card">
          <h4>Active Items</h4>
          <span className="quick-stat-value">{data?.stats?.activeItems || 0}</span>
        </div>
        <div className="quick-stat-card">
          <h4>Categories</h4>
          <span className="quick-stat-value">{data?.topCategories?.length || 0}</span>
        </div>
        <div className="quick-stat-card">
          <h4>Platform Fees</h4>
          <span className="quick-stat-value">{fmtMoney(data?.stats?.totalFees)}</span>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
