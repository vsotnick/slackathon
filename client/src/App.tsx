import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ChatLayout } from './pages/ChatLayout';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminProtectedRoute } from './components/AdminProtectedRoute';
import { AdminDashboard } from './pages/AdminDashboard';
import './index.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"          element={<LoginPage />} />
        <Route path="/register"       element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/"
          element={
            <ProtectedRoute>
              <ChatLayout />
            </ProtectedRoute>
          }
        />
        <Route path="/admin"
          element={
            <AdminProtectedRoute>
              <AdminDashboard />
            </AdminProtectedRoute>
          }
        />
        {/* Catch-all → login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

// ── Inline ForgotPasswordPage (lightweight — no separate file needed) ────────
import { useState, type FormEvent } from 'react';

function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } finally {
      setSent(true);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="relative w-full max-w-md mx-4 animate-slide-up">
        <div className="glass rounded-2xl p-8 glow-blue">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gradient">Forgot Password</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Enter your email to receive a reset link
            </p>
          </div>
          {sent ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#4ade80', background: 'rgba(74,222,128,0.1)', borderRadius: 10, border: '1px solid rgba(74,222,128,0.3)', fontSize: 14 }}>
              ✓ If this email is registered, a reset link has been sent.<br />
              <small style={{ color: 'var(--text-muted)', fontSize: 12 }}>(Check server logs for the link in this demo)</small>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input className="input-field" type="email" id="forgot-email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} required />
              <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Sending…' : 'Send Reset Link'}</button>
            </form>
          )}
          <div className="mt-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            <a href="/login" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>Back to Sign In</a>
          </div>
        </div>
      </div>
    </div>
  );
}
