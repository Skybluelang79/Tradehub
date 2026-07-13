import { useState, useMemo, useRef } from 'react';
import { Header } from '../components/layout';
import { Input, Textarea, Select } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { useApp } from '../context';
import { LivePreview } from '../components/features';
import { categories } from '../services/api';
import '../styles/globals.css';
import './AddListing.css';

const conditions = [
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
];

const AUTO_DESCRIPTIONS = {
  electronics: 'In excellent working condition. Fully tested and functioning properly. Includes all original accessories and packaging. Minor signs of normal use. Please refer to photos for accurate representation of condition.',
  fashion: 'Gently used item in great condition. Clean and well-maintained. No stains, tears, or significant wear. True to size. Perfect for everyday wear or special occasions.',
  gaming: 'Well-maintained and fully functional. Tested and working perfectly. Includes all cables and accessories. Minor cosmetic wear from normal use. Smoke-free environment.',
  furniture: 'Used but in great condition. Sturdy and structurally sound. Minor cosmetic wear consistent with normal use. Clean and ready for immediate use. Local pickup preferred.',
  sports: 'Used but well-maintained. Clean and in good working order. No major damage or defects. Ready for use. Price reflects normal wear and tear from regular use.',
  books: 'Used book in good condition. Pages are clean with no marking or highlighting. Cover shows minor wear. No missing pages. Great condition for the price.',
  home: 'Gently used item in good condition. Clean and well-cared for. No major defects or damage functions as intended. Ready to use in your home.',
  vehicles: 'Well-maintained and in good running condition. Regular maintenance performed. Clean title. No major mechanical issues. Available for inspection and test drive.',
  other: 'Used item in good condition. Clean and fully functional. Well-cared for and ready to use. Please see photos for details on condition.',
};

const SUGGESTED_CATEGORIES = {
  phone: 'electronics', laptop: 'electronics', computer: 'electronics', camera: 'electronics', headphones: 'electronics', tv: 'electronics', speaker: 'electronics',
  shirt: 'fashion', dress: 'fashion', jacket: 'fashion', shoes: 'fashion', bag: 'fashion', watch: 'fashion', jeans: 'fashion',
  nintendo: 'gaming', playstation: 'gaming', xbox: 'gaming', game: 'gaming', console: 'gaming',
  sofa: 'furniture', table: 'furniture', chair: 'furniture', desk: 'furniture', bed: 'furniture', shelf: 'furniture',
  bike: 'sports', ball: 'sports', gym: 'sports', yoga: 'sports', fitness: 'sports',
  book: 'books', novel: 'books', textbook: 'books',
  car: 'vehicles', truck: 'vehicles', motorcycle: 'vehicles', bike: 'vehicles',
};

function getPriceSuggestions(items, selectedCategory) {
  const catItems = items.filter((i) =>
    i.category.toLowerCase() === selectedCategory?.toLowerCase() &&
    i.status === 'active' &&
    i.price > 0
  );
  if (catItems.length < 2) return null;
  const prices = catItems.map((i) => i.price).sort((a, b) => a - b);
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  return {
    count: catItems.length,
    avg: Math.round(avg),
    median: Math.round(median),
    min: prices[0],
    max: prices[prices.length - 1],
  };
}

function useEditItem(editItemId, items) {
  const item = editItemId ? items.find((i) => i.id === editItemId) : null;
  return {
    editingItem: item || null,
    initialImages: item?.images || [],
    initialTitle: item?.title || '',
    initialDescription: item?.description || '',
    initialPrice: item ? String(item.price) : '',
    initialCategory: item?.category || '',
    initialCondition: item?.condition || '',
    initialLocation: item?.location?.address || '',
    initialQuantity: item?.quantity || 1,
    initialSalePrice: item?.salePrice ? String(item.salePrice) : '',
    initialSaleEndsAt: item?.saleEndsAt || '',
  };
}

