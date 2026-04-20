import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';

interface PublicRoom {
  id: string;
  name: string;
  description: string | null;
  member_count: number | string;
  owner_username: string;
  is_member: boolean;
  is_banned: boolean;
}

interface PublicRoomsModalProps {
  onClose: () => void;
  onJoined: () => void; // callback to refresh sidebar
}

export function PublicRoomsModal({ onClose, onJoined }: PublicRoomsModalProps) {
  const { jwt } = useAuthStore();
  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);


  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const url = `/api/rooms/public${query ? `?q=${encodeURIComponent(query)}` : ''}`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${jwt ?? ''}` } });
      if (res.ok) {
        const data = await res.json();
        setRooms(data.rooms || []);
      }
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  useEffect(() => { load(''); }, []);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(q), 300);
  }, [q]);

  const join = async (room: PublicRoom) => {
    if (room.is_member) {
      // Just switch to the room
      const storeRooms = useChatStore.getState().rooms;
      const found = storeRooms.find(r => r.name === room.name);
      if (found) useChatStore.getState().setActiveRoom(found.jid);
      onClose();
      return;
    }
    setJoining(room.id);
    try {
      const res = await fetch(`/api/rooms/${room.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt ?? ''}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to join');
      // Mark as member locally
      setRooms(prev => prev.map(r => r.id === room.id ? { ...r, is_member: true } : r));
      setToast(`Joined #${room.name}!`);
      setTimeout(() => setToast(''), 3000);
      onJoined(); // trigger sidebar refresh
    } catch (e: any) {
      setToast(`Error: ${e.message}`);
      setTimeout(() => setToast(''), 4000);
    } finally {
      setJoining(null);
    }
  };


  return (
    <div id="public-rooms-modal-overlay" style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#161b27', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16, width: '100%', maxWidth: 600,
        maxHeight: '85vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>Browse Public Rooms</h2>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>Discover and join public chat rooms</p>
            </div>
            <button id="public-rooms-close" onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
          </div>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16, opacity: 0.5 }}>🔍</span>
            <input
              id="public-rooms-search"
              className="input-field"
              style={{ paddingLeft: 36 }}
              placeholder="Search rooms by name or description…"
              value={q}
              onChange={e => setQ(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Room list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 16px' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 14 }}>Loading rooms…</div>
          ) : rooms.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
              {q ? `No rooms matching "${q}"` : 'No public rooms yet. Create one!'}
            </div>
          ) : (
            rooms.map(room => (
              <div key={room.id} id={`public-room-${room.id}`} style={{
                borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(255,255,255,0.03)',
                padding: '14px 16px',
                marginBottom: 6,
                display: 'flex', alignItems: 'center', gap: 14,
                transition: 'background 0.15s',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
              >
                {/* Room icon */}
                <div style={{
                  width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                  background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, fontWeight: 700, color: 'white',
                }}>
                  #
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, color: '#f1f5f9', fontSize: 14 }}>{room.name}</span>
                    {room.is_member && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#4ade80', background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 10, padding: '1px 6px' }}>
                        JOINED
                      </span>
                    )}
                    {room.is_banned && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#f87171', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '1px 6px' }}>
                        BANNED
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {room.description || 'No description'}
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
                    👥 {Number(room.member_count).toLocaleString()} members · Owner: @{room.owner_username}
                  </div>
                </div>
                {/* Join button */}
                {!room.is_banned && (
                  <button
                    id={`join-room-${room.id}`}
                    onClick={() => join(room)}
                    disabled={joining === room.id}
                    style={{
                      flexShrink: 0,
                      background: room.is_member ? 'rgba(99,102,241,0.1)' : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                      border: room.is_member ? '1px solid rgba(99,102,241,0.3)' : 'none',
                      color: room.is_member ? '#818cf8' : 'white',
                      borderRadius: 8, padding: '7px 16px', cursor: 'pointer',
                      fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
                    }}
                  >
                    {joining === room.id ? '…' : room.is_member ? 'Open' : 'Join'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div style={{
            position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
            background: toast.startsWith('Error') ? 'rgba(239,68,68,0.9)' : 'rgba(74,222,128,0.9)',
            color: 'white', borderRadius: 20, padding: '8px 18px', fontSize: 13, fontWeight: 600,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)', whiteSpace: 'nowrap',
          }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
