'use strict';
/**
 * routes/admin.js — Admin-only API endpoints.
 *
 * GET  /api/admin/xmpp/status       — XMPP server health and connection stats
 * GET  /api/admin/users             — List all users (paginated)
 * POST /api/admin/users/:id/ban     — Globally ban a user (EC-2, EC-9)
 * DELETE /api/admin/users/:id/ban   — Lift a global ban (admin only)
 */

const { query }   = require('../db/pool');
const xmpp        = require('../services/xmpp-provisioner');
const { authenticate, requireAdmin } = require('../middleware/authenticate');

module.exports = async function adminRoutes(fastify) {

  // All admin routes require authentication + admin role
  const preHandler = [authenticate, requireAdmin];

  // ---------------------------------------------------------------------------
  // GET /api/admin/xmpp/status
  // Returns Prosody connection stats for the admin dashboard.
  // ---------------------------------------------------------------------------
  fastify.get('/xmpp/status', { preHandler }, async (request, reply) => {
    const status = await xmpp.getServerStatus();
    return reply.send(status);
  });

  // ---------------------------------------------------------------------------
  // GET /api/admin/users
  // Returns a paginated list of all users with ban status.
  // ---------------------------------------------------------------------------
  fastify.get('/users', { preHandler }, async (request, reply) => {
    const limit  = Math.min(parseInt(request.query.limit  || '50', 10), 100);
    const offset = Math.max(parseInt(request.query.offset || '0',  10), 0);

    const result = await query(
      `SELECT id, username, email, role, is_globally_banned, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const total = await query('SELECT COUNT(*) FROM users');

    return reply.send({
      users: result.rows,
      total: parseInt(total.rows[0].count, 10),
      limit,
      offset,
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/admin/users/:id/ban   (EC-2, EC-9: Global Ban)
  // Two-step atomic eviction:
  //   1. Set is_globally_banned = true in PostgreSQL
  //   2. Call Prosody to terminate all active XMPP sessions immediately
  // ---------------------------------------------------------------------------
  fastify.post('/users/:id/ban', {
    preHandler,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { reason: { type: 'string', maxLength: 500 } },
      },
    },
  }, async (request, reply) => {
    const targetId = request.params.id;
    const reason   = request.body?.reason || null;
    const adminId  = request.user.id;

    // Prevent admins from banning themselves
    if (targetId === adminId) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Administrators cannot ban themselves.' });
    }

    // Fetch the target user to get their username (needed for XMPP kick)
    const userResult = await query(
      'SELECT id, username, xmpp_jid, is_globally_banned FROM users WHERE id = $1',
      [targetId]
    );
    const target = userResult.rows[0];

    if (!target) {
      return reply.code(404).send({ error: 'Not Found', message: 'User not found.' });
    }

    if (target.is_globally_banned) {
      return reply.code(409).send({ error: 'Conflict', message: 'User is already globally banned.' });
    }

    // Step 1: PostgreSQL write — mark user as globally banned
    await query(
      'UPDATE users SET is_globally_banned = true, updated_at = NOW() WHERE id = $1',
      [targetId]
    );

    // Insert ban record into global_bans for audit log
    await query(
      `INSERT INTO global_bans (user_id, banned_by, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET banned_by = $2, reason = $3, banned_at = NOW()`,
      [targetId, adminId, reason]
    );

    // Step 2: Terminate all active XMPP sessions (EC-2)
    // Extract username from JID: "alice@serverA.local" -> "alice"
    const username = target.xmpp_jid.split('@')[0];
    await xmpp.kickAllSessions(username);

    request.log.info({ targetId, bannedBy: adminId, reason }, '[admin/ban] User globally banned');

    return reply.send({
      message: `User ${target.username} has been globally banned.`,
      userId:  targetId,
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/admin/users/:id/ban   (EC-9: Lift Global Ban)
  // Allows an admin to reinstate a banned user.
  // No XMPP action needed — the user will need to log in again.
  // ---------------------------------------------------------------------------
  fastify.delete('/users/:id/ban', {
    preHandler,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const targetId = request.params.id;

    const userResult = await query(
      'SELECT id, username, is_globally_banned FROM users WHERE id = $1',
      [targetId]
    );
    const target = userResult.rows[0];

    if (!target) {
      return reply.code(404).send({ error: 'Not Found', message: 'User not found.' });
    }

    if (!target.is_globally_banned) {
      return reply.code(409).send({ error: 'Conflict', message: 'User is not globally banned.' });
    }

    // Lift the ban
    await query(
      'UPDATE users SET is_globally_banned = false, updated_at = NOW() WHERE id = $1',
      [targetId]
    );
    await query('DELETE FROM global_bans WHERE user_id = $1', [targetId]);

    request.log.info({ targetId, unbannedBy: request.user.id }, '[admin/ban] Global ban lifted');

    return reply.send({
      message: `Ban on user ${target.username} has been lifted. They must log in again.`,
      userId: targetId,
    });
  });

};
