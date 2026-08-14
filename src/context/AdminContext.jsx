import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../services/client';

const AdminContext = createContext();

const ADMIN_STORAGE_KEY = 'tradehub_admin_auth';

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
      if (result?.token) {
        localStorage.setItem('tradehub_admin_token', result.token);
        setAdminToken(result.token);
        setIsAdminAuth(true);
        setAdminLoginError('');
        return true;
      }
      throw new Error('No token returned');
    } catch (err) {
      const isNetworkError = err instanceof TypeError || err?.message?.toLowerCase().includes('fetch') || err?.message?.toLowerCase().includes('failed to fetch');
      setAdminLoginError(isNetworkError ? 'Cannot reach the server. Make sure the backend is running.' : 'Invalid admin credentials');
      return false;
    }
  }, []);

  const adminLogout = useCallback(() => {
    setIsAdminAuth(false);
    setAdminToken('');
    setAdminLoginError('');
    localStorage.removeItem('tradehub_admin_token');
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setIsAdminAuth(false);
      setAdminToken('');
      localStorage.removeItem('tradehub_admin_token');
    };
    window.addEventListener('adminSessionExpired', onExpired);
    return () => window.removeEventListener('adminSessionExpired', onExpired);
  }, []);

  const value = {
    isAdminAuth,
    adminToken,
    adminLogin,
    adminLogout,
    adminLoginError,
  };

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
};

export default AdminContext;
