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

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.97 10.97 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
  </svg>
);

const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="#1877F2">
    <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.49h-2.8V24C19.61 23.09 24 18.1 24 12.07z" />
  </svg>
);

const AppleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="#555555">
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.03 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702" />
  </svg>
);

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="#181717">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

const XIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="#000000">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const MicrosoftIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <rect x="1" y="1" width="10.5" height="10.5" fill="#F25022" />
    <rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00" />
    <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF" />
    <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900" />
  </svg>
);

const PLATFORMS = [
  { id: 'google', name: 'Google', icon: GoogleIcon, quick: true },
  { id: 'facebook', name: 'Facebook', icon: FacebookIcon, quick: true },
  { id: 'apple', name: 'Apple', icon: AppleIcon },
  { id: 'github', name: 'GitHub', icon: GitHubIcon },
  { id: 'x', name: 'X (Twitter)', icon: XIcon },
  { id: 'microsoft', name: 'Microsoft', icon: MicrosoftIcon },
];

export default function SocialAuthButtons({ onClose }) {
  const { socialLogin } = useAuth();
  const { addToast } = useToast();
  const [busy, setBusy] = useState(null);
  const [showOptions, setShowOptions] = useState(false);

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

  const handleSelect = (platform) => {
    setShowOptions(false);
    if (platform.id === 'google') handleGoogle();
    else if (platform.id === 'facebook') handleFacebook();
    else addToast(`${platform.name} login is not configured yet`, 'error');
  };

  return (
    <div className="social-auth">
      <div className="social-auth-divider">
        <span>or continue with</span>
      </div>

      <div className="social-auth-row">
        <button
          type="button"
          className="social-auth-btn"
          onClick={handleGoogle}
          disabled={!!busy}
          aria-label="Continue with Google"
        >
          {busy === 'google' ? <span className="social-auth-spinner" /> : <GoogleIcon />}
          <span>{busy === 'google' ? 'Signing in…' : 'Google'}</span>
        </button>

        <button
          type="button"
          className="social-auth-btn"
          onClick={handleFacebook}
          disabled={!!busy}
          aria-label="Continue with Facebook"
        >
          {busy === 'facebook' ? <span className="social-auth-spinner" /> : <FacebookIcon />}
          <span>{busy === 'facebook' ? 'Signing in…' : 'Facebook'}</span>
        </button>
      </div>

      <button
        type="button"
        className="social-more-btn"
        onClick={() => setShowOptions((v) => !v)}
        disabled={!!busy}
      >
        <span className={`social-more-caret ${showOptions ? 'open' : ''}`} />
        More options
      </button>

      {showOptions && (
        <div className="social-options-panel">
          {PLATFORMS.map((platform) => {
            const PlatformIcon = platform.icon;
            return (
              <button
                key={platform.id}
                type="button"
                className="social-option"
                onClick={() => handleSelect(platform)}
                disabled={!!busy}
              >
                <PlatformIcon />
                <span className="social-option-name">{platform.name}</span>
                <span className="social-option-hint">Continue</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
