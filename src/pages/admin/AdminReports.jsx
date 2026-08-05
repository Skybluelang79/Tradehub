import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/client.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { SearchIcon, CheckIcon, XIcon, FlagIcon, AlertIcon } from './Icons.jsx';
import Modal from '../../components/ui/Modal.jsx';
import './AdminReports.css';

const formatDate = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleString();
};

const AdminReports = () => {
  const { addToast } = useToast();
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(false);

  const [selectedReport, setSelectedReport] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.reports({
        page,
        limit: 20,
        q: searchQuery,
        type: filterType,
        status: filterStatus,
      });
      setReports(data.reports || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      addToast(err.message || 'Failed to load reports', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, filterType, filterStatus, addToast]);

  useEffect(() => {
    const timer = setTimeout(loadReports, 300);
    return () => clearTimeout(timer);
  }, [loadReports]);

  const handleResolve = async (report, action) => {
    try {
      await api.admin.resolveReport(report.id, action);
      addToast(`Report ${action === 'dismiss' ? 'dismissed' : 'resolved'}`, 'success');
      loadReports();
    } catch (err) {
      addToast(err.message || 'Failed to update report', 'error');
    }
  };

  const getTypeBadge = (type) => {
    const types = {
      user: 'type-user',
      item: 'type-listing'
    };
    return types[type] || 'type-user';
  };

  const getStatusBadge = (status) => {
    const statuses = {
      pending: 'status-pending',
      resolved: 'status-resolved',
      dismissed: 'status-dismissed'
    };
    return statuses[status] || '';
  };

  const pendingCount = reports.filter(r => r.status === 'pending').length;

  return (
    <div className="admin-reports">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Reports & Moderation</h1>
          <p>Review and handle user reports</p>
        </div>
        <div className="header-stats">
          <div className="stat-item danger">
            <span className="stat-count">{total}</span>
            <span className="stat-text">Total</span>
          </div>
          <div className="stat-item success">
            <span className="stat-count">{pendingCount}</span>
            <span className="stat-text">Pending (page)</span>
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
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          />
        </div>
        <div className="filter-group">
          {['all', 'item', 'user'].map((type) => (
            <button
              key={type}
              className={`filter-btn ${filterType === type ? 'active' : ''}`}
              onClick={() => { setFilterType(type); setPage(1); }}
            >
              {type[0].toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
        <div className="filter-group">
          {['all', 'pending', 'resolved', 'dismissed'].map((status) => (
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

      {loading && reports.length === 0 && (
        <div className="empty-state">Loading reports...</div>
      )}

      <div className="reports-list">
        {reports.map(report => (
          <div key={`${report.type}-${report.id}`} className="report-card">
            <div className="report-header">
              <div className="report-type-badge">
                <span className={`type-indicator ${getTypeBadge(report.type)}`}></span>
                <span>{report.type} report</span>
              </div>
              <span className={`status-badge ${getStatusBadge(report.status)}`}>
                {report.status}
              </span>
            </div>
            <div className="report-body">
              <h3 className="report-item">{report.target}</h3>
              <p className="report-reason">{report.reason}</p>
              {report.item_status && report.item_status !== 'active' && (
                <span className="target-status">Listing status: {report.item_status}</span>
              )}
              <div className="report-meta">
                <span>Reported by: {report.reporter_name}</span>
                <span>{formatDate(report.created_at)}</span>
              </div>
            </div>
            <div className="report-actions">
              {report.status === 'pending' && (
                <>
                  <button
                    className="action-btn resolve"
                    onClick={() => handleResolve(report, report.type === 'user' ? 'suspend' : 'remove')}
                  >
                    <CheckIcon size={16} />
                    {report.type === 'user' ? 'Suspend User' : 'Remove Listing'}
                  </button>
                  <button
                    className="action-btn warn"
                    onClick={() => handleResolve(report, 'warn')}
                  >
                    <FlagIcon size={16} />
                    Warn / Clear
                  </button>
                  <button
                    className="action-btn dismiss"
                    onClick={() => handleResolve(report, 'dismiss')}
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
        ))}
      </div>

      {!loading && reports.length === 0 && (
        <div className="empty-state">
          <AlertIcon size={48} />
          <h3>No reports found</h3>
          <p>All clear! No reports match your criteria.</p>
        </div>
      )}

      <div className="pagination">
        <span>
          Showing {reports.length} of {total} reports
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
        title="Report Details"
      >
        {selectedReport && (
          <div className="report-detail-modal">
            <div className="detail-header">
              <div className="report-type-badge large">
                <span className={`type-indicator ${getTypeBadge(selectedReport.type)}`}></span>
                <span>{selectedReport.type} Report</span>
              </div>
              <span className={`status-badge ${getStatusBadge(selectedReport.status)}`}>
                {selectedReport.status}
              </span>
            </div>
            <div className="detail-content">
              <div className="detail-row">
                <span className="label">Reported Item</span>
                <span className="value">{selectedReport.target}</span>
              </div>
              <div className="detail-row">
                <span className="label">Reason</span>
                <span className="value">{selectedReport.reason}</span>
              </div>
              {selectedReport.description && (
                <div className="detail-row">
                  <span className="label">Description</span>
                  <span className="value">{selectedReport.description}</span>
                </div>
              )}
              <div className="detail-row">
                <span className="label">Reported By</span>
                <span className="value">{selectedReport.reporter_name}</span>
              </div>
              <div className="detail-row">
                <span className="label">Date</span>
                <span className="value">{formatDate(selectedReport.created_at)}</span>
              </div>
            </div>
            {selectedReport.status === 'pending' && (
              <div className="detail-actions">
                <button
                  className="btn-success"
                  onClick={() => {
                    handleResolve(selectedReport, selectedReport.type === 'user' ? 'suspend' : 'remove');
                    setShowDetailModal(false);
                  }}
                >
                  <CheckIcon size={16} />
                  {selectedReport.type === 'user' ? 'Suspend User' : 'Remove Listing'}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    handleResolve(selectedReport, 'warn');
                    setShowDetailModal(false);
                  }}
                >
                  <FlagIcon size={16} />
                  Warn / Clear
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    handleResolve(selectedReport, 'dismiss');
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
