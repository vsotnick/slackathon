import { create } from 'zustand';
import { client as createXmppClient, xml } from '@xmpp/client';
import type { Message, Room, ChatUser, ActiveChat, MessageType } from '../types/chat';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export type XmppStatus = 'offline' | 'connecting' | 'online' | 'error';

const XMLNS_MUC       = 'http://jabber.org/protocol/muc';
const XMLNS_MUC_USER  = 'http://jabber.org/protocol/muc#user';
const XMLNS_EPHEMERAL = 'urn:slackathon:ephemeral';

// ── Ephemeral TTL (reduce to 2 min for testing; set back to 15 * 60 * 1000 for prod) ──
const EPHEMERAL_TTL_MS = 2 * 60 * 1000; // 2 minutes

// ── Burned-IDs: persisted across page refreshes so ephemeral msgs
//    never reappear from MAM history after being burned / expired. ──
const SK_BURNED_KEY = 'sk_ephemeral_burned';
function persistBurn(id: string): void {
  try {
    const arr = JSON.parse(localStorage.getItem(SK_BURNED_KEY) ?? '[]') as string[];
    if (!arr.includes(id)) { arr.push(id); localStorage.setItem(SK_BURNED_KEY, JSON.stringify(arr)); }
  } catch { /* storage unavailable — skip */ }
}
function getBurnedSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SK_BURNED_KEY) ?? '[]') as string[]); }
  catch { return new Set(); }
}

const SK_LAST_READ_KEY = 'sk_last_read';
function persistLastRead(dict: Record<string, string | null>): void {
  try { localStorage.setItem(SK_LAST_READ_KEY, JSON.stringify(dict)); }
  catch { /* skip */ }
}
function getPersistedLastReads(): Record<string, string | null> {
  try { return JSON.parse(localStorage.getItem(SK_LAST_READ_KEY) ?? '{}') as Record<string, string | null>; }
  catch { return {}; }
}

// Module-level TTL sweep interval handle
let _ttlSweepId: ReturnType<typeof setInterval> | null = null;
let _presenceSyncId: ReturnType<typeof setInterval> | null = null;

// Module-level stable empties — NEVER use `?? []` / `?? {}` inside a
// Zustand selector. Object.is would always see a new reference → infinite loop.
const EMPTY_MESSAGES: Message[] = [];

// ---------------------------------------------------------------------------
// Prosody MAM stanza parser
// ---------------------------------------------------------------------------
function parseArchivedStanza(stanzaXml: string, roomJid: string, whenUnix: number, isDm: boolean = false): Message | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(stanzaXml, 'text/xml');
    if (doc.querySelector('parsererror')) return null;

    const msg = doc.querySelector('message');
    if (!msg) return null;

    const bodyEl = msg.querySelector('body');
    if (!bodyEl?.textContent) return null;

    const rawBody = bodyEl.textContent;
    const from    = msg.getAttribute('from') ?? '';
    const msgId   = msg.getAttribute('id')   ?? crypto.randomUUID();

    const slash  = from.indexOf('/');
    // Fix: For DMs, the sender is the bare JID prefix. For MUCs, it's the resource (nick).
    const sender = isDm ? from.split('@')[0] : (slash >= 0 ? from.slice(slash + 1) : from.split('@')[0]);

    let msgType: MessageType = 'text';
    let msgBody = rawBody;
    let replaceId, retractId;

    const replaceEl = msg.querySelector('replace[xmlns="urn:xmpp:message-correct:0"]');
    const retractEl = msg.querySelector('apply-to[xmlns="urn:xmpp:fasten:0"] > retract[xmlns="urn:xmpp:message-retract:0"]');

    if (replaceEl) {
      msgType = 'replace';
      replaceId = replaceEl.getAttribute('id') || undefined;
    } else if (retractEl) {
      msgType = 'retract';
      retractId = msg.querySelector('apply-to')?.getAttribute('id') || undefined;
    }

    const hasEphemeralExt = !!msg.querySelector(`[xmlns="${XMLNS_EPHEMERAL}"]`);
    if (hasEphemeralExt) {
      msgType = 'ephemeral';
      try {
        const p = JSON.parse(rawBody) as { content?: string };
        if (p.content) msgBody = p.content;
      } catch { /* raw */ }
    } else {
      try {
        const p = JSON.parse(rawBody) as { type?: string; content?: string };
        if (p.type === 'ephemeral' && p.content) { msgType = 'ephemeral'; msgBody = p.content; }
      } catch { /* plain text */ }
    }

    // Re-attach expiresAt from the JSON payload so TTL is honoured after refresh
    let expiresAt: number | undefined;
    try {
      const p = JSON.parse(rawBody) as { expiresAt?: number };
      if (p.expiresAt) expiresAt = p.expiresAt;
    } catch { /* plain text body */ }

    // Extract file attachment payloads and reply context payloads
    let fileId, fileName, mimeType;
    let replyTo, replyText;
    try {
      const p = JSON.parse(rawBody) as { type?: string; fileId?: string; fileName?: string; mimeType?: string; content?: string; replyTo?: string; replyText?: string };
      if (p.type === 'file_ref' && p.fileId) {
        msgType = 'file_ref';
        msgBody = p.content || 'Sent an attachment'; // Optional fallback body
        fileId = p.fileId;
        fileName = p.fileName;
        mimeType = p.mimeType;
      } else if (p.type === 'chat' && p.replyTo) {
        msgBody = p.content || '';
        replyTo = p.replyTo;
        replyText = p.replyText;
      }
    } catch { /* plain text body */ }

    return { id: msgId, roomJid, sender, senderName: sender, body: msgBody, type: msgType,
             timestamp: new Date(whenUnix * 1000).toISOString(), expiresAt, fileId, fileName, mimeType, replaceId, retractId, replyTo, replyText };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Authenticated fetch helper
// ---------------------------------------------------------------------------
async function apiFetch(jwt: string, path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, ...opts.headers },
  });
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------
interface ChatState {
  // ── XMPP connection ───────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  xmpp:       any | null;
  status:     XmppStatus;
  error:      string | null;
  address:    string | null;
  pendingJid: string | null;
  myNick:     string | null;

  // ── Auth token (stored to avoid circular import with authStore) ───────────
  jwt: string | null;

  // ── MUC join tracking ─────────────────────────────────────────────────────
  joinedRooms: Record<string, boolean>;

  /** Live roster: maps roomJid → array of usernames currently in the room.
   *  Updated on every MUC `<presence>` stanza (join = add, unavailable = remove). */
  roomMembers: Record<string, string[]>;

  // ── Rooms ─────────────────────────────────────────────────────────────────
  rooms:        Room[];
  roomsLoading: boolean;

  // ── Users (Phase 2.6) ─────────────────────────────────────────────────────
  users:        ChatUser[];
  usersLoading: boolean;
  userPresence: Record<string, ChatUser['status']>;

  // ── Friendships (Epic 2) ──────────────────────────────────────────────────
  friendships: any[];
  blockedUsers: any[];
  
