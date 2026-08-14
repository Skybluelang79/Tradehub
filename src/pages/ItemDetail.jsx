import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Avatar, Rating, Button } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import Modal from '../components/ui/Modal';
import { ImageLightbox, PriceChart } from '../components/features';
import { api } from '../services/client';
import { useAuth } from '../context/AuthContext';
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
  CardIcon,
  CopyIcon,
  ClockIcon,
  CheckIcon,
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
    isFavorite,
    toggleFavorite,
    incrementItemViews,
    markAsSold,
    updateItem,
  } = useApp();

  const { addToast } = useToast();
  const { isAuthenticated } = useAuth();

  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [touchStart, setTouchStart] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCategory, setReportCategory] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [showLightbox, setShowLightbox] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutMethod, setCheckoutMethod] = useState('card');
  const [availableMethods, setAvailableMethods] = useState(null);
  const [walletCredit, setWalletCredit] = useState(0);
  const [giftCode, setGiftCode] = useState('');
  const [cryptoNetworks, setCryptoNetworks] = useState([]);
  const [cryptoNetwork, setCryptoNetwork] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState(null);
  const [checkoutError, setCheckoutError] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);

  const [bidAmount, setBidAmount] = useState('');
  const [bidBusy, setBidBusy] = useState(false);
  const [bids, setBids] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const auctionRef = useRef(null);

  useEffect(() => {
    if (!selectedItem?.isAuction || !selectedItem.auctionEndsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [selectedItem?.id, selectedItem?.isAuction, selectedItem?.auctionEndsAt]);

  useEffect(() => {
    if (!selectedItem?.isAuction || !selectedItem.id) return;
    setBids(null);
    api.items.bids(selectedItem.id)
      .then((r) => setBids(r.bids || []))
      .catch(() => setBids([]));
  }, [selectedItem?.id, selectedItem?.isAuction]);

  const resetCheckout = () => {
    setShowCheckout(false);
    setCheckoutMethod('card');
    setAvailableMethods(null);
    setWalletCredit(0);
    setGiftCode('');
    setCryptoNetworks([]);
    setCryptoNetwork('');
    setCheckoutBusy(false);
    setCheckoutResult(null);
    setCheckoutError('');
  };

  const handleBuyClick = () => {
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }));
      return;
    }
    setCheckoutResult(null);
    setCheckoutError('');
    setCheckoutMethod('card');
    setCryptoNetwork('');
    api.payments.options().then((r) => {
      const methods = (r.methods || []).filter((m) => m.enabled !== false);
      setAvailableMethods(methods);
      if (methods.length) {
        const preferred = ['card', 'gift_card', 'bank', 'crypto'].filter((id) => methods.some((m) => m.id === id));
        setCheckoutMethod(preferred[0]);
      }
      setWalletCredit(r.creditCents ?? methods.find((m) => m.id === 'gift_card')?.creditCents ?? 0);
      const crypto = methods.find((m) => m.id === 'crypto');
      const networks = crypto?.details?.networks || [];
      setCryptoNetworks(networks);
      setCryptoNetwork(networks[0]?.id || '');
    }).catch(() => {
      setAvailableMethods([
        { id: 'card', name: 'Card / Stripe', enabled: true },
        { id: 'gift_card', name: 'Gift Card / Store Credit', enabled: true },
      ]);
    });
    setShowCheckout(true);
  };

  const handleCheckout = async () => {
    if (!selectedItem) return;
    setCheckoutBusy(true);
    setCheckoutError('');
    try {
      const payload = { itemId: selectedItem.id, method: checkoutMethod };
      if (checkoutMethod === 'gift_card') {
        payload.giftCardCode = giftCode.trim();
      }
      if (checkoutMethod === 'crypto') {
        payload.network = cryptoNetwork;
      }
      const res = await api.payments.createIntent(payload);

      if (checkoutMethod === 'bank' || checkoutMethod === 'crypto') {
        setCheckoutResult(res);
        setCheckoutBusy(false);
        return;
      }

      if (checkoutMethod === 'card' && res.demo) {
        await api.payments.confirm(res.transactionId);
      }

      if ((checkoutMethod === 'card' && res.demo) || (checkoutMethod === 'gift_card' && res.paid)) {
        if (checkoutMethod === 'gift_card') {
          await api.payments.confirm(res.transactionId);
        }
        markAsSold(selectedItem.id);
        addToast('Purchase complete! Payment is in escrow.', 'success');
        resetCheckout();
      }
    } catch (err) {
      setCheckoutError(err.message || 'Payment failed');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      addToast(`${label} copied`, 'success');
    }).catch(() => {
      addToast(`Could not copy ${label}`, 'error');
    });
  };

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

  const handleMessage = () => {
    addConversation(selectedItem.id, selectedItem.sellerId);
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
    } catch { /* malformed storage is ignored */ }
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

  if (!selectedItem) {
    setActiveTab('home');
    return null;
  }

  const seller = getUser(selectedItem.sellerId);
  const sellerReviews = getReviewsForUser(seller.id);
  const sellerRating = getUserRating(seller.id);
  const isOwnItem = selectedItem.sellerId === currentUser.id;
  const distance = getDistanceFromUser(selectedItem.location.lat, selectedItem.location.lng);
  const hasSale = selectedItem.salePrice && selectedItem.salePrice > 0 && selectedItem.salePrice < selectedItem.price;
  const saleEnded = selectedItem.saleEndsAt && new Date(selectedItem.saleEndsAt) < new Date();
  const showSale = hasSale && !saleEnded;
  const displayPrice = showSale ? selectedItem.salePrice : selectedItem.price;

  const getItemShareUrl = () => {
    try {
      return `${window.location.origin}${window.location.pathname}?item=${encodeURIComponent(selectedItem.id)}`;
    } catch {
      return window.location.href;
    }
  };

  const buildShareLinks = () => {
    if (!selectedItem) return [];
    const url = getItemShareUrl();
    const title = selectedItem.title;
    const price = formatPrice(displayPrice);
    const text = `${title} — ${price} on TradeHub`;
    return [
      { id: 'facebook', name: 'Facebook', url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, color: '#1877F2' },
      { id: 'x', name: 'X (Twitter)', url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, color: '#7A8599' },
      { id: 'whatsapp', name: 'WhatsApp', url: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, color: '#25D366' },
      { id: 'telegram', name: 'Telegram', url: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, color: '#26A5E4' },
      { id: 'email', name: 'Email', url: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n${url}`)}`, color: '#EA4335' },
    ];
  };

  const handleSocialShare = (shareUrl) => {
    window.open(shareUrl, '_blank', 'noopener,noreferrer,width=640,height=560');
  };

  const handleCopyLink = () => {
    copyToClipboard(getItemShareUrl(), 'Link');
  };

  const isAuction = !!selectedItem.isAuction;
  const auctionEnded = selectedItem.auctionEndsAt && new Date(selectedItem.auctionEndsAt) <= new Date(now);
  const auctionActive = isAuction && selectedItem.auctionStatus !== 'ended' && !auctionEnded;
  const currentBid = selectedItem.currentBid ?? selectedItem.startingBid ?? selectedItem.price;
  const minBid = currentBid + (selectedItem.minIncrement || 1);
  const currentBidder = selectedItem.currentBidderId ? getUser(selectedItem.currentBidderId) : null;
  const scrollToAuction = () => auctionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const auctionCountdown = (() => {
    if (!selectedItem.auctionEndsAt) return null;
    const diff = new Date(selectedItem.auctionEndsAt) - new Date(now);
    if (diff <= 0) return 'Ended';
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return d > 0 ? `${d}d ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`;
  })();

  const handlePlaceBid = async () => {
    if (!isAuthenticated) {
      window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }));
      return;
    }
    if (!auctionActive) {
      addToast('This auction has ended', 'error');
      return;
    }
    const amount = parseFloat(bidAmount);
    if (!amount || amount < minBid) {
      addToast(`Bid must be at least ${formatPrice(minBid)}`, 'error');
      return;
    }
    setBidBusy(true);
    try {
      const res = await api.items.bid(selectedItem.id, amount);
      updateItem(selectedItem.id, {
        currentBid: amount,
        currentBidderId: currentUser.id,
      });
      addToast(res.message || 'Bid placed!', 'success');
    } catch (err) {
      updateItem(selectedItem.id, {
        currentBid: amount,
        currentBidderId: currentUser.id,
      });
      addToast('Demo mode: bid recorded locally', 'success');
    } finally {
      setBidBusy(false);
    }
    setBidAmount('');
    setBids((prev) => {
      const bid = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        amount,
        bidder_name: currentUser.name,
        bidder_avatar: currentUser.avatar,
        created_at: new Date().toISOString(),
      };
      return [bid, ...(prev || [])].sort((a, b) => b.amount - a.amount);
    });
  };

  const handleReport = async () => {
    const reason = reportCategory === 'Other' && reportDetails.trim() ? reportDetails.trim() : reportCategory;
    if (!reason) return;
    try {
      await api.reports.create({ itemId: selectedItem?.id, reason, description: reportDetails });
      addToast('Report submitted. Our team will review it shortly.', 'success');
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        addToast('Report submitted (offline). Our team will review it shortly.', 'success');
      } else {
        addToast(err.message || 'Failed to submit report', 'error');
      }
    }
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

  const displayMethods = availableMethods ?? [
    { id: 'card', name: 'Card / Stripe', enabled: true },
    { id: 'gift_card', name: 'Gift Card / Store Credit', enabled: true },
  ];

  const renderMethodIcon = (id) => {
    switch (id) {
      case 'card':
        return (
          <span className="checkout-method-icon card">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
          </span>
        );
      case 'gift_card':
        return (
          <span className="checkout-method-icon wallet">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
            </svg>
          </span>
        );
      case 'bank':
        return (
          <span className="checkout-method-icon bank">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="21" x2="21" y2="21" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <polygon points="2,4 12,1 22,4 12,7" />
              <line x1="5" y1="10" x2="5" y2="21" />
              <line x1="12" y1="10" x2="12" y2="21" />
              <line x1="19" y1="10" x2="19" y2="21" />
            </svg>
          </span>
        );
      default:
        return (
          <span className="checkout-method-icon crypto">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 8.5h4.2a2.3 2.3 0 0 1 0 4.6H9.5z" />
              <path d="M9.5 13.2h4.8a2.3 2.3 0 0 1 0 4.6H9.5z" />
              <line x1="10.5" y1="8.5" x2="10.5" y2="17.8" />
            </svg>
          </span>
        );
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
          <button className="header-btn" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowShareModal(true)}>
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
        <div className="detail-price-row">
          {showSale ? (
            <>
              <div className="detail-price detail-price--sale">{formatPrice(selectedItem.salePrice)}</div>
              <div className="detail-price--original">{formatPrice(selectedItem.price)}</div>
              <span className="detail-sale-badge">
                {Math.round((1 - selectedItem.salePrice / selectedItem.price) * 100)}% OFF
              </span>
            </>
          ) : (
            <div className="detail-price">{formatPrice(selectedItem.price)}</div>
          )}
        </div>
        <h1 className="detail-title">{selectedItem.title}</h1>

        {isAuction && (
          <div className="auction-panel" ref={auctionRef}>
            <div className="auction-header">
              <span className="auction-badge">
                <i className="bi bi-hammer" />
                Auction
              </span>
              <span className={`auction-status ${auctionActive ? 'live' : 'ended'}`}>
                {auctionActive ? 'Open for bids' : 'Ended'}
              </span>
            </div>
            <div className="auction-bid-row">
              <div className="auction-bid-current">
                <span className="auction-label">Current Bid</span>
                <span className="auction-current-bid">{formatPrice(currentBid)}</span>
                {currentBidder && <span className="auction-leader">by {currentBidder.name}</span>}
                {!currentBidder && <span className="auction-leader">No bids yet</span>}
              </div>
              <div className="auction-time">
                <ClockIcon size={18} />
                <div>
                  <span className="auction-label">{auctionCountdown === 'Ended' ? 'Auction ended' : 'Ends in'}</span>
                  <span className="auction-countdown">{auctionCountdown}</span>
                </div>
              </div>
            </div>
            {!isOwnItem && auctionActive && (
              <div className="auction-bid-form">
                <input
                  type="number"
                  className="input auction-bid-input"
                  placeholder={`Min ${formatPrice(minBid)}`}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                />
                <button className="auction-bid-btn" disabled={bidBusy} onClick={handlePlaceBid}>
                  {bidBusy ? 'Placing...' : 'Place Bid'}
                </button>
              </div>
            )}
            <p className="auction-min-hint">Minimum bid: {formatPrice(minBid)}</p>
            {bids && bids.length > 0 && (
              <div className="auction-bids-list">
                <span className="auction-label">Recent bids</span>
                {bids.slice(0, 10).map((b) => (
                  <div key={b.id || b.created_at} className="auction-bid-entry">
                    <Avatar src={b.bidder_avatar} alt={b.bidder_name} size="sm" />
                    <span className="auction-bidder-name">{b.bidder_name}</span>
                    <span className="auction-bid-amount">{formatPrice(b.amount)}</span>
                    <span className="auction-bid-time">{formatDate(b.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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

        {selectedItem.quantity > 1 && (
          <div className="detail-stock-info">
            <span className="detail-stock-badge">{selectedItem.quantity} in stock</span>
          </div>
        )}

        {selectedItem.variants && selectedItem.variants.length > 0 && (
          <div className="detail-variants">
            <h4 className="detail-variants-title">Variants</h4>
            {selectedItem.variants.map((v, i) => (
              <div key={i} className="detail-variant-row">
                <span className="detail-variant-name">{v.name}:</span>
                <div className="detail-variant-values">
                  {v.values.map((opt, j) => (
                    <span key={j} className="detail-variant-chip">{opt.value}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedItem.priceHistory && (
          <PriceChart priceHistory={selectedItem.priceHistory} currentPrice={displayPrice} />
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
          <button className="seller-view-btn" onClick={() => window.dispatchEvent(new CustomEvent('openSellerProfile', { detail: seller.id }))}>View</button>
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

      {isOwnItem && selectedItem.status === 'active' && (
        <div className="detail-actions">
          <button className="detail-action-btn secondary" onClick={() => setShowReportModal(true)}>
            <FlagIconSvg size={20} />
            Report
          </button>
          <button className="detail-action-btn primary danger-btn" onClick={() => {
            markAsSold(selectedItem.id);
            setSelectedItem(null);
            setActiveTab('profile');
          }}>
            <ShieldIcon size={20} />
            Mark as Sold
          </button>
        </div>
      )}

      {!isOwnItem && selectedItem.status === 'active' && (
        <div className="detail-actions">
          {isAuction && auctionActive ? (
            <button className="detail-action-btn primary buy-now-btn" onClick={scrollToAuction}>
              <ClockIcon size={20} />
              Place Bid
            </button>
          ) : (
            <button className="detail-action-btn primary buy-now-btn" onClick={handleBuyClick}>
              <CardIcon size={20} />
              Buy Now
            </button>
          )}
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
          <button className="detail-action-btn secondary" onClick={handleMessage}>
            <MessageIcon size={20} />
            Message
          </button>
        </div>
      )}

      {selectedItem.status === 'sold' && (
        <div className="detail-sold-banner">
          <ShieldIcon size={20} />
          <span>This item has been sold</span>
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
      
      <Modal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        title="Share this listing"
      >
        <div className="share-sheet">
          {navigator.share && (
            <button className="share-sheet-primary" onClick={() => { handleShare(); setShowShareModal(false); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Share via device
            </button>
          )}
          <div className="share-sheet-grid">
            {buildShareLinks().map((opt) => (
              <button
                key={opt.id}
                className="share-sheet-option"
                style={{ '--brand': opt.color }}
                onClick={() => handleSocialShare(opt.url)}
              >
                <span className="share-sheet-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {opt.id === 'facebook' && <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />}
                    {opt.id === 'x' && <><path d="M4 4l16 16" /><path d="M20 4L4 20" /></>}
                    {opt.id === 'whatsapp' && <><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l2-5.5A8.5 8.5 0 1 1 21 11.5z" /><path d="M9.5 9.5c.3 2 2 3.7 4 4l1.2-1.2 1.8 1" /></>}
                    {opt.id === 'telegram' && <><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></>}
                    {opt.id === 'email' && <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 6L2 7" /></>}
                  </svg>
                </span>
                <span className="share-sheet-name">{opt.name}</span>
              </button>
            ))}
          </div>
          <button className="share-sheet-copy" onClick={handleCopyLink}>
            <CopyIcon size={18} />
            Copy link
          </button>
        </div>
      </Modal>

      {showLightbox && (
        <ImageLightbox
          images={selectedItem.images}
          initialIndex={currentImageIndex}
          onClose={() => setShowLightbox(false)}
        />
      )}

      <Modal
        isOpen={showCheckout}
        onClose={resetCheckout}
        title={checkoutResult ? 'Payment Instructions' : 'Checkout'}
        footer={
          checkoutResult ? (
            <Button block onClick={resetCheckout}>Done</Button>
          ) : (
            <Button block onClick={handleCheckout} disabled={checkoutBusy}>
              {checkoutBusy ? 'Processing...' : `Pay ${formatPrice(displayPrice)}`}
            </Button>
          )
        }
      >
        {checkoutResult && checkoutResult.payment ? (
          <div>
            <div className="checkout-confirm-note">
              <ClockIcon size={16} />
              <span>
                {checkoutResult.method === 'bank'
                  ? 'Transfer the exact amount using the details below. Reference must be included. Funds are verified and held in escrow.'
                  : 'Send the exact amount to the address below. Funds are verified and held in escrow.'}
              </span>
            </div>

            {checkoutResult.payment.bank && (
              <div className="pay-info-list">
                <div className="pay-info-row">
                  <span className="pay-info-label">Amount</span>
                  <strong>{formatPrice(checkoutResult.payment.amount)}</strong>
                </div>
                <div className="pay-info-row">
                  <span className="pay-info-label">Reference</span>
                  <span className="pay-info-value mono">{checkoutResult.payment.reference}</span>
                  <button className="copy-btn" onClick={() => copyToClipboard(checkoutResult.payment.reference, 'Reference')}><CopyIcon size={14} /></button>
                </div>
                <div className="pay-info-row">
                  <span className="pay-info-label">Recipient</span>
                  <span className="pay-info-value">{checkoutResult.payment.bank.name}</span>
                </div>
                <div className="pay-info-row">
                  <span className="pay-info-label">Bank</span>
                  <span className="pay-info-value">{checkoutResult.payment.bank.bank}</span>
                </div>
                <div className="pay-info-row">
                  <span className="pay-info-label">Account #</span>
                  <span className="pay-info-value mono">{checkoutResult.payment.bank.accountNumber}</span>
                  <button className="copy-btn" onClick={() => copyToClipboard(checkoutResult.payment.bank.accountNumber, 'Account number')}><CopyIcon size={14} /></button>
                </div>
                {checkoutResult.payment.bank.routing && (
                  <div className="pay-info-row">
                    <span className="pay-info-label">Routing</span>
                    <span className="pay-info-value mono">{checkoutResult.payment.bank.routing}</span>
                  </div>
                )}
                {checkoutResult.payment.bank.swift && (
                  <div className="pay-info-row">
                    <span className="pay-info-label">SWIFT</span>
                    <span className="pay-info-value mono">{checkoutResult.payment.bank.swift}</span>
                  </div>
                )}
                {checkoutResult.payment.bank.iban && (
                  <div className="pay-info-row">
                    <span className="pay-info-label">IBAN</span>
                    <span className="pay-info-value mono">{checkoutResult.payment.bank.iban}</span>
                  </div>
                )}
              </div>
            )}

            {checkoutResult.payment.address && (
              <div className="pay-info-list">
                <div className="pay-info-row">
                  <span className="pay-info-label">Amount</span>
                  <strong>{formatPrice(checkoutResult.payment.amount)}</strong>
                </div>
                <div className="pay-info-row">
                  <span className="pay-info-label">Reference</span>
                  <span className="pay-info-value mono">{checkoutResult.payment.reference}</span>
                  <button className="copy-btn" onClick={() => copyToClipboard(checkoutResult.payment.reference, 'Reference')}><CopyIcon size={14} /></button>
                </div>
                {checkoutResult.payment.network && (
                  <div className="pay-info-row">
                    <span className="pay-info-label">Network</span>
                    <span className="pay-info-value">{checkoutResult.payment.network.label} ({checkoutResult.payment.network.symbol})</span>
                  </div>
                )}
                <div className="pay-info-row">
                  <span className="pay-info-label">Networks</span>
                  <span className="pay-info-value">{(checkoutResult.payment.networks || []).map((n) => n.symbol || n).join(' · ')}</span>
                </div>
                <div className="pay-info-row pay-info-row--column">
                  <span className="pay-info-label">Address</span>
                  <span className="pay-info-value mono break">{checkoutResult.payment.address}</span>
                  <button className="copy-btn" onClick={() => copyToClipboard(checkoutResult.payment.address, 'Address')}><CopyIcon size={14} /></button>
                </div>
                {checkoutResult.payment.qr && (
                  <div className="crypto-qr-wrap">
                    <img
                      className="crypto-qr"
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(checkoutResult.payment.qr)}`}
                      alt="Payment QR code"
                    />
                    <span className="crypto-qr-caption">Scan to send payment</span>
                  </div>
                )}
                {checkoutResult.payment.placeholder && (
                  <p className="pay-info-hint">Demo address shown. Set <code>CRYPTO_ADDRESSES</code> or <code>CRYPTO_ADDRESS_&lt;SYMBOL&gt;</code> in production.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <p className="checkout-price-line">Total <strong>{formatPrice(displayPrice)}</strong></p>
            <p className="checkout-sub">Payments are held in escrow until you confirm receipt.</p>

            <div className="checkout-methods">
              {displayMethods.map((m) => {
                const methodDesc =
                  m.id === 'card' ? 'Credit, debit, Apple Pay' :
                  m.id === 'gift_card' ? walletCredit > 0 ? `${formatPrice(walletCredit / 100)} available` : 'Use store credit or a gift card' :
                  m.description || '';
                return (
                  <button
                    key={m.id}
                    className={`checkout-method ${checkoutMethod === m.id ? 'active' : ''}`}
                    onClick={() => setCheckoutMethod(m.id)}
                  >
                    {renderMethodIcon(m.id)}
                    <span className="checkout-method-text">
                      <span className="checkout-method-name">{m.name}</span>
                      <span className="checkout-method-desc">{methodDesc}</span>
                    </span>
                    <span className="checkout-method-radio" aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            {checkoutMethod === 'crypto' && cryptoNetworks.length > 0 && (
              <div className="input-group" style={{ marginTop: 12 }}>
                <label className="input-label">Select Network</label>
                <div className="crypto-network-grid">
                  {cryptoNetworks.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className={`crypto-network-chip ${cryptoNetwork === n.id ? 'active' : ''}`}
                      onClick={() => setCryptoNetwork(n.id)}
                    >
                      <span className="crypto-network-symbol">{n.symbol}</span>
                      <span className="crypto-network-label">{n.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {checkoutMethod === 'gift_card' && (
              <div className="input-group" style={{ marginTop: 12 }}>
                <label className="input-label">Gift Card Code (optional if using store credit)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="TRADE-XXXX-XXXX-XXXX"
                  value={giftCode}
                  onChange={(e) => setGiftCode(e.target.value.toUpperCase())}
                />
              </div>
            )}

            {checkoutError && <p className="checkout-error">{checkoutError}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
