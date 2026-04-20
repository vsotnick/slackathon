import { useState, useEffect, useRef } from 'react';
import { useChatStore } from '../store/chatStore';

// ── Types ──────────────────────────────────────────────────────────────────────
interface PersonResult  { id: string; username: string; jid: string; role: string; }
interface RoomResult    { id: string; name: string; jid: string; description?: string; is_private: boolean; }
interface MessageResult {
  type: 'message'; id: string;
  roomJid: string; roomName: string;
  timestamp: number; sender: string | null; snippet: string;
}
interface FileResult    {
  type: 'file'; id: string;
  roomJid: string; roomName: string;
  timestamp: number; snippet: string; mimeType: string;
}
interface SearchData {
  people:   PersonResult[];
  rooms:    RoomResult[];
  messages: MessageResult[];
  files:    FileResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: '#6366f133', color: '#a5b4fc', borderRadius: 2, padding: '0 2px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000)    return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────
export function SearchModal({ onClose }: { onClose: () => void }) {
  const [query,   setQuery]   = useState('');
  const [data,    setData]    = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const jwt        = useChatStore((s) => s.jwt);
  const rooms      = useChatStore((s) => s.rooms);
  const setActive  = useChatStore((s) => s.setActiveRoom);
  const inputRef   = useRef<HTMLInputElement>(null);

  const friendships = useChatStore((s) => s.friendships);
  
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Parse #roomname prefix from the query
  const roomMatch   = query.match(/^#([a-z0-9_-]+)\s*(.*)/i);
  const roomFilter  = roomMatch ? roomMatch[1].toLowerCase() : null;
  const searchText  = roomMatch ? roomMatch[2].trim() : query.trim();

  // Total results count
  const total = data
    ? data.people.length + data.rooms.length + data.messages.length + data.files.length
    : 0;

  useEffect(() => {
    // Need at least 2 chars to search (either in room filter or search text)
    const effectiveQ = searchText || roomFilter || '';
    if (effectiveQ.length < 2) { setData(null); setError(null); return; }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: searchText || roomFilter! });
        if (roomFilter && searchText) params.set('room', roomFilter);
        else if (roomFilter && !searchText) params.set('q', roomFilter);

        const res = await fetch(`/api/search?${params}`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || 'Search failed');
        setData(json);
      } catch (e: any) {
        setError(e.message);
        setData(null);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query, jwt, roomFilter, searchText]);

  const goToRoom = (jid: string) => {
    const room = rooms.find(r => r.jid === jid);
    if (room) setActive(room.jid);
    onClose();
  };

  const goToDM = (userJid: string) => {
    // Navigate to DM by setting active chat via store
    useChatStore.getState().setActiveDm({
      id: userJid,
      username: userJid.split('@')[0],
      jid: userJid,
      email: '',
      role: 'user',
      status: 'offline'
    } as any);
    onClose();
  };

  const isEmpty = data && total === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: '#0f1117', border: '1px solid rgba(99,102,241,0.2)', maxHeight: '82vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Search bar ── */}
        <div style={{ background: '#161a26', borderBottom: '1px solid #1e2333', padding: '12px 16px' }}
             className="flex items-center gap-3">
          <span style={{ fontSize: 18 }}>🔍</span>

