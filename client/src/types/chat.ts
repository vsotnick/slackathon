// Message and room data types shared across the app

export type MessageType = 'text' | 'ephemeral' | 'file_ref' | 'replace' | 'retract';

export interface Message {
  id: string;
  roomJid: string;
  /** Nick (in MUC) or bare JID (in DM) of the sender */
  sender: string;
  /** Human-readable display name */
  senderName: string;
  /** Decoded body — already extracted from JSON for ephemeral type */
  body: string;
  type: MessageType;
  timestamp: string; // ISO 8601
  /**
   * Fix 9: Unix-ms timestamp after which the ephemeral message is considered expired
   * and must not be rendered. Undefined for non-ephemeral messages.
   */
  expiresAt?: number;
  /** Phase 2.8: File attachment references */
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Phase 2.9: Indicates if the message was edited */
  isEdited?: boolean;
  /** Phase 2.9 (Protocol): Native id target for edits */
  replaceId?: string;
  /** Phase 2.9 (Protocol): Native id target for deletions */
  retractId?: string;
  /** Phase 2.10: Reply context UUID */
  replyTo?: string;
  /** Phase 2.10: Truncated original message snippet to render */
  replyText?: string;
  /** Phase 2.12: Emoji reactions — map of emoji → array of usernames who reacted */
  reactions?: Record<string, string[]>;
}

export interface Room {
  /** PostgreSQL UUID — present for API-sourced rooms, absent for local-only entries */
  id?: string;
  jid: string;
  name: string;
  description: string;
  kind: 'muc' | 'dm';
  /** Fix 5: used to group rooms into PUBLIC vs PRIVATE sections in the sidebar */
  is_private?: boolean;
  /** Monotonic message counter from the DB — used to detect unread before history loads */
  watermark_seq?: number;
}

/** A registered user returned by GET /api/users, enriched with live presence state. */
export interface ChatUser {
  id: string;
  username: string;
  email: string;
  jid: string;       // bare JID: alice@servera.local
  role: string;
  friendsOnlyDms?: boolean;
  /** Live presence status — updated by incoming <presence> stanzas. */
  status: 'online' | 'away' | 'offline';
}

/**
 * Unified active-conversation descriptor.
 * Replaces the old `activeRoomJid: string` flat field.
 * Phase 2.6 Step 2 will migrate all UI components to read from this.
 */
export interface ActiveChat {
  type: 'room' | 'dm';
  /** DB UUID for rooms; user DB id for DMs. */
  id: string;
  /** Room JID (MUC) or user bare JID (DM). Used as messages[] key. */
  jid: string;
  /** Room name or username — shown in the header. */
  name: string;
}
