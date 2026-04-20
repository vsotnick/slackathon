import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useChatStore } from './chatStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface User {
  id: string;
  username: string;
  email: string;
  role?: string;
  friends_only_dms?: boolean;
}

interface XmppCredentials {
  jid: string;
  password: string;
  wsUrl: string;
}

interface AuthState {
  jwt: string | null;
  user: User | null;
  xmppCredentials: XmppCredentials | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
  updatePrivacySettings: (friendsOnlyDms: boolean) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  /** Rehydrate XMPP connection on page load if JWT exists in localStorage */
  rehydrateXmpp: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      jwt: null,
      user: null,
      xmppCredentials: null,
      isLoading: false,
      error: null,

      // -----------------------------------------------------------------------
      // login — POST /api/auth/login
      // -----------------------------------------------------------------------
      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.message || 'Login failed');
          }

          // Store auth state
          set({
            jwt: data.jwt,
            user: data.user,
            xmppCredentials: data.xmpp,
            isLoading: false,
            error: null,
          });

          // 🔑 ARCHITECTURAL DIRECTIVE: Immediately connect the XMPP singleton
          // after a successful login so the WebSocket is ready before navigation.
          useChatStore.getState().connect(
            data.xmpp.jid,
            data.xmpp.password,
            data.xmpp.wsUrl,
            data.jwt,
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Login failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },

      // -----------------------------------------------------------------------
      // register — POST /api/auth/register
      // -----------------------------------------------------------------------
      register: async (username, email, password) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password }),
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.message || 'Registration failed');
          }

          // Registration returns the same JWT + XMPP payload as login
          set({
            jwt: data.jwt,
            user: data.user,
            xmppCredentials: data.xmpp,
            isLoading: false,
            error: null,
          });

          // 🔑 Connect immediately after registration too
          useChatStore.getState().connect(
            data.xmpp.jid,
            data.xmpp.password,
            data.xmpp.wsUrl,
            data.jwt,
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Registration failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },

      updateUser: (updates) => {
        set((state) => ({ user: state.user ? { ...state.user, ...updates } : null }));
      },

      updatePrivacySettings: async (friendsOnlyDms: boolean) => {
        const { jwt, user } = get();
        if (!jwt || !user) return;
        
        try {
          const res = await fetch('/api/users/me/privacy', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${jwt}`
            },
            body: JSON.stringify({ friends_only_dms: friendsOnlyDms })
          });
          
          if (!res.ok) throw new Error('Failed to update privacy settings');
          
          set((state) => ({
            user: state.user ? { ...state.user, friends_only_dms: friendsOnlyDms } : null
          }));
        } catch (err: unknown) {
          console.error('[authStore] updatePrivacySettings failed', err);
          throw err;
        }
      },

      // -----------------------------------------------------------------------
      // logout — Clear all state and disconnect XMPP
      // -----------------------------------------------------------------------
      logout: () => {
        useChatStore.getState().disconnect();
        set({ jwt: null, user: null, xmppCredentials: null, error: null });
      },

      clearError: () => set({ error: null }),

      // -----------------------------------------------------------------------
      // rehydrateXmpp — Called on app mount to reconnect if JWT exists.
      // zustand/persist restores jwt + xmppCredentials from localStorage.
      // We then call connect() to restart the XMPP WebSocket.
      // -----------------------------------------------------------------------
      rehydrateXmpp: () => {
        const { jwt, xmppCredentials } = get();
        if (jwt && xmppCredentials) {
          useChatStore.getState().connect(
            xmppCredentials.jid,
            xmppCredentials.password,
            xmppCredentials.wsUrl,
            jwt,
          );
        }
      },
    }),
    {
      name: 'slackathon-auth', // localStorage key
      // Only persist credentials — NOT loading/error state
      partialize: (state) => ({
        jwt: state.jwt,
        user: state.user,
        xmppCredentials: state.xmppCredentials,
      }),
    }
  )
);
