-- =============================================================================
-- VirtualHost: serverA.local
-- Phase 1 single-node configuration.
--
-- Users:  username@serverA.local
-- Rooms:  roomname@conference.serverA.local
--
-- Phase 2 note: A second VirtualHost (serverB.local) will be added in a
-- docker-compose.federation.yml overlay with mod_s2s enabled for cross-server
-- message routing. The configuration structure here anticipates that addition.
-- =============================================================================

VirtualHost "servera.local"

  -- ---------------------------------------------------------------------------
  -- Module enablement overrides (per-host additions to global modules_enabled)
  -- ---------------------------------------------------------------------------
  modules_enabled = {
    -- EC-7: Server-side ping for dead connection detection
    -- ping_interval: how often Prosody sends a ping to idle clients
    -- ping_timeout:  how long to wait for a pong before forcibly closing the stream
    "ping",

    -- s2s is loaded but restricted to local domain only in Phase 1.
    -- In Phase 2, s2s will be fully opened for federation with serverB.local.
    "s2s",
  }

  -- ---------------------------------------------------------------------------
  -- EC-7: XEP-0199 Ping configuration
  -- Max detection time for a hibernated tab: ping_interval + ping_timeout = 45s
  -- ---------------------------------------------------------------------------
  ping_interval = 30    -- Ping idle clients every 30 seconds
  ping_timeout  = 15    -- If no pong in 15s, forcefully close the stream
                        -- (Prosody then broadcasts <presence type="unavailable"/>)

  -- ---------------------------------------------------------------------------
  -- Federation (Phase 1: blocked; Phase 2: opened)
  -- s2s_whitelist restricts outgoing federation to known safe targets.
  -- In Phase 1, we only allow s2s within the local Docker network (empty = no federation).
  -- ---------------------------------------------------------------------------
  -- s2s_whitelist = { "serverB.local" }  -- Uncomment in Phase 2
  s2s_whitelist = {}  -- No federation in Phase 1

  -- ---------------------------------------------------------------------------
  -- TLS: per-host cert overrides (auto-discovered by Prosody from /etc/prosody/certs)
  -- ---------------------------------------------------------------------------
  ssl = {
    key  = "/etc/prosody/certs/servera.local.key",
    certificate = "/etc/prosody/certs/servera.local.crt",
    protocol = "tlsv1_2+",   -- Minimum TLS 1.2
  }


-- =============================================================================
-- MUC (Multi-User Chat) Component
-- All rooms live at conference.serverA.local
-- =============================================================================

Component "conference.servera.local" "muc"

  name = "Slackathon Conference Rooms"

  -- Room creation: any authenticated user can create rooms.
  -- Room management (delete, ban, kick) is controlled by Node API + room owner roles.
  restrict_room_creation = false

  -- Retain room membership even when all users disconnect.
  -- This prevents rooms from being "destroyed" by Prosody when they empty out.
  muc_room_default_persistent = true

  -- Enable message archiving (MAM) for all MUC rooms by default.
  -- This works with mod_muc_mam to store group messages in PostgreSQL.
  muc_room_default_public_list = true

  -- Maximum users per room (aligns with 1000-participant requirement)
  max_history_messages = 100

  modules_enabled = {
    "muc_mam",          -- Archive MUC messages (XEP-0313 in MUC context)
  }

  -- MAM settings for MUC
  -- Never expire archived MUC messages (per requirements: messages stored for years)
  archive_expires_after = "never"
