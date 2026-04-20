-- =============================================================================
-- Migration 006: Seed Default Public Rooms + Backfill Existing Users
--
-- 1. Creates the 3 canonical public rooms (general, random, announcements)
--    if they don't already exist. Uses ON CONFLICT DO NOTHING — safe to
--    re-run on any DB state.
--
-- 2. Backfills all existing non-banned users into those 3 rooms so that
--    users created before this migration (and before Fix 4a in auth.js)
--    are not left with empty room lists.
--
-- MUC domain: conference.servera.local (matches XMPP_MUC_DOMAIN in .env)
-- =============================================================================

-- Step 1: Create the 3 default rooms
INSERT INTO rooms (name, jid, description, is_private, owner_id)
VALUES
  ('general',
   'general@conference.servera.local',
   'General company-wide discussion',
   false,
   NULL),
  ('random',
   'random@conference.servera.local',
   'Off-topic and fun stuff',
   false,
   NULL),
  ('announcements',
   'announcements@conference.servera.local',
   'Important company announcements',
   false,
   NULL)
ON CONFLICT (name) DO NOTHING;

-- Step 2: Backfill ALL existing non-banned users into every default public room.
-- The cross-join produces one row per (user, room) pair.
-- ON CONFLICT DO NOTHING means users already in room_members (e.g. the
-- creator added via POST /api/rooms) are safely skipped.
INSERT INTO room_members (room_id, user_id, role)
SELECT r.id, u.id, 'member'
FROM rooms r
CROSS JOIN users u
WHERE r.name IN ('general', 'random', 'announcements')
  AND u.is_globally_banned = false
ON CONFLICT (room_id, user_id) DO NOTHING;
