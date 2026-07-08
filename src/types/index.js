export const UserType = {
  id: '',
  name: '',
  avatar: '',
  rating: 0,
  reviewCount: 0,
  location: null,
  joinedDate: '',
  bio: '',
  phone: '',
  verified: false,
};

export const LocationType = {
  lat: 0,
  lng: 0,
  address: '',
};

export const ItemType = {
  id: '',
  title: '',
  description: '',
  price: 0,
  images: [],
  category: '',
  sellerId: '',
  location: null,
  createdAt: '',
  status: 'active',
  views: 0,
  favorites: 0,
  condition: 'good',
};

export const ConversationType = {
  id: '',
  itemId: '',
  participants: [],
  lastMessage: '',
  lastMessageTime: '',
  unreadCount: 0,
};

export const MessageType = {
  id: '',
  senderId: '',
  text: '',
  time: '',
  read: false,
};

export const TransactionType = {
  id: '',
  type: 'sent',
  amount: 0,
  itemId: '',
  itemTitle: '',
  otherUserId: '',
  status: 'pending',
  createdAt: '',
  completedAt: '',
  paymentMethodId: '',
};

export const ReviewType = {
  id: '',
  transactionId: '',
  reviewerId: '',
  revieweeId: '',
  rating: 0,
  text: '',
  createdAt: '',
  verified: false,
};

export const PaymentMethodType = {
  id: '',
  type: 'visa',
  last4: '',
  expiry: '',
  isDefault: false,
  name: '',
};

export const NotificationType = {
  id: '',
  type: 'system',
  title: '',
  body: '',
  read: false,
  createdAt: '',
  relatedId: '',
};

export const AppSettingsType = {
  notifications: true,
  locationEnabled: true,
  darkMode: true,
  distanceUnit: 'km',
  language: 'English',
};
