'use strict';
/**
 * routes/auth.js — Authentication routes.
 *
 * POST /api/auth/register     — Register a new user (dual auth: PG + XMPP)
 * POST /api/auth/login        — Login and receive JWT + XMPP credentials
 * POST /api/auth/forgot-password — Mock SMTP password reset (EC-1)
 * GET  /api/auth/me           — Get current user profile (protected)
 */

const crypto   = require('crypto');
const bcrypt   = require('bcrypt');
const { query, getClient } = require('../db/pool');
const { encrypt, decrypt } = require('../services/crypto');
const xmpp     = require('../services/xmpp-provisioner');
const config   = require('../config');
const { authenticate } = require('../middleware/authenticate');

const BCRYPT_ROUNDS = 12;

module.exports = async function authRoutes(fastify) {

  // ---------------------------------------------------------------------------
  // POST /api/auth/register
  // ---------------------------------------------------------------------------
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'username', 'password'],
        properties: {
          email:    { type: 'string', format: 'email', maxLength: 320 },
          username: { type: 'string', minLength: 2, maxLength: 32,
                      pattern: '^[a-zA-Z0-9_.-]+$' },
          password: { type: 'string', minLength: 8, maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const { email, username, password } = request.body;

    // Acquire a dedicated client for the transaction
    const client = await getClient();
    let xmppRawPassword = null;

    try {
      await client.query('BEGIN');

      // 1. Check for duplicate email or username
      const dupCheck = await client.query(
        'SELECT id FROM users WHERE email = $1 OR username = $2 LIMIT 1',
        [email.toLowerCase(), username.toLowerCase()]
      );
      if (dupCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Email or username is already registered.',
        });
      }

      // 2. Hash the web login password with bcrypt
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      // 3. Generate a cryptographically random XMPP password
      //    32 bytes = 256 bits of entropy, encoded as hex = 64 chars
      xmppRawPassword = crypto.randomBytes(32).toString('hex');

      // 4. AES-256-GCM encrypt the XMPP password for storage (EC-4)
      const { enc, iv, tag } = encrypt(xmppRawPassword);

      // 5. Build the XMPP JID (username must be lowercase, XMPP convention)
      const xmppJid = `${username.toLowerCase()}@${config.xmppDomain}`;

      // 6. Insert the user row
      const insertResult = await client.query(
        `INSERT INTO users
           (email, username, password_hash, xmpp_jid,
            xmpp_password_enc, xmpp_password_iv, xmpp_password_tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, username, email, xmpp_jid, role`,
        [
          email.toLowerCase(),
          username.toLowerCase(),
          passwordHash,
          xmppJid,
          enc,
          iv,
          tag,
        ]
      );
      const user = insertResult.rows[0];

      // 7. Provision the XMPP account on Prosody via mod_admin_rest
      //    If this fails, we ROLLBACK the PG insert so no orphaned DB rows.
      await xmpp.createUser(username.toLowerCase(), xmppRawPassword);

      // 7b. Auto-enroll new user into the 3 default public rooms.
      //     We look up room IDs by name so this works even if IDs change.
      //     Silently skips any room that doesn't exist yet (new deployments).
      const DEFAULT_ROOMS = ['general', 'random', 'announcements'];
      for (const roomName of DEFAULT_ROOMS) {
        const roomRow = await client.query(
          `SELECT id FROM rooms WHERE name = $1 AND is_private = false LIMIT 1`,
          [roomName]
        );
        if (roomRow.rows[0]) {
          await client.query(
            `INSERT INTO room_members (room_id, user_id, role)
             VALUES ($1, $2, 'member')
             ON CONFLICT (room_id, user_id) DO NOTHING`,
            [roomRow.rows[0].id, user.id]
          );
        }
      }

      // 8. Issue a JWT
      const jwt = fastify.jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        { expiresIn: config.jwtExpiresIn }
      );

      // 9. Record session in transaction
      const tokenHash = crypto.createHash('sha256').update(jwt).digest('hex');
      const userAgent = request.headers['user-agent'] || 'Unknown Browser';
      const ipAddress = request.ip || request.headers['x-forwarded-for'] || 'Unknown IP';
      await client.query(
        `INSERT INTO user_sessions (user_id, token_hash, user_agent, ip_address) VALUES ($1, $2, $3, $4)`,
        [user.id, tokenHash, userAgent, ipAddress]
      );

      // 10. Commit the transaction
      await client.query('COMMIT');

      // 10. Return JWT + XMPP credentials
      //     The raw XMPP password is returned here in-memory and over HTTPS only.
      //     It is never stored raw in the database.
      return reply.code(201).send({
        jwt,
        user: {
          id:       user.id,
          username: user.username,
          email:    user.email,
          friends_only_dms: false, // newly created users default to false
        },
        xmpp: {
          jid:      user.xmpp_jid,
          password: xmppRawPassword, // Raw — for client WebSocket auth only
          wsUrl:    `${config.appBaseUrl.replace(/^http/, 'ws')}/xmpp`,
        },
      });

    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err }, '[auth/register] Transaction failed');

      // Distinguish known errors from unexpected ones
      if (err.code === '23505') { // Postgres unique violation (race condition)
        return reply.code(409).send({ error: 'Conflict', message: 'Email or username already taken.' });
      }

      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Registration failed. Please try again.',
      });
    } finally {
      client.release();
      // Clear sensitive variable from memory
      xmppRawPassword = null;
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/login
  // ---------------------------------------------------------------------------
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body;

    // 1. Fetch the user row (includes encrypted XMPP password columns)
    const result = await query(
      `SELECT id, username, email, password_hash, xmpp_jid, role,
              is_globally_banned,
              xmpp_password_enc, xmpp_password_iv, xmpp_password_tag
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    const user = result.rows[0];

    // 2. Generic error for missing user — don't reveal whether email exists
    if (!user) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid email or password.' });
    }

    // 3. EC-2/EC-9: Reject globally banned users at login too
    if (user.is_globally_banned) {
      return reply.code(403).send({
        error: 'Account Suspended',
        message: 'Your account has been suspended. Contact an administrator.',
      });
    }

    // 4. Verify the web login password against the bcrypt hash
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid email or password.' });
    }

    // 5. AES-256-GCM decrypt the XMPP password (in-memory only)
    let xmppRawPassword;
    try {
      xmppRawPassword = decrypt(
        user.xmpp_password_enc,
        user.xmpp_password_iv,
        user.xmpp_password_tag
      );
    } catch (decryptErr) {
      request.log.error({ err: decryptErr, userId: user.id }, '[auth/login] XMPP password decryption failed');
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Authentication error.' });
    }

    // 6. Issue a JWT
    const jwt = fastify.jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      { expiresIn: config.jwtExpiresIn }
    );

    // 7. Track the session
    try {
      const tokenHash = crypto.createHash('sha256').update(jwt).digest('hex');
      const userAgent = request.headers['user-agent'] || 'Unknown Browser';
      const ipAddress = request.ip || request.headers['x-forwarded-for'] || 'Unknown IP';
      await query(
        `INSERT INTO user_sessions (user_id, token_hash, user_agent, ip_address) VALUES ($1, $2, $3, $4)`,
        [user.id, tokenHash, userAgent, ipAddress]
      );
    } catch (e) {
      request.log.warn({ err: e }, '[auth/login] Failed to create session record');
    }

    return reply.send({
      jwt,
      user: {
        id:       user.id,
        username: user.username,
        email:    user.email,
        role:     user.role,
        friends_only_dms: user.friends_only_dms,
      },
      xmpp: {
        jid:      user.xmpp_jid,
        password: xmppRawPassword, // Raw — for WebSocket SASL auth only
        wsUrl:    `${config.appBaseUrl.replace(/^http/, 'ws')}/xmpp`,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/forgot-password   (EC-1: Mock SMTP)
  // ---------------------------------------------------------------------------
  fastify.post('/forgot-password', {
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
    },
  }, async (request, reply) => {
    const { email } = request.body;

    // Look up the user (don't reveal whether email exists to the client)
    const result = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    const user   = result.rows[0];

    // Always return 200 to prevent email enumeration
    if (!user) {
      return reply.send({
        message: 'If this email is registered, a reset link has been sent.',
      });
    }

    // Generate a cryptographically secure reset token
    const rawToken   = crypto.randomBytes(32).toString('hex');
    // Store a SHA-256 hash of the token — never the raw token
    const tokenHash  = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Invalidate any previous unused tokens for this user
    await query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1',
      [user.id]
    );

    // Store the hashed token with a 1-hour TTL
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.id, tokenHash]
    );

    // EC-1: Mock SMTP — log the reset link to console instead of sending email.
    // To add real email: replace the console.log below with a mailer call.
    const resetLink = `${config.appBaseUrl}/reset-password?token=${rawToken}`;
    console.log('');
    console.log('='.repeat(70));
    console.log('  [EC-1 MOCK SMTP] Password Reset Link (not emailed):');
    console.log(`  TO: ${email}`);
    console.log(`  LINK: ${resetLink}`);
    console.log(`  EXPIRES: in 1 hour`);
    console.log('='.repeat(70));
    console.log('');

    return reply.send({
      message: 'If this email is registered, a reset link has been sent.',
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/auth/me   (protected)
  // ---------------------------------------------------------------------------
  fastify.get('/me', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id, username, email, xmppJid, role } = request.user;
    return reply.send({ id, username, email, xmppJid, role });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/auth/password — Change password for logged-in user (req 2.1.4b)
  // ---------------------------------------------------------------------------
  fastify.put('/password', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1 },
          newPassword:     { type: 'string', minLength: 8, maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body;
    const userId = request.user.id;

    const result = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    if (!user) return reply.code(404).send({ error: 'Not Found' });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return reply.code(401).send({ error: 'Unauthorized', message: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, userId]);

    return reply.send({ message: 'Password updated successfully.' });
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/reset-password — Consume reset token + set new password (req 2.1.4a)
  // ---------------------------------------------------------------------------
  fastify.post('/reset-password', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'newPassword'],
        properties: {
          token:       { type: 'string', minLength: 10 },
          newPassword: { type: 'string', minLength: 8, maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const { token, newPassword } = request.body;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = await query(
      `SELECT rt.user_id FROM password_reset_tokens rt
       WHERE rt.token_hash = $1 AND rt.expires_at > NOW()`,
      [tokenHash]
    );
    if (!result.rows[0]) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Reset link is invalid or has expired.' });
    }
    const userId = result.rows[0].user_id;

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, userId]);
    await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);

    return reply.send({ message: 'Password has been reset. Please sign in with your new password.' });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/auth/account — Delete own account (req 2.1.5)
  // ---------------------------------------------------------------------------
  fastify.delete('/account', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.user.id;
    const { password } = request.body;

    const result = await query('SELECT password_hash, username FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    if (!user) return reply.code(404).send({ error: 'Not Found' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return reply.code(401).send({ error: 'Unauthorized', message: 'Password is incorrect.' });

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Delete rooms owned by this user (cascade removes members + files entries)
      await client.query('DELETE FROM rooms WHERE owner_id = $1', [userId]);

      // Remove from all other room memberships
      await client.query('DELETE FROM room_members WHERE user_id = $1', [userId]);

      // Delete the user (cascades friendships, blocks, sessions)
      await client.query('DELETE FROM users WHERE id = $1', [userId]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Remove from XMPP
    try {
      await xmpp.deleteUser(user.username.toLowerCase());
    } catch (xmppErr) {
      request.log.warn({ err: xmppErr }, '[auth/account] XMPP delete failed (non-fatal)');
    }

    return reply.send({ message: 'Account deleted successfully.' });
  });

  // ---------------------------------------------------------------------------
  // GET /api/auth/sessions — List active sessions (req 2.2.4)
  // ---------------------------------------------------------------------------
  fastify.get('/sessions', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const result = await query(
      `SELECT id, user_agent, ip_address, created_at, last_seen_at
       FROM user_sessions
       WHERE user_id = $1 AND is_revoked = false
       ORDER BY last_seen_at DESC
       LIMIT 20`,
      [request.user.id]
    );
    return reply.send({ sessions: result.rows });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/auth/sessions/:sessionId — Revoke a session (req 2.2.4)
  // ---------------------------------------------------------------------------
  fastify.delete('/sessions/:sessionId', {
    preHandler: [authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['sessionId'],
        properties: { sessionId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { sessionId } = request.params;

    const result = await query(
      `UPDATE user_sessions SET is_revoked = true
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [sessionId, request.user.id]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Not Found', message: 'Session not found.' });
    }

    return reply.send({ message: 'Session revoked.' });
  });

};

