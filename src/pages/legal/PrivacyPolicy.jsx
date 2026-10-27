import React from 'react';
import { Header } from '../../components/layout';
import './Legal.css';

export default function PrivacyPolicy() {
  return (
    <div className="legal-page">
      <Header title="Privacy Policy" subtitle="Last updated: October 2026" />
      <div className="legal-content card">
        <h2>1. Information We Collect</h2>
        <p>We collect account information, transaction data, and usage information to provide our services.</p>
        <h2>2. How We Use Information</h2>
        <p>We use your information to facilitate transactions, improve our platform, and ensure security.</p>
        <h2>3. Data Security</h2>
        <p>We implement industry-standard security measures to protect your personal information.</p>
        <h2>4. Third-Party Services</h2>
        <p>We may use third-party payment processors and service providers in accordance with their policies.</p>
        <h2>5. Your Rights</h2>
        <p>You have the right to access, update, or delete your personal information.</p>
      </div>
    </div>
  );
}
