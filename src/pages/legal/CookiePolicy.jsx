import { DraftNotice, LegalHeader, LegalSection } from './LegalShell';
import { useLegalMount } from './legalRoutes';

function CookiePolicy() {
  useLegalMount();

  return (
    <div className="legal-shell">
      <LegalHeader title="Cookie Policy" />
      <div className="legal-doc">
        <h1 className="legal-doc-title">Cookie Policy</h1>
        <p className="legal-doc-updated">Last updated: 11 November 2026.</p>
        <DraftNotice />

        <LegalSection title="1. Cookies and similar storage">
          <p>
            Cookies are small text files that a site stores on your device. TradeHub also uses
            similar technologies such as <strong>local storage</strong>, which keeps small amounts of
            data in your browser. In this policy we refer to all of these together as
            &ldquo;cookies&rdquo;.
          </p>
          <p>
            Some of this storage is essential for the site to work, for example keeping you signed
            in. Other storage is optional and is used to remember your preferences or to understand
            how the site is used.
          </p>
        </LegalSection>

        <LegalSection title="2. The categories we use">
          <h3 className="legal-h3">Strictly necessary</h3>
          <p>
            These are required to run the site and cannot be switched off through our banner. They
            include the sign-in token that keeps you logged in, security and fraud-prevention data,
            and the record of your cookie choices.
          </p>

          <h3 className="legal-h3">Preferences</h3>
          <p>
            These remember choices you make, such as your theme, language, recently viewed listings,
            recent searches, and chat encryption keys stored on your device. Turning them off means
            those choices are not remembered between visits.
          </p>

          <h3 className="legal-h3">Analytics</h3>
          <p>
            These help us understand which pages and features are used so we can improve the site.
            They are optional and are only used where you have agreed to them.
          </p>

          <h3 className="legal-h3">Marketing</h3>
          <p>
            These are used to measure campaigns and show relevant offers. They are optional and are
            only used where you have agreed to them. We do not use them to sell your personal
            information.
          </p>
        </LegalSection>

        <LegalSection title="3. What we store on your device">
          <p>
            The main items TradeHub stores in your browser are listed below. The exact set can change
            as the product develops.
          </p>
          <ul>
            <li><strong>tradehub_token</strong> &mdash; keeps you signed in (strictly necessary).</li>
            <li><strong>tradehub_admin_token</strong> &mdash; keeps an administrator signed in to the admin area (strictly necessary for admins).</li>
            <li><strong>tradehub_cookie_consent</strong> &mdash; remembers your cookie choices, including analytics and marketing preferences (strictly necessary).</li>
            <li><strong>tradehub_theme</strong> &mdash; remembers light or dark mode (preferences).</li>
            <li><strong>tradehub_lang</strong> &mdash; remembers your chosen language (preferences).</li>
            <li><strong>tradehub_recently_viewed</strong> and <strong>tradehub_recent_searches</strong> &mdash; local history used to improve your experience (preferences).</li>
            <li><strong>tradehub encryption and trusted-key data</strong> &mdash; stored locally so encrypted chats can be read on your device (preferences).</li>
          </ul>
        </LegalSection>

        <LegalSection title="4. Third-party services">
          <p>
            Some features rely on third parties who may set their own cookies or receive technical
            information when you use them. These include:
          </p>
          <ul>
            <li><strong>Payment providers</strong> (such as Paystack) for processing payments and payouts;</li>
            <li><strong>Sign-in providers</strong> (such as Google or Facebook) when you choose to sign in with them;</li>
            <li><strong>Hosting and infrastructure providers</strong> that deliver the site and store data;</li>
            <li><strong>Notification providers</strong> that deliver push or email messages; and</li>
            <li><strong>Font and asset providers</strong> that serve files used by the site.</li>
          </ul>
          <p>
            These providers have their own privacy and cookie policies, and we encourage you to read
            them.
          </p>
        </LegalSection>

        <LegalSection title="5. Managing your choices">
          <p>
            When you first visit, our banner lets you accept all cookies, reject optional cookies, or
            choose which categories to allow. You can change your choice at any time from the cookie
            settings in the app, or by clearing the saved consent in your browser.
          </p>
          <p>
            You can also block or delete cookies through your browser settings. If you block strictly
            necessary storage, you may be signed out and some features may not work. Blocking
            optional cookies does not stop you using the marketplace.
          </p>
        </LegalSection>

        <LegalSection title="6. How long storage lasts">
          <p>
            Some storage lasts only for your current visit, and some remains until it expires or you
            clear it. The sign-in token stays until it expires or you sign out. Preference and consent
            choices stay until you change them or clear your browser data. You can remove everything
            by clearing site data for TradeHub in your browser.
          </p>
        </LegalSection>

        <LegalSection title="7. More information">
          <p>
            For how we handle personal information more generally, see our{' '}
            <a href="/privacy">Privacy Policy</a>. For questions about this policy, use{' '}
            <a href="/contact">Contact Us</a>.
          </p>
        </LegalSection>
      </div>
    </div>
  );
}

export default CookiePolicy;
