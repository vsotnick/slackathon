import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const { login, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(email, password);
      navigate('/');
    } catch {
      // error is already in store state
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'var(--bg-primary)' }}>

      {/* Ambient background blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl opacity-20"
          style={{ background: 'radial-gradient(circle, #3b82f6, transparent)' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-3xl opacity-15"
          style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-md mx-4 animate-slide-up">
        <div className="glass rounded-2xl p-8 glow-blue">
          {/* Logo / Brand */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gradient">Slackathon</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Secure enterprise messaging
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--text-secondary)' }}>
                Email address
              </label>
              <input
                className="input-field"
                type="email"
                placeholder="you@company.com"
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
              <div style={{ position: 'relative' }}>
                <input
                  className="input-field"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  style={{ paddingRight: 42 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', right: 10, top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none',
                    color: '#475569', fontSize: 16,
                    lineHeight: 1, padding: '2px 4px',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            {/* Fix 8: Keep me signed in + Forgot password row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12 }}
                     id="login-keep-signed-in-label">
                <input
                  id="login-keep-signed-in"
                  type="checkbox"
                  checked={keepSignedIn}
                  onChange={(e) => setKeepSignedIn(e.target.checked)}
                  style={{ accentColor: 'var(--accent-blue)', width: 14, height: 14, cursor: 'pointer' }}
                />
                <span style={{ color: 'var(--text-secondary)' }}>Keep me signed in</span>
              </label>
              <a
                id="login-forgot-password"
                href="/forgot-password"
                style={{ fontSize: 12, color: 'var(--accent-blue)', textDecoration: 'none', opacity: 0.85 }}
                onClick={(e) => {
                  e.preventDefault();
                  // Route to forgot-password page (placeholder navigates for now)
                  window.location.href = '/forgot-password';
                }}
              >
                Forgot password?
              </a>
            </div>

            {error && (
              <div className="rounded-lg p-3 text-sm animate-fade-in"
                style={{
                  background: 'rgba(252,129,129,0.1)',
                  border: '1px solid rgba(252,129,129,0.3)',
                  color: 'var(--accent-red)',
                }}>
                {error}
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
                  Signing in…
                </span>
              ) : 'Sign In'}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No account?{' '}
            <Link to="/register" className="transition-colors hover:opacity-80"
              style={{ color: 'var(--accent-blue)' }}
              onClick={clearError}>
              Create one
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
