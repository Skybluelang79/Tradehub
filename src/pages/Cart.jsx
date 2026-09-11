import { useState, useEffect } from 'react';
import { Header } from '../components/layout';
import { useApp } from '../context';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { payWithCard } from '../services/paystack';
import api from '../services/client';
import { formatPrice } from '../utils/helpers';
import '../components/layout/Header.css';
import './Cart.css';

export default function Cart({ onClose }) {
  const { cart, items, refreshCart, setSelectedItem, setActiveTab } = useApp();
  const { isAuthenticated, user: authUser } = useAuth();
  const { addToast } = useToast();

  const [method, setMethod] = useState('card');
  const [availableMethods, setAvailableMethods] = useState(null);
  const [promoCode, setPromoCode] = useState('');
  const [giftCode, setGiftCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }));
      return;
    }
    refreshCart();
    api.payments.options()
      .then((r) => {
        const methods = (r.methods || []).filter((m) => m.enabled !== false);
        setAvailableMethods(methods);
        if (methods.length) {
          const preferred = ['card', 'paystack_bank', 'bank', 'gift_card'].filter((id) => methods.some((m) => m.id === id));
          if (preferred.length) setMethod(preferred[0]);
        }
      })
      .catch(() => {});
  }, [isAuthenticated, refreshCart]);

  const subtotalCents = cart.reduce((s, it) => s + Math.round((it.sale_price || it.price) * it.quantity * 100), 0);
  const itemCount = cart.reduce((s, it) => s + it.quantity, 0);

  const handleOpenItem = (itemId) => {
    const item = items.find((i) => i.id === itemId);
    if (item) {
      setSelectedItem(item);
      if (onClose) onClose();
    }
  };

  const changeQuantity = async (itemId, quantity) => {
    if (quantity < 1) return;
    try {
      await api.payments.cart.update(itemId, quantity);
      await refreshCart();
    } catch (err) {
      addToast(err.message || 'Could not update quantity', 'error');
    }
  };

  const removeItem = async (itemId) => {
    try {
      await api.payments.cart.remove(itemId);
      await refreshCart();
    } catch (err) {
      addToast(err.message || 'Could not remove item', 'error');
    }
  };

  const clearCart = async () => {
    try {
      await api.payments.cart.clear();
      await refreshCart();
    } catch (err) {
      addToast(err.message || 'Could not clear cart', 'error');
    }
  };

  const handleCheckout = async () => {
    if (!cart.length) return;
    setBusy(true);
    setError('');
    setSuccess(false);
    try {
      const payload = { method: method === 'gift_card' ? 'card' : method };
      if (method === 'gift_card' && giftCode.trim()) payload.giftCardCode = giftCode.trim();
      if (promoCode.trim()) payload.promoCode = promoCode.trim();

      const res = await api.payments.cart.checkout(payload);

      if (res.paid) {
        setSuccess(true);
        await refreshCart();
        addToast('Purchase complete! Payment is held in escrow.', 'success');
        return;
      }

      if (res.demo) {
        setSuccess(true);
        await refreshCart();
        addToast('Purchase complete! Payment is held in escrow.', 'success');
        return;
      }

      await payWithCard({
        publicKey: res.publicKey,
        email: authUser?.email || '',
        amountCents: res.chargeCents || res.totalCents,
        currency: res.currency,
        reference: res.reference,
        accessCode: res.accessCode,
        authorizationUrl: res.authorizationUrl,
        onSuccess: async () => {
          await api.payments.verify(res.reference);
          setSuccess(true);
          await refreshCart();
          addToast('Purchase complete! Payment is held in escrow.', 'success');
        },
        onClose: () => {
          addToast('Payment cancelled. Your cart is still saved.', 'info');
          setBusy(false);
        },
        onError: (err) => {
          setError(err.message || 'Payment failed');
          setBusy(false);
        },
      });
    } catch (err) {
      setError(err.message || 'Payment failed');
      setBusy(false);
    }
  };

  const methodLabel = (id) => {
    switch (id) {
      case 'card':
        return 'Card / Paystack';
      case 'bank':
      case 'paystack_bank':
        return 'Bank Transfer';
      case 'gift_card':
        return 'Gift Card / Store Credit';
      default:
        return id;
    }
  };

  return (
    <div className="cart-page">
      <Header
        title="Cart"
        leftComponent={
          onClose && (
            <button className="header-btn" onClick={onClose}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )
        }
      />

      <div className="cart-content">
        {success && (
          <div className="cart-success">
            <div className="cart-success-icon">✓</div>
            <h3>Order placed!</h3>
            <p>Your payment is being processed and will be held in escrow until you confirm receipt.</p>
            <div className="cart-success-actions">
              <button className="cart-btn-primary" onClick={() => { if (onClose) onClose(); setActiveTab('home'); }}>Continue Browsing</button>
              <button className="cart-btn-secondary" onClick={() => { if (onClose) onClose(); setActiveTab('profile'); }}>View Purchases</button>
            </div>
          </div>
        )}

        {!success && cart.length === 0 && (
          <div className="empty-cart">
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
            </div>
            <h3>Your cart is empty</h3>
            <p>Add items you want to buy and check out here</p>
            <button className="browse-btn" onClick={() => { if (onClose) onClose(); setActiveTab('home'); }}>
              Start Browsing
            </button>
          </div>
        )}

        {!success && cart.length > 0 && (
          <>
            <div className="cart-count">
              {itemCount} {itemCount === 1 ? 'item' : 'items'} in your cart
              <button className="cart-clear-btn" onClick={() => { if (window.confirm('Remove all items from your cart?')) clearCart(); }}>
                Clear
              </button>
            </div>
            <div className="cart-items">
              {cart.map((item) => (
                <div className="cart-line" key={item.item_id} onClick={() => handleOpenItem(item.item_id)}>
                  <div className="cart-line-image" onClick={(e) => e.stopPropagation()}>
                    {item.image ? (
                      <img src={item.image} alt={item.title} />
                    ) : (
                      <div className="cart-line-placeholder">No image</div>
                    )}
                  </div>
                  <div className="cart-line-info">
                    <div className="cart-line-top">
                      <h3 className="cart-line-title">{item.title}</h3>
                      <button
                        className="cart-line-remove"
                        onClick={(e) => { e.stopPropagation(); removeItem(item.item_id); }}
                        title="Remove"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                    <p className="cart-line-seller">by {item.seller_name || 'Unknown seller'}</p>
                    <div className="cart-line-bottom">
                      <span className="cart-line-price">{formatPrice((item.sale_price || item.price) * item.quantity)}</span>
                      <div className="cart-qty-stepper" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => changeQuantity(item.item_id, item.quantity - 1)} disabled={busy}>−</button>
                        <span>{item.quantity}</span>
                        <button onClick={() => changeQuantity(item.item_id, item.quantity + 1)} disabled={busy}>+</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="cart-summary">
              <div className="cart-summary-row">
                <span>Subtotal</span>
                <span>{formatPrice(subtotalCents / 100)}</span>
              </div>

              <div className="cart-codes">
                <input
                  className="input"
                  placeholder="Promo code (optional)"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Gift card code (optional)"
                  value={giftCode}
                  onChange={(e) => setGiftCode(e.target.value)}
                />
              </div>

              {availableMethods && availableMethods.length > 1 && (
                <div className="cart-methods">
                  {availableMethods.map((m) => (
                    <button
                      key={m.id}
                      className={`cart-method ${method === m.id ? 'active' : ''}`}
                      onClick={() => setMethod(m.id)}
                    >
                      {methodLabel(m.id)}
                    </button>
                  ))}
                </div>
              )}

              {error && <p className="cart-error">{error}</p>}

              <button
                className="cart-checkout-btn"
                onClick={handleCheckout}
                disabled={busy}
              >
                {busy ? 'Processing…' : `Checkout · ${formatPrice(subtotalCents / 100)}`}
              </button>
              <p className="cart-escrow-note">Payments are held in escrow until you confirm you received your item.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}