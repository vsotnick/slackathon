import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useChatStore } from '../store/chatStore';

interface CreateRoomModalProps {
  onClose: () => void;
  initialIsPrivate?: boolean;
}

export function CreateRoomModal({ onClose, initialIsPrivate = false }: CreateRoomModalProps) {
  const createRoom = useChatStore((s) => s.createRoom);

  const [name, setName]           = useState('');
  const [description, setDesc]    = useState('');
  const [isPrivate]               = useState(initialIsPrivate);
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);

  // Auto-focus name field on open
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const nameValid = /^[a-zA-Z0-9_-]{2,64}$/.test(name);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!nameValid || loading) return;

    setError(null);
    setLoading(true);
    try {
      await createRoom(name.trim().toLowerCase(), description.trim() || undefined, isPrivate);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  return (
    // ── Backdrop ────────────────────────────────────────────────────────────
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      {/* ── Panel — stop click propagation so backdrop close doesn't trigger ── */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420,
          background: '#161b27',
          border: '1px solid rgba(99,102,241,0.25)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.3px' }}>
              Create a Channel
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
              Channels are where your team communicates
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 7,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.04)',
              color: '#64748b', fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'inherit', lineHeight: 1,
              transition: 'all 0.15s',
            }}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px' }}>

          {/* Name field */}
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600,
              color: '#94a3b8', marginBottom: 6, letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}>
              Channel Name <span style={{ color: '#f87171' }}>*</span>
            </label>
            <div style={{
              display: 'flex', alignItems: 'center',
              background: '#1a1e2a',
              border: `1.5px solid ${name && !nameValid ? 'rgba(239,68,68,0.5)' : name && nameValid ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 9, overflow: 'hidden',
              transition: 'border-color 0.15s',
            }}>
              <span style={{ padding: '0 10px 0 12px', color: '#475569', fontSize: 14, userSelect: 'none' }}>
                #
              </span>
              <input
                ref={nameRef}
                id="create-room-name"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                placeholder="e.g. design-team"
                maxLength={64}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 14, color: '#e2e8f0', padding: '10px 12px 10px 0',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 5 }}>
              Lowercase letters, numbers,{' '}
              <code style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 3, padding: '1px 4px' }}>-</code>{' '}
              and{' '}
              <code style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 3, padding: '1px 4px' }}>_</code>.
              {' '}2–64 characters.
            </div>
          </div>

          {/* Description field */}
          <div style={{ marginBottom: 20 }}>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600,
              color: '#94a3b8', marginBottom: 6, letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}>
              Description <span style={{ color: '#475569' }}>(optional)</span>
            </label>
            <input
              id="create-room-description"
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="What's this channel about?"
              maxLength={500}
              style={{
                width: '100%', background: '#1a1e2a',
                border: '1.5px solid rgba(255,255,255,0.08)',
                borderRadius: 9, padding: '10px 12px',
                fontSize: 14, color: '#e2e8f0', outline: 'none',
                fontFamily: 'inherit', boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)'; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
            />
          </div>


          {/* Error */}
          {error && (
            <div style={{
              marginBottom: 16, padding: '9px 12px', borderRadius: 8,
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.25)',
              fontSize: 13, color: '#f87171',
            }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '9px 18px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'transparent', color: '#94a3b8',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.15s',
                opacity: loading ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              id="create-room-submit"
              type="submit"
              disabled={!nameValid || loading}
              style={{
                padding: '9px 20px', borderRadius: 8,
                border: 'none',
                background: nameValid && !loading
                  ? 'linear-gradient(135deg,#3b82f6,#6366f1)'
                  : 'rgba(99,102,241,0.25)',
                color: nameValid && !loading ? '#fff' : '#64748b',
                fontSize: 13, fontWeight: 600, cursor: nameValid && !loading ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', gap: 7,
              }}
            >
              {loading ? (
                <>
                  <span style={{
                    width: 12, height: 12, borderRadius: '50%',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff',
                    animation: 'spin 0.7s linear infinite',
                    display: 'inline-block',
                    flexShrink: 0,
                  }} />
                  Creating…
                </>
              ) : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>

      {/* Spinner keyframe — injected once */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
