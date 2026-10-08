import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Notifications from './Notifications';

const h = vi.hoisted(() => ({
  app: {
    notifications: [],
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    unreadNotificationsCount: 0,
    setFilters: vi.fn(),
    setActiveTab: vi.fn(),
    items: [],
    setSelectedItem: vi.fn(),
    activeTab: 'notifications',
    selectedItem: null,
    cartCount: 0,
  },
  addToast: vi.fn(),
  api: { searches: { list: vi.fn(), remove: vi.fn() } },
  isAuth: true,
}));

vi.mock('../context', () => ({ useApp: () => h.app }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: h.isAuth }) }));
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: () => {} }),
}));
vi.mock('../components/ui/Toast', () => ({ useToast: () => ({ addToast: h.addToast }) }));
vi.mock('../services/client', () => ({ api: h.api, default: h.api }));

const searches = [
  { id: 's1', name: 'Cheap phones', query: 'phone', category: 'electronics', min_price: 100, max_price: 500 },
  { id: 's2', name: 'Any bike', query: '', category: '', min_price: null, max_price: null },
];

describe('Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isAuth = true;
    h.app.notifications = [];
    h.app.unreadNotificationsCount = 0;
    h.app.items = [];
    h.api.searches.list.mockResolvedValue({ searches });
    h.api.searches.remove.mockResolvedValue({ success: true });
  });

  it('renders saved searches from the server', async () => {
    render(<Notifications />);
    expect(await screen.findByText('Cheap phones')).toBeInTheDocument();
    expect(screen.getByText('Any bike')).toBeInTheDocument();
    expect(h.api.searches.list).toHaveBeenCalledTimes(1);
  });

  it('applies a saved search to the home filters and navigates there', async () => {
    const onClose = vi.fn();
    render(<Notifications onClose={onClose} />);
    await screen.findByText('Cheap phones');

    fireEvent.click(screen.getAllByRole('button', { name: 'Run' })[0]);

    expect(h.app.setFilters).toHaveBeenCalledTimes(1);
    const updater = h.app.setFilters.mock.calls[0][0];
    expect(updater({ search: 'old', page: 2 })).toEqual({
      search: 'phone',
      category: 'electronics',
      minPrice: 100,
      maxPrice: 500,
      page: 2,
    });
    expect(h.app.setActiveTab).toHaveBeenCalledWith('home');
    expect(onClose).toHaveBeenCalled();
    expect(h.addToast).toHaveBeenCalledWith(expect.stringContaining('Cheap phones'), 'success');
  });

  it('deletes a saved search locally and on the server', async () => {
    render(<Notifications />);
    await screen.findByText('Cheap phones');

    fireEvent.click(screen.getByLabelText('Delete saved search Cheap phones'));

    expect(h.api.searches.remove).toHaveBeenCalledWith('s1');
    await waitFor(() => expect(screen.queryByText('Cheap phones')).not.toBeInTheDocument());
    expect(screen.getByText('Any bike')).toBeInTheDocument();
  });

  it('keeps the list intact and shows an error when delete fails', async () => {
    h.api.searches.remove.mockRejectedValue(new Error('network down'));
    render(<Notifications />);
    await screen.findByText('Cheap phones');

    fireEvent.click(screen.getByLabelText('Delete saved search Cheap phones'));

    await waitFor(() =>
      expect(h.addToast).toHaveBeenCalledWith('Could not delete saved search', 'error')
    );
    expect(await screen.findByText('Cheap phones')).toBeInTheDocument();
  });

  it('opens the linked listing when an alert is tapped', () => {
    const items = [{ id: 'i9', title: 'Sony headphones' }];
    h.app.notifications = [
      {
        id: 'n1',
        type: 'saved_search',
        title: 'New match for headphones',
        body: 'Sony headphones',
        read: false,
        data: { itemId: 'i9' },
        created_at: new Date().toISOString(),
      },
    ];
    h.app.items = items;
    const onClose = vi.fn();

    render(<Notifications onClose={onClose} />);
    fireEvent.click(screen.getByText('New match for headphones'));

    expect(h.app.markNotificationRead).toHaveBeenCalledWith('n1');
    expect(h.app.setSelectedItem).toHaveBeenCalledWith(items[0]);
    expect(h.app.setActiveTab).toHaveBeenCalledWith('home');
    expect(onClose).toHaveBeenCalled();
  });

  it('marks all notifications as read', () => {
    h.app.unreadNotificationsCount = 2;
    h.app.notifications = [
      { id: 'n1', type: 'message', title: 'One', body: '', read: false, created_at: new Date().toISOString() },
      { id: 'n2', type: 'sale', title: 'Two', body: '', read: false, created_at: new Date().toISOString() },
    ];

    render(<Notifications />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect(h.app.markAllNotificationsRead).toHaveBeenCalledTimes(1);
  });

  it('filters notifications by the Search alerts chip', () => {
    h.app.notifications = [
      { id: 'n1', type: 'saved_search', title: 'Match found', body: '', read: false, created_at: new Date().toISOString() },
      { id: 'n2', type: 'message', title: 'New message', body: '', read: true, created_at: new Date().toISOString() },
    ];

    render(<Notifications />);
    expect(screen.getByText('New message')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Search alerts' }));

    expect(screen.getByText('Match found')).toBeInTheDocument();
    expect(screen.queryByText('New message')).not.toBeInTheDocument();
  });

  it('shows the sign-in gate when logged out', () => {
    h.isAuth = false;
    render(<Notifications />);
    expect(screen.getByText('Sign in for notifications')).toBeInTheDocument();
    expect(h.api.searches.list).not.toHaveBeenCalled();
  });
});
