import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Header } from '../components/layout';
import { ItemsGrid, AdBanner, AdCard, AdPush, SearchSuggestions, PullToRefresh } from '../components/features';
import { SearchIcon, GridIcon, ListIcon, ChevronDownIcon, XIcon } from '../components/ui/Icons';
import { useApp } from '../context';
import { categories, distanceOptions, sortOptions } from '../services/api';
import { useDebounce } from '../hooks';
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
    if (debouncedSearch !== filters.search) {
      setFilters({ ...filters, search: debouncedSearch });
    }
  }, [debouncedSearch]);

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
        <AdBanner />
        
        {!filters.search && recentlyViewed.length > 0 && (
          <div className="section-block">
            <div className="section-header">
              <h3 className="section-title">Recently Viewed</h3>
            </div>
            <div className="horizontal-scroll">
              {recentlyViewed.map(item => (
                <div key={item.id} className="mini-item-card" onClick={() => setSelectedItem(item)}>
                  <div className="mini-item-image">
                    <img src={item.images?.[0]} alt={item.title} />
                  </div>
                  <div className="mini-item-info">
                    <span className="mini-item-title">{item.title}</span>
                    <span className="mini-item-price">${item.price}</span>
                  </div>
                </div>
              ))}
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
              {trendingItems.map(item => (
                <div key={item.id} className="mini-item-card" onClick={() => setSelectedItem(item)}>
                  <div className="mini-item-image">
                    <img src={item.images?.[0]} alt={item.title} />
                    <span className="mini-item-views">{item.views} views</span>
                  </div>
                  <div className="mini-item-info">
                    <span className="mini-item-title">{item.title}</span>
                    <span className="mini-item-price">${item.price}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <ItemsGrid
          items={filteredItems}
          onItemClick={setSelectedItem}
          getDistance={getDistanceFromUser}
          viewMode={viewMode}
        />
        
        <AdPush className="ad-push-inline" />
        
        <AdCard />
      </div>
      </PullToRefresh>
    </div>
  );
}
