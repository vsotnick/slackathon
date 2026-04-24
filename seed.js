#!/usr/bin/env node
/**
 * seed.js — Demo data seed for Slackathon presentation
 *
 * Modified to support 10000+ messages in a single chat loaded up to the present day,
 * plus 20+ direct message conversations with 'vsot', including long conversations and attachments.
 */

'use strict';

const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Read DB password from .env so the seed script always matches the running DB.
// Falls back to the .env.example default if .env doesn't exist yet.
// ---------------------------------------------------------------------------
function loadEnvPassword() {
  const envPath = path.join(__dirname, '.env');
  const examplePath = path.join(__dirname, '.env.example');
  const file = fs.existsSync(envPath) ? envPath : examplePath;
  const content = fs.readFileSync(file, 'utf8');
  const match = content.match(/^POSTGRES_PASSWORD=(.+)$/m);
  return match ? match[1].trim() : 'slackathon_local_dev_2024';
}

const DB = {
  host: 'localhost',
  port: 5432,
  user: 'slackathon',
  password: loadEnvPassword(),
  database: 'slackathon',
};

// ── vsot users ─────────────────────────────────────────────────────────────
const VSOT_USERS = [
  { username: 'vsot',   id: '56ee52b3-9b1d-4821-9b90-246e633fdfb5', jid: 'vsot@servera.local' },
  { username: 'vsot1',  id: '96669973-db16-489a-ad8f-512db0e919bc', jid: 'vsot1@servera.local' },
  { username: 'vsot2',  id: '9511353d-1eb9-46b6-8b39-8d5454d63e7f', jid: 'vsot2@servera.local' },
  { username: 'vsot4',  id: '86aa9d0d-2fc7-47fc-abdf-1d0da1a1fcdc', jid: 'vsot4@servera.local' },
  { username: 'vsot5',  id: '0bb3e2cd-4e4c-45dd-b92e-9d02dacde50c', jid: 'vsot5@servera.local' },
  { username: 'vsot6',  id: '1fa0985a-37e5-4fec-a34c-50ef951bb102', jid: 'vsot6@servera.local' },
  { username: 'vsot7',  id: '98eb0e62-bc3b-41d0-806f-a054def06bce', jid: 'vsot7@servera.local' },
  { username: 'vsot9',  id: '9fd33492-85a0-46c4-bca2-f756408e7fe2', jid: 'vsot9@servera.local' },
  { username: 'vsot10', id: 'f44345c0-7657-4bb5-a7b6-4dcbd27af1b0', jid: 'vsot10@servera.local' },
  { username: 'vsot11', id: '43a0cf08-a649-46a5-8b35-efce9b0fa34d', jid: 'vsot11@servera.local' },
];

// Add 15 more users to get over 20 unique DMs for vsot
for (let i = 12; i <= 26; i++) {
  VSOT_USERS.push({
    username: `vsot${i}`,
    id: uid(),
    jid: `vsot${i}@servera.local`,
    _isNew: true
  });
}

// ── Rooms to create ──────────────────────────────────────────────────────────
const ROOMS = [
  { name: 'general',       description: 'Company-wide announcements and discussions',     private: false, owner: 'vsot'  },
  { name: 'engineering',   description: 'Engineering team — code, PRs and architecture', private: false, owner: 'vsot1' },
  { name: 'design',        description: 'UI/UX, brand assets and design reviews',         private: false, owner: 'vsot2' },
  { name: 'random',        description: 'Off-topic: memes, fun stuff and water-cooler',   private: false, owner: 'vsot4' },
  { name: 'announcements', description: 'Official announcements — read only',             private: false, owner: 'vsot'  },
  { name: 'devops',        description: 'Infrastructure, CI/CD and deployments',          private: false, owner: 'vsot5' },
];

