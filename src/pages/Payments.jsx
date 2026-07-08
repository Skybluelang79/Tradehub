import { useState } from 'react';
import { Header } from '../components/layout';
import { Badge, Button } from '../components/ui';
import Modal from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { ShieldIcon, PlusIcon, CheckIcon, ClockIcon } from '../components/ui/Icons';
import { useApp } from '../context';
import { formatPrice, formatDate } from '../utils/helpers';
import '../styles/globals.css';
import './Payments.css';

const escrowSteps = [
  { key: 'pending', label: 'Payment in Escrow', desc: 'Funds held securely' },
  { key: 'completed', label: 'Released to Seller', desc: 'Buyer confirmed receipt' },
];

export default function Payments() {
  const { paymentMethods, addPaymentMethod, removePaymentMethod, setDefaultPaymentMethod, transactions, completeTransaction, items } = useApp();
  const { addToast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [newCard, setNewCard] = useState({ type: 'visa', last4: '', expiry: '', name: '', isDefault: false });
  const [showEscrowInfo, setShowEscrowInfo] = useState(false);

  const handleAddCard = () => {
    if (newCard.last4.length === 4 && newCard.expiry && newCard.name) {
      addPaymentMethod(newCard);
      setNewCard({ type: 'visa', last4: '', expiry: '', name: '', isDefault: false });
      setShowAddModal(false);
    } else {
      addToast('Please fill in all card details', 'error');
    }
  };

  const handleRemoveCard = (methodId) => {
    removePaymentMethod(methodId);
  };

  const handleSetDefault = (methodId) => {
    setDefaultPaymentMethod(methodId);
  };

  const handleReleasePayment = (txnId) => {
    completeTransaction(txnId);
    addToast('Payment released to seller!', 'success');
  };

  const filteredTransactions = transactions.filter((t) => {
    if (filter === 'all') return true;
    return t.type === filter;
  });

  return (
    <div className="page">
      <Header title="Payments" subtitle="Manage your payment methods" />

      <div className="buyer-protection-card" onClick={() => setShowEscrowInfo(true)} style={{ cursor: 'pointer' }}>
        <div className="protection-icon"><ShieldIcon size={24} /></div>
        <div className="protection-content">
          <h3 className="protection-title">Buyer Protection</h3>
          <p className="protection-text">All payments are secured with escrow. Your money is held safely until you confirm receipt of the item.</p>
          <span className="protection-learn">Tap to learn more →</span>
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <h2 className="section-title">Payment Methods</h2>
        </div>

        {paymentMethods.length === 0 && (
          <div className="empty-state" style={{ padding: '20px' }}>
            <p className="empty-text" style={{ marginBottom: 12 }}>No payment methods added yet</p>
          </div>
        )}

        {paymentMethods.map((method) => (
          <div key={method.id} className="payment-card-item">
            <div className={`card-brand-icon ${method.type}`}>{method.type.toUpperCase()}</div>
            <div className="card-details">
              <div className="card-number">•••• •••• •••• {method.last4}</div>
              <div className="card-expiry">Expires {method.expiry}</div>
            </div>
            {method.isDefault && <span className="default-tag">Default</span>}
            <div className="card-actions">
              {!method.isDefault && <button className="card-action-btn" onClick={() => handleSetDefault(method.id)}>Set Default</button>}
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
          filteredTransactions.map((txn) => (
            <div key={txn.id} className="transaction-item">
              <div className="transaction-icon">
                {txn.status === 'pending' ? (
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
                <div className="transaction-title">{txn.itemTitle}</div>
                <div className="transaction-date">{formatDate(txn.createdAt)}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  {txn.status === 'pending' && (
                    <>
                      <span className="transaction-status pending">Escrow</span>
                      <Badge variant="warning" style={{ fontSize: 10 }}>Awaiting Confirmation</Badge>
                    </>
                  )}
                  {txn.status === 'completed' && (
                    <span className="transaction-status completed">Completed</span>
                  )}
                  {txn.status === 'refunded' && (
                    <span className="transaction-status refunded">Refunded</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                <div className={`transaction-amount ${txn.type}`}>
                  {txn.type === 'received' ? '+' : '-'}{formatPrice(txn.amount)}
                </div>
                {txn.status === 'pending' && txn.type === 'received' && (
                  <button className="release-btn" onClick={() => handleReleasePayment(txn.id)}>
                    <CheckIcon size={14} />
                    Release
                  </button>
                )}
                {txn.status === 'pending' && txn.type === 'sent' && (
                  <span className="escrow-badge">
                    <ShieldIcon size={12} />
                    In Escrow
                  </span>
                )}
              </div>
            </div>
          ))
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
    </div>
  );
}
