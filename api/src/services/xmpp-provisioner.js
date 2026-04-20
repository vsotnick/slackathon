'use strict';
/**
 * services/xmpp-provisioner.js — Prosody mod_admin_rest HTTP wrapper.
 *
 * Prosody's `mod_admin_rest` exposes an HTTP API for admin operations
 * such as creating users, deleting users, and disconnecting sessions.
 * This service wraps those calls so the rest of the API code doesn't
 * need to know about Prosody's internal URL or auth scheme.
 *
 * EC-2 (Immediate Eviction): The `kickAllSessions()` function calls
 * Prosody to forcefully terminate all active XMPP connections for a JID,
 * implementing the two-step atomic ban/kick:
 *   1. Database write (done by caller before this is invoked)
 *   2. Live session termination (done here)
 *
 * Prosody admin_rest docs:
 *   https://modules.prosody.im/mod_admin_rest.html
 */

const config = require('../config');

// Base64 encoded "admin@domain:password" for HTTP Basic auth to Prosody
const BASIC_AUTH = Buffer.from(
  `${config.prosodyAdminUser}@${config.xmppDomain}:${config.prosodyAdminPass}`
).toString('base64');

const BASE_URL = `${config.prosodyAdminUrl}/admin_rest`;

/**
 * prosodyRequest — Low-level HTTP request to Prosody admin_rest.
 * Uses Node's native fetch (available in Node 18+).
 *
 * @param {string} method  — HTTP method (GET, POST, PUT, DELETE)
 * @param {string} path    — Path relative to /admin_rest (e.g. "/user/alice")
 * @param {object} [body]  — Optional JSON request body
 * @returns {object}       — { status, data } where data is parsed JSON or null
 */
async function prosodyRequest(method, path, body = null) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Host': config.xmppDomain.toLowerCase(),
    'Authorization': `Basic ${BASIC_AUTH}`,
    'Content-Type':  'application/json',
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    // Node 18+ native fetch — no external library needed
    response = await fetch(url, options);
  } catch (err) {
    // Network-level failure (Prosody not reachable)
    throw new Error(
      `[xmpp-provisioner] Network error reaching Prosody admin_rest at ${url}: ${err.message}. ` +
      'Ensure the prosody service is healthy and PROSODY_ADMIN_URL is correct.'
    );
  }

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  }

  return { status: response.status, data };
}

/**
 * createUser — Provisions a new XMPP account on the Prosody server.
 *
 * Called during user registration (POST /api/auth/register) immediately
 * after the PostgreSQL row is inserted. If Prosody provisioning fails,
 * the caller must roll back the DB insert.
 *
 * @param {string} username    — Local part of the JID (e.g. "alice")
 * @param {string} xmppPassword — The raw (pre-encryption) XMPP password
 * @throws If Prosody returns an error or is unreachable
 */
async function createUser(username, xmppPassword) {
  console.log(`[xmpp-provisioner] Creating XMPP account: ${username}@${config.xmppDomain}`);

  const { status, data } = await prosodyRequest('POST', `/user/${username}@${config.xmppDomain}`, {
    password: xmppPassword,
  });

  if (status !== 201 && status !== 200) {
    throw new Error(
      `[xmpp-provisioner] Failed to create XMPP user ${username}: ` +
      `HTTP ${status} — ${JSON.stringify(data)}`
    );
  }

  console.log(`[xmpp-provisioner] ✓ XMPP account created: ${username}@${config.xmppDomain}`);
}

/**
 * deleteUser — Removes an XMPP account from Prosody.
 *
 * Called when a user account is permanently deleted.
 *
 * @param {string} username — Local part of the JID
 */
async function deleteUser(username) {
  console.log(`[xmpp-provisioner] Deleting XMPP account: ${username}@${config.xmppDomain}`);

  const { status, data } = await prosodyRequest('DELETE', `/user/${username}@${config.xmppDomain}`);

  if (status !== 200 && status !== 204) {
    // Log the warning but don't throw — a 404 means the user didn't exist on
    // Prosody (edge case: manual cleanup). We treat that as success.
    console.warn(
      `[xmpp-provisioner] Unexpected response deleting XMPP user ${username}: ` +
      `HTTP ${status} — ${JSON.stringify(data)}`
    );
  }

  console.log(`[xmpp-provisioner] ✓ XMPP account deleted: ${username}@${config.xmppDomain}`);
}

/**
 * changePassword — Updates the XMPP password for an existing account.
 *
 * @param {string} username    — Local part of the JID
 * @param {string} newPassword — New plaintext XMPP password
 */
async function changePassword(username, newPassword) {
  console.log(`[xmpp-provisioner] Changing XMPP password for: ${username}@${config.xmppDomain}`);

  const { status, data } = await prosodyRequest('PUT', `/user/${username}@${config.xmppDomain}/password`, {
    password: newPassword,
  });

  if (status !== 200) {
    throw new Error(
      `[xmpp-provisioner] Failed to change password for ${username}: ` +
      `HTTP ${status} — ${JSON.stringify(data)}`
    );
  }

  console.log(`[xmpp-provisioner] ✓ XMPP password changed: ${username}@${config.xmppDomain}`);
}

/**
 * kickAllSessions — Forcefully terminates all active XMPP connections for a JID.
 *
 * EC-2 (Immediate Eviction): This is step 2 of the atomic ban/kick flow.
 * Step 1 (DB write) must be completed by the caller before invoking this.
 *
 * Prosody admin_rest endpoint: DELETE /user/:username/connected_resources
 * This closes all active C2S (client-to-server) streams for the user,
 * causing the client to receive a stream-level error and disconnect.
 * Prosody then broadcasts <presence type="unavailable"/> to all rooms.
 *
 * Note: If the user has no active sessions (already offline), this is a no-op.
 *
 * @param {string} username — Local part of the JID to evict
 */
async function kickAllSessions(username) {
  console.log(`[xmpp-provisioner] EC-2: Kicking all sessions for: ${username}@${config.xmppDomain}`);

  const { status, data } = await prosodyRequest(
    'DELETE',
    `/user/${username}@${config.xmppDomain}/connected_resources`
  );

  if (status === 404) {
    // User has no active sessions — this is fine, treat as success
    console.log(`[xmpp-provisioner] ${username} has no active sessions (already offline).`);
    return;
  }

  if (status !== 200 && status !== 204) {
    // Non-fatal: log the warning but don't block the ban operation.
    // The DB ban flag is already set — the user will be blocked at next API call.
    console.warn(
      `[xmpp-provisioner] Warning: kickAllSessions for ${username} returned ` +
      `HTTP ${status} — ${JSON.stringify(data)}. The DB ban is still active.`
    );
    return;
  }

  console.log(`[xmpp-provisioner] ✓ All sessions terminated for: ${username}@${config.xmppDomain}`);
}

/**
 * getServerStatus — Fetches connection and session stats from Prosody.
 *
 * Used by GET /api/admin/xmpp/status to populate the admin dashboard.
 *
 * @returns {{ status: 'ok'|'error', connections: number, data: object }}
 */
async function getServerStatus() {
  try {
    const { status, data } = await prosodyRequest('GET', '/stats');
    return {
      status: status === 200 ? 'ok' : 'error',
      connections: data?.c2s_connections || 0,
      data: data || {},
    };
  } catch (err) {
    return { status: 'error', connections: 0, error: err.message };
  }
}

module.exports = { createUser, deleteUser, changePassword, kickAllSessions, getServerStatus };
