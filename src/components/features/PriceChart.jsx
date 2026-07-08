import { useMemo, useState } from 'react';

export default function PriceChart({ priceHistory, currentPrice }) {
  const [interval, setInterval] = useState('1M');

  const chartData = useMemo(() => {
    if (!priceHistory || priceHistory.length === 0) return [];
    const intervals = { '1W': 7, '1M': 30, '3M': 90, '1Y': 365 };
    const days = intervals[interval] || 30;
    const now = Date.now();
    const cutoff = now - days * 86400000;
    return priceHistory.filter(p => new Date(p.date).getTime() > cutoff);
  }, [priceHistory, interval]);

  const maxPrice = useMemo(() => {
    if (chartData.length === 0) return currentPrice || 100;
    const prices = chartData.map(p => p.price);
    return Math.max(...prices, currentPrice || 0) * 1.1;
  }, [chartData, currentPrice]);

  const minPrice = useMemo(() => {
    if (chartData.length === 0) return 0;
    const prices = chartData.map(p => p.price);
    return Math.min(...prices, currentPrice || 0) * 0.9;
  }, [chartData, currentPrice]);

  if (!priceHistory || priceHistory.length === 0) return null;

  return (
    <div className="price-chart">
      <div className="price-chart-header">
        <h3 className="price-chart-title">Price History</h3>
        {currentPrice && (
          <span className="price-chart-current">
            Current: ${currentPrice}
          </span>
        )}
      </div>

      <div className="chart-bars">
        {chartData.length === 0 ? (
          <div className="chart-empty">No data for this period</div>
        ) : (
          chartData.map((point, i) => {
            const height = ((point.price - minPrice) / (maxPrice - minPrice)) * 100;
            const isLatest = i === chartData.length - 1;
            return (
              <div key={i} className="chart-bar-wrapper" title={`${point.date}: $${point.price}`}>
                <div
                  className={`chart-bar ${isLatest ? 'chart-bar--latest' : ''}`}
                  style={{ height: `${Math.max(height, 5)}%` }}
                />
              </div>
            );
          })
        )}
      </div>

      <div className="chart-labels">
        <span>${Math.round(minPrice)}</span>
        <span>${Math.round(maxPrice)}</span>
      </div>

      <div className="chart-intervals">
        {['1W', '1M', '3M', '1Y'].map(i => (
          <button
            key={i}
            className={`chart-interval-btn ${interval === i ? 'active' : ''}`}
            onClick={() => setInterval(i)}
          >
            {i}
          </button>
        ))}
      </div>
    </div>
  );
}
