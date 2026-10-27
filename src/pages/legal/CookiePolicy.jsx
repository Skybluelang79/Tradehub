import React from 'react';
import { Header } from '../../components/layout';
import './Legal.css';

export default function CookiePolicy() {
  return (
    <div className="legal-page">
      <Header title="Cookie Policy" subtitle="Last updated: October 2026" />
      <div className="legal-content card">
        <h2>What Are Cookies</h2>
        <p>Cookies are small text files stored on your device to improve your experience.</p>
        <h2>How We Use Cookies</h2>
        <ul>
          <li>Essential cookies for authentication and security</li>
          <li>Preference cookies to remember your settings</li>
          <li>Analytics cookies to understand usage patterns</li>
        </ul>
        <h2>Managing Cookies</h2>
        <p>You can control cookies through your browser settings. Disabling cookies may affect functionality.</p>
      </div>
    </div>
  );
}