// ── Realistic chat messages by persona ───────────────────────────────────────
const MESSAGES = {
  general: [
    "Good morning everyone! 👋",
    "Don't forget the all-hands meeting at 3pm today",
    "Welcome to the team, @vsot4! Great to have you here 🎉",
    "Reminder: Q2 reviews are due Friday",
    "Anyone know the WiFi password for Meeting Room B?",
    "The new office coffee machine is finally here ☕",
    "Happy Friday team! Great work this week 🚀",
    "IT notice: VPN will be down for maintenance tonight 11pm–1am",
    "Shoutout to @vsot9 for the amazing client presentation yesterday! 🏆",
    "Company picnic is Saturday — who's bringing the BBQ?",
    "New parking permits available from reception",
    "Monthly newsletter is out — check your inbox!",
    "Team lunch on Thursday — vote for restaurant in the poll",
    "Congrats to @vsot11 on the promotion! Well deserved 🎊",
    "Server maintenance window: Sunday 2–4am",
    "Updated expense policy — please read before submitting receipts",
    "Building access cards will be renewed next Monday",
    "Great quarter everyone! Sales targets smashed 💪",
    "Anyone left their keys in the kitchen?",
    "Reminder: Code freeze starts next Wednesday",
  ],
  engineering: [
    "PR #847 is ready for review — refactoring the auth module",
    "@vsot1 can you take a look at the memory leak in the worker service?",
    "Staging is down again — deploying a hotfix now",
    "Who broke the CI pipeline? 😤",
    "Fixed it — was a missing env variable in the Docker compose",
    "TypeScript 5.4 has some fantastic new features, worth upgrading",
    "The monorepo migration is done! Clean builds across all packages",
    "Performance review: 99.97% uptime this month 📊",
  ],
};

const DM_POOLS = {
  vsot1: [ // Huge conversation
    "Hey vsot, got a minute?",
    "Yeah sure, what's up?",
    "I'm looking at the backend performance metrics from last night.",
    "Did the refactor help?",
    "It dropped API latency by 45% on the heavy endpoints.",
    "That's massive! Great job.",
    "Still seeing some CPU spikes around 2am though.",
    "Probably the daily backup cron job hitting the DB too hard.",
    "I'll throttle it and see.",
    "Let me know if you need any help looking at the traces.",
  ],
  vsot2: [ // Attachments
    "Hey, I finished the new mockups for the dashboard.",
    "Awesome, can I see them?",
    "JSON_ATTACHMENT_MOCK", // Will be replaced by actual attachment payload
    "Looks incredibly clean! Love the new dark mode palette.",
    "Thanks! Should I send it to dev handoff?",
    "Yes, let's do it.",
  ],
  generic: [
    "Hey there",
    "Hi, how are you?",
    "Could you review my PR when you have a moment?",
    "Will do, I'll take a look after lunch.",
    "Thanks!",
    "Any updates on the client meeting?",
    "It got rescheduled to tomorrow unfortunately.",
    "Ah okay, no worries.",
  ],
};


// ── Utility ───────────────────────────────────────────────────────────────────
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function uid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function archiveKey(ts) {
  const hi = Math.floor(ts / 1000).toString(16).padStart(8, '0');
  const rnd = Math.random().toString(16).slice(2, 14).padStart(12, '0');
  return `${hi}-${rnd.slice(0,4)}-7${rnd.slice(4,7)}-${(parseInt(rnd[7],16) & 0x3 | 0x8).toString(16)}${rnd.slice(8,11)}-${rnd.slice(11)}`;
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
    return c;
  });
}

function makeXmppMessage(roomName, senderUsername, body) {
  const msgId = uid();
  const from = `${roomName}@conference.servera.local/${senderUsername}`;
  const to = `${roomName}@conference.servera.local`;
  return `<message id='${msgId}' from='${from}' xml:lang='en' to='${to}' type='groupchat'><body>${escapeXml(body)}</body><occupant-id xmlns='urn:xmpp:occupant-id:0' id='demo'/></message>`;
}

function makeXmppDm(senderJid, receiverJid, body, isAttachment = false) {
  const msgId = uid();
  if (isAttachment) {
    const payload = JSON.stringify({
      type: "attachment",
      caption: "Dashboard Mockups.pdf",
      url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      fileType: "application/pdf"
    });
    return `<message id='${msgId}' from='${senderJid}' to='${receiverJid}' type='chat'><body>${escapeXml(payload)}</body><ephemeral xmlns='urn:slackathon:ephemeral'/></message>`;
  }
  return `<message id='${msgId}' from='${senderJid}' to='${receiverJid}' type='chat'><body>${escapeXml(body)}</body></message>`;
}


// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const client = new Client(DB);
  await client.connect();
  console.log('✓ Connected to PostgreSQL');

  // Clean up all related tables first to avoid FK constraint errors!
  await client.query('DELETE FROM room_members');
  await client.query('DELETE FROM rooms');
  await client.query('DELETE FROM prosodyarchive');
  await client.query('DELETE FROM friendships');
  await client.query('DELETE FROM user_sessions');
  console.log('  Cleared all dependent tables');

  const vsotIds = VSOT_USERS.map(u => u.id);
  const vsotIdList = vsotIds.map((_, i) => `$${i + 1}`).join(',');

  // Then delete non-vsot users
  const deleted = await client.query(
    `DELETE FROM users WHERE id NOT IN (${vsotIdList})`,
    vsotIds
  );
  console.log(`  Deleted ${deleted.rowCount} non-vsot users`);

  console.log('\n── NEW USERS ─────────────────────────────────────────────────');
  const bcrypt = require('bcrypt');
  // Hash "password" with bcrypt so seeded users can log in
  const passwordHash = await bcrypt.hash('password', 10);

  // ── Register the primary vsot user through the API ──────────────────────
  // This ensures vsot gets real XMPP credentials (encrypted password, Prosody account).
  // Other seeded users are DB-only (for message history) and can be registered via the UI.
  const API_BASE = process.env.APP_BASE_URL || 'http://localhost';
  console.log(`  Registering vsot via API at ${API_BASE}...`);

  // Delete vsot first if it exists (so we can re-register cleanly)
  await client.query('DELETE FROM room_members WHERE user_id = (SELECT id FROM users WHERE username=$1)', ['vsot']);
  await client.query('DELETE FROM friendships WHERE requester_id = (SELECT id FROM users WHERE username=$1) OR addressee_id = (SELECT id FROM users WHERE username=$1)', ['vsot']);
  await client.query('DELETE FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE username=$1)', ['vsot']);
  await client.query('DELETE FROM users WHERE username=$1', ['vsot']);

  let vsotRegistered = false;
  try {
    const regRes = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'vsot', email: 'vsot@test.com', password: 'password' }),
    });
    if (regRes.ok) {
      const regData = await regRes.json();
      console.log(`  ✓ vsot registered via API (id: ${regData.user.id})`);
      // Update the in-memory ID to match what the API assigned
      VSOT_USERS[0].id = regData.user.id;
      vsotRegistered = true;
    } else {
      const errData = await regRes.json().catch(() => ({}));
      console.warn(`  ⚠ API registration failed (${regRes.status}): ${errData.message || 'unknown'}`);
      console.warn('    Falling back to direct DB insert (login may not work for vsot)');
    }
  } catch (err) {
    console.warn(`  ⚠ Could not reach API at ${API_BASE}: ${err.message}`);
    console.warn('    Falling back to direct DB insert (login may not work for vsot)');
  }

  // Insert all users into the DB (vsot may already exist from API registration)
  for (const u of VSOT_USERS) {
    if (u.username === 'vsot' && vsotRegistered) continue; // Already registered via API
    const email = u.username === 'vsot' ? 'vsot@test.com' : `${u.username}@example.com`;
    await client.query(`
      INSERT INTO users (id, username, email, xmpp_jid, password_hash, xmpp_password_enc, xmpp_password_iv, xmpp_password_tag, role)
      VALUES ($1, $2, $3, $4, $5, '\\x00', '\\x00', '\\x00', 'user')
      ON CONFLICT (username) DO UPDATE SET id = EXCLUDED.id, email = EXCLUDED.email
    `, [u.id, u.username, email, u.jid, passwordHash]);
    console.log(`  ✓ Upserted user: ${u.username} (${email})`);
  }



  console.log('\n── CREATE ROOMS & MEMBERS ───────────────────────────────────');
  const roomMap = {};
  for (const r of ROOMS) {
    const owner = VSOT_USERS.find(u => u.username === r.owner);
    const roomId = uid();
    const jid = `${r.name}@conference.servera.local`;
    await client.query(`INSERT INTO rooms (id, name, jid, description, is_private, owner_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`, [roomId, r.name, jid, r.description, r.private, owner.id]);
    roomMap[r.name] = { id: roomId, jid };
    
    // Add all 25+ users to public rooms
    for (const u of VSOT_USERS) {
      await client.query(`INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [roomId, u.id]);
    }
  }

  const NOW   = Math.floor(Date.now() / 1000);
  const DAY   = 86400;
  const START = NOW - 90 * DAY;

  console.log('\n── SEED ROOM MESSAGES ───────────────────────────────────────');
  const MSG_TARGETS = {
    general:       10000,
    engineering:   800,
  };

  for (const [roomName, target] of Object.entries(MSG_TARGETS)) {
    const room = roomMap[roomName];
    if (!room) continue;

    const pool = MESSAGES[roomName] || MESSAGES.general;
    let inserted = 0;
    const BATCH_SIZE = 200;

    for (let batchStart = 0; batchStart < target; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, target);
      const params = [];
      const rows = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const progress = i / target; 
        const dayOffset = Math.floor(progress * 90.99); // Ensures it reaches close to 90
        const secondInDay = 8 * 3600 + Math.floor(Math.random() * 9 * 3600);
        const ts = START + dayOffset * DAY + secondInDay + Math.floor(Math.random() * 300);

        const sender = VSOT_USERS[i % VSOT_USERS.length];
        let body = pool[i % pool.length];

        if (target >= 1000 && i % 7 === 0) body = body + ' 👍';

        const key = archiveKey(ts * 1000 + i);
        const value = makeXmppMessage(roomName, sender.username, body);

        const base = params.length;
        params.push(key, value);
        rows.push(`('conference.servera.local', '${roomName}', 'muc_log', $${base+1}, ${ts}, 'message<groupchat', 'xml', $${base+2})`);
      }

      await client.query(`INSERT INTO prosodyarchive (host, "user", store, key, "when", "with", type, value) VALUES ${rows.join(',')} ON CONFLICT DO NOTHING`, params);
      inserted += (batchEnd - batchStart);
    }
    await client.query(`UPDATE rooms SET watermark_seq = $1 WHERE id = $2`, [target, room.id]);
    console.log(`  ✓ #${roomName}: ${target} messages inserted (latest is today) and watermark_seq adjusted`);
  }

  console.log('\n── SEED DIRECT MESSAGES ─────────────────────────────────────');
  const vsot = VSOT_USERS.find(u => u.username === 'vsot');

  // Insert DM batch generic
  for (const other of VSOT_USERS) {
    if (other.username === 'vsot') continue;
    
    // Determine pool
    let pool = DM_POOLS.generic;
    let target = 50; 
    
    if (other.username === 'vsot1') { pool = DM_POOLS.vsot1; target = 2500; } // Huge conversation
    if (other.username === 'vsot2') { pool = DM_POOLS.vsot2; target = 100; }  // Attachment

    let currentRows = [];
    let currentParams = [];
    
    for (let i = 0; i < target; i++) {
      const isMine = i % 2 === 0;
      const sender = isMine ? vsot : other;
      const receiver = isMine ? other : vsot;
      
      const progress = i / target;
      const dayOffset = Math.floor(progress * 40.99);
      const ts = (NOW - 40 * DAY) + dayOffset * DAY + Math.floor(Math.random() * 3600);
      
      let body = pool[i % pool.length];
      let isAttachment = body === "JSON_ATTACHMENT_MOCK";

      // Insert for 'sender' archive view
      const k1 = archiveKey(ts * 1000 + i * 2);
      const v1 = makeXmppDm(sender.jid, receiver.jid, body, isAttachment);
      let base = currentParams.length;
      currentParams.push(k1, v1);
      currentRows.push(`('servera.local', '${sender.username}', 'archive', $${base+1}, ${ts}, '${receiver.jid}', 'chat', $${base+2})`);

      // Insert for 'receiver' archive view
      const k2 = archiveKey(ts * 1000 + i * 2 + 1);
      base = currentParams.length;
      currentParams.push(k2, v1);
      currentRows.push(`('servera.local', '${receiver.username}', 'archive', $${base+1}, ${ts}, '${sender.jid}', 'chat', $${base+2})`);
      
      // Execute chunk if large enough
      if (currentRows.length >= 1000 || i === target - 1) {
         await client.query(`INSERT INTO prosodyarchive (host, "user", store, key, "when", "with", type, value) VALUES ${currentRows.join(',')} ON CONFLICT DO NOTHING`, currentParams);
         currentRows = [];
         currentParams = [];
      }
    }
    
    console.log(`  ✓ vsot ↔ ${other.username}: ${target} direct messages seeded`);
  }

  // ── 5. FRIENDSHIPS ──────────────────────────────────────────────────────────
  for (const other of VSOT_USERS.filter(u => u.username !== 'vsot')) {
    await client.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted') ON CONFLICT DO NOTHING`, [vsot.id, other.id]);
  }
  
  const actualDm = await client.query(`SELECT COUNT(DISTINCT "with") FROM prosodyarchive WHERE "user" = 'vsot' AND store = 'archive'`);
  console.log(`\n✅ Seed complete! vsot has DMs with ${actualDm.rows[0].count} distinct users.`);

  await client.end();
}

main().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