export default function AddListing({ editItemId, onEditComplete }) {
  const {
    addItem, updateItem, items, userLocation, setActiveTab, locationLoading,
    saveTemplate, getTemplates,
  } = useApp();
  const { addToast } = useToast();
  const fileInputRef = useRef(null);

  const {
    editingItem,
    initialImages, initialTitle, initialDescription,
    initialPrice, initialCategory, initialCondition, initialLocation,
    initialQuantity, initialSalePrice, initialSaleEndsAt,
  } = useEditItem(editItemId, items);

  const [images, setImages] = useState(initialImages);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [price, setPrice] = useState(initialPrice);
  const [category, setCategory] = useState(initialCategory);
  const [condition, setCondition] = useState(initialCondition);
  const [location, setLocation] = useState(initialLocation);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [boostListing, setBoostListing] = useState(false);
  const [boostDuration, setBoostDuration] = useState(7);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkItems, setBulkItems] = useState([]);

  const [quantity, setQuantity] = useState(initialQuantity);
  const [variants, setVariants] = useState([]);
  const [variantName, setVariantName] = useState('');
  const [variantValues, setVariantValues] = useState('');

  const [salePrice, setSalePrice] = useState(initialSalePrice);
  const [saleEnabled, setSaleEnabled] = useState(!!initialSalePrice);
  const [saleEndsAt, setSaleEndsAt] = useState(initialSaleEndsAt);
  const [saleEndsEnabled, setSaleEndsEnabled] = useState(!!initialSaleEndsAt);

  const [showVariants, setShowVariants] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templateName, setTemplateName] = useState('');

  const [showAiDesc, setShowAiDesc] = useState(false);

  const existingTemplates = getTemplates();

  const suggestions = useMemo(() => {
    if (!category || category === 'all') return null;
    return getPriceSuggestions(items, category);
  }, [category, items]);

  const discountPercent = useMemo(() => {
    if (!saleEnabled || !salePrice || !price) return 0;
    const p = parseFloat(price);
    const s = parseFloat(salePrice);
    if (p <= 0 || s <= 0) return 0;
    return Math.round((1 - s / p) * 100);
  }, [saleEnabled, salePrice, price]);

  const handleApplySuggestion = (value) => {
    setPrice(String(value));
    addToast(`Price set to $${value.toLocaleString()}`, 'success');
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    if (images.length + files.length > 6) {
      addToast('Maximum 6 images allowed', 'error');
      return;
    }
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImages((prev) => [...prev, event.target.result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleCameraCapture = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.multiple = true;
    input.onchange = (e) => handleImageUpload(e);
    input.click();
  };

  const removeImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const detectLocation = () => {
    if (userLocation) {
      setLocation(`${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`);
    } else {
      addToast('Could not detect location', 'error');
    }
  };

  const generateAutoDescription = () => {
    if (!title) {
      addToast('Please enter a title first', 'error');
      return;
    }
    const catKey = category || 'other';
    const template = AUTO_DESCRIPTIONS[catKey] || AUTO_DESCRIPTIONS.other;
    setDescription(`"${title}"\n\n${template}`);
    addToast('Description generated!', 'success');
  };

  const suggestCategory = () => {
    if (!title) return;
    const lower = title.toLowerCase();
    for (const [keyword, cat] of Object.entries(SUGGESTED_CATEGORIES)) {
      if (lower.includes(keyword)) {
        setCategory(cat);
        addToast(`Category suggested: ${cat}`, 'success');
        return;
      }
    }
  };

  const handleAddVariant = () => {
    if (!variantName.trim() || !variantValues.trim()) {
      addToast('Enter variant name and values', 'error');
      return;
    }
    const values = variantValues.split(',').map((v) => ({
      value: v.trim(),
      stock: 1,
    })).filter((v) => v.value);
    if (values.length === 0) return;
    setVariants((prev) => [...prev, { name: variantName.trim(), values }]);
    setVariantName('');
    setVariantValues('');
    addToast(`Variant "${variantName}" added`, 'success');
  };

  const removeVariant = (index) => {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const buildItemData = () => ({
    title,
    description,
    price: parseFloat(price),
    salePrice: saleEnabled && salePrice ? parseFloat(salePrice) : null,
    saleEndsAt: saleEnabled && saleEndsEnabled && saleEndsAt ? saleEndsAt : null,
    category,
    condition: condition || 'good',
    images: images.length > 0 ? images : ['https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=400'],
    location: {
      lat: userLocation?.lat || 40.7128,
      lng: userLocation?.lng || -74.006,
      address: location || 'Location detected',
    },
    quantity: parseInt(quantity) || 1,
    variants,
    boosted: boostListing,
    boostExpiresAt: boostListing
      ? new Date(Date.now() + boostDuration * 86400000).toISOString()
      : null,
  });

  const handleSaveAsTemplate = () => {
    if (!title) {
      addToast('Please add a title to save as template', 'error');
      return;
    }
    const name = templateName || title;
    saveTemplate({
      name,
      title,
      description,
      price,
      category,
      condition,
      quantity,
      salePrice: saleEnabled && salePrice ? salePrice : '',
      variants,
    });
    setTemplateName('');
    addToast(`Template "${name}" saved!`, 'success');
  };

  const handleLoadTemplate = (tmpl) => {
    setTitle(tmpl.title || '');
    setDescription(tmpl.description || '');
    setPrice(tmpl.price || '');
    setCategory(tmpl.category || '');
    setCondition(tmpl.condition || '');
    setQuantity(tmpl.quantity || 1);
    if (tmpl.salePrice) {
      setSalePrice(tmpl.salePrice);
      setSaleEnabled(true);
    }
    if (tmpl.variants) {
      setVariants(tmpl.variants);
    }
    setShowTemplatePicker(false);
    addToast(`Template "${tmpl.name}" loaded`, 'success');
  };

  const handleSaveDraft = () => {
    if (!title) {
      addToast('Please add a title to save draft', 'error');
      return;
    }
    if (editingItem) {
      updateItem(editingItem.id, { ...buildItemData(), status: editingItem.status });
      addToast('Draft updated!', 'success');
      if (onEditComplete) onEditComplete();
    } else {
      addItem(buildItemData(), 'draft');
      addToast('Draft saved!', 'success');
    }
    resetForm();
    setActiveTab('home');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title || !price || !category) {
      addToast('Please fill in all required fields', 'error');
      return;
    }
    setIsSubmitting(true);
    if (editingItem) {
      updateItem(editingItem.id, buildItemData());
      addToast('Listing updated successfully!', 'success');
      if (onEditComplete) onEditComplete();
    } else {
      addItem(buildItemData(), 'active');
      addToast('Listing published successfully!', 'success');
    }
    setIsSubmitting(false);
    resetForm();
    setActiveTab('home');
  };

  const handleBulkAdd = () => {
    if (!title || !price || !category) {
      addToast('Please fill in all required fields', 'error');
      return;
    }
    const newItem = addItem(buildItemData(), 'active');
    setBulkItems((prev) => [...prev, newItem]);
    resetForm();
    addToast(`Item added (${bulkItems.length + 1}) — add another or finish`, 'success');
  };

  const resetForm = () => {
    if (!isBulkMode) {
      setImages([]);
      setTitle('');
      setDescription('');
      setPrice('');
      setCategory('');
      setCondition('');
      setLocation('');
      setBoostListing(false);
      setQuantity(1);
      setVariants([]);
      setSalePrice('');
      setSaleEnabled(false);
      setSaleEndsAt('');
      setSaleEndsEnabled(false);
    }
  };

  const isValid = title.trim() && price && parseFloat(price) > 0 && category;

  return (
    <div className="page">
      <Header
        title={editingItem ? 'Edit Listing' : isBulkMode ? 'Bulk Listing' : 'Sell Item'}
        subtitle={editingItem ? 'Update your listing' : isBulkMode ? `Add items (${bulkItems.length} created)` : 'Create a new listing'}
      />

      <form className="listing-form" onSubmit={handleSubmit}>
        <LivePreview
          title={title}
          price={price}
          salePrice={saleEnabled ? salePrice : null}
          description={description}
          images={images}
          condition={conditions.find(c => c.value === condition)?.label}
        />

        <div className="image-upload-area">
          {images.map((img, index) => (
            <div key={index} className="upload-slot has-image">
              <img src={img} alt={`Upload ${index + 1}`} className="uploaded-image" />
              <button type="button" className="remove-image" onClick={() => removeImage(index)}>
                <i className="bi bi-x" />
              </button>
            </div>
          ))}
          {images.length < 6 && (
            <>
              <label className="upload-slot upload-slot--add">
                <i className="bi bi-camera" />
                <span>{images.length === 0 ? 'Add Photos' : 'Add More'}</span>
                <input type="file" accept="image/*" multiple onChange={handleImageUpload} style={{ display: 'none' }} ref={fileInputRef} />
              </label>
              <button type="button" className="upload-slot upload-slot--camera" onClick={handleCameraCapture}>
                <i className="bi bi-camera-fill" />
                <span>Camera</span>
              </button>
            </>
          )}
        </div>

        <div className="input-group">
          <label className="input-label">Title *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" className="input" placeholder="What are you selling?" value={title} onChange={(e) => { setTitle(e.target.value); suggestCategory(); }} required style={{ flex: 1 }} />
            {title && (
              <button type="button" className="ai-btn" onClick={generateAutoDescription} title="Auto-generate description">
                <i className="bi bi-stars" />
              </button>
            )}
          </div>
        </div>

        <Textarea label="Description" placeholder="Describe your item - include details like brand, size, condition..." value={description} onChange={(e) => setDescription(e.target.value)} />

        <div className="input-group">
          <div className="collapsible-header" onClick={() => setShowAiDesc(!showAiDesc)}>
            <i className="bi bi-magic" />
            <span>AI Tools</span>
            <i className={`bi bi-chevron-${showAiDesc ? 'up' : 'down'}`} />
          </div>
          {showAiDesc && (
            <div className="ai-tools-panel">
              <button type="button" className="ai-tool-btn" onClick={generateAutoDescription}>
                <i className="bi bi-pencil-square" />
                Generate Description
              </button>
              <button type="button" className="ai-tool-btn" onClick={suggestCategory}>
                <i className="bi bi-tag" />
                Suggest Category
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="input-group">
            <label className="input-label">Price *</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-primary)', fontWeight: 600 }}>$</span>
              <input type="number" className="input" style={{ paddingLeft: 32 }} placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </div>
          </div>
          <Select label="Category *" options={categories.filter((c) => c.id !== 'all')} placeholder="Select..." value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>

        {suggestions && !price && (
          <div className="price-suggestions">
            <div className="price-suggestions-header">
              <i className="bi bi-graph-up-arrow" />
              <span>Market prices for this category</span>
            </div>
            <div className="price-suggestions-chips">
              <button type="button" className="suggestion-chip" onClick={() => handleApplySuggestion(suggestions.median)}>
                Median ${suggestions.median.toLocaleString()}
              </button>
              <button type="button" className="suggestion-chip" onClick={() => handleApplySuggestion(suggestions.avg)}>
                Avg ${suggestions.avg.toLocaleString()}
              </button>
              <button type="button" className="suggestion-chip" onClick={() => handleApplySuggestion(suggestions.min)}>
                Min ${suggestions.min.toLocaleString()}
              </button>
            </div>
            <span className="price-suggestions-count">Based on {suggestions.count} similar items</span>
          </div>
        )}

        <div className="input-group">
          <label className="input-label">Quantity</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="qty-btn" onClick={() => setQuantity(Math.max(1, quantity - 1))}>-</button>
            <span className="qty-value">{quantity}</span>
            <button type="button" className="qty-btn" onClick={() => setQuantity(quantity + 1)}>+</button>
            <span className="qty-hint">{quantity === 1 ? 'Single item' : `${quantity} items available`}</span>
          </div>
        </div>

        <div className="input-group">
          <div className="collapsible-header" onClick={() => setShowVariants(!showVariants)} style={{ cursor: 'pointer' }}>
            <i className="bi bi-layers" />
            <span>Variants (size, color, etc.)</span>
            <i className={`bi bi-chevron-${showVariants ? 'up' : 'down'}`} style={{ marginLeft: 'auto' }} />
          </div>
          {showVariants && (
            <>
              {variants.map((v, i) => (
                <div key={i} className="variant-chip-group">
                  <span className="variant-chip">
                    <strong>{v.name}:</strong> {v.values.map(x => x.value).join(', ')}
                  </span>
                  <button type="button" className="variant-remove" onClick={() => removeVariant(i)}>
                    <i className="bi bi-x" />
                  </button>
                </div>
              ))}
              <div className="variant-input-row">
                <input type="text" className="input variant-input" placeholder="e.g. Size" value={variantName} onChange={(e) => setVariantName(e.target.value)} />
                <input type="text" className="input variant-input" placeholder="e.g. S, M, L" value={variantValues} onChange={(e) => setVariantValues(e.target.value)} />
                <button type="button" className="variant-add-btn" onClick={handleAddVariant}>
                  <i className="bi bi-plus" />
                </button>
              </div>
            </>
          )}
        </div>

        <div className="input-group">
          <div className="collapsible-header" onClick={() => setSaleEnabled(!saleEnabled)} style={{ cursor: 'pointer' }}>
            <i className="bi bi-percent" />
            <span>Sale / Discount</span>
            <div className={`toggle-sm ${saleEnabled ? 'active' : ''}`} />
          </div>
          {saleEnabled && (
            <div className="sale-panel">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="input-group">
                  <label className="input-label">Sale Price</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-primary)', fontWeight: 600 }}>$</span>
                    <input type="number" className="input" style={{ paddingLeft: 32 }} placeholder="0" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
                  </div>
                </div>
              </div>
              {discountPercent > 0 && (
                <div className="discount-badge-preview">
                  <span className="discount-badge-preview-value">{discountPercent}% OFF</span>
                </div>
              )}
              <div className="input-group" style={{ marginTop: 8 }}>
                <label className="input-label">
                  <input type="checkbox" checked={saleEndsEnabled} onChange={() => setSaleEndsEnabled(!saleEndsEnabled)} />
                  <span style={{ marginLeft: 8 }}>Set end date</span>
                </label>
                {saleEndsEnabled && (
                  <input type="datetime-local" className="input" value={saleEndsAt} onChange={(e) => setSaleEndsAt(e.target.value)} style={{ marginTop: 8 }} />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="input-group">
          <label className="input-label">Condition</label>
          <div className="condition-options">
            {conditions.map((cond) => (
              <button key={cond.value} type="button" className={`condition-option ${condition === cond.value ? 'active' : ''}`} onClick={() => setCondition(cond.value)}>
                {cond.label}
              </button>
            ))}
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">Location</label>
          <button type="button" className={`location-detect ${locationLoading ? 'loading' : ''}`} onClick={detectLocation}>
            <i className="bi bi-geo-alt" />
            {locationLoading ? 'Detecting...' : 'Detect My Location'}
          </button>
          {location && <p className="location-text">Location set: {location}</p>}
        </div>

        {!editingItem && (
          <div className="input-group">
            <label className="input-label">
              <i className="bi bi-lightning-fill" />
              <span>Boost Listing</span>
            </label>
            <div className="boost-options">
              <button type="button" className={`boost-option ${!boostListing ? 'active' : ''}`} onClick={() => setBoostListing(false)}>
                <span className="boost-option-title">Standard</span>
                <span className="boost-option-price">Free</span>
              </button>
              <button type="button" className={`boost-option ${boostListing ? 'active' : ''}`} onClick={() => setBoostListing(true)}>
                <span className="boost-option-title">Boosted</span>
                <span className="boost-option-price">$4.99</span>
                <span className="boost-option-desc">Top of search for {boostDuration} days</span>
              </button>
            </div>
            {boostListing && (
              <div className="boost-duration">
                <label className="boost-duration-label">Duration:</label>
                <div className="boost-duration-options">
                  {[3, 7, 14, 30].map((days) => (
                    <button key={days} type="button" className={`boost-duration-chip ${boostDuration === days ? 'active' : ''}`} onClick={() => setBoostDuration(days)}>
                      {days}d
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!editingItem && (
          <div className="input-group">
            <div className="template-actions">
              <button type="button" className="template-btn" onClick={() => setShowTemplatePicker(!showTemplatePicker)}>
                <i className="bi bi-file-earmark-text" />
                Load Template
              </button>
              <button type="button" className="template-btn" onClick={handleSaveAsTemplate}>
                <i className="bi bi-save" />
                Save as Template
              </button>
            </div>
            {templateName && <p className="template-saved-hint">Saved as "{templateName}"</p>}
            {showTemplatePicker && existingTemplates.length > 0 && (
              <div className="template-picker">
                <input type="text" className="input" placeholder="Template name..." value={templateName} onChange={(e) => setTemplateName(e.target.value)} style={{ marginBottom: 8 }} />
                {existingTemplates.map((tmpl) => (
                  <button key={tmpl.id} type="button" className="template-option" onClick={() => handleLoadTemplate(tmpl)}>
                    <i className="bi bi-file-text" />
                    <span>{tmpl.name}</span>
                    <span className="template-option-meta">{tmpl.category} · ${tmpl.price}</span>
                  </button>
                ))}
              </div>
            )}
            {showTemplatePicker && existingTemplates.length === 0 && (
              <div className="template-picker-empty">No saved templates yet</div>
            )}
          </div>
        )}

        <div className="submit-actions">
          {isBulkMode ? (
            <>
              <button type="button" className="draft-btn" onClick={handleBulkAdd}>
                <i className="bi bi-plus-circle" /> Add Another
              </button>
              <button type="submit" className={`submit-btn ${isSubmitting ? 'submit-btn--loading' : ''}`} disabled={isSubmitting || !isValid || bulkItems.length === 0}>
                {isSubmitting ? (
                  <><i className="bi bi-arrow-repeat submit-spinner" /> Finishing...</>
                ) : (
                  <><i className="bi bi-check-all" /> Finish ({bulkItems.length} items)</>
                )}
              </button>
            </>
          ) : (
            <>
              {!editingItem && (
                <button type="button" className="draft-btn" onClick={handleSaveDraft}>
                  <i className="bi bi-clock-history" /> Save as Draft
                </button>
              )}
              <button type="submit" className={`submit-btn ${isSubmitting ? 'submit-btn--loading' : ''}`} disabled={isSubmitting || !isValid}>
                {isSubmitting ? (
                  <><i className="bi bi-arrow-repeat submit-spinner" /> Publishing...</>
                ) : editingItem ? (
                  <><i className="bi bi-check-lg" /> Update Listing</>
                ) : (
                  <><i className="bi bi-megaphone" /> Publish Listing</>
                )}
              </button>
            </>
          )}
        </div>

        {!editingItem && !isBulkMode && (
          <button type="button" className="bulk-toggle-btn" onClick={() => setIsBulkMode(true)}>
            <i className="bi bi-files" /> Switch to Bulk Mode
          </button>
        )}
        {isBulkMode && (
          <button type="button" className="bulk-toggle-btn" onClick={() => setIsBulkMode(false)}>
            <i className="bi bi-file-earmark" /> Switch to Single Mode
          </button>
        )}
      </form>
    </div>
  );
}
