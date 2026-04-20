import { useState, useEffect } from 'react';
import { useChatStore } from '../store/chatStore';
import { X, Shield, ShieldAlert, UserX, Settings, LogOut, Trash2 } from 'lucide-react';

interface RoomMember {
  id: string;
  username: string;
  role: 'member' | 'admin' | 'moderator' | 'owner';
  joined_at: string;
}

interface BannedUser {
  id: string;
  username: string;
  reason: string;
  by_username: string;
  kicked_at: string;
}

interface ManageRoomModalProps {
  roomId: string;
  onClose: () => void;
}

export function ManageRoomModal({ roomId, onClose }: ManageRoomModalProps) {
  const { activeChat, updateRoomMemberRole, kickRoomMember, banRoomMember, deleteRoom, leaveRoom, updateRoomSettings, jwt, addToast } = useChatStore();
  const [activeTab, setActiveTab] = useState<'members' | 'banned' | 'settings'>('members');
  
  const [myRole, setMyRole] = useState<'member' | 'admin' | 'owner'>('member');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [banned, setBanned] = useState<BannedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Settings state
  const [roomName, setRoomName] = useState(activeChat?.name || '');
  const [roomDesc, setRoomDesc] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // For the active action
  const [actingOn, setActingOn] = useState<string | null>(null);

  // States for custom popups
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; isDestructive?: boolean; onConfirm: () => void } | null>(null);
  const [promptAction, setPromptAction] = useState<{ title: string; placeholder: string; onConfirm: (val: string) => void } | null>(null);
  const [promptInputValue, setPromptInputValue] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch(`/api/rooms/${roomId}`, {
          headers: { 'Authorization': `Bearer ${jwt}` }
        });
        if (!res.ok) throw new Error('Failed to load room details');
        const data = await res.json();
        setMyRole(data.myRole);
        setMembers(data.members || []);
        setBanned(data.banned || []);
        
        // Settings initial state loading (would normally fetch room details but we can rely on activeChat partly)
        const roomStore = useChatStore.getState().rooms.find(r => r.id === roomId);
        if (roomStore) {
          setRoomName(roomStore.name);
          setRoomDesc(roomStore.description || '');
          setIsPrivate(!!roomStore.is_private);
        }
      } catch (e: any) {
        addToast(e.message, 'error');
        onClose();
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [roomId, jwt, addToast, onClose]);

  const isAdminOrOwner = myRole === 'owner' || myRole === 'admin';

  const handleRoleChange = async (userId: string, newRole: 'member' | 'admin' | 'moderator') => {
    setActingOn(userId);
    try {
      await updateRoomMemberRole(roomId, userId, newRole);
      setMembers(m => m.map(x => x.id === userId ? { ...x, role: newRole } : x));
      addToast('Role updated', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
    setActingOn(null);
  };

  const handleKick = (userId: string) => {
    setConfirmAction({
      title: 'Kick User',
      message: 'Are you sure you want to kick this user?',
      isDestructive: true,
      onConfirm: async () => {
        setActingOn(userId);
        try {
          await kickRoomMember(roomId, userId);
          setMembers(m => m.filter(x => x.id !== userId));
          addToast('User kicked', 'success');
        } catch (e: any) {
          addToast(e.message, 'error');
        }
        setActingOn(null);
      }
    });
  };

  const handleBan = (userId: string) => {
    setPromptInputValue('');
    setPromptAction({
      title: 'Ban User',
      placeholder: 'Reason for ban? (Optional)',
      onConfirm: async (reason: string) => {
        setActingOn(userId);
        try {
          await banRoomMember(roomId, userId, reason);
          const bannedUser = members.find(m => m.id === userId);
          if (bannedUser) {
            setBanned(b => [...b, { id: bannedUser.id, username: bannedUser.username, reason, by_username: 'You', kicked_at: new Date().toISOString() }]);
          }
          setMembers(m => m.filter(x => x.id !== userId));
          addToast('User banned', 'success');
        } catch (e: any) {
          addToast(e.message, 'error');
        }
        setActingOn(null);
      }
    });
  };

  const handleDeleteRoom = () => {
    setConfirmAction({
      title: 'Delete Room',
      message: 'CRITICAL: Are you absolutely sure you want to delete this room? This will permanently wipe all history and attached files.',
      isDestructive: true,
      onConfirm: async () => {
        try {
          setIsLoading(true);
          await deleteRoom(roomId);
          onClose();
        } catch (e: any) {
          addToast(e.message, 'error');
          setIsLoading(false);
        }
      }
    });
  };

  const handleLeaveRoom = () => {
    setConfirmAction({
      title: 'Leave Room',
      message: 'Are you sure you want to leave this room?',
      isDestructive: true,
      onConfirm: async () => {
        try {
          setIsLoading(true);
          await leaveRoom(roomId);
          onClose();
        } catch (e: any) {
          addToast(e.message, 'error');
          setIsLoading(false);
        }
      }
    });
  };

  const handleSaveSettings = async () => {
    try {
      setIsSavingSettings(true);
      await updateRoomSettings(roomId, { name: roomName, description: roomDesc, is_private: isPrivate });
      addToast('Settings saved successfully', 'success');
      onClose();
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#1a1d24] w-full max-w-2xl rounded-xl border border-[#334155] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#334155] bg-gradient-to-r from-[#1e293b] to-[#0f172a]">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Settings className="w-5 h-5 text-indigo-400" />
              Manage {activeChat?.name}
            </h2>
            <p className="text-sm text-slate-400 mt-1">Configure room settings and moderate members.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#334155] bg-[#1e293b]/50 px-2 overflow-x-auto">
          {['members', 'banned', 'settings'].map(_t => (
            <button
              key={_t}
              onClick={() => setActiveTab(_t as any)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${activeTab === _t ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              style={{ textTransform: 'capitalize' }}
            >
              {_t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div></div>
          ) : (
            <>
              {activeTab === 'members' && (
                <div className="flex flex-col gap-3">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Room Members ({members.length})</div>
                  {members.map(member => (
                    <div key={member.id} className="flex items-center justify-between p-3 bg-[#0f172a]/50 rounded-lg border border-[#334155]">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
                          {member.username[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-slate-200 font-medium">{member.username}</p>
                          <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                            {member.role === 'owner' && <ShieldAlert size={12} className="text-amber-500" />}
                            {member.role === 'admin' && <Shield size={12} className="text-indigo-400" />}
                            <span className="uppercase">{member.role}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {myRole === 'owner' && member.role !== 'owner' && (
                          <select 
                            value={member.role}
                            onChange={(e) => handleRoleChange(member.id, e.target.value as any)}
                            disabled={actingOn === member.id}
                            className="bg-[#1e293b] border border-[#334155] rounded text-slate-300 text-xs px-2 py-1.5 outline-none focus:border-indigo-500"
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        )}
                        {isAdminOrOwner && member.role !== 'owner' && (
                          <>
                            <button onClick={() => handleKick(member.id)} disabled={actingOn === member.id} className="text-xs px-3 py-1.5 bg-slate-700/50 hover:bg-slate-600 text-slate-300 rounded transition-colors disabled:opacity-50">Kick</button>
                            <button onClick={() => handleBan(member.id)} disabled={actingOn === member.id} className="text-xs px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded transition-colors disabled:opacity-50">Ban</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'banned' && (
                <div className="flex flex-col gap-3">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Banned Users ({banned.length})</div>
                  {banned.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No users are currently banned from this room.</p>}
                  {banned.map(user => (
                    <div key={user.id} className="flex items-center justify-between p-3 bg-red-900/10 rounded-lg border border-red-900/30">
                      <div>
                        <p className="text-red-400 font-medium flex items-center gap-2">
                          <UserX size={14} /> {user.username}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">Banned by {user.by_username}: "{user.reason || 'No reason provided'}"</p>
                      </div>
                      {/* req 2.4.7: Admins can view and remove users from ban list */}
                      {isAdminOrOwner && (
                         <button
                           id={`unban-${user.id}`}
                           className="text-xs px-3 py-1.5 bg-slate-700/50 hover:bg-slate-600 text-slate-300 rounded transition-colors"
                           onClick={async () => {
                             try {
                               const res = await fetch(`/api/rooms/${roomId}/ban/${user.id}`, {
                                 method: 'DELETE',
                                 headers: { 'Authorization': `Bearer ${jwt}` }
                               });
                               if (!res.ok) throw new Error('Failed to unban user');
                               setBanned(b => b.filter(x => x.id !== user.id));
                               addToast(`${user.username} unbanned`, 'success');
                             } catch (e: any) {
                               addToast(e.message, 'error');
                             }
                           }}
                         >
                           Unban
                         </button>
                      )}

                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'settings' && (
                <div className="flex flex-col gap-6">
                   {myRole === 'owner' && (
                     <div className="p-4 bg-[#1e293b]/50 border border-[#334155] rounded-lg">
                        <h3 className="text-sm font-bold text-slate-200 mb-4">Room Settings</h3>
                        
                        <div className="mb-4">
                          <label className="block text-xs font-semibold text-slate-400 mb-1">Room Name</label>
                          <input 
                            type="text" 
                            className="bg-[#0f172a] border border-[#334155] text-slate-200 text-sm rounded px-3 py-2 w-full focus:border-indigo-500 outline-none transition-colors"
                            value={roomName}
                            onChange={(e) => setRoomName(e.target.value)}
                          />
                        </div>

                         <div className="mb-4">
                           <label className="block text-xs font-semibold text-slate-400 mb-1">Description</label>
                           <textarea
                             rows={3}
                             className="bg-[#0f172a] border border-[#334155] text-slate-200 text-sm rounded px-3 py-2 w-full focus:border-indigo-500 outline-none transition-colors resize-none"
                             placeholder="What is this room about?"
                             value={roomDesc}
                             onChange={(e) => setRoomDesc(e.target.value)}
                           />
                         </div>

                        <div className="mb-6 flex items-center justify-between bg-[#0f172a]/50 p-3 rounded border border-[#334155]">
                           <div>
                             <p className="text-sm font-medium text-slate-200">Private Room</p>
                             <p className="text-xs text-slate-500 mt-0.5">Hidden from the public directory. Only invited users can join.</p>
                           </div>
                           <label className="relative inline-flex items-center cursor-pointer">
                             <input type="checkbox" className="sr-only peer" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                             <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
                           </label>
                        </div>

                        <button 
                          onClick={handleSaveSettings}
                          disabled={isSavingSettings}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isSavingSettings ? 'Saving...' : 'Save Settings'}
                        </button>
                     </div>
                   )}

                   <div className="p-4 bg-[#1e293b]/50 border border-[#334155] rounded-lg">
                      <h3 className="text-sm font-bold text-slate-200 mb-2">My Membership</h3>
                      <p className="text-xs text-slate-400 mb-4">You can safely leave this room. You can rejoin later if the room is public, or if invited.</p>
                      <button 
                        onClick={handleLeaveRoom}
                        disabled={myRole === 'owner'}
                        className="flex items-center gap-2 text-sm px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <LogOut size={16} /> Leave Room
                      </button>
                      {myRole === 'owner' && <p className="text-xs text-amber-500 mt-2">The owner cannot leave the room. You must delete the room instead.</p>}
                   </div>

                   {myRole === 'owner' && (
                     <div className="p-4 bg-red-950/20 border border-red-900/50 rounded-lg">
                       <h3 className="text-sm font-bold text-red-400 mb-2">Danger Zone</h3>
                       <p className="text-xs text-slate-400 mb-4">Deleting this room will permanently wipe all message history and attached files from the server. This action cannot be reversed.</p>
                       <button 
                         onClick={handleDeleteRoom}
                         className="flex items-center gap-2 text-sm px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-lg shadow-red-900/20 transition-all"
                       >
                         <Trash2 size={16} /> Delete Room
                       </button>
                     </div>
                   )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Custom Popups ── */}
      {confirmAction && (
        <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setConfirmAction(null)}>
          <div className="bg-[#161b27] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${confirmAction.isDestructive ? 'bg-red-500/15 text-red-500' : 'bg-indigo-500/15 text-indigo-400'}`}>
                {confirmAction.isDestructive ? '⚠️' : '❓'}
              </div>
              <h3 className="text-lg font-bold text-slate-100">{confirmAction.title}</h3>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed mb-6 mt-3">{confirmAction.message}</p>
            <div className="flex gap-3 justify-end mt-4">
              <button onClick={() => setConfirmAction(null)} className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium text-slate-300 border border-white/10 transition">
                Cancel
              </button>
              <button 
                onClick={() => {
                  confirmAction.onConfirm();
                  setConfirmAction(null);
                }} 
                className={`px-5 py-2 rounded-lg text-sm font-bold text-white shadow-lg transition ${confirmAction.isDestructive ? 'bg-red-600 hover:bg-red-500 border border-red-500' : 'bg-indigo-600 hover:bg-indigo-500 border border-indigo-500'}`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {promptAction && (
        <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPromptAction(null)}>
          <div className="bg-[#161b27] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-indigo-500/15 text-indigo-400">
                📝
              </div>
              <h3 className="text-lg font-bold text-slate-100">{promptAction.title}</h3>
            </div>
            <input 
              type="text" 
              autoFocus
              className="w-full bg-[#0f172a] border border-[#334155] text-slate-200 text-sm rounded-lg px-4 py-3 focus:border-indigo-500 outline-none transition-colors mb-6"
              placeholder={promptAction.placeholder}
              value={promptInputValue}
              onChange={(e) => setPromptInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  promptAction.onConfirm(promptInputValue);
                  setPromptAction(null);
                } else if (e.key === 'Escape') {
                  setPromptAction(null);
                }
              }}
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setPromptAction(null)} className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium text-slate-300 border border-white/10 transition">
                Cancel
              </button>
              <button 
                onClick={() => {
                  promptAction.onConfirm(promptInputValue);
                  setPromptAction(null);
                }} 
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 rounded-lg text-sm font-bold text-white shadow-lg transition"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
