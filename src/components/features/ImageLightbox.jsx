import { useState, useEffect, useCallback } from 'react';
import { XIcon, ArrowLeftIcon } from '../ui/Icons';

export default function ImageLightbox({ images, initialIndex = 0, onClose }) {
  const [index, setIndex] = useState(initialIndex);
  const [touchStart, setTouchStart] = useState(null);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1));
    if (e.key === 'ArrowRight') setIndex(i => Math.min(images.length - 1, i + 1));
  }, [images.length, onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  const handleTouchStart = (e) => setTouchStart(e.touches[0].clientX);
  const handleTouchEnd = (e) => {
    if (touchStart === null) return;
    const diff = touchStart - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) setIndex(i => Math.min(images.length - 1, i + 1));
      else setIndex(i => Math.max(0, i - 1));
    }
    setTouchStart(null);
  };

  return (
    <div
      className="lightbox-overlay"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="lightbox-header">
        <button className="lightbox-btn" onClick={onClose}>
          <XIcon size={24} />
        </button>
        <span className="lightbox-counter">
          {index + 1} / {images.length}
        </span>
      </div>

      <button className="lightbox-nav lightbox-nav--prev" onClick={(e) => { e.stopPropagation(); setIndex(i => Math.max(0, i - 1)); }}>
        <ArrowLeftIcon size={24} />
      </button>
      <button className="lightbox-nav lightbox-nav--next" onClick={(e) => { e.stopPropagation(); setIndex(i => Math.min(images.length - 1, i + 1)); }}>
        <ArrowLeftIcon size={24} />
      </button>

      <div className="lightbox-image-container" onClick={(e) => e.stopPropagation()}>
        <img
          src={images[index]}
          alt={`Image ${index + 1}`}
          className="lightbox-image"
        />
      </div>

      {images.length > 1 && (
        <div className="lightbox-thumbs">
          {images.map((img, i) => (
            <button
              key={i}
              className={`lightbox-thumb ${i === index ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setIndex(i); }}
            >
              <img src={img} alt={`Thumb ${i + 1}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
