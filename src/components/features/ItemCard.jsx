import { PinIcon, HeartIcon } from '../ui/Icons';
import { formatPrice, formatDistance } from '../../utils/helpers';
import { useApp } from '../../context';
import './ItemCard.css';

const conditionLabels = {
  new: 'New',
  like_new: 'Like New',
  good: 'Good',
  fair: 'Fair',
};

export default function ItemCard({ item, distance, onClick, variant = 'grid' }) {
  const { isFavorite, toggleFavorite } = useApp();
  const favorited = isFavorite(item.id);

  const hasSale = item.salePrice && item.salePrice > 0 && item.salePrice < item.price;
  const saleEnded = item.saleEndsAt && new Date(item.saleEndsAt) < new Date();
  const showSale = hasSale && !saleEnded;

  const handleFavorite = (e) => {
    e.stopPropagation();
    toggleFavorite(item.id);
  };

  return (
    <article
      className={`item-card ${variant === 'list' ? 'item-card--list' : ''}`}
      onClick={onClick}
    >
      <div className="item-image-wrapper">
        <img
          src={item.images[0]}
          alt={item.title}
          className="item-image"
          loading="lazy"
        />
        <div className="item-badges">
          <button
            className={`item-favorite ${favorited ? 'active' : ''}`}
            onClick={handleFavorite}
          >
            <HeartIcon size={18} />
          </button>
          {item.boosted && (
            <span className="item-boosted-badge">Boosted</span>
          )}
          {showSale && (
            <span className="item-sale-badge">
              {Math.round((1 - item.salePrice / item.price) * 100)}% OFF
            </span>
          )}
          {item.condition && !showSale && (
            <span className={`item-condition ${item.condition}`}>
              {conditionLabels[item.condition]}
            </span>
          )}
          {item.quantity > 1 && (
            <span className="item-qty-badge">{item.quantity} left</span>
          )}
        </div>
      </div>
      <div className="item-content">
        <h3 className="item-title">{item.title}</h3>
        <div className="item-footer">
          <div className="item-price-row">
            {showSale ? (
              <>
                <span className="item-price item-price--sale">{formatPrice(item.salePrice)}</span>
                <span className="item-price--original">{formatPrice(item.price)}</span>
              </>
            ) : (
              <span className="item-price">{formatPrice(item.price)}</span>
            )}
          </div>
          {distance != null && (
            <span className="item-meta">
              <PinIcon />
              {formatDistance(distance)}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function ItemsGrid({ items, onItemClick, getDistance, viewMode = 'grid' }) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M20 9v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9" />
          <path d="M9 22V12h6v10" />
          <path d="M2 10.6L12 2l10 8.6" />
        </svg>
        <h3 className="empty-title">No items found</h3>
        <p className="empty-text">Try adjusting your filters or search terms</p>
      </div>
    );
  }

  return (
    <div className={`items-grid ${viewMode === 'list' ? 'items-grid--list' : ''}`}>
      {items.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          distance={getDistance ? getDistance(item.location.lat, item.location.lng) : null}
          onClick={() => onItemClick(item)}
          variant={viewMode}
        />
      ))}
    </div>
  );
}
