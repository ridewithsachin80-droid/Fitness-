# Sprint 11d delivery — your house circuits

The last Sprint 11 item. Gate: **2,336 assertions green** (11c: 2,308). `test-twa-contract`
still red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 11c
Upload order matters: **11b → 11c → 11d.**
```
Fitness--main/
├── DELIVERY-SPRINT11d.md                          (new)
├── client/src/
│   ├── pages/Settings.jsx                         (changed: My circuits card, coaches only)
│   └── components/coach/HouseCircuits.jsx         (NEW)
└── server/
    ├── db/schema.sql                              (changed — ONE additive table, see below)
    ├── services/circuits.js                       (NEW)
    ├── routes/aiChat.js                           (changed: prompt + enforcement + 3 routes)
    └── scripts/
        ├── test-coach-circuits.js                 (NEW — real Postgres, 18 assertions)
        ├── test-local.sh                          (changed: suite added)
        ├── smoke-routes.js                        (changed)
        ├── test-layout-contracts.js               (changed: +4)
        └── ui-tests.mjs                           (changed: +5)
```

**Schema:** `CREATE TABLE IF NOT EXISTS coach_circuits (…)` with a unique index per coach per
name (case-insensitive). Additive, above the DEFERRED BACKFILLS marker. I dropped the table and
re-ran the full gate from `schema.sql` — green — so a fresh deploy creates it.

## What it does

When you told the coach AI "push day Monday, legs Friday", it built each day from five gym
staples it picked. That is not your push day.

**Settings → My circuits** (coaches and admins only): add "Push", "Legs", "Core" … typed the
way you already write them, one exercise per line —

```
Bench press 4x8-12 chest
Incline DB press 3 x 10
Cable fly 3×12-15
Plank
```

From then on, any program day you name that matches a circuit — "push", "push day", "Push
circuit" all match "Push" — is assigned with **exactly those exercises, sets and reps, in that
order**. Days with no matching circuit are built as before.

**Two layers, on purpose.** The circuits go into the AI's instructions ("use EXACTLY these; do
not substitute"). And separately, after the AI answers, the server **replaces any matching day
with your circuit regardless** — so a model that ignores the instruction still cannot ship a
generic Push to a coach who has one. The preview marks such days as your circuit.

Re-saving "push" replaces the exercises but keeps your original capitalisation. Deleting a
circuit returns that day to the AI's generic build. Another coach's circuits are never visible
to you, nor yours to them.

## Verified
- Real Postgres (18): typed text parses ("4x8-12 chest", "3 x 10", the × character, a bare
  name); validation refuses no name / no exercises / more than 15; save, list, replace (case-
  insensitive, one row), delete; another coach sees nothing; the prompt block names every
  circuit exactly and instructs no substitution; no circuits → no block; and the enforcement:
  a generic Push and Legs become yours, an unmatched Pull is left alone.
- jsdom (5): the card renders a saved circuit; save without a name is refused; save PUTs the
  text and the list refreshes; delete removes one; a member's Settings has no card.
- Contracts (4): additive unique table above the backfills; prompt carries and parse enforces;
  original casing kept; card is coach/admin only.

Sprint 11 is complete. Next: **Sprint 12 — architecture and polish.**
