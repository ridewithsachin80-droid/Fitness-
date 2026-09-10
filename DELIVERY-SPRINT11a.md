# Sprint 11a delivery — the weekly review, and "what should I eat now?"

Sprint 11's P1 set ships in parts. **11a** is the two member-facing pieces that stand on data
we already have. Still to come: the workout companion, health markers with "↓ from", the
settings restructure, coach circuits, and the recovery section for tracker members.

Gate: **2,261 assertions green** (9b.1: 2,222). `test-twa-contract` still red
(`android/.gitignore`).

## This zip is a DELTA — only files changed since Sprint 9b.1
```
Fitness--main/
├── DELIVERY-SPRINT11a.md                          (new)
├── client/src/
│   ├── lib/day/mealSuggest.js                     (NEW)
│   ├── lib/day/index.js                           (changed)
│   ├── components/sheets/MealIdeaSheet.jsx        (NEW)
│   ├── components/sheets/index.js                 (changed)
│   ├── components/today/TodaysPlan.jsx            (changed: "What to eat")
│   ├── components/WeeklyReportCard.jsx            (changed: the four sections)
│   └── pages/Today.jsx                            (changed: mounts the sheet)
└── server/
    ├── services/weeklyReport.js                   (changed: reviewSections + prev-week aggregates)
    ├── routes/patients.js                         (changed: sections on the weekly route)
    └── scripts/
        ├── test-day-lib.js                        (changed: +14)
        ├── test-weekly-report.js                  (changed: +5)
        ├── test-layout-contracts.js               (changed: +8)
        └── ui-tests.mjs                           (changed: +13)
```
No schema change. No new route.

## 1. The weekly review — Wins · Opportunities · Pattern · Next week

The Sunday card was a weight number, four tiles and the coach's note. It now also reads the
week back as four short lists:

```
WINS            Logged every day this week.
                Down 0.6 kg this week.
                3 training days.
OPPORTUNITIES   Protein averaged 105 g against 120 g.
PATTERN         Weight moved in the weeks you trained. That is the lever.
NEXT WEEK       Train 4× next week.
```

Every line is a fact from their own log, not a second AI opinion — the coach's note stays
above them. A section with nothing true to say is **omitted, not padded**: an empty week has no
wins, and a perfect week has no scolding.

The sections are **derived when the card is read**, not stored — so improving the wording lifts
every past week, and reports written before this sprint get them too. `aggregateWeek` now also
records last week's days-logged, average kcal and training days, which is what lets a win say
"up from 4" instead of just "5".

## 2. "What should I eat now?"

The Eat row on Today gains **✦ What to eat**. It works out what is left of the day's calorie
and protein targets and fills it from the member's own most-logged foods, at the gram amounts
they normally use:

> **75 g protein left — best fit for dinner**
> 640 kcal · 38 g protein from what you usually eat.
> Paneer (Low Fat) · 150 g · 27 g protein — 306 kcal
> Idli · 120 g · 4 g protein — 156 kcal

**Add to today** writes them into the food log through the same path every other screen uses;
the member adjusts grams there. Deliberately computed on the phone, not by the AI: the
suggestion has to be checkable and instant, and it works offline.

Rules that keep it honest: no targets → no suggestion; only foods with real per-100g data;
never more than the calories left; over target says so and suggests nothing; a member with no
food history is told to log a few meals first.

## Fixed while building
`2,100 kcal against an 1,800 target` reported **"on target"** — a negative remainder was being
read as a small one. Over-target is now checked first. The golden test that caught it is in the
suite.

## Verified
- lib/day (+14): every branch of `suggestMeal` — no targets, over, exactly on, nearly there,
  protein behind, protein-dense chosen first at the member's usual grams, budget never
  exceeded, nothing fits, no history, no per-100g data, meal named from the IST hour, three
  items max, and `remaining()`. Budget cap mutation-checked.
- Real Postgres (+5): the weekly route returns the sections; an older stored report still gets
  them; an empty week yields no wins; a perfect week yields no opportunities.
- jsdom (+13): the Eat row opens the sheet, it asks for the member's foods, the headline names
  the protein gap, paneer first at 150 g, Add writes the rows with per-100g data, a second tap
  closes rather than duplicating; the weekly card renders all four sections with the coach note
  above them.
