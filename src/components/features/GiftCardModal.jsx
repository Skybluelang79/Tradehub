import { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import { api } from '../../services/client';
import './GiftCardModal.css';

function CardFace({ brand, side }) {
  const image = side === 'front' ? brand.front_image : brand.back_image;
  const tag = side === 'front' ? 'Front' : 'Back';
  if (image) {
    return (
      <div className="gcm-face">
        <img src={image} alt={side === 'front' ? brand.name : `${brand.name} back`} />
        <span className="gcm-face-tag">{tag}</span>
      </div>
    );
  }
  return (
    <div className="gcm-face gcm-face-fallback">
      <span className="gcm-fallback-name">{side === 'front' ? brand.name : 'Scratch to reveal'}</span>
      <span className="gcm-fallback-sub">{side === 'front' ? 'Gift Card' : 'Code on back'}</span>
      <span className="gcm-face-tag">{tag}</span>
    </div>
  );
}

export default function GiftCardModal({ isOpen, onClose }) {
  const [brands, setBrands] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    api.payments.giftCardMall()
      .then((r) => {
        if (cancelled) return;
        setBrands(r.brands || []);
        setError('');
      })
      .catch(() => {
        if (!cancelled) setError('Could not load gift card brands');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleClose = () => {
    setSelected(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Gift Cards">
      {loading ? (
        <div className="gcm-state">Loading brands...</div>
      ) : error ? (
        <div className="gcm-state gcm-state-error">{error}</div>
      ) : brands.length === 0 ? (
        <div className="gcm-state">No gift card brands available right now.</div>
      ) : selected ? (
        <div className="gcm-detail">
          <button type="button" className="gcm-back" onClick={() => setSelected(null)}>
            ← All brands
          </button>
          <div className="gcm-preview">
            <CardFace brand={selected} side="front" />
            <CardFace brand={selected} side="back" />
          </div>
          <p className="gcm-description">
            {selected.description || `${selected.name} gift cards are redeemable for store credit.`}
          </p>
        </div>
      ) : (
        <div className="gcm-grid">
          {brands.map((brand) => (
            <button key={brand.id} type="button" className="gcm-card" onClick={() => setSelected(brand)}>
              <span className="gcm-card-frame">
                {brand.front_image ? (
                  <img src={brand.front_image} alt={brand.name} className="gcm-card-img" />
                ) : (
                  <span className="gcm-face gcm-face-fallback gcm-frame-fallback">
                    <span className="gcm-fallback-name">{brand.name}</span>
                    <span className="gcm-fallback-sub">Gift Card</span>
                  </span>
                )}
              </span>
              <span className="gcm-card-meta">
                <span className="gcm-card-name">{brand.name}</span>
                <span className="gcm-cat">{brand.category}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
