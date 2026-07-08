import { useMemo } from 'react';
import { ClockIcon } from '../ui/Icons';

export default function SearchSuggestions({ query, items, onSelect, onClearHistory }) {
  const recentSearches = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('tradehub_recent_searches') || '[]');
    } catch { return []; }
  }, []);

  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const matches = items
      .filter(i => i.title.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
      .slice(0, 5);
    return [...new Set(matches.map(i => i.title))];
  }, [query, items]);

  if (!query && recentSearches.length === 0) return null;

  const handleSelect = (text) => {
    const searches = [text, ...recentSearches.filter(s => s !== text)].slice(0, 10);
    localStorage.setItem('tradehub_recent_searches', JSON.stringify(searches));
    onSelect(text);
  };

  return (
    <div className="search-suggestions">
      {query ? (
        <>
          <div className="search-suggestions-header">Suggestions</div>
          {suggestions.length === 0 ? (
            <div className="search-suggestions-empty">No suggestions found</div>
          ) : (
            suggestions.map((s, i) => (
              <button key={i} className="search-suggestion-item" onClick={() => handleSelect(s)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                {s}
              </button>
            ))
          )}
        </>
      ) : (
        <>
          <div className="search-suggestions-header">
            Recent Searches
            {recentSearches.length > 0 && (
              <button className="search-suggestions-clear" onClick={onClearHistory}>Clear</button>
            )}
          </div>
          {recentSearches.map((s, i) => (
            <button key={i} className="search-suggestion-item" onClick={() => onSelect(s)}>
              <ClockIcon size={16} />
              {s}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
