'use strict';
/**
 * services/crypto.js — AES-256-GCM encryption helpers.
 *
 * Used to encrypt XMPP passwords at rest in PostgreSQL (enterprise constraint EC-4).
 * The XMPP password is machine-generated at registration, encrypted here,
 * and stored as three BYTEA columns: enc, iv, tag.
 * It is decrypted only in-memory at login time and returned to the client
 * over HTTPS — it is never stored raw in the database.
 *
 * Algorithm: AES-256-GCM
 *   - 256-bit key (from AES_SECRET_KEY env var = 32 bytes = 64 hex chars)
 *   - 12-byte random IV (GCM standard recommendation)
 *   - 16-byte authentication tag (GCM provides authenticated encryption)
 *
 * Node's native `crypto` module is used — no external dependencies.
 */

const crypto = require('crypto');
const config = require('../config');

// Convert the 64-char hex AES_SECRET_KEY to a 32-byte Buffer once at load time
const KEY = Buffer.from(config.aesSecretKey, 'hex');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV — NIST recommended for GCM

/**
 * encrypt — Encrypts a plaintext string using AES-256-GCM.
 *
 * @param {string} plaintext — The string to encrypt (e.g. an XMPP password)
 * @returns {{ enc: Buffer, iv: Buffer, tag: Buffer }}
 *   enc — Ciphertext bytes (same length as plaintext)
 *   iv  — 12-byte random initialization vector
 *   tag — 16-byte GCM authentication tag
 */
function encrypt(plaintext) {
  // Generate a fresh random IV for every encryption.
  // NEVER reuse an IV with the same key — GCM provides no security if IV is reused.
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  // Encrypt in one shot (XMPP passwords are short, no streaming needed)
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  // GCM authentication tag — must be extracted AFTER cipher.final()
  const tag = cipher.getAuthTag();

  return { enc, iv, tag };
}

/**
 * decrypt — Decrypts AES-256-GCM ciphertext back to a plaintext string.
 *
 * @param {Buffer} enc — Ciphertext (from encrypt())
 * @param {Buffer} iv  — Initialization vector (from encrypt())
 * @param {Buffer} tag — GCM auth tag (from encrypt())
 * @returns {string} Original plaintext string
 * @throws If the auth tag does not match (ciphertext was tampered with)
 */
function decrypt(enc, iv, tag) {
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);

  // Set the auth tag BEFORE calling update() — GCM validates on final()
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([
    decipher.update(enc),
    decipher.final(), // Throws if auth tag validation fails
  ]);

  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };
