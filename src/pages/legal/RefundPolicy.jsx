import { DraftNotice, LegalHeader, LegalSection } from './LegalShell';
import { useLegalMount } from './legalRoutes';

function RefundPolicy() {
  useLegalMount();

  return (
    <div className="legal-shell">
      <LegalHeader title="Refund Policy" />
      <div className="legal-doc">
        <h1 className="legal-doc-title">Refund Policy</h1>
        <p className="legal-doc-updated">Last updated: 11 November 2026.</p>
        <DraftNotice />

        <LegalSection title="1. How buyer protection works">
          <p>
            When you pay through TradeHub, your money is held in escrow. The seller is not paid
            immediately: funds are released after you confirm that the item arrived as described, or
            automatically after the protection period ends if no problem has been reported. This
            gives you time to inspect the item and raise a concern before the seller is paid.
          </p>
          <p>
            Escrow protection only applies to payments made through TradeHub. Payments made outside
            the platform, such as a direct bank transfer or a payment arranged in chat, are not
            covered and we may be unable to recover the money for you.
          </p>
        </LegalSection>

        <LegalSection title="2. When you can request a refund">
          <p>You may be eligible for a refund when:</p>
          <ul>
            <li>the item was never delivered;</li>
            <li>the item is significantly different from the listing, including the wrong size, model, colour, or quantity;</li>
            <li>the item arrived damaged, defective, or not working as described;</li>
            <li>the item is counterfeit or not authentic;</li>
            <li>the seller did not have the right to sell the item; or</li>
            <li>the transaction was fraudulent or unauthorised.</li>
          </ul>
          <p>
            We may ask for photographs, tracking information, or other evidence. Reports with clear
            evidence are resolved faster.
          </p>
        </LegalSection>

        <LegalSection title="3. When a refund is not available">
          <p>Refunds are generally not available when:</p>
          <ul>
            <li>you changed your mind, ordered the wrong size, or no longer want the item;</li>
            <li>the item matches the listing and arrived in the condition described;</li>
            <li>the problem was caused after delivery, such as accidental damage or normal wear;</li>
            <li>you paid outside TradeHub;</li>
            <li>the request is made after the protection period has ended and the seller has been paid; or</li>
            <li>the item is a digital good, a custom or personalised item, or was clearly marked as non-refundable at the time of sale, except where the item is faulty or not as described.</li>
          </ul>
        </LegalSection>

        <LegalSection title="4. How to open a refund request">
          <ol>
            <li>Contact the seller first through the order or chat. Many problems are resolved quickly between the two parties.</li>
            <li>If you cannot agree, open a report using <a href="/report">Report a Problem</a> and choose the payments category. Include the order reference, dates, and photographs.</li>
            <li>Respond to any request for information from our team. We may ask both parties for evidence.</li>
            <li>We will review the evidence and tell you the outcome. Where a refund is approved, we arrange it as described below.</li>
          </ol>
          <p>
            Do not close or confirm the order while a problem is unresolved, because confirmation can
            release the funds to the seller.
          </p>
        </LegalSection>

        <LegalSection title="5. Deadlines and evidence">
          <p>
            Report a problem as soon as you notice it, and within <strong>30 days of delivery</strong>{' '}
            at the latest. If you do not report within that window, the payment may be released to the
            seller and we may be unable to help.
          </p>
          <p>
            Once a dispute is opened, both parties are usually given a limited period, normally up to
            <strong> 72 hours</strong>, to submit evidence. We will tell you the exact deadline in the
            dispute. If you miss it, we may decide using the information already provided.
          </p>
        </LegalSection>

        <LegalSection title="6. How refunds are paid">
          <p>
            Approved refunds are returned to the original payment method where possible. Card refunds
            are processed through our payment provider and usually appear within 5 to 10 business
            days, depending on your bank. Where the original method is unavailable, we may issue the
            refund as TradeHub wallet credit.
          </p>
          <p>
            We may issue a partial refund where only part of the order was affected, for example one
            item in a multi-item order or a partial deduction agreed by both parties. Delivery fees
            are refunded only where the problem relates to delivery or the item was not as described.
          </p>
        </LegalSection>

        <LegalSection title="7. Disputes and decisions">
          <p>
            If the parties cannot agree, TradeHub may mediate. We review the listing, messages,
            tracking, photographs, and any other evidence provided by both sides. We may refund the
            buyer, release the payment to the seller, request more information, or take no action
            where a claim is not supported.
          </p>
          <p>
            Our decision on a dispute is final and binding for the parties to that dispute, except
            where local law gives you a different right or remedy. Nothing in this policy limits your
            statutory consumer rights.
          </p>
        </LegalSection>

        <LegalSection title="8. Chargebacks">
          <p>
            Please contact us before raising a chargeback with your bank or card issuer. A chargeback
            can take longer to resolve and may lead to your account being restricted while it is
            investigated. If you have already raised one, tell us the reference so we can respond to
            the provider.
          </p>
        </LegalSection>

        <LegalSection title="9. Seller protections">
          <p>
            Sellers are paid when the buyer confirms the order, when the protection period ends
            without a reported problem, or when a dispute is decided in the seller&rsquo;s favour.
            Sellers should keep proof of postage and accurate tracking, because it is often the
            evidence that resolves a &ldquo;not received&rdquo; claim.
          </p>
        </LegalSection>

        <LegalSection title="10. Contact us">
          <p>
            Questions about a refund or a dispute can be sent through{' '}
            <a href="/contact">Contact Us</a>. To report a specific order, use{' '}
            <a href="/report">Report a Problem</a> so the report is attached to your account and the
            order.
          </p>
        </LegalSection>
      </div>
    </div>
  );
}

export default RefundPolicy;
