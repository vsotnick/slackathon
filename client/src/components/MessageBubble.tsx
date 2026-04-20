import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Edit2, Trash2, Reply, SmilePlus } from 'lucide-react';
import { useChatStore } from '../store/chatStore';
import type { Message } from '../types/chat';

// ── Avatar color map (consistent across the app) ──────────────────────────
const AVATAR_COLORS: Record<string, string> = {
  alice:   'linear-gradient(135deg,#3b82f6,#2563eb)',
  bob:     'linear-gradient(135deg,#a855f7,#7c3aed)',
  charlie: 'linear-gradient(135deg,#475569,#334155)',
};
const NAME_COLORS: Record<string, string> = {
  alice:   '#60a5fa',
  bob:     '#c084fc',
  charlie: '#94a3b8',
};
function avatarColor(name: string) {
  return AVATAR_COLORS[name] ?? 'linear-gradient(135deg,#3b82f6,#6366f1)';
}
function nameColor(name: string) {
  return NAME_COLORS[name] ?? '#93c5fd';
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const POPULAR_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '👀'];

// ── Ephemeral bubble state machine ─────────────────────────────────────────
// State transitions:
//  locked   → (hold)             → revealed
//  revealed → (release/leave)    → countdown
//  countdown→ (hold again)       → revealed   [Fix 2: cancellable timer]
//  countdown→ (timer expires)    → [removed via retractMessage]
//  locked   → (copy button)      → countdown  [Fix 3: clipboard shortcut]
type EphemeralPhase = 'locked' | 'revealed' | 'countdown';

