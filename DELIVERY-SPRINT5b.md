# Sprint 5b delivery — Today v2

Today now answers "how am I doing, what matters, what do I do" in one screen-height.

Gate: **1,986 assertions green** (5a: 1,967). `test-twa-contract` still red for the
`android/.gitignore` reason.

## This zip is a DELTA — only files changed since Sprint 5a
Unzip and drag the `Fitness--main` folder onto GitHub.

```
Fitness--main/
├── DELIVERY-SPRINT5b.md                          (new)
├── FitLife-Sprints-Revised.md                    (new — the revised remaining sprints)
├── client/src/
│   ├── hooks/useTodayModel.js                    (changed: weekNumber, protein)
│   ├── lib/day/index.js                          (changed)
│   ├── lib/day/nextAction.js                     (NEW — the one action on Today's read)
│   ├── pages/Today.jsx                           (changed)
│   └── components/today/
│       ├── TodaysPlan.jsx                        (NEW — Move · Eat · Recover)
│       ├── NotesRow.jsx                          (NEW — collapsed notes)
│       ├── Greeting.jsx                          (changed: date · Week N · streak line)
│       └── AIRead.jsx                            (changed: action button)
└── server/scripts/
    ├── test-day-lib.js                           (changed: +11 nextAction goldens)
    ├── test-layout-contracts.js                  (changed: Today v2 structure)
    └── ui-tests.mjs                              (changed: Today v2 flow)
```

`DayStrip.jsx`, `ProtocolDots.jsx`, `CoachCard.jsx` and `StreakCard.jsx` stay on disk (deploy
never deletes) and are no longer imported by Today. No schema, route or server-runtime change.

## What members see

- **Header**: "Good morning, Asha" · "Monday, 7 September · Week 6 · 3-day streak". Week N is
  counted from the member's join date (`/members/me.created_at`). The streak is a line, not a
  card.
- **Today's read** now ends with **one gold action** derived from the day — log this
  morning's weight, log what you've eaten, start today's workout, tick the protocol (with the
  count left), add water, set sleep — in that priority. `lib/day/nextAction.js`, pure, golden-
  tested.
- **Today's Plan** — one section, three rows, replacing the coach card, the four tiles, the
  deficit chip and the dots card:
  1. **Move** — program day and exercise count / logged session / rest day. *Start workout ›*
  2. **Eat** — kcal and protein against target, "1 meal plan pending", "1,373 kcal under
     target", nutrients met. *View meal plan ›* while a plan is pending, else *Log food ›*
  3. **Recover** — water and sleep inline (each tappable), the **protocol dots** with
     "3 of 5" inside the row. *Tick protocol ›*
- **Logged today** is a plain section with hairlines, not a box. Notes are an *Add a note*
  row until tapped.
- Every sheet and every save path is unchanged.

## Verified
- jsdom: three rows present; the four old cards absent; Move shows the program day and
  "Start workout"; Eat shows 666 / 1,800 kcal · 37 / 120 g protein, the pending Dinner plan
  and the deficit; nutrients inline; Recover shows 1.5 / 3.0 L, 7h 45m and 5 dots "3 of 5";
  the read's action is "Start today's workout" for that day; "Week 6" in the header; notes
  collapsed until tapped; every sheet still opens from its new tap; Apply still updates the
  Recover row and dots in place.
- `nextAction` pinned by 11 goldens (priority order, time gates, nothing on a past day).
- Real Chrome at 320/360/390 px: no sideways scroll, composer docked, bottom reachable.
  Screenshot checked by eye and two layout problems fixed before delivery (the Eat row was
  cramped by a right-hand action column; the streak line was too loud).

## Next
Sprint 6 — the Plan screen and the Today · Plan · Progress · Profile nav (Settings inside
Profile). See `FitLife-Sprints-Revised.md`.
