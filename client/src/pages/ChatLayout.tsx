import { useState, useEffect, useRef } from 'react';
import { xml } from '@xmpp/client';
import { useResize } from '../hooks/useResize';
import { useChatStore } from '../store/chatStore';
import { Sidebar } from '../components/Sidebar';
import { ChatHeader } from '../components/ChatHeader';
import { MessageList } from '../components/MessageList';
import { ChatInput } from '../components/ChatInput';
import { RightPanel } from '../components/RightPanel';
import { ToastContainer } from '../components/ToastContainer';

// ── Drag handle ───────────────────────────────────────────────────────────
interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
}

function ResizeHandle({ onMouseDown }: ResizeHandleProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        // flex-shrink: 0 is CRITICAL — the handle must never be squished
        width: 5,
        flexShrink: 0,
        cursor: 'col-resize',
        background: hover ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.05)',
        transition: 'background 0.15s',
        zIndex: 20,
        position: 'relative',
        alignSelf: 'stretch',
      }}
    >
      {hover && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: '#818cf8' }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chat Layout — 3-pane application shell ────────────────────────────────
//
// Flexbox contract (BUG FIX #1 + #2):
//   Left sidebar  → flex-shrink: 0,  min-width: 200px, max-width: 400px
//   Resize handle → flex-shrink: 0,  width: 5px (fixed)
//   Center pane   → flex: 1,         min-width: 400px  (never squeezed below 400)
//   Resize handle → flex-shrink: 0,  width: 5px (fixed)
//   Right panel   → flex-shrink: 0,  min-width: 250px, max-width: 400px
//
// Neither sidebar can grow into the center because they have fixed, non-growing
// widths (no flex-grow). The center gets all remaining space via flex: 1.
// min-width: 400px on the center prevents sidebars from ever covering messages.
// ─────────────────────────────────────────────────────────────────────────────
export function ChatLayout() {
  const [aiOpen, setAiOpen] = useState(true);
  const xmpp = useChatStore(s => s.xmpp);

  // ── AFK detection (req 2.2.2 / 2.2.3) ──────────────────────────────────
  // A user is AFK if no mouse/key/touch activity in any tab for >60 seconds.
  // We use a BroadcastChannel so all open tabs stay in sync: if ANY tab sees
  // activity the whole session flips back to "online" immediately.
  const afkTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAwayRef    = useRef(false);
  const AFK_MS       = 60_000; // 60 seconds

  useEffect(() => {
    if (!xmpp) return;

    // BroadcastChannel: cross-tab activity coordination
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel('slackathon_activity'); } catch { /* Safari private mode */ }

    const goOnline = () => {
      if (!isAwayRef.current) return;
      isAwayRef.current = false;
      xmpp.send(xml('presence')).catch(() => {});
    };

    const goAway = () => {
      if (isAwayRef.current) return;
      isAwayRef.current = true;
      xmpp.send(xml('presence', {}, xml('show', {}, 'away'))).catch(() => {});
    };

    const resetTimer = () => {
      // Broadcast activity to other tabs
      try { channel?.postMessage('active'); } catch { /* ignore */ }
      goOnline();
      if (afkTimerRef.current) clearTimeout(afkTimerRef.current);
      afkTimerRef.current = setTimeout(goAway, AFK_MS);
    };

    // Listen for activity from other tabs
    const onChannelMsg = (e: MessageEvent) => {
      if (e.data === 'active') goOnline();
      // Reset local timer too when a sibling tab is active so we don't go AFK
      if (afkTimerRef.current) clearTimeout(afkTimerRef.current);
      afkTimerRef.current = setTimeout(goAway, AFK_MS);
    };
    channel?.addEventListener('message', onChannelMsg);

    const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'focus'] as const;
    EVENTS.forEach(ev => document.addEventListener(ev, resetTimer, { passive: true }));

    // Kick off the first timer
    resetTimer();

    return () => {
      if (afkTimerRef.current) clearTimeout(afkTimerRef.current);
      EVENTS.forEach(ev => document.removeEventListener(ev, resetTimer));
      channel?.removeEventListener('message', onChannelMsg);
      channel?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xmpp]);

  // BUG FIX #2: Tightened min/max to enforce layout contract
  // Left:  min 200, max 400
  // Right: min 250, max 400
  const left  = useResize(240, 200, 400, 'right');
  const right = useResize(300, 250, 400, 'left');

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        // overflow: hidden on the SHELL so there's no page scroll,
        // but each pane manages its own internal scroll.
        overflow: 'hidden',
        background: '#0d0f14',
        fontFamily: 'Inter, sans-serif',
        // Prevent the row from wrapping — all panes stay on one line
        flexWrap: 'nowrap',
      }}
    >
      {/* ── Left sidebar ── */}
      <div style={{ flexShrink: 0, height: '100%', alignSelf: 'stretch' }}>
        <Sidebar width={left.width} />
      </div>

      {/* ── Left resize handle ── */}
      <ResizeHandle onMouseDown={left.onMouseDown} />

      {/* ── Center chat pane ─────────────────────────────────────────────────
          flex: 1        = take all remaining space
          minWidth: 400  = HARD floor — sidebars can NEVER cover messages
          overflow hidden = internal MessageList handles its own scroll
      ── */}
      <div
        style={{
          flex: 1,
          minWidth: 400,             // hard floor — sidebars never cover messages
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          overflowX: 'hidden',       // FIX: eliminate horizontal scrollbar
        }}
      >
        <ChatHeader aiPanelOpen={aiOpen} onToggleAI={() => setAiOpen((v) => !v)} />
        <MessageList />
        <ChatInput />
      </div>

      {/* ── Right resize handle (only when AI panel is open) ── */}
      {aiOpen && <ResizeHandle onMouseDown={right.onMouseDown} />}

      {/* ── Right AI panel (BUG FIX: flexShrink:0 keeps it from collapsing
          onto the center pane when the window shrinks) ── */}
      {aiOpen && (
        <div style={{ flexShrink: 0 }}>
          <RightPanel width={right.width} />
        </div>
      )}

      <ToastContainer />
    </div>
  );
}
