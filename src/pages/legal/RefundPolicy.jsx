import React from 'react';
import { Header } from '../../components/layout';
import './Legal.css';

export default function RefundPolicy() {
  return (
    <div className="legal-page">
      <Header title="Refund Policy" subtitle="Last updated: October 2026" />
      <div className="legal-content card">
        <h2>1. Escrow Protection</h2>
        <p>All purchases are protected by our escrow system until delivery is confirmed.</p>
        <h2>2. Eligible Refunds</h2>
        <p>Refunds may be issued if item is not as described, never received, or significantly different from listing.</p>
        <h2>3. Refund Process</h2>
        <p>Open a dispute with evidence within the dispute window. Our team will review and mediate.</p>
        <h2>4. Non-Refundable</h2>
        <p>Digital goods, custom items, and items marked as non-refundable may not be eligible.</p>
      </div>
    </div>
  );
}
