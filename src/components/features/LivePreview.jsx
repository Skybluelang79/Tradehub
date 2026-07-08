export default function LivePreview({ title, price, description, images, condition }) {
  const hasContent = title || price || description || images.length > 0;

  if (!hasContent) return null;

  return (
    <div className="live-preview">
      <div className="live-preview-header">
        <h3 className="live-preview-title">Preview</h3>
        <span className="live-preview-badge">Live</span>
      </div>
      <div className="live-preview-card">
        {images.length > 0 && (
          <div className="live-preview-image">
            <img src={images[0]} alt="Preview" />
            {images.length > 1 && (
              <span className="live-preview-count">+{images.length - 1}</span>
            )}
          </div>
        )}
        <div className="live-preview-body">
          <h4 className="live-preview-name">{title || 'Item Title'}</h4>
          {price && <span className="live-preview-price">${parseFloat(price) > 0 ? parseFloat(price).toLocaleString() : '0'}</span>}
          {condition && <span className="live-preview-condition">{condition}</span>}
        </div>
        {description && (
          <p className="live-preview-desc">{description}</p>
        )}
      </div>
    </div>
  );
}