          {/* Room filter badge */}
          {roomFilter && (
            <span style={{
              background: '#312e81', color: '#a5b4fc',
              fontSize: 12, fontWeight: 700, padding: '2px 8px',
              borderRadius: 6, whiteSpace: 'nowrap', letterSpacing: '0.02em',
            }}>
              #{roomFilter}
            </span>
          )}

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
            placeholder={roomFilter ? `Search in #${roomFilter}…` : 'Search people, rooms, messages… or type #room to filter'}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 15, color: '#e2e8f0', fontFamily: 'inherit',
            }}
          />

          {loading && (
            <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 700 }} className="animate-pulse">
              Searching…
            </span>
          )}

          <kbd
            onClick={onClose}
            style={{
              background: '#1e2333', border: '1px solid #334155',
              color: '#64748b', fontSize: 11, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
            }}
          >
            Esc
          </kbd>
        </div>

        {/* ── Hint bar ── */}
        {!data && !loading && (
          <div style={{ padding: '10px 16px', fontSize: 12, color: '#475569', borderBottom: '1px solid #1e2333' }}>
            Tip: type <strong style={{ color: '#6366f1' }}>#roomname query</strong> to search within a specific room
          </div>
        )}

        {/* ── Results ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>

          {error && (
            <div style={{ padding: '16px', color: '#f87171', fontSize: 13, textAlign: 'center' }}>
              ⚠️ {error}
            </div>
          )}

          {isEmpty && (
            <div style={{ padding: '48px 0', textAlign: 'center', color: '#475569', fontSize: 13 }}>
              No results for <strong style={{ color: '#64748b' }}>"{searchText || roomFilter}"</strong>
            </div>
          )}

          {(data?.people.length ?? 0) > 0 && (
            <Section label="People" icon="👤">
              {data!.people.map(p => {
                const isFriend = friendships.some(f => f.status === 'accepted' && f.user_id === p.id);
                return (
                <ResultRow
                  key={p.id}
                  onClick={() => {
                    goToDM(p.jid);
                  }}
                  left={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={p.username} size={30} color="#4f46e5" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {highlight(p.username, searchText)}
                          {!isFriend && p.username !== useChatStore.getState().myNick && (
                            <span style={{ fontSize: 9, padding: '2px 4px', background: '#334155', color: '#cbd5e1', borderRadius: 4 }}>Not Friends</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{p.jid}</div>
                      </div>
                    </div>
                  }
                  right={
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      background: p.role === 'admin' ? '#7c3aed22' : '#1e2333',
                      color: p.role === 'admin' ? '#a78bfa' : '#64748b',
                    }}>
                      {p.role.toUpperCase()}
                    </span>
                  }
                />
              )})}
            </Section>
          )}

          {/* Rooms */}
          {(data?.rooms.length ?? 0) > 0 && (
            <Section label="Rooms" icon="📢">
              {data!.rooms.map(r => (
                <ResultRow
                  key={r.id}
                  onClick={() => goToRoom(r.jid)}
                  left={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={r.is_private ? '🔒' : '#'} size={30} color="#0f766e" emoji />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>
                          #{highlight(r.name, searchText)}
                        </div>
                        {r.description && (
                          <div style={{ fontSize: 11, color: '#64748b' }}>{r.description}</div>
                        )}
                      </div>
                    </div>
                  }
                  right={
                    r.is_private
                      ? <span style={{ fontSize: 10, color: '#94a3b8' }}>PRIVATE</span>
                      : null
                  }
                />
              ))}
            </Section>
          )}

          {/* Messages */}
          {(data?.messages.length ?? 0) > 0 && (
            <Section label={roomFilter ? `Messages in #${roomFilter}` : 'Messages'} icon="💬">
              {data!.messages.map(m => (
                <ResultRow
                  key={m.id}
                  onClick={() => goToRoom(m.roomJid)}
                  left={
                    <div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: '#818cf8',
                          background: '#1e1b4b', padding: '1px 6px', borderRadius: 4,
                        }}>
                          #{m.roomName}
                        </span>
                        {m.sender && (
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>@{m.sender}</span>
                        )}
                        <span style={{ fontSize: 10, color: '#475569', marginLeft: 'auto' }}>
                          {timeAgo(m.timestamp)}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>
                        {highlight(m.snippet, searchText)}
                      </div>
                    </div>
                  }
                />
              ))}
            </Section>
          )}

          {/* Files */}
          {(data?.files.length ?? 0) > 0 && (
            <Section label="Files" icon="📁">
              {data!.files.map(f => (
                <ResultRow
                  key={f.id}
                  onClick={() => goToRoom(f.roomJid)}
                  left={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 22 }}>
                        {f.mimeType?.startsWith('image/') ? '🖼️'
                         : f.mimeType === 'application/pdf' ? '📄'
                         : '📎'}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0' }}>
                          {highlight(f.snippet, searchText)}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          in #{f.roomName} · {timeAgo(f.timestamp)}
                        </div>
                      </div>
                    </div>
                  }
                  right={
                    <span style={{ fontSize: 10, color: '#64748b' }}>{f.mimeType}</span>
                  }
                />
              ))}
            </Section>
          )}
        </div>

        {/* ── Footer ── */}
        {data && total > 0 && (
          <div style={{
            borderTop: '1px solid #1e2333', padding: '8px 16px',
            fontSize: 11, color: '#475569', display: 'flex', justifyContent: 'space-between',
          }}>
            <span>{total} result{total !== 1 && 's'}</span>
            <span>↵ to open · Esc to close</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        padding: '6px 16px', fontSize: 10, fontWeight: 700,
        color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span>{icon}</span> {label}
      </div>
      {children}
    </div>
  );
}

function ResultRow({ left, right, onClick }: {
  left: React.ReactNode;
  right?: React.ReactNode | null;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 16px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        borderRadius: 0, transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#161a26')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{left}</div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

function Avatar({ name, size, color, emoji }: { name: string; size: number; color: string; emoji?: boolean }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: emoji ? 8 : '50%',
      background: emoji ? color + '22' : color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: emoji ? size * 0.55 : size * 0.42,
      fontWeight: 700, color: '#fff', flexShrink: 0,
    }}>
      {name[0]?.toUpperCase()}
    </div>
  );
}
