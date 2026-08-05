import { useState, useEffect, useCallback } from 'react';
import { Header } from '../components/layout';
import { Badge, Button } from '../components/ui';
import Modal from '../components/ui/Modal';
import { GiftCardModal } from '../components/features';
import { useToast } from '../components/ui/Toast';
import { ShieldIcon, PlusIcon, CheckIcon, ClockIcon } from '../components/ui/Icons';
import { useApp } from '../context';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/client';
import { formatPrice, formatDate } from '../utils/helpers';
import '../styles/globals.css';
import './Payments.css';

const STATUS_LABELS = {
  awaiting_payment: 'Awaiting Payment',
  pending: 'In Escrow',
  completed: 'Completed',
  refunded: 'Refunded',
};

const PAYOUT_METHODS = [
  { id: 'bank', name: 'Bank Transfer', fields: ['accountName', 'accountNumber', 'routing'] },
  { id: 'crypto', name: 'Crypto Wallet', fields: ['address', 'network'] },
  { id: 'paypal', name: 'PayPal', fields: ['email'] },
];

function formatCents(cents) {
  return formatPrice((cents || 0) / 100);
}

export default function Payments() {
  const { paymentMethods, addPaymentMethod, removePaymentMethod, setDefaultPaymentMethod, transactions } = useApp();
  const { isAuthenticated, user: authUser } = useAuth();
  const { addToast } = useToast();

  const [showAddModal, setShowAddModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [newCard, setNewCard] = useState({ type: 'visa', last4: '', expiry: '', name: '', isDefault: false });
  const [showEscrowInfo, setShowEscrowInfo] = useState(false);

  const [wallet, setWallet] = useState(null);
  const [backendTransactions, setBackendTransactions] = useState(null);
  const [backendMethods, setBackendMethods] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [myId, setMyId] = useState(null);

  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [cardPreview, setCardPreview] = useState('');
  const [showGiftCardModal, setShowGiftCardModal] = useState(false);

  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('bank');
  const [payoutFields, setPayoutFields] = useState({});
  const [payoutBusy, setPayoutBusy] = useState(false);

  const [disputeTxn, setDisputeTxn] = useState(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeDetails, setDisputeDetails] = useState('');
  const [disputeBusy, setDisputeBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const [me, w, t, m, p] = await Promise.all([
        api.auth.me(),
        api.payments.wallet(),
        api.payments.transactions('all'),
        api.payments.methods(),
        api.payouts.list(),
      ]);
      setMyId(me.user?.id || authUser?.id);
      setWallet(w.wallet);
      setBackendTransactions(t.transactions);
      setBackendMethods(m.methods);
      setPayouts(p.payouts);
    } catch (err) {
      if (err.message !== 'Failed to fetch') {
        addToast(err.message || 'Could not load payment data', 'error');
      }
    }
  }, [isAuthenticated, authUser?.id, addToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeMethods = backendMethods ?? paymentMethods;
  const activeTransactions = backendTransactions ?? transactions;

  const handleAddCard = async () => {
    if (newCard.last4.length === 4 && newCard.expiry && newCard.name) {
      const [mm, yy] = newCard.expiry.split('/');
      if (!mm || !yy) {
        addToast('Enter expiry as MM/YY', 'error');
        return;
      }
      try {
        const res = await api.payments.addMethod({
          brand: newCard.type,
          last4: newCard.last4,
          exp_month: parseInt(mm, 10),
          exp_year: 2000 + parseInt(yy, 10),
          is_default: newCard.isDefault,
        });
        addToast('Card added', 'success');
        refresh();
        setNewCard({ type: 'visa', last4: '', expiry: '', name: '', isDefault: false });
        setShowAddModal(false);
        return res;
      } catch (err) {
        if (err.message === 'Failed to fetch') {
          addPaymentMethod(newCard);
          addToast('Card added (offline)', 'success');
          setNewCard({ type: 'visa', last4: '', expiry: '', name: '', isDefault: false });
          setShowAddModal(false);
          return;
        }
        addToast(err.message || 'Failed to add card', 'error');
      }
    } else {
      addToast('Please fill in all card details', 'error');
    }
  };

  const handleRemoveCard = async (methodId) => {
    try {
      await api.payments.removeMethod(methodId);
      refresh();
    } catch (err) {
      removePaymentMethod(methodId);
    }
  };

  const handleSetDefault = async (methodId) => {
    try {
      await api.payments.setDefault(methodId);
      refresh();
    } catch (err) {
      setDefaultPaymentMethod(methodId);
    }
  };

  const handleReleasePayment = async (txnId) => {
    try {
      await api.payments.confirm(txnId);
      addToast('Payment released to seller!', 'success');
      refresh();
    } catch (err) {
      addToast(err.message || 'Could not release payment', 'error');
    }
  };

  const handleRequestRefund = async (txn) => {
    try {
      await api.payments.refund(txn.id);
      addToast('Refund requested. Funds returned to your balance.', 'success');
      refresh();
    } catch (err) {
      addToast(err.message || 'Could not refund payment', 'error');
    }
  };

  const openDispute = (txn) => {
    setDisputeTxn(txn);
    setDisputeReason('');
    setDisputeDetails('');
  };

  const handleOpenDispute = async () => {
    if (!disputeTxn || !disputeReason) {
      addToast('Please choose a reason for the dispute', 'error');
      return;
    }
    setDisputeBusy(true);
    try {
      await api.disputes.open({ transactionId: disputeTxn.id, reason: disputeReason, description: disputeDetails });
      addToast('Dispute opened. A mediator will review it within 24 hours.', 'success');
      setDisputeTxn(null);
      refresh();
    } catch (err) {
      addToast(err.message || 'Could not open dispute', 'error');
    } finally {
      setDisputeBusy(false);
    }
  };

  const DISPUTE_REASONS = [
    'Item not as described',
    'Item not received',
    'Item damaged or defective',
    'Seller not responding',
    'Payment issue',
    'Other',
  ];

  const handleRedeem = async () => {
    if (!redeemCode.trim()) {
      addToast('Enter a gift card code', 'error');
      return;
    }
    try {
      const res = await api.payments.redeemGiftCard(redeemCode.trim());
      addToast(`Gift card redeemed! Added ${formatCents(res.balanceCents)} credit`, 'success');
      setRedeemCode('');
      setCardPreview('');
      setShowRedeemModal(false);
      refresh();
    } catch (err) {
      addToast(err.message || 'Could not redeem gift card', 'error');
    }
  };

  const browseCardImage = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast('Please choose an image file', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCardPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleRequestPayout = async () => {
    const amountCents = Math.round(parseFloat(payoutAmount || '0') * 100);
    if (!amountCents || amountCents < 100) {
      addToast('Enter an amount of at least $1.00', 'error');
      return;
    }
    const method = PAYOUT_METHODS.find((m) => m.id === payoutMethod);
    const missing = method.fields.some((f) => !payoutFields[f]?.trim());
    if (missing) {
      addToast('Please fill in all payout details', 'error');
      return;
    }
    if (wallet && amountCents > wallet.available_cents) {
      addToast('Amount exceeds available balance', 'error');
      return;
    }
    setPayoutBusy(true);
    try {
      await api.payouts.request({ amountCents, method: payoutMethod, details: payoutFields });
      addToast('Payout requested!', 'success');
      setShowPayoutModal(false);
      setPayoutAmount('');
      setPayoutFields({});
      refresh();
    } catch (err) {
      addToast(err.message || 'Could not request payout', 'error');
    } finally {
      setPayoutBusy(false);
    }
  };

  const handleCancelPayout = async (id) => {
    try {
      await api.payouts.cancel(id);
      addToast('Payout cancelled', 'success');
      refresh();
    } catch (err) {
      addToast(err.message || 'Could not cancel payout', 'error');
    }
  };

  const filteredTransactions = activeTransactions.filter((t) => {
    if (filter === 'all') return true;
    const type = t.buyer_id !== undefined && myId ? (t.seller_id === myId ? 'received' : 'sent') : t.type;
    return type === filter;
  });

  return (
    <div className="page">
      <Header title="Payments" subtitle="Manage your payments, wallet and payouts" />

      <div className="buyer-protection-card" onClick={() => setShowEscrowInfo(true)} style={{ cursor: 'pointer' }}>
        <div className="protection-icon"><ShieldIcon size={24} /></div>
        <div className="protection-content">
          <h3 className="protection-title">Buyer Protection</h3>
          <p className="protection-text">All payments are secured with escrow. Your money is held safely until you confirm receipt of the item.</p>
          <span className="protection-learn">Tap to learn more →</span>
        </div>
      </div>

      {wallet && (
        <div className="section">
          <div className="section-header">
            <h2 className="section-title">Wallet</h2>
            <button className="wallet-redeem-btn" onClick={() => setShowRedeemModal(true)}>Redeem Gift Card</button>
          </div>
          <div className="wallet-grid">
            <div className="wallet-cell">
              <span className="wallet-label">Store Credit</span>
              <span className="wallet-value accent">{formatCents(wallet.credit_cents)}</span>
            </div>
            <div className="wallet-cell">
              <span className="wallet-label">Available Balance</span>
              <span className="wallet-value">{formatCents(wallet.available_cents)}</span>
            </div>
            <div className="wallet-cell">
              <span className="wallet-label">Pending Payout</span>
              <span className="wallet-value">{formatCents(wallet.pending_cents)}</span>
            </div>
            <div className="wallet-cell">
              <span className="wallet-label">Lifetime Earnings</span>
              <span className="wallet-value">{formatCents(wallet.lifetime_cents)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-header">
          <h2 className="section-title">Gift Cards</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="wallet-redeem-btn" onClick={() => setShowGiftCardModal(true)}>Browse Brands</button>
            <button className="wallet-redeem-btn" onClick={() => window.dispatchEvent(new CustomEvent('openGiftMall'))}>Gift Mall</button>
            <button className="wallet-redeem-btn" onClick={() => setShowRedeemModal(true)}>Redeem a Card</button>
          </div>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
          Browse our gift card brands, share your own card design, or redeem a gift card balance to your store credit.
        </p>
        <button className="wallet-redeem-btn wallet-browse-btn" onClick={() => setShowGiftCardModal(true)}>
          View sample brand designs
        </button>
      </div>

      <div className="section">
        <div className="section-header">
          <h2 className="section-title">Payouts</h2>
        </div>
        {payouts.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px' }}>
            <p className="empty-text" style={{ marginBottom: 12 }}>Earn from sales, then request a payout to your bank, crypto wallet or PayPal.</p>
            <Button onClick={() => setShowPayoutModal(true)}>Request Payout</Button>
          </div>
        ) : (
          <>
            {payouts.map((p) => (
              <div key={p.id} className="transaction-item">
                <div className="transaction-icon">
                  {p.status === 'pending' ? <ClockIcon size={20} /> : <CheckIcon size={20} />}
                </div>
                <div className="transaction-info">
                  <div className="transaction-title">Payout · {p.method}</div>
                  <div className="transaction-date">{formatDate(p.created_at)}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                    <span className={`transaction-status ${p.status}`}>{STATUS_LABELS[p.status] || p.status}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                  <div className="transaction-amount">{formatCents(p.amount_cents)}</div>
                  {p.status === 'pending' && (
                    <button className="card-action-btn danger" onClick={() => handleCancelPayout(p.id)}>Cancel</button>
                  )}
                </div>
              </div>
            ))}
            <div style={{ marginTop: 12 }}>
              <Button block onClick={() => setShowPayoutModal(true)} disabled={!wallet || wallet.available_cents < 100}>
                {wallet && wallet.available_cents < 100 ? 'No available balance to withdraw' : 'Request Payout'}
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="section">
        <div className="section-header">
          <h2 className="section-title">Payment Methods</h2>
        </div>

        {activeMethods.length === 0 && (
          <div className="empty-state" style={{ padding: '20px' }}>
            <p className="empty-text" style={{ marginBottom: 12 }}>No payment methods added yet</p>
          </div>
        )}

        {activeMethods.map((method) => (
          <div key={method.id} className="payment-card-item">
            <div className={`card-brand-icon ${method.brand || method.type}`}>{(method.brand || method.type).toUpperCase()}</div>
            <div className="card-details">
              <div className="card-number">•••• •••• •••• {method.last4}</div>
              <div className="card-expiry">Expires {method.exp_month}/{method.exp_year}</div>
            </div>
            {method.is_default && <span className="default-tag">Default</span>}
            <div className="card-actions">
              {!method.is_default && <button className="card-action-btn" onClick={() => handleSetDefault(method.id)}>Set Default</button>}
              <button className="card-action-btn danger" onClick={() => handleRemoveCard(method.id)}>Remove</button>
            </div>
          </div>
        ))}

        <button className="add-card-btn" onClick={() => setShowAddModal(true)}>
          <PlusIcon size={20} />
          Add New Card
        </button>
      </div>

      <div className="section">
        <div className="section-header">
          <h2 className="section-title">Transaction History</h2>
        </div>

        <div className="filter-tabs">
          {['all', 'received', 'sent', 'pending'].map((f) => (
            <button key={f} className={`filter-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {filteredTransactions.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px 20px' }}>
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </div>
            <h3 className="empty-title">No transactions</h3>
            <p className="empty-text">Your transaction history will appear here</p>
          </div>
        ) : (
          filteredTransactions.map((txn) => {
            const isReceived = myId ? txn.seller_id === myId : txn.type === 'received';
            const status = txn.status === 'awaiting_payment' ? 'awaiting_payment' : txn.status;
            return (
              <div key={txn.id} className="transaction-item">
                <div className="transaction-icon">
                  {status === 'pending' ? (
                    <ClockIcon size={20} />
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  )}
                </div>
                <div className="transaction-info">
                  <div className="transaction-title">{txn.item_title || txn.itemTitle}</div>
                  <div className="transaction-date">{formatDate(txn.created_at || txn.createdAt)}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                    {status === 'awaiting_payment' && (
                      <span className="transaction-status awaiting_payment">Awaiting Payment</span>
                    )}
                    {status === 'pending' && (
                      <>
                        <span className="transaction-status pending">Escrow</span>
                        <Badge variant="warning" style={{ fontSize: 10 }}>Awaiting Confirmation</Badge>
                      </>
                    )}
                    {status === 'completed' && (
                      <span className="transaction-status completed">Completed</span>
                    )}
                    {status === 'refunded' && (
                      <span className="transaction-status refunded">Refunded</span>
                    )}
                    {status === 'disputed' && (
                      <span className="transaction-status disputed">Disputed</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                  <div className={`transaction-amount ${isReceived ? 'received' : 'sent'}`}>
                    {isReceived ? '+' : '-'}{formatPrice(txn.amount)}
                  </div>
                  {status === 'pending' && isReceived && (
                    <button className="release-btn" onClick={() => handleReleasePayment(txn.id)}>
                      <CheckIcon size={14} />
                      Release
                    </button>
                  )}
                  {status === 'pending' && !isReceived && (
                    <>
                      <span className="escrow-badge">
                        <ShieldIcon size={12} />
                        In Escrow
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="dispute-btn" onClick={() => openDispute(txn)}>
                          Dispute
                        </button>
                        <button className="dispute-btn refund" onClick={() => handleRequestRefund(txn)}>
                          Refund
                        </button>
                      </div>
                    </>
                  )}
                  {status === 'awaiting_payment' && !isReceived && (
                    <button className="dispute-btn" onClick={() => openDispute(txn)}>
                      Dispute
                    </button>
                  )}
                  {status === 'disputed' && (
                    <span className="escrow-badge">
                      <ShieldIcon size={12} />
                      Under Review
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <Modal isOpen={showEscrowInfo} onClose={() => setShowEscrowInfo(false)} title="How Escrow Works">
        <div className="escrow-info-list">
          <div className="escrow-step">
            <div className="escrow-step-num">1</div>
            <div>
              <strong>Buyer sends payment</strong>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>Funds are held securely in escrow</p>
            </div>
          </div>
          <div className="escrow-step">
            <div className="escrow-step-num">2</div>
            <div>
              <strong>Seller ships/delivers item</strong>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>Seller sends the item or meets in person</p>
            </div>
          </div>
          <div className="escrow-step">
            <div className="escrow-step-num">3</div>
            <div>
              <strong>Buyer confirms receipt</strong>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>Buyer inspects item and confirms it's as described</p>
            </div>
          </div>
          <div className="escrow-step">
            <div className="escrow-step-num">4</div>
            <div>
              <strong>Payment released to seller</strong>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>Funds are transferred to the seller</p>
            </div>
          </div>
          <div className="escrow-protection-note">
            <ShieldIcon size={16} />
            <span>Your payment is always protected. If something goes wrong, you're covered.</span>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add Card"
        footer={<Button block onClick={handleAddCard} disabled={!newCard.last4 || !newCard.expiry || !newCard.name}>Add Card</Button>}>
        <div className="modal-form">
          <div className="input-group">
            <label className="input-label">Card Type</label>
            <div className="card-type-selector">
              {['visa', 'mastercard', 'amex'].map((type) => (
                <div key={type} className={`card-type-option ${newCard.type === type ? 'active' : ''}`} onClick={() => setNewCard({ ...newCard, type })}>
                  <div className={`card-brand-icon ${type}`} style={{ width: 40, height: 28 }}>{type.toUpperCase().slice(0, 4)}</div>
                  <span>{type.charAt(0).toUpperCase() + type.slice(1)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="input-group">
            <label className="input-label">Card Number (last 4 digits)</label>
            <input type="text" className="input" placeholder="1234" maxLength={4} value={newCard.last4} onChange={(e) => setNewCard({ ...newCard, last4: e.target.value.replace(/\D/g, '') })} />
          </div>
          <div className="input-group">
            <label className="input-label">Expiry Date</label>
            <input type="text" className="input" placeholder="MM/YY" value={newCard.expiry} onChange={(e) => setNewCard({ ...newCard, expiry: e.target.value })} />
          </div>
          <div className="input-group">
            <label className="input-label">Cardholder Name</label>
            <input type="text" className="input" placeholder="Name on card" value={newCard.name} onChange={(e) => setNewCard({ ...newCard, name: e.target.value })} />
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={newCard.isDefault} onChange={(e) => setNewCard({ ...newCard, isDefault: e.target.checked })} />
            Set as default payment method
          </label>
        </div>
      </Modal>

      <Modal isOpen={showRedeemModal} onClose={() => { setShowRedeemModal(false); setRedeemCode(''); }} title="Redeem Gift Card"
        footer={<Button block onClick={handleRedeem} disabled={!redeemCode.trim()}>Redeem</Button>}>
        <div className="modal-form">
          <div className="input-group">
            <label className="input-label">Gift Card Code</label>
            <input type="text" className="input" placeholder="XXXX-XXXX-XXXX" value={redeemCode} onChange={(e) => setRedeemCode(e.target.value.toUpperCase())} />
          </div>
          <div className="input-group">
            <label className="input-label">Browse your card from your folder</label>
            <label className={`gc-browse-card ${cardPreview ? 'has-preview' : ''}`}>
              {cardPreview ? (
                <img src={cardPreview} alt="Your gift card" />
              ) : (
                <span className="gc-browse-card-placeholder">Browse… pick the card image to double-check the code</span>
              )}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => browseCardImage(e.target.files?.[0])}
              />
            </label>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            The balance will be added to your store credit and can be used at checkout.
          </p>
          <button type="button" className="wallet-redeem-btn wallet-browse-btn" onClick={() => setShowGiftCardModal(true)}>
            Not sure where the code is? View sample designs
          </button>
        </div>
      </Modal>

      <GiftCardModal isOpen={showGiftCardModal} onClose={() => setShowGiftCardModal(false)} />

      <Modal isOpen={showPayoutModal} onClose={() => { setShowPayoutModal(false); setPayoutFields({}); }} title="Request Payout"
        footer={
          <Button block onClick={handleRequestPayout} disabled={payoutBusy}>
            {payoutBusy ? 'Requesting...' : 'Request Payout'}
          </Button>
        }>
        <div className="modal-form">
          <div className="input-group">
            <label className="input-label">Amount (USD)</label>
            <input
              type="number"
              className="input"
              min="1"
              placeholder="e.g. 25.00"
              value={payoutAmount}
              onChange={(e) => setPayoutAmount(e.target.value)}
            />
            {wallet && <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 6 }}>Available: {formatCents(wallet.available_cents)}</p>}
          </div>
          <div className="input-group">
            <label className="input-label">Method</label>
            <div className="card-type-selector">
              {PAYOUT_METHODS.map((m) => (
                <div key={m.id} className={`card-type-option ${payoutMethod === m.id ? 'active' : ''}`} onClick={() => { setPayoutMethod(m.id); setPayoutFields({}); }}>
                  <span>{m.name}</span>
                </div>
              ))}
            </div>
          </div>
          {PAYOUT_METHODS.find((m) => m.id === payoutMethod).fields.map((f) => (
            <div className="input-group" key={f}>
              <label className="input-label">
                {f === 'accountName' ? 'Account Name' :
                  f === 'accountNumber' ? 'Account Number' :
                  f === 'routing' ? 'Routing Number' :
                  f === 'address' ? 'Wallet Address' :
                  f === 'network' ? 'Network (e.g. BTC, ETH)' :
                  'PayPal Email'}
              </label>
              <input
                type="text"
                className="input"
                value={payoutFields[f] || ''}
                onChange={(e) => setPayoutFields({ ...payoutFields, [f]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </Modal>

      <Modal isOpen={!!disputeTxn} onClose={() => setDisputeTxn(null)} title="Open a Dispute"
        footer={
          <Button block onClick={handleOpenDispute} disabled={disputeBusy || !disputeReason}>
            {disputeBusy ? 'Opening...' : 'Submit Dispute'}
          </Button>
        }>
        <div className="modal-form">
          {disputeTxn && (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
              {disputeTxn.item_title} · {formatPrice(disputeTxn.amount)}
            </p>
          )}
          <div className="input-group">
            <label className="input-label">Reason</label>
            <select className="input" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)}>
              <option value="">Select a reason…</option>
              {DISPUTE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Describe the issue (optional)</label>
            <textarea
              className="input"
              rows="3"
              placeholder="Tell the mediator what happened…"
              value={disputeDetails}
              onChange={(e) => setDisputeDetails(e.target.value)}
            />
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            <ShieldIcon size={12} /> Funds stay in escrow until the dispute is resolved. Our team reviews within 24 hours.
          </p>
        </div>
      </Modal>
    </div>
  );
}
