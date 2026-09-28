import { useState } from 'react';
import { api } from '../../services/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { LegalHeader } from './LegalShell';
import { navigateToLegalPath, useLegalMount } from './legalRoutes';

const CATEGORIES = [
  { value: 'account', label: 'My account', hint: 'Sign-in trouble, a locked account, or a request to close your account.' },
  { value: 'payment', label: 'Payments or payouts', hint: 'A payment that did not go through, a missing refund, or a payout that has not arrived.' },
  { value: 'listing', label: 'A listing', hint: 'A listing that is wrong, miscategorised, prohibited, or should not be on the site.' },
  { value: 'technical', label: 'A technical problem', hint: 'An error, a page that will not load, or something that looks broken.' },
  { value: 'safety', label: 'Safety or a suspicious message', hint: 'Harassment, a scam, someone asking you to pay outside the platform, or anything threatening.' },
  { value: 'other', label: 'Something else', hint: 'Anything that does not fit the categories above.' },
];

const MAX_MESSAGE = 5000;

function ReportProblem() {
  useLegalMount();
  const { isAuthenticated } = useAuth();
  const addToast = useToast();

  const [category, setCategory] = useState('other');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!subject.trim()) return setError('Please add a short subject.');
    if (!message.trim()) return setError('Please describe the problem.');

    setBusy(true);
    try {
      await api.support.create({
        category,
        subject: subject.trim(),
        message: message.trim(),
        contactEmail: contactEmail.trim(),
      });
      setSent(true);
      addToast('Report sent. Our team will review it.', 'success');
    } catch (err) {
      const msg = err.message || 'Could not send your report. Please try again.';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="legal-shell">
        <LegalHeader title="Report a Problem" />
        <div className="legal-doc">
          <h1 className="legal-doc-title">Report a Problem</h1>
          <p className="legal-doc-updated">Sign in so we can attach your report to your account.</p>
          <div className="legal-body">
            <p>
              We need to know who you are before we can act on a report. This also means we can look
              up the listings, orders, and messages involved.
            </p>
          </div>
          <div className="legal-actions">
            <button
              type="button"
              className="legal-submit"
              onClick={() => window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }))}
            >
              Sign in to continue
            </button>
            <button type="button" className="legal-submit secondary" onClick={() => navigateToLegalPath('/contact')}>
              Contact support instead
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="legal-shell">
        <LegalHeader title="Report a Problem" />
        <div className="legal-doc">
          <h1 className="legal-doc-title">Thank you</h1>
          <p className="legal-doc-updated">Your report has been received.</p>
          <div className="legal-body">
            <p>
              We have logged your report against your account and a member of the team will review
              it. Keep any screenshots or messages you have, as they often help.
            </p>
            <p>
              If anyone is in immediate danger, contact your local emergency services first. We
              cannot provide emergency help.
            </p>
          </div>
          <div className="legal-actions">
            <button type="button" className="legal-submit secondary" onClick={() => navigateToLegalPath('/')}>
              Back to the site
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="legal-shell">
      <LegalHeader title="Report a Problem" />
      <div className="legal-doc">
        <h1 className="legal-doc-title">Report a Problem</h1>
        <p className="legal-doc-updated">
          Tell us what happened. The more detail you give, the faster we can act.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="legal-field">
            <label className="legal-label" htmlFor="report-category">What is this about?</label>
            <select
              id="report-category"
              className="legal-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <p className="legal-help">
              {CATEGORIES.find((c) => c.value === category)?.hint}
            </p>
          </div>

          <div className="legal-field">
            <label className="legal-label" htmlFor="report-subject">Subject</label>
            <input
              id="report-subject"
              className="legal-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="A short summary"
            />
          </div>

          <div className="legal-field">
            <label className="legal-label" htmlFor="report-message">What happened?</label>
            <textarea
              id="report-message"
              className="legal-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MAX_MESSAGE}
              placeholder="Include dates, times, listing names, and what you have already tried."
            />
            <p className="legal-help">{message.length} of {MAX_MESSAGE} characters</p>
          </div>

          <div className="legal-field">
            <label className="legal-label" htmlFor="report-email">Email for follow-up (optional)</label>
            <input
              id="report-email"
              className="legal-input"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="We will reply to your account email if you leave this blank"
            />
            <p className="legal-help">
              Never include passwords, card numbers, or one-time passcodes.
            </p>
          </div>

          {error && <div className="legal-status err">{error}</div>}

          <div className="legal-actions">
            <button type="submit" className="legal-submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
            <button type="button" className="legal-submit secondary" onClick={() => navigateToLegalPath('/faq')}>
              Read the FAQ first
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ReportProblem;
