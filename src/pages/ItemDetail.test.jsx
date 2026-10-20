import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ItemDetail from './ItemDetail';

const h = vi.hoisted(() => {
  const item = {
    id: 'item-1',
    title: 'Used phone',
    description: 'Nice phone',
    price: 5000,
    salePrice: null,
    saleEndsAt: null,
    currency: 'NGN',
    category: 'electronics',
    condition: 'good',
    status: 'active',
    sellerId: 'seller-1',
    images: [],
    location: { lat: 6.5, lng: 3.3, address: 'Lagos' },
    isAuction: false,
    boosted: false,
    quantity: 1,
  };
  return {
    item,
    addToast: vi.fn(),
    api: {
      reviews: { forUser: vi.fn().mockResolvedValue({ reviews: [] }) },
      offers: { create: vi.fn() },
      items: { bids: vi.fn().mockResolvedValue({ bids: [] }) },
      ai: { question: vi.fn(), priceGuide: vi.fn() },
      payments: { methods: vi.fn(), options: vi.fn() },
      reports: { create: vi.fn() },
      chat: { create: vi.fn() },
    },
    app: {
      selectedItem: item,
      setSelectedItem: vi.fn(),
      setActiveTab: vi.fn(),
      items: [item],
      getUser: vi.fn(() => ({ id: 'seller-1', name: 'Ade Seller', avatar: null })),
      addConversation: vi.fn(),
      getReviewsForUser: vi.fn(() => []),
      getUserRating: vi.fn(() => 0),
      getDistanceFromUser: vi.fn(() => null),
      isFavorite: vi.fn(() => false),
      toggleFavorite: vi.fn(),
      addToCart: vi.fn(),
      incrementItemViews: vi.fn(),
      markAsSold: vi.fn(),
      updateItem: vi.fn(),
      deleteItem: vi.fn(),
    },
  };
});

vi.mock('../context', () => ({ useApp: () => h.app }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'buyer-1', name: 'Buyer' } }),
}));
vi.mock('../components/ui/Toast', () => ({ useToast: () => ({ addToast: h.addToast }) }));
vi.mock('../services/client', () => ({ api: h.api, default: h.api }));
vi.mock('../services/paystack', () => ({ payWithCard: vi.fn() }));
vi.mock('../components/features', () => ({
  ImageLightbox: () => null,
  PriceChart: () => null,
  BankTransferPanel: () => null,
  AdBanner: () => null,
}));

async function openOfferModal() {
  render(<ItemDetail />);
  fireEvent.click(await screen.findByRole('button', { name: /Make Offer/ }));
  await screen.findByText('Make an Offer');
}

describe('Make an Offer modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.app.selectedItem = h.item;
    h.api.reviews.forUser.mockResolvedValue({ reviews: [] });
  });

  it('shows the listed price and a prefilled offer in the item currency', async () => {
    await openOfferModal();
    expect(screen.getByText(/Listed at/)).toHaveTextContent('₦5,000');
    expect(screen.getByPlaceholderText(/0\.00/)).toHaveValue(5000);
  });

  it('sends the offer in kobo against the right item', async () => {
    h.api.offers.create.mockResolvedValue({ offer: { id: 'o1' } });
    await openOfferModal();

    const input = screen.getByPlaceholderText(/0\.00/);
    fireEvent.change(input, { target: { value: '4500' } });
    fireEvent.change(screen.getByPlaceholderText(/willing to pay/), {
      target: { value: 'Cash on pickup' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Offer' }));

    await waitFor(() => {
      expect(h.api.offers.create).toHaveBeenCalledWith({
        itemId: 'item-1',
        amountCents: 450000,
        message: 'Cash on pickup',
      });
    });
    await waitFor(() => expect(h.addToast).toHaveBeenCalledWith('Offer sent to seller!', 'success'));
    expect(screen.queryByText('Make an Offer')).not.toBeInTheDocument();
  });

  it('keeps the modal open and surfaces the API error on failure', async () => {
    h.api.offers.create.mockRejectedValue(new Error('You already have a pending offer on this item'));
    await openOfferModal();

    fireEvent.change(screen.getByPlaceholderText(/0\.00/), { target: { value: '3000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Offer' }));

    await waitFor(() => {
      expect(h.addToast).toHaveBeenCalledWith('You already have a pending offer on this item', 'error');
    });
    expect(screen.getByText('Make an Offer')).toBeInTheDocument();
  });

  it('rejects a zero amount without calling the API', async () => {
    await openOfferModal();
    fireEvent.change(screen.getByPlaceholderText(/0\.00/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Offer' }));

    expect(h.api.offers.create).not.toHaveBeenCalled();
    expect(h.addToast).toHaveBeenCalledWith('Enter a valid offer amount', 'error');
  });
});
