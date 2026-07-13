import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from './db.js';

const users = [
  { name: 'Alex Morgan', email: 'alex@example.com', password: 'password123' },
  { name: 'Sarah Chen', email: 'sarah@example.com', password: 'password123' },
  { name: 'Mike Johnson', email: 'mike@example.com', password: 'password123' },
  { name: 'Emily Davis', email: 'emily@example.com', password: 'password123' },
  { name: 'James Wilson', email: 'james@example.com', password: 'password123' },
];

const locations = [
  { lat: 40.7128, lng: -74.006, address: 'Manhattan, NYC' },
  { lat: 40.7282, lng: -73.9942, address: 'SoHo, Manhattan' },
  { lat: 40.7061, lng: -74.0088, address: 'West Village, Manhattan' },
  { lat: 40.7411, lng: -73.9897, address: 'Murray Hill, Manhattan' },
  { lat: 40.7580, lng: -73.9855, address: 'Times Square, Manhattan' },
];

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (id, name, email, password, avatar, location_lat, location_lng, location_address, verified, rating, review_count, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

const insertItem = db.prepare(`
  INSERT OR IGNORE INTO items (id, title, description, price, sale_price, category, condition, seller_id, location_lat, location_lng, location_address, views, favorites, quantity, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
`);

const insertImage = db.prepare(`
  INSERT OR IGNORE INTO item_images (id, item_id, url, sort_order) VALUES (?, ?, ?, ?)
`);

const mockItems = [
  { title: 'iPhone 15 Pro Max - 256GB Natural Titanium', desc: 'Brand new, factory sealed iPhone 15 Pro Max. 256GB Natural Titanium. Includes original accessories and Apple warranty.', price: 1099, category: 'Electronics', condition: 'new', images: ['https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600'] },
  { title: 'Vintage Leather Bomber Jacket - Size M', desc: 'Authentic 1980s leather bomber jacket. Rich patina, excellent condition. Real leather with original brass zipper.', price: 185, category: 'Fashion', condition: 'good', images: ['https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600'] },
  { title: 'Nintendo Switch OLED + 5 Games Bundle', desc: 'Nintendo Switch OLED with 5 popular games: Zelda TOTK, Mario Kart 8, Smash Bros, Animal Crossing, Pokemon Scarlet.', price: 375, category: 'Gaming', condition: 'like_new', images: ['https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?w=600'] },
  { title: 'IKEA MALM Desk - White - Barely Used', desc: 'MALM desk with pull-out panel, white veneer. Used for 3 months, like new condition. Moving to smaller apartment.', price: 65, category: 'Furniture', condition: 'like_new', images: ['https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=600'] },
  { title: 'Canon EOS R50 Mirrorless Camera Kit', desc: 'Brand new Canon EOS R50 mirrorless camera with 18-45mm kit lens. Still in sealed box, never opened.', price: 675, category: 'Electronics', condition: 'new', images: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600'] },
  { title: 'Trek Marlin 7 Mountain Bike 2024', desc: 'Trek Marlin 7, size M. Ridden less than 100 miles. Includes helmet and lock. Upgraded to full suspension.', price: 550, category: 'Sports', condition: 'like_new', images: ['https://images.unsplash.com/photo-1532298229144-0ec0c57515c7?w=600'] },
  { title: 'MacBook Pro M3 14" - 16GB RAM', desc: 'MacBook Pro 14 inch with M3 chip, 16GB RAM, 512GB SSD. Used for 6 months in excellent condition. AppleCare+ until 2027.', price: 1450, category: 'Electronics', condition: 'like_new', sale_price: 1350, images: ['https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600'] },
  { title: 'First Edition Harry Potter Set', desc: 'Complete set of all 7 Harry Potter first edition hardcovers. Excellent condition, read once. Dust jackets intact.', price: 2800, category: 'Books', condition: 'good', images: ['https://images.unsplash.com/photo-1476275466078-4007374efbbe?w=600'] },
  { title: 'PS5 DualSense Controller Bundle (3)', desc: 'Three PS5 DualSense controllers: Midnight Black, Cosmic Red, and White. All work perfectly, barely used.', price: 120, category: 'Gaming', condition: 'like_new', images: ['https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=600'] },
  { title: 'West Elm Mid-Century Sofa', desc: 'West Elm mid-century sofa in dusk blue. 81" wide. Purchased 1 year ago for $1,800. Pet-free, smoke-free home.', price: 750, category: 'Furniture', condition: 'good', images: ['https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600'] },
  { title: 'Air Jordan 1 Retro High OG - Chicago', desc: 'Size 10.5. Worn twice, excellent condition. Comes with original box and extra laces. Authentic verified.', price: 320, category: 'Fashion', condition: 'like_new', images: ['https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=600'] },
  { title: 'Yoga Mat + Block Set - Lululemon', desc: 'Lululemon Reversible Mat 5mm in graphite grey with two yoga blocks. Used for home workouts, great condition.', price: 45, category: 'Sports', condition: 'good', images: ['https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=600'] },
];

console.log('Seeding database...');

const seedTransaction = db.transaction(() => {
  const userIds = [];

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const id = uuidv4();
    userIds.push(id);
    const hashedPw = bcrypt.hashSync(u.password, 10);
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.name)}`;
    const loc = locations[i];
    insertUser.run(id, u.name, u.email, hashedPw, avatar, loc.lat, loc.lng, loc.address, i === 0 ? 1 : 0, 4.5 + Math.random() * 0.5, Math.floor(Math.random() * 40) + 1, `-${i * 7} days`);
  }

  for (let i = 0; i < mockItems.length; i++) {
    const item = mockItems[i];
    const id = uuidv4();
    const sellerIdx = i % users.length;
    const loc = locations[sellerIdx];
    insertItem.run(
      id, item.title, item.desc, item.price,
      item.sale_price || null, item.category, item.condition,
      userIds[sellerIdx], loc.lat, loc.lng, loc.address,
      Math.floor(Math.random() * 300) + 10,
      Math.floor(Math.random() * 15),
      1, `-${i + 1} days`
    );
    item.images.forEach((url, imgIdx) => {
      insertImage.run(uuidv4(), id, url, imgIdx);
    });
  }
});

seedTransaction();
console.log(`Seeded ${users.length} users and ${mockItems.length} items`);
console.log('Default login: alex@example.com / password123');
