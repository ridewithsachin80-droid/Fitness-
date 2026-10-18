# FitLife — Fixes-2g (18 Oct 2026)

Test branch only. Production is unchanged and needs Sachin's explicit approval.
Source: reviewer's notes on 2f.

## 1. Plan shows protein-only (and calories-only) targets
**The bug was in two places:**
- The Eat heading only looked at calories. With a protein target and no calorie target it said "Targets not set yet". With calories but no protein it said "1,600 kcal · — g protein".
- When the server sends the raw `macro_*` columns, Plan built targets only if a calorie value existed. So `macro_pro: 100` alone was dropped completely, and the Nutrition tab's "Daily targets" said "Not set yet" too.

**Now:**
- One function reads the targets from either shape, `{ macros }` or `macro_*` columns; any positive number counts.
- The heading names exactly what the coach set, and the message under it agrees.

| Coach set | Eat heading | Message | Nutrition → Daily targets |
|---|---|---|---|
| nothing | Targets not set yet | No meal plan yet. Log what you eat; your coach will set your targets. | Not set yet |
| calories only | 1,600 kcal | No meal plan for today. Eat to your targets and log as you go. | 1,600 kcal |
| protein only | 100 g protein | No meal plan for today. Eat to your targets and log as you go. | No calorie target (protein shown in its box) |
| both | 1,600 kcal · 100 g protein | No meal plan for today. Eat to your targets and log as you go. | 1,600 kcal |

**Tests:** `ui-tests` E2 renders the real Plan screen for each case. Protein only is tested in both data shapes. Each case checks the Eat heading, its message and "Daily targets". Run against the 2f code, three of the five cases fail (calories only, and both protein-only shapes); on the new code all five pass.

## 2. The colour test works on any computer
`test-layout-contracts.js` [brand-2f] built file paths with the computer's own separator. On Windows that is `pages\Monitor.jsx`, so the printed-report exception would never match and the check would fail there for no reason. Now:
- Paths are normalised to `/` before the exception is applied. Proven: a Windows path converts to `pages/Monitor.jsx`.
- The exception is narrower: exactly `pages/Monitor.jsx` **and** exactly `#fef3c7`. Before, it matched any line starting with that text.
- The assertion is unchanged.
- Mutation-tested: the same colour in another file fails; another amber code in `Monitor.jsx` fails.

## 3. Unfinished (unchanged)
- **Saving raw/cooked on food records is not built.** The app can read a preparation field, but nothing stores or fills it, and no record has one. The food name still decides. Needs Sachin's OK.

## 4. Real-phone checks: not done, and they cannot be done by Claude
- Microphone, camera, keyboard, installing the app and push notifications need a person with an Android phone.
- **NEW `REAL-PHONE-CHECKS.md`** lists each check (how, and what counts as a pass) with a results table to fill in. Every result must be recorded there before production approval is requested.

## 5. Tests changed (none weakened)
- `ui-tests.mjs`: E2 added (five cases).
- `test-layout-contracts.js`:
  - the [brand-2f] Plan copy check now matches the new condition (any target, not only calories), with the same two sentences;
  - path normalisation added;
  - the exception narrowed.

## Files
- **NEW:** `DELIVERY-FIXES-2g.md`, `REAL-PHONE-CHECKS.md`
- **Changed:**
  - `client/src/pages/Plan.jsx`
  - `server/scripts/ui-tests.mjs`
  - `server/scripts/test-layout-contracts.js`
  - `client/dist/` (rebuilt app)
- Nothing renamed or deleted.
