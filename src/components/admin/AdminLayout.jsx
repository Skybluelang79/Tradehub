import { useState } from 'react';
import { useAdmin } from '../../context/AdminContext';
import { 
  DashboardIcon, 
  UsersIcon, 
  PackageIcon, 
  DollarIcon, 
  ChartIcon, 
  SettingsIcon, 
  ShieldIcon,
  MenuIcon,
  XIcon,
  LogOutIcon
} from '../../pages/admin/Icons.jsx';
import './AdminLayout.css';

const navItems = [
  { path: '/admin', label: 'Dashboard', icon: DashboardIcon },
  { path: '/admin/users', label: 'Users', icon: UsersIcon },
  { path: '/admin/listings', label: 'Listings', icon: PackageIcon },
  { path: '/admin/transactions', label: 'Transactions', icon: DollarIcon },
  { path: '/admin/reports', label: 'Reports', icon: ChartIcon },
  { path: '/admin/settings', label: 'Settings', icon: SettingsIcon },
];

const AdminLayout = ({ children, currentPath, onNavigate, onExit }) => {
  const { adminLogout } = useAdmin();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleExit = () => {
    adminLogout();
    onExit();
  };

  return (
    <div className="admin-layout">
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="admin-sidebar-header">
          <div className="admin-logo">
            <ShieldIcon size={28} />
            <span>TradeHub Admin</span>
          </div>
          <button className="admin-sidebar-close" onClick={() => setSidebarOpen(false)}>
            <XIcon size={24} />
          </button>
        </div>
        
        <nav className="admin-nav">
          {navItems.map((item) => (
            <button
              key={item.path}
              className={`admin-nav-item ${currentPath === item.path ? 'active' : ''}`}
              onClick={() => {
                onNavigate(item.path);
                setSidebarOpen(false);
              }}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-user">
            <div className="admin-user-avatar">A</div>
            <div className="admin-user-info">
              <span className="admin-user-name">Admin</span>
              <span className="admin-user-role">Super Admin</span>
            </div>
          </div>
          <button className="admin-exit-btn" onClick={handleExit}>
            <LogOutIcon size={18} />
            Logout
          </button>
        </div>
      </aside>

      <div className="admin-overlay" onClick={() => setSidebarOpen(false)} />

      <main className="admin-main">
        <header className="admin-header">
          <button className="admin-menu-toggle" onClick={() => setSidebarOpen(true)}>
            <MenuIcon size={24} />
          </button>
          <div className="admin-header-title">
            {navItems.find(item => item.path === currentPath)?.label || 'Dashboard'}
          </div>
          <div className="admin-header-actions">
            <button className="admin-header-btn">
              <ShieldIcon size={20} />
            </button>
          </div>
        </header>

        <div className="admin-content">
          {children}
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
