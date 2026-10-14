import { useEffect, useId, useMemo, useRef, useState } from 'react';

const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];

const PAD = { top: 20, right: 20, bottom: 32, left: 58 };
const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

function niceCeil(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const step = NICE_STEPS.find((s) => fraction <= s) ?? 10;
  return step * base;
}

function smoothPath(points, tension = 0.16) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = p1.y + (p2.y - p0.y) * tension;
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

const AreaChart = ({
  data = [],
  color = '#8B5CF6',
  height = 220,
  valueFormat = (v) => String(v),
  labelFormat = (d) => d.label,
}) => {
  const wrapRef = useRef(null);
  const gradientId = useId().replace(/:/g, '');
  const [width, setWidth] = useState(640);
  const [hoverIndex, setHoverIndex] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const apply = () => setWidth(el.clientWidth || 640);
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const innerW = Math.max(width - PAD.left - PAD.right, 10);
  const innerH = Math.max(height - PAD.top - PAD.bottom, 10);
  const baseline = PAD.top + innerH;

  const max = useMemo(
    () => niceCeil(Math.max(...data.map((d) => Number(d.value) || 0), 0)),
    [data],
  );

  const points = useMemo(() => {
    const n = data.length;
    return data.map((d, i) => {
      const value = Number(d.value) || 0;
      const x = PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
      const y = PAD.top + innerH * (1 - value / max);
      return { x, y, value, datum: d };
    });
  }, [data, innerW, innerH, max]);

  const linePath = useMemo(() => smoothPath(points), [points]);
  const areaPath = useMemo(() => {
    if (!points.length) return '';
    const last = points[points.length - 1];
    const first = points[0];
    return `${linePath} L ${last.x.toFixed(2)} ${baseline.toFixed(2)} L ${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
  }, [linePath, points, baseline]);

  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  const handleMove = (event) => {
    if (!points.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = width / (rect.width || width);
    const mouseX = (event.clientX - rect.left) * scale;
    let nearest = 0;
    let best = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - mouseX);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  };

  const hovered = hoverIndex != null ? points[hoverIndex] : null;
  const last = points.length ? points[points.length - 1] : null;

  return (
    <div className="area-chart-wrap" ref={wrapRef}>
      <svg
        className="area-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={`area-fill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="55%" stopColor={color} stopOpacity="0.1" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`area-stroke-${gradientId}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </linearGradient>
        </defs>

        {GRID_FRACTIONS.map((fraction) => {
          const y = PAD.top + innerH * (1 - fraction);
          return (
            <g key={fraction}>
              <line className="area-chart-grid" x1={PAD.left} y1={y} x2={width - PAD.right} y2={y} />
              <text className="area-chart-axis-label" x={PAD.left - 10} y={y + 4} textAnchor="end">
                {valueFormat(max * fraction)}
              </text>
            </g>
          );
        })}

        <line
          className="area-chart-baseline"
          x1={PAD.left}
          y1={baseline}
          x2={width - PAD.right}
          y2={baseline}
        />

        {areaPath && (
          <path className="area-chart-area" d={areaPath} fill={`url(#area-fill-${gradientId})`} />
        )}
        {linePath && (
          <path
            className="area-chart-line"
            d={linePath}
            fill="none"
            stroke={`url(#area-stroke-${gradientId})`}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength="1"
          />
        )}

        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text
              key={`x-${p.datum.date || i}`}
              className="area-chart-axis-label"
              x={p.x}
              y={height - 10}
              textAnchor="middle"
            >
              {labelFormat(p.datum)}
            </text>
          ) : null,
        )}

        {hovered && (
          <g>
            <line
              className="area-chart-crosshair"
              x1={hovered.x}
              y1={PAD.top}
              x2={hovered.x}
              y2={baseline}
              stroke={color}
            />
            <circle cx={hovered.x} cy={hovered.y} r="5.5" fill={color} stroke="var(--surface)" strokeWidth="2.5" />
          </g>
        )}

        {last && !hovered && (
          <circle className="area-chart-endpoint" cx={last.x} cy={last.y} r="4.5" fill={color} />
        )}
      </svg>

      {hovered && (
        <div
          className="area-chart-tooltip"
          style={{ left: `${hovered.x}px`, top: `${hovered.y}px` }}
        >
          <span className="area-chart-tooltip-label">{labelFormat(hovered.datum)}</span>
          <span className="area-chart-tooltip-value">{valueFormat(hovered.value)}</span>
        </div>
      )}
    </div>
  );
};

export default AreaChart;
