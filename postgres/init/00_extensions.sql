-- =============================================================================
-- PostgreSQL Init: Extensions
-- Runs automatically when the postgres container is first started.
-- =============================================================================

-- uuid_generate_v4() — used for primary key generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- gen_random_uuid() — used as the primary UUID generator (native pg 13+)
-- pgcrypto also provides gen_salt(), crypt() for optional native password ops
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
