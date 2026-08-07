import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Header } from '../components/layout';
import { ItemsGrid, AdBanner, AdCard, AdPush, BrandSponsor, SafeTrading, ListForFree, PremiumSeller, SearchSuggestions, PullToRefresh } from '../components/features';
import { SearchIcon, GridIcon, ListIcon, ChevronDownIcon, XIcon, FilterIcon, ShieldIcon } from '../components/ui/Icons';
import { useApp } from '../context';
import { categories, distanceOptions, sortOptions, conditionOptions } from '../services/api';
import { useDebounce } from '../hooks';
import { formatPrice } from '../utils/helpers';
import '../styles/globals.css';
import './Home.css';

export default function Home() {
  const {
    filteredItems,
    items,
    filters,
    setFilters,
    viewMode,
    setViewMode,
    setSelectedItem,
    setActiveTab,
    getDistanceFromUser,
  } = useApp();

  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const loadingTimerRef = useRef(null);
  const debouncedSearch = useDebounce(searchInput, 300);

  const trendingItems = useMemo(() => {
    return [...items]
      .filter(i => i.status === 'active')
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, 8);
  }, [items]);

  const sortedItems = useMemo(() => {
    const now = new Date();
    return [...filteredItems].sort((a, b) => {
      const aExpires = a.boostExpiresAt ? new Date(a.boostExpiresAt) : null;
      const bExpires = b.boostExpiresAt ? new Date(b.boostExpiresAt) : null;
      const aBoosted = a.boosted && aExpires && aExpires > now ? 1 : 0;
      const bBoosted = b.boosted && bExpires && bExpires > now ? 1 : 0;
      if (aBoosted !== bBoosted) return bBoosted - aBoosted;
      return 0;
    });
  }, [filteredItems]);

  const recentlyViewed = useMemo(() => {
    try {
      const ids = JSON.parse(localStorage.getItem('tradehub_recently_viewed') || '[]');
      return ids.map(id => items.find(i => i.id === id)).filter(Boolean).slice(0, 6);
    } catch {
      return [];
    }
  }, [items]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setLoading(false);
  }, []);

  const handleSearchClearHistory = useCallback(() => {
    localStorage.removeItem('tradehub_recent_searches');
  }, []);

  const handleSearchSuggestion = useCallback((text) => {
    setSearchInput(text);
    setFilters({ ...filters, search: text });
  }, [filters, setFilters]);

  useEffect(() => {
    setFilters((prev) => prev.search === debouncedSearch ? prev : { ...prev, search: debouncedSearch });
  }, [debouncedSearch, setFilters]);

  useEffect(() => {
    return () => clearTimeout(loadingTimerRef.current);
  }, []);

  const handleFilterClick = (filterType, value) => {
    setLoading(true);
    setFilters({ ...filters, [filterType]: value });
    clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = setTimeout(() => setLoading(false), 300);
  };

  const currentSort = sortOptions.find((s) => s.value === filters.sort);

  const activeExtraFilterCount =
    (filters.minPrice ? 1 : 0) + (filters.maxPrice ? 1 : 0) + (filters.condition && filters.condition !== 'all' ? 1 : 0);

  return (
      <div className="page">
        <Header
          title="TradeHub"
          subtitle="Find local deals near you"
          rightComponent={
            <button className="header-btn" onClick={() => setShowSearch(!showSearch)}>
              <SearchIcon size={20} />
            </button>
          }
        />

      <PullToRefresh onRefresh={handleRefresh}>
      {showSearch && (
        <div className="search-bar-container">
          <div className="search-input-wrapper">
            <SearchIcon size={18} />
            <input
              type="text"
              className="search-input"
              placeholder="Search items..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              autoFocus
            />
            {searchInput && (
              <button className="search-clear" onClick={() => setSearchInput('')}>
                <XIcon size={16} />
              </button>
            )}
          </div>
          <SearchSuggestions
            query={searchInput}
            items={items}
            onSelect={handleSearchSuggestion}
            onClearHistory={handleSearchClearHistory}
          />
        </div>
      )}

      <div className="filters-scroll">
        {distanceOptions.map((opt) => (
          <button
            key={opt.value}
            className={`filter-chip ${filters.distance === opt.value ? 'active' : ''}`}
            onClick={() => handleFilterClick('distance', opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="filters-scroll">
        {categories.map((cat) => (
          <button
            key={cat.id}
            className={`filter-chip ${filters.category === cat.id ? 'active' : ''}`}
            onClick={() => handleFilterClick('category', cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      <div className="extra-filters">
        <button className={`filter-chip ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)}>
          <FilterIcon size={15} /> Price & Condition
          {activeExtraFilterCount > 0 && <span className="filter-count">{activeExtraFilterCount}</span>}
        </button>

        {showFilters && (
          <div className="filter-panel">
            <div className="filter-panel-group">
              <span className="filter-panel-label">Price range</span>
              <div className="filter-price-row">
                <input
                  type="number"
                  className="filter-price-input"
                  placeholder="Min $"
                  min="0"
                  value={filters.minPrice}
                  onChange={(e) => handleFilterClick('minPrice', e.target.value)}
                />
                <span className="filter-price-sep">–</span>
                <input
                  type="number"
                  className="filter-price-input"
                  placeholder="Max $"
                  min="0"
                  value={filters.maxPrice}
                  onChange={(e) => handleFilterClick('maxPrice', e.target.value)}
                />
              </div>
            </div>
            <div className="filter-panel-group">
              <span className="filter-panel-label">Condition</span>
              <div className="filter-condition-row">
                {[{ value: 'all', label: 'Any' }, ...conditionOptions].map((c) => (
                  <button
                    key={c.value}
                    className={`filter-chip ${(filters.condition || 'all') === c.value ? 'active' : ''}`}
                    onClick={() => handleFilterClick('condition', c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            {activeExtraFilterCount > 0 && (
              <button
                className="filter-clear"
                onClick={() => {
                  handleFilterClick('minPrice', '');
                  handleFilterClick('maxPrice', '');
                  handleFilterClick('condition', 'all');
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <div className="view-controls">
        <span className="results-count">
          {loading ? 'Searching...' : `${filteredItems.length} items found`}
        </span>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="sort-dropdown">
            <button className="sort-btn" onClick={() => setShowSortMenu(!showSortMenu)}>
              {currentSort?.label || 'Sort'}
              <ChevronDownIcon size={16} />
            </button>
            {showSortMenu && (
              <div className="sort-menu">
                {sortOptions.map((opt) => (
                  <button
                    key={opt.value}
                    className={`sort-option ${filters.sort === opt.value ? 'active' : ''}`}
                    onClick={() => {
                      handleFilterClick('sort', opt.value);
                      setShowSortMenu(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="view-toggle">
            <button
              className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
            >
              <GridIcon size={18} />
            </button>
            <button
              className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              <ListIcon size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="page-content">
        <BrandSponsor />
        <SafeTrading />
        <ListForFree onList={() => setActiveTab('add')} />
        <PremiumSeller />
        <AdBanner />

        <button className="gift-mall-banner" onClick={() => window.dispatchEvent(new CustomEvent('openGiftMall'))}>
          <span className="gift-mall-banner-icon">🎁</span>
          <span className="gift-mall-banner-text">
            <strong>Gift Mall</strong>
            <small>Browse gift card brands &amp; share your own card design</small>
          </span>
          <span className="gift-mall-banner-arrow">→</span>
        </button>
        
        {!filters.search && recentlyViewed.length > 0 && (
          <div className="section-block">
            <div className="section-header">
              <h3 className="section-title">Recently Viewed</h3>
            </div>
            <div className="horizontal-scroll">
              {recentlyViewed.map(item => {
                const hasSale = item.salePrice && item.salePrice > 0 && item.salePrice < item.price;
                return (
                  <div key={item.id} className="mini-item-card" onClick={() => setSelectedItem(item)}>
                    <div className="mini-item-image">
                      <img src={item.images?.[0]} alt={item.title} />
                    </div>
                    <div className="mini-item-info">
                      <span className="mini-item-title">{item.title}</span>
                      {hasSale ? (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span className="mini-item-price mini-item-price--sale">{formatPrice(item.salePrice)}</span>
                          <span className="mini-item-price-original">{formatPrice(item.price)}</span>
                        </div>
                      ) : (
                        <span className="mini-item-price">{formatPrice(item.price)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {!filters.search && trendingItems.length > 0 && (
          <div className="section-block">
            <div className="section-header">
              <h3 className="section-title">Trending Now</h3>
              <span className="section-subtitle">Most viewed items</span>
            </div>
            <div className="horizontal-scroll">
              {trendingItems.map(item => {
                const hasSale = item.salePrice && item.salePrice > 0 && item.salePrice < item.price;
                return (
                  <div key={item.id} className="mini-item-card" onClick={() => setSelectedItem(item)}>
                    <div className="mini-item-image">
                      <img src={item.images?.[0]} alt={item.title} />
                      <span className="mini-item-views">{item.views} views</span>
                    </div>
                    <div className="mini-item-info">
                      <span className="mini-item-title">{item.title}</span>
                      {hasSale ? (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span className="mini-item-price mini-item-price--sale">{formatPrice(item.salePrice)}</span>
                          <span className="mini-item-price-original">{formatPrice(item.price)}</span>
                        </div>
                      ) : (
                        <span className="mini-item-price">{formatPrice(item.price)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        <ItemsGrid
          items={sortedItems}
          onItemClick={setSelectedItem}
          getDistance={getDistanceFromUser}
          viewMode={viewMode}
        />
        
        <AdPush className="ad-push-inline" />
        
        <AdCard />
      </div>
      </PullToRefresh>

      <footer className="home-footer">
        <span className="home-footer-copy">© {new Date().getFullYear()} TradeHub</span>
        <button className="home-footer-admin" onClick={() => window.dispatchEvent(new CustomEvent('openAdminLogin'))}>
          <ShieldIcon size={13} />
          Admin Login
        </button>
      </footer>
    </div>
  );
}
