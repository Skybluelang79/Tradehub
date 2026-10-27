import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Header } from '../components/layout';
import { ItemCard } from '../components/features';
import { api } from '../services/client';
import { useToast } from '../context/ToastContext';
import './Storefront.css';

export default function Storefront() {
  const { username } = useParams();
  const { addToast } = useToast();
  const [store, setStore] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStore();
  }, [username]);

  const loadStore = async () => {
    try {
      setLoading(true);
      const data = await api.users.getStore(username);
      setStore(data.store);
      setItems(data.items || []);
    } catch (err) {
      addToast(err.message || 'Store not found', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="storefront-loading">Loading store...</div>;
  if (!store) return <div className="storefront-empty">Store not found</div>;

  return (
    <div className="storefront-page">
      <div className="storefront-header">
        <div className="storefront-banner" style={{ backgroundImage: store.banner ? url() : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }} />
        <div className="storefront-info">
          <img src={store.avatar || '/default-avatar.png'} alt={store.name} className="storefront-avatar" />
          <div className="storefront-details">
            <h1 className="storefront-name">{store.name}</h1>
            <p className="storefront-username">@{store.username}</p>
            {store.bio && <p className="storefront-bio">{store.bio}</p>}
            <div className="storefront-stats">
              <span>{items.length} Items</span>
              <span>? {store.rating?.toFixed(1) || '0.0'} ({store.reviewCount || 0} reviews)</span>
              {store.verified && <span className="storefront-badge">? Verified</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="storefront-content">
        <Header title="Store Items" />
        {items.length === 0 ? (
          <div className="storefront-empty">No items yet</div>
        ) : (
          <div className="items-grid">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
