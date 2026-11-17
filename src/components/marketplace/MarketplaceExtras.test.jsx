import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MeetupPanel, ReturnRequests, SecurityActivity, TrustBadge } from './MarketplaceExtras';

const h = vi.hoisted(() => ({
  user: { id: 'buyer-1' },
  api: {
    trust: { public: vi.fn() },
    meetups: { list: vi.fn(), forTransaction: vi.fn(), create: vi.fn(), accept: vi.fn(), complete: vi.fn(), cancel: vi.fn() },
    returns: { list: vi.fn(), create: vi.fn(), approve: vi.fn(), decline: vi.fn(), complete: vi.fn(), cancel: vi.fn() },
    paymentEvents: { list: vi.fn() },
    listings: {},
  },
}));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('../../services/client', () => ({ api: h.api }));

describe('MarketplaceExtras', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.api.trust.public.mockResolvedValue({ trust: { riskScore: 12, riskLevel: 'low', activeStrikes: 0 } });
    h.api.meetups.list.mockResolvedValue({ meetups: [] });
    h.api.meetups.forTransaction.mockResolvedValue({ meetups: [] });
    h.api.meetups.create.mockResolvedValue({ meetup: { id: 'm1' } });
    h.api.returns.list.mockResolvedValue({ returns: [] });
    h.api.returns.create.mockResolvedValue({ return: { id: 'r1' } });
    h.api.paymentEvents.list.mockResolvedValue({ events: [{ id: 'e1', event_type: 'refund_completed', level: 'info', created_at: '2026-01-01T00:00:00Z' }] });
  });

  it('shows a public trust badge', async () => {
    render(<TrustBadge userId="seller-1" />);
    expect(await screen.findByText(/Trust 12 · low/)).toBeInTheDocument();
    expect(h.api.trust.public).toHaveBeenCalledWith('seller-1');
  });

  it('proposes an item meetup and loads item meetups', async () => {
    render(<MeetupPanel itemId="item-1" />);
    fireEvent.change(screen.getByLabelText('Meetup time'), { target: { value: '2026-01-02T10:00' } });
    fireEvent.change(screen.getByPlaceholderText('Meeting place'), { target: { value: 'Central library' } });
    fireEvent.click(screen.getByRole('button', { name: 'Propose meetup' }));

    await waitFor(() => expect(h.api.meetups.create).toHaveBeenCalledTimes(1));
    expect(h.api.meetups.create.mock.calls[0][0]).toMatchObject({ itemId: 'item-1', locationName: 'Central library' });
    expect(h.api.meetups.list).toHaveBeenCalled();
  });

  it('creates a return for a completed transaction', async () => {
    const transactions = [{ id: 'txn-1', item_title: 'Camera', status: 'completed', buyer_id: 'buyer-1' }];
    render(<ReturnRequests transactions={transactions} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Request return' }));
    fireEvent.change(screen.getByPlaceholderText('Reason'), { target: { value: 'Item arrived damaged' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(h.api.returns.create).toHaveBeenCalledWith({
      txnId: 'txn-1',
      reason: 'Item arrived damaged',
      note: '',
    }));
  });

  it('shows recent payment security events', async () => {
    render(<SecurityActivity />);
    expect(await screen.findByText('refund_completed')).toBeInTheDocument();
  });
});
