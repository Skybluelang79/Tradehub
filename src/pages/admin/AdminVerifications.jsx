import { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { api } from '../../services/client';
import { EyeIcon, CheckIcon, BanIcon, AlertIcon, ShieldIcon } from './Icons.jsx';
import './AdminUsers.css';
import './AdminVerifications.css';

const ID_TYPE_LABELS = {
  national_id: 'National ID card',
  passport: 'Passport',
  drivers_license: "Driver's license",
  residence_permit: 'Residence permit',
  other: 'Other government ID',
};

const STATUS_CLS = {
  pending: 'status-pending',
  approved: 'status-active',
  rejected: 'status-suspended',
};

export default function AdminVerifications() {
  const { isAdminAuth } = useAdmin();
  const [filter, setFilter] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const [showLightbox, setShowLightbox] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    if (!isAdminAuth) {
      window.dispatchEvent(new CustomEvent('adminSessionExpired'));
      return;
    }
    setLoading(true);
    try {
      const r = await api.admin.verifications({ status: filter === 'all' ? 'all' : filter });
      setRequests(r.requests || []);
    } catch (err) {
      console.error('Failed to load verifications:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdminAuth, filter]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    setBusy(id);
    try {
      await api.admin.verificationApprove(id);
      await load();
    } catch (err) {
      alert(`Could not approve: ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  const reject = async () => {
    if (!rejectModal) return;
    setBusy(rejectModal);
    try {
      await api.admin.verificationReject(rejectModal, rejectNote);
      setRejectModal(null);
      setRejectNote('');
      await load();
    } catch (err) {
      alert(`Could not reject: ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="admin-verifications">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Seller Verifications</h1>
          <p>Review identity documents and approve verified sellers</p>
        </div>
      </div>

      <div className="payout-actions" style={{ marginBottom: 16 }}>
        {['pending', 'approved', 'rejected', 'all'].map((s) => (
          <button
            key={s}
            className={`btn-sm ${filter === s ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="admin-loading">Loading...</div>
      ) : (
        <div className="av-grid">
          {requests.map((r) => (
            <div key={r.id} className="av-card">
              <div className="av-card-head">
                <div className="av-user">
                  {r.user_avatar ? <img src={r.user_avatar} alt="" className="av-avatar" /> : <div className="av-avatar av-avatar-fallback" />}
                  <div className="av-user-info">
                    <strong>{r.user_name || r.user_id}</strong>
                    <span>{r.user_email}</span>
                  </div>
                </div>
                <span className={`status-badge ${STATUS_CLS[r.status] || 'status-pending'}`}>{r.status}</span>
              </div>

              <div className="av-meta">
                <div className="av-meta-row">
                  <span className="av-meta-label">ID type</span>
                  <span>{ID_TYPE_LABELS[r.id_type] || r.id_type}</span>
                </div>
                <div className="av-meta-row">
                  <span className="av-meta-label">ID number</span>
                  <span>{r.id_number}</span>
                </div>
                <div className="av-meta-row">
                  <span className="av-meta-label">Email verified</span>
                  <span>{r.email_verified ? 'Yes' : 'No'}</span>
                </div>
                <div className="av-meta-row">
                  <span className="av-meta-label">Listings</span>
                  <span>{r.listing_count || 0}</span>
                </div>
                <div className="av-meta-row">
                  <span className="av-meta-label">Submitted</span>
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                </div>
              </div>

              <div className="av-images">
                <div className="av-img-block">
                  <img src={r.id_image_url} alt="ID document" onClick={() => setShowLightbox(r.id_image_url)} />
                  <span>ID document</span>
                </div>
                {r.selfie_url && (
                  <div className="av-img-block">
                    <img src={r.selfie_url} alt="Selfie" onClick={() => setShowLightbox(r.selfie_url)} />
                    <span>Selfie</span>
                  </div>
                )}
              </div>

              {r.admin_note && <p className="av-note">Note: {r.admin_note}</p>}

              {r.status === 'pending' && (
                <div className="av-actions">
                  <button className="btn-sm btn-primary" disabled={!!busy} onClick={() => approve(r.id)}>
                    <CheckIcon size={14} /> Approve
                  </button>
                  <button className="btn-sm btn-secondary" disabled={!!busy} onClick={() => { setRejectModal(r.id); setRejectNote(''); }}>
                    <BanIcon size={14} /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
          {requests.length === 0 && (
            <div className="av-empty"><AlertIcon size={20} /> No verification requests here.</div>
          )}
        </div>
      )}

      {showLightbox && (
        <div className="av-lightbox" onClick={() => setShowLightbox(null)}>
          <img src={showLightbox} alt="Verification document" />
          <button className="av-lightbox-close" onClick={() => setShowLightbox(null)}>×</button>
        </div>
      )}

      {rejectModal && (
        <div className="gift-modal-overlay" onClick={() => !busy && setRejectModal(null)}>
          <div className="gift-modal av-reject-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gift-modal-header">
              <h3>Reject verification</h3>
              <button className="gift-modal-close" onClick={() => !busy && setRejectModal(null)}>×</button>
            </div>
            <div className="gift-modal-body">
              <label className="gift-label">Reason (optional, shown to the seller)</label>
              <textarea
                className="av-reject-input"
                rows={3}
                maxLength={500}
                placeholder="e.g. The document photo is blurry. Please resubmit with a clearer image."
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
              />
              <div className="payout-actions" style={{ marginTop: 12 }}>
                <button className="btn-secondary" disabled={!!busy} onClick={() => setRejectModal(null)}>Cancel</button>
                <button className="btn-primary" disabled={!!busy} onClick={reject}>
                  <BanIcon size={14} /> Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}