import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { Shield } from 'lucide-react';
import { CreateRoomModal } from './CreateRoomModal';
import { SearchModal } from './SearchModal';
import { ProfileModal } from './ProfileModal';
import { PublicRoomsModal } from './PublicRoomsModal';
import { FriendRequestPromptModal } from './FriendRequestPromptModal';
import type { Message, Room, ChatUser } from '../types/chat';

// Stable empty array — see MessageList.tsx for full explanation.
const EMPTY_MESSAGES: Message[] = [];

interface SidebarProps {
  width: number;
}

const AVATAR_COLORS: Record<string, string> = {
  vsot:    'linear-gradient(135deg,#3b82f6,#6366f1)',
};

function getAvatarColor(name: string) {
  return AVATAR_COLORS[name] ?? 'linear-gradient(135deg,#6366f1,#4f46e5)';
}

const PresenceDot = ({ status }: { status: 'online' | 'away' | 'offline' }) => {
  const styles: Record<string, React.CSSProperties> = {
    online:  { background: '#22c55e', boxShadow: '0 0 6px #22c55e' },
    away:    { background: '#f59e0b' },
    offline: { background: '#475569' },
  };
  return (
    <span
      style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        display: 'inline-block', ...styles[status],
      }}
    />
  );
};

// ── Unread detection ───────────────────────────────────────────────────────
// Server-side: unread = watermark_seq - last_read_seq (survives across sessions)
// Client-side: once history is loaded, use local timestamp comparison for accuracy
function useUnreadCount(room: Room): number {
  const msgs      = useChatStore((s) => s.messages[room.jid] ?? EMPTY_MESSAGES);
  const lastRead  = useChatStore((s) => s.lastReadAts[room.jid] ?? null);

  // If we have local messages and the user has read some, count by timestamp
  if (msgs.length > 0 && lastRead) {
    return msgs.filter((m) => m.timestamp > lastRead).length;
  }

  // Server-side unread: watermark_seq tracks total messages, last_read_seq tracks
  // how far this user has read. The difference is the unread count.
  const watermark = room.watermark_seq ?? 0;
  const lastReadSeq = room.last_read_seq ?? 0;
  if (watermark > lastReadSeq) return watermark - lastReadSeq;

  // If we have local messages but no lastRead (first visit this session), all are unread
  if (msgs.length > 0 && !lastRead) return msgs.length;

  return 0;
}

// Track unread DMs using purely local timestamp comparison since there is no room.watermark_seq for 1-on-1s.
function useUnreadDmCount(jid: string): number {
  const msgs      = useChatStore((s) => s.messages[jid] ?? EMPTY_MESSAGES);
  const lastRead  = useChatStore((s) => s.lastReadAts[jid] ?? null);

  if (msgs.length > 0) {
    if (!lastRead) return msgs.length;
    return msgs.filter((m) => m.timestamp > lastRead).length;
  }
  return 0;
}

