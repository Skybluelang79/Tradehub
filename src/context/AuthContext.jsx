import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { storage } from '../services/storage';
import { generateId } from '../utils/helpers';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => storage.get('authUser', null));
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!storage.get('authUser', null));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    storage.set('authUser', user);
  }, [user]);

  const login = useCallback(async (email, password) => {
    setIsLoading(true);
    setError(null);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const users = storage.get('users', []);
      const foundUser = users.find(u => u.email === email && u.password === password);
      
      if (foundUser) {
        const { password: _, ...userWithoutPassword } = foundUser;
        setUser(userWithoutPassword);
        setIsAuthenticated(true);
        return { success: true };
      }
      
      if (email === 'demo@tradehub.com' && password === 'demo123') {
        const demoUser = {
          id: 'user_demo',
          name: 'Demo User',
          email: 'demo@tradehub.com',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
          rating: 4.8,
          verified: true,
          location: { address: 'New York, NY', lat: 40.7128, lng: -74.006 },
          bio: 'Demo account for testing',
          phone: '+1 234 567 8900',
          joined: '2024-01-15',
          listings: 12,
        };
        setUser(demoUser);
        setIsAuthenticated(true);
        return { success: true };
      }
      
      setError('Invalid email or password');
      return { success: false, error: 'Invalid email or password' };
    } catch (err) {
      setError('Login failed. Please try again.');
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signup = useCallback(async (userData) => {
    setIsLoading(true);
    setError(null);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const users = storage.get('users', []);
      
      if (users.find(u => u.email === userData.email)) {
        setError('Email already registered');
        return { success: false, error: 'Email already registered' };
      }
      
      if (users.find(u => u.username === userData.username)) {
        setError('Username already taken');
        return { success: false, error: 'Username already taken' };
      }
      
      const newUser = {
        id: generateId(),
        name: userData.name,
        username: userData.username,
        email: userData.email,
        password: userData.password,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userData.username}`,
        rating: 0,
        verified: false,
        location: { address: 'Not set', lat: 0, lng: 0 },
        bio: '',
        phone: '',
        joined: new Date().toISOString().split('T')[0],
        listings: 0,
      };
      
      users.push(newUser);
      storage.set('users', users);
      
      const { password: _, ...userWithoutPassword } = newUser;
      setUser(userWithoutPassword);
      setIsAuthenticated(true);
      
      return { success: true };
    } catch (err) {
      setError('Signup failed. Please try again.');
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
    storage.remove('authUser');
  }, []);

  const updateProfile = useCallback((updates) => {
    if (!user) return { success: false };
    
    const updatedUser = { ...user, ...updates };
    setUser(updatedUser);
    
    const users = storage.get('users', []);
    const userIndex = users.findIndex(u => u.id === user.id);
    if (userIndex !== -1) {
      users[userIndex] = { ...users[userIndex], ...updates };
      storage.set('users', users);
    }
    
    return { success: true };
  }, [user]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (!user) return { success: false };
    
    const users = storage.get('users', []);
    const userIndex = users.findIndex(u => u.id === user.id);
    
    if (userIndex === -1 || users[userIndex].password !== currentPassword) {
      setError('Current password is incorrect');
      return { success: false, error: 'Current password is incorrect' };
    }
    
    users[userIndex].password = newPassword;
    storage.set('users', users);
    
    return { success: true };
  }, [user]);

  const forgotPassword = useCallback(async (email) => {
    setIsLoading(true);
    setError(null);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const users = storage.get('users', []);
      const foundUser = users.find(u => u.email === email);
      
      if (foundUser) {
        return { success: true, message: 'Password reset instructions sent to your email' };
      }
      
      return { success: true, message: 'If an account exists with this email, you will receive reset instructions' };
    } catch (err) {
      setError('Failed to process request');
      return { success: false, error: err.message };
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
