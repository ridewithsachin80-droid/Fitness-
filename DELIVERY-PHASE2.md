# Delivery: Phase 2 (member side of the diet plan) — 4 Oct 2026

Cumulative from the `main` ZIP of 3 Oct 2026, so it also contains every
Phase 1.3 file. Uploading it over a branch that already has 1.3 is safe:
those files are identical. Upload to `test`, wait for green, try it on
fitness-test.up.railway.app, then merge.

## What changed in Phase 2

| Where | Change |
|---|---|
| Today | "Next up" card: the earliest prescribed meal not yet logged, with time, foods, calories, and the meal after it. A meal over 90 minutes late shows "Missed" and stays on the card. |
| Today | "Log as planned" sheet: items ticked at planned grams; change grams or untick; shows what differs from the plan; saves ordinary food-log rows. |
| Plan > Nutrition | With an approved plan: name, version, targets, eating window, weekday chips, meals with times, timetable, avoid list, cautions. With no plan: unchanged. |
| Member chat | Answers "what is today's meal plan?" from the prescribed meals, each marked logged or not. Told never to change the plan. |
| Server | `GET /members/me/today` adds `diet_plan` (approved plan only, no brief/flags/checks) and a `time` on each meal, in eating order. `GET /members/me/meal-plan` adds the same times. |

No new tables or columns in Phase 2.

## Files

Phase 2 (10 changed, 5 new):

| Path | Status |
|---|---|
| `client/src/lib/day/planMeals.js` | **NEW** |
| `client/src/components/today/NextUp.jsx` | **NEW** |
| `client/src/components/sheets/LogPlannedSheet.jsx` | **NEW** |
| `server/scripts/test-member-plan.js` | **NEW** |
| `DELIVERY-PHASE2.md` | **NEW** (this file) |
| `client/src/lib/day/index.js` | changed |
| `client/src/hooks/useTodayModel.js` | changed |
| `client/src/pages/Today.jsx` | changed |
| `client/src/pages/Plan.jsx` | changed |
| `server/services/dietPlan.js` | changed |
| `server/routes/dietPlans.js` | changed |
| `server/routes/patients.js` | changed |
| `server/routes/aiChat.js` | changed |
| `server/scripts/test-local.sh` | changed |
| `server/scripts/ui-tests.mjs` | changed |

Also in the zip, unchanged since the Phase 1.3 delivery: `server/db/schema.sql`,
`server/scripts/test-diet-studio.js`, `server/scripts/test-diet-fit.js` (new in 1.3),
`client/src/components/coach/DietPlanStudio.jsx`, `client/src/components/CoachAIChat.jsx`,
`client/src/pages/Monitor.jsx`, `DELIVERY-PHASE1.3.md` (new in 1.3).

No file renamed or deleted.

## Gate

- 49 logic and database suites green on real Postgres rebuilt from `schema.sql`.
- New suite `test-member-plan`: 63 checks.
- Screen tests: 432 green, including real Chrome at 320/360/390 px for Today
  with Next up, Plan > Nutrition, and the Log as planned sheet.
- Client build and lint green.
- 19 bugs put back one at a time; each turned a test red.

One existing screen check ("Escape closes the sheet in a real browser @390px")
failed once in a run and passed on the re-run with no code change. It waits a
fixed 600 ms for a closing animation. It did not fail at 320 or 360 px.

## Rules, in one place

- Which meal is next, and when it counts as missed: `client/src/lib/day/planMeals.js`
  (`MISSED_AFTER_MIN = 90`).
- A meal counts as logged once one of its items is logged under that meal slot
  (the same rule the coach card uses).

## Not in this phase

- No "Log as planned" button inside the chat answer.
- The Eat row on Today still says "meal plan pending".
- No meal swaps, and no checking a meal photo against the plan.
