# Delivery: imported plans checked, boot watchdog unblocked — 4 Oct 2026

Cumulative from the `main` ZIP of 3 Oct 2026: it also carries every file from
Phase 1.3, Phase 2 and the safety/food delivery, unchanged since those.
Upload to `test`, wait for green, try it on fitness-test.up.railway.app, then merge.

## 1. Imported plans get the Phase 1.3 checks

A plan read from a PDF or photo in the coach chat, or typed for a stretch of
days, used to be approved on Apply with no look at its day totals. Now the
plan it would become is checked first:

- **Must-fix error** (a day over the calorie range, carbs over, a food with no
  calories): saved as a Studio **draft** with source `import`. No meals are
  written, nothing reaches the member, and the result has a "Review in
  Nutrition" button. The import's targets wait in the draft too, so the member
  does not see new targets against the old plan.
- **No must-fix error:** approved exactly as before.
- One-day typed changes ("add whey to lunch") are unchanged.

## 2. Boot watchdog runs on the live site

The live login page refused the inline boot watchdog ("Refused to execute
inline script", login:48): helmet's production policy allows scripts from the
site's own files only. So the 10-second recovery screen could never appear,
and its button's `onclick` was blocked too.

- The watchdog moved to `client/public/boot-watchdog.js`, loaded as a file.
- The button uses a click listener instead of `onclick`.
- The security policy itself is unchanged.
- New real-browser check: serves the BUILT client with the same helmet
  headers as production and fails on any policy violation on the login page.
  It reproduced line 48 exactly before the fix.

## Files

New since the safety/food delivery (2 new, 6 changed):

| Path | Status |
|---|---|
| `client/public/boot-watchdog.js` | **NEW** |
| `DELIVERY-IMPORTS-CSP.md` | **NEW** (this file) |
| `client/index.html` | changed |
| `server/routes/aiChat.js` | changed |
| `server/routes/dietPlans.js` | changed |
| `server/services/dietPlan.js` | changed |
| `server/scripts/test-diet-fit.js` | changed |
| `server/scripts/ui-tests.mjs` | changed |

No file renamed or deleted. No tables or columns added.

## Gate

- 2,912 checks green, including the new browser check.
- `test-diet-fit` +10 checks for imports; `ui-tests` +4 for the policy check.
- 3 import bugs put back one at a time; each turned a test red. The policy
  check went red on the unfixed build and green after.

## Not done

- Other pages under the policy: only the login page was checked. A logged-in
  page (photos, camera, voice) may hit other blocked sources; check the
  browser console on the test site after logging in.
- Socket "ping timeout" disconnects: not reproducible here; needs Railway logs.
- Offline day overwriting newer edits: needs a decision on merging first.
