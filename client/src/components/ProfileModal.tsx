import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { useNavigate } from 'react-router-dom';

interface Session {
  id: string;
  user_agent: string;
  ip_address: string;
  created_at: string;
  last_seen_at: string;
}

interface ProfileModalProps {
  onClose: () => void;
}

type Tab = 'account' | 'sessions' | 'delete';

export function ProfileModal({ onClose }: ProfileModalProps) {
  const { jwt, user, logout, updatePrivacySettings } = useAuthStore();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('account');

  // Password change state
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');

  // Sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessLoading, setSessLoading] = useState(false);

  // Delete account state
  const [delPassword, setDelPassword] = useState('');
  const [delConfirm, setDelConfirm] = useState(false);
  const [delLoading, setDelLoading] = useState(false);
  const [delErr, setDelErr] = useState('');

  const authHeader = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` };

  const loadSessions = useCallback(async () => {
    setSessLoading(true);
    try {
      const res = await fetch('/api/auth/sessions', { headers: authHeader });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } finally {
      setSessLoading(false);
    }
  }, [jwt]);

  useEffect(() => {
    if (tab === 'sessions') loadSessions();
  }, [tab, loadSessions]);

  const handlePasswordChange = async () => {
    setPwErr(''); setPwMsg('');
    if (newPw !== confirmPw) { setPwErr('Passwords do not match.'); return; }
    if (newPw.length < 8) { setPwErr('New password must be at least 8 characters.'); return; }
    setPwLoading(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PUT', headers: authHeader,
        body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to change password.');
      setPwMsg('Password updated successfully!');
      setCurrent(''); setNewPw(''); setConfirmPw('');
    } catch (e: any) {
      setPwErr(e.message);
    } finally {
      setPwLoading(false);
    }
  };

  const revokeSession = async (id: string) => {
    await fetch(`/api/auth/sessions/${id}`, { method: 'DELETE', headers: authHeader });
    loadSessions();
  };

  const handleDeleteAccount = async () => {
    if (!delConfirm) { setDelErr('Please confirm deletion by checking the checkbox.'); return; }
    setDelLoading(true); setDelErr('');
    try {
      const res = await fetch('/api/auth/account', {
        method: 'DELETE', headers: authHeader,
        body: JSON.stringify({ password: delPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to delete account.');
      logout();
      navigate('/login');
    } catch (e: any) {
      setDelErr(e.message);
    } finally {
      setDelLoading(false);
    }
  };

  return (
    <div id="profile-modal-overlay" style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#161b27', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16, width: '100%', maxWidth: 520,
        maxHeight: '90vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>Profile Settings</h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>@{user?.username}</p>
          </div>
          <button id="profile-modal-close" onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '16px 24px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {(['account', 'sessions', 'delete'] as Tab[]).map(t => (
            <button key={t} id={`profile-tab-${t}`} onClick={() => setTab(t)} style={{
              background: tab === t ? 'rgba(99,102,241,0.15)' : 'none',
              borderTop:    tab === t ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
              borderLeft:   tab === t ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
              borderRight:  tab === t ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
              borderBottom: 'none',
              borderRadius: '8px 8px 0 0',
              color: tab === t ? '#818cf8' : '#64748b',
              cursor: 'pointer', padding: '8px 14px', fontSize: 13, fontWeight: 500,
              transition: 'all 0.15s',
            }}>
              {t === 'account' ? '👤 Account' : t === 'sessions' ? '🖥 Sessions' : '🗑 Delete Account'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

          {/* ── Account tab ── */}
          {tab === 'account' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              
              {/* Privacy Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>Privacy Settings</h3>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#cbd5e1' }}>
                  <input 
                    type="checkbox" 
                    checked={user?.friends_only_dms ?? false} 
                    onChange={async (e) => {
                      try {
                        await updatePrivacySettings(e.target.checked);
                      } catch (err) {
                        useChatStore.getState().addToast('Failed to update privacy settings', 'error');
                      }
                    }}
                    style={{ accentColor: '#6366f1', width: 16, height: 16 }} 
                  />
                  Only friends can write messages to me
                </label>
                <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                  When enabled, users who are not your friends will be prompted to send you a friend request before they can message you.
                </p>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.06)' }} />
              
              {/* Password Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>Change Password</h3>
                <Field label="Current password" id="profile-current-password">
                  <input id="profile-current-password" type="password" className="input-field" placeholder="••••••••" value={current} onChange={e => setCurrent(e.target.value)} />
                </Field>
                <Field label="New password" id="profile-new-password">
                  <input id="profile-new-password" type="password" className="input-field" placeholder="Min. 8 characters" value={newPw} onChange={e => setNewPw(e.target.value)} />
                </Field>
                <Field label="Confirm new password" id="profile-confirm-password">
                  <input id="profile-confirm-password" type="password" className="input-field" placeholder="Re-enter new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                    style={{ borderColor: confirmPw && newPw !== confirmPw ? 'rgba(252,129,129,0.6)' : undefined }} />
                </Field>
                {pwErr && <Msg type="error">{pwErr}</Msg>}
                {pwMsg && <Msg type="success">{pwMsg}</Msg>}
                <button id="profile-save-password" onClick={handlePasswordChange} disabled={pwLoading} className="btn-primary" style={{ width: 'fit-content' }}>
                  {pwLoading ? 'Saving…' : 'Update Password'}
                </button>
              </div>

            </div>
          )}

          {/* ── Sessions tab ── */}
          {tab === 'sessions' && (
            <div>
              <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
                These are all active login sessions for your account. You can revoke individual sessions.
              </p>
              {sessLoading ? (
                <p style={{ color: '#64748b', fontSize: 13 }}>Loading sessions…</p>
              ) : sessions.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: 13 }}>No active sessions found.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sessions.map((s) => (
                    <div key={s.id} style={{
                      background: 'rgba(255,255,255,0.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)',
                      padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    }}>
                      <div>
                        <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }} title={s.user_agent}>
                          {parseUserAgent(s.user_agent)}
                        </div>
                        <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                          {s.ip_address || 'unknown'} · {new Date(s.last_seen_at).toLocaleString()}
                        </div>
                      </div>
                      <button id={`revoke-session-${s.id}`} onClick={() => revokeSession(s.id)} style={{
                        background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                        color: '#f87171', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap',
                      }}>
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button id="profile-refresh-sessions" onClick={loadSessions} className="btn-ghost" style={{ marginTop: 12, fontSize: 13 }}>↻ Refresh</button>
            </div>
          )}

          {/* ── Delete account tab ── */}
          {tab === 'delete' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: 14 }}>
                <p style={{ margin: 0, fontSize: 13, color: '#fca5a5', lineHeight: 1.6 }}>
                  ⚠️ <strong>This action is permanent and cannot be undone.</strong>
                  <br />Your account, all rooms you own, and all messages/files in those rooms will be deleted permanently.
                  Memberships in other rooms will also be removed.
                </p>
              </div>
              <Field label="Confirm your password" id="profile-delete-password">
                <input id="profile-delete-password" type="password" className="input-field" placeholder="Enter your password to confirm"
                  value={delPassword} onChange={e => setDelPassword(e.target.value)} />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#94a3b8' }}>
                <input id="profile-delete-confirm-check" type="checkbox" checked={delConfirm} onChange={e => setDelConfirm(e.target.checked)}
                  style={{ accentColor: '#ef4444', width: 14, height: 14 }} />
                I understand this is permanent and irreversible
              </label>
              {delErr && <Msg type="error">{delErr}</Msg>}
              <button id="profile-delete-account" onClick={handleDeleteAccount} disabled={delLoading || !delPassword || !delConfirm} style={{
                background: delLoading ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', borderRadius: 10,
                padding: '10px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                transition: 'all 0.2s', opacity: (!delPassword || !delConfirm) ? 0.5 : 1,
              }}>
                {delLoading ? 'Deleting…' : '🗑 Permanently Delete Account'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 6, color: '#94a3b8' }}>{label}</label>
      {children}
    </div>
  );
}
function Msg({ type, children }: { type: 'error' | 'success'; children: React.ReactNode }) {
  const isErr = type === 'error';
  return (
    <div style={{
      background: isErr ? 'rgba(252,129,129,0.1)' : 'rgba(74,222,128,0.1)',
      border: `1px solid ${isErr ? 'rgba(252,129,129,0.3)' : 'rgba(74,222,128,0.3)'}`,
      color: isErr ? '#fca5a5' : '#4ade80',
      borderRadius: 8, padding: '8px 12px', fontSize: 13,
    }}>
      {children}
    </div>
  );
}

function parseUserAgent(ua: string): string {
  if (!ua) return 'Unknown Device';
  
  let browser = 'Unknown Browser';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('OPR/') || ua.includes('Opera/')) browser = 'Opera';
  else if (ua.includes('Chrome/') || ua.includes('CriOS/')) browser = 'Chrome';
  else if (ua.includes('Firefox/') || ua.includes('FxiOS/')) browser = 'Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';
  else if (ua.includes('MSIE') || ua.includes('Trident/')) browser = 'Internet Explorer';
  
  let os = 'Unknown OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  
  return `${browser} on ${os}`;
}
