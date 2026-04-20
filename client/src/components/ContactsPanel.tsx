import { useState } from 'react';
import { useChatStore } from '../store/chatStore';
import { UserCheck, UserPlus, UserX, Ban, UserMinus, ShieldAlert, MessageSquare } from 'lucide-react';

export function ContactsPanel() {
  const { users, friendships, blockedUsers, sendFriendRequest, acceptFriendRequest, removeFriend, blockUser, unblockUser, addToast } = useChatStore();
  
  const [activeTab, setActiveTab] = useState<'friends' | 'pending' | 'blocked'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [addingUserId, setAddingUserId] = useState<string | null>(null);

  const friends = friendships.filter(f => f.status === 'accepted');
  const pending = friendships.filter(f => f.status === 'pending');

  const filteredFriends = friends.filter(f => f.username.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredPending = pending.filter(f => f.username.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredBlocked = blockedUsers.filter(b => b.username.toLowerCase().includes(searchQuery.toLowerCase()));

  // Find users in the global directory who match the search and aren't already categorized
  const query = searchQuery.trim().toLowerCase();
  const globalMatches = query.length >= 2 
    ? users.filter(u => 
        u.username.toLowerCase().includes(query) &&
        !friendships.some(f => f.user_id === u.id) &&
        !blockedUsers.some(b => b.user_id === u.id)
      )
    : [];

  const goToDM = (user: any) => {
    const chatUser = { id: user.user_id, username: user.username, jid: user.jid, email: '', role: 'user', created_at: '', updated_at: '', status: 'offline' as const };
    useChatStore.getState().setActiveDm(chatUser);
  };

  const handleSendRequest = async (userId: string) => {
    setAddingUserId(userId);
    await sendFriendRequest(userId);
    setAddingUserId(null);
  };

  return (
    <div className="flex flex-col h-full bg-[#111318]">
      
      {/* Unified Search Bar */}
      <div className="p-4 border-b border-white/5 bg-[#111318]">
        <input 
          type="text" 
          placeholder="Search contacts or find users..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-slate-800/50 border border-slate-700/50 rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-500"
        />
      </div>

      {/* Internal Tabs */}
      <div className="flex border-b border-white/5 bg-[#1e293b]/30">
        <button onClick={() => setActiveTab('friends')} className={`flex-1 py-2 text-xs font-semibold transition-colors ${activeTab === 'friends' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}>
          Friends ({friends.length})
        </button>
        <button onClick={() => setActiveTab('pending')} className={`flex-1 py-2 text-xs font-semibold transition-colors ${activeTab === 'pending' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}>
          Pending ({pending.length})
        </button>
        <button onClick={() => setActiveTab('blocked')} className={`flex-1 py-2 text-xs font-semibold transition-colors ${activeTab === 'blocked' ? 'text-red-400 border-b-2 border-red-400' : 'text-slate-500 hover:text-slate-300'}`}>
          Blocked ({blockedUsers.length})
        </button>
      </div>

      {/* Lists */}
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        
        {/* Global Directory Results (Overlay at top if searching) */}
        {globalMatches.length > 0 && activeTab === 'friends' && (
          <div className="mb-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-2">Global Directory</h3>
            <div className="flex flex-col gap-1">
              {globalMatches.map(u => (
                <div key={u.id} className="flex items-center justify-between p-2 py-2.5 rounded bg-indigo-500/5 border border-indigo-500/10 hover:bg-indigo-500/10 group transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-8 h-8 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                        {u.username[0].toUpperCase()}
                      </div>
                    </div>
                    <span className="text-sm font-medium text-slate-200">{u.username}</span>
                  </div>
                  <button 
                    onClick={() => handleSendRequest(u.id)}
                    disabled={addingUserId === u.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/20 text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/30 text-xs font-semibold rounded transition-colors disabled:opacity-50"
                  >
                    <UserPlus size={14} />
                    {addingUserId === u.id ? 'Adding...' : 'Add Friend'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Existing Contacts Lists */}
        <div>
          {query.length >= 2 && globalMatches.length > 0 && activeTab === 'friends' && (
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-2">My Contacts</h3>
          )}
          
          {activeTab === 'friends' && (
            <div className="flex flex-col gap-1">
              {filteredFriends.length === 0 && <div className="text-center py-6 text-xs text-slate-500">No friends found.</div>}
              {filteredFriends.map(f => (
                <div key={f.user_id} className="flex items-center justify-between p-2 rounded hover:bg-slate-800/50 group transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-8 h-8 rounded bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                        {f.username[0].toUpperCase()}
                      </div>
                    </div>
                    <span className="text-sm font-medium text-slate-200">{f.username}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => goToDM(f)} title="Message" className="p-1.5 text-indigo-400 hover:bg-indigo-500/20 rounded transition-colors">
                      <MessageSquare size={14} />
                    </button>
                    <button onClick={() => removeFriend(f.user_id)} title="Remove Friend" className="p-1.5 text-slate-400 hover:text-red-400 bg-slate-800 hover:bg-slate-700 rounded transition-colors">
                      <UserMinus size={14} />
                    </button>
                    <button onClick={() => blockUser(f.user_id)} title="Block User" className="p-1.5 text-slate-400 hover:text-red-400 bg-slate-800 hover:bg-slate-700 rounded transition-colors">
                      <Ban size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'pending' && (
            <div className="flex flex-col gap-1">
              {filteredPending.length === 0 && <div className="text-center py-6 text-xs text-slate-500">No pending requests found.</div>}
              {filteredPending.map(f => {
                const isIncoming = f.requester_id === f.user_id;
                return (
                  <div key={f.user_id} className="flex items-center justify-between p-2 rounded bg-slate-800/30 border border-slate-700/50">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center text-slate-300 font-bold text-sm">
                        {f.username[0].toUpperCase()}
                      </div>
                      <div>
                        <span className="text-sm font-medium text-slate-200 block">{f.username}</span>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">{isIncoming ? 'Incoming Request' : 'Sent Request'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isIncoming ? (
                        <>
                          <button onClick={() => acceptFriendRequest(f.user_id, f.jid)} className="p-1.5 text-green-400 hover:bg-green-400/10 rounded transition-colors" title="Accept">
                            <UserCheck size={16} />
                          </button>
                          <button onClick={() => removeFriend(f.user_id)} className="p-1.5 text-red-400 hover:bg-red-400/10 rounded transition-colors" title="Decline">
                            <UserX size={16} />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => removeFriend(f.user_id)} className="text-xs px-2 py-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors">
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'blocked' && (
            <div className="flex flex-col gap-1">
              {filteredBlocked.length === 0 && <div className="text-center py-6 text-xs text-slate-500">No blocked users found.</div>}
              {filteredBlocked.map(b => (
                <div key={b.user_id} className="flex items-center justify-between p-2 rounded bg-red-900/10 border border-red-900/30">
                  <div className="flex items-center gap-2 text-red-400">
                    <ShieldAlert size={16} />
                    <span className="text-sm font-medium">{b.username}</span>
                  </div>
                  <button onClick={() => unblockUser(b.user_id)} className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors">
                    Unblock
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
