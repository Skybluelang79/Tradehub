import { useState } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { SearchIcon, DownloadIcon, FilterIcon, DollarIcon } from './Icons.jsx';
import './AdminTransactions.css';

const AdminTransactions = () => {
  const { transactions } = useAdmin();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('date');

  const filteredTransactions = transactions.filter(tx => {
    const matchesSearch = tx.item.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          tx.buyer.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          tx.seller.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || tx.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const totalAmount = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const totalFees = transactions.reduce((sum, tx) => sum + tx.fee, 0);
  const completedTx = transactions.filter(tx => tx.status === 'completed').length;
  const pendingTx = transactions.filter(tx => tx.status === 'pending').length;

  const getStatusBadge = (status) => {
    const classes = {
      completed: 'status-completed',
      pending: 'status-pending',
      refunded: 'status-refunded'
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
        <button className="btn-secondary">
          <DownloadIcon size={16} />
          Export
        </button>
      </div>

      <div className="tx-stats-grid">
        <div className="tx-stat-card">
          <div className="tx-stat-icon">
            <DollarIcon size={24} />
          </div>
          <div className="tx-stat-info">
            <span className="tx-stat-value">${totalAmount.toLocaleString()}</span>
            <span className="tx-stat-label">Total Volume</span>
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
            <span className="tx-stat-label">Platform Fees</span>
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
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <button 
            className={`filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            All
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'completed' ? 'active' : ''}`}
            onClick={() => setFilterStatus('completed')}
          >
            Completed
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'pending' ? 'active' : ''}`}
            onClick={() => setFilterStatus('pending')}
          >
            Pending
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'refunded' ? 'active' : ''}`}
            onClick={() => setFilterStatus('refunded')}
          >
            Refunded
          </button>
        </div>
        <select 
          className="sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="date">Sort by Date</option>
          <option value="amount">Sort by Amount</option>
          <option value="status">Sort by Status</option>
        </select>
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
            {filteredTransactions.map(tx => (
              <tr key={tx.id}>
                <td>
                  <span className="tx-id">#{tx.id.toString().padStart(4, '0')}</span>
                </td>
                <td>
                  <span className="tx-item">{tx.item}</span>
                </td>
                <td>{tx.buyer}</td>
                <td>{tx.seller}</td>
                <td>
                  <span className="tx-amount">${tx.amount.toLocaleString()}</span>
                </td>
                <td>
                  <span className="tx-fee">${tx.fee.toFixed(2)}</span>
                </td>
                <td>
                  <span className={`status-badge ${getStatusBadge(tx.status)}`}>
                    {tx.status}
                  </span>
                </td>
                <td>{tx.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredTransactions.length === 0 && (
        <div className="empty-state">
          <DollarIcon size={48} />
          <h3>No transactions found</h3>
          <p>Try adjusting your search or filter criteria</p>
        </div>
      )}
    </div>
  );
};

export default AdminTransactions;
