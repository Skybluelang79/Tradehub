import { useState } from 'react';
import { Header } from '../components/layout';
import { Input, Textarea, Select } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { CameraIcon, MapPinIcon, XIcon } from '../components/ui/Icons';
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

export default function AddListing() {
  const { addItem, userLocation, setActiveTab, locationLoading } = useApp();
  const { addToast } = useToast();
  const [images, setImages] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('');
  const [location, setLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title || !price || !category) {
      addToast('Please fill in all required fields', 'error');
      return;
    }

    setIsSubmitting(true);

    const newItem = {
      title,
      description,
      price: parseFloat(price),
      category,
      condition: condition || 'good',
      images: images.length > 0 ? images : ['https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=400'],
      location: {
        lat: userLocation?.lat || 40.7128,
        lng: userLocation?.lng || -74.006,
        address: location || 'Location detected',
      },
    };

    addItem(newItem);
    setIsSubmitting(false);
    setActiveTab('home');
    addToast('Listing published successfully!', 'success');
  };

  const isValid = title.trim() && price && parseFloat(price) > 0 && category;

  return (
    <div className="page">
      <Header title="Sell Item" subtitle="Create a new listing" />

      <form className="listing-form" onSubmit={handleSubmit}>
        <LivePreview
          title={title}
          price={price}
          description={description}
          images={images}
          condition={conditions.find(c => c.value === condition)?.label}
        />
        
        <div className="image-upload-area">
          {images.map((img, index) => (
            <div key={index} className="upload-slot has-image">
              <img src={img} alt={`Upload ${index + 1}`} className="uploaded-image" />
              <button type="button" className="remove-image" onClick={() => removeImage(index)}>
                <XIcon size={14} />
              </button>
            </div>
          ))}
          {images.length < 6 && (
            <label className="upload-slot">
              <CameraIcon size={28} />
              <span>{images.length === 0 ? 'Add Photos' : 'Add More'}</span>
              <input type="file" accept="image/*" multiple onChange={handleImageUpload} style={{ display: 'none' }} />
            </label>
          )}
        </div>

        <div className="input-group">
          <label className="input-label">Title *</label>
          <input type="text" className="input" placeholder="What are you selling?" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>

        <Textarea label="Description" placeholder="Describe your item - include details like brand, size, condition..." value={description} onChange={setDescription} />

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
            <MapPinIcon size={20} />
            {locationLoading ? 'Detecting...' : 'Detect My Location'}
          </button>
          {location && <p className="location-text">Location set: {location}</p>}
        </div>

        <button type="submit" className="submit-btn" disabled={isSubmitting || !isValid}>
          {isSubmitting ? 'Publishing...' : 'Publish Listing'}
        </button>
      </form>
    </div>
  );
}
