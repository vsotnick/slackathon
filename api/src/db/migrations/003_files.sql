-- =============================================================================
-- Migration 003: File Attachments
-- Files are stored on a local Docker volume (files_data) in Phase 1.
-- MinIO (S3-compatible) will replace this in Phase 2 with no schema changes.
-- Access control is enforced by the Node API — files are only served to
-- current members of the room the file was uploaded to (or dialog participants).
-- =============================================================================

CREATE TABLE IF NOT EXISTS files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    -- CASCADE delete: if the room is deleted, all its files are deleted too.
    -- The actual file on disk is cleaned up by the Node API's room-delete handler.
    room_id         UUID REFERENCES rooms(id) ON DELETE CASCADE,
    -- Original filename as uploaded by the user (for download Content-Disposition)
    original_name   TEXT NOT NULL,
    -- Relative path within the files_data Docker volume
    -- e.g. "uploads/2024/01/abc123.pdf"
    stored_path     TEXT NOT NULL UNIQUE,
    mime_type       TEXT,
    -- Enforced size limits: 20MB for files, 3MB for images (validated at upload)
    size_bytes      BIGINT,
    -- Optional user-provided comment/caption for the attachment
    comment         TEXT,
    -- EC-4: Watermark sequence of the message this file was included with.
    -- Allows the client to correlate file metadata with the message watermark
    -- for gap detection and history backfill.
    message_watermark BIGINT,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for listing files in a room (file manager, access control checks)
CREATE INDEX IF NOT EXISTS idx_files_room_id    ON files(room_id);
-- Index for file ownership lookups (user file history)
CREATE INDEX IF NOT EXISTS idx_files_uploader   ON files(uploader_id);
