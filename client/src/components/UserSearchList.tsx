import { useState } from 'react';
import { UserPlus, MailPlus } from 'lucide-react';
import { useChatStore } from '../store/chatStore';

/**
 * Shared user search + action list.
 * Used in:
 *  - ContactsPanel   → mode="add-friend"
 *  - RoomMembersList → mode="invite"
 */
interface UserSearchListProps {
  /** Filter out users who are already in the room (for invite mode) */
  excludeUsernames?: string[];
  /** What the primary action button does */
  mode: 'add-friend' | 'invite';
  /** Room id — required when mode === 'invite' */
  roomId?: string;
  /** Called after a successful invite so parent can close the panel */
  onInvited?: () => void;
  placeholder?: string;
}

export function UserSearchList({
  excludeUsernames = [],
  mode,
  roomId,
  onInvited,
  placeholder = 'Search users…',
}: UserSearchListProps) {
  const users       = useChatStore(s => s.users);
  const friendships = useChatStore(s => s.friendships);
  const blockedUsers = useChatStore(s => s.blockedUsers);
  const jwt         = useChatStore(s => s.jwt);
  const sendFriendRequest = useChatStore(s => s.sendFriendRequest);
  const addToast    = useChatStore(s => s.addToast);

  const [query, setQuery]         = useState('');
  const [actingOn, setActingOn]   = useState<string | null>(null);

  const trimmed = query.trim().toLowerCase();

  // Users that match the search and aren't excluded
  const results = trimmed.length < 2 ? [] : users.filter(u => {
    if (!u.username.toLowerCase().includes(trimmed)) return false;
    if (excludeUsernames.includes(u.username)) return false;
    if (mode === 'add-friend') {
      // Hide users already in a friendship or blocked
      if (friendships.some(f => f.user_id === u.id)) return false;
      if (blockedUsers.some(b => b.user_id === u.id)) return false;
    }
    return true;
  });

  const handleAction = async (userId: string) => {
    setActingOn(userId);
    try {
      if (mode === 'add-friend') {
        await sendFriendRequest(userId);
      } else if (mode === 'invite' && roomId) {
        const res = await fetch(`/api/rooms/${roomId}/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ userId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to invite user');

        addToast('User invited to the room!', 'success');

        // Real-time invite sync — push system_refresh_rooms to the invitee
        const targetUser = users.find(u => u.id === userId);
        const xmpp = useChatStore.getState().xmpp;
        if (targetUser && xmpp) {
          const { xml } = await import('@xmpp/client');
          xmpp.send(xml('message', { to: targetUser.jid, type: 'chat', id: crypto.randomUUID() },
            xml('body', {}, JSON.stringify({ type: 'system_refresh_rooms' }))
          )).catch(console.error);
        }

        setQuery('');
        onInvited?.();
      }
    } catch (e: any) {
      addToast(e.message || 'Action failed', 'error');
    } finally {
      setActingOn(null);
    }
  };

  const isInvite = mode === 'invite';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Search input */}
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800/50 border border-slate-700/50 rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-500"
      />

      {/* Results */}
      {trimmed.length >= 2 && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 2,
          maxHeight: 240, overflowY: 'auto',
          background: 'rgba(0,0,0,0.2)', borderRadius: 8,
          padding: results.length > 0 ? 4 : 0,
        }}>
          {results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 12, color: '#475569' }}>
              No users found for "{trimmed}"
            </div>
          ) : results.map(u => (
            <div
              key={u.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 8px', borderRadius: 6,
                background: 'rgba(99,102,241,0.04)',
                border: '1px solid rgba(99,102,241,0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                  background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                }}>
                  {u.username[0].toUpperCase()}
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{u.username}</span>
              </div>

              <button
                onClick={() => handleAction(u.id)}
                disabled={actingOn === u.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 12px', fontSize: 12, fontWeight: 600,
                  borderRadius: 6, border: 'none', cursor: actingOn === u.id ? 'not-allowed' : 'pointer',
                  background: isInvite ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.2)',
                  color: isInvite ? '#34d399' : '#818cf8',
                  opacity: actingOn === u.id ? 0.6 : 1,
                  transition: 'all 0.15s', whiteSpace: 'nowrap',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => { if (actingOn !== u.id) e.currentTarget.style.background = isInvite ? 'rgba(16,185,129,0.25)' : 'rgba(99,102,241,0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isInvite ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.2)'; }}
              >
                {actingOn === u.id ? (
                  <div style={{ width: 11, height: 11, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                ) : isInvite ? (
                  <MailPlus size={13} />
                ) : (
                  <UserPlus size={13} />
                )}
                {actingOn === u.id ? '…' : isInvite ? 'Invite' : 'Add Friend'}
              </button>
            </div>
          ))}
        </div>
      )}

      {trimmed.length > 0 && trimmed.length < 2 && (
        <div style={{ fontSize: 11, color: '#475569', textAlign: 'center', paddingTop: 4 }}>
          Type at least 2 characters to search
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
