import { useChatStore } from '../store/chatStore';

export function FriendRequestPromptModal() {
  const target = useChatStore((s) => s.friendRequestPromptTarget);
  const setTarget = useChatStore((s) => s.setFriendRequestPromptTarget);
  const sendFriendRequest = useChatStore((s) => s.sendFriendRequest);

  if (!target) return null;

  const handleSend = () => {
    sendFriendRequest(target.id);
    setTarget(null);
  };

  const handleCancel = () => {
    setTarget(null);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => e.target === e.currentTarget && handleCancel()}>
      <div style={{
        background: '#161b27', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16, width: '100%', maxWidth: 420,
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
        padding: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'rgba(99,102,241,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24,
          }}>
            🔒
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>
              Restricted User
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>
              @{target.username} has privacy settings enabled.
            </p>
          </div>
        </div>

        <p style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.5, marginBottom: 24 }}>
          You must be friends with <strong>@{target.username}</strong> to send them a direct message. 
          Would you like to send a friend request now?
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={handleCancel} style={{
            padding: '10px 16px', borderRadius: 8,
            background: 'rgba(255,255,255,0.05)', color: '#f1f5f9',
            border: '1px solid rgba(255,255,255,0.1)',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}>
            Cancel
          </button>
          <button onClick={handleSend} style={{
            padding: '10px 20px', borderRadius: 8,
            background: '#6366f1', color: '#ffffff',
            border: '1px solid #4f46e5',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
            boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
          }}>
            Send Friend Request
          </button>
        </div>
      </div>
    </div>
  );
}
