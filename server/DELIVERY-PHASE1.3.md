# Delivery: Phase 1.3 (Diet Plan Studio) — 3 Oct 2026

Built from the `main` ZIP downloaded on 3 Oct 2026. Upload to branch `test`,
wait for a green run, try it on fitness-test.up.railway.app, then merge.

## What changed

| Item | Change |
|---|---|
| A | A day more than 5% over the calorie target is a must-fix error. Under is a warning. A day's carbs more than 5% over the carb target is a must-fix error. |
| A | "Fit to target": the app scales non-compulsory portions, shows every change, saves only on "Save these portions". |
| A | Compulsory items: marked by the AI from the brief, or with "Fix portion" in the Studio. Fit never changes their grams. |
| A | The draft prompt gives the exact allowed range per day. |
| B | Lab cautions are written by the app from the stored flags. The AI and edits cannot remove them. |
| C | Both prompts name the actual green and forbid "kale". A warning shows if a vague "soppu" name comes back. |
| D | "Draft a diet plan for ..." in the coach chat previews, then Apply creates a Studio draft with a "Review in Nutrition" button. Nothing is approved from chat. |

## Files (10 changed, 2 new)

| Path | Status |
|---|---|
| `server/services/dietPlan.js` | changed |
| `server/routes/dietPlans.js` | changed |
| `server/routes/aiChat.js` | changed |
| `server/db/schema.sql` | changed (one added column: `diet_plan_items.compulsory`) |
| `server/scripts/test-diet-studio.js` | changed |
| `server/scripts/test-local.sh` | changed |
| `server/scripts/ui-tests.mjs` | changed |
| `server/scripts/test-diet-fit.js` | **NEW** |
| `client/src/components/coach/DietPlanStudio.jsx` | changed |
| `client/src/components/CoachAIChat.jsx` | changed |
| `client/src/pages/Monitor.jsx` | changed |
| `DELIVERY-PHASE1.3.md` | **NEW** (this file) |

No file renamed or deleted. No file needs renaming before upload.

## Gate

2,735 checks green: real Postgres rebuilt from `schema.sql`, client build,
lint, screen tests in jsdom, real Chrome at 320/360/390 px including the
Studio with the Fit preview open.
New in this phase: `test-diet-fit` (120 checks) and 32 screen checks.
The same gate on the unchanged repo gave 2,503, but that run had no Chrome
installed, so about 80 of the difference is the existing phone-width checks.
18 bugs were put back one at a time; each turned a test red.

## Rules, in one place

- Margin: `KCAL_MARGIN` and `CARB_MARGIN` at the top of `server/services/dietPlan.js` (both 5%).
- Fit limits: a portion is never scaled below 40% or above 250% of the draft.
- A day whose compulsory items alone are over the target is left untouched and reported.

## Not changed

- A plan attached as a PDF or photo in the coach chat is still approved on Apply, without the over-target block.
- Plans already approved are untouched. Revising one that is over target will show the must-fix error.
