import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, setToken } from '../services/client';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('tradehub_token');
      if (token) {
        setToken(token);
        try {
          const data = await api.auth.me();
          setUser(data.user);
          setIsAuthenticated(true);
        } catch {
          setToken(null);
          localStorage.removeItem('tradehub_token');
        }
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const login = useCallback(async (email, password) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.auth.login({ email, password });
      setToken(data.token);
      localStorage.setItem('tradehub_token', data.token);
      setUser(data.user);
      setIsAuthenticated(true);
      return { success: true };
    } catch (err) {
      setError(err.message || 'Invalid email or password');
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signup = useCallback(async (userData) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.auth.signup(userData);
      setToken(data.token);
      localStorage.setItem('tradehub_token', data.token);
      setUser(data.user);
      setIsAuthenticated(true);
      return { success: true };
    } catch (err) {
      setError(err.message || 'Signup failed');
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem('tradehub_token');
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const updateProfile = useCallback(async (updates) => {
    try {
      const data = await api.auth.updateProfile(updates);
      setUser(data.user);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    try {
      await api.auth.changePassword({ currentPassword, newPassword });
      return { success: true };
    } catch (err) {
      setError(err.message || 'Failed to change password');
      return { success: false, error: err.message };
    }
  }, []);

  const forgotPassword = useCallback(async (email) => {
    setIsLoading(true);
    setError(null);
    try {
      await api.auth.forgotPassword({ email });
      return { success: true, message: 'If an account exists with this email, you will receive reset instructions' };
    } catch (err) {
      return { success: true, message: 'If an account exists with this email, you will receive reset instructions' };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const value = {
    user,
    isAuthenticated,
    isLoading,
    error,
    login,
    signup,
    logout,
    updateProfile,
    changePassword,
    forgotPassword,
    clearError: () => setError(null),
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export default AuthContext;
