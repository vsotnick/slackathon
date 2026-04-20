'use strict';
/**
 * middleware/authenticate.js — JWT verification + global ban check.
 *
 * This Fastify preHandler decorator is applied to all protected routes.
 * It performs two sequential checks:
 *
 * 1. JWT Verification — Ensures the token is valid, unexpired, and signed
 *    with our JWT_SECRET. Returns 401 if invalid.
 *
 * 2. Global Ban Check (EC-2) — Queries PostgreSQL on EVERY authenticated
 *    request to verify the user has not been globally banned since the JWT
 *    was issued. This is the mechanism that makes bans immediate — a valid
 *    JWT alone is not sufficient to access the API.
 *
 * Performance note: The ban check adds one DB round-trip per request.
 * For Phase 1 scale (300 users) this is acceptable. In Phase 2, this
 * can be optimized with a Redis-backed ban list checked before the DB.
 */

const { query } = require('../db/pool');

/**
 * authenticate — Fastify preHandler hook for JWT + ban verification.
 *
 * Attaches the verified user object to request.user for use in route handlers:
 *   request.user = { id, username, email, xmpp_jid, role }
 *
 * @param {FastifyRequest} request
 * @param {FastifyReply}   reply
 */
async function authenticate(request, reply) {
  // Step 1: Verify JWT signature and expiry using @fastify/jwt
  // jwtVerify() throws if the token is missing, invalid, or expired
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired authentication token.',
    });
    return;
  }

  const userId = request.user?.id;
  if (!userId) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Token payload missing user id.' });
    return;
  }

  // Step 2: EC-2 — Per-request global ban check and session revocation check
  // We compute the hash of the raw token to match against the user_sessions table
  let row;
  try {
    const rawToken = request.headers.authorization?.substring(7);
    const tokenHash = require('crypto').createHash('sha256').update(rawToken || '').digest('hex');

    const result = await query(
      `SELECT u.id, u.username, u.email, u.xmpp_jid, u.role, u.is_globally_banned, s.is_revoked 
       FROM users u 
       LEFT JOIN user_sessions s ON s.token_hash = $2
       WHERE u.id = $1`,
      [userId, tokenHash]
    );
    row = result.rows[0];
    
    // If the session was explicitly marked revoked, instantly deny access
    if (row && row.is_revoked) {
      reply.code(401).send({ error: 'Unauthorized', message: 'This session has been revoked. Please log in again.' });
      return;
    }

  } catch (dbErr) {
    // DB error during auth check — fail closed (deny access)
    request.log.error({ err: dbErr }, '[authenticate] DB error during ban check');
    reply.code(500).send({ error: 'Internal Server Error', message: 'Authentication check failed.' });
    return;
  }

  if (!row) {
    // User was deleted after the JWT was issued
    reply.code(401).send({ error: 'Unauthorized', message: 'User account not found.' });
    return;
  }

  if (row.is_globally_banned) {
    // EC-2: Banned user gets 403 even with a valid JWT
    reply.code(403).send({
      error: 'Account Suspended',
      message: 'Your account has been suspended. Contact an administrator.',
    });
    return;
  }

  // Attach clean user object to request — available in all route handlers
  request.user = {
    id:       row.id,
    username: row.username,
    email:    row.email,
    xmppJid:  row.xmpp_jid,
    role:     row.role,
  };
}

/**
 * requireAdmin — Additional check: only allow users with role='admin'.
 * Must be chained AFTER authenticate in the preHandler array.
 */
async function requireAdmin(request, reply) {
  if (request.user?.role !== 'admin') {
    reply.code(403).send({
      error: 'Forbidden',
      message: 'This action requires administrator privileges.',
    });
  }
}

module.exports = { authenticate, requireAdmin };
