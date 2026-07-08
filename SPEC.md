# TradeHub - Local Trading App Specification

## 1. Project Overview

**Project Name:** TradeHub  
**Type:** Mobile-first Progressive Web Application (PWA)  
**Core Feature:** A local trading platform enabling users to list items, discover nearby trades, communicate in real-time, process secure payments, and build trust through reviews.  
**Target Users:** Local buyers and sellers looking for convenient, nearby item exchanges.

---

## 2. Technology Stack

- **Framework:** React 19 with Vite 8
- **Language:** JavaScript (ES6+)
- **Styling:** Custom CSS with CSS Variables
- **State Management:** React Context API
- **Storage:** LocalStorage for persistence
- **Geolocation:** Browser Geolocation API
- **Responsive:** Mobile-first with CSS Grid/Flexbox

### Project Structure

```
trade-app/
├── src/
│   ├── components/
│   │   ├── ui/           # Reusable UI components (Button, Input, Modal, Icons)
│   │   ├── layout/       # Layout components (Header, BottomNav)
│   │   └── features/      # Feature components (ItemCard, ItemsGrid)
│   ├── context/          # React Context providers
│   ├── hooks/            # Custom React hooks
│   ├── pages/            # Page components (Home, Chat, Payments, etc.)
│   ├── services/         # API and storage services
│   ├── styles/           # Global styles
│   ├── types/            # Type definitions
│   └── utils/            # Utility functions
├── public/
└── index.html
```

---

## 3. UI/UX Specification

### Design System

**Color Palette:**
| Name | Hex | Usage |
|------|-----|-------|
| Primary | `#1A1A2E` | Headers, overlays |
| Secondary | `#16213E` | Gradients, cards |
| Accent | `#E94560` | CTAs, highlights |
| Accent Hover | `#FF5A75` | Interactive states |
| Success | `#4ADE80` | Positive actions |
| Warning | `#FBBF24` | Caution states |
| Error | `#EF4444` | Errors, destructive |
| Background | `#0F0F1A` | Page background |
| Surface | `#1F1F2E` | Cards, modals |
| Surface Hover | `#2A2A3E` | Hover states |
| Text Primary | `#FFFFFF` | Headlines |
| Text Secondary | `#A0A0B0` | Body text |
| Text Tertiary | `#6B6B7B` | Captions |
| Border | `#2A2A3E` | Dividers |

**Typography:**
- Font Family: 'Inter' (Google Fonts)
- Weights: 400 (regular), 500 (medium), 600 (semibold), 700 (bold), 800 (extrabold)
- Line Heights: 1.2 (headings), 1.5 (body)

**Spacing:**
- Base unit: 4px
- Common spacings: 4, 8, 12, 16, 20, 24, 32px
- Border radius: 8px (sm), 12px (md), 16px (lg), 20px (xl), 9999px (full)

**Shadows:**
- sm: `0 2px 8px rgba(0, 0, 0, 0.2)`
- md: `0 4px 16px rgba(0, 0, 0, 0.3)`
- lg: `0 8px 32px rgba(0, 0, 0, 0.4)`

### Layout Structure

**Navigation:**
- Bottom tab bar with 5 tabs: Browse, Chat, Sell (+), Payments, Profile
- Floating action button for "Sell" with gradient background
- Badge indicators for unread messages/notifications

**Page Structure:**
- Max width: 500px (mobile-optimized)
- Sticky headers with context-aware actions
- Safe area support for notched devices

### Components

#### UI Components
- **Button**: Variants (primary, secondary, ghost, success), sizes (sm, md, lg), states (loading, disabled)
- **Input**: Text, textarea, select, search (with icon), price (with $ prefix)
- **Badge**: Variants (primary, success, warning, error, secondary)
- **Avatar**: Sizes (sm, md, lg, xl, xxl), online/verified states
- **Rating**: Star display with numeric value
- **Modal**: Centered and bottom-sheet variants

#### Layout Components
- **Header**: Title/subtitle, back button, notifications, right actions
- **SearchHeader**: Integrated search with filter button
- **BottomNav**: 5-tab navigation with badge support

