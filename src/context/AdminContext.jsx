import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../services/client';

const AdminContext = createContext();

const ADMIN_STORAGE_KEY = 'tradehub_admin_auth';

const ADMIN_PASSWORD = 'admin123';

export const useAdmin = () => {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error('useAdmin must be used within AdminProvider');
  }
  return context;
};

export const AdminProvider = ({ children }) => {
  const [isAdminAuth, setIsAdminAuth] = useState(() => {
    return !!localStorage.getItem('tradehub_admin_token');
  });
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('tradehub_admin_token') || '');
  const [adminLoginError, setAdminLoginError] = useState('');

  useEffect(() => {
    if (isAdminAuth && adminToken) {
      localStorage.setItem('tradehub_admin_token', adminToken);
    } else {
      localStorage.removeItem('tradehub_admin_token');
    }
  }, [isAdminAuth, adminToken]);

  const adminLogin = useCallback(async (password) => {
    try {
      const result = await api.admin.login({ email: 'admin@tradehub.com', password });
      setIsAdminAuth(true);
      setAdminToken(result.token);
      setAdminLoginError('');
      return true;
    } catch (err) {
      setAdminLoginError('Invalid admin credentials');
      return false;
    }
  }, []);

  const adminLogout = useCallback(() => {
    setIsAdminAuth(false);
    setAdminToken('');
    setAdminLoginError('');
    localStorage.removeItem('tradehub_admin_token');
  }, []);

  const [adminStats, setAdminStats] = useState({
    totalUsers: 15420,
    totalListings: 8430,
    totalTransactions: 3240,
    totalRevenue: 485000,
    pendingListings: 127,
    reportedUsers: 23,
    newUsersToday: 45,
    activeUsers: 890,
  });

  const [users, setUsers] = useState([
    { id: 1, name: 'John Smith', email: 'john@example.com', status: 'active', listings: 12, rating: 4.8, joined: '2024-01-15', verified: true },
    { id: 2, name: 'Sarah Johnson', email: 'sarah@example.com', status: 'active', listings: 8, rating: 4.9, joined: '2024-02-20', verified: true },
    { id: 3, name: 'Mike Wilson', email: 'mike@example.com', status: 'suspended', listings: 3, rating: 3.2, joined: '2024-03-10', verified: false },
    { id: 4, name: 'Emily Davis', email: 'emily@example.com', status: 'active', listings: 25, rating: 4.7, joined: '2023-11-05', verified: true },
    { id: 5, name: 'Alex Brown', email: 'alex@example.com', status: 'pending', listings: 0, rating: 0, joined: '2024-04-01', verified: false },
    { id: 6, name: 'Lisa Anderson', email: 'lisa@example.com', status: 'active', listings: 18, rating: 4.5, joined: '2024-01-22', verified: true },
    { id: 7, name: 'Tom Martinez', email: 'tom@example.com', status: 'banned', listings: 5, rating: 2.1, joined: '2023-12-08', verified: false },
    { id: 8, name: 'Jessica Taylor', email: 'jessica@example.com', status: 'active', listings: 32, rating: 4.9, joined: '2023-09-14', verified: true },
  ]);

  const [listings, setListings] = useState([
    { id: 1, title: 'iPhone 15 Pro Max', price: 999, category: 'Electronics', seller: 'John Smith', status: 'approved', views: 1234, date: '2024-04-01' },
    { id: 2, title: 'MacBook Pro M3', price: 1899, category: 'Electronics', seller: 'Sarah Johnson', status: 'approved', views: 892, date: '2024-04-02' },
    { id: 3, title: 'Vintage Leather Jacket', price: 150, category: 'Fashion', seller: 'Mike Wilson', status: 'pending', views: 0, date: '2024-04-03' },
    { id: 4, title: 'PS5 Console', price: 450, category: 'Gaming', seller: 'Emily Davis', status: 'approved', views: 2156, date: '2024-04-01' },
    { id: 5, title: 'Designer Handbag', price: 320, category: 'Fashion', seller: 'Lisa Anderson', status: 'reported', views: 445, date: '2024-04-02' },
    { id: 6, title: 'Toyota Camry 2022', price: 28000, category: 'Vehicles', seller: 'Tom Martinez', status: 'pending', views: 0, date: '2024-04-03' },
    { id: 7, title: 'Nike Air Jordan 1', price: 180, category: 'Fashion', seller: 'Alex Brown', status: 'approved', views: 678, date: '2024-03-30' },
    { id: 8, title: 'Samsung 65" TV', price: 650, category: 'Electronics', seller: 'Jessica Taylor', status: 'approved', views: 1023, date: '2024-03-28' },
  ]);

  const [transactions, setTransactions] = useState([
    { id: 1, buyer: 'John Smith', seller: 'Sarah Johnson', item: 'iPhone 14 Pro', amount: 850, status: 'completed', date: '2024-04-01', fee: 25.50 },
    { id: 2, buyer: 'Mike Wilson', seller: 'Emily Davis', item: 'Nintendo Switch', amount: 280, status: 'pending', date: '2024-04-02', fee: 8.40 },
    { id: 3, buyer: 'Lisa Anderson', seller: 'Tom Martinez', item: 'Dyson Vacuum', amount: 420, status: 'completed', date: '2024-04-01', fee: 12.60 },
    { id: 4, buyer: 'Jessica Taylor', seller: 'John Smith', item: 'Canon Camera', amount: 750, status: 'refunded', date: '2024-03-30', fee: 22.50 },
    { id: 5, buyer: 'Alex Brown', seller: 'Sarah Johnson', item: 'iPad Pro', amount: 920, status: 'completed', date: '2024-03-29', fee: 27.60 },
    { id: 6, buyer: 'Emily Davis', seller: 'Lisa Anderson', item: 'Gaming Chair', amount: 180, status: 'completed', date: '2024-03-28', fee: 5.40 },
  ]);

  const [reports, setReports] = useState([
    { id: 1, type: 'user', reportedItem: 'Tom Martinez', reason: 'Suspicious activity', reporter: 'John Smith', date: '2024-04-02', status: 'pending' },
    { id: 2, type: 'listing', reportedItem: 'Designer Handbag', reason: 'Counterfeit item', reporter: 'Lisa Anderson', date: '2024-04-01', status: 'pending' },
    { id: 3, type: 'user', reportedItem: 'Mike Wilson', reason: 'Fake listings', reporter: 'Emily Davis', date: '2024-03-31', status: 'resolved' },
    { id: 4, type: 'listing', reportedItem: 'Rolex Watch', reason: 'Price too low - scam', reporter: 'Sarah Johnson', date: '2024-03-30', status: 'dismissed' },
    { id: 5, type: 'transaction', reportedItem: 'Transaction #1234', reason: 'Payment dispute', reporter: 'Jessica Taylor', date: '2024-03-29', status: 'pending' },
  ]);

  const [analyticsData] = useState({
    revenue: [
      { month: 'Jan', amount: 32000 },
      { month: 'Feb', amount: 38500 },
      { month: 'Mar', amount: 41200 },
      { month: 'Apr', amount: 48500 },
    ],
    listings: [
      { month: 'Jan', count: 1200 },
      { month: 'Feb', count: 1450 },
      { month: 'Mar', count: 1680 },
      { month: 'Apr', count: 1890 },
    ],
    users: [
      { month: 'Jan', count: 8500 },
      { month: 'Feb', count: 10200 },
      { month: 'Mar', count: 12800 },
      { month: 'Apr', count: 15420 },
    ],
    categories: [
      { name: 'Electronics', count: 3420 },
      { name: 'Fashion', count: 2150 },
      { name: 'Gaming', count: 1230 },
      { name: 'Vehicles', count: 890 },
      { name: 'Home', count: 740 },
    ],
  });

  const updateUserStatus = useCallback((userId, newStatus) => {
    setUsers(prev => prev.map(user => 
      user.id === userId ? { ...user, status: newStatus } : user
    ));
  }, []);

  const updateListingStatus = useCallback((listingId, newStatus) => {
    setListings(prev => prev.map(listing => 
      listing.id === listingId ? { ...listing, status: newStatus } : listing
    ));
  }, []);

  const updateReportStatus = useCallback((reportId, newStatus) => {
    setReports(prev => prev.map(report => 
      report.id === reportId ? { ...report, status: newStatus } : report
    ));
  }, []);

  const deleteUser = useCallback((userId) => {
    setUsers(prev => prev.filter(user => user.id !== userId));
    setAdminStats(prev => ({ ...prev, totalUsers: prev.totalUsers - 1 }));
  }, []);

  const deleteListing = useCallback((listingId) => {
    setListings(prev => prev.filter(listing => listing.id !== listingId));
    setAdminStats(prev => ({ ...prev, totalListings: prev.totalListings - 1 }));
  }, []);

  const value = {
    isAdminAuth,
    adminLogin,
    adminLogout,
    adminLoginError,
    adminStats,
    users,
    listings,
    transactions,
    reports,
    analyticsData,
    updateUserStatus,
    updateListingStatus,
    updateReportStatus,
    deleteUser,
    deleteListing,
  };

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
};

export default AdminContext;
