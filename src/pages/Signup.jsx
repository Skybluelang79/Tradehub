import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { TradeHubLogo } from '../components/ui';
import { SocialAuthButtons } from '../components/features';
import './Auth.css';

export default function Signup({ onSwitchToLogin, onClose }) {
  const { signup, requestSignupPhoneCode, signupWithPhone, isLoading, error, clearError } = useAuth();
  const { addToast } = useToast();

  const [method, setMethod] = useState('email');
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    code: '',
    referralCode: new URLSearchParams(window.location.search).get('ref') || '',
    acceptTerms: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [devVerifyToken, setDevVerifyToken] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeBusy = busy || isLoading;

  const getPasswordStrength = (password) => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;
    return strength;
  };

  const validateCommon = () => {
    const errors = {};

    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    } else if (formData.name.length < 2) {
      errors.name = 'Name must be at least 2 characters';
    }
    
    if (!formData.username.trim()) {
      errors.username = 'Username is required';
    } else if (formData.username.length < 3) {
      errors.username = 'Username must be at least 3 characters';
    } else if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) {
      errors.username = 'Username can only contain letters, numbers, and underscores';
    }

    if (!formData.acceptTerms) {
      errors.acceptTerms = 'You must accept the terms and conditions';
    }

    return errors;
  };

  const validateForm = () => {
    const errors = validateCommon();

    if (method === 'phone') {
      if (!formData.phone) {
        errors.phone = 'Phone number is required';
      } else if (formData.phone.replace(/\D/g, '').length < 7) {
        errors.phone = 'Please enter a valid phone number';
      }

      if (codeSent && !formData.code) {
        errors.code = 'Enter the code we sent you';
      } else if (codeSent && !/^\d{6}$/.test(formData.code)) {
        errors.code = 'The code is 6 digits';
      }
    } else {
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

      if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();

    if (!validateForm()) return;

    if (method === 'phone') {
      if (!codeSent) {
        setBusy(true);
        try {
          const result = await requestSignupPhoneCode(formData.phone);
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

      const result = await signupWithPhone({
        name: formData.name.trim(),
        username: formData.username.trim(),
        phone: formData.phone,
        code: formData.code,
        referralCode: formData.referralCode.trim(),
      });

      if (result.success) {
        addToast('Account created successfully!', 'success');
        if (onClose) onClose();
      } else {
        addToast(result.error || 'Signup failed', 'error');
      }
      return;
    }

    const result = await signup({
      name: formData.name,
      username: formData.username,
      email: formData.email,
      password: formData.password,
      referralCode: formData.referralCode.trim(),
    });

    if (result.success) {
      addToast('Account created successfully!', 'success');
      if (result.devVerifyToken) {
        setDevVerifyToken(result.devVerifyToken);
      } else if (onClose) {
        onClose();
      }
    } else {
      addToast(result.error || 'Signup failed', 'error');
    }
  };

  const switchMethod = (next) => {
    if (next === method) return;
    setMethod(next);
    setValidationErrors({});
    setCodeSent(false);
    if (error) clearError();
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    
    setFormData(prev => ({ ...prev, [name]: newValue }));
    
    if (name === 'password') {
      setPasswordStrength(getPasswordStrength(value));
    }
    
    if (validationErrors[name]) {
      setValidationErrors(prev => ({ ...prev, [name]: '' }));
    }
    if (error) clearError();
  };

  const strengthLabels = ['Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  const strengthColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'];

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-logo">
            <TradeHubLogo size={48} />
          </div>
          <h1>Create Account</h1>
          <p>Join TradeHub and start trading</p>
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

          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <div className="input-wrapper">
              <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <input
                type="text"
                id="name"
                name="name"
                placeholder="Enter your full name"
                value={formData.name}
                onChange={handleChange}
                className={validationErrors.name ? 'error' : ''}
              />
            </div>
            {validationErrors.name && (
              <span className="field-error">{validationErrors.name}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <div className="input-wrapper">
              <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4" />
                <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
              </svg>
              <input
                type="text"
                id="username"
                name="username"
                placeholder="Choose a username"
                value={formData.username}
                onChange={handleChange}
                className={validationErrors.username ? 'error' : ''}
              />
            </div>
            {validationErrors.username && (
              <span className="field-error">{validationErrors.username}</span>
            )}
          </div>

          {method === 'email' ? (
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
                    placeholder="Create a password"
                    value={formData.password}
                    onChange={handleChange}
                    className={validationErrors.password ? 'error' : ''}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
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
                {formData.password && (
                  <div className="password-strength">
                    <div className="strength-bars">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={`strength-bar ${i < passwordStrength ? 'active' : ''}`}
                          style={{ backgroundColor: i < passwordStrength ? strengthColors[passwordStrength - 1] : '#2A2A3E' }}
                        />
                      ))}
                    </div>
                    <span className="strength-label" style={{ color: strengthColors[passwordStrength - 1] || '#A0A0B0' }}>
                      {passwordStrength > 0 ? strengthLabels[passwordStrength - 1] : ''}
                    </span>
                  </div>
                )}
                {validationErrors.password && (
                  <span className="field-error">{validationErrors.password}</span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <div className="input-wrapper">
                  <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="confirmPassword"
                    name="confirmPassword"
                    placeholder="Confirm your password"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    className={validationErrors.confirmPassword ? 'error' : ''}
                  />
                </div>
                {validationErrors.confirmPassword && (
                  <span className="field-error">{validationErrors.confirmPassword}</span>
                )}
              </div>
            </>
          ) : (
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
            </>
          )}

          <div className="form-group">
            <label htmlFor="referralCode">Referral Code <span className="optional-label">(optional)</span></label>
            <div className="input-wrapper">
              <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              </svg>
              <input
                type="text"
                id="referralCode"
                name="referralCode"
                placeholder="Enter a friend's referral code"
                value={formData.referralCode}
                onChange={handleChange}
              />
            </div>
          </div>

          <label className="checkbox-label terms-label">
            <input
              type="checkbox"
              name="acceptTerms"
              checked={formData.acceptTerms}
              onChange={handleChange}
            />
            <span className="checkbox-custom"></span>
            I agree to the{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
            {' '}and{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
          </label>
          {validationErrors.acceptTerms && (
            <span className="field-error terms-error">{validationErrors.acceptTerms}</span>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={activeBusy}
          >
            {activeBusy ? (
              <span className="loading-spinner"></span>
            ) : (
              method === 'phone' && !codeSent ? 'Send code' : 'Create Account'
            )}
          </button>
        </form>

        {devVerifyToken && (
          <div className="dev-token-box">
            <p className="dev-token-label">No SMTP configured — dev verification token:</p>
            <code className="dev-token-value" onClick={() => {
              const base = `${window.location.origin}${window.location.pathname}`;
              window.location.href = `${base}verify-email?token=${devVerifyToken}`;
            }}>{devVerifyToken}</code>
            <p className="dev-token-hint">Click to verify this email. You can also sign in and use "Resend verification".</p>
          </div>
        )}

        <SocialAuthButtons onClose={onClose} />

        <div className="auth-footer">
          <p>
            Already have an account?{' '}
            <button type="button" onClick={onSwitchToLogin}>
              Sign In
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