#### Feature Components
- **ItemCard**: Image, title, price, distance, favorite button, condition badge
- **ItemsGrid**: Responsive grid/list view of items

---

## 4. Functionality Specification

### Core Features

#### 4.1 Item Browsing (Home Tab)
- Grid/list view toggle
- Distance filter (1km - 100km)
- Category filter (All, Electronics, Fashion, Gaming, etc.)
- Sort options (Newest, Oldest, Price Low/High, Nearest)
- Search with real-time filtering
- Results count display
- Pull-to-refresh ready

#### 4.2 Item Details
- Image gallery with dot navigation
- Large price display
- Title and description
- Metadata: location, distance, views, condition
- Seller card with rating and reviews
- Favorite/Share actions
- Action buttons: Review Seller, Safe Pay, Message

#### 4.3 Real-Time Chat
- Conversation list with avatars and unread badges
- Message threads per item
- Quick reply buttons
- Payment offer card in chat
- Real-time message display (simulated)
- Message timestamps
- Seller info header

#### 4.4 Add Listing
- Multi-image upload (up to 6)
- Title and description
- Price input with currency
- Category selection
- Condition options (New, Like New, Good, Fair)
- Location detection via Geolocation API
- Form validation
- Loading state

#### 4.5 Payment System
- Buyer protection banner with escrow info
- Saved payment methods (Visa, Mastercard, Amex)
- Add new card modal
- Set default card
- Remove card
- Transaction history with filters (All, Received, Sent)
- Transaction status badges (pending, completed, refunded)
- Amount display with +/- indicators

#### 4.6 User Profile
- Large avatar with verified badge
- Name and location
- Stats: Listings, Reviews, Rating
- Tabbed content: Reviews, My Listings, Settings
- Review cards with ratings
- Settings menu items
- Logout option

#### 4.7 Review System
- Star rating (1-5)
- Written review text
- Verified transaction badge
- Review display on profiles and item details

### Additional Features

#### Notifications (Planned)
- Unread count indicator
- Types: message, offer, sale, review, system
- Mark as read functionality

#### Favorites (Planned)
- Heart button on items
- Favorites list in profile

#### Settings (Planned)
- Edit profile
- Privacy & security
- App preferences
- Help & support

---

## 5. Responsive Breakpoints

| Breakpoint | Width | Behavior |
|------------|-------|----------|
| Mobile | < 500px | Full width, bottom nav |
| Tablet | 500-767px | Constrained width |
| Desktop | >= 768px | Centered app with shadow |

---

## 6. Acceptance Criteria

### Navigation & Layout
- [x] Bottom navigation switches between 5 tabs smoothly
- [x] Responsive on mobile viewport (320px-500px)
- [x] App container max-width 500px on larger screens
- [x] Safe area support for notched devices

### Browse & Search
- [x] Items display in responsive grid (2-4 columns)
- [x] Distance filter updates item list
- [x] Category filter works correctly
- [x] Sort options change display order
- [x] View toggle between grid and list
- [x] Search filters items in real-time

### Item Details
- [x] Image gallery with navigation
- [x] All item information displayed
- [x] Seller profile with rating
- [x] Favorite button works
- [x] Share button present
- [x] Action buttons navigate correctly

### Chat
- [x] Conversation list displays
- [x] Messages send and appear
- [x] Quick reply buttons work
- [x] Payment offer card visible

### Payments
- [x] Payment methods can be added
- [x] Default card can be set
- [x] Cards can be removed
- [x] Transaction history displays
- [x] Filters work correctly
- [x] Buyer protection banner visible

### Profile & Reviews
- [x] User info displays correctly
- [x] Stats show accurate counts
- [x] Reviews tab displays reviews
- [x] Listings tab shows user items
- [x] Settings menu present
- [x] Review modal works

### Technical
- [x] No console errors
- [x] All buttons have handlers
- [x] Forms validate input
- [x] Loading states work
- [x] Geolocation detection works
