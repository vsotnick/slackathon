'use strict';
/**
 * config.js — Environment variable loader and validator.
 *
 * All environment variables are loaded here and exported as a single frozen
 * config object. The application will fail fast at startup if any required
 * variable is missing, preventing cryptic errors later.
 *
 * Required variables (must be set in .env or Docker Compose environment):
 *   DATABASE_URL       — PostgreSQL connection string
 *   JWT_SECRET         — Secret for signing JWTs (min 32 chars recommended 64+)
 *   AES_SECRET_KEY     — 64 hex chars (32 bytes) for AES-256-GCM xmpp pw encryption
 *   PROSODY_ADMIN_URL  — Internal URL of Prosody's mod_admin_rest endpoint
 *   XMPP_DOMAIN        — The Prosody VirtualHost domain (e.g. serverA.local)
 */

require('dotenv').config();

function require_env(name) {
  const value = process.env[name];
  if (!value) {
    // Hard crash on startup — better than a runtime failure mid-request
    throw new Error(`[config] Missing required environment variable: ${name}`);
  }
  return value;
}

// Validate AES key is exactly 64 hex characters (32 bytes)
function validate_aes_key(key) {
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      '[config] AES_SECRET_KEY must be exactly 64 hex characters (32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return key;
}

const config = Object.freeze({
  // Server
  port:             parseInt(process.env.API_PORT || '3001', 10),
  nodeEnv:          process.env.NODE_ENV || 'development',
  isDev:            (process.env.NODE_ENV || 'development') === 'development',

  // Database
  databaseUrl:      require_env('DATABASE_URL'),

  // Auth
  jwtSecret:        require_env('JWT_SECRET'),
  jwtExpiresIn:     process.env.JWT_EXPIRES_IN || '7d',

  // AES-256-GCM for XMPP password encryption at rest (EC-4)
  aesSecretKey:     validate_aes_key(require_env('AES_SECRET_KEY')),

  // Prosody XMPP server
  prosodyAdminUrl:  require_env('PROSODY_ADMIN_URL'),
  prosodyAdminUser: process.env.PROSODY_ADMIN_USER || 'admin',
  prosodyAdminPass: require_env('PROSODY_ADMIN_PASSWORD'),
  xmppDomain:       require_env('XMPP_DOMAIN'),
  xmppMucDomain:    process.env.XMPP_MUC_DOMAIN || `conference.${require_env('XMPP_DOMAIN')}`,

  // App
  appBaseUrl:       process.env.APP_BASE_URL || 'http://localhost',

  // File uploads
  maxFileBytes:     20 * 1024 * 1024,  // 20 MB
  maxImageBytes:    3 * 1024 * 1024,    // 3 MB
  uploadsDir:       process.env.UPLOADS_DIR || '/app/uploads',
});

module.exports = config;
