import { useState } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { SearchIcon, CheckIcon, XIcon, FlagIcon, AlertIcon } from './Icons.jsx';
import Modal from '../../components/ui/Modal.jsx';
import './AdminReports.css';

const AdminReports = () => {
  const { reports, updateReportStatus } = useAdmin();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedReport, setSelectedReport] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const filteredReports = reports.filter(report => {
    const matchesSearch = report.reportedItem.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          report.reason.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || report.type === filterType;
    const matchesStatus = filterStatus === 'all' || report.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  const handleResolve = (reportId) => {
    updateReportStatus(reportId, 'resolved');
  };

  const handleDismiss = (reportId) => {
    updateReportStatus(reportId, 'dismissed');
  };

  const getTypeBadge = (type) => {
    const types = {
      user: { class: 'type-user', icon: '👤' },
      listing: { class: 'type-listing', icon: '📦' },
      transaction: { class: 'type-transaction', icon: '💳' }
    };
    return types[type] || types.user;
  };

  const getStatusBadge = (status) => {
    const statuses = {
      pending: 'status-pending',
      resolved: 'status-resolved',
      dismissed: 'status-dismissed'
    };
    return statuses[status] || '';
  };

  return (
    <div className="admin-reports">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Reports & Moderation</h1>
          <p>Review and handle user reports</p>
        </div>
        <div className="header-stats">
          <div className="stat-item danger">
            <span className="stat-count">{reports.filter(r => r.status === 'pending').length}</span>
            <span className="stat-text">Pending</span>
          </div>
          <div className="stat-item success">
            <span className="stat-count">{reports.filter(r => r.status === 'resolved').length}</span>
            <span className="stat-text">Resolved</span>
          </div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <SearchIcon size={18} />
          <input 
            type="text" 
            placeholder="Search reports..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <button 
            className={`filter-btn ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterType('all')}
          >
            All Types
          </button>
          <button 
            className={`filter-btn ${filterType === 'user' ? 'active' : ''}`}
            onClick={() => setFilterType('user')}
          >
            Users
          </button>
          <button 
            className={`filter-btn ${filterType === 'listing' ? 'active' : ''}`}
            onClick={() => setFilterType('listing')}
          >
            Listings
          </button>
          <button 
            className={`filter-btn ${filterType === 'transaction' ? 'active' : ''}`}
            onClick={() => setFilterType('transaction')}
          >
            Transactions
          </button>
        </div>
        <div className="filter-group">
          <button 
            className={`filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            All Status
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'pending' ? 'active' : ''}`}
            onClick={() => setFilterStatus('pending')}
          >
            Pending
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'resolved' ? 'active' : ''}`}
            onClick={() => setFilterStatus('resolved')}
          >
            Resolved
          </button>
          <button 
            className={`filter-btn ${filterStatus === 'dismissed' ? 'active' : ''}`}
            onClick={() => setFilterStatus('dismissed')}
          >
            Dismissed
          </button>
        </div>
      </div>

      <div className="reports-list">
        {filteredReports.map(report => {
          const typeInfo = getTypeBadge(report.type);
          return (
            <div key={report.id} className="report-card">
              <div className="report-header">
                <div className="report-type-badge">
                  <span className={`type-indicator ${typeInfo.class}`}></span>
                  <span>{report.type}</span>
                </div>
                <span className={`status-badge ${getStatusBadge(report.status)}`}>
                  {report.status}
                </span>
              </div>
              <div className="report-body">
                <h3 className="report-item">{report.reportedItem}</h3>
                <p className="report-reason">{report.reason}</p>
                <div className="report-meta">
                  <span>Reported by: {report.reporter}</span>
                  <span>{report.date}</span>
                </div>
              </div>
              <div className="report-actions">
                {report.status === 'pending' && (
                  <>
                    <button 
                      className="action-btn resolve"
                      onClick={() => handleResolve(report.id)}
                    >
                      <CheckIcon size={16} />
                      Resolve
                    </button>
                    <button 
                      className="action-btn dismiss"
                      onClick={() => handleDismiss(report.id)}
                    >
                      <XIcon size={16} />
                      Dismiss
                    </button>
                  </>
                )}
                <button 
                  className="action-btn view"
                  onClick={() => {
                    setSelectedReport(report);
                    setShowDetailModal(true);
                  }}
                >
                  <AlertIcon size={16} />
                  View Details
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredReports.length === 0 && (
        <div className="empty-state">
          <AlertIcon size={48} />
          <h3>No reports found</h3>
          <p>All clear! No reports match your criteria.</p>
        </div>
      )}

      <Modal 
        isOpen={showDetailModal} 
        onClose={() => setShowDetailModal(false)}
        title="Report Details"
      >
        {selectedReport && (
          <div className="report-detail-modal">
            <div className="detail-header">
              <div className="report-type-badge large">
                <span className={`type-indicator ${getTypeBadge(selectedReport.type).class}`}></span>
                <span>{selectedReport.type} Report</span>
              </div>
              <span className={`status-badge ${getStatusBadge(selectedReport.status)}`}>
                {selectedReport.status}
              </span>
            </div>
            <div className="detail-content">
              <div className="detail-row">
                <span className="label">Reported Item</span>
                <span className="value">{selectedReport.reportedItem}</span>
              </div>
              <div className="detail-row">
                <span className="label">Reason</span>
                <span className="value">{selectedReport.reason}</span>
              </div>
              <div className="detail-row">
                <span className="label">Reported By</span>
                <span className="value">{selectedReport.reporter}</span>
              </div>
              <div className="detail-row">
                <span className="label">Date</span>
                <span className="value">{selectedReport.date}</span>
              </div>
            </div>
            {selectedReport.status === 'pending' && (
              <div className="detail-actions">
                <button 
                  className="btn-success"
                  onClick={() => {
                    handleResolve(selectedReport.id);
                    setShowDetailModal(false);
                  }}
                >
                  <CheckIcon size={16} />
                  Mark as Resolved
                </button>
                <button 
                  className="btn-secondary"
                  onClick={() => {
                    handleDismiss(selectedReport.id);
                    setShowDetailModal(false);
                  }}
                >
                  <XIcon size={16} />
                  Dismiss Report
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AdminReports;
