#!/bin/sh
# =============================================================================
# Prosody Docker Entrypoint
#
# Runs as PID 1 inside the container (USER prosody at runtime, but this script
# is invoked as prosody because USER is set before ENTRYPOINT in the Dockerfile).
# The cert directory is pre-chowned to prosody in the Dockerfile, so we can
# write certs without needing root here.
#
# Steps:
#   1. Generate a self-signed TLS cert for the XMPP domain if not present
#   2. Start Prosody in the foreground (required for Docker PID 1 behaviour)
# =============================================================================

set -e

DOMAIN="${XMPP_DOMAIN:-serverA.local}"
MUC_DOMAIN="conference.${DOMAIN}"
CERT_DIR="/etc/prosody/certs"

echo "[entrypoint] Starting Prosody for domain: ${DOMAIN}"

# ---------------------------------------------------------------------------
# Generate self-signed TLS certificates if they don't already exist.
# These are used for c2s (client-to-server) and the MUC component.
# For Phase 2 (federation / s2s), real signed certs will be needed.
# ---------------------------------------------------------------------------
if [ ! -f "${CERT_DIR}/${DOMAIN}.crt" ] || [ ! -f "${CERT_DIR}/${DOMAIN}.key" ]; then
    echo "[entrypoint] Generating self-signed TLS cert for: ${DOMAIN}"
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "${CERT_DIR}/${DOMAIN}.key" \
        -out    "${CERT_DIR}/${DOMAIN}.crt" \
        -subj   "/CN=${DOMAIN}/O=Slackathon/C=US" \
        -addext "subjectAltName=DNS:${DOMAIN},DNS:${MUC_DOMAIN},DNS:localhost" \
        2>/dev/null
    echo "[entrypoint] ✓ TLS cert generated: ${DOMAIN}"
else
    echo "[entrypoint] ✓ TLS cert already exists: ${DOMAIN}"
fi

if [ ! -f "${CERT_DIR}/${MUC_DOMAIN}.crt" ] || [ ! -f "${CERT_DIR}/${MUC_DOMAIN}.key" ]; then
    echo "[entrypoint] Generating self-signed TLS cert for: ${MUC_DOMAIN}"
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "${CERT_DIR}/${MUC_DOMAIN}.key" \
        -out    "${CERT_DIR}/${MUC_DOMAIN}.crt" \
        -subj   "/CN=${MUC_DOMAIN}/O=Slackathon/C=US" \
        2>/dev/null
    echo "[entrypoint] ✓ TLS cert generated: ${MUC_DOMAIN}"
fi

# Set correct permissions on private keys
chmod 640 "${CERT_DIR}/"*.key 2>/dev/null || true

# ---------------------------------------------------------------------------
# Provision Admin User
# The REST API requires an authenticated admin user to perform operations.
# ---------------------------------------------------------------------------
echo "[entrypoint] Registering admin user: ${PROSODY_ADMIN_USER}@${DOMAIN}"
prosodyctl register "${PROSODY_ADMIN_USER}" "${DOMAIN}" "${PROSODY_ADMIN_PASSWORD}" || true

# ---------------------------------------------------------------------------
# Start Prosody in the foreground.
# `exec` replaces this shell process with prosody, making it PID 1.
# This ensures Docker's SIGTERM is received directly by Prosody.
# ---------------------------------------------------------------------------
echo "[entrypoint] Launching Prosody XMPP server..."
exec prosody
