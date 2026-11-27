import { DraftNotice, LegalHeader, LegalSection } from './LegalShell';
import { useLegalMount } from './legalRoutes';

function Terms() {
  useLegalMount();

  return (
    <div className="legal-shell">
      <LegalHeader title="Terms of Service" />
      <div className="legal-doc">
        <h1 className="legal-doc-title">Terms of Service</h1>
        <p className="legal-doc-updated">Draft version. Last updated: 27 November 2026.</p>
        <DraftNotice />

        <LegalSection title="1. Who these terms apply to">
          <p>
            These terms are a contract between you and <strong>TradeHub</strong> (we, us, our). They
            apply whenever you browse, buy, sell, message another user, or otherwise use the site or
            our apps, whether you are a registered user or just visiting.
          </p>
          <p>
            By creating an account or using the site you accept these terms. If you do not accept
            them, do not use the site. If you use the site on behalf of a company, you confirm you
            are authorised to bind that company, and &quot;you&quot; refers to that company.
          </p>
        </LegalSection>

        <LegalSection title="2. What we provide">
          <p>
            TradeHub is a marketplace. We help people who want to buy or sell items find each other.
            We are not the seller or the buyer in any transaction: the person you deal with is the
            other party, and your contract for the item is with them, not with us.
          </p>
          <p>
            We provide the site, hosting, messaging, search, payment facilitation, and related tools.
            We may add, change, or withdraw features. We may also suspend or limit any account where
            we reasonably believe these terms or the law has been broken.
          </p>
        </LegalSection>

        <LegalSection title="3. Your account">
          <h3 className="legal-h3">3.1 Eligibility</h3>
          <p>
            You must be at least 18 years old, or the age of majority where you live, to open an
            account and to enter into a binding contract. If you are under that age, do not use the
            site.
          </p>
          <h3 className="legal-h3">3.2 Accuracy</h3>
          <p>
            You must give accurate registration details and keep them current. You are responsible
            for activity on your account, so use a strong password and keep your login details to
            yourself. Tell us promptly if you think someone else has used your account.
          </p>
          <h3 className="legal-h3">3.3 Multiple accounts</h3>
          <p>
            Do not open more than one account, and do not operate an account for someone else. This
            helps us keep trust and safety checks meaningful.
          </p>
        </LegalSection>

        <LegalSection title="4. Buying and selling">
          <h3 className="legal-h3">4.1 Listings</h3>
          <p>
            When you list an item you promise that you own it or have the right to sell it, that it
            is not counterfeit, stolen, unsafe, or otherwise against the law, and that the
            description and photos are honest and show the actual item. You must not list anything
            prohibited, including weapons, recalled or unsafe goods, live animals, counterfeit
            items, and items whose sale is restricted in the country of either party.
          </p>
          <h3 className="legal-h3">4.2 Prices</h3>
          <p>
            Prices are set by sellers and shown in the listing. Fees and any delivery charges are
            shown before you pay. We never add charges after the fact.
          </p>
          <h3 className="legal-h3">4.3 Payment</h3>
          <p>
            Payments are processed by our payment providers. We may hold a payment while a listing
            is reviewed, while a dispute is open, or where we reasonably suspect fraud. We do not
            store your full card details.
          </p>
          <h3 className="legal-h3">4.4 Mandatory in-app escrow</h3>
          <p>
            All item payments must be completed through the platform&apos;s in-app escrow checkout.
            Sharing phone numbers, WhatsApp links, bank account details, or social media handles
            prior to checkout—or encouraging buyers to pay outside the app to avoid platform fees—is
            strictly prohibited and will result in immediate account suspension.
          </p>
          <h3 className="legal-h3">4.5 Delivery, inspection and acceptance</h3>
          <p>
            The parties agree how an item is delivered. Inspect the item as soon as you receive it
            and report any problem that does not match the listing. Where you accept an item or a
            reasonable time passes without a report, you may lose the right to reject it for
            condition problems.
          </p>
        </LegalSection>

        <LegalSection title="5. Seller pricing, P2P fees, escrow and anti-circumvention">
          <h3 className="legal-h3">5.1 Commission structure &amp; calculation</h3>
          <p>
            Sellers on the Basic Plan are charged a 10% platform commission on the final agreed item
            price of every completed order. Sellers on the Premium Plan ($11.99/month, inclusive of
            applicable local VAT/GST) are charged a 5% platform commission on the final agreed item
            price. Commissions are automatically deducted from the seller&apos;s payout upon order
            completion.
          </p>
          <h3 className="legal-h3">5.2 Peer-to-peer (P2P) shipping &amp; delivery</h3>
          <p>
            This platform operates as a peer-to-peer marketplace and does not provide logistics or
            courier services. Buyers and sellers are solely responsible for arranging and paying for
            delivery, local dispatch riders, waybills, or in-person handoffs directly. Shipping costs
            are not processed through the platform and are excluded from commission calculations.
          </p>
          <h3 className="legal-h3">5.3 Mandatory in-app escrow &amp; off-platform trading ban</h3>
          <p>
            All item payments must be completed through the platform&apos;s in-app escrow checkout.
            Sharing phone numbers, WhatsApp links, bank account details, or social media handles
            prior to checkout—or encouraging buyers to pay outside the app to avoid platform fees—is
            strictly prohibited and will result in immediate account suspension.
          </p>
          <h3 className="legal-h3">5.4 Price manipulation &amp; fee avoidance</h3>
          <p>
            Sellers must list the true, full price of the item. Artificially lowering an item&apos;s
            listed price and requesting the balance as an off-platform &quot;shipping&quot; or
            &quot;handling&quot; fee to reduce commission charges is a violation of these Terms and
            may result in permanent account termination and forfeiture of pending payouts.
          </p>
          <h3 className="legal-h3">5.5 Currency conversion &amp; cross-border settlements</h3>
          <p>
            Monthly Premium subscriptions ($11.99/month) and item payouts are displayed and settled
            in the user&apos;s local currency using prevailing exchange rates at the time of
            transaction. For cross-border orders, a standard foreign exchange conversion spread may
            apply during settlement.
          </p>
          <p>
            Sellers are responsible for their own taxes and must provide any information we
            reasonably need to report payments to the tax authorities. We may withhold payouts where
            we reasonably suspect fraud, where a dispute is open, or where we are legally required to
            do so.
          </p>
        </LegalSection>

        <LegalSection title="6. Prohibited conduct">
          <p>You must not, and must not allow anyone to:</p>
          <ul>
            <li>break any law, or the rights of another person;</li>
            <li>list or sell counterfeit, stolen, recalled, unsafe, or prohibited items;</li>
            <li>misrepresent who you are, where an item is, or its condition;</li>
            <li>harass, threaten, defame, or dox anyone;</li>
            <li>scrape, copy, reverse engineer, or overload the site, or interfere with its security;</li>
            <li>use bots, scripts, or automated tools to access the site without our written permission;</li>
            <li>circumvent fees, or use the site for money laundering or to move funds for others;</li>
            <li>attempt to buy or sell anything prohibited by law, including where you are located.</li>
          </ul>
        </LegalSection>

        <LegalSection title="7. Reviews, ratings and content">
          <p>
            You keep ownership of the content you post, and you give us a licence to host, display,
            and show it as part of the site. You must only post content you have the right to post.
            Reviews and ratings must relate to a real transaction. Reviews may be removed where they
            are false, offensive, or unlawful.
          </p>
        </LegalSection>

        <LegalSection title="8. Disputes and complaints">
          <p>
            Most problems are best solved between the two users. If you cannot agree, report the
            problem. We will review what both parties have provided and may refund, refund part of
            the payment, ask for more information, or take no action where the claim is not
            supported. Our decision on a dispute is final and binding for the parties to that
            dispute, except where local law gives you the right to a different remedy.
          </p>
        </LegalSection>

        <LegalSection title="9. Suspension and termination">
          <p>
            You can close your account at any time. We may suspend or close an account, and remove
            content, where we reasonably believe these terms or the law have been broken, or where
            we must do so. Where the law allows, we will tell you why. Ending your account does not
            remove responsibility for anything that happened before it ended.
          </p>
        </LegalSection>

        <LegalSection title="10. Our liability">
          <p>
            Nothing in these terms excludes or limits liability that cannot lawfully be excluded or
            limited, such as for death or personal injury caused by negligence, for fraud, or for
            anything else the law does not permit us to limit.
          </p>
          <p>
            Subject to that, we are not liable for indirect or consequential loss, loss of profit,
            loss of opportunity, loss of goodwill, or loss of data. Our total liability to you for
            any claim is limited to the greater of the amount you paid us in the twelve months before
            the claim, or 100. Nothing in these terms limits your right to a refund for an item that
            is not as described, or your statutory consumer rights.
          </p>
        </LegalSection>

        <LegalSection title="11. Indemnity">
          <p>
            You agree to indemnify us against claims, damages, and reasonable costs arising from your
            breach of these terms, your infringement of anyone else's rights, or your unlawful use
            of the site, to the extent the law allows us to recover this.
          </p>
        </LegalSection>

        <LegalSection title="12. Changes to these terms">
          <p>
            We may update these terms. If a change is material we will tell you in the app or by
            email before it takes effect. Your continued use of the site after that means you accept
            the updated terms.
          </p>
        </LegalSection>

        <LegalSection title="13. Governing law">
          <p>
            These terms are governed by the laws of the place where the company running TradeHub is
            registered, and the courts there have exclusive jurisdiction, except that consumers keep
            any right to bring proceedings in their own country, and any mandatory local consumer
            protections still apply to you.
          </p>
        </LegalSection>

        <LegalSection title="14. How to contact us">
          <p>
            Questions about these terms: use <a href="/contact">Contact Us</a>. To raise a problem
            with the service or another user, use <a href="/report">Report a Problem</a>, which
            records your report against your account.
          </p>
        </LegalSection>
      </div>
    </div>
  );
}

export default Terms;
