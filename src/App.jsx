import { useState, useEffect } from 'react';
import { AppProvider, useApp, LanguageProvider, CookieProvider, ThemeProvider } from './context';
import { AuthProvider, useAuth } from './context/AuthContext';
import { EncryptionProvider } from './context/EncryptionContext';
import { ToastProvider, OnboardingGate } from './components/ui';
import { BottomNav } from './components/layout';
import { OfflineIndicator } from './components/features';


import { Home, Chat, AddListing, Payments, Profile, ItemDetail, Login, Signup, ForgotPassword, Favorites, Notifications, GiftMall } from './pages';
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
  AdminSettings
} from './pages/admin';
import './styles/globals.css';

function AuthPages({ onAuthSuccess, initialView = 'login' }) {
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
  const [authRedirectTab, setAuthRedirectTab] = useState(null);
  const [authInitialView, setAuthInitialView] = useState('login');

  useEffect(() => {
    const onAuth = (e) => { setAuthInitialView(e.detail || 'login'); setShowAuthModal(true); };
    const onNotifs = () => setShowNotifications(true);
    const onFavs = () => setShowFavorites(true);
    const onMall = () => setShowGiftMall(true);
    const onHome = () => {
      setShowFavorites(false);
      setShowNotifications(false);
      setShowGiftMall(false);
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
    window.addEventListener('goHome', onHome);
    window.addEventListener('openAdminLogin', onAdminLogin);
    window.addEventListener('adminSessionExpired', onAdminSessionExpired);
    return () => {
      window.removeEventListener('openAuthModal', onAuth);
      window.removeEventListener('openNotifications', onNotifs);
      window.removeEventListener('openFavorites', onFavs);
      window.removeEventListener('openGiftMall', onMall);
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
      case '/admin/audit-logs':
        return <AdminAuditLogs />;
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
            <AuthPages key={authInitialView} onAuthSuccess={handleAuthSuccess} initialView={authInitialView} />
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
