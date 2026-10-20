import { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import { api } from '../../services/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../ui/Toast';
import { payWithCard } from '../../services/paystack';
import { formatPrice } from '../../utils/currency';
import './GiftCardModal.css';

const PRESETS = [1000, 2000, 5000, 10000, 20000];
const MIN_AMOUNT = 100;

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

export default function GiftCardModal({ isOpen, onClose, onPurchased }) {
  const { user, isAuthenticated } = useAuth();
  const { addToast } = useToast();
  const [brands, setBrands] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('5000');
  const [buying, setBuying] = useState(false);
  const [success, setSuccess] = useState(null);

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
    setSuccess(null);
    setBuying(false);
    setAmount('5000');
    onClose();
  };

  const openBrand = (brand) => {
    setSelected(brand);
    setSuccess(null);
    setAmount('5000');
  };

  const handleBuy = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < MIN_AMOUNT) {
      addToast(`Enter an amount of at least ${formatPrice(MIN_AMOUNT)}`, 'error');
      return;
    }
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }));
      return;
    }
    const amountCents = Math.round(value * 100);
    setBuying(true);
    try {
      const res = await api.payments.purchaseGiftCard({ brandId: selected.id, amountCents });
      if (res.paid) {
        setSuccess({ amountCents: res.amountCents, creditCents: res.creditCents, demo: !!res.demo });
        addToast(`${formatPrice(res.amountCents / 100)} added to your store credit`, 'success');
        onPurchased?.();
        setBuying(false);
        return;
      }
      payWithCard({
        publicKey: res.publicKey,
        email: user?.email,
        amountCents: res.amountCents,
        currency: res.currency,
        reference: res.reference,
        accessCode: res.accessCode,
        channels: ['card'],
        onSuccess: async (reference) => {
          try {
            const verified = await api.payments.verifyGiftCardPurchase(reference);
            setSuccess({
              amountCents: verified.card?.original_cents || res.amountCents,
              creditCents: verified.creditCents,
              demo: false,
            });
            addToast('Gift card purchase complete', 'success');
            onPurchased?.();
          } catch (err) {
            addToast(err.message || 'Could not verify the payment', 'error');
          } finally {
            setBuying(false);
          }
        },
        onClose: () => setBuying(false),
        onError: (err) => {
          addToast(err.message || 'Payment failed', 'error');
          setBuying(false);
        },
      });
    } catch (err) {
      addToast(err.message || 'Could not start the purchase', 'error');
      setBuying(false);
    }
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
          {success ? (
            <div className="gcm-success">
              <strong>{formatPrice(success.amountCents / 100)} added to your store credit</strong>
              <span>
                New balance: {formatPrice(success.creditCents / 100)}
                {success.demo ? ' (demo payment)' : ''}
              </span>
              <button type="button" className="btn-primary" onClick={handleClose}>Done</button>
            </div>
          ) : selected.sellable ? (
            <div className="gcm-buy">
              <h4>Buy this gift card</h4>
              <p>Pick an amount. The full value is added to your TradeHub store credit instantly.</p>
              <div className="gcm-presets">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`gcm-preset ${Number(amount) === preset ? 'active' : ''}`}
                    onClick={() => setAmount(String(preset))}
                  >
                    {formatPrice(preset)}
                  </button>
                ))}
              </div>
              <div className="input-group">
                <label className="input-label">Amount</label>
                <input
                  className="input"
                  type="number"
                  min={MIN_AMOUNT}
                  step="50"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <button type="button" className="btn-primary gcm-buy-btn" disabled={buying} onClick={handleBuy}>
                {buying ? 'Processing...' : `Buy for ${formatPrice(Number(amount) || 0)}`}
              </button>
            </div>
          ) : (
            <p className="gcm-hint">
              This card is catalog-only right now. You can redeem cards you already own from Payments.
            </p>
          )}
        </div>
      ) : (
        <div className="gcm-grid">
          {brands.map((brand) => (
            <button key={brand.id} type="button" className="gcm-card" onClick={() => openBrand(brand)}>
              <span className="gcm-card-frame">
                {brand.front_image ? (
                  <img src={brand.front_image} alt={brand.name} className="gcm-card-img" />
                ) : (
                  <span className="gcm-face gcm-face-fallback gcm-frame-fallback">
                    <span className="gcm-fallback-name">{brand.name}</span>
                    <span className="gcm-fallback-sub">Gift Card</span>
                  </span>
                )}
                {brand.sellable ? <span className="gcm-buy-tag">Buy</span> : null}
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
