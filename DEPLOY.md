# Health Monitor PWA — Deployment Guide

Complete step-by-step guide to deploy on Railway from a fresh clone.
Estimated time: 30–45 minutes.

---

## Prerequisites

- Node.js ≥ 18 installed locally
- [Railway account](https://railway.app) (free tier works)
- [Railway CLI](https://docs.railway.app/develop/cli): `npm install -g @railway/cli`
- MSG91 account for SMS OTP (or use dev mode — OTP logs to console)

---

## Step 1 — Clone and install dependencies

```bash
git clone <your-repo-url> health-monitor
cd health-monitor

# Install server deps
cd server && npm install && cd ..

# Install and build client
cd client && npm install && npm run build && cd ..
```

---

## Step 2 — Generate secrets

```bash
# Generate JWT secrets (run twice for two different strings)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Generate VAPID keys for Web Push
cd server && npx web-push generate-vapid-keys && cd ..
```

Copy the output — you'll paste it into Railway env vars shortly.

---

## Step 3 — Railway project setup

```bash
# Login to Railway
railway login

# Create a new project from the repo root
cd health-monitor
railway init

# Select "Empty Project" when prompted
# Give it a name like "health-monitor"
```

---

## Step 4 — Provision PostgreSQL

In the Railway dashboard:
1. Click **+ New** → **Database** → **Add PostgreSQL**
2. Click the PostgreSQL service → **Connect** tab
3. Copy the **DATABASE_URL** (postgres://...)

Or via CLI:
```bash
railway add --plugin postgresql
```

---

## Step 5 — Set all environment variables

In Railway dashboard → your service → **Variables** tab, add:

```
# Database (from Step 4)
DATABASE_URL=postgresql://...

# JWT (from Step 2 — use two different strings)
JWT_SECRET=<first-random-hex>
JWT_REFRESH_SECRET=<second-random-hex>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

# VAPID (from Step 2)
VAPID_PUBLIC_KEY=<your-public-key>
VAPID_PRIVATE_KEY=<your-private-key>
VAPID_EMAIL=mailto:your@email.com

# SMS OTP — MSG91 (skip for dev; OTP logs to console)
MSG91_API_KEY=your-msg91-auth-key
MSG91_SENDER_ID=HLTHMO
MSG91_TEMPLATE_ID=your-dlt-template-id

# App
NODE_ENV=production
PORT=3000
# Set this AFTER first deploy when you have the Railway URL
CLIENT_URL=https://your-app.up.railway.app
```

Or via CLI (one at a time):
```bash
railway variables set JWT_SECRET=<value>
railway variables set JWT_REFRESH_SECRET=<value>
# ... etc
```

---

## Step 6 — Run the database schema

```bash
# From the project root (railway run connects to your Railway DB)
railway run psql $DATABASE_URL -f server/db/schema.sql
```

If `psql` isn't installed locally:
```bash
# Install psql on Ubuntu/Debian
sudo apt-get install postgresql-client

# Or use the Railway dashboard → PostgreSQL → Query tab
# Paste the contents of server/db/schema.sql and run
```

---

## Step 7 — Deploy

```bash
# From project root
railway up

# Watch logs
railway logs
```

Railway will:
1. Run `cd client && npm install && npm run build`
2. Run `cd server && npm install`
3. Start `node server/index.js`

The Express server serves the built React app statically in production.

---

## Step 8 — Set CLIENT_URL after first deploy

Once deployed, Railway gives you a URL like `https://health-monitor-production.up.railway.app`.

Update the CLIENT_URL variable:
```bash
railway variables set CLIENT_URL=https://health-monitor-production.up.railway.app
```

Then redeploy:
```bash
railway up
```

---

## Step 9 — Seed the database

```bash
# Run the seed script against your Railway DB
railway run node server/scripts/createAdmin.js
```

This creates:
- **Sachin** (admin) — `sachin@healthmonitor.app` / `ChangeMe@123`
- **Mrs. Padmini** (patient) — phone `9876543210`
- Links them together

**Change the password after first login!**

Update `ADMIN_PASSWORD` env var before seeding if you want a custom password:
```bash
railway variables set ADMIN_PASSWORD=YourSecurePassword123
railway run node server/scripts/createAdmin.js
```

---

## Step 10 — Update client .env for production

```
# client/.env.production
VITE_API_URL=https://your-app.up.railway.app
VITE_VAPID_PUBLIC_KEY=<same-public-key-as-server>
VITE_SOCKET_URL=https://your-app.up.railway.app
```

Then rebuild and redeploy:
```bash
cd client && npm run build && cd ..
railway up
```

---

## Step 11 — Smoke test

```bash
BASE_URL=https://your-app.up.railway.app node server/scripts/smokeTest.js
```

All tests should pass before handing off to users.

---

## Step 12 — PWA install

**Android (Chrome):**
1. Open the app URL in Chrome
2. Three-dot menu → "Add to Home Screen"
3. Or wait for the install banner in the app

**iOS (Safari):**
1. Open the app URL in Safari
2. Tap the Share icon (box with arrow)
3. Scroll down → "Add to Home Screen"
4. Tap Add

---

## Cron jobs (auto-start)

The cron service starts automatically with the server. All times are IST (Asia/Kolkata):

| Time    | Notification |
|---------|-------------|
| 6:25 AM | Morning weight reminder |
| 9:40 AM | ACV before Meal 1 |
| 1:15 PM | ACV before Meal 2 |
| 5:15 PM | ACV before Meal 3 |
| 2:00 PM | Water check (if < 1.5L) |
| 8:00 PM | No-log alert to monitor |

---

## Updating the app

```bash
# Make your changes, then:
cd client && npm run build && cd ..
railway up
```

Railway does zero-downtime deploys — the old instance handles requests until the new one is healthy.

---

## Troubleshooting

**"Cannot connect to database"**
→ Check `DATABASE_URL` is set correctly in Railway variables
→ Verify schema was run: `railway run psql $DATABASE_URL -c "\dt"`

**Push notifications not arriving**
→ Verify VAPID keys match between server and client `.env`
→ Check `notifications_log` table for `failed=true` rows
→ Ensure the app is served over HTTPS (required for push)

**OTP not sending**
→ In dev: OTP prints to server console — check Railway logs
→ In production: verify MSG91_API_KEY and MSG91_TEMPLATE_ID are set

**Socket.io not connecting**
→ Railway supports WebSockets natively — no config needed
→ Verify `CLIENT_URL` matches exactly (no trailing slash)

---

## Environment variables — complete reference

| Variable | Where used | Example |
|----------|-----------|---------|
| `DATABASE_URL` | Server | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | Server | 48-char random hex |
| `JWT_REFRESH_SECRET` | Server | 48-char random hex (different) |
| `JWT_EXPIRES_IN` | Server | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Server | `30d` |
| `VAPID_PUBLIC_KEY` | Server + Client | From `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | Server only | From same command |
| `VAPID_EMAIL` | Server | `mailto:you@domain.com` |
| `MSG91_API_KEY` | Server | From MSG91 dashboard |
| `MSG91_SENDER_ID` | Server | `HLTHMO` |
| `MSG91_TEMPLATE_ID` | Server | From MSG91 DLT |
| `NODE_ENV` | Server | `production` |
| `PORT` | Server | `3000` (Railway sets this) |
| `CLIENT_URL` | Server (CORS) | `https://your-app.up.railway.app` |
| `VITE_API_URL` | Client build | `https://your-app.up.railway.app` |
| `VITE_VAPID_PUBLIC_KEY` | Client build | Same as server VAPID_PUBLIC_KEY |
| `VITE_SOCKET_URL` | Client build | `https://your-app.up.railway.app` |
| `ADMIN_PASSWORD` | Seed script | Any strong password |
