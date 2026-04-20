'use strict';
/**
 * db/pool.js — PostgreSQL connection pool singleton.
 *
 * Uses the `pg` library's built-in Pool for connection management.
 *
 * IMPORTANT: In Docker Compose, even with `depends_on: postgres: condition: service_healthy`,
 * there can be a brief window where PostgreSQL is accepting TCP connections but
 * is not yet ready to serve queries. We implement an exponential-backoff retry
 * loop on the first connect attempt to handle this gracefully.
 */

const { Pool } = require('pg');
const config   = require('../config');

// Create the pool — connections are lazy (not opened until first query)
const pool = new Pool({
  connectionString: config.databaseUrl,
  // Pool sizing: max 20 concurrent DB connections for our API process
  max:              20,
  // Kill idle connections after 30s to avoid lingering resource usage
  idleTimeoutMillis: 30_000,
  // Fail fast on connect timeout (circuit-break vs. hanging indefinitely)
  connectionTimeoutMillis: 5_000,
});

// Forward pool-level errors to process (avoids unhandled promise rejections
// on idle client errors, e.g. DB restart)
pool.on('error', (err) => {
  console.error('[db/pool] Unexpected idle client error:', err.message);
});

/**
 * waitForDatabase — attempts a test query with exponential backoff.
 *
 * Called at application startup before the HTTP server begins accepting
 * requests. Ensures the DB is reachable and migrations can run.
 *
 * @param {number} maxAttempts — abort after this many failed attempts
 * @param {number} baseDelayMs — initial delay, doubles on each retry
 */
async function waitForDatabase(maxAttempts = 10, baseDelayMs = 1000) {
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const client = await pool.connect();
      await client.query('SELECT 1'); // Lightweight connectivity probe
      client.release();
      console.log(`[db/pool] PostgreSQL ready after ${attempt} attempt(s).`);
      return; // Success — exit the retry loop
    } catch (err) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s …
      console.warn(
        `[db/pool] Attempt ${attempt}/${maxAttempts} failed: ${err.message}. ` +
        `Retrying in ${delay}ms…`
      );
      if (attempt >= maxAttempts) {
        throw new Error(
          `[db/pool] Could not connect to PostgreSQL after ${maxAttempts} attempts. ` +
          'Ensure the database service is healthy and DATABASE_URL is correct.'
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * query — Execute a parameterized SQL query using a pool connection.
 *
 * Centralizing queries here (instead of using pool.query directly) lets us
 * add observability (query timing, logging) in one place later.
 *
 * @param {string}   text   — Parameterized SQL string ($1, $2, …)
 * @param {Array}    params — Parameter values
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * getClient — Acquire a dedicated client for transaction use.
 * Caller MUST release the client when done: client.release()
 */
async function getClient() {
  return pool.connect();
}

module.exports = { pool, query, getClient, waitForDatabase };
