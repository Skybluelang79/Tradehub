import { useState, useEffect, useRef } from 'react';
import api from './services/client';
import { AppProvider, useApp, LanguageProvider, CookieProvider, ThemeProvider } from './context';
import { AuthProvider, useAuth } from './context/AuthContext';
import { EncryptionProvider } from './context/EncryptionContext';
import { ToastProvider, OnboardingGate } from './components/ui';
import { BottomNav } from './components/layout';
import { OfflineIndicator } from './components/features';


import { Home, Chat, AddListing, Payments, Profile, ItemDetail, Login, Signup, ForgotPassword, ResetPassword, Favorites, Notifications, GiftMall, SellerProfile, Cart } from './pages';
import { AdminProvider, useAdmin } from './context/AdminContext.jsx';
import AdminLayout from './components/admin/AdminLayout.jsx';
import AdminLogin from './components/admin/AdminLogin.jsx';
import {
  AdminDashboard,
  AdminUsers,
  AdminListings,
  AdminTransactions,
  AdminPayouts,
  AdminGiftCards,
  AdminDisputes,
  AdminReports,
  AdminAuditLogs,
  AdminPromotions,
  AdminSystem,
  AdminSettings
} from './pages/admin';
import './styles/globals.css';

function AuthPages({ onAuthSuccess, initialView = 'login', resetToken = null }) {
  const [authView, setAuthView] = useState(initialView);

  useEffect(() => { setAuthView(initialView); }, [initialView]);

  const handleSuccess = () => {
    if (onAuthSuccess) onAuthSuccess();
  };

  if (authView === 'login') {
    return (
      <Login 
        onSwitchToSignup={() => setAuthView('signup')}
        onForgotPassword={() => setAuthView('forgot')}
        onClose={handleSuccess}
      />
    );
  }

  if (authView === 'signup') {
    return (
      <Signup 
        onSwitchToLogin={() => setAuthView('login')}
        onClose={handleSuccess}
      />
    );
  }

  if (authView === 'forgot') {
    return (
      <ForgotPassword 
        onBackToLogin={() => setAuthView('login')}
      />
    );
  }

  if (authView === 'reset') {
    return (
      <ResetPassword 
        token={resetToken}
        onBackToLogin={() => setAuthView('login')}
      />
    );
  }
}

