import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui';
import Modal from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { formatPrice } from '../../utils/helpers';
import api from '../../services/client';
import './OrdersPanel.css';

const STATUS_LABELS = {
  awaiting_payment: 'Awaiting payment',
  pending: 'Awaiting payment',
  processing: 'Processing',
  partially_shipped: 'Partially shipped',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
};

const ROLE_TABS = [
  { id: 'all', label: 'All orders' },
  { id: 'buyer', label: 'Buying' },
  { id: 'seller', label: 'Selling' },
];

function titleCase(value) {
  return (value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortId(id) {
  return (id || '').slice(0, 8).toUpperCase();
}

function formatDate(value) {
  if (!value) return '';
  const parsed = new Date(value.endsWith('Z') ? value : `${value}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function OrderCard({ order, onOpen }) {
  const status = order.status || 'processing';
  return (
    <button type="button" className="order-card" onClick={() => onOpen(order.id)}>
      <div className="order-card-media">
        {order.primary_image ? (
          <img src={order.primary_image} alt={order.primary_title || 'Order item'} />
        ) : (
          <span className="order-card-placeholder">No image</span>
        )}
      </div>
      <div className="order-card-body">
        <div className="order-card-top">
          <span className="order-card-title">{order.primary_title || 'Order'}</span>
          <span className={`order-status order-status-${status}`}>{STATUS_LABELS[status] || titleCase(status)}</span>
        </div>
        <div className="order-card-meta">
          <span>#{shortId(order.id)}</span>
          <span>{order.unit_count || order.item_count || 0} item{(order.unit_count || order.item_count) === 1 ? '' : 's'}</span>
          <span>{formatDate(order.created_at)}</span>
        </div>
        <div className="order-card-bottom">
          <span>Order total</span>
          <strong>{formatPrice((order.total_cents || 0) / 100, order.currency)}</strong>
        </div>
      </div>
    </button>
  );
}

export default function OrdersPanel({ limit }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [role, setRole] = useState('all');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [shipmentBusy, setShipmentBusy] = useState(false);
  const [shipForm, setShipForm] = useState({
    carrier: '',
    service: '',
    trackingNumber: '',
    trackingUrl: '',
  });

  const loadOrders = useCallback(async (selectedRole = role) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.orders.list(selectedRole);
      setOrders(limit ? (res.orders || []).slice(0, limit) : (res.orders || []));
    } catch (err) {
      setError(err.message || 'Could not load orders');
    } finally {
      setLoading(false);
    }
  }, [role, limit]);

  useEffect(() => {
    loadOrders(role);
  }, [loadOrders, role]);

  const openOrder = async (orderId) => {
    setDetailBusy(true);
    try {
      const res = await api.orders.get(orderId);
      const order = res.order;
      setDetail(order);
      const myShipment = (order.shipments || []).find((s) => s.seller_id === user?.id);
      setShipForm({
        carrier: myShipment?.carrier || '',
        service: myShipment?.service || '',
        trackingNumber: myShipment?.tracking_number || '',
        trackingUrl: myShipment?.tracking_url || '',
      });
    } catch (err) {
      addToast(err.message || 'Could not load order', 'error');
    } finally {
      setDetailBusy(false);
    }
  };

  const submitShipment = async (event) => {
    event.preventDefault();
    if (!detail) return;
    setShipmentBusy(true);
    try {
      const res = await api.orders.ship(detail.id, shipForm);
      setDetail(res.order);
      await loadOrders(role);
      addToast('Shipment saved. The buyer has been notified.', 'success');
    } catch (err) {
      addToast(err.message || 'Could not save shipment', 'error');
    } finally {
      setShipmentBusy(false);
    }
  };

  const markShipment = async (shipmentId, status) => {
    if (!detail) return;
    setShipmentBusy(true);
    try {
      const res = await api.orders.updateShipment(detail.id, shipmentId, { status });
      setDetail(res.order);
      await loadOrders(role);
      addToast(`Shipment marked ${titleCase(status)}.`, 'success');
    } catch (err) {
      addToast(err.message || 'Could not update shipment', 'error');
    } finally {
      setShipmentBusy(false);
    }
  };

  const confirmDelivery = async () => {
    if (!detail) return;
    setDetailBusy(true);
    try {
      const res = await api.orders.confirmDelivery(detail.id);
      setDetail(res.order);
      await loadOrders(role);
      addToast('Delivery confirmed and escrow released.', 'success');
    } catch (err) {
      addToast(err.message || 'Could not confirm delivery', 'error');
    } finally {
      setDetailBusy(false);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setShipForm({ carrier: '', service: '', trackingNumber: '', trackingUrl: '' });
  };

  const mySellerItems = detail?.items?.filter((item) => item.seller_id === user?.id) || [];
  const myShipment = detail?.shipments?.find((shipment) => shipment.seller_id === user?.id);
  const canShip = detail
    && detail.viewer_role === 'seller'
    && mySellerItems.length > 0
    && !['awaiting_payment', 'pending', 'cancelled', 'refunded', 'completed'].includes(detail.status);
  const canConfirm = detail
    && detail.viewer_role === 'buyer'
    && !['awaiting_payment', 'pending', 'cancelled', 'refunded', 'completed'].includes(detail.status);

  return (
    <div className="orders-panel">
      <div className="orders-panel-head">
        <div>
          <h2 className="section-title">Orders</h2>
          <p className="orders-panel-sub">Track purchases, shipments and delivery confirmation.</p>
        </div>
        <div className="orders-tabs">
          {ROLE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`orders-tab ${role === tab.id ? 'active' : ''}`}
              onClick={() => setRole(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="orders-empty">Loading orders...</p>}
      {!loading && error && (
        <div className="orders-error">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => loadOrders(role)}>Retry</Button>
        </div>
      )}
      {!loading && !error && orders.length === 0 && (
        <div className="orders-empty-state">
          <div className="orders-empty-icon">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
            </svg>
          </div>
          <h3>No orders yet</h3>
          <p>Paid purchases and incoming sales will appear here.</p>
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div className="orders-list">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} onOpen={openOrder} />
          ))}
        </div>
      )}

      <Modal isOpen={!!detail} onClose={closeDetail} title={detail ? `Order #${shortId(detail.id)}` : 'Order'}>
        {detailBusy && !detail && <p className="orders-empty">Loading order...</p>}
        {detail && (
          <div className="order-detail">
            <div className="order-detail-summary">
              <div>
                <span className="order-detail-label">Status</span>
                <span className={`order-status order-status-${detail.status}`}>
                  {STATUS_LABELS[detail.status] || titleCase(detail.status)}
                </span>
              </div>
              <div>
                <span className="order-detail-label">Placed</span>
                <strong>{formatDate(detail.created_at)}</strong>
              </div>
              <div>
                <span className="order-detail-label">Total</span>
                <strong>{formatPrice((detail.total_cents || 0) / 100, detail.currency)}</strong>
              </div>
            </div>

            <div className="order-detail-section">
              <h3>Items</h3>
              <div className="order-detail-items">
                {(detail.items || []).map((item) => (
                  <div key={item.id} className="order-detail-item">
                    <div className="order-detail-item-media">
                      {item.image ? <img src={item.image} alt={item.title} /> : <span>No image</span>}
                    </div>
                    <div className="order-detail-item-copy">
                      <strong>{item.title}</strong>
                      <span>{item.seller_name || 'Seller'} · Qty {item.quantity}</span>
                      <span className={`order-line-status order-line-${item.status}`}>{titleCase(item.status)}</span>
                    </div>
                    <strong>{formatPrice((item.unit_price_cents || 0) * (item.quantity || 1) / 100, item.currency)}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="order-detail-section">
              <h3>Shipping address</h3>
              {detail.shipping_address?.line1 ? (
                <address className="order-address">
                  <strong>{detail.shipping_address.full_name}</strong>
                  <span>{detail.shipping_address.line1}{detail.shipping_address.line2 ? `, ${detail.shipping_address.line2}` : ''}</span>
                  <span>{[detail.shipping_address.city, detail.shipping_address.region, detail.shipping_address.postal_code].filter(Boolean).join(', ')}</span>
                  <span>{detail.shipping_address.country}{detail.shipping_address.phone ? ` · ${detail.shipping_address.phone}` : ''}</span>
                </address>
              ) : (
                <p className="orders-muted">No shipping address was saved for this order.</p>
              )}
            </div>

            <div className="order-detail-section">
              <h3>Shipment</h3>
              {(detail.shipments || []).length === 0 && (
                <p className="orders-muted">The seller has not added tracking yet.</p>
              )}
              {(detail.shipments || []).map((shipment) => (
                <div key={shipment.id} className="order-shipment">
                  <div>
                    <strong>{shipment.carrier || 'Carrier'}</strong>
                    <span>{shipment.service || 'Shipment'} · {titleCase(shipment.status)}</span>
                    {shipment.tracking_number && (
                      <span>
                        Tracking: {shipment.tracking_url ? (
                          <a href={shipment.tracking_url} target="_blank" rel="noreferrer">{shipment.tracking_number}</a>
                        ) : shipment.tracking_number}
                      </span>
                    )}
                  </div>
                  {shipment.seller_id === user?.id && shipment.status !== 'delivered' && (
                    <div className="order-shipment-actions">
                      {shipment.status !== 'in_transit' && (
                        <button type="button" onClick={() => markShipment(shipment.id, 'in_transit')} disabled={shipmentBusy}>
                          In transit
                        </button>
                      )}
                      <button type="button" onClick={() => markShipment(shipment.id, 'delivered')} disabled={shipmentBusy}>
                        Mark delivered
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {canShip && (
              <form className="order-ship-form" onSubmit={submitShipment}>
                <h3>{myShipment ? 'Update shipment' : 'Add shipment'}</h3>
                <div className="order-ship-grid">
                  <label>
                    <span>Carrier</span>
                    <input
                      value={shipForm.carrier}
                      onChange={(e) => setShipForm({ ...shipForm, carrier: e.target.value })}
                      placeholder="DHL, GIG, UPS..."
                      required
                    />
                  </label>
                  <label>
                    <span>Service</span>
                    <input
                      value={shipForm.service}
                      onChange={(e) => setShipForm({ ...shipForm, service: e.target.value })}
                      placeholder="Express, standard..."
                    />
                  </label>
                  <label>
                    <span>Tracking number</span>
                    <input
                      value={shipForm.trackingNumber}
                      onChange={(e) => setShipForm({ ...shipForm, trackingNumber: e.target.value })}
                      placeholder="Tracking number"
                    />
                  </label>
                  <label>
                    <span>Tracking URL</span>
                    <input
                      value={shipForm.trackingUrl}
                      onChange={(e) => setShipForm({ ...shipForm, trackingUrl: e.target.value })}
                      placeholder="https://..."
                      type="url"
                    />
                  </label>
                </div>
                <Button block type="submit" disabled={shipmentBusy}>
                  {shipmentBusy ? 'Saving...' : myShipment ? 'Update shipment' : 'Mark as shipped'}
                </Button>
              </form>
            )}

            {canConfirm && (
              <div className="order-confirm-box">
                <div>
                  <strong>Received your order?</strong>
                  <p>Confirm delivery to release the escrow payment to the seller.</p>
                </div>
                <Button onClick={confirmDelivery} disabled={detailBusy}>
                  {detailBusy ? 'Confirming...' : 'Confirm delivery'}
                </Button>
              </div>
            )}

            <div className="order-detail-section">
              <h3>Activity</h3>
              <div className="order-events">
                {(detail.events || []).map((event) => (
                  <div key={event.id} className="order-event">
                    <span className="order-event-dot" />
                    <div>
                      <strong>{titleCase(event.type)}</strong>
                      <span>{formatDate(event.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
