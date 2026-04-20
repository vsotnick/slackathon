# Slackathon

A high-concurrency, enterprise-grade web chat application with XMPP at the core. Slack/Telegram hybrid built on Prosody, Node.js, PostgreSQL, and React.

## 🚀 Step-by-Step Guide: Running the App Locally

Follow these instructions to go from an empty machine to a fully seeded, logged-in instance of the application.

### Prerequisites
- Node.js (v18+)
- Docker Desktop (or Docker Engine + Compose plugin)
- Git

### 1. Download the Repository

Clone or download the respiratory to your machine:
```bash
git clone <repository_url> slackathon
cd slackathon
```

### 2. Configure Environment

Create your local `.env` configuration file from the provided example:
```bash
cp .env.example .env
```
*(Optional) Open the `.env` file to customize random JWT keys and passwords, otherwise, defaults will work for testing.*

### 3. Boot the Backend & Database 

Power up the PostgreSQL database, Nginx proxy, XMPP server (Prosody), and the Node REST API securely via Docker Compose:
```bash
docker compose up -d
```
> **Note:** The first boot downloads several XMPP community modules which may take 1-2 minutes. All 4 containers should eventually say `healthy` when you run `docker compose ps`.

### 4. Seed the Database with Demodata

Once Docker is fully booted, populate the database with realistic rooms, active Direct Messages, and heavy message volumes (10k+ messages) directly by running the backend seeder script in the root folder:
```bash
node seed.js
```
*(Wait until it finishes outputting `Seed complete!`)*

After seeding, gently restart the `api` container so it syncs up cleanly with the fresh massive DB metrics:
```bash
docker compose restart api
```

### 5. Sign In to the App

Your complete application stack (including the frontend client) is now running securely inside Docker! Nginx automatically handles proxying everything on native port 80.

1. Open your browser and navigate permanently to [http://localhost](http://localhost).
2. The seed script generated a fully loaded test account for you completely filled with historical records. Log in natively using:
   - **Email:** `vsot@test.com`
   - **Password:** `password`
3. Hit exactly `Sign In` and experience your Paginated React + XMPP Enterprise chat platform!

## Smoke Tests

### Register a User
```bash
curl -s -X POST http://localhost/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","username":"alice","password":"Test1234!"}' \
  | jq .
```

Expected: `201` with `jwt`, `user`, and `xmpp` credentials.

### Login
```bash
curl -s -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"Test1234!"}' \
  | jq .
```

Expected: `200` with `jwt` and `xmpp.password` (decrypted from AES-256-GCM).

### XMPP Admin Status
```bash
curl -s http://localhost/api/admin/xmpp/status
```

### Password Reset (Mock SMTP — EC-1)
```bash
curl -s -X POST http://localhost/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com"}'
```
Check API container logs for the reset link:
```bash
docker compose logs api | grep "MOCK SMTP"
```

### Connect Native Jabber Client
Configure Gajim or Pidgin to connect to `localhost:5222` with:
- JID: `alice@serverA.local`
- Password: the `xmpp.password` from the login response

## Architecture

```
[Browser] ──→ [Nginx :80]
                   ├── /xmpp  ──→ [Prosody :5280] (WebSocket, real-time)
                   ├── /api   ──→ [Node API :3001] (REST, history, uploads)
                   └── /      ──→ [React :3000]   (frontend)

[Node API] ──→ [Prosody :5280/admin_rest] (user provisioning)
[Prosody]  ──→ [PostgreSQL :5432]          (MAM message archive)
[Node API] ──→ [PostgreSQL :5432]          (users, rooms, files)
```

## Enterprise Constraints (Implemented)

| # | Constraint | Implementation |
|---|---|---|
| EC-1 | Mock SMTP | Password reset token logged to console |
| EC-2 | Immediate Eviction | DB ban + Prosody `kickAllSessions` via admin_rest |
| EC-3 | No Queues | `mod_offline` disabled; MAM timestamp-pull on reconnect |
| EC-4 | Watermarks | `rooms.watermark_seq` BIGINT + stanza `<watermark seq="N"/>` |
| EC-5 | Hybrid Protocol | WS=real-time, REST=history/uploads/settings |
| EC-6 | Presence Debounce | State-change-only signals (React frontend) |
| EC-7 | Dead Connections | XEP-0199 ping: 30s interval, 15s timeout |
| EC-8 | Deep Pagination | Keyset (`before_watermark`) + composite PG index |
| EC-9 | Moderation | Kick=room-scoped reversible; Ban=global account suspension |

## Project Structure

```
slackathon/
├── docker-compose.yml          ← Run everything with this
├── .env.example                ← Copy to .env and configure
├── nginx/                      ← Reverse proxy
├── prosody/                    ← XMPP server
├── api/                        ← Node.js (Fastify) REST API
│   └── src/
│       ├── routes/             ← auth, rooms, admin
│       ├── services/           ← crypto (AES-256), xmpp-provisioner
│       ├── middleware/         ← JWT + ban check
│       └── db/                 ← migrations + pool
├── postgres/init/              ← PostgreSQL extensions
└── docs/                       ← Requirements document
```

## Phase 2 (Federation)

```bash
docker compose -f docker-compose.yml -f docker-compose.federation.yml up -d
```

Adds `serverB.local` Prosody node with S2S federation enabled.

## Development

View live logs:
```bash
docker compose logs -f api      # API
docker compose logs -f prosody  # XMPP server
```

Restart a single service after code changes:
```bash
docker compose up -d --build api
```

Stop everything:
```bash
docker compose down
```

Stop and **delete all data**:
```bash
docker compose down -v
```
