import React from 'react';
import { Header } from '../../components/layout';
import './Legal.css';

export default function TermsOfService() {
  return (
    <div className="legal-page">
      <Header title="Terms of Service" subtitle="Last updated: October 2026" />
      <div className="legal-content card">
        <h2>1. Acceptance of Terms</h2>
        <p>By accessing and using TradeHub, you agree to be bound by these Terms of Service.</p>
        <h2>2. User Accounts</h2>
        <p>You are responsible for maintaining the confidentiality of your account credentials.</p>
        <h2>3. Marketplace Rules</h2>
        <p>Users must only list items they own and have the right to sell. Prohibited items are listed separately.</p>
        <h2>4. Escrow &amp; Payments</h2>
        <p>All transactions use escrow protection. Funds are held until both parties confirm completion.</p>
        <h2>5. Disputes</h2>
        <p>In case of disputes, TradeHub may mediate based on evidence provided by both parties.</p>
        <h2>6. Limitation of Liability</h2>
        <p>TradeHub is not liable for direct, indirect, or consequential damages arising from use of the platform.</p>
        <h2>7. Changes to Terms</h2>
        <p>We reserve the right to modify these terms at any time. Continued use constitutes acceptance.</p>
      </div>
    </div>
  );
}
