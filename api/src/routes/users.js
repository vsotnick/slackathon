'use strict';
/**
 * routes/users.js — Public user directory (Phase 2.6)
 *
 * GET /api/users
 *   Returns all non-banned, registered users.
 *   Sensitive fields (password_hash, xmpp credentials) are NEVER returned.
 *   Requires a valid JWT — exposed to all authenticated clients.
 */

const { query }        = require('../db/pool');
const { authenticate } = require('../middleware/authenticate');

module.exports = async function usersRoutes(fastify) {

  // ---------------------------------------------------------------------------
  // GET /api/users
  //
  // Returns the global user directory.  Used by the client to:
  //   — Populate the DM sidebar list (Phase 2.6)
  //   — Resolve display names for presence status updates
  //
  // Excluded fields: password_hash, xmpp_password_*, is_globally_banned
  // Optional ?exclude_self=true  strips the calling user from the result
  // ---------------------------------------------------------------------------
  fastify.get('/', {
    preHandler: [authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          exclude_self: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    const excludeSelf = request.query.exclude_self !== false;

    // Fix 6a: Directory privacy — only list users who share at least one
    // public (is_private = false) room with the requesting user.
    // This means two users who only share a private room are NOT discoverable
    // by each other through this API.
    const result = await query(
      `SELECT DISTINCT
         u.id,
         u.username,
         u.email,
         u.xmpp_jid    AS jid,
         u.role,
         u.created_at,
         u.friends_only_dms
       FROM users u
       WHERE u.is_globally_banned = false
         ${excludeSelf ? 'AND u.id <> $1' : ''}
         AND EXISTS (
           SELECT 1
           FROM room_members rm_other
           INNER JOIN rooms r ON r.id = rm_other.room_id AND r.is_private = false
           INNER JOIN room_members rm_self ON rm_self.room_id = r.id AND rm_self.user_id = ${excludeSelf ? '$1' : '$1'}
           WHERE rm_other.user_id = u.id
         )
       ORDER BY u.username ASC`,
      excludeSelf ? [request.user.id] : [request.user.id]
    );

    return reply.send({ users: result.rows });
  });

  // ---------------------------------------------------------------------------
  // GET /api/users/active-dms (Phase 2.6 bugfix: DM Recovery)
  // ---------------------------------------------------------------------------
  fastify.get('/active-dms', {
    preHandler: [authenticate]
  }, async (request, reply) => {
    const myUsername = request.user.username;
    const host = 'servera.local';
    
    // Use an aggregation to get the most recent interaction per peer JID
    // Security: Filter out users we have blocked
    const result = await query(
      `SELECT "with" AS peer_jid, MAX("when") AS last_contact
       FROM prosodyarchive
       WHERE host = $1 AND "user" = $2 AND store = 'archive'
         AND split_part("with", '@', 1) NOT IN (
           SELECT u.username
           FROM user_blocks ub
           JOIN users u ON u.id = ub.blocked_id
           WHERE ub.blocker_id = $3
         )
       GROUP BY "with"
       ORDER BY last_contact DESC
       LIMIT 50`,
      [host, myUsername, request.user.id]
    );
    
    const activeDms = result.rows.map(r => r.peer_jid);
    return reply.send({ activeDms });
  });

  // ---------------------------------------------------------------------------
  // GET /api/users/:username/messages (Phase 2.6 bugfix: DM History)
  // Fetch DM history between the requesting user and the target user.
  // ---------------------------------------------------------------------------
  fastify.get('/:username/messages', {
    preHandler: [authenticate],
    schema: {
      params: { type: 'object', required: ['username'], properties: { username: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          before_watermark: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 50 },
        },
      },
    }
  }, async (request, reply) => {
    const peerUsername = request.params.username;
    const myUsername = request.user.username;
    const host = 'servera.local';
    const peerJid = `${peerUsername}@${host}`;
    
    const limit = Math.min(request.query.limit || 50, 50);
    const beforeMark = request.query.before_watermark;

    // Security check: Deny access to history if the target user has been blocked
    try {
      const blockCheck = await query(`
        SELECT 1 FROM user_blocks 
        WHERE blocker_id = $1 AND blocked_id = (SELECT id FROM users WHERE username = $2)
      `, [request.user.id, peerUsername]);

      if (blockCheck.rowCount > 0) {
        return reply.code(403).send({ error: 'Forbidden', message: 'User is blocked.' });
      }
    } catch (err) {
      request.log.error({ err }, 'Failed to verify block list');
      return reply.code(500).send({ error: 'Internal Server Error' });
    }

    try {
      let result;
      if (beforeMark) {
        result = await query(
          `SELECT sort_id AS id, "when", value AS stanza
           FROM prosodyarchive
           WHERE host = $1 AND "user" = $2 AND store = 'archive' AND "with" = $3 AND sort_id < $4
           ORDER BY sort_id DESC
           LIMIT $5`,
          [host, myUsername, peerJid, beforeMark, limit]
        );
      } else {
        result = await query(
          `SELECT sort_id AS id, "when", value AS stanza
           FROM prosodyarchive
           WHERE host = $1 AND "user" = $2 AND store = 'archive' AND "with" = $3
           ORDER BY sort_id DESC
           LIMIT $4`,
          [host, myUsername, peerJid, limit]
        );
      }
      
      const messages = result.rows.reverse();
      return reply.send({ 
        messages,
        nextCursor: messages.length > 0 ? messages[0].id : null
      });
    } catch (dbErr) {
      if (dbErr.code === '42P01' || dbErr.code === '42703') return reply.send({ messages: [], nextCursor: null });
      throw dbErr;
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /api/users/me/privacy
  // Update privacy settings (e.g. friends-only DMs)
  // ---------------------------------------------------------------------------
  fastify.put('/me/privacy', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['friends_only_dms'],
        properties: {
          friends_only_dms: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const userId = request.user.id;
    const { friends_only_dms } = request.body;
    
    await query(`UPDATE users SET friends_only_dms = $1, updated_at = NOW() WHERE id = $2`, [friends_only_dms, userId]);
    
    return reply.send({ success: true, friends_only_dms });
  });

};
