import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState('');
  const { register, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setValidationError('');

    // Validate username in JS — avoids HTML pattern /v mode incompatibilities
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      setValidationError('Username may only contain letters, numbers, underscore, dot and hyphen.');
      return;
    }

    // Fix 8: confirm password match validation
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match.');
      return;
    }

    try {
      await register(username, email, password);
      navigate('/');
    } catch {
      // error is in store state
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'var(--bg-primary)' }}>

      {/* Ambient background blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 right-1/3 w-96 h-96 rounded-full blur-3xl opacity-20"
          style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
        <div className="absolute bottom-1/3 left-1/3 w-80 h-80 rounded-full blur-3xl opacity-15"
          style={{ background: 'radial-gradient(circle, #3b82f6, transparent)' }} />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-md mx-4 animate-slide-up">
        <div className="glass rounded-2xl p-8 glow-violet">
          {/* Brand */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
              style={{ background: 'linear-gradient(135deg, #6366f1, #9f7aea)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gradient">Create Account</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Join your team on Slackathon
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--text-secondary)' }}>
                Username
              </label>
              <input
                className="input-field"
                type="text"
                placeholder="alice"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={2}
                maxLength={32}
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--text-secondary)' }}>
                Email address
              </label>
              <input
                className="input-field"
                type="email"
                placeholder="alice@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--text-secondary)' }}>
                Password
              </label>
              <input
                className="input-field"
                type="password"
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            {/* Fix 8: Confirm password field */}
            <div>
              <label className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--text-secondary)' }}>
                Confirm Password
              </label>
              <input
                id="register-confirm-password"
                className="input-field"
                type="password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                style={{
                  borderColor: confirmPassword && password !== confirmPassword
                    ? 'rgba(252,129,129,0.6)'
                    : undefined,
                }}
              />
              {confirmPassword && password !== confirmPassword && (
                <p style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>
                  Passwords do not match
                </p>
              )}
            </div>

            {(validationError || error) && (
              <div className="rounded-lg p-3 text-sm animate-fade-in"
                style={{
                  background: 'rgba(252,129,129,0.1)',
                  border: '1px solid rgba(252,129,129,0.3)',
                  color: 'var(--accent-red)',
                }}>
                {validationError || error}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary mt-2"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10"
                      stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Creating account…
                </span>
              ) : 'Create Account'}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Already have an account?{' '}
            <Link to="/login"
              className="transition-colors hover:opacity-80"
              style={{ color: 'var(--accent-blue)' }}
              onClick={clearError}>
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
