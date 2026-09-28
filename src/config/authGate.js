export const AUTH_GATED_TABS = ['home', 'chat', 'add', 'payments', 'profile'];

export const GATE_COPY = {
  home: {
    icon: 'search',
    title: 'Create an account to browse',
    text: 'Sign up free to see every listing near you, save searches, and build your favourites list.',
    perks: ['Browse every listing in your area', 'Save searches and get alerts', 'Keep a favourites list'],
  },
  chat: {
    icon: 'chat',
    title: 'Create an account to chat',
    text: 'Message sellers, negotiate prices, and close deals securely with end-to-end encrypted chat.',
    perks: ['Talk directly with buyers and sellers', 'Send photos, files, and voice notes', 'Encrypted end-to-end conversations'],
  },
  add: {
    icon: 'tag',
    title: 'Create an account to sell',
    text: 'Post your item in minutes and reach buyers nearby. Listing is completely free.',
    perks: ['Post an item in under a minute', 'Reach buyers in your area', 'Track views, offers, and interest'],
  },
  payments: {
    icon: 'card',
    title: 'Create an account to pay',
    text: 'Pay with escrow protection using store credit, gift cards, card, or bank transfer.',
    perks: ['Escrow holds funds until you approve', 'Pay by card, bank, or gift card', 'Full refund and dispute protection'],
  },
  profile: {
    icon: 'user',
    title: 'Create an account to view your profile',
    text: 'Manage your listings, purchases, ratings, payouts, and verification in one place.',
    perks: ['Manage all your listings', 'Track purchases and payouts', 'Build your seller rating'],
  },
  item: {
    icon: 'search',
    title: 'Create an account to see this listing',
    text: 'Sign up free to view full details, message the seller, and make a secure offer.',
    perks: ['See full photos and descriptions', 'Message the seller directly', 'Buy safely with escrow protection'],
  },
  overlay: {
    icon: 'user',
    title: 'Create an account to continue',
    text: 'Your cart, favourites, and seller profiles are saved to your account so you can pick up on any device.',
    perks: ['Sync your cart and favourites', 'Follow and message sellers', 'Keep your activity in one place'],
  },
};
