'use strict';
/**
 * db/migrate.js — Automatic migration runner.
 *
 * Reads all *.sql files from the migrations/ directory in sorted order
 * and executes them against the database. Migrations are idempotent —
 * every statement uses IF NOT EXISTS, DO blocks, or CREATE INDEX CONCURRENTLY
 * with IF NOT EXISTS, so re-running on an already-migrated DB is safe.
 *
 * Called once at API startup before the HTTP server begins listening.
 */

const path = require('path');
const fs   = require('fs');
const { pool } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations() {
  console.log('[migrate] Starting database migration run…');

  // Get all .sql files sorted lexicographically (001_ before 002_, etc.)
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.warn('[migrate] No migration files found in', MIGRATIONS_DIR);
    return;
  }

  // Run each migration in a dedicated client (not a transaction wrapping all
  // files — this allows partial success and DDL outside transactions)
  for (const file of files) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql      = fs.readFileSync(filePath, 'utf8');

    console.log(`[migrate] Running: ${file}`);
    try {
      await pool.query(sql);
      console.log(`[migrate] ✓ ${file}`);
    } catch (err) {
      // Log the error but don't crash the server for non-critical failures
      // (e.g. the prosodyarchive index in 005 may fail if Prosody hasn't
      // created the table yet — it's wrapped in a DO block that handles this).
      console.error(`[migrate] ✗ ${file}: ${err.message}`);
      // Re-throw for migrations 001–004 (core schema) — those are fatal.
      // Migration 005 (indexes) uses a graceful DO block already.
      if (parseInt(file.slice(0, 3), 10) <= 4) {
        throw err;
      }
    }
  }

  console.log('[migrate] All migrations complete.');
}

module.exports = { runMigrations };