// Per-room button — separate component so the hook call is per-item
function RoomButton({ room, isActive, onClick }: {
  room: Room;
  isActive: boolean;
  onClick: () => void;
}) {
  const count = useUnreadCount(room);
  const hasUnread = count > 0 && !isActive;

  return (
    <button
      key={room.jid}
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 7,
        padding: '5px 8px', borderRadius: 6,
        fontSize: 13.5, cursor: 'pointer', border: 'none',
        fontFamily: 'inherit', textAlign: 'left',
        background: isActive ? 'rgba(59,130,246,0.15)' : 'transparent',
        color: isActive ? '#93c5fd' : hasUnread ? '#e2e8f0' : '#94a3b8',
        fontWeight: isActive || hasUnread ? 700 : 400,
        transition: 'background 0.15s',
      }}
    >
      <span style={{ color: isActive ? '#93c5fd' : hasUnread ? '#60a5fa' : '#475569', fontSize: 13 }}>#</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {room.name}
      </span>
      {hasUnread && (
        <span style={{
          background: '#3b82f6', color: '#fff',
          fontSize: 10, fontWeight: 700, borderRadius: 10,
          padding: '1px 6px', minWidth: 18, textAlign: 'center',
          flexShrink: 0,
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// Per-DM button — separate component to satisfy React hook rules for useUnreadDmCount
function DmButton({ chatUser, isActive, onClick }: {
  chatUser: any;
  isActive: boolean;
  onClick: () => void;
}) {
  const presence = chatUser.status;
  const unreadCount = useUnreadDmCount(chatUser.jid);
  const hasUnread = unreadCount > 0 && !isActive;

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px', borderRadius: 6,
        fontSize: 13, cursor: 'pointer', border: 'none',
        fontFamily: 'inherit', textAlign: 'left',
        background: isActive ? 'rgba(59,130,246,0.15)' : 'transparent',
        color: isActive ? '#93c5fd' : hasUnread ? '#e2e8f0' : '#94a3b8',
        transition: 'background 0.15s',
        fontWeight: isActive || hasUnread ? 700 : 400,
      }}
    >
      <div style={{
        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, color: '#fff',
        background: getAvatarColor(chatUser.username),
        position: 'relative',
      }}>
        {chatUser.username[0].toUpperCase()}
        <span style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 8, height: 8, borderRadius: '50%',
          border: '1.5px solid #111318',
          background: presence === 'online' ? '#22c55e' : presence === 'away' ? '#f59e0b' : '#475569',
          boxShadow: presence === 'online' ? '0 0 5px #22c55e' : 'none',
        }} />
      </div>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {chatUser.username}
      </span>
      {hasUnread && (
        <span style={{
          background: '#3b82f6', color: '#fff',
          fontSize: 10, fontWeight: 700, borderRadius: 10,
          padding: '1px 6px', minWidth: 18, textAlign: 'center',
          flexShrink: 0,
        }}>
          {unreadCount}
        </span>
      )}
    </button>
  );
}

