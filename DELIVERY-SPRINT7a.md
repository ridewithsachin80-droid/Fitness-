# Sprint 7a delivery — Onboarding by goal (several goals)

Sprint 7 ships in two halves. **7a is the onboarding**, with goals as a list. 7b (My Health /
Profile and the Login polish) follows.

Gate: **2,072 assertions green** (Sprint 6: 2,043). `test-twa-contract` still red
(`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 6
```
Fitness--main/
├── DELIVERY-SPRINT7a.md                           (new)
├── client/src/
│   ├── components/Onboarding.jsx                  (changed — rewritten)
│   ├── components/AIChatLog.jsx                   (changed: composer prefill)
│   └── hooks/useTodayModel.js                     (changed: Week N field fix)
└── server/
    ├── db/schema.sql                              (changed — ONE additive column, see below)
    ├── routes/patients.js                         (changed)
    └── scripts/
        ├── test-journey.js                        (changed)
        ├── test-layout-contracts.js               (changed)
        └── ui-tests.mjs                           (changed)
```

**Schema:** `ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS goals JSONB;` — additive,
runs on boot, verified on an empty database by the gate. Nothing renamed, nothing dropped.
The existing `goal` column stays and is kept equal to the first entry of `goals`, so every
coach view and older client keeps working unchanged.

## What a new member sees

Four screens, one question each, a hairline progress bar at the top, questions in Fraunces:

1. **Who's using FitLife?** — Child / Adult / Senior (drives the app mode, as before).
2. **What are you working toward?** — seven goals, **pick as many as apply**: Lose weight ·
   Build muscle · Get stronger · More energy · Sleep better · Manage a condition · Stay healthy.
   Each pick gets a number in the order tapped; the first is the main goal ("Main goal:
   Sleep better · tap to reorder"). Tap again to remove; the numbers close up.
3. **Where are you starting from?** — weight now and target, both optional, 20–300 kg checked.
4. **You're set** — "Let's lose weight, together. Also: more energy, sleep better." Avatar picker
   lives here (no longer a step of its own). Then the AI introduces itself with a sample day;
   **Try this message ›** finishes setup and opens Today with the sample already in the
   composer — not sent, ready to edit and send.

## Server
- `PUT /members/me/onboarding` accepts `goals: [...]` (validated against the seven ids,
  de-duplicated, order kept, at least one). `goal` is derived as the first entry. A client
  sending only `goal` still works and becomes a one-item list. A save that does not mention
  goals leaves them untouched.
- `GET /members/me/onboarding` and `GET /members/me` return both `goal` and `goals`.

## Fixed on the way
- **Week N in the Today header was blank in production.** `/members/me` calls the join date
  `member_since`; the Sprint 5b code read `created_at`. Caught while wiring the goal fields.
- The journey harness mounted the router only under the legacy `/api/patients` alias;
  it now mounts `/api/members` too, exactly like `index.js`.

## Verified
- Real Postgres (journey suite, 79 assertions): list saved deduped in order; `goal` = first;
  unknown goal → 400; empty list → 400; legacy single `goal` → one-item list; a save without
  goals leaves them; stored as `goal` + `goals JSONB`; `/members/me` exposes both.
- jsdom (18 assertions): mode gating; seven goals; multi-select with per-goal order numbers;
  removing re-numbers; implausible weight blocks; headline names the main goal and the rest;
  12 avatars on the last screen; the PUT body is `{ age_mode, goals in order, weights,
  avatar_idx }` with no legacy `goal`; the store is marked onboarded; "Try this message"
  opens the composer with the sample waiting.
- Contracts: the seven client ids equal the seven server ids; goals sent as a list; sample is
  prefilled not sent; no emoji or hex in the onboarding chrome.
