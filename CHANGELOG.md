# CHANGELOG — Audit fixes, 6 Oct 2026

Baseline: the repo zip uploaded on 6 Oct 2026 (`Fitness--main (4).zip`).
Full findings are in `QA-REPORT.md`; the scenario table is `TEST-MATRIX.md`.

## How to deploy

1. Upload **the changed-files zip** to the `test` branch first (drag-drop the
   contents of `Fitness--main/` onto the repo root). No file needs renaming.
2. Wait for the GitHub "Test gate" action to go green, then for Railway Test.
3. Do the five checks under "After deploying" below.
4. Repeat on `main`.

Database: one new column, `users.token_version`, added by `schema.sql` on boot
(`ADD COLUMN IF NOT EXISTS`). Nothing to run by hand. Nobody is signed out by
the deploy.

Railway variables:
- `ADMIN_PASSWORD` and `ADMIN_EMAIL` **must be set**. If `ADMIN_PASSWORD` is
  missing in production the server now leaves the admin account alone instead
  of resetting it to the default written in the code.
- `TRUST_PROXY` is optional. Leave it unset (production defaults to `1`).
- No other new variables.

## Files (27 code/test files, 3 documents)

**NEW files — flagged**

| Destination path | What it is |
|---|---|
| `server/db/locks.js` | One writer at a time per member (Postgres advisory lock). |
| `server/scripts/test-audit.js` | 97 regression assertions for this audit. In the gate. |
| `client/src/utils/logSync.js` | The app's save/merge rules as pure, tested functions. |
| `QA-REPORT.md`, `TEST-MATRIX.md`, `CHANGELOG.md` | These documents (repo root). |

**Changed files — overwrite in place**

| Destination path | Why |
|---|---|
| `server/index.js` | Live-update sockets need a login and join only their own room; real client addresses behind Railway's proxy (`trust proxy`). |
| `server/startup.js` | Never create or reset the admin with the built-in default password in production. |
| `server/db/schema.sql` | `users.token_version` (additive). |
| `server/db/logPredicates.js` | "Did they log?" no longer crashes on a malformed row. |
| `server/routes/logs.js` | Day save: body validated, real dates only, one writer at a time, out-of-date saves merged instead of overwriting. |
| `server/routes/patients.js` | Coach notes SQL fixed; double submits of notes, replies and lab values stored once; coach PIN reset ends sessions. |
| `server/routes/admin.js` | Assign in one transaction; enable/disable takes the wanted state and cannot hit the wrong account; member delete removes photos first; PIN reset ends sessions. |
| `server/routes/auth.js` | Sessions end when the PIN/password changes; `GET /auth/me`; OTP from a secure generator and limited per phone. |
| `server/routes/quickLog.js` | A retried or double-fired voice sentence is applied once. |
| `server/routes/reminders.js` | A coach sees only their own members' schedules and devices. |
| `server/routes/aiFoods.js` | `/foods/ai-test` is admin-only and returns no key material. |
| `server/services/dayMerge.js` | `mergeLiveDay`: the three-way merge for an online, out-of-date save. Offline rule untouched. |
| `server/services/memberLogApply.js` | Voice/AI apply runs under the member lock. |
| `server/package-lock.json` | In-range security updates for 16 server packages (`npm audit`: 9 advisories → 0). `package.json` unchanged. |
| `server/scripts/test-local.sh` | Adds `test-audit` to the gate. |
| `server/scripts/test-member-questions.js` | The stub's transaction client now sees the same stub as `pool.query`. No assertion changed. |
| `client/src/store/logStore.js` | A save's answer no longer wipes edits made while it was in flight, or lands in another day. |
| `client/src/hooks/useTodayModel.js` | Refresh the day when the app comes back to the foreground; follow midnight. |
| `client/src/hooks/useSync.js` | Socket sends the login token, re-authenticates, and keeps reconnecting. |
| `client/src/store/authStore.js` | Sign out tells the server. |
| `client/src/utils/session.js` | Remembers a deliberate sign-out across the reload. |
| `client/src/App.jsx` | Boot does not restore a session after a deliberate sign-out. |
| `client/src/pages/Settings.jsx` | Keeps the fresh session a PIN/password change returns. |
| `client/src/pages/AdminDashboard.jsx` | Sends the wanted state for enable/disable. |

Nothing was renamed or deleted. No schema names, role values, socket room
names or legacy aliases changed.

## After deploying (five checks, two minutes)

1. Coach → open a member → Note tab → save a note. It should save.
2. Coach list open on a laptop; a member saves a weight on a phone. The list updates.
3. Member → Profile → Sign out → reopen the app. It should ask for the PIN.
4. Admin → disable a member, tapping twice quickly. They stay disabled.
5. Open `/api/foods/ai-test` in a private window. It should say "No token provided".

## What you and members will notice

- Changing or resetting a PIN signs that member out on their other devices.
- Sign out really signs out.
- A member's app refreshes the day when they come back to it.
- Deleting a member who has photos needs R2 to be reachable; otherwise it refuses and deletes nothing.
- Phones still on the old app bundle keep working; they get live updates through the login cookie.

## Rerun commands

```bash
cd server && npm test                       # whole gate (Postgres on 5433, lint, UI)
cd server && npm run test:db                # database only, then:
export DATABASE_URL="postgres://postgres@localhost:5433/fitlife_test" JWT_SECRET=local-test-secret
node scripts/test-audit.js                  # just the audit suite
cd client && npm run build
```
