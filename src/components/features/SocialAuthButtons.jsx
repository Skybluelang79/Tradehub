import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../ui/Toast';
import './SocialAuthButtons.css';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

export default function SocialAuthButtons({ onClose }) {
  const { socialLogin } = useAuth();
  const { addToast } = useToast();
  const [busy, setBusy] = useState(null);

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const facebookAppId = import.meta.env.VITE_FACEBOOK_APP_ID;

  const finishSocial = async (provider, token) => {
    const result = await socialLogin(provider, token);
    setBusy(null);
    if (result.success) {
      addToast('Welcome to TradeHub!', 'success');
      if (onClose) onClose();
    } else {
      addToast(result.error || 'Social login failed', 'error');
    }
  };

  const handleGoogle = async () => {
    if (busy) return;
    if (!googleClientId) {
      addToast('Google login is not configured yet', 'error');
      return;
    }
    setBusy('google');
    try {
      await loadScript('https://accounts.google.com/gsi/client');
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (res) => {
          if (res?.credential) finishSocial('google', res.credential);
          else setBusy(null);
        },
      });
      window.google.accounts.id.prompt();
    } catch {
      setBusy(null);
      addToast('Could not load Google sign-in', 'error');
    }
  };

  const handleFacebook = async () => {
    if (busy) return;
    if (!facebookAppId) {
      addToast('Facebook login is not configured yet', 'error');
      return;
    }
    setBusy('facebook');
    try {
      if (!window.FB) {
        window.fbAsyncInit = () => {
          window.FB.init({ appId: facebookAppId, version: 'v19.0', cookie: true, xfbml: false });
        };
        await loadScript('https://connect.facebook.net/en_US/sdk.js');
      }
      if (!window.FB) throw new Error('Facebook SDK unavailable');
      window.FB.login((response) => {
        const token = response?.authResponse?.accessToken;
        if (token) finishSocial('facebook', token);
        else setBusy(null);
      }, { scope: 'email,public_profile' });
    } catch {
      setBusy(null);
      addToast('Could not load Facebook login', 'error');
    }
  };

  return (
    <div className="social-auth">
      <div className="social-auth-divider">
        <span>or continue with</span>
      </div>
      <div className="social-auth-row">
        <button
          type="button"
          className="social-auth-btn google"
          onClick={handleGoogle}
          disabled={!!busy}
          aria-label="Continue with Google"
        >
          {busy === 'google' ? (
            <span className="social-auth-spinner" />
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.97 10.97 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
          )}
          <span>{busy === 'google' ? 'Signing in…' : 'Google'}</span>
        </button>

        <button
          type="button"
          className="social-auth-btn facebook"
          onClick={handleFacebook}
          disabled={!!busy}
          aria-label="Continue with Facebook"
        >
          {busy === 'facebook' ? (
            <span className="social-auth-spinner" />
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#1877F2">
              <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.49h-2.8V24C19.61 23.09 24 18.1 24 12.07z" />
            </svg>
          )}
          <span>{busy === 'facebook' ? 'Signing in…' : 'Facebook'}</span>
        </button>
      </div>
    </div>
  );
}
