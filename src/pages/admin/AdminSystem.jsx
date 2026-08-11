import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/client.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { DownloadIcon, DatabaseIcon, ServerIcon, RefreshIcon, XIcon } from './Icons.jsx';
import './AdminSystem.css';

const formatBytes = (bytes) => {
  const n = Number(bytes || 0);
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};

const formatUptime = (seconds) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
};

const AdminSystem = () => {
  const { addToast } = useToast();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.systemInfo();
      setInfo(data);
    } catch (err) {
      addToast(err.message || 'Failed to load system info', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      await api.admin.backup();
      addToast('Database backup downloaded', 'success');
    } catch (err) {
      addToast(err.message || 'Backup failed', 'error');
    } finally {
      setBackingUp(false);
    }
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
  };

  const handleRestore = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      addToast('Select a backup file first', 'error');
      return;
    }
    if (!window.confirm('Restoring will overwrite the entire database. Continue?')) return;
    setRestoring(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(',')[1];
      await api.admin.restore(base64);
      addToast('Database restored successfully', 'success');
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (err) {
      addToast(err.message || 'Restore failed', 'error');
    } finally {
      setRestoring(false);
    }
  };

  const clearFile = () => {
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const counts = info?.counts || {};
  const mem = info?.memory || {};

  return (
    <div className="admin-system">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>System</h1>
          <p>Server information, database backup &amp; restore</p>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          <RefreshIcon size={16} />
          Refresh
        </button>
      </div>

      <div className="system-grid">
        <div className="system-card">
          <div className="system-card-header">
            <ServerIcon size={20} />
            <h3>Server</h3>
          </div>
          {loading && !info && <div className="empty-state">Loading system info…</div>}
          {info && (
            <div className="system-info-list">
              <div className="system-info-row">
                <span>App</span>
                <strong>{info.name} v{info.version}</strong>
              </div>
              <div className="system-info-row">
                <span>Node</span>
                <strong>{info.node}</strong>
              </div>
              <div className="system-info-row">
                <span>Platform</span>
                <strong>{info.platform} ({info.arch})</strong>
              </div>
              <div className="system-info-row">
                <span>Environment</span>
                <strong>{info.env}</strong>
              </div>
              <div className="system-info-row">
                <span>Uptime</span>
                <strong>{formatUptime(info.uptimeSeconds)}</strong>
              </div>
              <div className="system-info-row">
                <span>Memory (RSS)</span>
                <strong>{formatBytes(mem.rss)}</strong>
              </div>
              <div className="system-info-row">
                <span>Heap used</span>
                <strong>{formatBytes(mem.heapUsed)}</strong>
              </div>
              <div className="system-info-row">
                <span>Server time</span>
                <strong>{new Date(info.now).toLocaleString()}</strong>
              </div>
            </div>
          )}
        </div>

        <div className="system-card">
          <div className="system-card-header">
            <DatabaseIcon size={20} />
            <h3>Database</h3>
          </div>
          {loading && !info && <div className="empty-state">Loading…</div>}
          {info && (
            <div className="system-info-list">
              <div className="system-info-row">
                <span>Storage mode</span>
                <strong>{info.dbMode}</strong>
              </div>
              <div className="system-info-row">
                <span>DB size</span>
                <strong>{formatBytes(info.dbSize)}</strong>
              </div>
              <div className="system-info-row">
                <span>Users</span>
                <strong>{counts.users || 0}</strong>
              </div>
              <div className="system-info-row">
                <span>Items</span>
                <strong>{counts.items || 0}</strong>
              </div>
              <div className="system-info-row">
                <span>Transactions</span>
                <strong>{counts.transactions || 0}</strong>
              </div>
              <div className="system-info-row">
                <span>Notifications</span>
                <strong>{counts.notifications || 0}</strong>
              </div>
              <div className="system-info-row">
                <span>Pending reports</span>
                <strong>{counts.pendingReports || 0}</strong>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="system-card db-actions-card">
        <div className="system-card-header">
          <DatabaseIcon size={20} />
          <h3>Backup &amp; Restore</h3>
        </div>
        <p className="system-note">
          Download a full snapshot of the database, or restore from a previous backup. Restoring
          overwrites all current data — use with caution.
        </p>
        <div className="db-actions">
          <div className="db-action-block">
            <h4>Create backup</h4>
            <p>Download the current database as a .db file.</p>
            <button className="btn-primary" onClick={handleBackup} disabled={backingUp}>
              <DownloadIcon size={16} />
              {backingUp ? 'Downloading…' : 'Download Backup'}
            </button>
          </div>
          <div className="db-divider" />
          <div className="db-action-block">
            <h4>Restore from backup</h4>
            <p>Upload a .db file to replace the current database.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".db,.sqlite"
              className="db-file-input"
              onChange={handleFile}
            />
            {fileName && (
              <div className="db-file-name">
                <span>{fileName}</span>
                <button className="db-file-clear" onClick={clearFile}>
                  <XIcon size={14} />
                </button>
              </div>
            )}
            <button className="btn-danger" onClick={handleRestore} disabled={restoring || !fileName}>
              {restoring ? 'Restoring…' : 'Restore Database'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSystem;
