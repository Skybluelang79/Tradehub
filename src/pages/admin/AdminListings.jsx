import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/client.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { SearchIcon, CheckIcon, XIcon, EyeIcon, FlagIcon } from './Icons.jsx';
import Modal from '../../components/ui/Modal.jsx';
import './AdminListings.css';

const LISTING_FILTERS = ['all', 'pending', 'active', 'flagged', 'sold', 'removed'];

const formatDate = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
};

const AdminListings = () => {
  const { addToast } = useToast();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(false);

  const [selectedListing, setSelectedListing] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [newStatus, setNewStatus] = useState('active');

  const loadListings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.listings({
        page,
        limit: 12,
        q: searchQuery,
        status: filterStatus,
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      addToast(err.message || 'Failed to load listings', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, filterStatus, addToast]);

  useEffect(() => {
    const timer = setTimeout(loadListings, 300);
    return () => clearTimeout(timer);
  }, [loadListings]);

  const changeStatus = async (listingId, status) => {
    try {
      await api.admin.updateListingStatus(listingId, status);
      addToast(`Listing ${status}`, 'success');
      loadListings();
    } catch (err) {
      addToast(err.message || 'Failed to update listing', 'error');
    }
  };

  const handleDelete = (listingId) => {
    changeStatus(listingId, 'removed');
  };

  const openDetail = (listing) => {
    setSelectedListing(listing);
    setNewStatus(listing.status);
    setShowDetailModal(true);
  };

  const getStatusBadge = (status) => {
    const classes = {
      active: 'status-approved',
      flagged: 'status-reported',
      sold: 'status-sold',
      removed: 'status-removed'
    };
    return classes[status] || 'status-pending';
  };

  const flaggedCount = items.filter(i => i.status === 'flagged').length;

  return (
    <div className="admin-listings">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Listing Management</h1>
          <p>Review and manage all listings</p>
        </div>
        <div className="header-stats">
          <div className="stat-item">
            <span className="stat-count">{total}</span>
            <span className="stat-text">Total</span>
          </div>
          <div className="stat-item">
            <span className="stat-count">{flaggedCount}</span>
            <span className="stat-text">Flagged (page)</span>
          </div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <SearchIcon size={18} />
          <input
            type="text"
            placeholder="Search listings..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          />
        </div>
        <div className="filter-group">
          {LISTING_FILTERS.map((status) => (
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

      {loading && items.length === 0 && (
        <div className="empty-state">Loading listings...</div>
      )}
      {!loading && items.length === 0 && (
        <div className="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.29 7 12 12 20.71 7" />
            <line x1="12" y1="22" x2="12" y2="12" />
          </svg>
          <h3>No listings found</h3>
          <p>Try adjusting your search or filter criteria</p>
        </div>
      )}

      <div className="listings-grid">
        {items.map(listing => (
          <div key={listing.id} className="listing-card">
            <div className="listing-image">
              {listing.images && listing.images[0] ? (
                <img src={listing.images[0]} alt={listing.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div className="image-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
              )}
              <span className={`listing-status ${getStatusBadge(listing.status)}`}>
                {listing.status}
              </span>
            </div>
            <div className="listing-content">
              <h3 className="listing-title">{listing.title}</h3>
              <div className="listing-meta">
                <span className="listing-price">${Number(listing.price).toLocaleString()}</span>
                <span className="listing-category">{listing.category}</span>
              </div>
              <div className="listing-info">
                <span className="listing-seller">by {listing.seller_name}</span>
                <span className="listing-views">
                  <EyeIcon size={14} />
                  {Number(listing.views || 0).toLocaleString()}
                </span>
              </div>
              <div className="listing-actions">
                {(listing.status === 'flagged' || listing.status === 'pending') && (
                  <>
                    <button
                      className="action-btn approve"
                      onClick={() => changeStatus(listing.id, 'active')}
                      title="Approve"
                    >
                      <CheckIcon size={16} />
                    </button>
                    <button
                      className="action-btn reject"
                      onClick={() => changeStatus(listing.id, 'removed')}
                      title="Remove"
                    >
                      <XIcon size={16} />
                    </button>
                  </>
                )}
                <button
                  className="action-btn view"
                  onClick={() => openDetail(listing)}
                  title="View Details"
                >
                  <EyeIcon size={16} />
                </button>
                <button
                  className="action-btn delete"
                  onClick={() => handleDelete(listing.id)}
                  title="Remove"
                >
                  <FlagIcon size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="pagination">
        <span>
          Showing {items.length} of {total} listings
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
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title="Listing Details"
      >
        {selectedListing && (
          <div className="listing-detail-modal">
            <div className="detail-image">
              {selectedListing.images && selectedListing.images[0] ? (
                <img
                  src={selectedListing.images[0]}
                  alt={selectedListing.title}
                  style={{ width: '100%', height: '200px', objectFit: 'cover', borderRadius: '12px' }}
                />
              ) : (
                <div className="image-placeholder large">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
              )}
            </div>
            <h3>{selectedListing.title}</h3>
            <div className="detail-price">${Number(selectedListing.price).toLocaleString()}</div>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="label">Category</span>
                <span className="value">{selectedListing.category}</span>
              </div>
              <div className="detail-item">
                <span className="label">Seller</span>
                <span className="value">{selectedListing.seller_name}</span>
              </div>
              <div className="detail-item">
                <span className="label">Views</span>
                <span className="value">{Number(selectedListing.views || 0).toLocaleString()}</span>
              </div>
              <div className="detail-item">
                <span className="label">Date</span>
                <span className="value">{formatDate(selectedListing.created_at)}</span>
              </div>
              <div className="detail-item full">
                <span className="label">Status</span>
                <span className={`status-badge ${getStatusBadge(selectedListing.status)}`}>
                  {selectedListing.status}
                </span>
              </div>
            </div>
            <div className="detail-actions">
              {(selectedListing.status === 'flagged' || selectedListing.status === 'pending') && (
                <>
                  <button
                    className="btn-success"
                    onClick={() => {
                      changeStatus(selectedListing.id, 'active');
                      setShowDetailModal(false);
                    }}
                  >
                    <CheckIcon size={16} />
                    Approve
                  </button>
                  <button
                    className="btn-danger"
                    onClick={() => {
                      changeStatus(selectedListing.id, 'removed');
                      setShowDetailModal(false);
                    }}
                  >
                    <XIcon size={16} />
                    Remove
                  </button>
                </>
              )}
              <select
                className="sort-select"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
              >
                {['active', 'sold', 'flagged', 'pending', 'removed'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                className="btn-secondary"
                onClick={() => {
                  changeStatus(selectedListing.id, newStatus);
                  setShowDetailModal(false);
                }}
              >
                Apply Status
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AdminListings;
