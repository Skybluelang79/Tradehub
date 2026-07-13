import { useState, useRef, useEffect } from 'react';
import './ListForFree.css';

const benefits = [
  { icon: '📸', text: 'Quick photo listing', desc: 'Snap a pic, set a price, go live in 30 seconds' },
  { icon: '💰', text: 'Zero listing fees', desc: 'Keep 100% of what you earn on your first 10 listings' },
  { icon: '🛡️', text: 'Escrow protection', desc: 'Get paid securely — no chasing payments' },
  { icon: '📈', text: 'Boost visibility', desc: 'Top sellers get featured on the homepage' },
];

const categories = [
  { name: 'Electronics', emoji: '📱', color: '#007AFF' },
  { name: 'Fashion', emoji: '👗', color: '#E94560' },
  { name: 'Gaming', emoji: '🎮', color: '#A78BFA' },
  { name: 'Home', emoji: '🏠', color: '#4ADE80' },
  { name: 'Vehicles', emoji: '🚗', color: '#FBBF24' },
  { name: 'Sports', emoji: '⚽', color: '#F97316' },
];

export default function ListForFree({ onList }) {
  const [hovered, setHovered] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [activeCategory, setActiveCategory] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [animateIn, setAnimateIn] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setAnimateIn(true), 100);
    return () => clearTimeout(t);
  }, []);

  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setUploadedFile(file);
      if (onList) onList({ quickPhoto: file });
    }
  };

  const handleStartListing = () => {
    if (activeCategory && onList) {
      onList({ category: activeCategory });
    } else if (onList) {
      onList();
    }
  };

  return (
    <div className={`list-free ${animateIn ? 'visible' : ''}`}>
      <div
        className={`list-free-card ${hovered ? 'hovered' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="list-free-bg">
          <div className="list-free-orb orb-1" />
          <div className="list-free-orb orb-2" />
          <div className="list-free-orb orb-3" />
          <div className="list-free-grid" />
        </div>

        <div className="list-free-content">
          <div className="list-free-badge">
            <span className="list-free-badge-dot" />
            Free for a limited time
          </div>

          <h2 className="list-free-title">
            List Your Item<br />
            <span className="list-free-title-accent">For Free</span>
          </h2>

          <p className="list-free-subtitle">
            Turn your unused stuff into cash. Zero fees, instant reach to thousands of local buyers.
          </p>

          <div className="list-free-quick-upload">
            <div
              className={`list-free-dropzone ${dragOver ? 'drag-over' : ''} ${uploadedFile ? 'has-file' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleFileDrop}
                style={{ display: 'none' }}
              />
              {uploadedFile ? (
                <>
                  <div className="dropzone-check">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <span className="dropzone-text">Photo ready!</span>
                  <span className="dropzone-subtext">{uploadedFile.name}</span>
                </>
              ) : (
                <>
                  <div className="dropzone-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </div>
                  <span className="dropzone-text">Drop a photo or tap to start</span>
                  <span className="dropzone-subtext">We'll auto-detect the category</span>
                </>
              )}
            </div>
          </div>

          <div className="list-free-categories">
            <span className="list-free-categories-label">Quick categories</span>
            <div className="list-free-category-chips">
              {categories.map(cat => (
                <button
                  key={cat.name}
                  className={`list-free-cat ${activeCategory === cat.name ? 'active' : ''}`}
                  style={activeCategory === cat.name ? { borderColor: cat.color, background: `${cat.color}15` } : {}}
                  onClick={() => setActiveCategory(activeCategory === cat.name ? null : cat.name)}
                >
                  <span>{cat.emoji}</span>
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <button className="list-free-cta" onClick={handleStartListing}>
            <span className="list-free-cta-text">Start Listing Now</span>
            <span className="list-free-cta-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </span>
          </button>

          <button className="list-free-how" onClick={() => setShowSteps(!showSteps)}>
            {showSteps ? 'Hide' : 'How does it work?'}
            <svg className={`list-free-how-chevron ${showSteps ? 'rotated' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {showSteps && (
            <div className="list-free-steps">
              <div className="list-free-step">
                <div className="list-free-step-num">1</div>
                <div className="list-free-step-text">
                  <strong>Snap or upload</strong>
                  <span>Take a photo or choose from your gallery</span>
                </div>
              </div>
              <div className="list-free-step">
                <div className="list-free-step-num">2</div>
                <div className="list-free-step-text">
                  <strong>Set your price</strong>
                  <span>We'll suggest a price based on market data</span>
                </div>
              </div>
              <div className="list-free-step">
                <div className="list-free-step-num">3</div>
                <div className="list-free-step-text">
                  <strong>Go live</strong>
                  <span>Your listing is visible to local buyers instantly</span>
                </div>
              </div>
              <div className="list-free-step">
                <div className="list-free-step-num">4</div>
                <div className="list-free-step-text">
                  <strong>Get paid</strong>
                  <span>Secure escrow until buyer confirms delivery</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="list-free-benefits">
          {benefits.map((b, i) => (
            <div key={i} className="list-free-benefit" style={{ animationDelay: `${i * 80}ms` }}>
              <span className="list-free-benefit-icon">{b.icon}</span>
              <div className="list-free-benefit-text">
                <strong>{b.text}</strong>
                <span>{b.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
