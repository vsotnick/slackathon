-- =============================================================================
-- Migration 008: User Sessions Table
-- Tracks active login sessions so users can view and revoke them individually.
-- Req 2.2.4: "The user shall be able to view a list of their active sessions,
--             including browser/IP details, and log out selected sessions."
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- SHA-256 hash of the JWT token (never store the raw token)
    token_hash  TEXT NOT NULL UNIQUE,
    -- Human-readable device / browser info (passed by client on login)
    user_agent  TEXT,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Soft-delete: set to true when the user explicitly logs out this session
    is_revoked  BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user    ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token   ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_revoked ON user_sessions(is_revoked);
