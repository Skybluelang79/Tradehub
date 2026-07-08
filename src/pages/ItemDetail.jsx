import { useState, useCallback, useMemo, useEffect } from 'react';
import { Avatar, Rating, Button } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import Modal from '../components/ui/Modal';
import { ImageLightbox, PriceChart } from '../components/features';
import {
  ArrowLeftIcon,
  PinIcon,
  EyeIcon,
  HeartIcon,
  ShareIcon,
  StarIcon,
  MessageIcon,
  ShieldIcon,
  MapPinIcon,
} from '../components/ui/Icons';
import { AdBanner } from '../components/features';
import { useApp } from '../context';
import { currentUser } from '../services/api';
import { formatPrice, formatDistance, formatDate } from '../utils/helpers';
import '../styles/globals.css';
import './ItemDetail.css';

const conditionLabels = {
  new: 'New',
  like_new: 'Like New',
  good: 'Good',
  fair: 'Fair',
};

function FlagIconSvg({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

export default function ItemDetail() {
  const {
    selectedItem,
    setSelectedItem,
    setActiveTab,
    items,
    getUser,
    addConversation,
    getReviewsForUser,
    getUserRating,
    addReview,
    getDistanceFromUser,
    userLocation,
    isFavorite,
    toggleFavorite,
    incrementItemViews,
  } = useApp();

  const { addToast } = useToast();

  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [touchStart, setTouchStart] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCategory, setReportCategory] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);

  const handleTouchStart = (e) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e) => {
    if (touchStart === null) return;
    const diff = touchStart - e.changedTouches[0].clientX;
    const threshold = 50;
    if (Math.abs(diff) > threshold) {
      if (diff > 0 && currentImageIndex < selectedItem.images.length - 1) {
        setCurrentImageIndex((prev) => prev + 1);
      } else if (diff < 0 && currentImageIndex > 0) {
        setCurrentImageIndex((prev) => prev - 1);
      }
    }
    setTouchStart(null);
  };

  if (!selectedItem) {
    setActiveTab('home');
    return null;
  }

  const seller = getUser(selectedItem.sellerId);
  const sellerReviews = getReviewsForUser(seller.id);
  const sellerRating = getUserRating(seller.id);
  const isOwnItem = selectedItem.sellerId === currentUser.id;
  const distance = getDistanceFromUser(selectedItem.location.lat, selectedItem.location.lng);

  const handleMessage = () => {
    const conv = addConversation(selectedItem.id, selectedItem.sellerId);
    setSelectedItem(null);
    setActiveTab('chat');
  };

  const handleShareLocation = useCallback(() => {
    if (!navigator.geolocation) {
      addToast('Geolocation is not supported', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
        navigator.clipboard.writeText(mapUrl).then(() => {
          addToast('Location link copied! Share it with the seller', 'success');
        }).catch(() => {
          addToast(`Share your location: ${mapUrl}`, 'info');
        });
      },
      () => {
        addToast('Could not get location. Please enable location access.', 'error');
      }
    );
  }, [addToast]);

  const similarItems = useMemo(() => {
    if (!selectedItem) return [];
    return items
      .filter(i => i.id !== selectedItem.id && i.category === selectedItem.category && i.status === 'active')
      .slice(0, 6);
  }, [items, selectedItem]);

  useEffect(() => {
    if (!selectedItem) return;
    incrementItemViews(selectedItem.id);
    try {
      const stored = JSON.parse(localStorage.getItem('tradehub_recently_viewed') || '[]');
      const updated = [selectedItem.id, ...stored.filter(id => id !== selectedItem.id)].slice(0, 20);
      localStorage.setItem('tradehub_recently_viewed', JSON.stringify(updated));
    } catch {}
  }, [selectedItem, incrementItemViews]);

  const handleShare = useCallback(() => {
    const text = `${selectedItem.title} — $${selectedItem.price} on TradeHub`;
    if (navigator.share) {
      navigator.share({ title: text, text, url: window.location.href }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => {
        addToast('Item info copied to clipboard!', 'success');
      }).catch(() => {
        addToast('Could not copy to clipboard', 'error');
      });
    }
  }, [selectedItem, addToast]);

  const handleReport = () => {
    const reason = reportCategory === 'Other' && reportDetails.trim() ? reportDetails.trim() : reportCategory;
    if (!reason) return;
    addToast('Report submitted. Our team will review it shortly.', 'success');
    setReportSubmitted(true);
    setShowReportModal(false);
    setReportCategory('');
    setReportDetails('');
  };

  const handleSubmitReview = () => {
    if (reviewText.trim()) {
      addReview({
        revieweeId: seller.id,
        transactionId: `txn-${Date.now()}`,
        rating: reviewRating,
        text: reviewText.trim(),
      });
      setShowReviewModal(false);
      setReviewText('');
      setReviewRating(5);
    }
  };

  return (
    <div className="page item-detail-page">
      <div className="detail-image-gallery" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <button
          className="back-btn header-btn"
          style={{ position: 'absolute', top: 16, left: 16, zIndex: 10 }}
          onClick={() => {
            setSelectedItem(null);
            setActiveTab('home');
          }}
        >
          <ArrowLeftIcon size={20} />
        </button>

        <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 10 }}>
          <button
            className="header-btn"
            onClick={() => toggleFavorite(selectedItem.id)}
            style={{ background: isFavorite(selectedItem.id) ? 'var(--accent)' : 'rgba(0,0,0,0.5)' }}
          >
            <HeartIcon size={20} filled={isFavorite(selectedItem.id)} />
          </button>
          <button className="header-btn" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={handleShare}>
            <ShareIcon size={20} />
          </button>
        </div>

        <img
          src={selectedItem.images[currentImageIndex]}
          alt={selectedItem.title}
          className="detail-main-image"
          onClick={() => setShowLightbox(true)}
          style={{ cursor: 'pointer' }}
        />

        {selectedItem.images.length > 1 && (
          <div className="detail-image-nav">
            {selectedItem.images.map((_, index) => (
              <button
                key={index}
                className={`detail-image-dot ${index === currentImageIndex ? 'active' : ''}`}
                onClick={() => setCurrentImageIndex(index)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="detail-content">
        <div className="detail-price">{formatPrice(selectedItem.price)}</div>
        <h1 className="detail-title">{selectedItem.title}</h1>

        <div className="detail-meta">
          <span className="detail-meta-item">
            <PinIcon />
            {selectedItem.location.address || 'Local pickup'}
          </span>
          {distance && (
            <span className="detail-meta-item">
              {formatDistance(distance)} away
            </span>
          )}
          <span className="detail-meta-item">
            <EyeIcon />
            {selectedItem.views} views
          </span>
          {selectedItem.condition && (
            <span className="detail-meta-item" style={{ color: 'var(--accent)' }}>
              {conditionLabels[selectedItem.condition]}
            </span>
          )}
        </div>

        <p className="detail-description">{selectedItem.description}</p>

        {selectedItem.priceHistory && (
          <PriceChart priceHistory={selectedItem.priceHistory} currentPrice={selectedItem.price} />
        )}

        <div className="seller-card-detail">
          <Avatar src={seller.avatar} alt={seller.name} size="lg" verified={seller.verified} />
          <div className="seller-info">
            <div className="seller-name">
              {seller.name}
            </div>
            <div className="seller-rating">
              <Rating value={sellerRating} size="sm" />
              <span className="seller-reviews">
                {sellerRating || 'New'} ({sellerReviews.length} reviews)
              </span>
            </div>
          </div>
          <button className="seller-view-btn" onClick={() => { setSelectedItem(null); setActiveTab('profile'); }}>View</button>
        </div>

        {!isOwnItem && sellerReviews.length > 0 && (
          <div className="reviews-section">
            <div className="reviews-section-header">
              <h3 className="reviews-section-title">Seller Reviews</h3>
              <button className="see-all-btn" onClick={() => setShowAllReviews(!showAllReviews)}>
                {showAllReviews ? 'Show Less' : 'See All'}
              </button>
            </div>
            {(showAllReviews ? sellerReviews : sellerReviews.slice(0, 2)).map((review) => (
              <div key={review.id} className="mini-review-card">
                <div className="mini-review-header">
                  <span className="mini-review-name">User {review.reviewerId.slice(-4)}</span>
                  <Rating value={review.rating} size="sm" />
                  <span className="mini-review-date">{formatDate(review.createdAt)}</span>
                </div>
                <p className="mini-review-text">{review.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <AdBanner />

      {similarItems.length > 0 && (
        <div className="section-block-detail">
          <div className="section-header-detail">
            <h3 className="section-title-detail">Similar Items</h3>
            <span className="section-subtitle-detail">More in {selectedItem.category}</span>
          </div>
          <div className="horizontal-scroll-detail">
            {similarItems.map(item => (
              <div key={item.id} className="mini-item-card-detail" onClick={() => setSelectedItem(item)}>
                <div className="mini-item-image-detail">
                  <img src={item.images?.[0]} alt={item.title} />
                </div>
                <div className="mini-item-info-detail">
                  <span className="mini-item-title-detail">{item.title}</span>
                  <span className="mini-item-price-detail">${item.price}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isOwnItem && (
        <div className="detail-actions">
          <button className="detail-action-btn secondary" onClick={() => setShowReviewModal(true)}>
            <StarIcon size={20} />
            Review
          </button>
          <button className="detail-action-btn secondary" onClick={() => { setSelectedItem(null); setActiveTab('payments'); }}>
            <ShieldIcon size={20} />
            Safe Pay
          </button>
          <button className="detail-action-btn secondary" onClick={handleShareLocation}>
            <MapPinIcon size={20} />
            Share Loc
          </button>
          <button className="detail-action-btn secondary" onClick={() => setShowReportModal(true)}>
            <FlagIconSvg size={20} />
            Report
          </button>
          <button className="detail-action-btn primary" onClick={handleMessage}>
            <MessageIcon size={20} />
            Message
          </button>
        </div>
      )}

      <Modal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        title="Report Listing"
        footer={
          <Button block onClick={handleReport} disabled={!reportCategory || (reportCategory === 'Other' && !reportDetails.trim())}>
            Submit Report
          </Button>
        }
      >
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            Why are you reporting this listing?
          </p>
          <select
            className="input"
            value={reportCategory}
            onChange={(e) => setReportCategory(e.target.value)}
            style={{ width: '100%', marginBottom: 12 }}
          >
            <option value="">Select a reason...</option>
            <option value="Spam">Spam</option>
            <option value="Counterfeit">Counterfeit or fake</option>
            <option value="Prohibited">Prohibited item</option>
            <option value="Incorrect category">Incorrect category</option>
            <option value="Duplicate">Duplicate listing</option>
            <option value="Other">Other</option>
          </select>
          {reportCategory === 'Other' && (
            <textarea
              className="input"
              style={{ minHeight: 80, width: '100%' }}
              placeholder="Describe the issue..."
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
            />
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        title={`Review ${seller.name}`}
        footer={
          <Button block onClick={handleSubmitReview} disabled={!reviewText.trim()}>
            Submit Review
          </Button>
        }
      >
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>How was your experience?</p>
          <div className="review-modal-stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <StarIcon
                key={star}
                size={40}
                filled={star <= reviewRating}
                onClick={() => setReviewRating(star)}
              />
            ))}
          </div>
          <textarea
            className="input"
            style={{ minHeight: 100, marginTop: 16 }}
            placeholder="Share details of your experience..."
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
          />
        </div>
      </Modal>
      
      {showLightbox && (
        <ImageLightbox
          images={selectedItem.images}
          initialIndex={currentImageIndex}
          onClose={() => setShowLightbox(false)}
        />
      )}
    </div>
  );
}
