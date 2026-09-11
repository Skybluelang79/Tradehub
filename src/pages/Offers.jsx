import { useState, useEffect, useCallback } from 'react';
import { Header } from '../components/layout';
import { useApp } from '../context';
import { useToast } from '../components/ui/Toast';
import api from '../services/client';
import { formatPrice, formatDate } from '../utils/helpers';
import { payWithCard } from '../services/paystack';
import './Offers.css';

const STATUS_LABELS = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  countered: 'Counter-Offered',
  cancelled: 'Withdrawn',
};

export default function Offers({ onClose }) {
  const { setSelectedItem, items } = useApp();
  const { addToast } = useToast();

  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [view, setView] = useState('incoming');
  const [busy, setBusy] = useState('');
  const [counterModal, setCounterModal] = useState(null);
  const [counterAmount, setCounterAmount] = useState('');
  const [counterNote, setCounterNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [inc, out] = await Promise.all([api.offers.incoming(), api.offers.outgoing()]);
      setIncoming(inc.offers || []);
      setOutgoing(out.offers || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const doAction = async (action, id, payload, toastMsg) => {
    setBusy(id);
    try {
      await action(id, payload);
      addToast(toastMsg, 'success');
      await load();
    } catch (err) {
      addToast(err.message || 'Action failed', 'error');
    } finally {
      setBusy('');
    }
  };

  const handleAccept = (id) => doAction(api.offers.accept, id, null, 'Offer accepted! Proceed to payment.');
  const handleDecline = (id) => doAction(api.offers.decline, id, { note: '' }, 'Offer declined.');
  const handleCancel = (id) => doAction(api.offers.cancel, id, null, 'Offer withdrawn.');

  const handleCounter = async () => {
    const cents = Math.round(Number(counterAmount) * 100);
    if (!cents || cents <= 0) { addToast('Enter a valid amount', 'error'); return; }
    setBusy(counterModal.id);
    try {
      await api.offers.counter(counterModal.id, { amountCents: cents, message: counterNote });
      addToast('Counter-offer sent!', 'success');
      setCounterModal(null);
      setCounterAmount('');
      setCounterNote('');
      await load();
    } catch (err) {
      addToast(err.message || 'Failed to send counter', 'error');
    } finally {
      setBusy('');
    }
  };

  const handlePay = async (offer) => {
    setBusy(offer.id);
    try {
      const res = await api.payments.createIntent({ itemId: offer.item_id, offerId: offer.id, method: 'card' });
      if (res.paid || res.demo) {
        addToast('Payment complete! Item is in escrow.', 'success');
        await load();
        return;
      }
      await payWithCard({
        publicKey: res.publicKey,
        email: res.email || '',
        amountCents: res.chargeCents,
        currency: res.currency,
        reference: res.reference,
        accessCode: res.accessCode,
        authorizationUrl: res.authorizationUrl,
        onSuccess: async () => {
          await api.payments.verify(res.reference);
          addToast('Payment complete! Item is in escrow.', 'success');
          await load();
        },
        onClose: () => addToast('Payment cancelled.', 'info'),
        onError: (err) => addToast(err.message || 'Payment failed', 'error'),
      });
    } catch (err) {
      addToast(err.message || 'Payment failed', 'error');
    } finally {
      setBusy('');
    }
  };

  const viewItem = (offer) => {
    const item = (items || []).find(i => i.id === offer.item_id);
    if (item) {
      setSelectedItem(item);
      if (onClose) onClose();
    }
  };

  const statusBadge = (status) => (
    <span className={`offer-status offer-status--${status}`}>{STATUS_LABELS[status] || status}</span>
  );

  const formatAmount = (cents) => formatPrice((cents || 0) / 100);

  const renderList = (list, role) => {
    if (!list.length) {
      return (
        <div className="offers-empty">
          <p>No {role} offers yet</p>
        </div>
      );
    }

    return (
      <div className="offers-list">
        {list.map((o) => (
          <div key={o.id} className="offer-card">
            <div className="offer-card-top">
              <div className="offer-image" onClick={() => viewItem(o)}>
                {o.item_image ? (
                  <img src={o.item_image} alt={o.item_title} />
                ) : (
                  <div className="offer-img-placeholder" />
                )}
              </div>
              <div className="offer-info" onClick={() => viewItem(o)}>
                <div className="offer-item-title">{o.item_title}</div>
                <div className="offer-prices">
                  <span className="offer-item-price">Listed at {formatPrice(o.item_price)}</span>
                  {o.item_sale_price && <span className="offer-sale-price">{formatPrice(o.item_sale_price)}</span>}
                </div>
              </div>
            </div>

            <div className="offer-card-body">
              <div className="offer-row">
                <span className="offer-label">{role === 'incoming' ? 'From' : 'To'}</span>
                <span className="offer-person">{role === 'incoming' ? o.buyer_name || 'Buyer' : o.seller_name || 'Seller'}</span>
              </div>
              <div className="offer-row">
                <span className="offer-label">Offer</span>
                <span className="offer-amount">{formatAmount(o.amount_cents)}</span>
              </div>
              {o.message && <p className="offer-message">{o.message}</p>}
              {o.responder_note && <p className="offer-note">Note: {o.responder_note}</p>}
              <div className="offer-row">
                <span className="offer-date">{formatDate(o.created_at)}</span>
                {statusBadge(o.status)}
              </div>
            </div>

            {o.status === 'pending' && (
              <div className="offer-actions">
                {role === 'incoming' ? (
                  <>
                    <button className="offer-btn offer-btn--accept" onClick={() => handleAccept(o.id)} disabled={busy === o.id}>
                      Accept
                    </button>
                    <button className="offer-btn offer-btn--counter" onClick={() => { setCounterModal(o); setCounterAmount((o.amount_cents / 100).toFixed(2)); }} disabled={busy === o.id}>
                      Counter
                    </button>
                    <button className="offer-btn offer-btn--decline" onClick={() => handleDecline(o.id)} disabled={busy === o.id}>
                      Decline
                    </button>
                  </>
                ) : (
                  <button className="offer-btn offer-btn--cancel" onClick={() => handleCancel(o.id)} disabled={busy === o.id}>
                    Withdraw
                  </button>
                )}
              </div>
            )}

            {o.status === 'accepted' && role === 'outgoing' && (
              <div className="offer-actions">
                <button className="offer-btn offer-btn--pay" onClick={() => handlePay(o)} disabled={busy === o.id}>
                  {busy === o.id ? 'Processing…' : `Pay ${formatAmount(o.amount_cents)}`}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const totalIncoming = incoming.filter(o => o.status === 'pending').length;
  const totalOutgoing = outgoing.filter(o => o.status === 'pending').length;

  return (
    <div className="offers-page">
      <Header
        title="Offers"
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
      <div className="offers-content">
        <div className="offers-tabs">
          <button className={`offers-tab ${view === 'incoming' ? 'active' : ''}`} onClick={() => setView('incoming')}>
            Incoming {totalIncoming > 0 && <span className="tab-badge">{totalIncoming}</span>}
          </button>
          <button className={`offers-tab ${view === 'outgoing' ? 'active' : ''}`} onClick={() => setView('outgoing')}>
            Outgoing {totalOutgoing > 0 && <span className="tab-badge">{totalOutgoing}</span>}
          </button>
        </div>

        {view === 'incoming' ? renderList(incoming, 'incoming') : renderList(outgoing, 'outgoing')}

        {counterModal && (
          <div className="counter-modal-overlay" onClick={() => setCounterModal(null)}>
            <div className="counter-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Counter-Offer</h3>
              <p className="counter-modal-title">On "{counterModal.item_title}" (offer: {formatAmount(counterModal.amount_cents)})</p>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0.01"
                value={counterAmount}
                onChange={(e) => setCounterAmount(e.target.value)}
                placeholder="Your counter amount"
              />
              <textarea
                className="input"
                rows={2}
                maxLength={500}
                value={counterNote}
                onChange={(e) => setCounterNote(e.target.value)}
                placeholder="Add a note (optional)"
              />
              <div className="counter-modal-actions">
                <button className="offer-btn offer-btn--cancel" onClick={() => setCounterModal(null)}>Cancel</button>
                <button className="offer-btn offer-btn--accept" onClick={handleCounter} disabled={!counterAmount || busy === counterModal.id}>
                  Send Counter
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}