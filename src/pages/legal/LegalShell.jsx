import { useState } from 'react';
import { navigateToLegalPath } from './legalRoutes';
import './Legal.css';

export function LegalHeader({ title, onBack }) {
  const handleBack = () => {
    if (onBack) return onBack();
    if (window.history.length > 1) return window.history.back();
    return navigateToLegalPath('/');
  };

  return (
    <header className="legal-header">
      <button type="button" className="legal-back" onClick={handleBack} aria-label="Go back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
        Back
      </button>
      <span className="legal-header-title">{title}</span>
    </header>
  );
}

export function LegalSection({ title, children }) {
  return (
    <section className="legal-section">
      <h2 className="legal-h2">{title}</h2>
      <div className="legal-body">{children}</div>
    </section>
  );
}

export function DraftNotice() {
  return (
    <p className="legal-doc-intro">
      <strong>Draft for review.</strong> This text was written as a starting point and has not
      been reviewed by a lawyer. Confirm it reflects how your business actually operates, and
      that it satisfies the consumer, data-protection and marketplace rules that apply where you
      are registered, before you rely on it.
    </p>
  );
}

const FAQ_ITEMS = [
  {
    q: 'How do I reset my password?',
    a: 'Select Forgot Password on the sign-in screen and enter the email address on your account. We will email you a link that lets you choose a new password. The link expires after one hour. If it expires before you use it, request a new one. For your security we send the same confirmation whether or not an account exists with that address.',
  },
  {
    q: 'Why can I not sign in with Google or Facebook?',
    a: 'Social sign-in has to be switched on for the site before it can work. If the buttons are not shown on the sign-in screen, social sign-in is not currently available. You can always sign in with the email address and password on your account.',
  },
  {
    q: 'How do I list something for sale?',
    a: 'Open Sell from the bottom navigation, add photos and a description, set your price, and publish. Your listing goes live as soon as it is published, subject to our review of prohibited items.',
  },
  {
    q: 'Is it safe to pay another user directly?',
    a: 'We recommend paying through Tradehub so your payment and delivery are recorded. Payments made outside the platform are not covered if something goes wrong, and we may be unable to help you recover the money. Never send money to someone you have not verified, and be wary of anyone asking you to move to a different payment method.',
  },
  {
    q: 'A seller is asking me to pay outside Tradehub. What should I do?',
    a: 'Treat it as a warning sign and decline. Report the seller from their profile so our team can review the account. We will not ask you to pay anyone outside the platform, and messages asking you to do so are a common scam.',
  },
  {
    q: 'How do I report a problem with a listing or a user?',
    a: 'Open the listing or the seller profile and use the report option, or go to Report a Problem for anything else such as payments, your account, or a technical fault. Include as much detail as you can, including dates and screenshots, because it helps us act faster.',
  },
  {
    q: 'What happens to my data if I delete my account?',
    a: 'Your profile and personal details are removed. Some records are kept where we are legally required to retain them, for example transaction and dispute records needed for tax, fraud prevention, or a complaint that is still open. See our Privacy Policy for the detail.',
  },
  {
    q: 'Can I get a refund?',
    a: 'If an item is not as described, contact us through Report a Problem within 30 days of delivery and include photographs. Payments made through Tradehub are covered, subject to the seller being given a chance to respond. Refunds for payments made outside the platform cannot be handled by us.',
  },
  {
    q: 'Do you charge any fees?',
    a: 'Listing items is free. We may charge a fee when a sale completes, and some optional paid features are available. Any fee is shown clearly before you pay, and we never add charges afterwards.',
  },
  {
    q: 'I cannot open the app properly on my phone. What should I try?',
    a: 'Check that you have a stable connection, then fully close and reopen the app. If the problem continues, report it through Report a Problem with your device model and the steps that lead to the fault, so we can reproduce it.',
  },
];

export function Faq() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="legal-shell">
      <LegalHeader title="Frequently Asked Questions" />
      <div className="legal-doc">
        <h1 className="legal-doc-title">Frequently Asked Questions</h1>
        <p className="legal-doc-updated">Answers to the questions we are asked most often.</p>
        <div className="legal-body">
          {FAQ_ITEMS.map((item, i) => (
            <div className="legal-faq-item" key={item.q}>
              <button
                type="button"
                className="legal-faq-q"
                onClick={() => setOpenIndex(openIndex === i ? -1 : i)}
                aria-expanded={openIndex === i}
              >
                <span>{item.q}</span>
                <svg
                  className={`legal-faq-caret${openIndex === i ? ' open' : ''}`}
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {openIndex === i && (
                <div className="legal-faq-a">
                  <p>{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="legal-actions">
          <button type="button" className="legal-submit secondary" onClick={() => navigateToLegalPath('/contact')}>
            Contact support
          </button>
          <button type="button" className="legal-submit" onClick={() => navigateToLegalPath('/report')}>
            Report a problem
          </button>
        </div>
      </div>
    </div>
  );
}
