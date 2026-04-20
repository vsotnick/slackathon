import { useChatStore } from '../store/chatStore';

export function ToastContainer() {
  const toasts = useChatStore((s) => s.toasts);
  const removeToast = useChatStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      zIndex: 9999,
      pointerEvents: 'none'
    }}>
      {toasts.map((toast) => {
        let bgColor = '#1e293b'; // default info
        let icon = 'ℹ️';
        if (toast.type === 'error') {
          bgColor = '#ef4444';
          icon = '⚠️';
        } else if (toast.type === 'success') {
          bgColor = '#10b981';
          icon = '✅';
        }

        return (
          <div
            key={toast.id}
            style={{
              background: bgColor,
              color: '#fff',
              padding: '12px 16px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              pointerEvents: 'auto',
              minWidth: 250,
              maxWidth: 350,
              animation: 'slideUpFade 0.3s ease-out'
            }}
          >
            <span style={{ fontSize: 18 }}>{icon}</span>
            <div style={{ flex: 1, lineHeight: 1.4 }}>{toast.message}</div>
            <button
              onClick={() => removeToast(toast.id)}
              style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
                cursor: 'pointer', padding: 0, fontSize: 16
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
