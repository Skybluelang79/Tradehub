import { useState } from 'react';
import { LegalHeader } from './LegalShell';
import { useLegalMount } from './legalRoutes';

const SUPPORT_EMAIL = 'support@tradehub.com';
const SUPPORT_HOURS = 'Monday to Saturday, 09:00 to 18:00';
const RESPONSE_TIME = 'We usually reply within one working day';

function Contact() {
  useLegalMount();
  const [copied, setCopied] = useState('');

  const copy = (value, label) => {
    const done = () => {
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(done);
    } else {
      done();
    }
  };

  return (
    <div className="legal-shell">
      <LegalHeader title="Contact Us" />
      <div className="legal-doc">
        <h1 className="legal-doc-title">Contact Us</h1>
        <p className="legal-doc-updated">We read every message. Here is the fastest way to reach us.</p>

        <ul className="legal-contact-list">
          <li>
            <span>Email support</span>
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </li>
          <li>
            <span>Support hours</span>
            <strong>{SUPPORT_HOURS}</strong>
          </li>
          <li>
            <span>Response time</span>
            <strong>{RESPONSE_TIME}</strong>
          </li>
        </ul>

        <div className="legal-actions">
          <button type="button" className="legal-submit" onClick={() => copy(SUPPORT_EMAIL, 'email')}>
            {copied === 'email' ? 'Copied' : 'Copy email address'}
          </button>
          <button type="button" className="legal-submit secondary" onClick={() => window.open('mailto:' + SUPPORT_EMAIL)}>
            Open mail app
          </button>
        </div>

        <section className="legal-section" style={{ marginTop: '32px' }}>
          <h2 className="legal-h2">How to get a faster answer</h2>
          <div className="legal-body">
            <p>Tell us these three things and we can usually sort it out in one message:</p>
            <ul>
              <li>the email address on the account, or the listing or order involved;</li>
              <li>what you were trying to do, and what happened instead;</li>
              <li>the date, the time, and any screenshots or reference numbers.</li>
            </ul>
            <p>
              Please do not send passwords, full card numbers, or the code from a one-time passcode
              message. We will never ask you for them, so any message claiming to be from us and
              asking for those is a scam.
            </p>
            <p>
              If the problem is with a specific listing or user, reporting it from the page is
              better than emailing, because the report is attached to that account and reaches the
              right team. Use <a href="/report">Report a Problem</a>.
            </p>
            <p>
              <strong>Before publishing:</strong> replace the placeholder support address and hours
              above with your real ones. A support address that does not receive mail will cost you
              more trust than it earns.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Contact;
