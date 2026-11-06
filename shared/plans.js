export const GOLD_PRICE_USD = 9.99;

export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    priceUsd: 0,
    fee: 0.04,
    boosts: 0,
    maxListings: 30,
    maxPhotos: 6,
    maxVideos: 0,
    listingDays: 30,
    featuredSlots: 0,
    auctionAutoApprove: false,
    analytics: false,
    distressPinned: false,
    badge: null,
  },
  premium: {
    name: 'Gold',
    price: GOLD_PRICE_USD,
    priceUsd: GOLD_PRICE_USD,
    fee: 0.02,
    boosts: 7,
    maxListings: 120,
    maxPhotos: 10,
    maxVideos: 1,
    listingDays: 90,
    featuredSlots: 7,
    auctionAutoApprove: true,
    analytics: true,
    distressPinned: true,
    badge: 'Gold Seller',
  },
  pro: {
    name: 'Pro',
    price: 24.99,
    priceUsd: 24.99,
    fee: 0.02,
    boosts: 7,
    maxListings: -1,
    maxPhotos: 10,
    maxVideos: 1,
    listingDays: 90,
    featuredSlots: 7,
    auctionAutoApprove: true,
    analytics: true,
    distressPinned: true,
    badge: 'Pro Seller',
  },
};

export function getPlan(planId) {
  return PLANS[planId] || PLANS.free;
}

export function isPaidPlan(planId) {
  return planId !== 'free' && !!PLANS[planId];
}

export function getEffectivePlan(sub) {
  if (!sub?.plan || !PLANS[sub.plan] || sub.plan === 'free') return 'free';
  if (sub.status === 'trial') {
    return sub.trial_end && new Date(sub.trial_end).getTime() > Date.now() ? sub.plan : 'free';
  }
  if (sub.status !== 'active') return 'free';
  if (sub.current_period_end && new Date(sub.current_period_end).getTime() <= Date.now()) return 'free';
  return sub.plan;
}
