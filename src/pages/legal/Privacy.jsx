import { DraftNotice, LegalHeader, LegalSection } from './LegalShell';
import { useLegalMount } from './legalRoutes';

function Privacy() {
  useLegalMount();

  return (
    <div className="legal-shell">
      <LegalHeader title="Privacy Policy" />
      <div className="legal-doc">
        <h1 className="legal-doc-title">Privacy Policy</h1>
        <p className="legal-doc-updated">Draft version. Last updated: 28 September 2026.</p>
        <DraftNotice />

        <LegalSection title="1. Who we are and what this covers">
          <p>
            This policy explains what personal information <strong>Tradehub</strong> collects when
            you use our site and apps, why we collect it, who we share it with, and what you can ask
            us to do. It covers visitors, registered users, and buyers and sellers.
          </p>
          <p>
            &ldquo;Personal information&rdquo; means anything that identifies you, or that can be
            linked back to you, including your name, email address, phone number, location, photos,
            messages, listings, and payment and transaction history.
          </p>
        </LegalSection>

        <LegalSection title="2. What we collect">
          <h3 className="legal-h3">2.1 Information you give us</h3>
          <ul>
            <li>Registration details: name, email address, password, and profile photo.</li>
            <li>Verification details, such as identity documents, where you ask to become a verified seller.</li>
            <li>Listings: photos, descriptions, prices, condition, and location.</li>
            <li>Messages you send to other users, and the attachments you share.</li>
            <li>Offers, orders, disputes, reviews, and ratings.</li>
            <li>Support requests and reports you file.</li>
          </ul>

          <h3 className="legal-h3">2.2 Information collected automatically</h3>
          <ul>
            <li>Device and browser type, operating system, and language.</li>
            <li>IP address, and the approximate location derived from it.</li>
            <li>Pages viewed, search terms, and how you interact with the site.</li>
            <li>Push notification and messaging tokens used to deliver notifications.</li>
            <li>Records of security events, such as sign-in attempts and failed verification.</li>
          </ul>

          <h3 className="legal-h3">2.3 Information from third parties</h3>
          <ul>
            <li>If you sign in with Google or Facebook, we receive the identifier, name, email address, and profile picture that provider shares with us. We do not receive your password for that provider.</li>
            <li>Payment providers confirm to us the payment status, amounts, and the last four digits of the payment method. They do not give us your full card number.</li>
            <li>Fraud and security providers may return risk scores and signals about an account or transaction.</li>
          </ul>
        </LegalSection>

        <LegalSection title="3. Why we use it, and on what legal basis">
          <ul>
            <li><strong>To run the marketplace:</strong> to create your account, show your listings, deliver messages, take payments, and provide payouts. This is necessary to perform the contract with you.</li>
            <li><strong>To keep the service safe and lawful:</strong> to verify identity, prevent fraud and abuse, investigate reports, and comply with legal obligations. This is necessary for our legitimate interests and for legal compliance.</li>
            <li><strong>To improve the service:</strong> to understand which features are used and fix faults. This is our legitimate interest; you can opt out as described below.</li>
            <li><strong>To communicate:</strong> to send service messages about your account, transactions, and listings. These are necessary to run the service.</li>
            <li><strong>For marketing:</strong> to send offers or news where you have agreed to receive them. This relies on your consent, which you can withdraw at any time.</li>
            <li><strong>To meet legal duties:</strong> to keep transaction, tax, and dispute records for the period the law requires.</li>
          </ul>
        </LegalSection>

        <LegalSection title="4. Who we share it with">
          <p>We share personal information only where it is necessary, and with:</p>
          <ul>
            <li><strong>Other users.</strong> Your public profile, listings, reviews, and ratings are visible to others. Messages stay between the participants, except where we must intervene for safety or a legal request.</li>
            <li><strong>Service providers.</strong> Hosting, payment, messaging, email delivery, analytics, and fraud prevention providers, who process information on our instructions and must keep it confidential.</li>
            <li><strong>The other party to a transaction.</strong> When you buy or sell, the other party sees the details needed to complete the transaction, such as name, contact details, and delivery information.</li>
            <li><strong>Authorities.</strong> Where we must, to comply with law, protect safety, or respond to a valid legal process. We will tell you unless the law forbids it.</li>
            <li><strong>A buyer or successor.</strong> If we sell or transfer the service or part of it, we will give the recipient the same protection these terms require.</li>
          </ul>
          <p>
            We do not sell your personal information for money, and we do not share it for other
            companies&rsquo; marketing.
          </p>
        </LegalSection>

        <LegalSection title="5. How long we keep it">
          <p>
            We keep personal information for as long as your account is active, and for as long as
            needed afterwards to meet legal, tax, fraud prevention, and dispute purposes. Records we
            must keep for tax or legal reasons are typically retained for the statutory period in
            your country, commonly six to ten years for transaction records. When information is no
            longer needed we delete or anonymise it.
          </p>
        </LegalSection>

        <LegalSection title="6. Cookies and similar technologies">
          <p>
            We use cookies and similar technologies to keep you signed in, remember your preferences,
            understand which features are used, and protect against fraud. Some are strictly
            necessary; others help us improve the service. Where required, we ask for consent before
            setting optional cookies, and you can change your choice at any time in your browser or
            through our cookie settings.
          </p>
        </LegalSection>

        <LegalSection title="7. Your rights">
          <p>
            Where the law gives you rights over your personal information, you can ask us to:
          </p>
          <ul>
            <li>give you a copy of the information we hold about you;</li>
            <li>correct anything that is wrong or incomplete;</li>
            <li>delete information we no longer have a reason to keep;</li>
            <li>restrict or object to how we use it, including for direct marketing;</li>
            <li>receive it in a portable, machine-readable format;</li>
            <li>ask us to correct information held by a payment provider, which we will forward to them.</li>
          </ul>
          <p>
            Use <a href="/report">Report a Problem</a> or <a href="/contact">Contact Us</a> to make a
            request. We aim to answer within 30 days. We may ask you to confirm your identity first.
            You also have the right to complain to your local data protection authority.
          </p>
        </LegalSection>

        <LegalSection title="8. Security and international transfers">
          <p>
            We protect personal information with encryption in transit, access controls, and limits on
            who can see it. No system is completely secure, so contact us promptly if you think your
            account or data has been compromised.
          </p>
          <p>
            Your information may be processed in countries other than your own, including where our
            providers are located. Where that happens we use appropriate safeguards, such as standard
            contractual clauses.
          </p>
        </LegalSection>

        <LegalSection title="9. Children">
          <p>
            The service is not intended for anyone under 18, or the age of majority where they live.
            We do not knowingly collect information from children. If you believe a child has given
            us information, contact us and we will delete it.
          </p>
        </LegalSection>

        <LegalSection title="10. Changes to this policy">
          <p>
            We may update this policy. If a change materially affects how we use your information we
            will tell you in the app or by email before it takes effect.
          </p>
        </LegalSection>

        <LegalSection title="11. How to contact us">
          <p>
            For any privacy question, or to exercise a right, use{' '}
            <a href="/contact">Contact Us</a>. You can also <a href="/report">report a problem</a>.
            <br />
            <strong>Before publishing:</strong> add the registered company name, the postal address
            for privacy notices, the data protection officer or representative where one is required,
            and the supervisory authority where one applies in your jurisdiction.
          </p>
        </LegalSection>
      </div>
    </div>
  );
}

export default Privacy;
