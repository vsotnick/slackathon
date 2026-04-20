-- =============================================================================
-- Migration 001: Users Table
-- Source of truth for all web authentication.
-- XMPP passwords are stored AES-256-GCM encrypted (EC-4 security requirement).
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT UNIQUE NOT NULL,
    -- Username is immutable after registration (per requirements)
    username            TEXT UNIQUE NOT NULL,
    -- bcrypt hash of the user's web login password (one-way)
    password_hash       TEXT NOT NULL,
    -- XMPP JID assigned at registration e.g. alice@serverA.local
    xmpp_jid            TEXT UNIQUE NOT NULL,
    -- AES-256-GCM encrypted XMPP machine password (EC: AES-256 at rest)
    xmpp_password_enc   BYTEA NOT NULL,
    -- GCM initialization vector — 12 random bytes, unique per encryption
    xmpp_password_iv    BYTEA NOT NULL,
    -- GCM authentication tag — 16 bytes, verifies ciphertext integrity
    xmpp_password_tag   BYTEA NOT NULL,
    -- Role: 'user' for regular users, 'admin' for system administrators
    role                TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    -- EC-9: Global ban flag. When true, all API requests return 403.
    -- Enforced at JWT middleware level on every request (EC-2).
    is_globally_banned  BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast login lookups (most frequent query)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
-- Index for JID lookups (used by XMPP provisioner + ban checks)
CREATE INDEX IF NOT EXISTS idx_users_xmpp_jid ON users(xmpp_jid);
-- Index for username lookups (profile pages, mentions)
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Auto-update updated_at on row mutation
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
