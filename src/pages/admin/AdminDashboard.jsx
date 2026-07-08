import { useMemo } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { useApp } from '../../context';
import './AdminDashboard.css';

const AdminDashboard = () => {
  const { adminStats, analyticsData, transactions: adminTxns, reports } = useAdmin();
  const { items, users: appUsers, transactions: appTxns, currentUser } = useApp();

  const realItems = useMemo(() => items.filter(i => i.status === 'active'), [items]);
  const totalItemsValue = useMemo(() => realItems.reduce((s, i) => s + i.price, 0), [realItems]);

  const stats = useMemo(() => [
    { label: 'Users', value: appUsers.length + 8, icon: 'users', color: '#3B82F6', change: `+${appUsers.length + 2}%` },
    { label: 'Active Listings', value: realItems.length, icon: 'package', color: '#10B981', change: `+${Math.round(realItems.length * 1.5)}%` },
    { label: 'Transactions', value: appTxns.length + adminTxns.length, icon: 'dollar', color: '#F59E0B', change: `+${Math.round((appTxns.length + adminTxns.length) * 0.8)}%` },
    { label: 'Inventory Value', value: `$${(totalItemsValue / 1000).toFixed(1)}k`, icon: 'chart', color: '#8B5CF6', change: `+${Math.round(totalItemsValue / 10000)}%` },
  ], [appUsers, realItems, appTxns, adminTxns, totalItemsValue]);

  const activeTransactions = useMemo(
    () => [...appTxns.map(t => ({ ...t, isReal: true })), ...adminTxns.map(t => ({ ...t, isReal: false }))]
      .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date))
      .slice(0, 5),
    [appTxns, adminTxns]
  );

  const topItems = useMemo(
    () => [...items].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5),
    [items]
  );

  const pendingReports = useMemo(() => reports.filter(r => r.status === 'pending'), [reports]);

  const categoryData = useMemo(() => {
    const map = {};
    realItems.forEach(i => { map[i.category] = (map[i.category] || 0) + 1; });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [realItems]);

  const maxCategoryCount = Math.max(...categoryData.map(c => c.count), 1);

  const quickActions = [
    { label: 'Add User', icon: 'userPlus', desc: 'Create a new account' },
    { label: 'Export Data', icon: 'download', desc: 'CSV report' },
    { label: 'Send Notification', icon: 'bell', desc: 'Push to all users' },
    { label: 'System Health', icon: 'activity', desc: 'All systems normal' },
  ];

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
          <select className="card-select">
            <option>Last 30 days</option>
            <option>This quarter</option>
            <option>All time</option>
          </select>
        </div>
      </div>

      <div className="stats-grid">
        {stats.map((stat, index) => (
          <div key={index} className="stat-card" style={{ animationDelay: `${index * 0.05}s` }}>
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
            </div>
            <div className="stat-info">
              <span className="stat-value">{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </div>
            <span className="stat-change positive">{stat.change}</span>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card chart-card">
          <div className="card-header">
            <h3>Revenue</h3>
            <select className="card-select">
              <option>Last 4 months</option>
              <option>Last year</option>
            </select>
          </div>
          <div className="chart-container">
            <div className="bar-chart">
              {analyticsData.revenue.map((item, index) => (
                <div key={index} className="bar-item">
                  <div className="bar" style={{ height: `${(item.amount / 50000) * 100}%`, animationDelay: `${index * 0.08}s` }}>
                    <span className="bar-value">${(item.amount / 1000).toFixed(1)}k</span>
                  </div>
                  <span className="bar-label">{item.month}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dashboard-card chart-card">
          <div className="card-header">
            <h3>User Growth</h3>
            <select className="card-select">
              <option>Last 4 months</option>
              <option>Last year</option>
            </select>
          </div>
          <div className="chart-container">
            <div className="bar-chart">
              {analyticsData.users.map((item, index) => (
                <div key={index} className="bar-item">
                  <div className="bar user-bar" style={{ height: `${(item.count / 20000) * 100}%`, animationDelay: `${index * 0.08}s` }}>
                    <span className="bar-value">{(item.count / 1000).toFixed(1)}k</span>
                  </div>
                  <span className="bar-label">{item.month}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dashboard-card chart-card">
          <div className="card-header">
            <h3>Listings Trend</h3>
            <select className="card-select">
              <option>Last 4 months</option>
              <option>Last year</option>
            </select>
          </div>
          <div className="chart-container">
            <div className="bar-chart">
              {analyticsData.listings.map((item, index) => (
                <div key={index} className="bar-item">
                  <div className="bar listing-bar" style={{ height: `${(item.count / 2500) * 100}%`, animationDelay: `${index * 0.08}s` }}>
                    <span className="bar-value">{item.count}</span>
                  </div>
                  <span className="bar-label">{item.month}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dashboard-card chart-card">
          <div className="card-header">
            <h3>Categories</h3>
            <span className="card-badge">{categoryData.length}</span>
          </div>
          <div className="chart-container category-container">
            {categoryData.length === 0 ? (
              <div className="empty-state">No items yet</div>
            ) : (
              <div className="category-list">
                {categoryData.map((cat, i) => (
                  <div key={cat.name} className="category-row">
                    <div className="category-row-header">
                      <span className="category-name">{cat.name}</span>
                      <span className="category-count">{cat.count}</span>
                    </div>
                    <div className="category-bar-track">
                      <div
                        className="category-bar-fill"
                        style={{
                          width: `${(cat.count / maxCategoryCount) * 100}%`,
                          animationDelay: `${i * 0.06}s`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-card">
          <div className="card-header">
            <h3>Recent Transactions</h3>
            <button className="card-link">View All</button>
          </div>
          <div className="transaction-list">
            {activeTransactions.length === 0 ? (
              <div className="empty-state">No transactions yet</div>
            ) : (
              activeTransactions.map((tx) => (
                <div key={tx.id} className="transaction-item">
                  <div className="transaction-info">
                    <span className="transaction-item-name">{tx.itemTitle || tx.item}</span>
                    <span className="transaction-meta">
                      {tx.type === 'received' ? 'Received' : tx.type === 'sent' ? 'Sent' : ''}
                      {tx.buyer && `${tx.buyer} → ${tx.seller}`}
                    </span>
                  </div>
                  <div className="transaction-details">
                    <span className="transaction-amount">${tx.amount}</span>
                    <span className={`transaction-status ${tx.status}`}>{tx.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="dashboard-card">
          <div className="card-header">
            <h3>Top Viewed Items</h3>
            <span className="card-badge">{topItems.length}</span>
          </div>
          <div className="top-items-list">
            {topItems.length === 0 ? (
              <div className="empty-state">No items yet</div>
            ) : (
              topItems.map((item, i) => (
                <div key={item.id} className="top-item-row">
                  <span className="top-item-rank">#{i + 1}</span>
                  <div className="top-item-info">
                    <span className="top-item-title">{item.title}</span>
                    <span className="top-item-meta">${item.price} · {item.views} views</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="quick-stats">
        <div className="quick-stat-card">
          <h4>Active Items</h4>
          <span className="quick-stat-value">{realItems.length}</span>
        </div>
        <div className="quick-stat-card">
          <h4>Categories</h4>
          <span className="quick-stat-value">{categoryData.length}</span>
        </div>
        <div className="quick-stat-card">
          <h4>Total Views</h4>
          <span className="quick-stat-value">{items.reduce((s, i) => s + (i.views || 0), 0)}</span>
        </div>
        <div className="quick-stat-card">
          <h4>Avg. Price</h4>
          <span className="quick-stat-value">
            ${realItems.length ? Math.round(items.reduce((s, i) => s + i.price, 0) / items.length) : 0}
          </span>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
