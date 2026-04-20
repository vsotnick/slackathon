# =============================================================================
# Node.js API Dockerfile
# Multi-stage build kept simple for Phase 1 (single stage, alpine base).
# =============================================================================

FROM node:20-alpine

# Install dumb-init for proper PID 1 signal handling in containers.
# Without this, SIGTERM from Docker is not forwarded to the Node process,
# causing unclean shutdowns and potential data corruption.
RUN apk add --no-cache dumb-init

# Create app directory inside the container
WORKDIR /app

# Copy package.json first to leverage Docker layer caching.
# npm install only re-runs when package.json changes, not on every code change.
COPY package.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy application source
COPY src/ ./src/

# Create uploads directory (Phase 1: local volume mount point)
RUN mkdir -p /app/uploads

# Run as non-root user for security
# node user (uid 1000) is pre-created in the node:alpine base image
RUN chown -R node:node /app
USER node

# Expose the API port
EXPOSE 3001

# Health check — Docker Compose uses this to determine service readiness.
# The /api/health endpoint responds immediately once the server is listening.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3001/api/health || exit 1

# Use dumb-init as PID 1 to ensure clean signal propagation
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
