import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/client';
import { attributeDefinitions } from '../../services/api';
import './MarketplaceExtras.css';

const can = (namespace, method) => typeof namespace?.[method] === 'function';

const displayDate = (value) => {
  if (!value) return '—';
  const normalized = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};

export function TrustBadge({ userId }) {
  const [trust, setTrust] = useState(null);

  useEffect(() => {
    if (!userId || !can(api.trust, 'public')) return;
    let active = true;
    api.trust.public(userId)
      .then((data) => { if (active) setTrust(data.trust || null); })
      .catch(() => { if (active) setTrust(null); });
    return () => { active = false; };
  }, [userId]);

  if (!trust) return null;
  return (
    <span className={`market-trust market-trust--${trust.riskLevel}`} title="TradeHub trust signal">
      Trust {trust.riskScore} · {trust.riskLevel}
      {trust.activeStrikes ? ` · ${trust.activeStrikes} strike${trust.activeStrikes === 1 ? '' : 's'}` : ''}
    </span>
  );
}

export function ListingAttributes({ itemId, attributes }) {
  const [loaded, setLoaded] = useState(attributes || null);

  useEffect(() => {
    if (!itemId || !can(api.listings, 'attributes')) return;
    let active = true;
    api.listings.attributes(itemId)
      .then((data) => { if (active) setLoaded(data.attributes || {}); })
      .catch(() => { if (active) setLoaded(attributes || {}); });
    return () => { active = false; };
  }, [itemId, attributes]);

  const entries = Object.entries(loaded || {});
  if (!entries.length) return null;
  return (
    <div className="market-attributes">
      <h4>Item Details</h4>
      <div className="market-attribute-grid">
        {entries.map(([name, value]) => (
          <div key={name} className="market-attribute">
            <span>{name}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CompsPanel({ itemId }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!itemId || !can(api.listings, 'comps')) return;
    let active = true;
    api.listings.comps(itemId)
      .then((res) => { if (active) setData(res); })
      .catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [itemId]);

  if (!data?.comps?.length) return null;
  return (
    <div className="market-comps">
      <div className="market-comps-head">
        <h4>Comparable listings</h4>
        <span>Suggested {data.suggestedPrice?.toLocaleString?.() ?? data.suggestedPrice}</span>
      </div>
      <div className="market-comps-list">
        {data.comps.slice(0, 4).map((comp) => (
          <div key={comp.id} className="market-comp">
            <div>
              <strong>{comp.title}</strong>
              <span>{comp.matchScore || 0} matching detail{comp.matchScore === 1 ? '' : 's'}</span>
            </div>
            <b>{comp.price?.toLocaleString?.() ?? comp.price}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MeetupPanel({ txnId, itemId }) {
  const { user } = useAuth();
  const [meetups, setMeetups] = useState([]);
  const [form, setForm] = useState({ scheduledAt: '', locationName: '', address: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (txnId && can(api.meetups, 'forTransaction')) {
      return api.meetups.forTransaction(txnId)
        .then((data) => setMeetups(data.meetups || []))
        .catch(() => setMeetups([]));
    }
    if (!itemId || !can(api.meetups, 'list')) return Promise.resolve();
    return api.meetups.list()
      .then((data) => setMeetups((data.meetups || []).filter((meetup) => meetup.item_id === itemId)))
      .catch(() => setMeetups([]));
  }, [txnId, itemId]);

  useEffect(() => { load(); }, [load]);

  if (!can(api.meetups, 'create') || (!txnId && !itemId)) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.scheduledAt || !form.locationName) {
      setError('Choose a time and a meeting place.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.meetups.create({
        txnId,
        itemId,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        locationName: form.locationName,
        address: form.address,
      });
      setForm({ scheduledAt: '', locationName: '', address: '' });
      await load();
    } catch (err) {
      setError(err.message || 'Could not propose the meetup.');
    } finally {
      setBusy(false);
    }
  };

  const act = async (id, action) => {
    if (!can(api.meetups, action)) return;
    setBusy(true);
    try {
      await api.meetups[action](id);
      await load();
    } catch (err) {
      setError(err.message || 'Could not update the meetup.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="market-panel">
      <h4>Meetup &amp; handoff</h4>
      <form className="market-inline-form" onSubmit={submit}>
        <input
          type="datetime-local"
          className="input"
          value={form.scheduledAt}
          onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
          aria-label="Meetup time"
        />
        <input
          className="input"
          placeholder="Meeting place"
          value={form.locationName}
          onChange={(e) => setForm({ ...form, locationName: e.target.value })}
        />
        <input
          className="input"
          placeholder="Address (optional)"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
        <button className="market-primary-btn" type="submit" disabled={busy}>Propose meetup</button>
      </form>
      {error && <p className="market-error">{error}</p>}
      {meetups.map((meetup) => (
        <div key={meetup.id} className="market-meetup">
          <div>
            <strong>{meetup.location_name}</strong>
            <span>{displayDate(meetup.scheduled_at)} · {meetup.status}</span>
          </div>
          <div className="market-meetup-actions">
            {meetup.status === 'proposed' && meetup.proposed_by !== user?.id && (
              <button type="button" onClick={() => act(meetup.id, 'accept')} disabled={busy}>Accept</button>
            )}
            {meetup.status === 'accepted' && (
              <button type="button" onClick={() => act(meetup.id, 'complete')} disabled={busy}>Mark complete</button>
            )}
            {!['completed', 'cancelled', 'declined'].includes(meetup.status) && (
              <button type="button" onClick={() => act(meetup.id, 'cancel')} disabled={busy}>Cancel</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReturnRequests({ transactions }) {
  const { user } = useAuth();
  const [returns, setReturns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!can(api.returns, 'list')) return Promise.resolve();
    return api.returns.list()
      .then((data) => setReturns(data.returns || []))
      .catch(() => setReturns([]));
  };

  useEffect(() => { load(); }, []);

  if (!can(api.returns, 'create')) return null;

  const submit = async () => {
    if (!selected || !reason.trim()) return;
    setBusy(true);
    try {
      await api.returns.create({ txnId: selected.id, reason, note });
      setSelected(null);
      setReason('');
      setNote('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const act = async (id, action) => {
    if (!can(api.returns, action)) return;
    setBusy(true);
    try {
      await api.returns[action](id);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openReturns = returns.filter((r) => ['requested', 'approved'].includes(r.status));
  const returnFor = (txnId) => returns.find((r) => r.transaction_id === txnId);

  return (
    <div className="market-panel">
      <h4>Returns</h4>
      {(transactions || []).filter((txn) => txn.status === 'completed').map((txn) => {
        const current = returnFor(txn.id);
        const isBuyer = txn.buyer_id === user?.id;
        return (
          <div key={txn.id} className="market-return-row">
            <div>
              <strong>{txn.item_title}</strong>
              <span>{current ? `Return ${current.status} · ${current.rma_number}` : 'No return requested'}</span>
            </div>
            <div className="market-meetup-actions">
              {!current && isBuyer && (
                <button type="button" onClick={() => { setSelected(txn); setReason(''); setNote(''); }}>Request return</button>
              )}
              {current?.status === 'requested' && !isBuyer && (
                <>
                  <button type="button" onClick={() => act(current.id, 'approve')} disabled={busy}>Approve</button>
                  <button type="button" onClick={() => act(current.id, 'decline')} disabled={busy}>Decline</button>
                </>
              )}
              {current?.status === 'approved' && isBuyer && (
                <button type="button" onClick={() => act(current.id, 'complete')} disabled={busy}>Confirm refund</button>
              )}
            </div>
          </div>
        );
      })}
      {!openReturns.length && !selected && (
        <p className="market-muted">Completed orders can be returned from here.</p>
      )}
      {selected && (
        <div className="market-return-form">
          <input className="input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <input className="input" placeholder="Details (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="market-primary-btn" onClick={submit} disabled={busy || !reason.trim()}>Submit request</button>
        </div>
      )}
    </div>
  );
}

export function SecurityActivity({ limit = 8 }) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!can(api.paymentEvents, 'list')) return;
    let active = true;
    api.paymentEvents.list({ limit })
      .then((data) => { if (active) setEvents(data.events || []); })
      .catch(() => { if (active) setEvents([]); });
    return () => { active = false; };
  }, [limit]);

  if (!events.length) return null;
  return (
    <div className="market-panel">
      <h4>Security activity</h4>
      <div className="market-events">
        {events.map((event) => (
          <div key={event.id} className={`market-event market-event--${event.level}`}>
            <span>{event.message || event.event_type}</span>
            <time>{displayDate(event.created_at)}</time>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrustDashboard() {
  const [trust, setTrust] = useState(null);
  const [appealFor, setAppealFor] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!can(api.trust, 'me')) return Promise.resolve();
    return api.trust.me()
      .then((data) => setTrust(data.trust || null))
      .catch(() => setTrust(null));
  };

  useEffect(() => { load(); }, []);

  if (!can(api.trust, 'me')) return null;

  const submitAppeal = async (strikeId) => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await api.trust.appeal(strikeId, { reason });
      setAppealFor(null);
      setReason('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="market-panel">
      <h4>Trust &amp; account standing</h4>
      {trust && (
        <div className="market-trust-summary">
          <span className={`market-trust market-trust--${trust.riskLevel}`}>{trust.riskLevel} risk · {trust.riskScore}</span>
          <span>{trust.activeStrikes || 0} active strike(s)</span>
        </div>
      )}
      {(trust?.strikes || []).map((strike) => (
        <div key={strike.id} className="market-meetup">
          <div>
            <strong>{strike.reason}</strong>
            <span>{strike.severity} · {strike.status}</span>
          </div>
          {strike.status === 'active' && (
            <button type="button" onClick={() => setAppealFor(strike.id)}>Appeal</button>
          )}
        </div>
      ))}
      {appealFor && (
        <div className="market-return-form">
          <input className="input" placeholder="Why should this strike be reviewed?" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="market-primary-btn" onClick={() => submitAppeal(appealFor)} disabled={busy || !reason.trim()}>Submit appeal</button>
        </div>
      )}
    </div>
  );
}

export function AttributeEditor({ category, value, onChange }) {
  const fields = useMemo(() => {
    const key = String(category || '').toLowerCase();
    return attributeDefinitions[key] || attributeDefinitions.other || [];
  }, [category]);

  if (!fields.length) return null;
  const current = value || {};

  return (
    <div className="market-attributes-editor">
      <h4>Category details</h4>
      <div className="market-attribute-grid">
        {fields.map((field) => (
          <label key={field.name} className="market-attribute-field">
            <span>{field.label}</span>
            <input
              className="input"
              value={current[field.name] || ''}
              onChange={(e) => onChange({ ...current, [field.name]: e.target.value })}
              placeholder={field.placeholder || ''}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
