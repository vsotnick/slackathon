import { useState } from 'react';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { Settings, MailPlus } from 'lucide-react';
import { ManageRoomModal } from './ManageRoomModal';

export function RoomMembersList() {
  const activeChat    = useChatStore((s) => s.activeChat);
  const roomMembers   = useChatStore((s) => s.roomMembers);
  const users         = useChatStore((s) => s.users);
  const jwt           = useChatStore((s) => s.jwt);
  const addToast      = useChatStore((s) => s.addToast);
  const sendFriendRequest = useChatStore((s) => s.sendFriendRequest);
  const friendships   = useChatStore((s) => s.friendships);
  const myUser        = useAuthStore((s) => s.user);

  const [searchQuery, setSearchQuery]     = useState('');
  const [isManageOpen, setIsManageOpen]   = useState(false);
  const [invitingId, setInvitingId]       = useState<string | null>(null);
  const [addingFriend, setAddingFriend]   = useState<string | null>(null);

  if (activeChat?.type !== 'room') {
    return (
      <div style={{ padding: 16, color: '#64748b', fontSize: 13, textAlign: 'center' }}>
        No roster available for direct messages.
      </div>
    );
  }

  const usernamesInRoom = roomMembers[activeChat.jid] || [];

  // Map usernames → full profiles
  const mappedUsers = usernamesInRoom.map((uname) => {
    const profile = users.find((u) => u.username === uname);
    return profile || { username: uname, status: 'online' as const };
  });

  // Sort: online first, then alpha
  mappedUsers.sort((a, b) => {
    if (a.status === 'online' && b.status !== 'online') return -1;
    if (a.status !== 'online' && b.status === 'online') return 1;
    return a.username.localeCompare(b.username);
  });

  // ── Invite search: match users NOT already in the room ────────────────────
  const query = searchQuery.trim().toLowerCase();
  const inviteMatches = query.length >= 2
    ? users.filter(u =>
        u.username.toLowerCase().includes(query) &&
        !usernamesInRoom.includes(u.username)
      )
    : [];

  const handleInvite = async (userId: string) => {
    setInvitingId(userId);
    try {
      const res = await fetch(`/api/rooms/${activeChat.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to invite user');
      addToast('User invited to the room!', 'success');

      // Real-time: push system_refresh_rooms to the invitee
      const targetUser = users.find(u => u.id === userId);
      const xmpp = useChatStore.getState().xmpp;
      if (targetUser && xmpp) {
        const { xml } = await import('@xmpp/client');
        xmpp.send(xml('message', { to: targetUser.jid, type: 'chat', id: crypto.randomUUID() },
          xml('body', {}, JSON.stringify({ type: 'system_refresh_rooms' }))
        )).catch(console.error);
      }

      setSearchQuery('');
    } catch (e: any) {
      addToast(e.message || 'Invite failed', 'error');
    } finally {
      setInvitingId(null);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Search bar + Settings gear ────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="text"
          placeholder="Search users to invite..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-500"
        />
        <button
          onClick={() => setIsManageOpen(true)}
          title="Manage Room"
          className="flex items-center justify-center w-8 h-8 rounded bg-slate-700/50 text-slate-300 hover:bg-slate-600 transition-colors flex-shrink-0"
        >
          <Settings size={15} />
        </button>
      </div>

      {/* ── Invite results (appear when typing ≥ 2 chars) ────────────────── */}
      {query.length >= 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
            Invite to Room
          </div>
          {inviteMatches.length === 0 ? (
            <div style={{ fontSize: 12, color: '#475569', textAlign: 'center', padding: '8px 0' }}>
              No users found for "{query}"
            </div>
          ) : inviteMatches.map(u => (
            <div key={u.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 8px', borderRadius: 8,
              background: 'rgba(99,102,241,0.05)',
              border: '1px solid rgba(99,102,241,0.1)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                  background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                }}>
                  {u.username[0].toUpperCase()}
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0' }}>{u.username}</span>
              </div>
              <button
                onClick={() => handleInvite(u.id)}
                disabled={invitingId === u.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  borderRadius: 6, border: 'none', cursor: invitingId === u.id ? 'not-allowed' : 'pointer',
                  background: 'rgba(16,185,129,0.15)',
                  color: '#34d399',
                  opacity: invitingId === u.id ? 0.6 : 1,
                  transition: 'all 0.15s', whiteSpace: 'nowrap',
                  fontFamily: 'inherit',
                }}
              >
                <MailPlus size={12} />
                {invitingId === u.id ? '…' : 'Invite'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Members count label ───────────────────────────────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>
        {mappedUsers.length} Member{mappedUsers.length !== 1 ? 's' : ''}
      </div>

      {/* ── Member list ───────────────────────────────────────────────────── */}
      {mappedUsers.map((user) => {
        const profile  = users.find(u => u.username === user.username);
        const isSelf   = user.username === myUser?.username;
        const friendship = profile ? friendships.find(f =>
          f.requester_id === profile.id || f.addressee_id === profile.id
        ) : null;
        const isFriend  = friendship?.status === 'accepted';
        const isPending = friendship?.status === 'pending';

        return (
          <div key={user.username} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Avatar + status dot */}
            <div style={{ position: 'relative' }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'linear-gradient(135deg, #475569, #334155)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 13, fontWeight: 700,
              }}>
                {user.username[0].toUpperCase()}
              </div>
              <div style={{
                position: 'absolute', bottom: -2, right: -2,
                width: 10, height: 10, borderRadius: '50%',
                background: user.status === 'online' ? '#22c55e' : user.status === 'away' ? '#f59e0b' : '#64748b',
                border: '2px solid #111318',
              }} />
            </div>

            <div style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 500, flex: 1 }}>
              {user.username}
            </div>

            {/* Friend status badge */}
            {!isSelf && profile && !isFriend && !isPending && (
              <button
                id={`add-friend-${user.username}`}
                title="Send friend request"
                disabled={addingFriend === user.username}
                onClick={async () => {
                  setAddingFriend(user.username);
                  await sendFriendRequest(profile.id);
                  setAddingFriend(null);
                }}
                style={{
                  background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
                  color: '#818cf8', borderRadius: 6, padding: '3px 8px',
                  cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                  transition: 'all 0.15s', flexShrink: 0, fontFamily: 'inherit',
                }}
              >
                {addingFriend === user.username ? '…' : '+ Friend'}
              </button>
            )}
            {!isSelf && isFriend  && <span style={{ fontSize: 10, color: '#4ade80', flexShrink: 0 }}>✓ Friend</span>}
            {!isSelf && isPending && <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>Pending</span>}
          </div>
        );
      })}

      {isManageOpen && activeChat?.id && (
        <ManageRoomModal roomId={activeChat.id} onClose={() => setIsManageOpen(false)} />
      )}
    </div>
  );
}
