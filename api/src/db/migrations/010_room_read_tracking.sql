-- =============================================================================
-- Migration 010: Server-side room read tracking
--
-- Adds last_read_seq to room_members so the server can track how far each user
-- has read in each room. This replaces the client-only localStorage approach
-- which broke across sessions and devices.
--
-- last_read_seq = 0 means "never read" (all messages are unread).
-- The client calls PUT /api/rooms/:id/read with { seq } to advance it.
-- GET /api/rooms returns last_read_seq per room so the client can compute
-- unread counts: unread = (watermark_seq - last_read_seq).
-- =============================================================================

ALTER TABLE room_members
  ADD COLUMN IF NOT EXISTS last_read_seq BIGINT NOT NULL DEFAULT 0;
