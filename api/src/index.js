'use strict';
/**
 * src/index.js — Fastify application entry point.
 *
 * Startup sequence:
 *   1. Load config (fails fast on missing env vars)
 *   2. Wait for PostgreSQL to be ready (exponential backoff)
 *   3. Run database migrations (idempotent)
 *   4. Register Fastify plugins (JWT, CORS, multipart)
 *   5. Register routes under /api prefix
 *   6. Start listening on configured port
 *   7. Register graceful shutdown handler (SIGTERM for Docker)
 */

const Fastify    = require('fastify');
const config     = require('./config');
const { waitForDatabase } = require('./db/pool');
const { runMigrations }   = require('./db/migrate');

// ---------------------------------------------------------------------------
// Create Fastify instance
// ---------------------------------------------------------------------------
const app = Fastify({
  // Use pino for structured JSON logging — plays nicely with Docker log drivers
  logger: {
    level: config.isDev ? 'info' : 'warn',
    transport: config.isDev
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
  // Fastify will reject requests with unexpected body properties (strict schema)
  ajv: {
    customOptions: {
      strict: false, // Allow additional props in query/body that aren't in schema
      coerceTypes: true,
    },
  },
});

// ---------------------------------------------------------------------------
// Plugin registrations
// ---------------------------------------------------------------------------
async function registerPlugins() {
  // CORS — required for browser clients on different origins during development
  await app.register(require('@fastify/cors'), {
    origin: config.isDev ? true : process.env.ALLOWED_ORIGIN || false,
    credentials: true,
  });

  // JWT — used by authenticate middleware
  await app.register(require('@fastify/jwt'), {
    secret: config.jwtSecret,
  });

  // Multipart — for file upload routes (Phase 1: stubbed, Phase 2: active)
  await app.register(require('@fastify/multipart'), {
    limits: {
      fieldNameSize: 100,
      fieldSize:     100,
      fileSize:      config.maxFileBytes, // 20MB
    },
  });
}

// ---------------------------------------------------------------------------
// Route registrations
// ---------------------------------------------------------------------------
async function registerRoutes() {
  // Health check — unauthenticated, used by Docker health check and Nginx
  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Auth routes: /api/auth/register, /api/auth/login, /api/auth/me, etc.
  await app.register(require('./routes/auth'),  { prefix: '/api/auth' });

  // Room routes: /api/rooms, /api/rooms/:id/messages, etc.
  await app.register(require('./routes/rooms'), { prefix: '/api/rooms' });

  // User directory: /api/users (Phase 2.6 — DM sidebar + presence)
  await app.register(require('./routes/users'), { prefix: '/api/users' });

  // Admin routes: /api/admin/users, /api/admin/xmpp/status, etc.
  await app.register(require('./routes/admin'), { prefix: '/api/admin' });

  // File uploads
  await app.register(require('./routes/files'), { prefix: '/api/files' });

  // Friends and blocks
  await app.register(require('./routes/friends'), { prefix: '/api/friends' });

  // Global search
  await app.register(require('./routes/search'), { prefix: '/api/search' });

  // AI assistant (mock for demo; swap handlers for real Ollama post-presentation)
  await app.register(require('./routes/ai'), { prefix: '/api/ai' });

  // Global 404 handler
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: 'Not Found', message: `Route ${request.method} ${request.url} not found.` });
  });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, url: request.url }, 'Unhandled error');

    // Fastify validation errors
    if (error.validation) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: error.message,
        details: error.validation,
      });
    }

    reply.code(error.statusCode || 500).send({
      error: error.message || 'Internal Server Error',
    });
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown (SIGTERM — sent by Docker on `docker compose down`)
// ---------------------------------------------------------------------------
function registerShutdownHandlers() {
  const shutdown = async (signal) => {
    app.log.info(`[shutdown] Received ${signal}. Shutting down gracefully…`);
    try {
      await app.close();
      app.log.info('[shutdown] Server closed. Goodbye.');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, '[shutdown] Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

// ---------------------------------------------------------------------------
// Main startup sequence
// ---------------------------------------------------------------------------
async function start() {
  try {
    // 1. Wait for PostgreSQL
    app.log.info('[startup] Waiting for PostgreSQL…');
    await waitForDatabase();

    // 2. Run migrations
    app.log.info('[startup] Running migrations…');
    await runMigrations();

    // 3. Register plugins
    await registerPlugins();

    // 4. Register routes
    await registerRoutes();

    // 5. Register shutdown handlers
    registerShutdownHandlers();

    // 6. Start listening
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`[startup] ✓ Slackathon API ready on port ${config.port}`);

  } catch (err) {
    app.log.error({ err }, '[startup] Fatal error — server did not start');
    process.exit(1);
  }
}

start();