  /** Track targeted user for modal when attempting to DM a restrictive user */
  friendRequestPromptTarget: ChatUser | null;
  setFriendRequestPromptTarget: (user: ChatUser | null) => void;

  fetchFriends: () => Promise<void>;
  sendFriendRequest: (userId: string) => Promise<void>;
  acceptFriendRequest: (userId: string, userJid?: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
  blockUser: (userId: string) => Promise<void>;
  unblockUser: (userId: string) => Promise<void>;
  fetchActiveDms: () => Promise<void>;

  /**
   * Fix 6b: JIDs of users with active DM history (sent or received).
   * The DIRECT section in the sidebar only renders these users.
   * Populated when a DM message is sent or received.
   */
  activeDms: string[];

  // ── Active conversation (Phase 2.6 unified state) ─────────────────────────
  /**
   * Unified descriptor for the current conversation.
   * type='room' → MUC; type='dm' → 1-on-1 chat.
   * Step 2 of Phase 2.6 will migrate all UI reads to this field.
   */
  activeChat: ActiveChat | null;
  /** Phase 2.10: XEP-0461 message reply target anchor */
  activeReply: Message | null;

  /**
   * Backward-compat alias for activeChat.jid.
   * Kept so existing UI components (ChatHeader, MessageList, ChatInput, AIPanel,
   * Sidebar unread counts) continue to work during Phase 2.6 Step 1.
   * Will be removed in Phase 2.6 Step 2 after UI is migrated to `activeChat`.
   */
  activeRoomJid: string;

  // ── Messages (shared dict for both rooms and DMs) ─────────────────────────
  messages:         Record<string, Message[]>;
  lastReadAts:      Record<string, string | null>;
  historyCursors:   Record<string, string | number>;
  hasMoreHistory:   Record<string, boolean>;
  isLoadingHistory: Record<string, boolean>;

  // ── Toasts ────────────────────────────────────────────────────────────────
  toasts: Toast[];
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  removeToast: (id: string) => void;

  // ──────────────────────────────────────────────────────────────────────────
  // Actions
  // ──────────────────────────────────────────────────────────────────────────
  connect:    (jid: string, password: string, wsUrl: string, jwt: string) => void;
  disconnect: () => void;

  fetchRooms:      () => Promise<void>;
  fetchUsers:      () => Promise<void>;
  createRoom:      (name: string, description?: string, isPrivate?: boolean) => Promise<Room>;
  fetchRoomHistory:(room: Room, loadMore?: boolean) => Promise<void>;
  fetchDmHistory:  (user: Pick<ChatUser, 'id' | 'username' | 'jid'>, loadMore?: boolean) => Promise<void>;
  joinRoom:        (roomJid: string) => void;

  /**
   * Switch to a MUC room:
   *   1. sets activeChat + activeRoomJid
   *   2. fetches MAM history via REST
   *   3. sends XMPP <presence> join after history loaded
   */
  setActiveRoom: (roomJid: string) => void;

  /**
   * Open a 1-on-1 DM conversation with a user.
   * Sets activeChat.type='dm' and uses the user's bare JID as the messages key.
   * No XMPP room join needed; no history fetch (Phase 2.6 scope).
   */
  setActiveDm: (user: ChatUser) => void;

  /**
   * Send a message to the active conversation.
   * Routes as <message type="groupchat"> for rooms, <message type="chat"> for DMs.
   * MUC messages are gated on joinedRooms[jid]; DM messages are not.
   */
  sendMessage: (roomJid: string, text: string, secure: boolean) => void;
  /** Edit an existing standard message */
  editMessage: (roomJid: string, originalMsgId: string, newText: string) => void;

  addMessage:     (msg: Message) => void;
  removeMessage:  (id: string, roomJid: string) => void;
  retractMessage: (roomJid: string, msgId: string) => void;
  /** Toggle an emoji reaction on a message (local optimistic update) */
  toggleReaction: (roomJid: string, msgId: string, emoji: string, username: string) => void;
  markAsRead:     (roomJid: string) => void;
  markAsReadUpTo: (roomJid: string, timestamp: string) => void;
  /**
   * Burn an ephemeral message:
   *  - Always persists the ID to localStorage (survives refresh)
   *  - MUC rooms: local-only delete (no broadcast)
   *  - DMs: broadcasts XEP-0424 retraction so the peer also removes it
   */
  burnEphemeral:  (msgId: string, roomJid: string, isDm: boolean) => void;
  setReplyTarget: (msg: Message | null) => void;

  // ── Epic 1: Room Moderation / Management ──────────────────────────────────
  updateRoomMemberRole: (roomId: string, userId: string, role: 'member' | 'admin' | 'moderator') => Promise<void>;
  kickRoomMember: (roomId: string, userId: string, reason?: string) => Promise<void>;
  banRoomMember:  (roomId: string, userId: string, reason?: string) => Promise<void>;
  updateRoomSettings: (roomId: string, updates: { name?: string; description?: string; is_private?: boolean }) => Promise<void>;
  leaveRoom:      (roomId: string) => Promise<void>;
  deleteRoom:     (roomId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------
export const useChatStore = create<ChatState>()((set, get) => ({
  // ── Initial state ─────────────────────────────────────────────────────────
  xmpp:         null,
  status:       'offline',
  error:        null,
  address:      null,
  pendingJid:   null,
  myNick:       null,
  jwt:          null,
  joinedRooms:  {},
  roomMembers:  {},
  rooms:        [],
  roomsLoading: false,
  users:        [],
  usersLoading: false,
  userPresence: {},
  friendships:  [],
  blockedUsers: [],
  friendRequestPromptTarget: null,
  activeDms:    [],
  activeChat:   null,
  activeReply:  null,
  activeRoomJid: '',
  
  messages:         {},
  lastReadAts:      getPersistedLastReads(),
  historyCursors:   {},
  hasMoreHistory:   {},
  isLoadingHistory: {},

  toasts: [],
  addToast: (message, type = 'info') => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
    setTimeout(() => {
      get().removeToast(id);
    }, 3000);
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  setFriendRequestPromptTarget: (user) => set({ friendRequestPromptTarget: user }),

  // ──────────────────────────────────────────────────────────────────────────
  // connect
  // ──────────────────────────────────────────────────────────────────────────
  connect: (jid, password, wsUrl, jwt) => {
    const current = get();
    const bareJid = jid.split('/')[0];

    if (
      (current.status === 'connecting' || current.status === 'online') &&
      current.pendingJid === bareJid
    ) return;

    if (current.xmpp) current.xmpp.stop().catch(() => {});

    set({ 
      status: 'connecting', error: null, address: null, pendingJid: bareJid, 
      joinedRooms: {}, jwt, lastReadAts: getPersistedLastReads() 
    });

    const domain   = bareJid.split('@')[1];
    const username = bareJid.split('@')[0];

    const xmpp = createXmppClient({ service: wsUrl, domain, resource: `web-${Math.random().toString(36).substring(2, 8)}`, username, password });

    // ── online ───────────────────────────────────────────────────────────────
    xmpp.on('online', (addr: { toString: () => string }) => {
      const address = addr.toString();
      const myNick  = address.split('@')[0];
      console.log('[chatStore] ✓ XMPP online:', address);
      set({ status: 'online', address, myNick, error: null });

      // Initial available presence (required before any MUC joins)
      xmpp.send(xml('presence')).catch(console.warn);

      // Start presence and friendships sync loop (Epic 2 real-time sync)
      if (_presenceSyncId) clearInterval(_presenceSyncId);
      _presenceSyncId = setInterval(() => {
        // Broadcast global presence for MUC occupant tracking
        xmpp.send(xml('presence')).catch(() => {});
        
        // Directly push our live presence status securely to all accepted friends AND active DM participants!
        // This guarantees perfect 1-to-1 sync reliability bypassing complex server roster dependencies.
        const syncTargets = new Set<string>();
        get().friendships
          .filter(f => f.status === 'accepted')
          .forEach(f => { if (f.jid) syncTargets.add(f.jid); });
        
        get().activeDms.forEach(jid => syncTargets.add(jid));
        
        syncTargets.forEach(jid => xmpp.send(xml('presence', { to: jid })).catch(() => {}));

        // Poll for new pending friend requests/acceptances every 15s
        if (get().jwt) get().fetchFriends();
      }, 15_000);

      // ── TTL sweep — every 15s auto-removes expired ephemeral messages
      if (_ttlSweepId) clearInterval(_ttlSweepId);
      _ttlSweepId = setInterval(() => {
        const now = Date.now();
        const { messages } = get();
        Object.entries(messages).forEach(([roomJid, msgs]) => {
          msgs.forEach((msg) => {
            if (msg.type === 'ephemeral' && msg.expiresAt && msg.expiresAt <= now) {
              persistBurn(msg.id);
              get().removeMessage(msg.id, roomJid);
            }
          });
        });
      }, 15_000);

      // Phase 2.6: fetch rooms + users in parallel, then set up conversations
      // Epic 2: also fetch friendships and active DMs
      Promise.all([get().fetchRooms(), get().fetchUsers(), get().fetchFriends(), get().fetchActiveDms()]).then(() => {
        const { rooms, friendships } = get();

        // Push our initial live explicit presence status perfectly to every single accepted friend
        // and active DM participant right as we execute our application cold-start!
        const coldStartTargets = new Set<string>();
        get().friendships
          .filter(f => f.status === 'accepted')
          .forEach(f => { if (f.jid) coldStartTargets.add(f.jid); });
        
        get().activeDms.forEach(jid => coldStartTargets.add(jid));
        
        coldStartTargets.forEach(jid => xmpp.send(xml('presence', { to: jid })).catch(() => {}));

        // Set first room active (fetches history + joins MUC inside setActiveRoom)
        if (rooms.length > 0 && !get().activeChat) {
          get().setActiveRoom(rooms[0].jid);
        }

        // Background: join all MUC rooms (active room already joined above)
        setTimeout(() => {
          get().rooms
            .filter((r) => r.kind === 'muc')
            .forEach((r) => {
              if (r.jid !== get().activeChat?.jid) get().joinRoom(r.jid);
            });
        }, 300);
      });
    });

    // ── error ─────────────────────────────────────────────────────────────────
    xmpp.on('error', (err: Error) => {
      const msg = err.message ?? String(err);
      const isTransient = msg.includes('ECONNRESET') || msg.includes('closed before') || msg.includes('connection was closed');
      if (isTransient) return;
      console.error('[chatStore] XMPP error:', msg);
      set((s) => ({ status: s.status === 'offline' ? 'offline' : 'error', error: msg }));
    });

    // ── offline ───────────────────────────────────────────────────────────────
    xmpp.on('offline', () => {
      set({ status: 'offline', address: null, myNick: null, joinedRooms: {} });
    });

    // ── Stanza middleware ─────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (xmpp as any).middleware.use(async (ctx: any, next: () => Promise<void>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stanza: any = ctx.stanza;

      // ── PRESENCE ──────────────────────────────────────────────────────────
      if (stanza.is('presence')) {
        const from     = (stanza.attrs.from as string) ?? '';
        const presType = (stanza.attrs.type  as string) ?? '';

        // ── Auto-approve incoming presence subscriptions (Epic 2) ────────────
        // Required for the presence subscription handshake (XEP-0093).
        // Only approve if they are an accepted friend!
        if (presType === 'subscribe') {
          const bareFrom = from.split('/')[0];
          const isFriend = get().friendships.some(f => f.status === 'accepted' && f.jid === bareFrom);
          if (isFriend) {
            xmpp.send(xml('presence', { type: 'subscribed', to: bareFrom })).catch(() => {});
          } else {
            // Might be a new friend request just accepted by the other side.
            // Fetch friends instantly so UI updates without refreshing!
            get().fetchFriends();
          }
          return next();
        }

        // ── MUC presence (has x xmlns muc#user) ───────────────────────────
        const xUser = stanza.getChild('x', XMLNS_MUC_USER);
        if (xUser) {
          const roomJid  = from.split('/')[0];
          const username = from.includes('/') ? from.split('/')[1] : null;

          // XEP-0045 §7.2.6 — self-presence echo (status code 110) confirms MUC join
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const isSelf = xUser.getChildren('status').some((s: any) => s.attrs.code === '110');
          if (isSelf) {
            set((state) => ({ joinedRooms: { ...state.joinedRooms, [roomJid]: true } }));
            console.log('[chatStore] ✓ MUC join confirmed:', roomJid);
          }

          // Track room membership for every member (not just self)
          if (username) {
            if (presType === 'unavailable') {
              // User left the room — remove from roster
              set((state) => ({
                roomMembers: {
                  ...state.roomMembers,
                  [roomJid]: (state.roomMembers[roomJid] ?? []).filter((u) => u !== username),
                },
              }));
            } else {
              // User joined or is present — add (dedup)
              set((state) => {
                const current = state.roomMembers[roomJid] ?? [];
                if (current.includes(username)) return state; // already tracked
                return {
                  roomMembers: { ...state.roomMembers, [roomJid]: [...current, username] },
                };
              });
            }
          }

          if (presType === 'error') {
            console.warn('[chatStore] MUC presence error from', from, stanza.getChild('error')?.toString());
          }
          return next();
        }

        // ── Regular user presence (Phase 2.6 — updates sidebar dots) ──────
        if (from && presType !== 'error') {
          const bareJid = from.split('/')[0];
          const showEl  = stanza.getChild('show');

          let status: ChatUser['status'];
          if (presType === 'unavailable') {
            status = 'offline';
          } else if (showEl?.textContent === 'away' || showEl?.textContent === 'xa') {
            status = 'away';
          } else {
            status = 'online';
          }

          set((state) => ({
            userPresence: { ...state.userPresence, [bareJid]: status },
            users: state.users.map((u) => u.jid === bareJid ? { ...u, status } : u),
          }));
        }

        return next();
      }

      // ── MESSAGE ───────────────────────────────────────────────────────────
      if (!stanza.is('message')) return next();

      // ── XEP-0424 Message Retraction ──────────────────────────────────────
      const applyTo = stanza.getChild('apply-to', 'urn:xmpp:fasten:0');
      if (applyTo?.getChild('retract', 'urn:xmpp:message-retract:0')) {
        const retractedId = applyTo.attrs.id as string;
        const retractFrom = stanza.attrs.from as string;
        if (retractedId && retractFrom) {
          const slash       = retractFrom.indexOf('/');
          const retractRoom = slash >= 0 ? retractFrom.slice(0, slash) : retractFrom;
          console.log('[chatStore] ← retraction:', retractedId, 'from', retractRoom);
          get().removeMessage(retractedId, retractRoom);
        }
        return next();
      }

      // ── XEP-0308 Last Message Correction ───────────────────────────────────
      const replaceEl = stanza.getChild('replace', 'urn:xmpp:message-correct:0');
      if (replaceEl) {
        const originalId = replaceEl.attrs.id as string;
        const newBody = stanza.getChildText('body');
        const replaceFrom = stanza.attrs.from as string;
        if (originalId && newBody && replaceFrom) {
          const slash = replaceFrom.indexOf('/');
          const replaceRoom = slash >= 0 ? replaceFrom.slice(0, slash) : replaceFrom;
          console.log('[chatStore] ← correction:', originalId, 'from', replaceRoom);
          
          set((state) => {
            const msgs = state.messages[replaceRoom] || [];
            const updated = msgs.map((m) =>
              m.id === originalId ? { ...m, body: newBody, isEdited: true } : m
            );
            return { messages: { ...state.messages, [replaceRoom]: updated } };
          });
        }
        return next();
      }

      const body = stanza.getChildText('body');
      if (!body) return next();

      // Phase 2.9 (Task 3): Real-Time Invite Sync listener
      try {
        const payload = JSON.parse(body);
        if (payload && payload.type === 'system_refresh_rooms') {
          console.log('[chatStore] Received system_refresh_rooms. Reloading rooms...');
          get().fetchRooms();
          return next();
        }
      } catch { /* not json */ }

      const from  = stanza.attrs.from as string;
      const type  = stanza.attrs.type  as string;
      const msgId = (stanza.attrs.id   as string) || crypto.randomUUID();

      let sender: string;
      let senderName: string;
      let roomJid: string;

      if (type === 'groupchat') {
        // ── MUC groupchat message ────────────────────────────────────────────
        const slash = from.indexOf('/');
        roomJid    = from.slice(0, slash);
        sender     = from.slice(slash + 1);
        senderName = sender;

      } else if (type === 'chat') {
        // ── 1-on-1 DM message ────────────────────────────────────────────────
        // Fix 2: strip the resource suffix from the `from` JID before matching.
        // A full JID looks like "alice@servera.local/slackathon-web"; without
        // stripping, the conversation bucket never matches the stored bare JID
        // and the message is silently dropped from the UI.
        const senderBare    = from.split('/')[0];          // ← resource stripped
        const recipientBare = ((stanza.attrs.to as string) ?? '').split('/')[0];
        const myBare        = (get().address ?? '').split('/')[0];

        // Determine the conversation "bucket" — always the OTHER person's bare JID.
        // If this is an echo of our own sent message (e.g. from carbons),
        // use the recipient. If it's an incoming message, use the sender.
        roomJid    = senderBare === myBare ? recipientBare : senderBare;
        sender     = senderBare.split('@')[0];
        senderName = sender;

        // Epic 2: blocked user message filter (execute BEFORE modifying activeDms)
        if (get().blockedUsers.some(b => b.username === sender)) {
           return next(); // Silently drop incoming DMs from blocked users
        }

        // Fix 6b: mark this JID as having active DM history
        set((state) => ({
          activeDms: state.activeDms.includes(roomJid)
            ? state.activeDms
            : [...state.activeDms, roomJid],
        }));

      } else {
        return next();
      }

      // Determine ephemeral payload — extract expiresAt for TTL tracking
      let msgType: MessageType = 'text';
      let msgBody = body;
      let expiresAt: number | undefined;
      let fileId, fileName, mimeType, replyTo, replyText;

      if (stanza.getChild('ephemeral', XMLNS_EPHEMERAL)) {
        msgType = 'ephemeral';
        try {
          const p = JSON.parse(body) as { content?: string; expiresAt?: number };
          if (p.content) msgBody = p.content;
          if (p.expiresAt) expiresAt = p.expiresAt;
        } catch { msgBody = body; }
      } else {
        try {
          const p = JSON.parse(body) as { type?: string; content?: string; expiresAt?: number; fileId?: string; fileName?: string; mimeType?: string; replyTo?: string; replyText?: string };
          if (p.type === 'ephemeral' && p.content) {
            msgType = 'ephemeral';
            msgBody = p.content;
            if (p.expiresAt) expiresAt = p.expiresAt;
          } else if (p.type === 'file_ref' && p.fileId) {
            msgType = 'file_ref';
            msgBody = p.content || 'Sent an attachment';
            fileId = p.fileId;
            fileName = p.fileName;
            mimeType = p.mimeType;
            expiresAt = undefined; // Files dont expire like ephemeral msgs in Phase 1
          } else if (p.type === 'chat' && p.replyTo) {
            msgBody = p.content || '';
            replyTo = p.replyTo;
            replyText = p.replyText;
          }
        } catch { /* plain text */ }
      }

      // Skip if already burned or expired
      const burned = getBurnedSet();
      if (burned.has(msgId)) return next();
      if (msgType === 'ephemeral' && expiresAt && expiresAt <= Date.now()) {
        persistBurn(msgId);
        return next();
      }

      // addMessage has built-in ID dedup — safe to call unconditionally
      get().addMessage({
        id: msgId, roomJid, sender, senderName,
        body: msgBody, type: msgType,
        timestamp: new Date().toISOString(),
        expiresAt, fileId, fileName, mimeType, replyTo, replyText
      });

      return next();
    });

    set({ xmpp });
    xmpp.start().catch((err: Error) => {
      console.error('[chatStore] Failed to start XMPP:', err.message);
      set({ status: 'error', error: err.message });
    });
  },

  // ──────────────────────────────────────────────────────────────────────────
  // disconnect
  // ──────────────────────────────────────────────────────────────────────────
  disconnect: () => {
    // Stop TTL sweep
    if (_ttlSweepId) { clearInterval(_ttlSweepId); _ttlSweepId = null; }
    const { xmpp } = get();
    if (xmpp) xmpp.stop().catch(() => {});
    set({
      xmpp: null, status: 'offline', error: null, address: null,
      pendingJid: null, myNick: null, jwt: null, joinedRooms: {}, roomMembers: {},
      rooms: [], users: [], friendships: [], blockedUsers: [], activeDms: [], activeChat: null, activeRoomJid: '',
      messages: {}, lastReadAts: {},
    });
  },

  // ──────────────────────────────────────────────────────────────────────────
  // fetchRooms — GET /api/rooms
  // ──────────────────────────────────────────────────────────────────────────
  fetchRooms: async () => {
    const { jwt } = get();
    if (!jwt) return;
    set({ roomsLoading: true });
    try {
      const res = await apiFetch(jwt, '/api/rooms');
      if (!res.ok) throw new Error(`GET /api/rooms → ${res.status}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as { rooms: any[] };
      const rooms: Room[] = data.rooms.map((r) => ({
        id: r.id, jid: r.jid, name: r.name,
        description: r.description ?? '', kind: 'muc' as const,
        is_private: r.is_private ?? false,
        watermark_seq: r.watermark_seq ?? 0,
      }));
      console.log('[chatStore] ✓ Loaded', rooms.length, 'rooms from API');
      set({ rooms, roomsLoading: false });
    } catch (err) {
      console.error('[chatStore] fetchRooms failed:', err);
      set({ roomsLoading: false });
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // fetchUsers — GET /api/users  (Phase 2.6)
  // Populates the global user directory used for the DM sidebar.
  // All users start as 'offline'; status is updated by incoming presence stanzas.
  // ──────────────────────────────────────────────────────────────────────────
  fetchUsers: async () => {
    const { jwt } = get();
    if (!jwt) return;
    set({ usersLoading: true });
    try {
      const res = await apiFetch(jwt, '/api/users?exclude_self=true');
      if (!res.ok) throw new Error(`GET /api/users → ${res.status}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as { users: any[] };
      const { userPresence } = get();
      const users: ChatUser[] = data.users.map((u) => ({
        id:       u.id,
        username: u.username,
        email:    u.email,
        jid:      u.jid,
        role:     u.role,
        friendsOnlyDms: u.friends_only_dms,
        status:   userPresence[u.jid] || 'offline',
      }));
      console.log('[chatStore] ✓ Loaded', users.length, 'users from API');
      set({ users, usersLoading: false });
    } catch (err) {
      console.error('[chatStore] fetchUsers failed:', err);
      set({ usersLoading: false });
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Friendship System APIs (Epic 2)
  // ──────────────────────────────────────────────────────────────────────────
  fetchFriends: async () => {
    const { jwt } = get();
    if (!jwt) return;
    try {
      const res = await apiFetch(jwt, '/api/friends');
      if (!res.ok) throw new Error('Failed to fetch friendships');
      const data = await res.json() as any;
      set({ friendships: data.friendships || [], blockedUsers: data.blocked || [] });
    } catch (err) {
      console.error('[chatStore] fetchFriends failed:', err);
    }
  },

  fetchActiveDms: async () => {
    const { jwt } = get();
    if (!jwt) return;
    try {
      const res = await apiFetch(jwt, '/api/users/active-dms');
      if (res.ok) {
        const data = await res.json() as { activeDms: string[] };
        set({ activeDms: data.activeDms || [] });
        // Prefetch history for these DMs to populate local unread badges correctly
        (data.activeDms || []).forEach(jid => {
          const username = jid.split('@')[0];
          get().fetchDmHistory({ jid, username } as any);
        });
      }
    } catch (err) {
      console.error('[chatStore] fetchActiveDms failed:', err);
    }
  },

  sendFriendRequest: async (userId) => {
    const { jwt } = get();
    if (!jwt) return;
    const res = await apiFetch(jwt, '/api/friends/request', { method: 'POST', body: JSON.stringify({ userId }) });
    if (!res.ok) {
      const { message } = await res.json() as any;
      get().addToast(message || 'Failed to send request', 'error');
      return;
    }
    get().addToast('Friend request sent!', 'success');
    get().fetchFriends();
  },

  acceptFriendRequest: async (userId, userJid) => {
    const { jwt, xmpp } = get();
    if (!jwt) return;
    const res = await apiFetch(jwt, '/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId }) });
    if (!res.ok) {
      const { message } = await res.json() as any;
      get().addToast(message || 'Failed to accept', 'error');
      return;
    }
    // CRITICAL GUARDRAIL: Establish bidirectional XMPP presence sync
    if (xmpp && userJid) {
       xmpp.send(xml('presence', { type: 'subscribe', to: userJid })).catch(() => {});
       xmpp.send(xml('presence', { type: 'subscribed', to: userJid })).catch(() => {});
    }
    get().addToast('Friend request accepted!', 'success');
    get().fetchFriends();
  },

  removeFriend: async (userId) => {
    const { jwt } = get();
    if (!jwt) return;
    const res = await apiFetch(jwt, `/api/friends/remove/${userId}`, { method: 'DELETE' });
    if (!res.ok) {
      const { message } = await res.json() as any;
      get().addToast(message || 'Failed to remove friendship', 'error');
      return;
    }
    get().addToast('Friendship removed.', 'info');
    get().fetchFriends();
  },

  blockUser: async (userId) => {
    const { jwt } = get();
    if (!jwt) return;
    const res = await apiFetch(jwt, '/api/friends/block', { method: 'POST', body: JSON.stringify({ userId }) });
    if (!res.ok) {
      const { message } = await res.json() as any;
      get().addToast(message || 'Failed to block user', 'error');
      return;
    }
    get().addToast('User blocked.', 'success');
    get().fetchFriends();
  },

  unblockUser: async (userId) => {
    const { jwt } = get();
    if (!jwt) return;
    const res = await apiFetch(jwt, `/api/friends/unblock/${userId}`, { method: 'DELETE' });
    if (!res.ok) {
      const { message } = await res.json() as any;
      get().addToast(message || 'Failed to unblock user', 'error');
      return;
    }
    get().addToast('User unblocked.', 'info');
    get().fetchFriends();
  },

  // ──────────────────────────────────────────────────────────────────────────
  // createRoom — POST /api/rooms
  // ──────────────────────────────────────────────────────────────────────────
  createRoom: async (name, description, isPrivate = false) => {
    const { jwt } = get();
    if (!jwt) throw new Error('Not authenticated');

    const res = await apiFetch(jwt, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: name.toLowerCase(), description: description ?? null, is_private: isPrivate }),
    });
    if (!res.ok) {
      const data = await res.json() as { message?: string };
      throw new Error(data.message ?? 'Failed to create room');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as { room: any };
    const room: Room = {
      id: data.room.id, jid: data.room.jid, name: data.room.name,
      description: data.room.description ?? '', kind: 'muc',
      is_private: data.room.is_private ?? isPrivate,
    };
    set((state) => ({ rooms: [...state.rooms, room] }));
    get().setActiveRoom(room.jid);
    console.log('[chatStore] ✓ Room created:', room.jid);
    return room;
  },

  // ──────────────────────────────────────────────────────────────────────────
  // fetchRoomHistory — GET /api/rooms/:id/messages
  // ──────────────────────────────────────────────────────────────────────────
  fetchRoomHistory: async (room, loadMore = false) => {
    const { jwt, historyCursors, hasMoreHistory, isLoadingHistory } = get();
    if (!jwt || !room.id) return;
    
    // Prevent overlapping fetches or fetching when we've hit the end
    if (isLoadingHistory[room.jid] || (loadMore && hasMoreHistory[room.jid] === false)) return;

    set(state => ({ isLoadingHistory: { ...state.isLoadingHistory, [room.jid]: true } }));

    try {
      let url = `/api/rooms/${room.id}/messages?limit=50`;
      if (loadMore && historyCursors[room.jid]) {
        url += `&before_watermark=${historyCursors[room.jid]}`;
      }

      const res = await apiFetch(jwt, url);
      if (!res.ok) {
        if (res.status === 404) {
          set((state) => ({ messages: { ...state.messages, [room.jid]: [] }, isLoadingHistory: { ...state.isLoadingHistory, [room.jid]: false } }));
          return;
        }
        console.warn('[chatStore] fetchRoomHistory non-ok:', res.status);
        set(state => ({ isLoadingHistory: { ...state.isLoadingHistory, [room.jid]: false } }));
        return;
      }
      
      const data = await res.json() as { messages: any[], nextCursor?: string | number };

      const burned = getBurnedSet();
      const now    = Date.now();
      
      const allParsed: Message[] = data.messages
        .map((m: any) => parseArchivedStanza(m.stanza as string, room.jid, m.when as number))
        .filter((m): m is Message => m !== null);

      const editMap = new Map<string, string>(); 
      const retractSet = new Set<string>(); 
      
      allParsed.forEach(m => {
        if (m.type === 'replace' && m.replaceId) editMap.set(m.replaceId, m.body);
        else if (m.type === 'retract' && m.retractId) retractSet.add(m.retractId);
      });

      const parsed: Message[] = allParsed.filter(m => {
        if (m.type === 'replace' || m.type === 'retract') return false; 
        if (retractSet.has(m.id)) return false; 
        if (burned.has(m.id)) return false;     
        if (m.type === 'ephemeral' && m.expiresAt && m.expiresAt <= now) {
          persistBurn(m.id);
          return false;
        }
        if (editMap.has(m.id)) {
           m.body = editMap.get(m.id)!;
           m.isEdited = true;
        }
        return true;
      });

      set((state) => {
        const existing = state.messages[room.jid] ?? EMPTY_MESSAGES;
        const existingIds = new Set(existing.map((m) => m.id));
        const historyOnly = parsed.filter((m) => !existingIds.has(m.id));
        
        let merged = [];
        if (loadMore) {
           // Prepend history exactly as it arrives backwards chronologically to the top
           merged = [...historyOnly, ...existing];
        } else {
           merged = [...historyOnly, ...existing].sort(
             (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
           );
        }

        return { 
          messages: { ...state.messages, [room.jid]: merged },
          historyCursors: { ...state.historyCursors, [room.jid]: data.nextCursor },
          hasMoreHistory: { ...state.hasMoreHistory, [room.jid]: !!data.nextCursor },
          isLoadingHistory: { ...state.isLoadingHistory, [room.jid]: false }
        };
      });
    } catch (err) {
      console.error('[chatStore] fetchRoomHistory failed:', err);
      set(state => ({ isLoadingHistory: { ...state.isLoadingHistory, [room.jid]: false } }));
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // fetchDmHistory — GET /api/users/:username/messages (Phase 2.6 bugfix)
  // ──────────────────────────────────────────────────────────────────────────
  fetchDmHistory: async (user, loadMore = false) => {
    const { jwt, historyCursors, hasMoreHistory, isLoadingHistory } = get();
    if (!jwt || !user.username) return;

    if (isLoadingHistory[user.jid] || (loadMore && hasMoreHistory[user.jid] === false)) return;
    set(state => ({ isLoadingHistory: { ...state.isLoadingHistory, [user.jid]: true } }));

    try {
      let url = `/api/users/${user.username}/messages?limit=50`;
      if (loadMore && historyCursors[user.jid]) {
        url += `&before_watermark=${historyCursors[user.jid]}`;
      }

      const res = await apiFetch(jwt, url);
      if (!res.ok) {
        if (res.status === 404) {
          set((state) => ({ messages: { ...state.messages, [user.jid]: [] }, isLoadingHistory: { ...state.isLoadingHistory, [user.jid]: false } }));
          return;
        }
        console.warn('[chatStore] fetchDmHistory non-ok:', res.status);
        set(state => ({ isLoadingHistory: { ...state.isLoadingHistory, [user.jid]: false } }));
        return;
      }
      const data = await res.json() as { messages: any[], nextCursor?: string | number };

      const burned = getBurnedSet();
      const now    = Date.now();
      
      const allParsed: Message[] = data.messages
        .map((m: any) => parseArchivedStanza(m.stanza as string, user.jid, m.when as number))
        .filter((m): m is Message => m !== null);

      const editMap = new Map<string, string>();
      const retractSet = new Set<string>();
      
      allParsed.forEach(m => {
        if (m.type === 'replace' && m.replaceId) { editMap.set(m.replaceId, m.body); }
        else if (m.type === 'retract' && m.retractId) { retractSet.add(m.retractId); }
      });

      const parsed: Message[] = allParsed.filter(m => {
        if (m.type === 'replace' || m.type === 'retract') return false;
        if (retractSet.has(m.id)) return false;
        if (burned.has(m.id)) return false;
        if (m.type === 'ephemeral' && m.expiresAt && m.expiresAt <= now) {
          persistBurn(m.id);
          return false;
        }
        if (editMap.has(m.id)) {
          m.body = editMap.get(m.id)!;
          m.isEdited = true;
        }
        return true;
      });

      set((state) => {
        const existing = state.messages[user.jid] ?? EMPTY_MESSAGES;
        const existingIds = new Set(existing.map((m) => m.id));
        const historyOnly = parsed.filter((m) => !existingIds.has(m.id));
        
        let merged = [];
        if (loadMore) {
           merged = [...historyOnly, ...existing];
        } else {
           merged = [...historyOnly, ...existing].sort(
             (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
           );
        }

        return { 
          messages: { ...state.messages, [user.jid]: merged },
          historyCursors: { ...state.historyCursors, [user.jid]: data.nextCursor },
          hasMoreHistory: { ...state.hasMoreHistory, [user.jid]: !!data.nextCursor },
          isLoadingHistory: { ...state.isLoadingHistory, [user.jid]: false }
        };
      });
    } catch (err) {
      console.error('[chatStore] fetchDmHistory failed:', err);
      set(state => ({ isLoadingHistory: { ...state.isLoadingHistory, [user.jid]: false } }));
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // joinRoom — XEP-0045 §7.2
  // ──────────────────────────────────────────────────────────────────────────
  joinRoom: (roomJid) => {
    const { xmpp, myNick } = get();
    if (!xmpp || !myNick) return;
    const mucJid = `${roomJid}/${myNick}`;
    console.log('[chatStore] → Joining MUC:', mucJid);
    xmpp.send(
      xml('presence', { to: mucJid },
        xml('x', { xmlns: XMLNS_MUC },
          xml('history', { maxstanzas: '0' }) // REST handles history; skip Prosody replay
        )
      )
    ).catch((err: Error) => console.error('[chatStore] MUC join failed:', err.message));
  },

  // ──────────────────────────────────────────────────────────────────────────
  // setActiveRoom
  // Order: 1. set state  2. fetch history  3. join MUC
  // ──────────────────────────────────────────────────────────────────────────
  setActiveRoom: (roomJid) => {
    const room = get().rooms.find((r) => r.jid === roomJid);
    const activeChat: ActiveChat | null = room
      ? { type: 'room', id: room.id ?? roomJid, jid: roomJid, name: room.name }
      : null;

    // Update both activeChat (new) and activeRoomJid (backward-compat alias)
    set({ activeChat, activeRoomJid: roomJid });

    if (!room) return;

    if (room.id) {
      get().fetchRoomHistory(room).then(() => {
        // Mark as read immediately after history loads so loaded history doesn't
        // appear as "unread" in the sidebar for the room the user is actively in.
        get().markAsRead(roomJid);
        if (!get().joinedRooms[roomJid]) get().joinRoom(roomJid);
      });
    } else {
      if (!get().joinedRooms[roomJid]) get().joinRoom(roomJid);
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // setActiveDm  (Phase 2.6)
  //
  // Opens a DM conversation with a user.  Uses the user's bare JID as the
  // messages[] key — same dict as rooms, just a different key type.
  // No XMPP room join, no MAM history fetch (Phase 2.6 scope decision).
  //
  // NOTE: activeRoomJid is set to the user's bare JID so existing UI
  // components (MessageList, ChatInput, ChatHeader, AIPanel) continue to
  // work unchanged until Phase 2.6 Step 2 migrates them to activeChat.
  // ──────────────────────────────────────────────────────────────────────────
  setActiveDm: (user) => {
    // Intercept if Friends-Only DMs is globally enabled on this user and they aren't friends.
    if (user.friendsOnlyDms) {
      const isFriend = get().friendships.some(f => 
        f.status === 'accepted' && 
        (f.requester_id === user.id || f.addressee_id === user.id)
      );
      if (!isFriend) {
        set({ friendRequestPromptTarget: user });
        return;
      }
    }

    const activeChat: ActiveChat = {
      type: 'dm',
      id:   user.id,
      jid:  user.jid,
      name: user.username,
    };
    // Update both activeChat and activeRoomJid
    set({
      activeChat,
      activeRoomJid: user.jid, // backward-compat: MessageList, ChatInput, etc. read this
    });

    const { jwt } = get();
    if (jwt) {
      get().fetchDmHistory(user).then(() => {
        get().markAsRead(user.jid);
      });
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // sendMessage
  //
  // Routes:
  //   - activeChat.type === 'room' → <message type="groupchat">, gated on MUC join
  //   - activeChat.type === 'dm'   → <message type="chat">, no join gate
  //
  // The `conversationJid` param (passed by ChatInput as `activeRoomJid`) is always
  // the correct destination — either room JID or user bare JID.
  // ──────────────────────────────────────────────────────────────────────────
  sendMessage: (conversationJid, text, secure) => {
    const { xmpp, myNick, joinedRooms, activeChat, activeReply } = get();

    if (!xmpp || !myNick) {
      console.warn('[chatStore] sendMessage: not connected');
      return;
    }

    const isDm = activeChat?.type === 'dm';

    // MUC messages require join confirmation; DM messages do not
    if (!isDm && !joinedRooms[conversationJid]) {
      console.warn('[chatStore] sendMessage: not yet joined', conversationJid, '— dropped');
      return;
    }

    const id = crypto.randomUUID();
    // Use module-level EPHEMERAL_TTL_MS constant (2 min testing / 15 min prod)
    const expiresAt = secure ? Date.now() + EPHEMERAL_TTL_MS : undefined;
    
    let body = text;
    let replyTo, replyText;

    if (secure) {
      body = JSON.stringify({ type: 'ephemeral', content: text, expiresAt });
    } else if (activeReply) {
      replyTo = activeReply.id;
      replyText = activeReply.body.length > 80 ? activeReply.body.substring(0, 80) + '...' : activeReply.body;
      body = JSON.stringify({
        type: 'chat',
        replyTo,
        replyText,
        content: text
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stanza: any = xml('message', {
      to:   conversationJid,
      type: isDm ? 'chat' : 'groupchat',
      id,
    });
    stanza.append(xml('body', {}, body));
    if (secure) stanza.append(xml('ephemeral', { xmlns: XMLNS_EPHEMERAL }));

    xmpp.send(stanza).catch((err: Error) =>
      console.error('[chatStore] sendMessage failed:', err.message)
    );

    // Fix 6b: track the DM peer JID so the sidebar shows this conversation
    if (isDm) {
      set((state) => ({
        activeDms: state.activeDms.includes(conversationJid)
          ? state.activeDms
          : [...state.activeDms, conversationJid],
      }));
    }

    let msgType = secure ? 'ephemeral' : 'text';
    let fileId, fileName, mimeType, sizeBytes;

    if (!secure) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && parsed.type === 'file_ref') {
          msgType = 'file_ref';
          fileId = parsed.fileId;
          fileName = parsed.fileName;
          mimeType = parsed.mimeType;
          sizeBytes = parsed.sizeBytes;
        }
      } catch (e) {
        // Not a JSON payload, standard text message. Ignored.
      }
    }

    // Optimistic insert — dedup in addMessage prevents double-render on echo
    get().addMessage({
      id,
      roomJid:    conversationJid, // for DMs: recipient's bare JID (conversation key)
      sender:     myNick,
      senderName: myNick,
      body:       text,
      type:       msgType as any,
      fileId,
      fileName,
      mimeType,
      sizeBytes,
      timestamp:  new Date().toISOString(),
      expiresAt,
      replyTo,
      replyText,
    });

    if (activeReply) {
      get().setReplyTarget(null);
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // editMessage
  // Sends a XEP-0308 <replace> stanza to amend the previously sent message
  // ──────────────────────────────────────────────────────────────────────────
  editMessage: (conversationJid, originalMsgId, newText) => {
    const { xmpp, myNick, activeChat } = get();
    if (!xmpp || !myNick) return;

    const isDm = activeChat?.type === 'dm';
    const id = crypto.randomUUID();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stanza: any = xml('message', {
      to:   conversationJid,
      type: isDm ? 'chat' : 'groupchat',
      id,
    });
    stanza.append(xml('body', {}, newText));
    stanza.append(xml('replace', { id: originalMsgId, xmlns: 'urn:xmpp:message-correct:0' }));

    xmpp.send(stanza).catch((err: Error) =>
      console.error('[chatStore] editMessage failed:', err.message)
    );

    set((state) => {
      const msgs = state.messages[conversationJid] || [];
      const updatedMsgs = msgs.map((m) =>
        m.id === originalMsgId ? { ...m, body: newText, isEdited: true } : m
      );
      return { messages: { ...state.messages, [conversationJid]: updatedMsgs } };
    });
  },

  // ──────────────────────────────────────────────────────────────────────────
  // addMessage — ID dedup is mandatory here (MAM vs live stanza races)
  // ──────────────────────────────────────────────────────────────────────────
  addMessage: (msg) =>
    set((state) => {
      const existing = state.messages[msg.roomJid] ?? EMPTY_MESSAGES;
      if (existing.some((m) => m.id === msg.id)) return state; // dedup

      const updatedMessages = {
        ...state.messages,
        [msg.roomJid]: [...existing, msg],
      };
      const isOwn = state.myNick !== null && msg.sender === state.myNick;
      const updatedLastReadAts = isOwn
        ? { ...state.lastReadAts, [msg.roomJid]: msg.timestamp }
        : state.lastReadAts;

      if (isOwn) persistLastRead(updatedLastReadAts);

      return { messages: updatedMessages, lastReadAts: updatedLastReadAts };
    }),

  removeMessage: (id, roomJid) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [roomJid]: (state.messages[roomJid] ?? EMPTY_MESSAGES).filter((m) => m.id !== id),
      },
    })),

  // ── XEP-0424 retraction: local wipe + broadcast stanza ───────────────────
  retractMessage: (roomJid, msgId) => {
    get().removeMessage(msgId, roomJid);
    const { xmpp, joinedRooms, activeChat } = get();
    if (!xmpp) return;

    const isDm = activeChat?.type === 'dm' && activeChat.jid === roomJid;
    if (!isDm && !joinedRooms[roomJid]) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stanza: any = xml('message', { to: roomJid, type: isDm ? 'chat' : 'groupchat' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyToEl: any = xml('apply-to', { id: msgId, xmlns: 'urn:xmpp:fasten:0' });
    applyToEl.append(xml('retract', { xmlns: 'urn:xmpp:message-retract:0' }));
    stanza.append(applyToEl);

    xmpp.send(stanza).catch((err: Error) =>
      console.error('[chatStore] retractMessage stanza failed:', err.message)
    );
  },

  markAsRead: (roomJid) =>
    set((state) => {
      const msgs   = state.messages[roomJid] ?? EMPTY_MESSAGES;
      if (msgs.length === 0) return state; // Guard against Virtuoso destroying persisted watermarks with null on empty initial renders
      
      const lastTs = msgs[msgs.length - 1]?.timestamp ?? null;
      const updated = { ...state.lastReadAts, [roomJid]: lastTs };
      persistLastRead(updated);
      return { lastReadAts: updated };
    }),

  markAsReadUpTo: (roomJid, timestamp) =>
    set((state) => {
      const currentTs = state.lastReadAts[roomJid];
      // Only advance the watermark forward. Never regress it.
      if (currentTs && currentTs >= timestamp) return state;

      const updated = { ...state.lastReadAts, [roomJid]: timestamp };
      persistLastRead(updated);
      return { lastReadAts: updated };
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // burnEphemeral — safe ephemeral removal with localStorage persistence
  // MUC: local-only (no broadcast — only the burning user loses it)
  // DM:  broadcast XEP-0424 retraction (both parties lose it)
  // ──────────────────────────────────────────────────────────────────────────
  burnEphemeral: (msgId, roomJid, isDm) => {
    persistBurn(msgId);
    if (isDm) {
      get().retractMessage(roomJid, msgId); // broadcast + local remove
    } else {
      get().removeMessage(msgId, roomJid);  // local only for MUC
    }
  },

  setReplyTarget: (msg) => set({ activeReply: msg }),

  toggleReaction: (roomJid, msgId, emoji, username) => {
    set((state) => {
      const msgs = state.messages[roomJid] ?? [];
      const updated = msgs.map((m) => {
        if (m.id !== msgId) return m;
        const reactions = { ...(m.reactions ?? {}) };
        const current = reactions[emoji] ?? [];
        if (current.includes(username)) {
          const next = current.filter((u) => u !== username);
          if (next.length === 0) delete reactions[emoji];
          else reactions[emoji] = next;
        } else {
          reactions[emoji] = [...current, username];
        }
        return { ...m, reactions };
      });
      return { messages: { ...state.messages, [roomJid]: updated } };
    });
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Room Management / Moderation APIs
  // ──────────────────────────────────────────────────────────────────────────
  updateRoomMemberRole: async (roomId, userId, role) => {
    const { jwt } = get();
    if (!jwt) return;
    const res = await apiFetch(jwt, `/api/rooms/${roomId}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const e = await res.json() as { message?: string };
      throw new Error(e.message || 'Failed to update role');
    }
  },

  kickRoomMember: async (roomId, userId, reason) => {
    const { jwt } = get();
    if (!jwt) return;
    const res = await apiFetch(jwt, `/api/rooms/${roomId}/kick`, {
      method: 'POST',
      body: JSON.stringify({ userId, reason: reason ?? '' }),
    });
    if (!res.ok) {
      const e = await res.json() as { message?: string };
      throw new Error(e.message || 'Failed to kick user');
    }
  },

  banRoomMember: async (roomId, userId, reason) => {
    const { jwt } = get();
    if (!jwt) return;
    const res = await apiFetch(jwt, `/api/rooms/${roomId}/ban`, {
      method: 'POST',
      body: JSON.stringify({ userId, reason: reason ?? '' }),
    });
    if (!res.ok) {
      const e = await res.json() as { message?: string };
      throw new Error(e.message || 'Failed to ban user');
    }
  },

  updateRoomSettings: async (roomId, updates) => {
    const { jwt } = get();
    if (!jwt) return;
    const res = await apiFetch(jwt, `/api/rooms/${roomId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const e = await res.json() as { message?: string };
      throw new Error(e.message || 'Failed to update settings');
    }
    // Update local state and refetch
    get().fetchRooms();
  },

  leaveRoom: async (roomId) => {
    const { jwt } = get();
    if (!jwt) return;
    const res = await apiFetch(jwt, `/api/rooms/${roomId}/leave`, {
      method: 'POST',
    });
    if (!res.ok) {
      const e = await res.json() as { message?: string };
      throw new Error(e.message || 'Failed to leave room');
    }
    // Update local state by removing from joinedRooms and refetching rooms
    get().fetchRooms();
  },

  deleteRoom: async (roomId) => {
    const { jwt } = get();
    if (!jwt) return;
    const res = await apiFetch(jwt, `/api/rooms/${roomId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const e = await res.json() as { message?: string };
      throw new Error(e.message || 'Failed to delete room');
    }
    // Reflect deletion locally
    set((state) => ({
      rooms: state.rooms.filter(r => r.id !== roomId),
      activeChat: state.activeChat?.id === roomId ? null : state.activeChat,
    }));
    get().addToast('Room successfully deleted.', 'success');
  },
}));

export { xml };
