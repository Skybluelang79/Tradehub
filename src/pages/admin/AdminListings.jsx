import { useState, useMemo } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { useApp } from '../../context';
import { SearchIcon, CheckIcon, XIcon, TrashIcon, EyeIcon, FlagIcon } from './Icons.jsx';
import Modal from '../../components/ui/Modal.jsx';
import './AdminListings.css';

const AdminListings = () => {
  const { listings: adminListings, updateListingStatus, deleteListing } = useAdmin();
  const { items, getUser, currentUser } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedListing, setSelectedListing] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const listings = useMemo(() => {
    const realItems = items.map(item => ({
      id: item.id,
      title: item.title,
      price: item.price,
      category: item.category,
      seller: getUser(item.sellerId)?.name || 'Unknown',
      status: item.status === 'active' ? 'approved' : item.status,
      views: item.views || 0,
      date: item.createdAt ? new Date(item.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      image: item.images?.[0] || null,
    }));
    const allListings = [...realItems, ...adminListings];
    const seen = new Set();
    return allListings.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
  }, [items, adminListings, getUser]);

  const filteredListings = listings.filter(listing => {
    const matchesSearch = listing.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          listing.seller.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || listing.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handleApprove = (listingId) => {
    updateListingStatus(listingId, 'approved');
  };

  const handleReject = (listingId) => {
    updateListingStatus(listingId, 'rejected');
  };

  const handleDelete = (listingId) => {
    deleteListing(listingId);
  };

  const getStatusBadge = (status) => {
    const classes = {
      approved: 'status-approved',
      pending: 'status-pending',
      rejected: 'status-rejected',
      reported: 'status-reported'
    };
    return classes[status] || '';
  };

  return (
    <div className="admin-listings">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Listing Management</h1>
          <p>Review and manage all listings</p>
        </div>
        <div className="header-stats">
          <div className="stat-item">
            <span className="stat-count">{listings.filter(l => l.status === 'pending').length}</span>
            <span className="stat-text">Pending</span>
          </div>
          <div className="stat-item">
            <span className="stat-count">{listings.filter(l => l.status === 'reported').length}</span>
            <span className="stat-text">Reported</span>
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
            className={`filter-btn ${filterStatus === 'approved' ? 'active' : ''}`}
            onClick={() => setFilterStatus('approved')}
          >
            Approved
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'pending' ? 'active' : ''}`}
            onClick={() => setFilterStatus('pending')}
          >
            Pending
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'reported' ? 'active' : ''}`}
            onClick={() => setFilterStatus('reported')}
          >
            Reported
          </button>
        </div>
      </div>

      <div className="listings-grid">
        {filteredListings.map(listing => (
          <div key={listing.id} className="listing-card">
            <div className="listing-image">
              {listing.image ? (
                <img src={listing.image} alt={listing.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                <span className="listing-price">${listing.price.toLocaleString()}</span>
                <span className="listing-category">{listing.category}</span>
              </div>
              <div className="listing-info">
                <span className="listing-seller">by {listing.seller}</span>
                <span className="listing-views">
                  <EyeIcon size={14} />
                  {listing.views.toLocaleString()}
                </span>
              </div>
              <div className="listing-actions">
                {listing.status === 'pending' && (
                  <>
                    <button 
                      className="action-btn approve"
                      onClick={() => handleApprove(listing.id)}
                      title="Approve"
                    >
                      <CheckIcon size={16} />
                    </button>
                    <button 
                      className="action-btn reject"
                      onClick={() => handleReject(listing.id)}
                      title="Reject"
                    >
                      <XIcon size={16} />
                    </button>
                  </>
                )}
                <button 
                  className="action-btn view"
                  onClick={() => {
                    setSelectedListing(listing);
                    setShowDetailModal(true);
                  }}
                  title="View Details"
                >
                  <EyeIcon size={16} />
                </button>
                <button 
                  className="action-btn delete"
                  onClick={() => handleDelete(listing.id)}
                  title="Delete"
                >
                  <TrashIcon size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredListings.length === 0 && (
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

      <Modal 
        isOpen={showDetailModal} 
        onClose={() => setShowDetailModal(false)}
        title="Listing Details"
      >
        {selectedListing && (
          <div className="listing-detail-modal">
            <div className="detail-image">
              <div className="image-placeholder large">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
            </div>
            <h3>{selectedListing.title}</h3>
            <div className="detail-price">${selectedListing.price.toLocaleString()}</div>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="label">Category</span>
                <span className="value">{selectedListing.category}</span>
              </div>
              <div className="detail-item">
                <span className="label">Seller</span>
                <span className="value">{selectedListing.seller}</span>
              </div>
              <div className="detail-item">
                <span className="label">Views</span>
                <span className="value">{selectedListing.views.toLocaleString()}</span>
              </div>
              <div className="detail-item">
                <span className="label">Date</span>
                <span className="value">{selectedListing.date}</span>
              </div>
              <div className="detail-item full">
                <span className="label">Status</span>
                <span className={`status-badge ${getStatusBadge(selectedListing.status)}`}>
                  {selectedListing.status}
                </span>
              </div>
            </div>
            <div className="detail-actions">
              {selectedListing.status === 'pending' && (
                <>
                  <button 
                    className="btn-success"
                    onClick={() => {
                      handleApprove(selectedListing.id);
                      setShowDetailModal(false);
                    }}
                  >
                    <CheckIcon size={16} />
                    Approve
                  </button>
                  <button 
                    className="btn-danger"
                    onClick={() => {
                      handleReject(selectedListing.id);
                      setShowDetailModal(false);
                    }}
                  >
                    <XIcon size={16} />
                    Reject
                  </button>
                </>
              )}
              <button 
                className="btn-danger-outline"
                onClick={() => {
                  handleDelete(selectedListing.id);
                  setShowDetailModal(false);
                }}
              >
                <TrashIcon size={16} />
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AdminListings;
