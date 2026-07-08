import { useState } from 'react';
import { useAdmin } from '../../context/AdminContext';
import { ShieldIcon, XIcon } from '../../pages/admin/Icons';
import './AdminLogin.css';

export default function AdminLogin({ onClose, onSuccess }) {
  const { adminLogin, adminLoginError } = useAdmin();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 500));
    const ok = adminLogin(password);
    setLoading(false);
    if (ok) {
      if (onSuccess) onSuccess();
      else if (onClose) onClose();
    }
  };

  return (
    <div className="admin-login-overlay" onClick={onClose}>
      <div className="admin-login-card" onClick={(e) => e.stopPropagation()}>
        <button className="admin-login-close" onClick={onClose}>
          <XIcon size={20} />
        </button>
        <div className="admin-login-icon">
          <ShieldIcon size={40} />
        </div>
        <h2>Admin Login</h2>
        <p>Enter the admin password to access the panel.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {adminLoginError && <p className="admin-login-error">{adminLoginError}</p>}
          <button type="submit" disabled={!password || loading}>
            {loading ? 'Verifying...' : 'Enter Admin Panel'}
          </button>
        </form>
      </div>
    </div>
  );
}
