import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { Ban, Shield, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  is_globally_banned: boolean;
  created_at: string;
}

export function AdminDashboard() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const jwt = useAuthStore(s => s.jwt);
  const currentUser = useAuthStore(s => s.user);
  const navigate = useNavigate();

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/admin/users', {
        headers: {
          'Authorization': `Bearer ${jwt}`
        }
      });
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleBanToggle = async (targetUser: AdminUser) => {
    // Prevent banning self
    if (targetUser.id === currentUser?.id) return;
    
    try {
      const isBanning = !targetUser.is_globally_banned;
      const url = `/api/admin/users/${targetUser.id}/ban`;
      const method = isBanning ? 'POST' : 'DELETE';
      
      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type': 'application/json'
        },
        // Reason is optional but good to send an empty object if no reason
        body: isBanning ? JSON.stringify({ reason: 'Admin panel toggle' }) : undefined
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Action failed');
      }

      // Optimistic update
      setUsers(prev => prev.map(u => 
        u.id === targetUser.id 
          ? { ...u, is_globally_banned: isBanning } 
          : u
      ));
    } catch (err: any) {
      useChatStore.getState().addToast(`Error: ${err.message}`, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1117] text-gray-200 flex flex-col font-sans">
      {/* HEADER */}
      <header className="px-8 py-6 border-b border-gray-800 bg-[#161a26] flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/')}
            className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
            title="Back to App"
          >
            <ArrowLeft size={20} />
          </button>
          <Shield size={28} className="text-indigo-500" />
          <h1 className="text-2xl font-bold tracking-tight text-white">Admin Control Plane</h1>
        </div>
        
        <div className="flex items-center gap-3 bg-[#111318] border border-gray-800 py-1.5 px-3 rounded-lg shadow-inner text-sm">
          <span className="text-gray-400">Moderator:</span>
          <span className="font-semibold text-indigo-400">{currentUser?.username}</span>
        </div>
      </header>

      {/* BODY */}
      <main className="flex-1 p-8 overflow-y-auto w-full max-w-7xl mx-auto">
        <div className="mb-6 flex justify-between items-end">
          <div>
            <h2 className="text-xl font-semibold text-white mb-1">User Directory</h2>
            <p className="text-sm text-gray-400">Manage all registered accounts across the federation.</p>
          </div>
          <button 
            onClick={fetchUsers}
            className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 transition"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="animate-pulse flex space-x-4">
            <div className="flex-1 space-y-4 py-1">
              <div className="h-10 bg-gray-800 rounded"></div>
              <div className="h-10 bg-gray-800 rounded"></div>
              <div className="h-10 bg-gray-800 rounded"></div>
            </div>
          </div>
        ) : error ? (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded text-sm">
            {error}
          </div>
        ) : (
          <div className="bg-[#161a26] border border-gray-800 rounded-xl overflow-hidden shadow-2xl">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#111318]/80 text-gray-400 border-b border-gray-800 uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-6 py-4 font-semibold">User</th>
                  <th className="px-6 py-4 font-semibold">Email</th>
                  <th className="px-6 py-4 font-semibold">Role</th>
                  <th className="px-6 py-4 font-semibold">Joined</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {users.map(u => {
                  const isAdmin = u.role === 'admin';
                  const isSelf = u.id === currentUser?.id;
                  const isBanned = u.is_globally_banned;
                  
                  return (
                    <tr 
                      key={u.id} 
                      className={`hover:bg-[#1a1e2f] transition-colors ${isBanned ? 'opacity-60 bg-red-900/10' : ''}`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white shadow-sm
                            ${isAdmin ? 'bg-gradient-to-br from-amber-500 to-orange-600' : 'bg-gradient-to-br from-indigo-500 to-blue-600'}`}>
                            {u.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="font-medium text-gray-200">
                            {u.username}
                            {isSelf && <span className="ml-2 text-[10px] bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded-sm">YOU</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-400">
                        {u.email}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-[11px] font-bold px-2 py-1 rounded-md uppercase tracking-wide
                          ${isAdmin ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-500 text-xs">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {!isSelf && (
                          <button
                            onClick={() => handleBanToggle(u)}
                            className={`flex items-center gap-1.5 ml-auto px-3 py-1.5 rounded text-xs font-semibold border transition-all
                              ${isBanned 
                                ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700' 
                                : 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/30'
                              }`}
                          >
                            <Ban size={14} />
                            {isBanned ? 'Unban' : 'Ban User'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
