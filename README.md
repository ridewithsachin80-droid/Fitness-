# Health Monitor PWA

A progressive web app for daily health tracking, built for **Mrs. Padmini** and monitored by **Sachin**.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 5 + Tailwind CSS 3 |
| State | Zustand |
| Charts | Recharts |
| PWA | vite-plugin-pwa + Workbox |
| Real-time | Socket.io |
| Backend | Node.js + Express |
| Database | PostgreSQL (Railway) |
| Auth | OTP via SMS (MSG91) + JWT |
| Push notifications | Web Push + node-cron |
| Deployment | Railway |

## Project structure

```
health-monitor/
├── server/
│   ├── index.js              Main Express + Socket.io server
│   ├── db/
│   │   ├── pool.js           PostgreSQL connection pool
│   │   └── schema.sql        Full database schema (run once)
│   ├── routes/
│   │   ├── auth.js           OTP + JWT auth endpoints
│   │   ├── logs.js           Daily log CRUD
│   │   ├── patients.js       Patient management
│   │   └── notifications.js  Push subscription endpoints
│   ├── middleware/
│   │   ├── auth.js           JWT verify
│   │   └── roleCheck.js      Role guard
│   ├── services/
│   │   ├── smsService.js     MSG91 OTP sender
│   │   ├── pushService.js    Web Push sender
│   │   └── cronService.js    Scheduled reminders (IST)
│   └── scripts/
│       ├── createAdmin.js    One-time seed script
│       └── smokeTest.js      Post-deploy verification
├── client/
│   ├── public/icons/         PWA icons (192, 512, 180, 32px)
│   └── src/
│       ├── pages/
│       │   ├── Login.jsx     OTP + email/password dual login
│       │   ├── DailyLog.jsx  Patient daily entry (8 sections)
│       │   ├── PatientList.jsx Monitor patient overview
│       │   ├── Monitor.jsx   Patient detail + charts + labs
│       │   └── Settings.jsx  Push subs + account
│       ├── components/
│       │   ├── UI.jsx        Card, CheckRow, OfflineBanner, etc.
│       │   ├── WaterTracker.jsx
│       │   ├── FoodLog.jsx   Meal tabs + food autocomplete
│       │   ├── SleepTracker.jsx
│       │   └── InstallPrompt.jsx  Android + iOS PWA install
│       ├── hooks/
│       │   ├── useSync.js    Socket.io real-time updates
│       │   ├── usePush.js    Web Push registration
│       │   └── useOfflineQueue.js  IndexedDB offline save queue
│       ├── store/
│       │   ├── authStore.js  JWT + user state (Zustand)
│       │   └── logStore.js   Daily log state + API sync
│       └── api/
│           ├── client.js     Axios + silent token refresh
│           └── logs.js       All API endpoint functions
├── railway.toml              Railway deployment config
├── DEPLOY.md                 Full deployment guide
└── .gitignore
```

## Quick start (local dev)

```bash
# 1. Clone and install
git clone <repo-url> && cd health-monitor
cd server && npm install && cd ../client && npm install && cd ..

# 2. Set up server env
cp server/.env.example server/.env
# Edit server/.env — add DATABASE_URL and JWT secrets

# 3. Run schema
psql $DATABASE_URL -f server/db/schema.sql

# 4. Seed users
node server/scripts/createAdmin.js

# 5. Start dev servers (two terminals)
cd server && npm run dev          # Terminal 1 → localhost:3000
cd client && npm run dev          # Terminal 2 → localhost:5173
```

## API endpoints

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/send-otp` | — | Send OTP to patient phone |
| POST | `/api/auth/verify-otp` | — | Verify OTP, get JWT |
| POST | `/api/auth/login` | — | Monitor email+password login |
| POST | `/api/auth/refresh` | cookie | Silent token refresh |
| POST | `/api/auth/logout` | — | Clear refresh cookie |

### Daily logs
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/logs/:date` | JWT | Get log for date |
| POST | `/api/logs/:date` | JWT (patient) | Upsert log, emits Socket.io |
| GET | `/api/logs/range/:from/:to` | JWT | Chart data range |

### Patients
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/patients` | monitor/admin | List assigned patients |
| GET | `/api/patients/:id` | monitor/admin | Profile + 30 logs + labs |
| POST | `/api/patients` | admin | Create patient (transactional) |
| PATCH | `/api/patients/:id/profile` | monitor/admin | Update profile |
| POST | `/api/patients/:id/labs` | monitor/admin | Add lab value |
| POST | `/api/patients/:id/notes` | monitor/admin | Add clinical note |

### Notifications
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/notifications/subscribe` | JWT | Save push subscription |
| DELETE | `/api/notifications/unsubscribe` | JWT | Deactivate subscription |
| GET | `/api/notifications/subscriptions` | JWT | List active devices |
| GET | `/api/notifications/log` | JWT | Notification history |

## User roles

| Role | Login method | Can do |
|------|-------------|--------|
| `patient` | Phone + OTP | View/save own daily log |
| `monitor` | Email + password | View assigned patients, add lab values |
| `admin` | Email + password | Everything + create patients |

## Push notification schedule (IST)

| Time | Notification |
|------|-------------|
| 6:25 AM | Morning weight reminder |
| 9:40 AM | ACV before Meal 1 |
| 1:15 PM | ACV before Meal 2 |
| 5:15 PM | ACV before Meal 3 |
| 2:00 PM | Water check (if < 1.5L logged) |
| 8:00 PM | No-log alert to monitor |

## Deployment

See [DEPLOY.md](./DEPLOY.md) for the full Railway deployment guide.

Quick deploy:
```bash
railway login && railway init && railway up
```

## Testing

```bash
# Smoke test against any deployed URL
BASE_URL=https://your-app.up.railway.app node server/scripts/smokeTest.js

# Import the Postman collection for manual API testing
# File: server/scripts/postman_collection.json
```
