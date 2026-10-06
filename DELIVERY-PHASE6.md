# Delivery: Phase 6 (approved swaps and swap requests) — 5 Oct 2026

Cumulative from the `main` ZIP of 3 Oct 2026: carries every earlier file too
(Phases 1.3–5), unchanged since those deliveries. Upload to `test`, wait for
green, try it on fitness-test.up.railway.app, then merge.

## Rules (Sachin, 5 Oct 2026)

- The AI suggests alternatives; the coach approves each one. Nothing is
  offered to a member before the coach approves it.
- Kept per member, by food name, so the list carries over when the plan is
  revised (a new version with the same food keeps its swaps).
- A swap keeps the calories: the alternative's grams are worked out so it
  carries the same kcal as the planned portion (rounded to 5 g, or 1 g under 30 g).

## What it does

- **Coach, Studio (plan in force) › Swaps:** "Suggest swaps for this plan (AI)";
  each suggestion with Approve / Decline; member requests shown first, with
  their note; approved swaps as chips (× to remove); add one by hand (calories
  looked up). The AI is given the plan's foods and avoid list; suggestions for
  foods not in the plan, the same food, anything on the avoid list, or with no
  calories are dropped. Suggesting again never undoes a decision.
- **Coach home › Needs attention:** "Asked for a swap" on a member waiting.
- **Member, Log as planned:** "Swap (n)" on a food with approved swaps, showing
  each alternative with its grams; picking one logs it instead ("Banana 115 g
  instead of Guava"). "Ask for a swap" on every food sends a request to the
  coach ("keep to the plan until then"). Asking again for one the coach
  declined says so rather than quietly re-sending.
- **Member chat:** told the approved swaps (with grams) and only those; asked
  about another, it says it is not approved yet and points to the Swap button.

## Files

New (5): `server/services/swaps.js`, `server/routes/swaps.js`,
`server/scripts/test-swaps.js`, `client/src/components/coach/SwapsPanel.jsx`,
`DELIVERY-PHASE6.md`.

Changed (13): `server/db/schema.sql` (new table `plan_swaps`), `server/index.js`,
`server/routes/dietPlans.js` (exports only), `server/routes/aiChat.js` (chat rule),
`server/routes/patients.js` + `server/services/triage.js` (Needs attention reason),
`server/services/dietPlan.js` (chat lines), `server/scripts/test-local.sh`,
`server/scripts/ui-tests.mjs`, `client/src/lib/day/planMeals.js` (swap grams,
swap rows), `client/src/components/sheets/LogPlannedSheet.jsx`,
`client/src/components/coach/DietPlanStudio.jsx`.

No file renamed or deleted. One table added.

## Gate

- 3,228 checks green in one full run, including real Chrome at 320/360/390 px.
- New: `test-swaps` 33 checks, screen tests 12, phone-width check for the panel.
- 7 bugs put back one at a time (unapproved swaps reaching the member, a second
  AI round undoing decisions, the avoid list ignored, a swap changing the
  calories, the chat told unapproved swaps, a declined request quietly re-sent,
  another coach deciding); each turned a test red.
