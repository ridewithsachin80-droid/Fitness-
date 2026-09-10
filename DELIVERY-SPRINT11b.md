# Sprint 11b delivery — the workout companion and health markers

Gate: **2,282 assertions green** (11a: 2,261). `test-twa-contract` still red (`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 11a
```
Fitness--main/
├── DELIVERY-SPRINT11b.md                          (new)
├── client/src/
│   ├── lib/workout/suggestLoad.js                 (NEW)
│   ├── components/WorkoutLog.jsx                  (changed: the suggestion card)
│   └── components/LabResults.jsx                  (changed: markers, View all, defensive)
└── server/scripts/
    ├── test-coach-triage.js                       (changed: one gate threshold corrected)
    ├── test-day-lib.js                            (changed: +8)
    ├── test-layout-contracts.js                   (changed: +4)
    └── ui-tests.mjs                               (changed: +10)
```
No schema, route or server-runtime change.

## 1. The workout companion — what to lift today

The workout log already showed "Last time: 40 kg × 12" and had a rest timer. It now adds the
answer to the question that line raises:

```
Try 42.5 kg × 8                                                    [ Use ]
You hit 12 at 40 kg — move to 42.5 kg for 8.
```

**Double progression**, the rule every coach teaches first: reach the top of the coach's rep
range → add a little weight and drop to the bottom of the range; fall short → same weight,
chase one more rep; bodyweight → one more rep. The increment scales with the load so a 12 kg
curl is not asked to jump the same 5 kg as a 100 kg squat (under 20 kg +1, up to 60 kg +2.5,
above +5). Without a prescription, 12 reps is the ceiling.

**Use** prefills the first empty set. It never writes a set by itself, and the member can type
anything over it. Pure function in `lib/workout/suggestLoad.js`, eight goldens.

## 2. Health markers — "5.8 ↓ from 6.1"

The lab section opened with comparison cards. It now leads with the line a member actually
reads:

```
1 marker improved · 1 marker worse · 1 steady   since your last test
HbA1c     5.8   ↓ from 6.1
LDL       128   ↑ from 110
TSH       2.2   → from 2.1
View all ›
```

The full cards — interval, in-range state change, what the member did between the two tests —
sit behind **View all**.

## Fixed on the way
- The lab detail cards assumed every comparison carried a `context` object and a supplements
  list; a sparse row blanked the whole section. Every access is guarded now.
- A triage test assumed the "nothing logged today" gap opened at 11:00; the detector opens it
  at **14:00** (members get most of the day first). The code was right; the test was corrected.
  It had only ever run outside the 11–14 window before.

## Verified
- lib/workout (+8): no history → nothing; top of range → +2.5 and back to the bottom; below →
  one more rep capped at the top; increments 1 / 2.5 / 5; fixed 3 × 10 treats 10 as the top;
  no prescription → 12 ceiling; bodyweight → one more rep; every suggestion has a reason.
- jsdom (+10): last time and "Try 42.5 kg × 8" from the coach's 8–12 range; Use prefills the
  empty set; the labs summary counts by direction; each marker reads latest ↓/↑ from previous;
  detail cards hidden until View all; View all shows the interval and the state change.
- Contracts (+4): suggestion from lib/workout and prefill-only; scaled increment; summary,
  markers and View all present; no unguarded context access.

## Still in Sprint 11
The settings restructure, coach house circuits, and the recovery section for tracker members.
