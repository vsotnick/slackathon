# =============================================================================
# Prosody XMPP Server Dockerfile
#
# Base: prosodyim/prosody:13.0 — the official, actively-maintained image.
# The old `prosody/prosody` namespace on Docker Hub is UNMAINTAINED — do not use it.
#
# Community modules installed from hg.prosody.im/prosody-modules:
#   mod_admin_rest      — HTTP REST API for Node API user provisioning (dual auth)
#   mod_storage_sql     — PostgreSQL MAM storage backend
#   mod_mam             — Message Archive Management (XEP-0313)
#   mod_muc_mam         — MAM archiving inside MUC rooms
#   mod_message_retract — XEP-0424 retraction (ephemeral "Smoke & Mirrors" messages)
#   mod_vcard_legacy    — vCard backward compat (XEP-0054)
#
# Build time: ~90s first build (mercurial clone). Subsequent builds use layer cache.
# =============================================================================

FROM prosodyim/prosody:13.0

USER root

# Install build/runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    mercurial \
    openssl \
    lua-dbi-postgresql \
    lua-sec \
    wget \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Clone prosody-modules community repo and install required modules.
# Modules are copied into /usr/lib/prosody/modules/ where Prosody searches.
# We clone once and delete the full repo after copying to keep image lean.
# ---------------------------------------------------------------------------
RUN hg clone https://hg.prosody.im/prosody-modules/ /tmp/prosody-modules \
    && for mod in mod_storage_sql mod_mam mod_muc_mam mod_message_retract mod_vcard_legacy; do \
         if [ -d /tmp/prosody-modules/$mod ]; then \
           cp -r /tmp/prosody-modules/$mod /usr/lib/prosody/modules/; \
           echo "[install] OK: $mod"; \
         else \
           echo "[install] WARNING: $mod not found — skipping"; \
         fi; \
       done \
    && rm -rf /tmp/prosody-modules

# Copy our custom REST API module to replace the removed community module
COPY mod_slackathon_rest.lua /usr/lib/prosody/modules/mod_admin_rest.lua

# Ensure config and cert directories exist with correct ownership
RUN mkdir -p /etc/prosody/certs /etc/prosody/conf.d /var/lib/prosody \
    && chown -R prosody:prosody /etc/prosody /var/lib/prosody

# Copy Prosody configuration files
COPY prosody.cfg.lua       /etc/prosody/prosody.cfg.lua
COPY conf.d/               /etc/prosody/conf.d/

# Copy startup script (generates self-signed TLS certs + launches Prosody)
COPY docker-entrypoint.sh  /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Ports:
#   5222 — XMPP C2S (native Jabber clients e.g. Gajim)
#   5269 — XMPP S2S federation (Phase 2 ready, inactive in Phase 1)
#   5280 — BOSH / WebSocket (proxied by Nginx for browser clients)
EXPOSE 5222 5269 5280

USER prosody
ENTRYPOINT ["/docker-entrypoint.sh"]
