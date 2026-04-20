import { useState } from 'react';
import { useChatStore } from '../store/chatStore';
import type { Message } from '../types/chat';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Stable empty array — see MessageList.tsx for full explanation.
const EMPTY_MESSAGES: Message[] = [];

interface AIPanelProps {
  width?: number; // make optional
  headless?: boolean;
}

type SummaryState = 'idle' | 'loading' | 'done';

export function AIPanel({ width = 300, headless }: AIPanelProps) {
  const activeRoomJid = useChatStore((s) => s.activeRoomJid);
  const rooms         = useChatStore((s) => s.rooms);
  const messages      = useChatStore((s) => s.messages[s.activeRoomJid] ?? EMPTY_MESSAGES);
  const lastReadAt    = useChatStore((s) => s.lastReadAts[s.activeRoomJid] ?? null);
  const markAsRead    = useChatStore((s) => s.markAsRead);
  const jwt           = useChatStore((s) => s.jwt);
  const addToast      = useChatStore((s) => s.addToast);

  const [summaryState, setSummaryState] = useState<SummaryState>('idle');
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryMode, setSummaryMode] = useState<'unread' | 'all'>('unread');

  const room = rooms.find((r) => r.jid === activeRoomJid);
  const unreadMsgs = lastReadAt
    ? messages.filter((m) => m.timestamp > lastReadAt)
    : messages;

  const hasUnread = unreadMsgs.length > 0;

  // Generate a mock AI summary of the unread messages
  const summarize = async () => {
    setSummaryState('loading');
    setSummary(null);

    const payload = (summaryMode === 'unread' ? unreadMsgs : messages)
      .filter(m => m.type !== 'file_ref' && m.body)
      .slice(-80)
      .map(m => ({ sender: m.senderName || m.sender, body: m.body }));

    if (payload.length === 0) {
      addToast('No messages to summarize.', 'error');
      setSummaryState('idle');
      return;
    }

    try {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ messages: payload }),
      });
      if (!res.ok) throw new Error('Summarization failed');
      const data = await res.json();
      setSummary(data.summary);
      setSummaryState('done');
    } catch (e: any) {
      addToast(e.message || 'AI request failed', 'error');
      setSummaryState('idle');
    }
  };

  const handleMarkAsRead = () => {
    markAsRead(activeRoomJid);
    setSummaryState('idle');
    setSummary(null);
  };

  const content = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px', height: '100%' }}>
      {/* ── Unread summary card ── */}
      <div style={{
        background: '#1a1e2a',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 16,
      }}>
        {/* Card header */}
        <div style={{
          padding: '12px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>📬</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Unread Summary</span>
          {hasUnread && (
            <span style={{
              marginLeft: 'auto',
              background: 'rgba(239,68,68,0.15)', color: '#f87171',
              border: '1px solid rgba(239,68,68,0.25)',
              fontSize: 10, fontWeight: 700, borderRadius: 10,
              padding: '1px 8px',
            }}>
              {unreadMsgs.length} unread
            </span>
          )}
        </div>

        {/* Card body */}
        <div style={{ padding: '12px 14px' }}>
          {!hasUnread && (
            <p style={{ fontSize: 13, color: '#64748b', textAlign: 'center', padding: '8px 0' }}>
              ✅ You're all caught up!
            </p>
          )}

          {hasUnread && summaryState === 'idle' && (
            <>
              {/* Mode switcher */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {(['unread', 'all'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setSummaryMode(mode)}
                    style={{
                      flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 600,
                      borderRadius: 6, border: '1px solid',
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                      background: summaryMode === mode ? 'rgba(99,102,241,0.25)' : 'transparent',
                      color: summaryMode === mode ? '#818cf8' : '#64748b',
                      borderColor: summaryMode === mode ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)',
                    }}
                  >
                    {mode === 'unread' ? `Unread (${unreadMsgs.length})` : `All (${messages.length})`}
                  </button>
                ))}
              </div>
              <button
                onClick={summarize}
                style={{
                  width: '100%', padding: '8px 0', borderRadius: 8,
                  border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg,#6366f1,#9f7aea)',
                  color: '#fff', fontSize: 13, fontWeight: 600,
                  fontFamily: 'inherit',
                }}
              >
                ✨ Summarize {summaryMode === 'unread' ? 'Unread' : 'Conversation'}
              </button>
            </>
          )}

          {summaryState === 'loading' && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                border: '3px solid rgba(99,102,241,0.2)',
                borderTopColor: '#6366f1',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto 8px',
              }} />
              <p style={{ fontSize: 12, color: '#64748b' }}>Analyzing messages…</p>
            </div>
          )}

          {summaryState === 'done' && summary && (
            <>
              <div style={{
                fontSize: 12.5, color: '#94a3b8', lineHeight: 1.65,
                background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 8, padding: '10px 12px', marginBottom: 14,
                wordBreak: 'break-word',
              }}>
                <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-strong:text-slate-300">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleMarkAsRead}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 7,
                    border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg,#22c55e,#16a34a)',
                    color: '#fff', fontSize: 12.5, fontWeight: 600,
                    fontFamily: 'inherit',
                  }}
                >
                  ✓ Mark as Read
                </button>
                <button
                  onClick={() => { setSummaryState('idle'); setSummary(null); }}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 7,
                    border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
                    background: 'transparent',
                    color: '#94a3b8', fontSize: 12.5, fontWeight: 600,
                    fontFamily: 'inherit',
                  }}
                >
                  Dismiss
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Compose AI features ── */}
      <div style={{
        background: '#1a1e2a',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 12,
        padding: '14px',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          ✨ Compose AI
        </div>
        {[{ icon: '✨', label: 'Improve Writing', tip: 'Polish grammar and tone' },
          { icon: '🔤', label: 'Fix Spelling', tip: 'Correct typos instantly' },
          { icon: '🌍', label: 'Translate', tip: 'ES · FR · DE · UK · RU' },
        ].map(f => (
          <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 15 }}>{f.icon}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>{f.label}</div>
              <div style={{ fontSize: 11, color: '#475569' }}>{f.tip}</div>
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: '#334155', marginTop: 8, lineHeight: 1.5 }}>
          Tip: click the <strong style={{ color: '#6366f1' }}>✨ sparkle button</strong> in the message toolbar when focused.
        </div>
      </div>
      {/* Spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (headless) {
    return content;
  }

  return (
    <aside style={{
      width,
      minWidth: width,
      maxWidth: width,
      background: '#111318',
      borderLeft: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Panel header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 10,
        height: 52,
        cursor: 'default',
        userSelect: 'none',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: 'linear-gradient(135deg,#6366f1,#9f7aea)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
            <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>AI Assistant</div>
          <div style={{ fontSize: 11, color: '#475569' }}>Context-aware for #{room?.name}</div>
        </div>
      </div>

      {/* Panel content */}
      {content}
    </aside>
  );

}
