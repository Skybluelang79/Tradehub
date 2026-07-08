import { useState, useRef, useCallback } from 'react';

export default function PullToRefresh({ onRefresh, children }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const containerRef = useRef(null);
  const pulling = useRef(false);

  const handleTouchStart = useCallback((e) => {
    if (containerRef.current && containerRef.current.scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!pulling.current) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0) {
      setPullDistance(Math.min(diff * 0.4, 80));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullDistance >= 60) {
      setRefreshing(true);
      setPullDistance(0);
      onRefresh().finally(() => {
        setRefreshing(false);
      });
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, onRefresh]);

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ position: 'relative', minHeight: '100%' }}
    >
      <div
        className={`pull-to-refresh-indicator ${refreshing ? 'refreshing' : pullDistance > 0 ? 'pulling' : ''}`}
        style={{
          height: refreshing ? 50 : pullDistance,
          opacity: refreshing ? 1 : pullDistance / 80,
        }}
      >
        {refreshing ? (
          <div className="pull-spinner" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ transform: `rotate(${pullDistance * 3}deg)`, transition: 'transform 0.1s' }}>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        )}
        <span>{refreshing ? 'Refreshing...' : 'Pull to refresh'}</span>
      </div>
      {children}
    </div>
  );
}
