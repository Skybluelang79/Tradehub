import './Input.css';

export function Input({
  label,
  error,
  className = '',
  ...props
}) {
  return (
    <div className="input-group">
      {label && <label className="input-label">{label}</label>}
      <input
        className={`input ${error ? 'input--error' : ''} ${className}`}
        {...props}
      />
      {error && <p className="input-error">{error}</p>}
    </div>
  );
}

export function Textarea({
  label,
  error,
  className = '',
  ...props
}) {
  return (
    <div className="input-group">
      {label && <label className="input-label">{label}</label>}
      <textarea
        className={`input textarea ${error ? 'input--error' : ''} ${className}`}
        {...props}
      />
      {error && <p className="input-error">{error}</p>}
    </div>
  );
}

export function Select({
  label,
  error,
  options = [],
  placeholder,
  className = '',
  ...props
}) {
  return (
    <div className="input-group">
      {label && <label className="input-label">{label}</label>}
      <select
        className={`input select ${error ? 'input--error' : ''} ${className}`}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => {
          const optValue = opt.value ?? opt.id ?? opt;
          const optLabel = opt.label ?? opt.name ?? opt;
          return (
            <option key={optValue} value={optValue}>
              {optLabel}
            </option>
          );
        })}
      </select>
      {error && <p className="input-error">{error}</p>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search...', className = '' }) {
  return (
    <div className={`search-input ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        type="text"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function PriceInput({ value, onChange, label, error, className = '' }) {
  return (
    <div className="input-group">
      {label && <label className="input-label">{label}</label>}
      <div className={`price-input ${className}`}>
        <input
          type="number"
          className={`input ${error ? 'input--error' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          min="0"
          step="0.01"
        />
      </div>
      {error && <p className="input-error">{error}</p>}
    </div>
  );
}
