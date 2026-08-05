import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/client.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { SearchIcon, DownloadIcon, DollarIcon } from './Icons.jsx';
import './AdminTransactions.css';

const TX_FILTERS = ['all', 'completed', 'pending', 'refunded', 'failed'];

const formatDate = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleString();
};

const AdminTransactions = () => {
  const { addToast } = useToast();
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(false);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.transactions({
        page,
        limit: 20,
        q: searchQuery,
        status: filterStatus,
      });
      setTransactions(data.transactions || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      addToast(err.message || 'Failed to load transactions', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, filterStatus, addToast]);

  useEffect(() => {
    const timer = setTimeout(loadTransactions, 300);
    return () => clearTimeout(timer);
  }, [loadTransactions]);

  const handleExport = () => {
    api.admin.exportCsv('transactions');
    addToast('Export started', 'info');
  };

  const totalAmount = transactions.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  const totalFees = transactions.reduce((sum, tx) => sum + (Number(tx.fee_amount) || 0), 0);
  const completedTx = transactions.filter(tx => tx.status === 'completed').length;
  const pendingTx = transactions.filter(tx => tx.status === 'pending').length;

  const getStatusBadge = (status) => {
    const classes = {
      completed: 'status-completed',
      pending: 'status-pending',
      refunded: 'status-refunded',
      failed: 'status-failed',
      cancelled: 'status-cancelled',
      awaiting_payment: 'status-awaiting-payment'
    };
    return classes[status] || '';
  };

  return (
    <div className="admin-transactions">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Transaction Management</h1>
          <p>Monitor all platform transactions</p>
        </div>
        <button className="btn-secondary" onClick={handleExport}>
          <DownloadIcon size={16} />
          Export CSV
        </button>
      </div>

      <div className="tx-stats-grid">
        <div className="tx-stat-card">
          <div className="tx-stat-icon">
            <DollarIcon size={24} />
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">${totalAmount.toLocaleString()}</span>
            <span className="tx-stat-label">Page Volume</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon success">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">${totalFees.toLocaleString()}</span>
            <span className="tx-stat-label">Page Fees</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon blue">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{completedTx}</span>
            <span className="tx-stat-label">Completed</span>
          </div>
        </div>
        <div className="tx-stat-card">
          <div className="tx-stat-icon warning">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">{pendingTx}</span>
            <span className="tx-stat-label">Pending</span>
          </div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <SearchIcon size={18} />
          <input
            type="text"
            placeholder="Search transactions..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          />
        </div>
        <div className="filter-group">
          {TX_FILTERS.map((status) => (
            <button
              key={status}
              className={`filter-btn ${filterStatus === status ? 'active' : ''}`}
              onClick={() => { setFilterStatus(status); setPage(1); }}
            >
              {status[0].toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="transactions-table-container">
        <table className="transactions-table">
          <thead>
            <tr>
              <th>Transaction ID</th>
              <th>Item</th>
              <th>Buyer</th>
              <th>Seller</th>
              <th>Amount</th>
              <th>Fee</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading && transactions.length === 0 && (
              <tr><td colSpan="8" className="table-empty">Loading transactions...</td></tr>
            )}
            {!loading && transactions.length === 0 && (
              <tr><td colSpan="8" className="table-empty">No transactions found</td></tr>
            )}
            {transactions.map(tx => (
              <tr key={tx.id}>
                <td>
                  <span className="tx-id">#{tx.id.toString().slice(0, 8)}</span>
                </td>
                <td>
                  <span className="tx-item">{tx.item_title}</span>
                </td>
                <td>{tx.buyer_name || '—'}</td>
                <td>{tx.seller_name || '—'}</td>
                <td>
                  <span className="tx-amount">${Number(tx.amount).toLocaleString()}</span>
                </td>
                <td>
                  <span className="tx-fee">${Number(tx.fee_amount).toFixed(2)}</span>
                </td>
                <td>
                  <span className={`status-badge ${getStatusBadge(tx.status)}`}>
                    {tx.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td>{formatDate(tx.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <span>
          Showing {transactions.length} of {total} transactions
        </span>
        <div className="pagination-controls">
          <button
            className="page-btn"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
          >
            Prev
          </button>
          <span className="page-info">Page {page} of {totalPages || 1}</span>
          <button
            className="page-btn"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminTransactions;
