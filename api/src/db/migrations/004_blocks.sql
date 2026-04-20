-- =============================================================================
-- Migration 004: User-to-User Blocks
-- When user A blocks user B:
--   - B's messages are hidden from A's view in shared rooms
--   - A and B cannot initiate new personal dialogs
--   - Existing personal dialog history remains visible but frozen
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    -- A user cannot block themselves
    CHECK (blocker_id <> blocked_id)
);

-- Index for fast "is user blocked?" checks on message rendering
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);
