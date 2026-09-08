# Sprint 6 delivery — the Plan screen and the new navigation

Gate: **2,043 assertions green** (5b.3: 2,015). `test-twa-contract` still red for the
`android/.gitignore` reason.

## This zip is a DELTA — only files changed since Sprint 5b.3
```
Fitness--main/
├── DELIVERY-SPRINT6.md                            (new)
├── client/src/
│   ├── App.jsx                                    (changed: /plan route)
│   ├── pages/Plan.jsx                             (NEW)
│   ├── pages/Today.jsx                            (changed: IST hour for the read's action)
│   ├── components/UI.jsx                          (changed: nav tabs)
│   ├── hooks/useTodayModel.js                     (changed: shared protocol derivation; deep links)
│   └── lib/day/
│       ├── index.js                               (changed)
│       ├── protocol.js                            (NEW — resolveProtocolItems)
│       └── nextAction.js                          (changed: istHour)
└── server/scripts/
    ├── test-day-lib.js                            (changed)
    ├── test-layout-contracts.js                   (changed)
    └── ui-tests.mjs                               (changed)
```
No schema, route or server-runtime change. `Settings.jsx` is untouched — the screen moved
off the bar, it did not go anywhere.

## What members see

**Navigation is now Today · Plan · Progress · Profile** with the ✨ orb in the middle.
Settings lives inside Profile (the *Settings* button at the top of Profile, which already
existed) and `/settings` still opens directly.

**Plan** — "What am I supposed to follow?" — four views under a segmented control:
- **Today**: Move (this weekday's program day with sets × reps, *Start ›*), Eat (calorie and
  protein targets, each prescribed meal with its ~kcal, *Log ›*), Recover (water target, sleep
  target 10:00 PM → 6:30 AM, the supplements list). Every line deep-links into the matching
  sheet on Today (`/?open=water` etc.).
- **Week**: Mon … Sun as rows — program days with their exercises, rest days marked, today
  highlighted. Programs not tied to weekdays list their days instead.
- **Nutrition**: kcal target, protein / carbs / fat tiles, the eating window when fasting is
  set, and the full meal plan with grams per item.
- **Recovery**: sleep and water targets, rest days, and every protocol item with its timing —
  the same list Today ticks (one derivation, `lib/day/protocol.js`, now shared by both).

Everything comes from the one request Today already makes (`/members/me/today`), so Plan
and Today cannot disagree.

## Fixed on the way
- The read's action button used the *device's* hour; the rest of the app is IST-anchored.
  It now uses IST too (`istHour`), so a member abroad or a laptop in another zone sees the
  same action as their phone.

## Verified
- jsdom: one request; header; nav order and active tab; Today view (3 × 10, ~415 / ~390 kcal,
  3.0 L, 10:00 PM, B12 · D3); a Recover line navigates to `/?open=water`; Week view has 7 rows,
  3 program days, 4 rest, today highlighted with its exercises; Nutrition view has the tiles,
  the 12:00 PM → 8:00 PM window and both meals with grams; Recovery view lists the 5 protocol
  items with the coach's override label.
- Real Chrome at 320/360/390 px: no sideways scroll on any view; screenshots checked by eye.
  (Caught and fixed: the AI thread's suggestion row overflowed on Plan by 16 px — Plan no
  longer mounts the thread; the orb takes you to Today with the bar up.)
- Contracts: tab order, `/settings` still routed and linked from Profile, Plan reads one
  payload and the shared derivation, deep-links instead of re-implementing sheets.
