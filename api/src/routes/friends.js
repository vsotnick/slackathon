'use strict';

const { query } = require('../db/pool');
const { authenticate } = require('../middleware/authenticate');

module.exports = async function friendRoutes(fastify) {
  // GET /api/friends
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const userId = request.user.id;
    
    // Fetch friendships (accepted and pending)
    const friendsRows = await query(`
      SELECT f.status, f.created_at, f.requester_id, f.addressee_id,
        CASE WHEN f.requester_id = $1 THEN u2.id ELSE u1.id END as user_id,
        CASE WHEN f.requester_id = $1 THEN u2.username ELSE u1.username END as username,
        CASE WHEN f.requester_id = $1 THEN u2.xmpp_jid ELSE u1.xmpp_jid END as jid
      FROM friendships f
      JOIN users u1 ON f.requester_id = u1.id
      JOIN users u2 ON f.addressee_id = u2.id
      WHERE f.requester_id = $1 OR f.addressee_id = $1
    `, [userId]);

    // Fetch blocks
    const blocksRows = await query(`
      SELECT b.blocked_id as user_id, u.username, b.blocked_at
      FROM user_blocks b
      JOIN users u ON b.blocked_id = u.id
      WHERE b.blocker_id = $1
    `, [userId]);

    return reply.send({
      friendships: friendsRows.rows,
      blocked: blocksRows.rows
    });
  });

  // POST /api/friends/request
  fastify.post('/request', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId:  { type: 'string' },
          message: { type: 'string', maxLength: 200 }, // req 2.3.2c: optional text
        },
      },
    },
  }, async (request, reply) => {
    const myId = request.user.id;
    const { userId: targetId, message } = request.body;

    if (myId === targetId) return reply.code(400).send({ message: "Cannot friend yourself" });
    
    // Check if target user exists
    const checkUser = await query(`SELECT id FROM users WHERE id = $1`, [targetId]);
    if (checkUser.rowCount === 0) return reply.code(404).send({ message: "User not found." });

    // Security: Check if blocked by target
    const blockCheck = await query(`SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [targetId, myId]);
    if (blockCheck.rowCount > 0) return reply.code(403).send({ error: 'Forbidden', message: "User is not available." });

    // Insert or ignore if pending/accepted
    const existCheck = await query(`
        SELECT status FROM friendships 
        WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
    `, [myId, targetId]);
    
    if (existCheck.rowCount > 0) return reply.code(409).send({ message: "Friendship relation already exists." });

    await query(
      `INSERT INTO friendships (requester_id, addressee_id, status, message) VALUES ($1, $2, 'pending', $3)`,
      [myId, targetId, message || null]
    );
    return reply.send({ message: "Friend request sent." });
  });

  // POST /api/friends/accept
  fastify.post('/accept', {
    preHandler: [authenticate],
    schema: { body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } } }
  }, async (request, reply) => {
    const myId = request.user.id;
    const requesterId = request.body.userId; // The person who sent the request

    const res = await query(`
      UPDATE friendships SET status = 'accepted' 
      WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending' 
      RETURNING *
    `, [requesterId, myId]);

    if (res.rowCount === 0) return reply.code(404).send({ message: "Pending request not found." });
    return reply.send({ message: "Friend request accepted." });
  });

  // DELETE /api/friends/remove/:userId
  fastify.delete('/remove/:userId', {
    preHandler: [authenticate],
    schema: { params: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } } }
  }, async (request, reply) => {
    const myId = request.user.id;
    const targetId = request.params.userId;

    const res = await query(`
      DELETE FROM friendships 
      WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
    `, [myId, targetId]);

    return reply.send({ message: "Friendship removed." });
  });

  // POST /api/friends/block
  fastify.post('/block', {
    preHandler: [authenticate],
    schema: { body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } } }
  }, async (request, reply) => {
    const myId = request.user.id;
    const targetId = request.body.userId;

    await query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [myId, targetId]);
    
    // Also remove any friendship
    await query(`
      DELETE FROM friendships 
      WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
    `, [myId, targetId]);

    return reply.send({ message: "User blocked." });
  });

  // DELETE /api/friends/unblock/:userId
  fastify.delete('/unblock/:userId', {
    preHandler: [authenticate],
    schema: { params: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } } }
  }, async (request, reply) => {
    const myId = request.user.id;
    const targetId = request.params.userId;

    await query(`DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [myId, targetId]);
    return reply.send({ message: "User unblocked." });
  });

  // POST /api/friends/decline — Decline a pending friend request
  fastify.post('/decline', {
    preHandler: [authenticate],
    schema: { body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } } }
  }, async (request, reply) => {
    const myId = request.user.id;
    const requesterId = request.body.userId;

    await query(
      `DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [requesterId, myId]
    );
    return reply.send({ message: 'Friend request declined.' });
  });
};

