import { useState, useEffect } from 'react';
import { Header } from '../components/layout';
import { Button } from '../components/ui';
import { GiftCardModal } from '../components/features';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/client';
import { GiftIcon, XIcon, CheckIcon } from '../components/ui/Icons';
import './GiftMall.css';

function GiftIconSvg({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

function UploadIconSvg({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export default function GiftMall({ onClose }) {
  const { isAuthenticated } = useAuth();
  const { addToast } = useToast();
  const [brands, setBrands] = useState([]);
  const [showGiftCardModal, setShowGiftCardModal] = useState(false);

  const [designFile, setDesignFile] = useState(null);
  const [designPreview, setDesignPreview] = useState('');
  const [designBrand, setDesignBrand] = useState('');
  const [designNote, setDesignNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api.payments.giftCardMall().then((r) => {
      setBrands(r.brands || []);
    }).catch(() => addToast('Could not load gift card brands', 'error'));
  }, [addToast]);

  const browseFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast('Please choose an image file', 'error');
      return;
    }
    setDesignFile(file);
    const reader = new FileReader();
    reader.onload = () => setDesignPreview(reader.result);
    reader.readAsDataURL(file);
    setSubmitted(false);
  };

  const handleSubmitDesign = async () => {
    if (!designFile) {
      addToast('Browse for a card image from your folder first', 'error');
      return;
    }
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }));
      return;
    }
    setUploading(true);
    try {
      const res = await api.upload.single(designFile);
      const url = res?.file?.url || res?.url;
      if (!url) throw new Error('Upload returned no URL');
      await api.payments.submitGiftCardDesign({
        imageUrl: url,
        brandId: designBrand || null,
        note: designNote,
      });
      setSubmitted(true);
      setDesignFile(null);
      setDesignPreview('');
      setDesignNote('');
      setDesignBrand('');
      addToast('Design submitted for review!', 'success');
    } catch (err) {
      addToast(err.message || 'Could not submit design', 'error');
    } finally {
      setUploading(false);
    }
  };

  const activeUploadBtn = isAuthenticated ? 'Submit Design' : 'Sign in to Submit';

  return (
    <div className="gift-mall">
      <div className="gift-mall-topbar">
        <Header title="Gift Mall" subtitle="Browse gift card brands and share your own card designs" />
        <button className="gift-mall-close" onClick={onClose} aria-label="Close Gift Mall">
          <XIcon size={24} />
        </button>
      </div>

      <div className="section">
        <div className="section-header">
          <h2 className="section-title">Browse Brands</h2>
          <span className="gift-mall-upload-icon"><GiftIconSvg size={20} /></span>
        </div>
        <p className="gift-mall-hint">
          Browse sample gift card designs from each brand in our catalog, arranged in a handy modal.
        </p>
        <Button block onClick={() => setShowGiftCardModal(true)}>Browse Gift Cards</Button>
      </div>

      <div className="section">
        <div className="section-header">
          <h2 className="section-title">Share Your Card Design</h2>
          <span className="gift-mall-upload-icon"><GiftIconSvg size={20} /></span>
        </div>
        <p className="gift-mall-hint">
          Browse your folder for a gift card design you'd like us to offer. We'll review it and may add it to the mall.
        </p>

        {submitted ? (
          <div className="gift-mall-success">
            <CheckIcon size={20} />
            <span>Thanks! Your design is in review.</span>
            <Button block onClick={() => setSubmitted(false)}>Submit Another</Button>
          </div>
        ) : (
          <div className="gift-mall-uploader">
            <label className={`gift-mall-drop ${designPreview ? 'has-preview' : ''}`}>
              {designPreview ? (
                <img src={designPreview} alt="Your card design" />
              ) : (
                <>
                  <UploadIconSvg />
                  <span className="gift-mall-drop-title">Browse your folder</span>
                  <span className="gift-mall-drop-sub">Tap to pick a card image from your device</span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => browseFile(e.target.files?.[0])}
              />
            </label>

            {designPreview && (
              <div className="gift-mall-design-form">
                <div className="input-group">
                  <label className="input-label">Related brand (optional)</label>
                  <select className="input" value={designBrand} onChange={(e) => setDesignBrand(e.target.value)}>
                    <option value="">Generic gift card</option>
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Note (optional)</label>
                  <input className="input" placeholder="e.g. A festive holiday design" value={designNote} onChange={(e) => setDesignNote(e.target.value)} />
                </div>
                <div className="gift-mall-design-actions">
                  <Button
                    block
                    onClick={handleSubmitDesign}
                    disabled={uploading || !designFile}
                  >
                    {uploading ? 'Uploading...' : activeUploadBtn}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <GiftCardModal isOpen={showGiftCardModal} onClose={() => setShowGiftCardModal(false)} />
    </div>
  );
}
