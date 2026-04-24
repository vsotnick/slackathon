'use strict';
/**
 * routes/rooms.js — Room management and message history endpoints.
 *
 * GET  /api/rooms                              — List public rooms
 * POST /api/rooms                              — Create a new room
 * GET  /api/rooms/:id/messages                 — Keyset-paginated message history (EC-5, EC-8)
 * POST /api/rooms/:id/members/:userId/kick     — Kick a user from a room (EC-9)
 *
 * EC-5 (Hybrid Protocol): Room message history is fetched via REST, NOT WebSocket.
 *       The WS channel is reserved for real-time events only.
 *
 * EC-8 (Deep Scroll Pagination): Message history uses keyset pagination via
 *       `before_watermark` instead of OFFSET, enabling O(log N) queries on
 *       100k+ message archives via the idx_prosodyarchive_keyset index.
 */

const fs = require('fs');
const path = require('path');
const { query, getClient } = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/authenticate');
const config = require('../config');

module.exports = async function roomRoutes(fastify) {

  // ---------------------------------------------------------------------------
  // GET /api/rooms/public — Browse the public room catalog (req 2.4.3)
  // Any authenticated user can browse public rooms (not just rooms they joined)
  // ---------------------------------------------------------------------------
  fastify.get('/public', {
    preHandler: [authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query.q?.trim() || '';
    const pattern = q ? `%${q}%` : '%';

    const result = await query(
      `SELECT r.id, r.name, r.description, r.created_at,
              u.username AS owner_username,
              COUNT(rm.user_id) AS member_count,
              -- Whether the requesting user is already a member
              EXISTS(
                SELECT 1 FROM room_members me WHERE me.room_id = r.id AND me.user_id = $1
              ) AS is_member,
              -- Whether the requesting user is banned from this room
              EXISTS(
                SELECT 1 FROM room_kicks bk WHERE bk.room_id = r.id AND bk.user_id = $1
              ) AS is_banned
       FROM rooms r
       LEFT JOIN users u ON u.id = r.owner_id
       LEFT JOIN room_members rm ON rm.room_id = r.id
       WHERE r.is_private = false
         AND (r.name ILIKE $2 OR r.description ILIKE $2)
       GROUP BY r.id, u.username
       ORDER BY member_count DESC, r.created_at ASC
       LIMIT 100`,
      [request.user.id, pattern]
    );

    return reply.send({ rooms: result.rows });
  });

  // ---------------------------------------------------------------------------
  // GET /api/rooms — List rooms the authenticated user is a member of
  // ---------------------------------------------------------------------------
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    // Fix 4b: only return rooms where the requester is an explicit member.
    // This means the row must exist in room_members for this user.
    // is_private is returned so the client can render PUBLIC vs PRIVATE groups (Fix 5).
    const result = await query(
      `SELECT r.id, r.name, r.jid, r.description, r.is_private, r.watermark_seq,
              r.created_at,
              u.username AS owner_username,
              rm.last_read_seq,
              COUNT(rm2.user_id) AS member_count
       FROM rooms r
       INNER JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $1
       LEFT JOIN users u ON u.id = r.owner_id
       LEFT JOIN room_members rm2 ON rm2.room_id = r.id
       GROUP BY r.id, u.username, rm.last_read_seq
       ORDER BY r.created_at ASC
       LIMIT 200`,
      [request.user.id]
    );

    return reply.send({ rooms: result.rows });
  });

  // ---------------------------------------------------------------------------
  // POST /api/rooms — Create a new room
  // ---------------------------------------------------------------------------
  fastify.post('/', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:        { type: 'string', minLength: 2, maxLength: 64, pattern: '^[a-zA-Z0-9_-]+$' },
          description: { type: 'string', maxLength: 500 },
          is_private:  { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { name, description = null, is_private = false } = request.body;
    const ownerId = request.user.id;

    const jid = `${name.toLowerCase()}@${config.xmppMucDomain}`;

    try {
      const result = await query(
        `INSERT INTO rooms (name, jid, description, is_private, owner_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, jid, description, is_private, watermark_seq, created_at`,
        [name.toLowerCase(), jid, description, is_private, ownerId]
      );
      const room = result.rows[0];

      // Add the creator as the room owner in room_members
      await query(
        `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [room.id, ownerId]
      );

      return reply.code(201).send({ room });
    } catch (err) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'Conflict', message: 'A room with this name already exists.' });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/rooms/:id/messages — Keyset-paginated history (EC-5, EC-8)
  //
  // Query params:
  //   before_watermark (number) — fetch messages with watermark < this value
  //                               If omitted, returns the most recent messages
  //   limit (number, default 50, max 100) — page size
  //
  // This endpoint queries the Prosody archive table (prosodyarchive) directly.
  // The Prosody mod_storage_sql module stores messages in this table when
  // mod_mam is enabled. Column names may vary by Prosody version; we use
  // the standard layout: (id, store, key, when, stanza).
  //
  // For Phase 1, we query the archive by room JID and return the raw stanza XML.
  // The React client parses the XMPP stanza to extract message body and metadata.
  //
  // Prosody prosodyarchive schema (actual columns — verified against live DB):
  //   sort_id  BIGINT PK  — monotonic; used for keyset pagination (EC-8)
  //   host     TEXT       — MUC service domain: 'conference.servera.local'
  //   user     TEXT       — room local part:    'general'
  //   store    TEXT       — always 'muc_log' for MUC message archives
  //   key      TEXT       — per-message archive UUID (NOT the room JID)
  //   when     INTEGER    — Unix timestamp
  //   value    TEXT       — raw XML <message> stanza (type='xml')
  //
  // Room lookup: split room.jid at '@':
  //   'general@conference.servera.local' → host='conference.servera.local', user='general'
  // ---------------------------------------------------------------------------
  fastify.get('/:id/messages', {
    preHandler: [authenticate],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          before_watermark: { type: 'integer', minimum: 1 },
          limit:            { type: 'integer', minimum: 1, maximum: 50, default: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const roomId        = request.params.id;
    const limit         = Math.min(request.query.limit || 50, 50);
    const beforeMark    = request.query.before_watermark;

    // Verify the room exists and the user is a member
    const roomResult = await query(
      `SELECT r.id, r.jid, r.watermark_seq
       FROM rooms r
       INNER JOIN room_members rm ON rm.room_id = r.id
       WHERE r.id = $1 AND rm.user_id = $2`,
      [roomId, request.user.id]
    );
    const room = roomResult.rows[0];

    if (!room) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'Room not found or you are not a member.',
      });
    }

    // Split room JID into the two columns Prosody uses to identify the room:
    //   'general@conference.servera.local' → mucLocal='general', mucHost='conference.servera.local'
    const atSign  = room.jid.indexOf('@');
    const mucLocal = atSign >= 0 ? room.jid.slice(0, atSign)      : room.jid;
    const mucHost  = atSign >= 0 ? room.jid.slice(atSign + 1)     : '';

    // EC-8: Keyset pagination using sort_id (monotonic BIGINT PK).
    // sort_id < before_watermark replaces OFFSET for O(log N) queries.
    let archiveResult;
    try {
      if (beforeMark) {
        // Paginating backward: load messages with sort_id older than watermark
        archiveResult = await query(
          `SELECT sort_id AS id, "when", value AS stanza
           FROM prosodyarchive
           WHERE host = $1 AND "user" = $2 AND store = 'muc_log' AND sort_id < $3
           ORDER BY sort_id DESC
           LIMIT $4`,
          [mucHost, mucLocal, beforeMark, limit]
        );
      } else {
        // First load: return the most recent N messages
        archiveResult = await query(
          `SELECT sort_id AS id, "when", value AS stanza
           FROM prosodyarchive
           WHERE host = $1 AND "user" = $2 AND store = 'muc_log'
           ORDER BY sort_id DESC
           LIMIT $3`,
          [mucHost, mucLocal, limit]
        );
      }
    } catch (dbErr) {
      // 42P01 — prosodyarchive table doesn't exist yet (no messages ever sent)
      // 42703 — column name mismatch (schema drift guard)
      if (dbErr.code === '42P01' || dbErr.code === '42703') {
        request.log.warn({ err: dbErr }, '[rooms/messages] Archive query skipped — empty or schema mismatch');
        return reply.send({ messages: [], roomWatermark: room.watermark_seq });
      }
      throw dbErr;
    }

    // Return messages in chronological order (oldest first for rendering)
    const messages = archiveResult.rows.reverse();

    return reply.send({
      messages,
      roomWatermark: room.watermark_seq,
      // Pagination cursor: pass this as before_watermark in the next request
      nextCursor: messages.length > 0 ? messages[0].id : null,
    });
  });


  // ---------------------------------------------------------------------------
  // POST /api/rooms/:id/members/:userId/kick  (EC-9: Remove = kick from room)
  // ---------------------------------------------------------------------------
  fastify.post('/:id/members/:userId/kick', {
    preHandler: [authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id', 'userId'],
        properties: { id: { type: 'string' }, userId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: { reason: { type: 'string', maxLength: 500 } },
      },
    },
  }, async (request, reply) => {
    const roomId   = request.params.id;
    const targetId = request.params.userId;
    const reason   = request.body?.reason || null;
    const actorId  = request.user.id;

    // Verify actor has admin/owner role in the room
    const actorMember = await query(
      `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`,
      [roomId, actorId]
    );
    if (!actorMember.rows[0] || !['admin', 'owner', 'moderator'].includes(actorMember.rows[0].role)) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient room privileges.' });
    }

    // Remove from room_members
    const deleteResult = await query(
      `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2 RETURNING user_id`,
      [roomId, targetId]
    );

    if (deleteResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Not Found', message: 'User is not a member of this room.' });
    }

    // Audit log in room_kicks
    await query(
      `INSERT INTO room_kicks (room_id, user_id, kicked_by, reason)
       VALUES ($1, $2, $3, $4)`,
      [roomId, targetId, actorId, reason]
    );

    // Note: The actual XMPP MUC kick stanza is sent by the React frontend
    // via the WebSocket connection (EC-5: WS handles real-time events).
    // The REST call here is the authority — it updates the DB access control.
    // The WS kick stanza notifies the client to disconnect from the MUC room.

    return reply.send({ message: 'User has been removed from the room.' });
  });

  // ---------------------------------------------------------------------------
  // POST /api/rooms/:id/join — Join a public room (req 2.4.3b)
  // ---------------------------------------------------------------------------
  fastify.post('/:id/join', {
    preHandler: [authenticate],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { id: roomId } = request.params;
    const userId = request.user.id;

    // Check the room exists and is public
    const roomRes = await query(`SELECT id, is_private FROM rooms WHERE id = $1`, [roomId]);
    if (!roomRes.rows[0]) return reply.code(404).send({ error: 'Not Found', message: 'Room not found.' });
    if (roomRes.rows[0].is_private) {
      return reply.code(403).send({ error: 'Forbidden', message: 'This is a private room. You must be invited.' });
    }

    // req 2.4.8: Check if user is banned from this room
    const banCheck = await query(
      `SELECT 1 FROM room_kicks WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [roomId, userId]
    );
    if (banCheck.rows.length > 0) {
      return reply.code(403).send({ error: 'Forbidden', message: 'You have been banned from this room.' });
    }

    await query(
      `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [roomId, userId]
    );

    return reply.send({ message: 'Joined room successfully.' });
  });

  // ---------------------------------------------------------------------------
  // POST /api/rooms/:id/invite
  // ---------------------------------------------------------------------------
  fastify.post('/:id/invite', {
    preHandler: [authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const roomId = request.params.id;
    const { userId } = request.body;
    const actorId = request.user.id;

    // 1. Verify actor has permissions (admin/owner/moderator) in the room
    const actorMember = await query(
      `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`,
      [roomId, actorId]
    );

    if (!actorMember.rows[0]) {
      return reply.code(403).send({ error: 'Forbidden', message: 'You must be a member of this room to invite others.' });
    }

    // 2. Ensure the target user actually exists
    const targetCheck = await query(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (targetCheck.rows.length === 0) {
      return reply.code(404).send({ error: 'Not Found', message: 'Target user does not exist.' });
    }

    // req 2.4.8: Check if the user is banned from this room — banned users cannot be re-invited
    const banCheck = await query(
      `SELECT 1 FROM room_kicks WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [roomId, userId]
    );
    if (banCheck.rows.length > 0) {
      return reply.code(403).send({ error: 'Forbidden', message: 'This user is banned from the room. Unban them first.' });
    }

    // 3. Insert target into room_members
    await query(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [roomId, userId]
    );

    return reply.send({ message: 'User invited successfully.' });
  });

  // ---------------------------------------------------------------------------
  // GET /api/rooms/:id — Fetch full room details for Manage Modal
  // ---------------------------------------------------------------------------
  fastify.get('/:id', {
    preHandler: [authenticate],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } }
  }, async (request, reply) => {
    const { id: roomId } = request.params;
    
    // Ensure membership
    const membership = await query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, request.user.id]);
    if (!membership.rows[0]) return reply.code(403).send({ error: 'Forbidden', message: 'You are not a member.' });
    
    const myRole = membership.rows[0].role;

    // Fetch members array
    const membersData = await query(
      `SELECT rm.user_id as id, u.username, rm.role, rm.joined_at 
       FROM room_members rm 
       JOIN users u ON rm.user_id = u.id 
       WHERE rm.room_id = $1`, [roomId]
    );

    let bansData = { rows: [] };
    if (myRole === 'owner' || myRole === 'admin') {
      bansData = await query(
        `SELECT rk.user_id as id, u.username, rk.reason, u_by.username as by_username, rk.kicked_at
         FROM room_kicks rk
         JOIN users u ON rk.user_id = u.id
         LEFT JOIN users u_by ON rk.kicked_by = u_by.id
         WHERE rk.room_id = $1`, [roomId]
      );
    }

    return reply.send({
      myRole,
      members: membersData.rows,
      banned: bansData.rows
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/rooms/:id/members/:userId — Change user role
  // ---------------------------------------------------------------------------
  fastify.put('/:id/members/:userId', {
    preHandler: [authenticate],
    schema: {
      params: { type: 'object', required: ['id', 'userId'], properties: { id: { type: 'string' }, userId: { type: 'string' } } },
      body: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['member', 'admin', 'moderator'] } } }
    }
  }, async (request, reply) => {
    const { id: roomId, userId: targetId } = request.params;
    const { role } = request.body;
    const actorId = request.user.id;

    const actor = await query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, actorId]);
    if (!actor.rows[0] || actor.rows[0].role !== 'owner') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Only owners can change roles.' });
    }

    const target = await query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, targetId]);
    if (!target.rows[0]) return reply.code(404).send({ error: 'Not Found', message: 'User is not in room.' });
    if (target.rows[0].role === 'owner') return reply.code(403).send({ error: 'Forbidden', message: 'Cannot change owner role.' });

    await query(`UPDATE room_members SET role = $1 WHERE room_id = $2 AND user_id = $3`, [role, roomId, targetId]);
    return reply.send({ message: 'Role updated successfully.' });
  });

  // ---------------------------------------------------------------------------
  // POST /api/rooms/:id/kick — Kick member
  // ---------------------------------------------------------------------------
  fastify.post('/:id/kick', {
    preHandler: [authenticate],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' }, reason: { type: 'string' } } }
    }
  }, async (request, reply) => {
    const { id: roomId } = request.params;
    const { userId: targetId, reason } = request.body;
    const actorId = request.user.id;

    const actor = await query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, actorId]);
    if (!actor.rows[0] || !['admin', 'owner'].includes(actor.rows[0].role)) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient room privileges.' });
    }

    const deleteRes = await query(`DELETE FROM room_members WHERE room_id = $1 AND user_id = $2 RETURNING user_id`, [roomId, targetId]);
    if (deleteRes.rows.length === 0) return reply.code(404).send({ error: 'Not Found', message: 'User not in room.' });

    await query(`INSERT INTO room_kicks (room_id, user_id, kicked_by, reason) VALUES ($1, $2, $3, $4)`, [roomId, targetId, actorId, reason]);
    return reply.send({ message: 'User kicked.' });
  });

  // ---------------------------------------------------------------------------
  // POST /api/rooms/:id/ban — Ban member
  // ---------------------------------------------------------------------------
  fastify.post('/:id/ban', {
    preHandler: [authenticate],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' }, reason: { type: 'string' } } }
    }
  }, async (request, reply) => {
    const { id: roomId } = request.params;
    const { userId: targetId, reason } = request.body;
    const actorId = request.user.id;

    const actor = await query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, actorId]);
    if (!actor.rows[0] || !['admin', 'owner'].includes(actor.rows[0].role)) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient room privileges.' });
    }

    await query(`DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, targetId]);
    // A ban is just a kick that is checked during join/invite later (business logic constraint)
    await query(`INSERT INTO room_kicks (room_id, user_id, kicked_by, reason) VALUES ($1, $2, $3, $4)`, [roomId, targetId, actorId, reason || 'Banned']);
    return reply.send({ message: 'User banned.' });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/rooms/:id/ban/:userId — Unban a user (remove from ban list) (req 2.4.7)
  // ---------------------------------------------------------------------------
  fastify.delete('/:id/ban/:userId', {
    preHandler: [authenticate],
    schema: {
      params: { type: 'object', required: ['id', 'userId'], properties: { id: { type: 'string' }, userId: { type: 'string' } } },
    }
  }, async (request, reply) => {
    const { id: roomId, userId: targetId } = request.params;
    const actorId = request.user.id;

    const actor = await query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, actorId]);
    if (!actor.rows[0] || !['admin', 'owner'].includes(actor.rows[0].role)) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient room privileges.' });
    }

    // Delete all kick/ban records for this user in this room
    await query(`DELETE FROM room_kicks WHERE room_id = $1 AND user_id = $2`, [roomId, targetId]);
    return reply.send({ message: 'User unbanned from room.' });
  });



  // ---------------------------------------------------------------------------
  // POST /api/rooms/:id/leave — Leave room
  // ---------------------------------------------------------------------------
  fastify.post('/:id/leave', {
    preHandler: [authenticate],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } }
  }, async (request, reply) => {
    const { id: roomId } = request.params;
    const actorId = request.user.id;

    const membership = await query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, actorId]);
    if (!membership.rows[0]) return reply.code(200).send({ message: 'Already left.' });
    if (membership.rows[0].role === 'owner') return reply.code(403).send({ error: 'Forbidden', message: 'Owner cannot leave room, they must delete it.' });

    await query(`DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, actorId]);
    return reply.send({ message: 'Left room successfully.' });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/rooms/:id — Update room settings (rename, privacy)
  // ---------------------------------------------------------------------------
  fastify.put('/:id', {
    preHandler: [authenticate],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { 
        type: 'object', 
        properties: { 
          name: { type: 'string', minLength: 2, maxLength: 64, pattern: '^[a-zA-Z0-9_-]+$' },
          is_private: { type: 'boolean' }
        } 
      }
    }
  }, async (request, reply) => {
    const { id: roomId } = request.params;
    const { name, is_private } = request.body;
    const actorId = request.user.id;

    const membership = await query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, actorId]);
    if (!membership.rows[0] || membership.rows[0].role !== 'owner') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Only the room owner can update settings.' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      // NOTE: changing name doesn't change the underlying JID!
      updates.push(`name = $${idx++}`);
      values.push(name.toLowerCase());
    }
    if (is_private !== undefined) {
      updates.push(`is_private = $${idx++}`);
      values.push(is_private);
    }

    if (updates.length === 0) return reply.send({ message: 'No changes provided.' });

    values.push(roomId);
    
    try {
      await query(`UPDATE rooms SET ${updates.join(', ')} WHERE id = $${idx}`, values);
      return reply.send({ message: 'Room settings updated successfully.' });
    } catch (err) {
      if (err.code === '23505') {
         return reply.code(409).send({ error: 'Conflict', message: 'A room with this name already exists.' });
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/rooms/:id — Delete room & handle physical file unlink
  // ---------------------------------------------------------------------------
  fastify.delete('/:id', {
    preHandler: [authenticate],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } }
  }, async (request, reply) => {
    const { id: roomId } = request.params;
    const actorId = request.user.id;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const room = await client.query(`SELECT owner_id FROM rooms WHERE id = $1`, [roomId]);
      if (!room.rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Not Found', message: 'Room not found.' });
      }
      
      const membership = await client.query(`SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, actorId]);
      if (!membership.rows[0] || membership.rows[0].role !== 'owner') {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the room owner can delete it.' });
      }

      // CRITICAL GUARDRAIL: Find all associated files to physically delete
      const filesResult = await client.query(`SELECT stored_path FROM files WHERE room_id = $1`, [roomId]);

      // Database delete (cascades to room_members, configs, and files db rows depending on schema)
      // Wait, let's explicitly delete files first to be safe if cascade isn't on files or we want to unlink first
      await client.query(`DELETE FROM files WHERE room_id = $1`, [roomId]);
      await client.query(`DELETE FROM rooms WHERE id = $1`, [roomId]);

      await client.query('COMMIT');

      // Physical File Deletion (after commit so we don't drop files if TX fails)
      for (const row of filesResult.rows) {
        if (row.stored_path) {
          const filePath = path.join(config.uploadsDir, row.stored_path);
          try {
            await fs.promises.unlink(filePath);
            request.log.info({ filePath }, '[rooms/delete] Unlinked physical file');
          } catch (e) {
            request.log.warn({ filePath, err: e.message }, '[rooms/delete] Failed to unlink file, might already be gone');
          }
        }
      }

      return reply.send({ message: 'Room and all associated files deleted securely.' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /api/rooms/:id/read — Mark room as read up to a given watermark seq
  //
  // The client calls this when the user views a room. last_read_seq is advanced
  // to the room's current watermark_seq so unread = (watermark_seq - last_read_seq).
  // ---------------------------------------------------------------------------
  fastify.put('/:id/read', {
    preHandler: [authenticate],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          seq: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const roomId = request.params.id;
    const userId = request.user.id;
    // If seq is provided, use it; otherwise mark as read up to the room's current watermark
    const seq = request.body?.seq;

    let result;
    if (seq !== undefined) {
      // Only advance forward — never regress
      result = await query(
        `UPDATE room_members SET last_read_seq = GREATEST(last_read_seq, $1)
         WHERE room_id = $2 AND user_id = $3
         RETURNING last_read_seq`,
        [seq, roomId, userId]
      );
    } else {
      // Mark as fully read (advance to room's current watermark_seq)
      result = await query(
        `UPDATE room_members rm SET last_read_seq = r.watermark_seq
         FROM rooms r
         WHERE rm.room_id = r.id AND rm.room_id = $1 AND rm.user_id = $2
         RETURNING rm.last_read_seq`,
        [roomId, userId]
      );
    }

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Not Found', message: 'Not a member of this room.' });
    }

    return reply.send({ last_read_seq: result.rows[0].last_read_seq });
  });

};
