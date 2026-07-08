import { useState, useCallback } from 'react';
import { Header } from '../components/layout';
import { useApp } from '../context';
import { useToast } from '../components/ui/Toast';
import { HeartIcon, MapPinIcon } from '../components/ui/Icons';
import './Favorites.css';

export default function Favorites({ onClose }) {
  const { favorites, items, toggleFavorite, setSelectedItem, setActiveTab } = useApp();
  const { addToast } = useToast();
  const [viewMode, setViewMode] = useState('grid');

  const handleShareWishlist = useCallback(() => {
    const wishlist = items.filter(item => favorites.includes(item.id));
    if (wishlist.length === 0) {
      addToast('No items in your wishlist to share', 'error');
      return;
    }
    const text = `Check out my TradeHub wishlist!\n\n${wishlist.map(i => `• ${i.title} — $${i.price}`).join('\n')}`;
    if (navigator.share) {
      navigator.share({ title: 'My TradeHub Wishlist', text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => {
        addToast('Wishlist copied to clipboard!', 'success');
      }).catch(() => {
        addToast('Could not share wishlist', 'error');
      });
    }
  }, [favorites, items, addToast]);

  const favoriteItems = items.filter(item => favorites.includes(item.id));

  const handleItemClick = (item) => {
    setSelectedItem(item);
    if (onClose) onClose();
  };

  const handleChatClick = (e, item) => {
    e.stopPropagation();
    setSelectedItem(item);
    setActiveTab('chat');
    if (onClose) onClose();
  };

  return (
    <div className="favorites-page">
      <Header
        title="Favorites"
        leftComponent={
          onClose && (
            <button className="header-btn" onClick={onClose}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )
        }
        rightComponent={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="share-wishlist-btn" onClick={handleShareWishlist}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Share
            </button>
            <button className="header-btn" onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>
            {viewMode === 'grid' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            )}
          </button>
          </div>
        }
      />

      <div className="favorites-content">
        {favoriteItems.length === 0 ? (
          <div className="empty-favorites">
            <div className="empty-icon">
              <HeartIcon size={48} />
            </div>
            <h3>No favorites yet</h3>
            <p>Items you save will appear here</p>
            <button className="browse-btn" onClick={() => { if (onClose) onClose(); setActiveTab('home'); }}>
              Start Browsing
            </button>
          </div>
        ) : (
          <>
            <div className="favorites-count">
              {favoriteItems.length} {favoriteItems.length === 1 ? 'item' : 'items'} saved
            </div>
            <div className={`favorites-grid ${viewMode}`}>
              {favoriteItems.map((item) => (
                <div
                  key={item.id}
                  className="favorite-card"
                  onClick={() => handleItemClick(item)}
                >
                  <div className="favorite-image">
                    <img src={item.images[0]} alt={item.title} />
                    <button
                      className="favorite-btn active"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(item.id);
                      }}
                    >
                      <HeartIcon size={20} filled />
                    </button>
                    <span className="favorite-category">{item.category}</span>
                  </div>
                  <div className="favorite-info">
                    <h3 className="favorite-title">{item.title}</h3>
                    <p className="favorite-price">${item.price.toLocaleString()}</p>
                    <div className="favorite-meta">
                      <span className="favorite-location">
                        <MapPinIcon size={14} />
                        {item.location.address.split(',')[0]}
                      </span>
                    </div>
                  </div>
                  <button
                    className="message-seller-btn"
                    onClick={(e) => handleChatClick(e, item)}
                  >
                    Message Seller
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
