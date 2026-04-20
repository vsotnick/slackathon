import { useChatStore, type XmppStatus } from '../store/chatStore';

const statusConfig: Record<
  XmppStatus,
  { label: string; dot: string; ring: string; pulse: boolean; color: string }
> = {
  offline:    { label: 'Offline',     dot: 'bg-gray-500',   ring: 'ring-gray-500/30',   pulse: false, color: '#6b7280' },
  connecting: { label: 'Connecting',  dot: 'bg-yellow-400', ring: 'ring-yellow-400/30', pulse: true,  color: '#facc15' },
  online:     { label: 'Connected',   dot: 'bg-green-400',  ring: 'ring-green-400/30',  pulse: false, color: '#4ade80' },
  error:      { label: 'Error',       dot: 'bg-red-400',    ring: 'ring-red-400/30',    pulse: false, color: '#f87171' },
};

interface XmppStatusBadgeProps {
  /** When true, renders only a small colored dot (for use in the chat header). */
  compact?: boolean;
}

export function XmppStatusBadge({ compact = false }: XmppStatusBadgeProps) {
  const status  = useChatStore((s) => s.status);
  const address = useChatStore((s) => s.address);
  const cfg = statusConfig[status];

  if (compact) {
    return (
      <div
        title={`XMPP ${cfg.label}${address ? ` · ${address.split('/')[0]}` : ''}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 12, color: '#64748b',
          cursor: 'default', userSelect: 'none',
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
          background: cfg.color,
          boxShadow: status === 'online' ? `0 0 6px ${cfg.color}` : 'none',
        }} />
        {cfg.label}
      </div>
    );
  }

  return (
    <div
      className={`
        inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium
        glass ring-1 ${cfg.ring} transition-all duration-500
      `}
      style={{ cursor: 'default', userSelect: 'none' }}
    >
      <span className="relative flex h-2 w-2">
        <span className={`
          ${cfg.dot} rounded-full h-2 w-2
          ${cfg.pulse ? 'animate-ping absolute inline-flex h-full w-full opacity-75' : ''}
        `} />
        {cfg.pulse && (
          <span className={`${cfg.dot} rounded-full h-2 w-2 relative inline-flex`} />
        )}
      </span>
      <span style={{ color: 'var(--text-secondary)' }}>
        {cfg.label}
        {address && status === 'online' && (
          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
            · {address.split('/')[0]}
          </span>
        )}
      </span>
    </div>
  );
}
