import { useEffect, useState } from 'react';
import api from '../../services/client';
import './ShippingAddressSelect.css';

const EMPTY_FORM = {
  label: 'Home',
  full_name: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postal_code: '',
  country: 'NG',
};

function addressLine(address) {
  return [address.line1, address.line2, address.city, address.region, address.postal_code]
    .filter(Boolean)
    .join(', ');
}

export default function ShippingAddressSelect({ value, onChange, disabled = false }) {
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.addresses.list()
      .then((res) => {
        if (!active) return;
        const rows = res.addresses || [];
        setAddresses(rows);
        setShowForm(rows.length === 0);
        const selected = rows.find((a) => a.id === value)
          || rows.find((a) => a.is_default)
          || rows[0];
        if (selected && selected.id !== value) onChange?.(selected.id);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Could not load addresses');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
    // Run once when checkout opens; subsequent selection is controlled by `value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setField = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const saveAddress = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await api.addresses.create({ ...form, is_default: addresses.length === 0 });
      const created = res.address;
      setAddresses((prev) => [created, ...prev]);
      setForm(EMPTY_FORM);
      setShowForm(false);
      onChange?.(created.id);
    } catch (err) {
      setError(err.message || 'Could not save address');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ship-address">
      <div className="ship-address-head">
        <div>
          <h3 className="ship-address-title">Shipping address</h3>
          <p className="ship-address-sub">Where should the seller send this order?</p>
        </div>
        {!showForm && (
          <button type="button" className="ship-address-add" onClick={() => setShowForm(true)} disabled={disabled}>
            + New
          </button>
        )}
      </div>

      {loading && <p className="ship-address-muted">Loading addresses...</p>}

      {!loading && addresses.length > 0 && (
        <div className="ship-address-list">
          {addresses.map((address) => (
            <label
              key={address.id}
              className={`ship-address-option ${value === address.id ? 'active' : ''}`}
            >
              <input
                type="radio"
                name="shipping-address"
                value={address.id}
                checked={value === address.id}
                onChange={() => onChange?.(address.id)}
                disabled={disabled}
              />
              <span className="ship-address-copy">
                <span className="ship-address-name">
                  {address.full_name}
                  {address.is_default && <span className="ship-address-default">Default</span>}
                </span>
                <span className="ship-address-line">{addressLine(address)}</span>
                <span className="ship-address-line">{address.country}{address.phone ? ` · ${address.phone}` : ''}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {showForm && (
        <form className="ship-address-form" onSubmit={saveAddress}>
          <div className="ship-address-grid">
            <label className="ship-field ship-field-wide">
              <span>Full name</span>
              <input value={form.full_name} onChange={setField('full_name')} required placeholder="Receiver's full name" />
            </label>
            <label className="ship-field">
              <span>Phone</span>
              <input value={form.phone} onChange={setField('phone')} placeholder="Phone number" />
            </label>
            <label className="ship-field ship-field-wide">
              <span>Address line 1</span>
              <input value={form.line1} onChange={setField('line1')} required placeholder="Street, building, apartment" />
            </label>
            <label className="ship-field ship-field-wide">
              <span>Address line 2</span>
              <input value={form.line2} onChange={setField('line2')} placeholder="Landmark or suite (optional)" />
            </label>
            <label className="ship-field">
              <span>City</span>
              <input value={form.city} onChange={setField('city')} required placeholder="City" />
            </label>
            <label className="ship-field">
              <span>State / region</span>
              <input value={form.region} onChange={setField('region')} placeholder="State or region" />
            </label>
            <label className="ship-field">
              <span>Postal code</span>
              <input value={form.postal_code} onChange={setField('postal_code')} placeholder="Postal code" />
            </label>
            <label className="ship-field">
              <span>Country</span>
              <input value={form.country} onChange={setField('country')} maxLength={2} placeholder="NG" />
            </label>
          </div>
          {error && <p className="ship-address-error">{error}</p>}
          <div className="ship-address-form-actions">
            {addresses.length > 0 && (
              <button type="button" className="ship-address-cancel" onClick={() => setShowForm(false)} disabled={saving}>
                Cancel
              </button>
            )}
            <button type="submit" className="ship-address-save" disabled={saving}>
              {saving ? 'Saving...' : 'Save address'}
            </button>
          </div>
        </form>
      )}

      {error && !showForm && <p className="ship-address-error">{error}</p>}
    </div>
  );
}
