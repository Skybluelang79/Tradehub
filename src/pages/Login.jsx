import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { isPasskeySupported } from '../services/webauthn';
import { useToast } from '../components/ui/Toast';
import { TradeHubLogo } from '../components/ui';
import { SocialAuthButtons } from '../components/features';
import './Auth.css';

export default function Login({ onSwitchToSignup, onForgotPassword, onClose }) {
  const {
    login,
    isLoading,
    error,
    clearError,
    requestPhoneCode,
    loginWithPhone,
    signInWithPasskey,
  } = useAuth();
  const { addToast } = useToast();

  const [method, setMethod] = useState('email');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    phone: '',
    code: '',
    rememberMe: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const passkeySupported = isPasskeySupported();
  const activeBusy = busy || isLoading;

  const validateEmailForm = () => {
    const errors = {};

    if (!formData.email) {
      errors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      errors.email = 'Please enter a valid email';
    }

    if (!formData.password) {
      errors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validatePhoneForm = (requireCode) => {
    const errors = {};

    if (!formData.phone) {
      errors.phone = 'Phone number is required';
    } else if (formData.phone.replace(/\D/g, '').length < 7) {
      errors.phone = 'Please enter a valid phone number';
    }

    if (requireCode) {
      if (!formData.code) {
        errors.code = 'Enter the code we sent you';
      } else if (!/^\d{6}$/.test(formData.code)) {
        errors.code = 'The code is 6 digits';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();

    if (method === 'phone') {
      if (!validatePhoneForm(codeSent)) return;

      if (!codeSent) {
        setBusy(true);
        try {
          const result = await requestPhoneCode(formData.phone);
          setCodeSent(true);
          // The server echoes the code in development so the flow can be
          // tried without an SMS gateway.
          if (result.devCode) {
            setFormData((prev) => ({ ...prev, code: result.devCode }));
            addToast(`Dev mode: your code is ${result.devCode}`, 'info');
          } else {
            addToast(result.message || 'Code sent', 'success');
          }
        } catch (err) {
          addToast(err.message || 'Could not send the code', 'error');
        } finally {
          setBusy(false);
        }
        return;
      }

      const result = await loginWithPhone(formData.phone, formData.code);
      if (result.success) {
        addToast('Welcome back!', 'success');
        if (onClose) onClose();
      } else {
        addToast(result.error || 'Sign-in failed', 'error');
      }
      return;
    }

    if (!validateEmailForm()) return;

    const result = await login(formData.email, formData.password);

    if (result.success) {
      addToast('Welcome back!', 'success');
      if (onClose) onClose();
    } else {
      addToast(result.error || 'Login failed', 'error');
    }
  };

  const handlePasskey = async () => {
    clearError();
    setBusy(true);
    try {
      // Passing the email scopes the fingerprint prompt to this account when
      // the user is on the email tab.
      const email = method === 'email' && /\S+@\S+\.\S+/.test(formData.email)
        ? formData.email.trim()
        : undefined;
      const result = await signInWithPasskey(email);
      if (result.success) {
        addToast('Signed in with your fingerprint', 'success');
        if (onClose) onClose();
      } else {
        addToast(result.error || 'Fingerprint sign-in failed', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    if (validationErrors[name]) {
      setValidationErrors(prev => ({ ...prev, [name]: '' }));
    }
    if (error) clearError();
  };

  const switchMethod = (next) => {
    if (next === method) return;
    setMethod(next);
    setValidationErrors({});
    setCodeSent(false);
    if (error) clearError();
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-logo">
            <TradeHubLogo size={48} />
          </div>
          <h1>Welcome Back</h1>
          <p>Sign in to continue trading</p>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={method === 'email'}
            className={`auth-tab ${method === 'email' ? 'active' : ''}`}
            onClick={() => switchMethod('email')}
          >
            Email
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={method === 'phone'}
            className={`auth-tab ${method === 'phone' ? 'active' : ''}`}
            onClick={() => switchMethod('phone')}
          >
            Phone
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && (
            <div className="auth-error">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {method === 'phone' ? (
            <>
              <div className="form-group">
                <label htmlFor="phone">Phone number</label>
                <div className="input-wrapper">
                  <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    autoComplete="tel"
                    placeholder="0803 123 4567"
                    value={formData.phone}
                    onChange={handleChange}
                    className={validationErrors.phone ? 'error' : ''}
                  />
                </div>
                {validationErrors.phone && (
                  <span className="field-error">{validationErrors.phone}</span>
                )}
              </div>

              {codeSent && (
                <div className="form-group">
                  <label htmlFor="code">Verification code</label>
                  <div className="input-wrapper">
                    <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <input
                      type="text"
                      id="code"
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="6-digit code"
                      value={formData.code}
                      onChange={handleChange}
                      className={validationErrors.code ? 'error' : ''}
                    />
                  </div>
                  {validationErrors.code && (
                    <span className="field-error">{validationErrors.code}</span>
                  )}
                  <button
                    type="button"
                    className="auth-link-btn"
                    onClick={() => {
                      setFormData(prev => ({ ...prev, code: '' }));
                      setCodeSent(false);
                    }}
                  >
                    Use a different number
                  </button>
                </div>
              )}

              <button
                type="submit"
                className="auth-submit-btn"
                disabled={activeBusy}
              >
                {activeBusy ? (
                  <span className="loading-spinner"></span>
                ) : (
                  codeSent ? 'Sign In' : 'Send code'
                )}
              </button>
            </>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <div className="input-wrapper">
                  <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    autoComplete="email"
                    placeholder="Enter your email"
                    value={formData.email}
                    onChange={handleChange}
                    className={validationErrors.email ? 'error' : ''}
                  />
                </div>
                {validationErrors.email && (
                  <span className="field-error">{validationErrors.email}</span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <div className="input-wrapper">
                  <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleChange}
                    className={validationErrors.password ? 'error' : ''}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                {validationErrors.password && (
                  <span className="field-error">{validationErrors.password}</span>
                )}
              </div>

              <div className="form-options">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="rememberMe"
                    checked={formData.rememberMe}
                    onChange={handleChange}
                  />
                  <span className="checkbox-custom"></span>
                  Remember me
                </label>
                <button
                  type="button"
                  className="forgot-password-btn"
                  onClick={onForgotPassword}
                >
                  Forgot password?
                </button>
              </div>

              <button
                type="submit"
                className="auth-submit-btn"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="loading-spinner"></span>
                ) : (
                  'Sign In'
                )}
              </button>
            </>
          )}
        </form>

        {passkeySupported && (
          <>
            <div className="auth-divider">
              <span>or</span>
            </div>
            <button
              type="button"
              className="auth-passkey-btn"
              onClick={handlePasskey}
              disabled={activeBusy}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
                <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
                <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
                <path d="M2 12a4 4 0 0 1 7.464-1.465" />
                <path d="M2 15.598A6.5 6.5 0 0 1 6.5 21a6.47 6.47 0 0 0 1.965-.403" />
                <path d="M12 13a4 4 0 1 1 4 4" />
                <path d="M21.801 10A10 10 0 1 0 22 14" />
              </svg>
              Sign in with your fingerprint
            </button>
          </>
        )}

        <SocialAuthButtons onClose={onClose} />

        <div className="auth-footer">
          <p>
            Don't have an account?{' '}
            <button type="button" onClick={onSwitchToSignup}>
              Sign Up
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}