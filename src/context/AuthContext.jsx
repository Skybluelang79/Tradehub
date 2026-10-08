import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, setToken } from '../services/client';
import { loginWithPasskey, registerPasskey as createPasskey, listPasskeys as fetchPasskeys, removePasskey as deletePasskey } from '../services/webauthn';
import { auth as firebaseAuth } from '../config/firebase';
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile as fbUpdateProfile } from 'firebase/auth';
import { initializeFCM, cleanupFCM } from '../services/fcm';
import { setDisplayCurrency, DEFAULT_CURRENCY } from '../utils/currency.js';

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

  // Keep the display currency in sync with the signed-in user's preference so
  // formatPrice converts prices everywhere. Signed-out visitors see NGN.
  useEffect(() => {
    if (!isAuthenticated) {
      setDisplayCurrency(DEFAULT_CURRENCY);
      return undefined;
    }
    let cancelled = false;
    api.settings.get()
      .then(({ settings }) => { if (!cancelled && settings?.currency) setDisplayCurrency(settings.currency); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAuthenticated]);

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

  // --- Phone number sign-in ---------------------------------------------------
  // Split into two calls so the code entry UI can reuse the same "code sent"
  // state whether the number came from the login form or the settings screen.
  const requestPhoneCode = useCallback(async (phone) => {
    const data = await api.phoneAuth.requestCode(phone);
    return { success: true, message: data.message, devCode: data.devCode };
  }, []);

  const loginWithPhone = useCallback(async (phone, code) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.phoneAuth.verify({ phone, code });
      setToken(data.token);
      localStorage.setItem('tradehub_token', data.token);
      setUser(data.user);
      setIsAuthenticated(true);
      return { success: true };
    } catch (err) {
      setError(err.message || 'That code is wrong or has expired');
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  // --- Phone number sign-up ---------------------------------------------------
  const requestSignupPhoneCode = useCallback(async (phone) => {
    const data = await api.phoneAuth.signupRequestCode(phone);
    return { success: true, message: data.message, devCode: data.devCode };
  }, []);

  const signupWithPhone = useCallback(async ({ name, username, phone, code, referralCode }) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.phoneAuth.signupVerify({ name, username, phone, code, referralCode });
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

  // --- Fingerprint (passkey) sign-in ------------------------------------------
  const signInWithPasskey = useCallback(async (email) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await loginWithPasskey(email);
      setToken(data.token);
      localStorage.setItem('tradehub_token', data.token);
      setUser(data.user);
      setIsAuthenticated(true);
      return { success: true };
    } catch (err) {
      setError(err.message || 'Fingerprint sign-in failed');
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const socialLogin = useCallback(async (provider, token) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.auth.social({ provider, token });
      setToken(data.token);
      localStorage.setItem('tradehub_token', data.token);
      setUser(data.user);
      setIsAuthenticated(true);
      return { success: true };
    } catch (err) {
      setError(err.message || 'Social login failed');
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
      return { success: true, devVerifyToken: data.devVerifyToken };
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
    cleanupFCM();
    try { if (firebaseAuth) firebaseAuth.signOut(); } catch {}
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

  const deleteAccount = useCallback(async (password) => {
    try {
      await api.auth.deleteAccount({ password });
      setToken(null);
      localStorage.removeItem('tradehub_token');
      setUser(null);
      setIsAuthenticated(false);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, []);

  const resendVerification = useCallback(async () => {
    try {
      await api.auth.resendVerification();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, []);

  // --- Passkey and phone management (settings screen) ------------------------
  const registerPasskey = useCallback(async () => {
    try {
      const data = await createPasskey();
      return { success: true, credential: data.credential };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, []);

  const listPasskeys = useCallback(async () => {
    try {
      const data = await fetchPasskeys();
      return { success: true, credentials: data.credentials };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, []);

  const removePasskey = useCallback(async (id) => {
    try {
      await deletePasskey(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, []);

  const phoneStatus = useCallback(async () => {
    try {
      return { success: true, ...(await api.phoneAuth.status()) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, []);

  const linkPhone = useCallback(async (phone) => {
    try {
      const data = await api.phoneAuth.link(phone);
      return { success: true, message: data.message, devCode: data.devCode };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, []);

  const verifyPhoneLink = useCallback(async (phone, code) => {
    try {
      const data = await api.phoneAuth.linkVerify({ phone, code });
      setUser((current) => (current ? { ...current, phone: data.phone, phone_verified: data.phoneVerified } : current));
      return { success: true, phone: data.phone };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, []);

  const unlinkPhone = useCallback(async () => {
    try {
      await api.phoneAuth.unlink();
      setUser((current) => (current ? { ...current, phone: '', phone_verified: 0 } : current));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, []);

  const forgotPassword = useCallback(async (email) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.auth.forgotPassword({ email });
      return { success: true, message: 'If an account exists with this email, you will receive reset instructions', devResetToken: data.devResetToken };
    } catch (err) {
      // Surface real failures (e.g. email delivery not configured). The server
      // answers unknown addresses with a generic success, so this cannot leak
      // whether an account exists.
      const message = err.message || 'Failed to send reset instructions';
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    if (!firebaseAuth) {
      setError('Google sign-in is not configured');
      setIsLoading(false);
      return { success: false, error: 'Google sign-in is not configured' };
    }
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(firebaseAuth, provider);
      const idToken = await result.user.getIdToken();
      const data = await api.auth.firebaseSignup({ idToken, name: result.user.displayName });
      setToken(data.token);
      localStorage.setItem('tradehub_token', data.token);
      setUser(data.user);
      setIsAuthenticated(true);
      initializeFCM().catch(() => {});
      return { success: true };
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const firebaseEmailSignup = useCallback(async (email, password, name) => {
    setIsLoading(true);
    setError(null);
    if (!firebaseAuth) {
      setError('Email sign-up is not configured');
      setIsLoading(false);
      return { success: false, error: 'Email sign-up is not configured' };
    }
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
      if (name) await fbUpdateProfile(cred.user, { displayName: name });
      const idToken = await cred.user.getIdToken();
      const data = await api.auth.firebaseSignup({ idToken, name });
      setToken(data.token);
      localStorage.setItem('tradehub_token', data.token);
      setUser(data.user);
      setIsAuthenticated(true);
      initializeFCM().catch(() => {});
      return { success: true };
    } catch (err) {
      setError(err.message || 'Signup failed');
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const firebaseEmailLogin = useCallback(async (email, password) => {
    setIsLoading(true);
    setError(null);
    if (!firebaseAuth) {
      setError('Email login is not configured');
      setIsLoading(false);
      return { success: false, error: 'Email login is not configured' };
    }
    try {
      const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
      const idToken = await cred.user.getIdToken();
      const data = await api.auth.firebaseSignup({ idToken });
      setToken(data.token);
      localStorage.setItem('tradehub_token', data.token);
      setUser(data.user);
      setIsAuthenticated(true);
      initializeFCM().catch(() => {});
      return { success: true };
    } catch (err) {
      setError(err.message || 'Login failed');
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
    socialLogin,
    logout,
    updateProfile,
    changePassword,
    deleteAccount,
    resendVerification,
    forgotPassword,
    signInWithGoogle,
    firebaseEmailSignup,
    firebaseEmailLogin,
    requestPhoneCode,
    loginWithPhone,
    requestSignupPhoneCode,
    signupWithPhone,
    signInWithPasskey,
    registerPasskey,
    listPasskeys,
    removePasskey,
    phoneStatus,
    linkPhone,
    verifyPhoneLink,
    unlinkPhone,
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
