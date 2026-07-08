import { useState } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { SearchIcon, FilterIcon, BanIcon, CheckIcon, TrashIcon, EditIcon } from './Icons.jsx';
import Modal from '../../components/ui/Modal.jsx';
import './AdminUsers.css';

const AdminUsers = () => {
  const { users, updateUserStatus, deleteUser } = useAdmin();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || user.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handleStatusChange = (userId, newStatus) => {
    updateUserStatus(userId, newStatus);
  };

  const handleDelete = () => {
    if (selectedUser) {
      deleteUser(selectedUser.id);
      setShowDeleteModal(false);
      setSelectedUser(null);
    }
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

  return (
    <div className="admin-users">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>User Management</h1>
          <p>Manage all users on the platform</p>
        </div>
        <button className="btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add User
        </button>
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <SearchIcon size={18} />
          <input 
            type="text" 
            placeholder="Search users..." 
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
            className={`filter-btn ${filterStatus === 'active' ? 'active' : ''}`}
            onClick={() => setFilterStatus('active')}
          >
            Active
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'pending' ? 'active' : ''}`}
            onClick={() => setFilterStatus('pending')}
          >
            Pending
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'suspended' ? 'active' : ''}`}
            onClick={() => setFilterStatus('suspended')}
          >
            Suspended
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'banned' ? 'active' : ''}`}
            onClick={() => setFilterStatus('banned')}
          >
            Banned
          </button>
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
            {filteredUsers.map(user => (
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
                      </span>
                      <span className="user-email">{user.email}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`status-badge ${getStatusBadge(user.status)}`}>
                    {user.status}
                  </span>
                </td>
                <td>{user.listings}</td>
                <td>
                  <div className="rating-cell">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#FBBF24">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <span>{user.rating > 0 ? user.rating.toFixed(1) : 'N/A'}</span>
                  </div>
                </td>
                <td>{user.joined}</td>
                <td>
                  <div className="action-buttons">
                    <button 
                      className="action-btn view" 
                      title="View Details"
                      onClick={() => {
                        setSelectedUser(user);
                        setShowEditModal(true);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                    {user.status === 'active' && (
                      <button 
                        className="action-btn suspend" 
                        title="Suspend User"
                        onClick={() => handleStatusChange(user.id, 'suspended')}
                      >
                        <BanIcon />
                      </button>
                    )}
                    {(user.status === 'suspended' || user.status === 'banned') && (
                      <button 
                        className="action-btn activate" 
                        title="Activate User"
                        onClick={() => handleStatusChange(user.id, 'active')}
                      >
                        <CheckIcon />
                      </button>
                    )}
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

      <Modal 
        isOpen={showEditModal} 
        onClose={() => setShowEditModal(false)}
        title="User Details"
      >
        {selectedUser && (
          <div className="user-detail-modal">
            <div className="detail-avatar">{selectedUser.name.charAt(0)}</div>
            <h3>{selectedUser.name}</h3>
            <p className="detail-email">{selectedUser.email}</p>
            <div className="detail-stats">
              <div className="detail-stat">
                <span className="stat-label">Listings</span>
                <span className="stat-value">{selectedUser.listings}</span>
              </div>
              <div className="detail-stat">
                <span className="stat-label">Rating</span>
                <span className="stat-value">{selectedUser.rating > 0 ? selectedUser.rating.toFixed(1) : 'N/A'}</span>
              </div>
              <div className="detail-stat">
                <span className="stat-label">Status</span>
                <span className={`status-badge ${getStatusBadge(selectedUser.status)}`}>
                  {selectedUser.status}
                </span>
              </div>
            </div>
            <div className="detail-actions">
              <select 
                value={selectedUser.status}
                onChange={(e) => {
                  handleStatusChange(selectedUser.id, e.target.value);
                  setSelectedUser({ ...selectedUser, status: e.target.value });
                }}
                className="status-select"
              >
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="suspended">Suspended</option>
                <option value="banned">Banned</option>
              </select>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete User"
      >
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
    </div>
  );
};

export default AdminUsers;
