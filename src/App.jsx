import { useState, useEffect, useRef } from 'react';
import { AppProvider, useApp, LanguageProvider, CookieProvider, ThemeProvider } from './context';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, OnboardingGate } from './components/ui';
import { BottomNav } from './components/layout';
import { OfflineIndicator } from './components/features';


import { Home, Chat, AddListing, Payments, Profile, ItemDetail, Login, Signup, ForgotPassword, Favorites, Notifications } from './pages';
import { AdminProvider, useAdmin } from './context/AdminContext.jsx';
import AdminLayout from './components/admin/AdminLayout.jsx';
import AdminLogin from './components/admin/AdminLogin.jsx';
import {
  AdminDashboard,
  AdminUsers,
  AdminListings,
  AdminTransactions,
  AdminReports,
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
  const { activeTab, selectedItem, setActiveTab, unreadMessagesCount } = useApp();
  const { isAuthenticated } = useAuth();
  const { isAdminAuth } = useAdmin();
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminPath, setAdminPath] = useState('/admin');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [authRedirectTab, setAuthRedirectTab] = useState(null);
  const [authInitialView, setAuthInitialView] = useState('login');
  const [pageKey, setPageKey] = useState(0);
  const prevTabRef = useRef(activeTab);

  useEffect(() => {
    const onAuth = (e) => { setAuthInitialView(e.detail || 'login'); setShowAuthModal(true); };
    const onNotifs = () => setShowNotifications(true);
    const onFavs = () => setShowFavorites(true);
    window.addEventListener('openAuthModal', onAuth);
    window.addEventListener('openNotifications', onNotifs);
    window.addEventListener('openFavorites', onFavs);
    return () => {
      window.removeEventListener('openAuthModal', onAuth);
      window.removeEventListener('openNotifications', onNotifs);
      window.removeEventListener('openFavorites', onFavs);
    };
  }, []);

  useEffect(() => {
    if (activeTab !== prevTabRef.current) {
      setPageKey(prev => prev + 1);
      prevTabRef.current = activeTab;
    }
  }, [activeTab]);

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
      case '/admin/reports':
        return <AdminReports />;
      case '/admin/settings':
        return <AdminSettings />;
      default:
        return <AdminDashboard />;
    }
  };

  const handleTabChange = (tab) => {
    const authRequiredTabs = ['add', 'chat', 'payments', 'profile'];
    
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

  if (isAdminMode) {
    return (
      <AdminLayout currentPath={adminPath} onNavigate={handleAdminNavigate} onExit={() => setIsAdminMode(false)}>
        {renderAdminPage()}
      </AdminLayout>
    );
  }

  return (
    <div className="app-container">
      <button
        className="admin-toggle-btn"
        onClick={() => {
          if (isAdminAuth) {
            setIsAdminMode(true);
          } else {
            setShowAdminLogin(true);
          }
        }}
        title={isAdminAuth ? 'Admin Panel' : 'Admin Login'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      </button>

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
        <div className="page-transition-wrapper" key={pageKey}>
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
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
