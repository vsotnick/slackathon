import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

export function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token') || '';
    setToken(t);
    if (!t) setError('Missing or invalid reset link. Please request a new one.');
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) { setError('Passwords do not match.'); return; }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Reset failed.');
      setSuccess('Password reset! Redirecting to sign in…');
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'var(--bg-primary)' }}>

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full blur-3xl opacity-20"
          style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
      </div>

      <div className="relative w-full max-w-md mx-4 animate-slide-up">
        <div className="glass rounded-2xl p-8 glow-violet">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
              style={{ background: 'linear-gradient(135deg, #6366f1, #9f7aea)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gradient">Set New Password</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Choose a strong password for your account
            </p>
          </div>

          {success ? (
            <div className="rounded-lg p-4 text-sm text-center animate-fade-in"
              style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80' }}>
              {success}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  New password
                </label>
                <input
                  id="reset-new-password"
                  className="input-field"
                  type="password"
                  placeholder="Min. 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  disabled={!token}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Confirm password
                </label>
                <input
                  id="reset-confirm-password"
                  className="input-field"
                  type="password"
                  placeholder="Re-enter new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  disabled={!token}
                  style={{ borderColor: confirm && newPassword !== confirm ? 'rgba(252,129,129,0.6)' : undefined }}
                />
                {confirm && newPassword !== confirm && (
                  <p style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>Passwords do not match</p>
                )}
              </div>

              {error && (
                <div className="rounded-lg p-3 text-sm animate-fade-in"
                  style={{ background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.3)', color: 'var(--accent-red)' }}>
                  {error}
                </div>
              )}

              <button type="submit" className="btn-primary mt-2" disabled={loading || !token}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Resetting…
                  </span>
                ) : 'Reset Password'}
              </button>

              <div className="text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                <a href="/login" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
                  Back to Sign In
                </a>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
