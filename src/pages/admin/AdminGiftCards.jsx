import { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '../../context/AdminContext.jsx';
import { api } from '../../services/client';
import {
  CheckIcon, BanIcon, EditIcon, TrashIcon, AlertIcon, PackageIcon, ChartIcon, DollarIcon, EyeIcon,
} from './Icons.jsx';
import './AdminTransactions.css';
import './AdminUsers.css';
import './AdminGiftCards.css';

const fmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

const CARD_STATUS = {
  active: { label: 'Active', cls: 'status-active' },
  redeemed: { label: 'Redeemed', cls: 'status-completed' },
  voided: { label: 'Voided', cls: 'status-refunded' },
  expired: { label: 'Expired', cls: 'status-pending' },
};

function GiftIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

function RefreshIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

export default function AdminGiftCards() {
  const { isAdminAuth } = useAdmin();
  const [tab, setTab] = useState('brands');
  const [brands, setBrands] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [cards, setCards] = useState([]);
  const [designs, setDesigns] = useState([]);
  const [designFilter, setDesignFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState('');

  const [showBrandModal, setShowBrandModal] = useState(false);
  const [editingBrand, setEditingBrand] = useState(null);
  const [brandForm, setBrandForm] = useState({ name: '', description: '', category: 'general', frontImage: '', backImage: '', active: true });
  const [uploadingImg, setUploadingImg] = useState('');

  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueForm, setIssueForm] = useState({ amount: '25', count: '1', brandId: '', cardType: 'digital', purchaseCents: '', discountPercent: '' });
  const [issuedCodes, setIssuedCodes] = useState([]);
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueSummary, setIssueSummary] = useState(null);

  const [cardFilter, setCardFilter] = useState('all');

  const refresh = useCallback(async () => {
    if (!isAdminAuth) return;
    setLoading(true);
    try {
      const [b, a] = await Promise.all([
        api.payments.allGiftCardBrands(),
        api.payments.giftCardAnalytics(),
      ]);
      setBrands(b.brands || []);
      setAnalytics(a.analytics);
    } catch (err) {
      console.error('Failed to load gift cards:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdminAuth]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadCards = useCallback(async (status) => {
    if (!isAdminAuth) return;
    try {
      const r = await api.payments.giftCardList({ status });
      setCards(r.cards || []);
    } catch (err) {
      console.error('Failed to load cards:', err);
    }
  }, [isAdminAuth]);

  const loadDesigns = useCallback(async (status) => {
    if (!isAdminAuth) return;
    try {
      const r = await api.payments.giftCardDesigns({ status });
      setDesigns(r.designs || []);
    } catch (err) {
      console.error('Failed to load designs:', err);
    }
  }, [isAdminAuth]);

  useEffect(() => {
    loadCards(cardFilter);
  }, [cardFilter, loadCards, tab]);

  useEffect(() => {
    if (tab === 'designs') loadDesigns(designFilter);
  }, [tab, designFilter, loadDesigns]);

  const setDesignStatus = (id, status) => act(`ds-${id}-${status}`, () => api.payments.updateGiftCardDesign(id, status), () => loadDesigns(designFilter));

  const act = async (label, fn, after) => {
    setBusy(label);
    try {
      await fn();
      await after();
    } catch (err) {
      alert(`Action failed: ${err.message || 'unknown error'}`);
    } finally {
      setBusy('');
    }
  };

  const uploadImage = async (file, key) => {
    if (!file) return;
    setUploadingImg(key);
    try {
      const res = await api.upload.single(file);
      const url = res?.file?.url || res?.url;
      if (url) setBrandForm((f) => ({ ...f, [key]: url }));
      else alert('Upload returned no URL');
    } catch (err) {
      alert(`Upload failed: ${err.message || 'unknown error'}`);
    } finally {
      setUploadingImg('');
    }
  };

  const openBrandModal = (brand) => {
    setEditingBrand(brand || null);
    setBrandForm(brand ? {
      name: brand.name,
      description: brand.description || '',
      category: brand.category || 'general',
      frontImage: brand.front_image || '',
      backImage: brand.back_image || '',
      active: !!brand.active,
    } : { name: '', description: '', category: 'general', frontImage: '', backImage: '', active: true });
    setShowBrandModal(true);
  };

  const saveBrand = async () => {
    if (!brandForm.name?.trim()) {
      alert('Brand name required');
      return;
    }
    setBusy('save-brand');
    try {
      if (editingBrand) {
        await api.payments.updateGiftCardBrand(editingBrand.id, brandForm);
      } else {
        await api.payments.createGiftCardBrand(brandForm);
      }
      setShowBrandModal(false);
      await refresh();
    } catch (err) {
      alert(`Could not save brand: ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  const toggleBrand = (brand) => {
    act(`toggle-${brand.id}`, () => api.payments.updateGiftCardBrand(brand.id, { active: !brand.active }), refresh);
  };

  const handleIssue = async () => {
    const amountCents = Math.round(parseFloat(issueForm.amount || '0') * 100);
    if (!amountCents || amountCents < 100) {
      alert('Amount must be at least $1.00');
      return;
    }
    const payload = {
      amountCents,
      count: parseInt(issueForm.count, 10) || 1,
      brandId: issueForm.brandId || null,
      cardType: issueForm.cardType,
    };
    if (issueForm.purchaseCents) payload.purchaseCents = Math.round(parseFloat(issueForm.purchaseCents) * 100);
    if (issueForm.discountPercent) payload.discountPercent = parseFloat(issueForm.discountPercent);
    setIssueBusy(true);
    try {
      const res = await api.payments.issueGiftCards(payload);
      setIssuedCodes(res.codes || []);
      setIssueSummary({ amountCents: res.amountCents, purchaseCents: res.purchaseCents, count: res.codes?.length || 0 });
      await refresh();
    } catch (err) {
      alert(`Could not issue gift cards: ${err.message}`);
    } finally {
      setIssueBusy(false);
    }
  };

  const voidCard = (id) => act(`void-${id}`, () => api.payments.voidGiftCard(id), () => loadCards(cardFilter));
  const resetCard = (id) => act(`reset-${id}`, () => api.payments.resetGiftCard(id), () => loadCards(cardFilter));

  const copyCode = (code) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  const activeBrands = brands.filter((b) => b.active);

  return (
    <div className="admin-giftcards">
      <div className="admin-page-header">
        <div className="header-left">
          <h1>Gift Cards</h1>
          <p>Manage brands, issue cards, and track gift card revenue</p>
        </div>
        <div className="payout-actions">
          <button className="btn-secondary" onClick={() => openBrandModal(null)}>
            <EditIcon size={16} /> New Brand
          </button>
          <button className="btn-primary" onClick={() => { setIssuedCodes([]); setIssueSummary(null); setShowIssueModal(true); }}>
            <GiftIcon size={16} /> Issue Gift Cards
          </button>
        </div>
      </div>

      <div className="gc-tabs">
        {[
          { id: 'brands', label: 'Brands', icon: PackageIcon },
          { id: 'issue', label: 'Issue', icon: GiftIcon },
          { id: 'analytics', label: 'Analytics', icon: ChartIcon },
          { id: 'cards', label: 'Cards', icon: DollarIcon },
          { id: 'designs', label: 'Designs', icon: EyeIcon },
        ].map((t) => (
          <button
            key={t.id}
            className={`gc-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => { setTab(t.id); if (t.id === 'cards') loadCards(cardFilter); if (t.id === 'designs') loadDesigns(designFilter); }}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {loading && tab !== 'cards' ? (
        <div className="admin-loading">Loading...</div>
      ) : (
        <>
          {tab === 'brands' && (
            <div className="gc-section">
              <div className="gc-brand-grid">
                {brands.map((brand) => (
                  <div key={brand.id} className={`gc-brand-admin ${brand.active ? '' : 'inactive'}`}>
                    <div className="gc-brand-admin-art">
                      {brand.front_image ? (
                        <img src={brand.front_image} alt={brand.name} />
                      ) : (
                        <div className="gc-brand-art-fallback"><span>{brand.name}</span></div>
                      )}
                      {brand.back_image && (
                        <div className="gc-brand-art-back">
                          <img src={brand.back_image} alt={`${brand.name} back`} />
                          <span className="gc-art-tag">Back</span>
                        </div>
                      )}
                    </div>
                    <div className="gc-brand-admin-info">
                      <div className="gc-brand-admin-row">
                        <strong>{brand.name}</strong>
                        <span className="gc-brand-cat">{brand.category}</span>
                      </div>
                      <p>{brand.description || 'No description'}</p>
                      <span className={`status-badge ${brand.active ? 'status-active' : 'status-cancelled'}`}>
                        {brand.active ? 'Active' : 'Deactivated'}
                      </span>
                    </div>
                    <div className="gc-brand-admin-actions">
                      <button className="btn-sm btn-secondary" onClick={() => openBrandModal(brand)} disabled={!!busy}><EditIcon size={14} /> Edit</button>
                      <button className="btn-sm btn-secondary" onClick={() => toggleBrand(brand)} disabled={!!busy}>
                        {brand.active ? <BanIcon size={14} /> : <RefreshIcon size={14} />}
                        {brand.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {brands.length === 0 && (
                <div className="gc-empty"><AlertIcon size={20} /> No brands yet — create your first brand.</div>
              )}
            </div>
          )}

          {tab === 'issue' && (
            <div className="gc-section">
              {issuedCodes.length === 0 ? (
                <div className="gc-issue-panel">
                  <p className="gc-section-hint">Issue one or many codes. Purchase price defaults to the card value (0% discount) unless you set a purchase price or discount below.</p>
                  <div className="gc-form-row">
                    <div className="gc-form-field">
                      <label className="gift-label">Face Value (USD)</label>
                      <input className="gift-input" type="number" min="1" value={issueForm.amount} onChange={(e) => setIssueForm({ ...issueForm, amount: e.target.value })} />
                    </div>
                    <div className="gc-form-field">
                      <label className="gift-label">Count</label>
                      <input className="gift-input" type="number" min="1" max="100" value={issueForm.count} onChange={(e) => setIssueForm({ ...issueForm, count: e.target.value })} />
                    </div>
                  </div>
                  <div className="gc-form-row">
                    <div className="gc-form-field">
                      <label className="gift-label">Brand</label>
                      <select className="gift-input" value={issueForm.brandId} onChange={(e) => setIssueForm({ ...issueForm, brandId: e.target.value })}>
                        <option value="">Generic (TRADE-…)</option>
                        {activeBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    <div className="gc-form-field">
                      <label className="gift-label">Card Type</label>
                      <select className="gift-input" value={issueForm.cardType} onChange={(e) => setIssueForm({ ...issueForm, cardType: e.target.value })}>
                        <option value="digital">Digital</option>
                        <option value="physical">Physical</option>
                      </select>
                    </div>
                  </div>
                  <div className="gc-form-row">
                    <div className="gc-form-field">
                      <label className="gift-label">Purchase Price (USD, optional)</label>
                      <input className="gift-input" type="number" min="0" placeholder="Auto = face value" value={issueForm.purchaseCents} onChange={(e) => setIssueForm({ ...issueForm, purchaseCents: e.target.value })} />
                    </div>
                    <div className="gc-form-field">
                      <label className="gift-label">Discount % (optional, 0–90)</label>
                      <input className="gift-input" type="number" min="0" max="90" placeholder="e.g. 10" value={issueForm.discountPercent} onChange={(e) => setIssueForm({ ...issueForm, discountPercent: e.target.value })} />
                    </div>
                  </div>
                  <button className="btn-primary gc-issue-btn" disabled={issueBusy} onClick={handleIssue}>
                    {issueBusy ? 'Generating...' : <><GiftIcon size={16} /> Generate Codes</>}
                  </button>
                </div>
              ) : (
                <div className="gc-section">
                  <p className="gift-note">
                    {issueSummary?.count || issuedCodes.length} code(s) issued at {fmt(issueSummary?.amountCents)} face value{issueSummary?.purchaseCents && issueSummary.purchaseCents !== issueSummary.amountCents ? ` · purchased at ${fmt(issueSummary.purchaseCents)}` : ''}. Share securely — each code can be redeemed once.
                  </p>
                  <div className="gift-codes">
                    {issuedCodes.map((code) => (
                      <div key={code} className="gift-code-row">
                        <span className="gift-code">{code}</span>
                        <button className="btn-sm btn-secondary" onClick={() => copyCode(code)}>
                          {copied === code ? <CheckIcon size={14} /> : <RefreshIcon size={14} />} {copied === code ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="payout-actions" style={{ marginTop: 16 }}>
                    <button className="btn-secondary" onClick={() => { setIssuedCodes([]); setIssueSummary(null); }}>Issue More</button>
                    <button className="btn-primary" onClick={() => { setIssuedCodes([]); setIssueSummary(null); setShowIssueModal(false); setTab('brands'); }}>Done</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'analytics' && analytics && (
            <div className="gc-section">
              <div className="stats-grid gc-stats">
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(59,130,246,0.15)', color: '#3B82F6' }}><PackageIcon size={20} /></div>
                  <div className="stat-info">
                    <div className="stat-value">{analytics.issuedCount}</div>
                    <div className="stat-label">Cards Issued</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: '#10B981' }}><GiftIcon size={20} /></div>
                  <div className="stat-info">
                    <div className="stat-value">{fmt(analytics.issuedValue)}</div>
                    <div className="stat-label">Face Value Issued</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(233,69,96,0.15)', color: 'var(--accent)' }}><DollarIcon size={20} /></div>
                  <div className="stat-info">
                    <div className="stat-value">{fmt(analytics.margin)}</div>
                    <div className="stat-label">Platform Margin</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ background: 'rgba(251,191,36,0.15)', color: '#F59E0B' }}><CheckIcon size={20} /></div>
                  <div className="stat-info">
                    <div className="stat-value">{fmt(analytics.redeemedValue)}</div>
                    <div className="stat-label">Redeemed Value</div>
                  </div>
                </div>
              </div>

              <div className="gc-section">
                <h3 className="gc-sub-title">Outstanding balance</h3>
                <div className="gc-balance-grid">
                  <div className="gc-balance-cell"><span>Active cards</span><strong>{analytics.activeCount}</strong></div>
                  <div className="gc-balance-cell"><span>Active value</span><strong>{fmt(analytics.activeValue)}</strong></div>
                  <div className="gc-balance-cell"><span>Redeemed</span><strong>{analytics.redeemedCount}</strong></div>
                  <div className="gc-balance-cell"><span>Voided</span><strong>{analytics.voidedCount}</strong></div>
                </div>
              </div>

              <div className="gc-section">
                <h3 className="gc-sub-title">By brand</h3>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Brand</th>
                      <th>Issued</th>
                      <th>Value</th>
                      <th>Redeemed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.byBrand.map((b) => (
                      <tr key={b.id}>
                        <td>{b.name}</td>
                        <td>{b.issued}</td>
                        <td>{fmt(b.value)}</td>
                        <td>{fmt(b.redeemed_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'cards' && (
            <div className="gc-section">
              <div className="payout-actions" style={{ marginBottom: 16 }}>
                {['all', 'active', 'redeemed', 'voided', 'expired'].map((s) => (
                  <button
                    key={s}
                    className={`btn-sm ${cardFilter === s ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setCardFilter(s)}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              <div className="gc-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Brand</th>
                      <th>Type</th>
                      <th>Face</th>
                      <th>Purchase</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((c) => (
                      <tr key={c.id}>
                        <td className="gc-code-cell">{c.code}</td>
                        <td>{c.brand_name || 'Generic'}</td>
                        <td className="gc-cap">{c.card_type || 'digital'}</td>
                        <td>{fmt(c.original_cents)}</td>
                        <td>{c.purchase_cents ? fmt(c.purchase_cents) : '—'}</td>
                        <td><span className={`status-badge ${(CARD_STATUS[c.status] || {}).cls || 'status-pending'}`}>{(CARD_STATUS[c.status] || {}).label || c.status}</span></td>
                        <td>
                          <div className="payout-actions">
                            {c.status === 'active' && (
                              <button className="btn-sm btn-secondary" disabled={!!busy} onClick={() => voidCard(c.id)}><BanIcon size={14} /> Void</button>
                            )}
                            {['redeemed', 'voided', 'expired'].includes(c.status) && (
                              <button className="btn-sm btn-secondary" disabled={!!busy} onClick={() => resetCard(c.id)}><RefreshIcon size={14} /> Reset</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {cards.length === 0 && (
                      <tr><td colSpan="7"><div className="gc-empty">No cards match this filter.</div></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'designs' && (
            <div className="gc-section">
              <div className="payout-actions" style={{ marginBottom: 16 }}>
                {['all', 'pending', 'approved', 'rejected'].map((s) => (
                  <button
                    key={s}
                    className={`btn-sm ${designFilter === s ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setDesignFilter(s)}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              <div className="gc-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Image</th>
                      <th>User</th>
                      <th>Brand</th>
                      <th>Note</th>
                      <th>Submitted</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {designs.map((d) => (
                      <tr key={d.id}>
                        <td className="gc-design-cell">
                          <img src={d.image_url} alt="design" onClick={() => window.open(d.image_url, '_blank')} />
                        </td>
                        <td>{d.user_name || d.user_id}</td>
                        <td>{d.brand_name || '—'}</td>
                        <td className="gc-design-note">{d.note || '—'}</td>
                        <td>{d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}</td>
                        <td><span className={`status-badge ${(CARD_STATUS[d.status] || {}).cls || 'status-pending'}`}>{(CARD_STATUS[d.status] || {}).label || d.status}</span></td>
                        <td>
                          <div className="payout-actions">
                            {d.status === 'pending' && (
                              <>
                                <button className="btn-sm btn-primary" disabled={!!busy} onClick={() => setDesignStatus(d.id, 'approved')}><CheckIcon size={14} /> Approve</button>
                                <button className="btn-sm btn-secondary" disabled={!!busy} onClick={() => setDesignStatus(d.id, 'rejected')}><BanIcon size={14} /> Reject</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {designs.length === 0 && (
                      <tr><td colSpan="7"><div className="gc-empty">No designs match this filter.</div></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {showBrandModal && (
        <div className="gift-modal-overlay" onClick={() => { if (!busy) setShowBrandModal(false); }}>
          <div className="gift-modal gc-brand-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gift-modal-header">
              <h3>{editingBrand ? 'Edit Brand' : 'New Brand'}</h3>
              <button className="gift-modal-close" onClick={() => { if (!busy) setShowBrandModal(false); }}>×</button>
            </div>
            <div className="gift-modal-body">
              <div className="gc-form-row">
                <div className="gc-form-field">
                  <label className="gift-label">Name *</label>
                  <input className="gift-input" value={brandForm.name} onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })} />
                </div>
                <div className="gc-form-field">
                  <label className="gift-label">Category</label>
                  <input className="gift-input" value={brandForm.category} onChange={(e) => setBrandForm({ ...brandForm, category: e.target.value })} />
                </div>
              </div>
              <div className="gc-form-field">
                <label className="gift-label">Description</label>
                <input className="gift-input" value={brandForm.description} onChange={(e) => setBrandForm({ ...brandForm, description: e.target.value })} />
              </div>
              <div className="gc-form-row">
                {[['frontImage', 'Front image'], ['backImage', 'Back image']].map(([key, label]) => (
                  <div className="gc-form-field" key={key}>
                    <label className="gift-label">{label}</label>
                    <label className={`gc-upload-box ${brandForm[key] ? 'has-img' : ''}`}>
                      {brandForm[key] ? (
                        <>
                          <img src={brandForm[key]} alt={label} />
                          <span className="gc-upload-remove" role="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBrandForm((f) => ({ ...f, [key]: '' })); }}>×</span>
                        </>
                      ) : (
                        <span>{uploadingImg === key ? 'Uploading...' : 'Browse from folder'}</span>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        disabled={!!uploadingImg}
                        onChange={(e) => uploadImage(e.target.files?.[0], key)}
                      />
                    </label>
                  </div>
                ))}
              </div>
              <label className="gc-checkbox">
                <input type="checkbox" checked={brandForm.active} onChange={(e) => setBrandForm({ ...brandForm, active: e.target.checked })} />
                Active (shown to buyers)
              </label>
              <div className="payout-actions" style={{ marginTop: 4 }}>
                <button className="btn-secondary" onClick={() => setShowBrandModal(false)}>Cancel</button>
                <button className="btn-primary" disabled={!!busy} onClick={saveBrand}>
                  {busy ? 'Saving...' : <><CheckIcon size={16} /> Save Brand</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showIssueModal && (
        <div className="gift-modal-overlay" onClick={() => { if (!issueBusy) setShowIssueModal(false); }}>
          <div className="gift-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gift-modal-header">
              <h3>Issue Gift Cards</h3>
              <button className="gift-modal-close" onClick={() => { if (!issueBusy) setShowIssueModal(false); }}>×</button>
            </div>
            <div className="gift-modal-body">
              <div className="gc-form-row">
                <div className="gc-form-field">
                  <label className="gift-label">Face Value (USD)</label>
                  <input className="gift-input" type="number" min="1" value={issueForm.amount} onChange={(e) => setIssueForm({ ...issueForm, amount: e.target.value })} />
                </div>
                <div className="gc-form-field">
                  <label className="gift-label">Count</label>
                  <input className="gift-input" type="number" min="1" max="100" value={issueForm.count} onChange={(e) => setIssueForm({ ...issueForm, count: e.target.value })} />
                </div>
              </div>
              <div className="gc-form-row">
                <div className="gc-form-field">
                  <label className="gift-label">Brand</label>
                  <select className="gift-input" value={issueForm.brandId} onChange={(e) => setIssueForm({ ...issueForm, brandId: e.target.value })}>
                    <option value="">Generic (TRADE-…)</option>
                    {activeBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="gc-form-field">
                  <label className="gift-label">Type</label>
                  <select className="gift-input" value={issueForm.cardType} onChange={(e) => setIssueForm({ ...issueForm, cardType: e.target.value })}>
                    <option value="digital">Digital</option>
                    <option value="physical">Physical</option>
                  </select>
                </div>
              </div>
              <div className="gc-form-row">
                <div className="gc-form-field">
                  <label className="gift-label">Purchase Price (USD, optional)</label>
                  <input className="gift-input" type="number" min="0" placeholder="Auto = face value" value={issueForm.purchaseCents} onChange={(e) => setIssueForm({ ...issueForm, purchaseCents: e.target.value })} />
                </div>
                <div className="gc-form-field">
                  <label className="gift-label">Discount %</label>
                  <input className="gift-input" type="number" min="0" max="90" placeholder="e.g. 10" value={issueForm.discountPercent} onChange={(e) => setIssueForm({ ...issueForm, discountPercent: e.target.value })} />
                </div>
              </div>
              <button className="btn-primary gc-issue-btn" disabled={issueBusy} onClick={handleIssue}>
                {issueBusy ? 'Generating...' : <><GiftIcon size={16} /> Generate Codes</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
