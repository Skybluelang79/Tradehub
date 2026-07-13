import { useState } from 'react';
import './EncryptionBadge.css';

export default function EncryptionBadge({ encrypted, fingerprint, trusted, onTrust }) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="enc-badge-container">
      <button
        className={`enc-badge ${encrypted ? 'encrypted' : 'unencrypted'} ${showDetails ? 'expanded' : ''}`}
        onClick={() => setShowDetails(!showDetails)}
      >
        <div className="enc-badge-icon">
          {encrypted ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              <circle cx="12" cy="16" r="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
          )}
        </div>
        <span className="enc-badge-label">
          {encrypted ? 'End-to-end encrypted' : 'Not encrypted'}
        </span>
        <svg className={`enc-badge-chevron ${showDetails ? 'rotated' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {showDetails && encrypted && (
        <div className="enc-details">
          <div className="enc-details-section">
            <div className="enc-details-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <div className="enc-details-text">
              <strong>Messages are end-to-end encrypted</strong>
              <span>Only you and this person can read them. Not even TradeHub can access them.</span>
            </div>
          </div>

          {fingerprint && (
            <div className="enc-fingerprint">
              <span className="enc-fingerprint-label">Security fingerprint</span>
              <div className="enc-fingerprint-value">{fingerprint}</div>
              <span className="enc-fingerprint-hint">
                {trusted
                  ? 'Key verified and trusted'
                  : 'Ask your contact to confirm this fingerprint matches'}
              </span>
            </div>
          )}

          {fingerprint && !trusted && (
            <button className="enc-trust-btn" onClick={() => onTrust?.()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              I've verified this fingerprint
            </button>
          )}

          {trusted && (
            <div className="enc-trusted-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2" width="14" height="14">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              Trusted contact
            </div>
          )}

          <div className="enc-info-grid">
            <div className="enc-info-item">
              <span className="enc-info-dot green" />
              <span>E2E encryption active</span>
            </div>
            <div className="enc-info-item">
              <span className="enc-info-dot green" />
              <span>AES-256-GCM</span>
            </div>
            <div className="enc-info-item">
              <span className="enc-info-dot green" />
              <span>ECDH key exchange</span>
            </div>
            <div className="enc-info-item">
              <span className={`enc-info-dot ${trusted ? 'green' : 'yellow'}`} />
              <span>{trusted ? 'Identity verified' : 'Identity unverified'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
