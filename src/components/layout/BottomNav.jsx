import { HomeIcon, ChatIcon, PlusIcon, CardIcon, UserIcon, BellIcon } from '../ui/Icons';
import './BottomNav.css';

const navItems = [
  { id: 'home', label: 'Browse', icon: HomeIcon },
  { id: 'chat', label: 'Chat', icon: ChatIcon, badge: true },
  { id: 'add', label: 'Sell', icon: PlusIcon, isAction: true },
  { id: 'payments', label: 'Payments', icon: CardIcon },
  { id: 'profile', label: 'Profile', icon: UserIcon },
];

export default function BottomNav({ activeTab, onTabChange, unreadCount = 0 }) {
  return (
    <nav className="bottom-nav">
      {navItems.map(({ id, label, icon: Icon, badge, isAction }) => {
        const isActive = activeTab === id;
        
        if (isAction) {
          return (
            <button
              key={id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onTabChange(id)}
            >
              <div className="nav-add-btn">
                <Icon size={24} />
              </div>
              <span>{label}</span>
            </button>
          );
        }

        return (
          <button
            key={id}
            className={`nav-item ${isActive ? 'active' : ''}`}
            onClick={() => onTabChange(id)}
          >
            <span className="nav-item-wrapper">
              {badge && unreadCount > 0 && (
                <span className="nav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
              <Icon size={24} />
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