function EphemeralBubble({ message, isOwn }: { message: Message; isOwn: boolean }) {
  const burnEphemeral = useChatStore((s) => s.burnEphemeral);
  const activeChat    = useChatStore((s) => s.activeChat);
  const [phase, setPhase]   = useState<EphemeralPhase>('locked');
  const [count, setCount]   = useState(5);
  const [copied, setCopied] = useState(false);

  // Live TTL countdown shown on the locked bubble
  const [ttlSecs, setTtlSecs] = useState(() =>
    message.expiresAt ? Math.max(0, Math.floor((message.expiresAt - Date.now()) / 1000)) : 120
  );
  useEffect(() => {
    if (!message.expiresAt) return;
    const id = setInterval(() => {
      setTtlSecs(Math.max(0, Math.floor((message.expiresAt! - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [message.expiresAt]);

  const isDm = activeChat?.type === 'dm';

  // Fix 2: store the interval ID so we can cancel the countdown on re-hold
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdingRef  = useRef(false);

  const startDestruction = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    let c = 5;
    setCount(c);
    intervalRef.current = setInterval(() => {
      c -= 1;
      if (c <= 0) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        burnEphemeral(message.id, message.roomJid, isDm);
      } else {
        setCount(c);
      }
    }, 1000);
  }, [message.id, message.roomJid, isDm, burnEphemeral]);

  const reveal = () => {
    if (phase === 'countdown') {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      holdingRef.current = true;
      setPhase('revealed');
      return;
    }
    if (phase !== 'locked') return;
    holdingRef.current = true;
    setPhase('revealed');
  };

  const release = () => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    if (phase !== 'revealed') return;
    setPhase('countdown');
    startDestruction();
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(message.body).then(() => {
      setCopied(true);
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setTimeout(() => {
        burnEphemeral(message.id, message.roomJid, isDm);
      }, 400);
    }).catch(() => {});
  };

  const bubbleStyle: React.CSSProperties = {
    margin: isOwn ? '3px 0 3px auto' : '3px auto 3px 0',
    maxWidth: '68%',
    borderRadius: 12,
    padding: '12px 14px',
    background: 'rgba(15,10,5,0.85)',
    border: '1px solid rgba(249,115,22,0.4)',
    boxShadow: '0 0 20px rgba(249,115,22,0.12), inset 0 0 30px rgba(249,115,22,0.03)',
    cursor: phase === 'locked' ? 'pointer' : 'default',
    userSelect: 'none',
    position: 'relative',
  };

  return (
    <div
      style={bubbleStyle}
      onMouseDown={reveal}
      onMouseUp={release}
      onMouseLeave={release}
      onTouchStart={reveal}
      onTouchEnd={release}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: '#fb923c',
          background: 'rgba(249,115,22,0.12)',
          border: '1px solid rgba(249,115,22,0.25)',
          borderRadius: 4, padding: '2px 8px',
        }}>
          🔥 Ephemeral
        </span>
        <span style={{ fontSize: 11.5, color: '#64748b' }}>
          {message.senderName} · {formatTime(message.timestamp)}
        </span>
      </div>

      {/* Content area */}
      <div style={{
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(249,115,22,0.15)',
        borderRadius: 8,
        padding: '16px 14px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        minHeight: 72,
        justifyContent: 'center',
        position: 'relative',
      }}>
        {phase === 'locked' && (
          <>
            <span style={{ fontSize: 26, filter: 'drop-shadow(0 0 10px #f97316)' }}>🔥</span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: '#fdba74', textShadow: '0 0 20px rgba(249,115,22,0.5)' }}>
              Press and hold to decrypt
            </span>
            <span style={{ fontSize: 11, color: '#92400e' }}>
              hold to reveal · auto-destroys in{' '}
              <span style={{ color: '#fb923c', fontWeight: 600 }}>
                {Math.floor(ttlSecs / 60)}:{String(ttlSecs % 60).padStart(2, '0')}
              </span>
            </span>
          </>
        )}

        {phase === 'revealed' && (
          <>
            <span style={{ fontSize: 13.5, color: '#fde68a', lineHeight: 1.55, textAlign: 'center' }}>
              {message.body}
            </span>
            <span style={{ fontSize: 11, color: '#f97316', marginTop: 4 }}>
              Release to destroy
            </span>
          </>
        )}

        {phase === 'countdown' && (
          <>
            <span style={{ fontSize: 13.5, color: '#fde68a', lineHeight: 1.55, textAlign: 'center' }}>
              {message.body}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#f97316', lineHeight: 1 }}>
                {count}s
              </span>
              <span style={{ fontSize: 12, color: '#fdba74' }}>
                {copied ? '✓ Copied' : 'Grace Period - Hold to pause'}
              </span>
            </div>

            {/* Post-Read Copy Button */}
            <button
              id={`ephemeral-copy-${message.id}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleCopy}
              title="Copy secret to clipboard, then destroy immediately"
              style={{
                position: 'absolute', top: 8, right: 8,
                width: 26, height: 26, borderRadius: 6,
                border: '1px solid rgba(249,115,22,0.25)',
                background: 'rgba(249,115,22,0.08)',
                color: copied ? '#4ade80' : '#fb923c',
                fontSize: 13, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
                fontFamily: 'inherit',
              }}
            >
              {copied ? '✓' : '📋'}
            </button>
          </>
        )}

      </div>
    </div>
  );
}

// ── Auth-protected File Attachment ──────────────────────────────────────────
function FileAttachment({ message }: { message: Message }) {
  const jwt = useChatStore((s) => s.jwt);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!message.fileId || !jwt) return;
    
    let active = true;
    
    fetch(`/api/files/${message.fileId}`, {
      headers: { Authorization: `Bearer ${jwt}` }
    })
    .then((res) => {
      if (!res.ok) throw new Error('File fetch failed');
      return res.blob();
    })
    .then((blob) => {
      if (!active) return;
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      setLoading(false);
    })
    .catch((err) => {
      console.error('File load error:', err);
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.fileId, jwt]);

  const isImage = message.mimeType?.startsWith('image/');
  
  if (loading) {
    return <div style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>⏳ Loading attachment…</div>;
  }

  if (!blobUrl) {
    return <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>❌ Attachment unavailable</div>;
  }

  if (isImage) {
    return (
      <div className="flex flex-col w-fit mt-2">
        <div className="relative inline-block">
          <img
            src={blobUrl}
            alt={message.fileName}
            style={{ maxWidth: 250, maxHeight: 250, borderRadius: 8, objectFit: 'contain', display: 'block' }}
          />
          <a
            href={blobUrl}
            download={message.fileName}
            title="Download Image"
            className="absolute top-1.5 right-1.5 bg-black/65 text-white py-1 px-2 rounded-md text-xs no-underline backdrop-blur-sm opacity-0 transition-opacity duration-200"
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => {
              if (e.currentTarget.parentElement?.querySelector(':hover') !== e.currentTarget) {
                e.currentTarget.style.opacity = '0';
              }
            }}
          >
            ⬇️
          </a>
          <style dangerouslySetInnerHTML={{__html: `
            div.relative:hover > a[title="Download Image"] { opacity: 1 !important; }
          `}} />
        </div>
        <span className="text-xs text-gray-400 truncate max-w-[250px] mt-1 px-1">
          {message.fileName}
        </span>
      </div>
    );
  }

  return (
    <a href={blobUrl} download={message.fileName} style={{
      display: 'flex', alignItems: 'center', gap: 10, marginTop: 8,
      background: 'rgba(0,0,0,0.2)', padding: '10px 14px',
      borderRadius: 10, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.08)'
    }}>
      <div style={{ fontSize: 24 }}>📎</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message.fileName}
        </div>
        <div style={{ fontSize: 11, color: '#64748b' }}>Download attachment</div>
      </div>
    </a>
  );
}

// ── Standard text bubble ──────────────────────────────────────────────────
function StandardBubble({ message, isOwn, showAvatar }: {
  message: Message;
  isOwn: boolean;
  showAvatar: boolean;
}) {
  const retractMessage = useChatStore((s) => s.retractMessage);
  const editMessage = useChatStore((s) => s.editMessage);
  const setReplyTarget = useChatStore((s) => s.setReplyTarget);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.body);
  // Portal-based hover menu: track position relative to viewport so the menu
  // renders in document.body and can NEVER be clipped by sibling rows.
  // We use refs (not state) for hover tracking to avoid re-render thrash.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMenuHoveredRef = useRef(false);
  const toggleReaction = useChatStore((s) => s.toggleReaction);
  const currentUser = useChatStore((s) => s.myNick);

  const scheduleShow = (pos: { x: number; y: number }) => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    showTimerRef.current = setTimeout(() => setMenuPos(pos), 350);
  };

  const scheduleHide = () => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!isMenuHoveredRef.current) setMenuPos(null);
    }, 80);
  };

  const cancelHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };

  const submitEdit = () => {
    if (editText.trim() && editText !== message.body) {
      editMessage(message.roomJid, message.id, editText);
    }
    setIsEditing(false);
  };

  // Portal hover menu — rendered into document.body so it's never clipped by siblings
  const hoverMenuPortal = !isEditing && message.type !== 'file_ref' && menuPos
    ? createPortal(
        <div
          style={{
            position: 'fixed',
            top: menuPos.y + 4,  // 4px below the bottom of the message row
            left: menuPos.x,
            transform: 'translateX(-50%)',  // centred horizontally on the anchor point
            zIndex: 99999,
            padding: '0 0 4px 0', // invisible padding below for mouse bridge
          }}
          onMouseEnter={() => { isMenuHoveredRef.current = true; cancelHide(); }}
          onMouseLeave={() => { isMenuHoveredRef.current = false; setMenuPos(null); setShowReactionPicker(false); }}
        >
          {/* Reaction quick-pick strip — appears BELOW the toolbar */}
          {showReactionPicker && (
            <div className="flex bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 mt-1 gap-1.5 shadow-xl">
              {POPULAR_REACTIONS.map((em) => (
                <button
                  key={em}
                  onClick={() => { toggleReaction(message.roomJid, message.id, em, currentUser ?? ''); setShowReactionPicker(false); }}
                  className="text-lg hover:scale-125 transition-transform cursor-pointer"
                  title={em}
                >{em}</button>
              ))}
            </div>
          )}
          <div className="flex bg-gray-800 border border-gray-700 shadow-xl rounded-lg px-2 py-1 items-center gap-2">
            <button title="Add Reaction" className="flex items-center" onClick={() => setShowReactionPicker((v) => !v)}>
              <SmilePlus className="w-4 h-4 text-gray-400 hover:text-white cursor-pointer transition-colors" />
            </button>
            <button title="Reply" className="flex items-center" onClick={() => { setReplyTarget(message); setMenuPos(null); }}>
              <Reply className="w-4 h-4 text-gray-400 hover:text-white cursor-pointer transition-colors" />
            </button>
            {isOwn && (
              <>
                <button title="Edit" className="flex items-center" onClick={() => { setIsEditing(true); setMenuPos(null); }}>
                  <Edit2 className="w-4 h-4 text-gray-400 hover:text-white cursor-pointer transition-colors" />
                </button>
                <button title="Delete" className="flex items-center" onClick={() => { setShowDeleteConfirm(true); setMenuPos(null); }}>
                  <Trash2 className="w-4 h-4 text-gray-400 hover:text-white cursor-pointer transition-colors" />
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  const deleteConfirmPortal = showDeleteConfirm
    ? createPortal(
        <div 
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div 
            className="flex flex-col rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4"
            style={{ background: '#161a26', border: '1px solid rgba(239,68,68,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-100 mb-2">Delete Message?</h3>
            <p className="text-gray-400 text-sm mb-6 leading-relaxed">
              Are you sure you want to delete this message? This action cannot be undone and it will be removed for everyone in the room.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded text-sm font-semibold text-gray-300 hover:text-white hover:bg-gray-800 transition-colors focus:outline-none"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  retractMessage(message.roomJid, message.id);
                  setShowDeleteConfirm(false);
                }}
                className="px-4 py-2 rounded text-sm font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 transition-colors focus:outline-none"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  // Phase 2.9 UX Fix 6: Clickable Username Context Menu
  const [showUserMenu, setShowUserMenu] = useState(false);
  const users = useChatStore(s => s.users);
  const activeChat = useChatStore(s => s.activeChat);
  const setActiveDm = useChatStore(s => s.setActiveDm);
  const userToken = useChatStore(s => s.jwt);
  const addToast = useChatStore(s => s.addToast);
  const xmpp = useChatStore(s => s.xmpp);

  const handleUsernameAction = async (action: 'dm' | 'invite') => {
    setShowUserMenu(false);
    const targetUser = users.find(u => u.username === message.sender);
    if (!targetUser) return;

    if (action === 'dm') {
      setActiveDm(targetUser);
    } else if (action === 'invite') {
      if (activeChat?.type !== 'room') {
        addToast('You must be in a room to invite someone.', 'error');
        return;
      }
      try {
        const res = await fetch(`/api/rooms/${activeChat.id}/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
          body: JSON.stringify({ userId: targetUser.id })
        });
        if (!res.ok) throw new Error((await res.json()).message || 'Invite failed');
        addToast(`Invited ${targetUser.username} to the room.`, 'success');

        if (xmpp) {
          const { xml } = await import('@xmpp/client');
          xmpp.send(xml('message', { to: targetUser.jid, type: 'chat', id: crypto.randomUUID() }, 
            xml('body', {}, JSON.stringify({ type: 'system_refresh_rooms' }))
          )).catch(console.error);
        }
      } catch (e: any) {
        addToast(e.message, 'error');
      }
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isOwn ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        padding: '2px 0',
        minWidth: 0,
        width: '100%',
      }}
    >
      {hoverMenuPortal}
      {deleteConfirmPortal}
      
      <div
        ref={rowRef}
        style={{
          display: 'flex',
          flexDirection: isOwn ? 'row-reverse' : 'row',
          alignItems: 'flex-end',
          gap: 8,
          maxWidth: '100%',
        }}
        onMouseEnter={(e) => {
          cancelHide();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          scheduleShow({
            x: isOwn ? rect.right - 60 : rect.left + 60,
            y: rect.bottom,  // anchor to bottom of the row
          });
        }}
        onMouseLeave={scheduleHide}
      >
      {/* Avatar */}
      <div style={{ width: 34, flexShrink: 0 }}>
        {showAvatar && (
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: isOwn ? 'linear-gradient(135deg,#3b82f6,#6366f1)' : avatarColor(message.sender),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: '#fff',
          }}>
            {message.senderName[0].toUpperCase()}
          </div>
        )}
      </div>

      {/* Bubble content - constrained to 68% and able to shrink below that */}
      <div style={{ maxWidth: '68%', minWidth: 0, minHeight: 0 }}>
        {showAvatar && (
          <div style={{
            fontSize: 12.5, marginBottom: 3,
            display: 'flex', gap: 7, alignItems: 'baseline',
            flexDirection: isOwn ? 'row-reverse' : 'row',
          }}>
            <div className="relative">
              <span 
                style={{ fontWeight: 600, color: isOwn ? '#93c5fd' : nameColor(message.sender) }}
                className={!isOwn ? "cursor-pointer hover:underline" : ""}
                onClick={() => !isOwn && setShowUserMenu(!showUserMenu)}
              >
                {isOwn ? 'You' : message.senderName}
              </span>
              
              {showUserMenu && !isOwn && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-gray-800 border border-gray-700 rounded-md shadow-xl z-20 overflow-hidden flex flex-col">
                  <button onClick={() => handleUsernameAction('dm')} className="text-left px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors border-b border-gray-700">
                    Send Direct Message
                  </button>
                  <button onClick={() => handleUsernameAction('invite')} className="text-left px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors">
                    Invite to active Room
                  </button>
                </div>
              )}
            </div>
            <span style={{ fontSize: 11, color: '#475569' }} className="flex items-center gap-1">
              {formatTime(message.timestamp)}
              {message.isEdited && <span className="text-[10px] text-gray-500 ml-1 select-none italic">(edited)</span>}
            </span>
          </div>
        )}

        <div
          className="message-text relative"
          style={{
            background: isOwn
              ? 'linear-gradient(135deg, rgba(59,130,246,0.25), rgba(99,102,241,0.25))'
              : '#1a1e2a',
            border: `1px solid ${isOwn ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: isOwn
              ? '14px 14px 4px 14px'
              : '14px 14px 14px 4px',
            padding: '8px 12px',
            fontSize: 14,
            color: '#cbd5e1',
            lineHeight: 1.55,
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            minWidth: 0,
          }}
        >
          {/* Phase 2.10: Reply block preview render */}
          {message.replyTo && message.replyText && !isEditing && (
            <div className="bg-black/20 border-l-[3px] border-indigo-400/50 pl-2 pr-1 pt-1 pb-1.5 mb-2 rounded-r-md text-[12px] opacity-70">
              <span className="block text-indigo-300 font-semibold italic text-[10px] mb-0.5">Replied Message</span>
              <div className="text-gray-300 leading-snug line-clamp-2 overflow-hidden prose prose-invert prose-sm prose-p:my-0 prose-p:leading-snug">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.replyText}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {isEditing ? (
            <div className="flex flex-col gap-2 min-w-[200px]">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitEdit();
                  } else if (e.key === 'Escape') {
                    setIsEditing(false);
                    setEditText(message.body);
                  }
                }}
                className="w-full bg-black/30 border border-indigo-500/50 rounded p-2 text-sm text-white resize-none outline-none focus:border-indigo-400"
                rows={Math.min(5, editText.split('\n').length)}
              />
              <div className="flex justify-end gap-2 text-xs">
                <button onClick={() => { setIsEditing(false); setEditText(message.body); }} className="text-gray-400 hover:text-white">Cancel</button>
                <button onClick={submitEdit} className="text-indigo-400 font-semibold hover:text-indigo-300">Save (Enter)</button>
              </div>
            </div>
          ) : (
            <>
              {message.type !== 'file_ref' && (
                <div className="prose prose-sm prose-invert max-w-none prose-p:leading-normal prose-pre:bg-gray-900/80 prose-pre:border prose-pre:border-gray-700/50 prose-a:text-indigo-400 prose-headings:mb-2 prose-headings:mt-0 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 text-gray-300">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.body}
                  </ReactMarkdown>
                </div>
              )}
              {message.type === 'file_ref' && <FileAttachment message={message} />}
            </>
          )}
        </div>
        {/* Reaction strip */}
        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
            {Object.entries(message.reactions).map(([emoji, users]) => (
              <button
                key={emoji}
                onClick={() => toggleReaction(message.roomJid, message.id, emoji, currentUser ?? '')}
                className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors cursor-pointer
                  ${users.includes(currentUser ?? '')
                    ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                    : 'bg-gray-800/60 border-gray-700/50 text-gray-400 hover:border-indigo-500/30 hover:text-gray-200'
                  }`}
                title={users.join(', ')}
              >
                <span>{emoji}</span>
                <span className="font-medium">{users.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

// ── Public API ─────────────────────────────────────────────────────────────
interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  /** Show avatar + sender name (false when same sender as previous msg) */
  showAvatar: boolean;
  isUnread: boolean;
}

export function MessageBubble({ message, isOwn, showAvatar }: MessageBubbleProps) {
  // Fix 9c: if the ephemeral TTL has elapsed, render an expired placeholder.
  // This prevents anyone from reading the message after 15 minutes, even if
  // the local Zustand state still has the message (e.g. browser tab was left open).
  if (message.type === 'ephemeral' && message.expiresAt && message.expiresAt < Date.now()) {
    return (
      <div style={{
        margin: isOwn ? '3px 0 3px auto' : '3px auto 3px 0',
        maxWidth: '68%', borderRadius: 12, padding: '10px 14px',
        background: 'rgba(15,10,5,0.5)',
        border: '1px solid rgba(100,100,100,0.2)',
        color: '#475569', fontSize: 12, fontStyle: 'italic',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontSize: 14 }}>🔥</span>
        <span>Ephemeral message expired</span>
      </div>
    );
  }

  return (
    <div style={{ opacity: 1, transition: 'opacity 0.3s' }}>
      {message.type === 'ephemeral' ? (
        <EphemeralBubble message={message} isOwn={isOwn} />
      ) : (
        <StandardBubble message={message} isOwn={isOwn} showAvatar={showAvatar} />
      )}
    </div>
  );
}
