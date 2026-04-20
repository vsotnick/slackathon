-- =============================================================================
-- Migration 002: Rooms, Membership, Kicks, and Global Bans
--
-- Key design decisions:
--   - rooms.watermark_seq: monotonic counter per room (EC-4 Message Watermarks)
--   - room_kicks vs global_bans: two-tier moderation model (EC-9)
--     * remove/kick = room-scoped, reversible
--     * global ban  = account-wide, admin-only reversal
-- =============================================================================

CREATE TABLE IF NOT EXISTS rooms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Short name used in JID: e.g. "general" -> general@conference.serverA.local
    name            TEXT UNIQUE NOT NULL,
    -- Full XMPP JID of the MUC room
    jid             TEXT UNIQUE NOT NULL,
    description     TEXT,
    is_private      BOOLEAN NOT NULL DEFAULT false,
    owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    -- EC-4: Monotonic watermark sequence. Incremented atomically on each archived
    -- message. The client tracks lastWatermark and uses gap detection to trigger
    -- REST backfill fetches instead of relying on the WS stream alone.
    watermark_seq   BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rooms_name     ON rooms(name);
CREATE INDEX IF NOT EXISTS idx_rooms_jid      ON rooms(jid);
CREATE INDEX IF NOT EXISTS idx_rooms_watermark ON rooms(watermark_seq);

-- ---------------------------------------------------------------------------
-- Room membership
-- EC-9: A user listed here is an active member.
-- "Remove" (kick) deletes from this table + inserts into room_kicks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_members (
    room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Role hierarchy: member < moderator < admin < owner
    role        TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('member', 'moderator', 'admin', 'owner')),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

-- ---------------------------------------------------------------------------
-- Room kicks (EC-9: "Remove" action — room-scoped, reversible)
-- A kicked user is removed from room_members. This table is an audit log.
-- Admins can re-invite a kicked user (the kick record remains for audit).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_kicks (
    room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kicked_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    reason      TEXT,
    kicked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id, kicked_at)
);

-- ---------------------------------------------------------------------------
-- Global bans (EC-9: "Ban" action — account-wide, requires admin to unban)
-- EC-2: When a global ban is issued:
--   1. users.is_globally_banned is set to true
--   2. Node API calls Prosody admin REST to terminate all XMPP sessions
--   3. All subsequent JWT-authenticated requests are rejected 403
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS global_bans (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    banned_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    reason      TEXT,
    banned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
