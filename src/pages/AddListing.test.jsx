import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { categories } from '../services/api';
import AddListing from './AddListing';

const h = vi.hoisted(() => ({
  app: {
    addItem: vi.fn(),
    updateItem: vi.fn(),
    items: [],
    userLocation: null,
    setActiveTab: vi.fn(),
    locationLoading: false,
    saveTemplate: vi.fn(),
    getTemplates: () => [],
    unreadNotificationsCount: 0,
    activeTab: 'add',
    selectedItem: null,
    cartCount: 0,
  },
  addToast: vi.fn(),
  api: {},
}));

vi.mock('../context', () => ({ useApp: () => h.app }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: () => {} }),
}));
vi.mock('../components/ui/Toast', () => ({ useToast: () => ({ addToast: h.addToast }) }));
vi.mock('../services/client', () => ({ api: h.api, default: h.api }));

const fillValidForm = (container) => {
  fireEvent.change(screen.getByPlaceholderText('What are you selling?'), {
    target: { value: 'Blue wool scarf' },
  });
  fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '1500' } });
  const categoryId = categories.find((c) => c.id !== 'all').id;
  fireEvent.change(container.querySelector('select'), { target: { value: categoryId } });
  return categoryId;
};

describe('AddListing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.app.items = [];
    h.app.addItem.mockResolvedValue({});
    h.app.updateItem.mockResolvedValue({});
  });

  it('keeps Publish disabled until required fields are valid', () => {
    const { container } = render(<AddListing />);
    expect(screen.getByRole('button', { name: /Publish Listing/ })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('What are you selling?'), {
      target: { value: 'Blue wool scarf' },
    });
    expect(screen.getByRole('button', { name: /Publish Listing/ })).toBeDisabled();

    fillValidForm(container);
    expect(screen.getByRole('button', { name: /Publish Listing/ })).toBeEnabled();
  });

  it('blocks submission and toasts when required fields are missing', () => {
    const { container } = render(<AddListing />);
    fireEvent.submit(container.querySelector('form'));

    expect(h.app.addItem).not.toHaveBeenCalled();
    expect(h.addToast).toHaveBeenCalledWith('Please fill in all required fields', 'error');
  });

  it('publishes a valid listing and navigates home', async () => {
    const { container } = render(<AddListing />);
    const categoryId = fillValidForm(container);

    fireEvent.click(screen.getByRole('button', { name: /Publish Listing/ }));

    await waitFor(() => expect(h.app.addItem).toHaveBeenCalledTimes(1));
    const [data, status] = h.app.addItem.mock.calls[0];
    expect(status).toBe('active');
    expect(data.title).toBe('Blue wool scarf');
    expect(data.price).toBe(1500);
    expect(data.category).toBe(categoryId);
    expect(h.app.setActiveTab).toHaveBeenCalledWith('home');
    expect(h.addToast).toHaveBeenCalledWith('Listing published successfully!', 'success');
    expect(screen.getByPlaceholderText('What are you selling?')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Publish Listing/ })).toBeDisabled();
  });

  it('saves a draft instead of publishing', async () => {
    render(<AddListing />);
    fireEvent.change(screen.getByPlaceholderText('What are you selling?'), {
      target: { value: 'Old lamp' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Save as Draft/ }));

    await waitFor(() => expect(h.app.addItem).toHaveBeenCalledTimes(1));
    const [data, status] = h.app.addItem.mock.calls[0];
    expect(status).toBe('draft');
    expect(data.title).toBe('Old lamp');
    expect(h.addToast).toHaveBeenCalledWith('Draft saved!', 'success');
  });

  it('surfaces the server error when publishing fails', async () => {
    h.app.addItem.mockRejectedValue(new Error('Item is already sold'));
    const { container } = render(<AddListing />);
    fillValidForm(container);

    fireEvent.click(screen.getByRole('button', { name: /Publish Listing/ }));

    await waitFor(() =>
      expect(h.addToast).toHaveBeenCalledWith('Item is already sold', 'error')
    );
    expect(h.app.setActiveTab).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Publish Listing/ })).toBeEnabled();
  });
});
