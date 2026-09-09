# Sprint 10 delivery — one wording everywhere (the cached read)

Gate: **2,205 assertions green** (9b: 2,169). `test-twa-contract` still red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 9b
```
Fitness--main/
├── DELIVERY-SPRINT10.md                           (new)
├── client/src/
│   ├── api/logs.js                                (changed: getMyRead)
│   └── hooks/useTodayModel.js                     (changed: prefers the cached read)
└── server/
    ├── db/schema.sql                              (changed — ONE additive table, see below)
    ├── services/aiReads.js                        (NEW)
    ├── services/digests.js                        (changed: both crons cache what they send)
    ├── services/weeklyReport.js                   (changed: caches the weekly line)
    ├── routes/patients.js                         (changed: GET /members/me/read)
    └── scripts/
        ├── test-ai-reads.js                       (NEW — real Postgres, 19 assertions)
        ├── test-local.sh                          (changed: suite added to the gate)
        ├── smoke-routes.js                        (changed)
        ├── test-layout-contracts.js               (changed)
        └── ui-tests.mjs                           (changed)
```

**Schema:** `CREATE TABLE IF NOT EXISTS ai_reads (…)` plus two indexes — additive, above the
DEFERRED BACKFILLS marker, runs on boot. Verified on an empty database: the gate drops the
table, rebuilds from `schema.sql`, and all 2,205 assertions still pass.

## The problem this fixes

Three things described the same day in three places: Today's read (computed on the phone),
the 06:30 WhatsApp/push message (computed on the server), and the evening recap. They agreed
by luck. A member who read "protein's behind" on the phone and "great day" in WhatsApp had no
way to know which was true.

Now the crons write the sentence into `ai_reads`, and Today reads that row. **One wording, on
the phone and in the message.**

## What changes for members
- Open the app after the 06:30 message and Today's read shows **the same sentence** you were
  sent, not a second opinion.
- After the 20:30 recap it switches to the evening line, again word for word.
- **A member with notifications turned off still gets the read on Today** — only the push is
  skipped. (Previously the evening recap skipped them entirely, so they saw nothing.)
- If a cron misses or a member is brand new, Today falls back to its own locally computed
  read, exactly as before. It is never blank.
- Going back a day shows that day's read.

## Rules the store enforces
- One row per member per day per kind; a re-run (cron restart, manual replay) **updates**,
  never duplicates.
- An empty line is not stored — a row that says nothing would report a read that isn't there.
- An unknown kind is rejected before it reaches the database.
- The read is cached **before** the send, so a WhatsApp or push failure still leaves Today
  showing the right words.
- A cache failure never breaks the send: both saves are wrapped and logged.

## Verified
- Real Postgres (19): store rules (idempotent, no empty rows, bad kind rejected, evening wins
  over morning, null on an unwritten day, IST day boundary); the morning cron's cached text is
  **byte-identical** to the notification body; a second run adds no row; the evening recap the
  same; a push-off member has a read and no notification; the route serves it, returns
  `{ read: null }` for an unwritten day, tolerates a malformed date, and refuses a coach.
  Both central guarantees mutation-checked.
- jsdom (6): Today asks once, shows the cached sentence, keeps its action button, does not
  also render the local read, re-reads when the day changes; and with an empty response the
  local read stands in.
- Contracts (9): table additive and unique, above the backfills; both crons cache the same
  `body` they send; cached before the send; push-off members still cached; saves wrapped;
  route member-only and ahead of `/:id`; client prefers cached with a local fallback.
- Fresh-database check: table dropped, gate re-run, everything green.

## Not in this sprint (deferred deliberately)
The weekly review's **Wins · Opportunities · Pattern · Next week** presentation. The weekly
line is now cached (`kind: 'weekly'`), which is the plumbing; restructuring the Progress card
around it is presentation work and belongs with the Sprint 11 UI batch.
