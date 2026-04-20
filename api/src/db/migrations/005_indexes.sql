-- =============================================================================
-- Migration 005: Indexes and Supporting Tables
--
-- 1. Keyset pagination composite index on prosodyarchive (EC-8).
--    This index is created with IF NOT EXISTS so it's safe to run before
--    Prosody has created the prosodyarchive table. The index creation is
--    wrapped in a DO block to skip gracefully if the table doesn't exist yet.
--
-- 2. password_reset_tokens table (EC-1 Mock SMTP).
--    Tokens are UUID v4, valid for 1 hour. The Node API logs the reset
--    link to console instead of sending email.
-- =============================================================================

-- EC-8: Keyset pagination index on Prosody's MAM archive table.
-- Prosody (mod_storage_sql) creates the 'prosodyarchive' table on first run.
-- We use a DO block so this migration doesn't fail if Prosody hasn't started yet.
-- The Node API's migrate runner will re-attempt this index creation on each
-- startup until it succeeds.
DO $$
BEGIN
    -- Only create if prosodyarchive table exists (Prosody has run at least once)
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'prosodyarchive'
    ) THEN
        -- Composite index for O(log N) keyset queries:
        -- SELECT ... WHERE store = 'muc' AND key = '<room_jid>' AND id < <watermark>
        -- ORDER BY id DESC LIMIT 50
        CREATE INDEX IF NOT EXISTS idx_prosodyarchive_keyset
            ON prosodyarchive (store, key, id DESC);

        RAISE NOTICE 'idx_prosodyarchive_keyset created or already exists.';
    ELSE
        RAISE NOTICE 'prosodyarchive table not found — keyset index deferred. Will retry on next startup.';
    END IF;
END;
$$;

-- EC-1: Mock SMTP password reset tokens.
-- The Node API generates a UUID token, stores it here, and logs the reset
-- link to console. No email is sent. Real mailer can be added later with
-- zero schema changes by just removing the console.log call.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Hashed token — we store a SHA-256 hash, not the raw token,
    -- so the table is useless to an attacker even if the DB is compromised.
    token_hash  TEXT NOT NULL UNIQUE,
    -- 1-hour TTL enforced at application layer (compare expires_at to NOW())
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
    used        BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_user    ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash    ON password_reset_tokens(token_hash);
-- Index for cleanup jobs (delete expired tokens)
CREATE INDEX IF NOT EXISTS idx_reset_tokens_expires ON password_reset_tokens(expires_at);
