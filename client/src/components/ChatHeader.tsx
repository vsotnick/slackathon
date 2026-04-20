import { useChatStore } from '../store/chatStore';
import { XmppStatusBadge } from './XmppStatusBadge';

interface ChatHeaderProps {
  aiPanelOpen: boolean;
  onToggleAI: () => void;
}

export function ChatHeader({ aiPanelOpen, onToggleAI }: ChatHeaderProps) {
  const activeChat    = useChatStore((s) => s.activeChat);
  const activeRoomJid = useChatStore((s) => s.activeRoomJid);
  const rooms         = useChatStore((s) => s.rooms);
  const users         = useChatStore((s) => s.users);
  const messages      = useChatStore((s) => s.messages);
  const lastReadAts   = useChatStore((s) => s.lastReadAts);

  const room = rooms.find((r) => r.jid === activeRoomJid);
  const dmUser = activeChat?.type === 'dm' ? users.find((u) => u.jid === activeChat.jid) : null;
  
  const msgs = messages[activeRoomJid] ?? [];
  const lastRead = lastReadAts[activeRoomJid] ?? null;
  const unreadCount = lastRead
    ? msgs.filter((m) => m.timestamp > lastRead).length
    : msgs.length;

  return (
    <header style={{
      padding: '0 20px',
      height: 52,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: 'rgba(13,15,20,0.8)',
      backdropFilter: 'blur(12px)',
      flexShrink: 0,
      zIndex: 10,
    }}>
      {/* Room info */}
      <div style={{ flex: 1, minWidth: 0, cursor: 'default', userSelect: 'none' }}>
        {activeChat?.type === 'dm' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Avatar */}
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'linear-gradient(135deg,#6366f1,#4f46e5)', // generic blue for now
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 13, color: '#fff'
            }}>
              {activeChat.name[0].toUpperCase()}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
                  @ {activeChat.name}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                 <span style={{
                   width: 6, height: 6, borderRadius: '50%',
                   background: dmUser?.status === 'online' ? '#22c55e' : dmUser?.status === 'away' ? '#f59e0b' : '#475569',
                   boxShadow: dmUser?.status === 'online' ? '0 0 4px #22c55e' : 'none'
                 }} />
                 {dmUser?.status === 'online' ? 'Online' : dmUser?.status === 'away' ? 'Away' : 'Offline'}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
                # {room?.name ?? activeRoomJid.split('@')[0]}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>
              {room?.description ?? ''}
            </div>
          </>
        )}
      </div>

      {/* XMPP status */}
      <XmppStatusBadge compact />

      {/* AI Panel toggle */}
      <button
        onClick={onToggleAI}
        title={aiPanelOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
        style={{
          width: 32, height: 32, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', cursor: 'pointer',
          background: aiPanelOpen
            ? 'rgba(99,102,241,0.2)'
            : 'rgba(255,255,255,0.04)',
          color: aiPanelOpen ? '#818cf8' : '#64748b',
          transition: 'all 0.2s',
          boxShadow: aiPanelOpen ? '0 0 12px rgba(99,102,241,0.25)' : 'none',
          fontFamily: 'inherit',
        }}
      >
        {/* Sparkle / AI icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
        </svg>
      </button>
    </header>
  );
}
