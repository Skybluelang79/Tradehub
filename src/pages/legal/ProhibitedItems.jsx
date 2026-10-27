import React from 'react';
import { Header } from '../../components/layout';
import './Legal.css';

export default function ProhibitedItems() {
  return (
    <div className="legal-page">
      <Header title="Prohibited Items" subtitle="Last updated: October 2026" />
      <div className="legal-content card">
        <h2>Prohibited Items Include</h2>
        <ul>
          <li>Illegal drugs, narcotics, and controlled substances</li>
          <li>Weapons, firearms, ammunition, and explosives</li>
          <li>Stolen goods or items obtained illegally</li>
          <li>Counterfeit goods and pirated media</li>
          <li>Adult content involving minors</li>
          <li>Endangered species and products derived from them</li>
          <li>Prescription medications without proper authorization</li>
          <li>Items that violate intellectual property rights</li>
        </ul>
        <p>Violations may result in account suspension and report to authorities.</p>
      </div>
    </div>
  );
}
