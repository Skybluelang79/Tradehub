import { useEffect, useRef, useState } from 'react';
import api from '../../services/client';
import { formatPrice } from '../../utils/helpers';
import { useToast } from '../ui/Toast';
import './BankTransferPanel.css';

const POLL_MS = 8000;

function copy(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error('Clipboard unavailable'));
}

/**
 * Shows the temporary Paystack account number minted for a Pay-with-Transfer
 * order and polls until the transfer lands. The webhook is what actually
 * confirms payment; this poll only nudges the UI.
 */
export default function BankTransferPanel({ reference, details, paid = false, onPaid }) {
  const { addToast } = useToast();
  const [status, setStatus] = useState(paid ? 'paid' : 'awaiting');
  const [current, setCurrent] = useState(details);
  const notified = useRef(paid);

  useEffect(() => {
    setCurrent(details);
  }, [details]);

  useEffect(() => {
    if (!reference || status === 'paid') return undefined;
    let cancelled = false;

    const check = async () => {
      try {
        const res = await api.payments.bankTransfer(reference);
        if (cancelled) return;
        if (res.bankTransfer) setCurrent(res.bankTransfer);
        if (res.paid) {
          setStatus('paid');
          if (!notified.current) {
            notified.current = true;
            addToast('Bank transfer received — payment is in escrow.', 'success');
            if (onPaid) onPaid(res);
          }
        }
      } catch {
        // A transient failure just waits for the next tick.
      }
    };

    check();
    const id = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [reference, status, addToast, onPaid]);

  const handleCopy = async (value, label) => {
    try {
      await copy(value);
      addToast(`${label} copied`, 'success');
    } catch {
      addToast('Could not copy — please copy it manually', 'error');
    }
  };

  if (!current) return null;

  const expires = current.expiresAt ? new Date(current.expiresAt) : null;
  const expired = expires && expires < new Date() && status !== 'paid';

  return (
    <div className={`bank-transfer ${status === 'paid' ? 'bank-transfer--paid' : ''}`}>
      <div className="bank-transfer-head">
        <span className="bank-transfer-badge">
          {status === 'paid' ? 'Paid' : expired ? 'Account expired' : 'Awaiting transfer'}
        </span>
        <span className="bank-transfer-amount">
          Pay exactly {formatPrice(current.amount, current.currency)}
        </span>
      </div>

      {current.bankName && (
        <div className="bank-transfer-row">
          <span className="bank-transfer-label">Bank</span>
          <span className="bank-transfer-value">{current.bankName}</span>
        </div>
      )}

      <div className="bank-transfer-row">
        <span className="bank-transfer-label">Account number</span>
        <button
          type="button"
          className="bank-transfer-value bank-transfer-copy"
          onClick={() => handleCopy(current.accountNumber, 'Account number')}
          title="Tap to copy"
        >
          {current.accountNumber}
          <span className="bank-transfer-copy-hint">Copy</span>
        </button>
      </div>

      {current.accountName && (
        <div className="bank-transfer-row">
          <span className="bank-transfer-label">Account name</span>
          <span className="bank-transfer-value">{current.accountName}</span>
        </div>
      )}

      {expires && status !== 'paid' && (
        <p className="bank-transfer-note">
          This account is reserved until {expires.toLocaleTimeString()} — transfer before then and the
          payment confirms automatically.
        </p>
      )}

      {status !== 'paid' && (
        <p className="bank-transfer-note bank-transfer-note--muted">
          <span className="loading-spinner" /> Waiting for your transfer…
        </p>
      )}
    </div>
  );
}
