-- =============================================================================
-- Migration 009: Friends-Only DMs Privacy Setting
-- Adds a boolean flag allowing users to restrict incoming direct messages 
-- exclusively to accepted friends. Default is public (false).
-- =============================================================================

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS friends_only_dms BOOLEAN NOT NULL DEFAULT false;
