'use strict';
/**
 * GET /api/search
 *
 * Query params:
 *   q     (string, required, 2–100 chars) — the search term
 *   room  (string, optional)              — room local-part to restrict message search to
 *                                          (derived from #roomname syntax in the client)
 *
 * Returns:
 *   { people: [...], rooms: [...], messages: [...], files: [...] }
 *
 * Access control:
 *   - People: any registered user (basic profile only)
 *   - Rooms:  only rooms the requester is a member of
 *   - Messages: only messages from rooms the requester is a member of
 *   - Files:  only files in rooms the requester is a member of
 */

const { query } = require('../db/pool');
const { authenticate } = require('../middleware/authenticate');

// Extract the plain-text body from a Prosody XML stanza string.
// Handles both <body>text</body> and HTML-entity encoded bodies.
function extractBody(stanza) {
  const match = stanza.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) return '';
  return match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract the sender nick from a 'from' attribute in the stanza.
// e.g. from='general@conference.servera.local/alice' → 'alice'
function extractSender(stanza) {
  const match = stanza.match(/from=['"]([^'"]+)['"]/i);
  if (!match) return null;
  const from = match[1];
  const slashIdx = from.indexOf('/');
  return slashIdx >= 0 ? from.slice(slashIdx + 1) : from.split('@')[0];
}

module.exports = async function searchRoutes(fastify) {
  fastify.get('/', {
    preHandler: [authenticate],
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q:    { type: 'string', minLength: 2, maxLength: 100 },
          room: { type: 'string', maxLength: 64 }, // optional room local-part filter
        },
      },
    },
  }, async (request, reply) => {
    const rawQ    = request.query.q.trim();
    const roomFilter = request.query.room?.toLowerCase() || null; // e.g. "general"
    const authId  = request.user.id;
    const pattern = `%${rawQ}%`;

    // ── 1. People search ────────────────────────────────────────────────────
    // Return any user whose username or email matches (capped at 8).
    // We intentionally do NOT filter by room membership here — finding a person
    // is useful even if they're not in a shared room yet.
    const peopleResult = await query(
      `SELECT id, username, xmpp_jid AS jid, role
       FROM users
       WHERE username ILIKE $1 OR email ILIKE $1
       ORDER BY username
       LIMIT 8`,
      [pattern]
    );

    // ── 2. Rooms search ──────────────────────────────────────────────────────
    // Only rooms the requester is a member of, matching by name or description.
    const roomsResult = await query(
      `SELECT r.id, r.name, r.jid, r.description, r.is_private
       FROM rooms r
       JOIN room_members m ON r.id = m.room_id
       WHERE m.user_id = $1 AND (r.name ILIKE $2 OR r.description ILIKE $2)
       ORDER BY r.name
       LIMIT 8`,
      [authId, pattern]
    );

    // ── 3. Get accessible MUC JIDs (for message ACL) ────────────────────────
    const memberRoomsRes = await query(
      `SELECT r.jid, r.name FROM rooms r JOIN room_members m ON r.id = m.room_id WHERE m.user_id = $1`,
      [authId]
    );
    const accessibleMucJids = memberRoomsRes.rows.map(r => r.jid);

    // Build a map of jid → name for display
    const jidToName = {};
    memberRoomsRes.rows.forEach(r => { jidToName[r.jid] = r.name; });

    // ── 4. Message search in MAM (prosodyarchive) ────────────────────────────
    let messages = [];
    try {
      let mamResult;

      if (roomFilter) {
        // Filter to a single specific room (from #roomname syntax)
        const targetJid = accessibleMucJids.find(
          j => j.split('@')[0].toLowerCase() === roomFilter
        );
        if (targetJid) {
          const [mucLocal, mucHost] = targetJid.split('@');
          mamResult = await query(
            `SELECT sort_id AS id, host, "user" AS local, "when" AS ts, value AS stanza
             FROM prosodyarchive
             WHERE value ILIKE $1
               AND store = 'muc_log'
               AND "user" = $2
               AND host = $3
             ORDER BY "when" DESC
             LIMIT 30`,
            [pattern, mucLocal, mucHost]
          );
        }
      } else if (accessibleMucJids.length > 0) {
        // Search across all accessible rooms
        mamResult = await query(
          `SELECT sort_id AS id, host, "user" AS local, "when" AS ts, value AS stanza
           FROM prosodyarchive
           WHERE value ILIKE $1
             AND store = 'muc_log'
             AND ("user" || '@' || host) = ANY($2)
           ORDER BY "when" DESC
           LIMIT 30`,
          [pattern, accessibleMucJids]
        );
      }

      if (mamResult?.rows) {
        messages = mamResult.rows
          .map(row => {
            const body = extractBody(row.stanza);
            if (!body) return null; // skip non-message stanzas
            const jid = `${row.local}@${row.host}`;
            return {
              type: 'message',
              id: String(row.id),
              roomJid: jid,
              roomName: jidToName[jid] || row.local,
              timestamp: row.ts * 1000,
              sender: extractSender(row.stanza),
              snippet: body.length > 200 ? body.slice(0, 200) + '…' : body,
            };
          })
          .filter(Boolean);
      }
    } catch (e) {
      if (e.code !== '42P01') throw e; // ignore "table not found" gracefully
      request.log.warn('prosodyarchive missing during search — skipping message results');
    }

    // ── 5. File search ────────────────────────────────────────────────────────
    const filesResult = await query(
      `SELECT f.id, f.original_name, f.mime_type, f.uploaded_at, r.jid, r.name AS room_name
       FROM files f
       JOIN rooms r ON f.room_id = r.id
       JOIN room_members m ON r.id = m.room_id
       WHERE m.user_id = $1 AND f.original_name ILIKE $2
       ORDER BY f.uploaded_at DESC
       LIMIT 10`,
      [authId, pattern]
    );

    const files = filesResult.rows.map(row => ({
      type: 'file',
      id: row.id,
      roomJid: row.jid,
      roomName: row.room_name,
      timestamp: new Date(row.uploaded_at).getTime(),
      snippet: row.original_name,
      mimeType: row.mime_type,
    }));

    return reply.send({
      people:   peopleResult.rows,
      rooms:    roomsResult.rows,
      messages: messages,
      files:    files,
    });
  });
};
