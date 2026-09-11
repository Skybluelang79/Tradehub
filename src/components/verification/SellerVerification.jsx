import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/client';
import { useToast } from '../ui/Toast';
import { ShieldIcon, CheckIcon } from '../../pages/admin/Icons';
import './SellerVerification.css';

const ID_TYPES = [
  { value: 'national_id', label: 'National ID card' },
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: "Driver's license" },
  { value: 'residence_permit', label: 'Residence permit' },
  { value: 'other', label: 'Other government ID' },
];

export default function SellerVerification() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [request, setRequest] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ idType: 'national_id', idNumber: '', idImageUrl: '', selfieUrl: '' });
  const [uploading, setUploading] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.verification.status();
      setIdentityVerified(!!res.identityVerified);
      setRequest(res.request || null);
    } catch (err) {
      addToast(err.message || 'Could not load verification status', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const uploadImage = async (file, key) => {
    if (!file) return;
    setUploading(key);
    try {
      const res = await api.upload.single(file);
      const url = res?.file?.url || res?.url;
      if (url) {
        setForm((f) => ({ ...f, [key]: url }));
        addToast('Image uploaded', 'success');
      } else {
        addToast('Upload returned no URL', 'error');
      }
    } catch (err) {
      addToast(err.message || 'Upload failed', 'error');
    } finally {
      setUploading('');
    }
  };

  const submit = async () => {
    if (!form.idType || !form.idNumber.trim()) {
      addToast('Fill in the ID type and number', 'error');
      return;
    }
    if (!form.idImageUrl) {
      addToast('Upload a photo of your ID document', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await api.verification.submit(form);
      addToast('Verification request submitted!', 'success');
      setShowForm(false);
      await load();
    } catch (err) {
      addToast(err.message || 'Could not submit request', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="sv-card sv-loading">Checking verification status...</div>;

  if (identityVerified) {
    return (
      <div className="sv-card sv-verified">
        <div className="sv-icon"><ShieldIcon size={22} /></div>
        <div className="sv-body">
          <div className="sv-title">Verified Seller <CheckIcon size={14} /></div>
          <p className="sv-desc">Your identity has been verified. Your listings carry the verified badge.</p>
        </div>
      </div>
    );
  }

  const canResubmit = !request || request.status === 'rejected';

  return (
    <div className="sv-card">
      {request && request.status === 'pending' && (
        <div className="sv-pending">
          <div className="sv-icon sv-icon-pending"><ShieldIcon size={22} /></div>
          <div className="sv-body">
            <div className="sv-title">Verification under review</div>
            <p className="sv-desc">We received your ID documents on {new Date(request.created_at).toLocaleDateString()}. You will be notified once reviewed.</p>
          </div>
        </div>
      )}
      {request && request.status === 'rejected' && (
        <div className="sv-rejected">
          <div className="sv-icon sv-icon-danger"><ShieldIcon size={22} /></div>
          <div className="sv-body">
            <div className="sv-title">Verification rejected</div>
            {request.admin_note && <p className="sv-desc">Reason: {request.admin_note}</p>}
            <p className="sv-desc">Please resubmit with a clear photo of your ID and a matching selfie.</p>
            <button className="sv-btn sv-btn-primary" onClick={() => { setForm((f) => ({ ...f, idNumber: '', idImageUrl: '', selfieUrl: '' })); setShowForm(true); }}>
              Resubmit
            </button>
          </div>
        </div>
      )}
      {!request && (
        <div className="sv-cta">
          <div className="sv-icon"><ShieldIcon size={22} /></div>
          <div className="sv-body">
            <div className="sv-title">Get verified as a seller</div>
            <p className="sv-desc">Verified sellers earn the trust badge on their profile and listings. Submit a government ID and a selfie for review.</p>
            <button className="sv-btn sv-btn-primary" onClick={() => setShowForm(true)}>Start verification</button>
          </div>
        </div>
      )}

      {showForm && (canResubmit || !request) && (
        <div className="sv-form">
          <label className="sv-label">ID type</label>
          <select className="sv-input" value={form.idType} onChange={(e) => setForm({ ...form, idType: e.target.value })}>
            {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          <label className="sv-label">ID number</label>
          <input
            className="sv-input"
            type="text"
            maxLength={100}
            value={form.idNumber}
            onChange={(e) => setForm({ ...form, idNumber: e.target.value })}
            placeholder="e.g. A01234567"
          />

          <label className="sv-label">ID document photo (front)</label>
          <label className={`sv-upload ${form.idImageUrl ? 'has-img' : ''}`}>
            {form.idImageUrl ? (
              <img src={form.idImageUrl} alt="ID" onClick={() => window.open(form.idImageUrl, '_blank')} />
            ) : (
              <span>{uploading === 'idImageUrl' ? 'Uploading...' : 'Upload ID photo'}</span>
            )}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              disabled={!!uploading}
              onChange={(e) => uploadImage(e.target.files?.[0], 'idImageUrl')}
            />
          </label>

          <label className="sv-label">Selfie holding your ID (recommended)</label>
          <label className={`sv-upload ${form.selfieUrl ? 'has-img' : ''}`}>
            {form.selfieUrl ? (
              <img src={form.selfieUrl} alt="Selfie" onClick={() => window.open(form.selfieUrl, '_blank')} />
            ) : (
              <span>{uploading === 'selfieUrl' ? 'Uploading...' : 'Upload selfie'}</span>
            )}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              disabled={!!uploading}
              onChange={(e) => uploadImage(e.target.files?.[0], 'selfieUrl')}
            />
          </label>

          <div className="sv-actions">
            <button className="sv-btn" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="sv-btn sv-btn-primary" disabled={submitting || !!uploading} onClick={submit}>
              {submitting ? 'Submitting...' : 'Submit for review'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}