function AppContent() {
  const { activeTab, selectedItem, setActiveTab, setSelectedItem, unreadMessagesCount } = useApp();
  const { isAuthenticated } = useAuth();
  const { isAdminAuth } = useAdmin();
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminPath, setAdminPath] = useState('/admin');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showGiftMall, setShowGiftMall] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [sellerProfileId, setSellerProfileId] = useState(null);
  const [authRedirectTab, setAuthRedirectTab] = useState(null);
  const [authInitialView, setAuthInitialView] = useState('login');
  const [authResetToken, setAuthResetToken] = useState(null);
  const [verifyState, setVerifyState] = useState(null);
  const authLinkHandledRef = useRef(false);

  useEffect(() => {
    if (authLinkHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;
    const verifyToken = params.get('token');

    const run = async () => {
      if (params.get('verify')) {
        authLinkHandledRef.current = true;
        try {
          await api.auth.verifyEmail(params.get('verify'));
          setVerifyState({ type: 'success', message: 'Your email has been verified successfully!' });
        } catch (err) {
          setVerifyState({ type: 'error', message: err.message || 'Email verification failed' });
        }
      } else if (path.endsWith('/verify-email') && verifyToken) {
        authLinkHandledRef.current = true;
        try {
          await api.auth.verifyEmail(verifyToken);
          setVerifyState({ type: 'success', message: 'Your email has been verified successfully!' });
        } catch (err) {
          setVerifyState({ type: 'error', message: err.message || 'Email verification failed' });
        }
      } else if (path.endsWith('/reset-password') && verifyToken) {
        authLinkHandledRef.current = true;
        setAuthResetToken(verifyToken);
        setAuthInitialView('reset');
        setShowAuthModal(true);
      }
      if (params.get('verify') || (path.endsWith('/verify-email') && verifyToken)) {
        window.history.replaceState(null, '', path.replace(/\/verify-email$/, '') || '/');
      }
    };
    run();
    return () => {};
  }, []);

  useEffect(() => {
    const onAuth = (e) => { setAuthInitialView(e.detail || 'login'); setShowAuthModal(true); };
    const onNotifs = () => setShowNotifications(true);
    const onFavs = () => setShowFavorites(true);
    const onMall = () => setShowGiftMall(true);
    const onCart = () => setShowCart(true);
    const onSellerProfile = (e) => setSellerProfileId(e.detail || null);
    const onHome = () => {
      setShowFavorites(false);
      setShowNotifications(false);
      setShowGiftMall(false);
      setShowCart(false);
      setSelectedItem(null);
      setActiveTab('home');
    };
    const onAdminLogin = () => {
      if (isAdminAuth) setIsAdminMode(true);
      else setShowAdminLogin(true);
    };
    const onAdminSessionExpired = () => {
      setIsAdminMode(false);
      setShowAdminLogin(true);
    };
    window.addEventListener('openAuthModal', onAuth);
    window.addEventListener('openNotifications', onNotifs);
    window.addEventListener('openFavorites', onFavs);
    window.addEventListener('openGiftMall', onMall);
    window.addEventListener('openCart', onCart);
    window.addEventListener('openSellerProfile', onSellerProfile);
    window.addEventListener('goHome', onHome);
    window.addEventListener('openAdminLogin', onAdminLogin);
    window.addEventListener('adminSessionExpired', onAdminSessionExpired);
    return () => {
      window.removeEventListener('openAuthModal', onAuth);
      window.removeEventListener('openNotifications', onNotifs);
      window.removeEventListener('openFavorites', onFavs);
      window.removeEventListener('openGiftMall', onMall);
      window.removeEventListener('openCart', onCart);
      window.removeEventListener('openSellerProfile', onSellerProfile);
      window.removeEventListener('goHome', onHome);
      window.removeEventListener('openAdminLogin', onAdminLogin);
      window.removeEventListener('adminSessionExpired', onAdminSessionExpired);
    };
  }, [setActiveTab, setSelectedItem, isAdminAuth]);

  const handleAdminNavigate = (path) => {
    setAdminPath(path);
  };

  const renderAdminPage = () => {
    switch (adminPath) {
      case '/admin/users':
        return <AdminUsers />;
      case '/admin/listings':
        return <AdminListings />;
      case '/admin/transactions':
        return <AdminTransactions />;
      case '/admin/payouts':
        return <AdminPayouts />;
      case '/admin/gift-cards':
        return <AdminGiftCards />;
      case '/admin/disputes':
        return <AdminDisputes />;
      case '/admin/reports':
        return <AdminReports />;
      case '/admin/promotions':
        return <AdminPromotions />;
      case '/admin/audit-logs':
        return <AdminAuditLogs />;
      case '/admin/system':
        return <AdminSystem />;
      case '/admin/settings':
        return <AdminSettings />;
      default:
        return <AdminDashboard onNavigate={handleAdminNavigate} />;
    }
  };

  const handleTabChange = (tab) => {
    const authRequiredTabs = ['chat', 'payments', 'profile'];
    
    if (authRequiredTabs.includes(tab) && !isAuthenticated) {
      setAuthRedirectTab(tab);
      setShowAuthModal(true);
      return;
    }
    
    setActiveTab(tab);
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    if (authRedirectTab) {
      setActiveTab(authRedirectTab);
      setAuthRedirectTab(null);
    }
  };

  const renderPage = () => {
    if (selectedItem) {
      return <ItemDetail />;
    }

    switch (activeTab) {
      case 'home':
        return <Home />;
      case 'chat':
        return <Chat />;
      case 'add':
        return <AddListing />;
      case 'payments':
        return <Payments />;
      case 'profile':
        return <Profile />;
      default:
        return <Home />;
    }
  };

  if (showFavorites) {
    return (
      <Favorites onClose={() => setShowFavorites(false)} />
    );
  }

  if (showNotifications) {
    return (
      <Notifications onClose={() => setShowNotifications(false)} />
    );
  }

  if (showGiftMall) {
    return (
      <GiftMall onClose={() => setShowGiftMall(false)} />
    );
  }

  if (showCart) {
    return (
      <Cart onClose={() => setShowCart(false)} />
    );
  }

  if (sellerProfileId) {
    return (
      <SellerProfile
        userId={sellerProfileId}
        onClose={() => setSellerProfileId(null)}
        onItemOpen={(item) => {
          setSelectedItem(item);
          setSellerProfileId(null);
        }}
      />
    );
  }

  if (isAdminMode) {
    return (
      <AdminLayout currentPath={adminPath} onNavigate={handleAdminNavigate} onExit={() => setIsAdminMode(false)}>
        {renderAdminPage()}
      </AdminLayout>
    );
  }

  return (
    <div className="app-container">
      {!isAuthenticated && (
        <div className="auth-top-bar">
          <span className="auth-top-bar-text">Sign in to unlock all features</span>
          <div className="auth-top-bar-actions">
            <button className="auth-top-btn auth-top-btn--signin" onClick={() => window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'login' }))}>
              Sign In
            </button>
            <button className="auth-top-btn auth-top-btn--signup" onClick={() => window.dispatchEvent(new CustomEvent('openAuthModal', { detail: 'signup' }))}>
              Sign Up
            </button>
          </div>
        </div>
      )}

      <OfflineIndicator />

      <main className="main-content">
        <div className="page-transition-wrapper" key={activeTab}>
          {renderPage()}
        </div>
      </main>
      
      {!selectedItem && (
        <BottomNav
          activeTab={activeTab}
          onTabChange={handleTabChange}
          unreadCount={unreadMessagesCount}
        />
      )}

      {showAuthModal && (
        <div className="auth-modal-overlay">
          <div className="auth-modal-content">
            <button 
              className="auth-modal-close"
              onClick={() => setShowAuthModal(false)}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <AuthPages key={authInitialView + (authResetToken || '')} onAuthSuccess={handleAuthSuccess} initialView={authInitialView} resetToken={authResetToken} />
          </div>
        </div>
      )}

      {verifyState && (
        <div className="auth-modal-overlay">
          <div className="auth-modal-content">
            <button 
              className="auth-modal-close"
              onClick={() => setVerifyState(null)}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="auth-page">
              <div className="auth-container">
                <div className="auth-header">
                  <div className={`auth-logo ${verifyState.type === 'success' ? 'success' : 'error'}`}>
                    {verifyState.type === 'success' ? (
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    ) : (
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    )}
                  </div>
                  <h1>{verifyState.type === 'success' ? 'Email Verified' : 'Verification Failed'}</h1>
                </div>
                <div className="success-message">
                  <p>{verifyState.message}</p>
                </div>
                <button
                  type="button"
                  className="auth-submit-btn"
                  onClick={() => setVerifyState(null)}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAdminLogin && (
        <AdminLogin
          onClose={() => setShowAdminLogin(false)}
          onSuccess={() => { setShowAdminLogin(false); setIsAdminMode(true); }}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <EncryptionProvider>
            <AppProvider>
              <ToastProvider>
                <CookieProvider>
                  <AdminProvider>
                    <OnboardingGate>
                      <AppContent />
                    </OnboardingGate>
                  </AdminProvider>
                </CookieProvider>
              </ToastProvider>
            </AppProvider>
          </EncryptionProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
