import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/client.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { SearchIcon, BanIcon, CheckIcon, TrashIcon, EyeIcon, DownloadIcon } from './Icons.jsx';
import Modal from '../../components/ui/Modal.jsx';
import './AdminUsers.css';

const formatDate = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
};

const AdminUsers = () => {
  const { addToast } = useToast();
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(false);

  const [selectedUser, setSelectedUser] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [detailLoading, setDetailLoading] = useState(false);

  const [showBanModal, setShowBanModal] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [tempPassword, setTempPassword] = useState(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.users({
        page,
        limit: 20,
        q: searchQuery,
        status: filterStatus,
      });
      setUsers(data.users || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      addToast(err.message || 'Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, filterStatus, addToast]);

  useEffect(() => {
    const timer = setTimeout(loadUsers, 300);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  const openDetail = async (user) => {
    setSelectedUser(user);
    setDetailTab('overview');
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await api.admin.userDetail(user.id);
      setDetail(data);
    } catch (err) {
      addToast(err.message || 'Failed to load user details', 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const runAction = async (fn, successMessage) => {
    try {
      await fn();
      addToast(successMessage, 'success');
      loadUsers();
      return true;
    } catch (err) {
      addToast(err.message || 'Action failed', 'error');
      return false;
    }
  };

  const handleVerify = (user) =>
    runAction(() => api.admin.verifyUser(user.id), `${user.name} verified`);

  const handleStatus = (user, status) =>
    runAction(() => api.admin.updateUserStatus(user.id, status), `${user.name} ${status}`);

  const handleBan = () => {
    if (!selectedUser) return;
    runAction(() => api.admin.updateUserStatus(selectedUser.id, 'banned', banReason.trim()), `${selectedUser.name} banned`);
    setShowBanModal(false);
    setBanReason('');
  };

  const handlePromote = (user) =>
    runAction(() => api.admin.toggleAdmin(user.id), `${user.name} ${user.is_admin ? 'demoted' : 'promoted to admin'}`);

  const handleResetPassword = async (user) => {
    try {
      const data = await api.admin.resetPassword(user.id);
      setTempPassword(data.tempPassword);
      addToast('Password reset', 'success');
    } catch (err) {
      addToast(err.message || 'Failed to reset password', 'error');
    }
  };

  const handleDelete = () => {
    if (!selectedUser) return;
    runAction(() => api.admin.deleteUser(selectedUser.id), `${selectedUser.name} deleted`);
    setShowDeleteModal(false);
    setSelectedUser(null);
  };

  const handleExport = () => {
    api.admin.exportCsv('users');
    addToast('Export started', 'info');
  };

  const getStatusBadge = (status) => {
    const classes = {
      active: 'status-active',
      pending: 'status-pending',
      suspended: 'status-suspended',
      banned: 'status-banned'
    };
    return classes[status] || '';
  };

  const rowStatus = (user) => {
    if (!user.verified) return 'pending';
    return user.status;
  };

  return (
    <div className="admin-users">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>User Management</h1>
          <p>Manage all users on the platform</p>
        </div>
        <button className="btn-secondary" onClick={handleExport}>
          <DownloadIcon />
          Export CSV
        </button>
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <SearchIcon size={18} />
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          />
        </div>
        <div className="filter-group">
          {['all', 'active', 'pending', 'suspended', 'banned'].map((status) => (
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

      <div className="users-table-container">
        <table className="users-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Listings</th>
              <th>Rating</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 && (
              <tr><td colSpan="6" className="table-empty">Loading users...</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan="6" className="table-empty">No users found</td></tr>
            )}
            {users.map(user => (
              <tr key={user.id}>
                <td>
                  <div className="user-cell">
                    <div className="user-avatar">{user.name.charAt(0)}</div>
                    <div className="user-info">
                      <span className="user-name">
                        {user.name}
                        {user.verified && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="#3B82F6">
                            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                        {user.is_admin && <span className="admin-tag">Admin</span>}
                      </span>
                      <span className="user-email">{user.email}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`status-badge ${getStatusBadge(rowStatus(user))}`}>
                    {rowStatus(user)}
                  </span>
                  {user.banned_reason && <span className="banned-reason">{user.banned_reason}</span>}
                </td>
                <td>{user.listing_count}</td>
                <td>
                  <div className="rating-cell">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#FBBF24">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <span>{user.rating > 0 ? Number(user.rating).toFixed(1) : 'N/A'}</span>
                  </div>
                </td>
                <td>{formatDate(user.created_at)}</td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="action-btn view"
                      title="View Details"
                      onClick={() => openDetail(user)}
                    >
                      <EyeIcon />
                    </button>
                    {!user.verified && (
                      <button
                        className="action-btn verify"
                        title="Verify User"
                        onClick={() => handleVerify(user)}
                      >
                        <CheckIcon />
                      </button>
                    )}
                    {user.status === 'active' && (
                      <button
                        className="action-btn suspend"
                        title="Suspend User"
                        onClick={() => handleStatus(user, 'suspended')}
                      >
                        <BanIcon />
                      </button>
                    )}
                    {(user.status === 'suspended' || user.status === 'banned') && (
                      <button
                        className="action-btn activate"
                        title="Activate User"
                        onClick={() => handleStatus(user, 'active')}
                      >
                        <CheckIcon />
                      </button>
                    )}
                    <button
                      className={`action-btn ${user.is_admin ? 'demote' : 'promote'}`}
                      title={user.is_admin ? 'Demote Admin' : 'Promote to Admin'}
                      onClick={() => handlePromote(user)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    </button>
                    <button
                      className="action-btn delete"
                      title="Delete User"
                      onClick={() => {
                        setSelectedUser(user);
                        setShowDeleteModal(true);
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <span>
          Showing {users.length} of {total} users
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

      <Modal
        isOpen={!!selectedUser && !tempPassword}
        onClose={() => setSelectedUser(null)}
        title="User Details"
      >
        {selectedUser && (
          <div className="user-detail-modal">
            <div className="detail-header">
              <div className="detail-avatar">{selectedUser.name.charAt(0)}</div>
              <div>
                <h3>{selectedUser.name}</h3>
                <p className="detail-email">{selectedUser.email}</p>
              </div>
            </div>
            <div className="detail-stats">
              <div className="detail-stat">
                <span className="stat-label">Listings</span>
                <span className="stat-value">{selectedUser.listing_count}</span>
              </div>
              <div className="detail-stat">
                <span className="stat-label">Rating</span>
                <span className="stat-value">{selectedUser.rating > 0 ? Number(selectedUser.rating).toFixed(1) : 'N/A'}</span>
              </div>
              <div className="detail-stat">
                <span className="stat-label">Status</span>
                <span className={`status-badge ${getStatusBadge(rowStatus(selectedUser))}`}>
                  {rowStatus(selectedUser)}
                </span>
              </div>
            </div>

            <div className="detail-actions">
              {!selectedUser.verified && (
                <button className="btn-secondary" onClick={() => handleVerify(selectedUser)}>
                  Verify User
                </button>
              )}
              {selectedUser.status === 'active' && (
                <button className="btn-secondary" onClick={() => handleStatus(selectedUser, 'suspended')}>
                  Suspend
                </button>
              )}
              {selectedUser.status !== 'banned' && (
                <button className="btn-danger" onClick={() => { setShowBanModal(true); }}>
                  Ban
                </button>
              )}
              {(selectedUser.status === 'suspended' || selectedUser.status === 'banned') && (
                <button className="btn-primary" onClick={() => handleStatus(selectedUser, 'active')}>
                  Reactivate
                </button>
              )}
              <button className="btn-secondary" onClick={() => handlePromote(selectedUser)}>
                {selectedUser.is_admin ? 'Demote Admin' : 'Promote to Admin'}
              </button>
              <button className="btn-secondary" onClick={() => handleResetPassword(selectedUser)}>
                Reset Password
              </button>
            </div>

            <div className="detail-tabs">
              {['overview', 'listings', 'transactions', 'reviews'].map((tab) => (
                <button
                  key={tab}
                  className={`detail-tab ${detailTab === tab ? 'active' : ''}`}
                  onClick={() => setDetailTab(tab)}
                >
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className="detail-content">
              {detailLoading && <p className="table-empty">Loading...</p>}
              {!detailLoading && detail && detailTab === 'overview' && (
                <div className="overview-grid">
                  <div className="overview-item"><span>Email</span>{detail.user.email}</div>
                  <div className="overview-item"><span>Phone</span>{detail.user.phone || '—'}</div>
                  <div className="overview-item"><span>Bio</span>{detail.user.bio || '—'}</div>
                  <div className="overview-item"><span>Joined</span>{formatDate(detail.user.created_at)}</div>
                  <div className="overview-item"><span>Reviews</span>{detail.user.review_count || 0}</div>
                  <div className="overview-item"><span>Subscription</span>
                    {detail.subscription ? `${detail.subscription.plan} (${detail.subscription.status})` : 'None'}
                  </div>
                </div>
              )}
              {!detailLoading && detail && detailTab === 'listings' && (
                <div className="mini-table">
                  {detail.listings.length === 0 && <p className="table-empty">No listings</p>}
                  {detail.listings.map((item) => (
                    <div key={item.id} className="mini-row">
                      <span className="mini-main">{item.title}</span>
                      <span className="mini-mid">${Number(item.price).toFixed(2)}</span>
                      <span className={`status-badge ${getStatusBadge(item.status)}`}>{item.status}</span>
                    </div>
                  ))}
                </div>
              )}
              {!detailLoading && detail && detailTab === 'transactions' && (
                <div className="mini-table">
                  {detail.transactions.length === 0 && <p className="table-empty">No transactions</p>}
                  {detail.transactions.map((tx) => (
                    <div key={tx.id} className="mini-row">
                      <span className="mini-main">{tx.item_title}</span>
                      <span className="mini-mid">${Number(tx.amount).toFixed(2)}</span>
                      <span className={`status-badge ${getStatusBadge(tx.status)}`}>{tx.status}</span>
                    </div>
                  ))}
                </div>
              )}
              {!detailLoading && detail && detailTab === 'reviews' && (
                <div className="mini-table">
                  {detail.reviews.length === 0 && <p className="table-empty">No reviews</p>}
                  {detail.reviews.map((review, idx) => (
                    <div key={idx} className="mini-row">
                      <span className="mini-main">
                        {review.reviewer}
                        <span className="mini-rating">
                          {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
                        </span>
                      </span>
                      <span className="mini-mid">{review.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={showBanModal} onClose={() => setShowBanModal(false)} title="Ban User">
        <div className="ban-modal">
          <p>Ban <strong>{selectedUser?.name}</strong>? Their listings will be removed.</p>
          <textarea
            className="ban-reason-input"
            placeholder="Reason for ban (optional)"
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => { setShowBanModal(false); setBanReason(''); }}>
              Cancel
            </button>
            <button className="btn-danger" onClick={handleBan}>
              Ban User
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete User">
        <div className="delete-modal">
          <p>Are you sure you want to delete <strong>{selectedUser?.name}</strong>?</p>
          <p className="warning-text">This action cannot be undone.</p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </button>
            <button className="btn-danger" onClick={handleDelete}>
              Delete
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!tempPassword} onClose={() => setTempPassword(null)} title="Password Reset">
        <div className="temp-password-modal">
          <p>A temporary password has been set for <strong>{selectedUser?.name}</strong>.</p>
          <div className="temp-password-value">{tempPassword}</div>
          <p className="warning-text">Share this with the user. They should change it after logging in.</p>
          <div className="modal-actions">
            <button className="btn-primary" onClick={() => setTempPassword(null)}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AdminUsers;
