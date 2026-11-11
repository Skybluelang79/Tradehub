import { DraftNotice, LegalHeader, LegalSection } from './LegalShell';
import { useLegalMount } from './legalRoutes';

function ProhibitedItems() {
  useLegalMount();

  return (
    <div className="legal-shell">
      <LegalHeader title="Prohibited Items" />
      <div className="legal-doc">
        <h1 className="legal-doc-title">Prohibited Items</h1>
        <p className="legal-doc-updated">Last updated: 11 November 2026.</p>
        <DraftNotice />

        <LegalSection title="1. Why some items cannot be listed">
          <p>
            TradeHub is a marketplace for lawful, second-hand and new goods. To keep buyers, sellers,
            and the wider community safe, and to comply with the law, some items may not be listed at
            all. This list is a guide, not a complete legal text: if an item is illegal to sell where
            you or the buyer are located, it is prohibited on TradeHub even if it is not named below.
          </p>
        </LegalSection>

        <LegalSection title="2. Illegal and dangerous items">
          <ul>
            <li>Illegal drugs, narcotics, and controlled substances, including prescription-only medicines sold without authorisation.</li>
            <li>Firearms, ammunition, replica firearms, and parts designed to convert a replica into a working weapon.</li>
            <li>Explosives, fireworks, flares, and bomb-making materials or instructions.</li>
            <li>Bladed weapons, combat knives, and other weapons where their sale is restricted by law.</li>
            <li>Stolen goods, or items you do not own or have the right to sell.</li>
            <li>Items that have been recalled or banned for safety reasons.</li>
            <li>Toxic, hazardous, or radioactive materials, and dangerous chemicals.</li>
          </ul>
        </LegalSection>

        <LegalSection title="3. Counterfeit and intellectual property">
          <ul>
            <li>Counterfeit goods, including fake designer clothing, bags, watches, and accessories.</li>
            <li>Pirated media, software, games, and unauthorised copies of copyrighted works.</li>
            <li>Items that infringe a trademark, patent, or other intellectual property right.</li>
            <li>Digital accounts, subscriptions, or licences that are not transferable under the provider&rsquo;s terms.</li>
          </ul>
        </LegalSection>

        <LegalSection title="4. Financial, personal, and digital">
          <ul>
            <li>Stolen or unauthorised financial information, card numbers, and bank details.</li>
            <li>Counterfeit currency, forged documents, and fake identification.</li>
            <li>Personal data, databases, and contact lists obtained without consent.</li>
            <li>Malware, spyware, hacking tools, and services intended to compromise accounts or devices.</li>
            <li>Gift cards or vouchers that have been obtained fraudulently or cannot be verified.</li>
          </ul>
        </LegalSection>

        <LegalSection title="5. Regulated and age-restricted goods">
          <ul>
            <li>Alcohol, tobacco, vaping products, and nicotine where sale to the buyer is restricted or requires a licence.</li>
            <li>Prescription medicines, medical devices, and treatments that require professional authorisation.</li>
            <li>Pesticides, chemicals, and other products restricted by law in your country.</li>
            <li>Lottery tickets, gambling products, and related services where prohibited or unlicensed.</li>
          </ul>
        </LegalSection>

        <LegalSection title="6. Animals, wildlife, and the environment">
          <ul>
            <li>Live animals, except where a separate, lawful rehoming process is expressly allowed.</li>
            <li>Endangered species and products made from them, including ivory and certain furs.</li>
            <li>Items made from protected wildlife, coral, or plants.</li>
            <li>Hazardous waste and items that cannot lawfully be shipped.</li>
          </ul>
        </LegalSection>

        <LegalSection title="7. Adult content and minors">
          <ul>
            <li>Sexual content involving minors, or any content that sexualises a child.</li>
            <li>Adult sexual content and services, unless expressly permitted in a clearly age-restricted area of the site.</li>
            <li>Items or content that depict or encourage abuse, exploitation, or trafficking.</li>
          </ul>
        </LegalSection>

        <LegalSection title="8. Safety, surveillance, and other restricted items">
          <ul>
            <li>Hidden cameras, tracking devices, and surveillance equipment intended to monitor people without consent.</li>
            <li>Lock-picking tools, signal jammers, and devices whose primary purpose is to bypass security.</li>
            <li>Human organs, blood, and other bodily materials that cannot lawfully be sold.</li>
            <li>Recalled child car seats, helmets, and other safety equipment that no longer meets current standards.</li>
            <li>Services that facilitate any of the above, including listings that offer to obtain prohibited items on request.</li>
          </ul>
        </LegalSection>

        <LegalSection title="9. What happens if you list a prohibited item">
          <p>
            Listings that break these rules may be removed without notice. Depending on the item and
            the circumstances, we may warn the account, restrict selling, suspend or close the
            account, withhold payouts connected to the listing, and report the matter to the relevant
            authorities. Repeat or serious breaches may result in a permanent ban.
          </p>
          <p>
            If you are unsure whether something is allowed, ask us before you list it through{' '}
            <a href="/contact">Contact Us</a>. Asking first is always better than having a listing
            removed.
          </p>
        </LegalSection>

        <LegalSection title="10. How to report a prohibited listing">
          <p>
            Use the report option on the listing or the seller&rsquo;s profile, or open{' '}
            <a href="/report">Report a Problem</a> and choose the listing category. Include the
            listing link and a short explanation. Reports are reviewed against these rules and the
            law that applies to the item.
          </p>
        </LegalSection>
      </div>
    </div>
  );
}

export default ProhibitedItems;
