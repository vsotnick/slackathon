import { useAuthStore } from '../store/authStore';
import { XmppStatusBadge } from '../components/XmppStatusBadge';
import { useChatStore } from '../store/chatStore';

/**
 * DashboardStub — Phase 2.2 verification page.
 *
 * Shows the authenticated user's info and the live XMPP status badge.
 * The badge going "online" proves the Zustand store successfully
 * connected to ws://localhost/xmpp after login.
 *
 * This will be replaced by the full Main Chat UI in Step 2.3.
 */
export function DashboardStub() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const xmppAddress = useChatStore((s) => s.address);
  const xmppStatus = useChatStore((s) => s.status);
  const xmppError = useChatStore((s) => s.error);

  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg-primary)' }}>

      {/* Ambient blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/3 left-1/4 w-96 h-96 rounded-full blur-3xl opacity-10"
          style={{ background: 'radial-gradient(circle, #3b82f6, transparent)' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-3xl opacity-10"
          style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
      </div>

      <div className="relative w-full max-w-lg mx-4 animate-fade-in">
        <div className="glass rounded-2xl p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-xl font-bold text-gradient">Phase 2.2 Verified ✓</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                XMPP WebSocket connected via Zustand store
              </p>
            </div>
            <button
              onClick={logout}
              className="text-sm px-3 py-1.5 rounded-lg transition-colors"
              style={{
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--accent-red)';
                e.currentTarget.style.borderColor = 'rgba(252,129,129,0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
              }}
            >
              Logout
            </button>
          </div>

          {/* Status Badge — THE PROOF */}
          <div className="mb-6">
            <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
              XMPP CONNECTION STATUS
            </p>
            <XmppStatusBadge />
          </div>

          {/* User Info */}
          {user && (
            <div className="rounded-xl p-4 space-y-3"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
              <p className="text-xs font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}>
                Session Info
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Username</span>
                  <span className="font-mono" style={{ color: 'var(--accent-blue)' }}>
                    {user.username}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Email</span>
                  <span style={{ color: 'var(--text-primary)' }}>{user.email}</span>
                </div>
                {xmppAddress && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>XMPP JID</span>
                    <span className="font-mono text-xs" style={{ color: 'var(--accent-green)' }}>
                      {xmppAddress}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error display */}
          {xmppStatus === 'error' && xmppError && (
            <div className="mt-4 rounded-lg p-3 text-sm"
              style={{
                background: 'rgba(252,129,129,0.1)',
                border: '1px solid rgba(252,129,129,0.3)',
                color: 'var(--accent-red)',
              }}>
              XMPP Error: {xmppError}
            </div>
          )}

          {/* Next Step */}
          <div className="mt-6 rounded-xl p-4"
            style={{
              background: 'rgba(99,179,237,0.05)',
              border: '1px solid rgba(99,179,237,0.15)',
            }}>
            <p className="text-xs font-medium" style={{ color: 'var(--accent-blue)' }}>
              ✓ Step 2.2 Complete
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Main Chat UI (rooms, messages, ephemeral mode) will be built in Step 2.3
              after you verify the connection status above shows "Connected".
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