export function Sidebar({ width }: SidebarProps) {
  const rooms         = useChatStore((s) => s.rooms);
  const roomsLoading  = useChatStore((s) => s.roomsLoading);
  const activeRoom    = useChatStore((s) => s.activeRoomJid);
  const setRoom       = useChatStore((s) => s.setActiveRoom);
  const setDm         = useChatStore((s) => s.setActiveDm);
  const users         = useChatStore((s) => s.users);
  const user          = useAuthStore((s) => s.user);
  const logout        = useAuthStore((s) => s.logout);
  const xmppStatus    = useChatStore((s) => s.status);
  const navigate      = useNavigate();

  const [createModalMode, setCreateModalMode] = useState<'public' | 'private' | null>(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showPublicRoomsModal, setShowPublicRoomsModal] = useState(false);

  // Refresh rooms list after joining a public room
  const fetchRooms = useChatStore((s) => s.fetchRooms);

  const mucRooms = rooms.filter((r) => r.kind === 'muc');
  // Fix 5: split by is_private for sidebar grouping
  const publicRooms  = mucRooms.filter((r) => !r.is_private);
  const privateRooms = mucRooms.filter((r) => r.is_private);

  // Fix 6b/6c: only show users who have an active DM conversation, fallback to bare info if missing
  const activeDms = useChatStore((s) => s.activeDms);
  const friendships = useChatStore((s) => s.friendships);
  
  const activeDmUsers = activeDms.map(jid => {
    let u = users.find(u => u.jid === jid);
    if (!u) {
      const f = friendships.find(f => f.jid === jid);
      if (f) u = { id: f.user_id, username: f.username, email: '', role: 'user', jid: f.jid, status: 'online' }; 
    }
    if (!u) {
      u = { id: jid, username: jid.split('@')[0], email: '', role: 'user', jid: jid, status: 'offline' };
    }
    return u;
  });

  return (
    <>
      <aside
        style={{
          width,
          minWidth: width,
          maxWidth: width,
          height: '100%',                                  // ← fill the full viewport height
          background: '#111318',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Workspace header ── */}
        <div style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'default',
          userSelect: 'none',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'linear-gradient(135deg,#3b82f6,#6366f1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 16, color: '#fff',
          }}>
            S
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', letterSpacing: '-0.3px' }}>
              SLACKATHON
            </div>
            <div style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
                background: xmppStatus === 'online' ? '#22c55e' : '#f59e0b',
                boxShadow: xmppStatus === 'online' ? '0 0 6px #22c55e' : 'none',
              }} />
              servera.local
            </div>
          </div>
          
          {/* Quick actions line */}
          <button 
            onClick={() => setShowSearchModal(true)}
            className="ml-auto w-8 h-8 rounded-full bg-gray-800/50 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors duration-200 outline-none"
            title="Search"
          >
            🔍
          </button>
        </div>

        {/* ── Scrollable nav ── */}
        {/* Fix 1: flex-1 lets this grow, min-h-0 prevents flex blowout, overflow-y-auto enables scroll */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '12px 8px' }}>

          {/* ── PUBLIC ROOMS ── */}
          <div style={{ marginBottom: 4 }}>
            {/* Section header row with "+" button */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 8px', marginBottom: 4,
            }}>
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                color: '#475569', textTransform: 'uppercase',
              }}>
                Public Rooms
                {roomsLoading && (
                  <span style={{ marginLeft: 6, opacity: 0.5 }}>…</span>
                )}
              </span>

              <div style={{ display: 'flex', gap: 4 }}>
                {/* Browse public rooms button */}
                <button
                  id="sidebar-browse-rooms-btn"
                  onClick={() => setShowPublicRoomsModal(true)}
                  title="Browse public rooms"
                  style={{
                    width: 18, height: 18, borderRadius: 4,
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'transparent',
                    color: '#475569', fontSize: 11, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'inherit', lineHeight: 1,
                    transition: 'all 0.15s', padding: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(99,102,241,0.15)';
                    e.currentTarget.style.color = '#818cf8';
                    e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#475569';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                  }}
                >
                  🔭
                </button>

                {/* Create channel button */}
                <button
                  id="sidebar-create-channel-btn"
                onClick={() => setCreateModalMode('public')}
                title="Create a new channel"
                style={{
                  width: 18, height: 18, borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent',
                  color: '#475569', fontSize: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'inherit', lineHeight: 1,
                  transition: 'all 0.15s',
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(99,102,241,0.15)';
                  e.currentTarget.style.color = '#818cf8';
                    e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#475569';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                }}
              >
                +
              </button>
              </div>
            </div>

            {/* Public room list */}
            {roomsLoading && publicRooms.length === 0 ? (
              [0, 1, 2].map((i) => (
                <div key={i} style={{
                  height: 28, borderRadius: 6, marginBottom: 2,
                  background: 'rgba(255,255,255,0.04)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                  opacity: 1 - i * 0.2,
                }} />
              ))
            ) : publicRooms.length === 0 ? (
              <div style={{ padding: '6px 8px', fontSize: 12, color: '#334155' }}>
                No public channels yet
              </div>
            ) : (
              publicRooms.map((room) => (
                <RoomButton
                  key={room.jid}
                  room={room}
                  isActive={room.jid === activeRoom}
                  onClick={() => setRoom(room.jid)}
                />
              ))
            )}
          </div>

          {/* Fix 5: ── PRIVATE ROOMS ── — always visible so users know the section exists */}
          <div style={{ marginTop: 16, marginBottom: 4 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 8px', marginBottom: 4,
            }}>
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                color: '#475569', textTransform: 'uppercase',
              }}>
                🔒 Private Rooms
              </span>
              {/* Feature: Dedicated + button for Private Rooms */}
              <button
                onClick={() => setCreateModalMode('private')}
                title="Create a new private channel"
                style={{
                  width: 18, height: 18, borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent',
                  color: '#475569', fontSize: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'inherit', lineHeight: 1,
                  transition: 'all 0.15s',
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(99,102,241,0.15)';
                  e.currentTarget.style.color = '#818cf8';
                  e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#475569';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                }}
              >
                +
              </button>
            </div>
            {privateRooms.length === 0 ? (
              <div style={{ padding: '4px 8px', fontSize: 11.5, color: '#334155', fontStyle: 'italic' }}>
                No private rooms yet
              </div>
            ) : (
              privateRooms.map((room) => (
                <RoomButton
                  key={room.jid}
                  room={room}
                  isActive={room.jid === activeRoom}
                  onClick={() => setRoom(room.jid)}
                />
              ))
            )}
          </div>

          {/* Fix 6c: ── DIRECT MESSAGES ── — starts empty, populates on send/receive */}
          <div style={{ marginTop: 16 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
              color: '#475569', textTransform: 'uppercase',
              padding: '0 8px', marginBottom: 4,
            }}>
              Direct Messages
            </div>

            {activeDmUsers.length === 0 ? (
              <div style={{ padding: '4px 8px', fontSize: 11.5, color: '#334155', fontStyle: 'italic' }}>
                No active messages yet
              </div>
            ) : (
              activeDmUsers.map((chatUser) => (
                <DmButton
                  key={chatUser.jid}
                  chatUser={chatUser}
                  isActive={activeRoom === chatUser.jid}
                  onClick={() => setDm(chatUser as any)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── User footer ── */}
        <div style={{
          padding: '10px 12px 14px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: '#111318',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}>
          {/* Row 1: avatar + actions */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#1a1e2a',
            border: '1.5px solid rgba(255,255,255,0.08)',
            borderRadius: 10,
            padding: '8px 10px',
          }}>
            {/* Avatar */}
            <div 
              onClick={() => setShowProfileModal(true)}
              title={`${user?.username ?? 'you'}\n${user?.email ?? ''}`}
              style={{
              width: 30, height: 30, borderRadius: 7, flexShrink: 0,
              background: getAvatarColor(user?.username ?? 'vsot'),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: '#fff',
              position: 'relative',
              cursor: 'pointer',
            }}>
              {(user?.username ?? 'V')[0].toUpperCase()}
              <span style={{
                position: 'absolute', bottom: -2, right: -2,
                width: 9, height: 9, borderRadius: '50%',
                border: '2px solid #1a1e2a',
                background: xmppStatus === 'online' ? '#22c55e' : '#475569',
                boxShadow: xmppStatus === 'online' ? '0 0 6px #22c55e' : 'none',
              }} />
            </div>
            
            {/* Spacer to push buttons to the right */}
            <div style={{ flex: 1 }} />
            
            {/* Profile button */}
            <button
              id="sidebar-profile-btn"
              onClick={() => setShowProfileModal(true)}
              title="Profile settings"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(99,102,241,0.12)';
                e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)';
                e.currentTarget.style.color = '#818cf8';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                e.currentTarget.style.color = '#cbd5e1';
              }}
              style={{
                height: 30, padding: '0 10px', borderRadius: 7,
                fontSize: 11, fontWeight: 500,
                color: '#cbd5e1',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.12)',
                cursor: 'pointer', fontFamily: 'inherit',
                flexShrink: 0, whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
            >
              ⚙️
            </button>

            {/* Admin Dashboard Shield */}
            {user?.role === 'admin' && (
              <button
                onClick={() => navigate('/admin')}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-300 border border-indigo-500/20"
                title="Admin Control Plane"
              >
                <Shield size={16} />
              </button>
            )}

            {/* Logout button */}
            <button
              id="sidebar-logout-btn"
              onClick={logout}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
                e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)';
                e.currentTarget.style.color = '#f87171';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                e.currentTarget.style.color = '#cbd5e1';
              }}
              style={{
                height: 30, padding: '0 10px', borderRadius: 7,
                fontSize: 11, fontWeight: 500,
                color: '#cbd5e1',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.12)',
                cursor: 'pointer', fontFamily: 'inherit',
                flexShrink: 0, whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
            >
              Logout
            </button>
          </div>


        </div>
      </aside>


      {/* Modals */}
      {createModalMode && <CreateRoomModal initialIsPrivate={createModalMode === 'private'} onClose={() => setCreateModalMode(null)} />}
      {showSearchModal && (
        <SearchModal onClose={() => setShowSearchModal(false)} />
      )}
      {showProfileModal && (
        <ProfileModal onClose={() => setShowProfileModal(false)} />
      )}
      {showPublicRoomsModal && (
        <PublicRoomsModal
          onClose={() => setShowPublicRoomsModal(false)}
          onJoined={() => { fetchRooms?.(); }}
        />
      )}
      
      <FriendRequestPromptModal />

      {/* Skeleton pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 1; }
        }
      `}</style>
    </>
  );
}
