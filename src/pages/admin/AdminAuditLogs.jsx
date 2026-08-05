import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/client.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { SearchIcon } from './Icons.jsx';
import './AdminAuditLogs.css';

const formatDate = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleString();
};

const AdminAuditLogs = () => {
  const { addToast } = useToast();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.auditLogs({ page, limit: 20, q: searchQuery });
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      addToast(err.message || 'Failed to load audit logs', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, addToast]);

  useEffect(() => {
    const timer = setTimeout(loadLogs, 300);
    return () => clearTimeout(timer);
  }, [loadLogs]);

  const actionClass = (action) => {
    if (action.includes('login') || action.includes('backup')) return 'log-action-info';
    if (action.includes('delete') || action.includes('suspend') || action.includes('banned')) return 'log-action-danger';
    if (action.includes('promote') || action.includes('verify') || action.includes('restore')) return 'log-action-success';
    return 'log-action-default';
  };

  return (
    <div className="admin-audit-logs">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Audit Logs</h1>
          <p>Track every admin action on the platform</p>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <SearchIcon size={18} />
          <input
            type="text"
            placeholder="Search by action or entity..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      <div className="audit-table-container">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Entity</th>
              <th>Target</th>
              <th>Admin</th>
              <th>Details</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading && logs.length === 0 && (
              <tr><td colSpan="6" className="table-empty">Loading audit logs...</td></tr>
            )}
            {!loading && logs.length === 0 && (
              <tr><td colSpan="6" className="table-empty">No audit logs found</td></tr>
            )}
            {logs.map((log) => {
              let details = log.details;
              try {
                details = JSON.stringify(JSON.parse(details));
              } catch {
                // keep raw
              }
              return (
                <tr key={log.id}>
                  <td>
                    <span className={`log-action ${actionClass(log.action)}`}>{log.action}</span>
                  </td>
                  <td>{log.entity_type}</td>
                  <td><span className="log-target">{log.entity_id || '—'}</span></td>
                  <td>{log.admin_name || '—'}</td>
                  <td><span className="log-details">{details || '—'}</span></td>
                  <td>{formatDate(log.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <span>
          Showing {logs.length} of {total} entries
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

export default AdminAuditLogs;
