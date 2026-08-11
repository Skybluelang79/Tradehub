import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/client.js';
import { useToast } from '../../components/ui/Toast.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { PlusIcon, EditIcon, TrashIcon, CheckIcon, BanIcon, BellIcon, TagIcon, SendIcon } from './Icons.jsx';
import './AdminPromotions.css';

const emptyForm = {
  code: '',
  discount_type: 'percentage',
  discount_value: '',
  max_uses: '',
  min_purchase: '',
  expires_at: '',
  active: true,
};

const AdminPromotions = () => {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState('codes');

  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [broadcast, setBroadcast] = useState({ title: '', body: '', type: 'announcement' });
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.promotions();
      setPromotions(data.promotions || []);
    } catch (err) {
      addToast(err.message || 'Failed to load promotions', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowFormModal(true);
  };

  const openEdit = (promo) => {
    setEditing(promo);
    setForm({
      code: promo.code,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      max_uses: promo.max_uses || '',
      min_purchase: promo.min_purchase || '',
      expires_at: promo.expires_at ? promo.expires_at.slice(0, 10) : '',
      active: !!promo.active,
    });
    setShowFormModal(true);
  };

  const handleField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!form.code.trim()) {
      addToast('Code is required', 'error');
      return;
    }
    if (!form.discount_value || Number(form.discount_value) <= 0) {
      addToast('Valid discount value is required', 'error');
      return;
    }
    const payload = {
      code: form.code.trim().toUpperCase(),
      discount_type: form.discount_type,
      discount_value: parseFloat(form.discount_value),
      max_uses: form.max_uses ? parseInt(form.max_uses, 10) : 0,
      min_purchase: form.min_purchase ? parseFloat(form.min_purchase) : null,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      active: form.active,
    };
    setSaving(true);
    try {
      if (editing) {
        await api.admin.updatePromotion(editing.id, payload);
        addToast('Promotion updated', 'success');
      } else {
        await api.admin.createPromotion(payload);
        addToast('Promotion created', 'success');
      }
      setShowFormModal(false);
      load();
    } catch (err) {
      addToast(err.message || 'Failed to save promotion', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (promo) => {
    try {
      await api.admin.updatePromotion(promo.id, { active: !promo.active });
      addToast(promo.active ? 'Promotion deactivated' : 'Promotion activated', 'success');
      load();
    } catch (err) {
      addToast(err.message || 'Failed to update promotion', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.admin.deletePromotion(deleteTarget.id);
      addToast('Promotion deleted', 'success');
      setDeleteTarget(null);
      load();
    } catch (err) {
      addToast(err.message || 'Failed to delete promotion', 'error');
    }
  };

  const handleBroadcast = async () => {
    if (!broadcast.title.trim() || !broadcast.body.trim()) {
      addToast('Title and message are required', 'error');
      return;
    }
    setSending(true);
    try {
      const data = await api.admin.broadcast(broadcast);
      addToast(`Broadcast sent to ${data.recipients || 0} users`, 'success');
      setBroadcast({ title: '', body: '', type: 'announcement' });
    } catch (err) {
      addToast(err.message || 'Failed to send broadcast', 'error');
    } finally {
      setSending(false);
    }
  };

  const activeCount = promotions.filter((p) => p.active).length;
  const usedTotal = promotions.reduce((sum, p) => sum + (p.used_count || 0), 0);

  return (
    <div className="admin-promotions">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Promotions &amp; Broadcast</h1>
          <p>Manage discount codes and send announcements to users</p>
        </div>
        {activeTab === 'codes' && (
          <button className="btn-primary" onClick={openCreate}>
            <PlusIcon size={16} />
            New Promotion
          </button>
        )}
      </div>

      <div className="promo-tabs">
        <button
          className={`promo-tab ${activeTab === 'codes' ? 'active' : ''}`}
          onClick={() => setActiveTab('codes')}
        >
          <TagIcon size={18} />
          Promo Codes
          <span className="promo-tab-count">{promotions.length}</span>
        </button>
        <button
          className={`promo-tab ${activeTab === 'broadcast' ? 'active' : ''}`}
          onClick={() => setActiveTab('broadcast')}
        >
          <BellIcon size={18} />
          Broadcast
        </button>
      </div>

      {activeTab === 'codes' && (
        <>
          <div className="promo-stats-grid">
            <div className="promo-stat-card">
              <span className="promo-stat-value">{promotions.length}</span>
              <span className="promo-stat-label">Total Codes</span>
            </div>
            <div className="promo-stat-card">
              <span className="promo-stat-value">{activeCount}</span>
              <span className="promo-stat-label">Active</span>
            </div>
            <div className="promo-stat-card">
              <span className="promo-stat-value">{usedTotal}</span>
              <span className="promo-stat-label">Total Uses</span>
            </div>
          </div>

          {loading && promotions.length === 0 && (
            <div className="empty-state">Loading promotions…</div>
          )}

          {!loading && promotions.length === 0 && (
            <div className="empty-state">
              <TagIcon size={48} />
              <h3>No promotions yet</h3>
              <p>Create your first discount code to start running promotions.</p>
            </div>
          )}

          {promotions.length > 0 && (
            <div className="promo-table-container">
              <table className="promo-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Discount</th>
                    <th>Uses</th>
                    <th>Min. Purchase</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {promotions.map((promo) => (
                    <tr key={promo.id}>
                      <td>
                        <span className="promo-code">{promo.code}</span>
                      </td>
                      <td>
                        <span className="promo-discount">
                          {promo.discount_type === 'percentage'
                            ? `${promo.discount_value}%`
                            : `$${Number(promo.discount_value).toFixed(2)} off`}
                        </span>
                      </td>
                      <td>
                        {promo.used_count || 0}
                        {promo.max_uses ? ` / ${promo.max_uses}` : ' / ∞'}
                      </td>
                      <td>
                        {promo.min_purchase ? `$${Number(promo.min_purchase).toFixed(2)}` : '—'}
                      </td>
                      <td>
                        {promo.expires_at
                          ? new Date(promo.expires_at).toLocaleDateString()
                          : 'Never'}
                      </td>
                      <td>
                        <span className={`status-badge ${promo.active ? 'status-active' : 'status-suspended'}`}>
                          {promo.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="promo-actions">
                          <button
                            className="action-btn edit"
                            title="Edit"
                            onClick={() => openEdit(promo)}
                          >
                            <EditIcon size={16} />
                          </button>
                          <button
                            className={`action-btn ${promo.active ? 'suspend' : 'activate'}`}
                            title={promo.active ? 'Deactivate' : 'Activate'}
                            onClick={() => handleToggleActive(promo)}
                          >
                            {promo.active ? <BanIcon size={16} /> : <CheckIcon size={16} />}
                          </button>
                          <button
                            className="action-btn delete"
                            title="Delete"
                            onClick={() => setDeleteTarget(promo)}
                          >
                            <TrashIcon size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === 'broadcast' && (
        <div className="broadcast-panel">
          <div className="broadcast-card">
            <div className="broadcast-card-header">
              <BellIcon size={20} />
              <h3>Send Announcement</h3>
            </div>
            <p className="broadcast-note">
              Sends a notification to every registered user on the platform.
            </p>
            <div className="broadcast-field">
              <label>Title</label>
              <input
                type="text"
                placeholder="e.g. Platform maintenance on Sunday"
                value={broadcast.title}
                onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })}
              />
            </div>
            <div className="broadcast-field">
              <label>Message</label>
              <textarea
                rows="5"
                placeholder="Write the announcement message…"
                value={broadcast.body}
                onChange={(e) => setBroadcast({ ...broadcast, body: e.target.value })}
              />
            </div>
            <div className="broadcast-field">
              <label>Type</label>
              <select
                className="promo-select"
                value={broadcast.type}
                onChange={(e) => setBroadcast({ ...broadcast, type: e.target.value })}
              >
                <option value="announcement">Announcement</option>
                <option value="promotion">Promotion</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
              </select>
            </div>
            <button
              className="btn-primary broadcast-send-btn"
              onClick={handleBroadcast}
              disabled={sending}
            >
              <SendIcon size={16} />
              {sending ? 'Sending…' : 'Send to All Users'}
            </button>
          </div>
        </div>
      )}

      <Modal
        isOpen={showFormModal}
        onClose={() => setShowFormModal(false)}
        title={editing ? `Edit ${editing.code}` : 'New Promotion'}
      >
        <div className="promo-form">
          <div className="promo-form-field">
            <label>Code</label>
            <input
              type="text"
              value={form.code}
              placeholder="e.g. SUMMER20"
              onChange={(e) => handleField('code', e.target.value.toUpperCase())}
            />
          </div>
          <div className="promo-form-row">
            <div className="promo-form-field">
              <label>Discount Type</label>
              <select
                className="promo-select"
                value={form.discount_type}
                onChange={(e) => handleField('discount_type', e.target.value)}
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            <div className="promo-form-field">
              <label>{form.discount_type === 'percentage' ? 'Percent Off' : 'Amount Off ($)'}</label>
              <input
                type="number"
                min="0"
                step={form.discount_type === 'percentage' ? '1' : '0.01'}
                value={form.discount_value}
                onChange={(e) => handleField('discount_value', e.target.value)}
              />
            </div>
          </div>
          <div className="promo-form-row">
            <div className="promo-form-field">
              <label>Max Uses (0 = unlimited)</label>
              <input
                type="number"
                min="0"
                value={form.max_uses}
                onChange={(e) => handleField('max_uses', e.target.value)}
              />
            </div>
            <div className="promo-form-field">
              <label>Min. Purchase ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.min_purchase}
                onChange={(e) => handleField('min_purchase', e.target.value)}
              />
            </div>
          </div>
          <div className="promo-form-field">
            <label>Expires</label>
            <input
              type="date"
              value={form.expires_at}
              onChange={(e) => handleField('expires_at', e.target.value)}
            />
          </div>
          <label className="promo-checkbox">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => handleField('active', e.target.checked)}
            />
            <span>Active immediately</span>
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => setShowFormModal(false)}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Promotion'}
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Promotion"
      >
        <div className="delete-modal">
          <p>Delete promo code <strong>{deleteTarget?.code}</strong>?</p>
          <p className="warning-text">This action cannot be undone.</p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
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

export default AdminPromotions;
