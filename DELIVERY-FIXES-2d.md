# Delivery: Fixes 2d — Meal ideas, partial targets, weighing guidance, robot BLOCKED (17 Oct 2026)

Pushed to the **test** branch. Desktop dialogs are a separate, later delivery (agreed with Sachin).

## 1. Meal ideas: one clear screen per situation
**Before:**
- With no calorie or protein target, the panel showed only a heading and "Done".
- A failed request looked like "no food history".

**Now:** `MealIdeaSheet.jsx` shows exactly one of these (the screen carries `data-state` and `data-reason`):
- **Targets not set:** "Your nutrition targets aren't set yet." / "You can still log meals…". Nothing is fetched and no target is invented.
- **Loading:** placeholder lines.
- **Couldn't load:** "Couldn't load your recent foods. Check your connection and try again. Nothing was changed." with **Try again**.
- **A message:** over target, on target, no usable food history ("Log a few meals and I can suggest…"), or nothing fits.
- **A suggestion:** foods from the member's own history, with "Add to today".

The note no longer appears twice.

## 2. Partial targets never print "null"
**Before:** a protein-only target with no history printed "80 g protein and null kcal still to go."

**Now:** `lib/day/mealSuggest.js` has `gapText()` covering both targets, protein only and calories only; with neither, there's no suggestion and the screen says targets aren't set. Every outcome carries a `reason`. The "nothing fits" wording is unchanged ("100 kcal left today."); an existing test caught my first attempt changing it.

## 3. Weighing guidance follows the food
**Before:** the food sheet told everyone "Enter weight before cooking". That's wrong for the many foods whose numbers are for the cooked dish (cooked rice, dal tadka, steamed idli).

**Now:**
- The add-food form shows a hint for the selected food:
  - cooked → "weigh it cooked, as you eat it";
  - raw → "weigh it before cooking";
  - name doesn't say → "Check whether these numbers are for raw or cooked, and weigh it the same way."
- Only explicit words in the name decide. The app has no separate raw/cooked field, so it never guesses.
- The sheet's top line now reads "Tap the mic to log by voice · each food says whether to weigh it raw or cooked".

## 4. Robot: a missing login is BLOCKED, never green
A run with missing logins now **fails** with "BLOCKED — nothing was tested… This is not a pass." The report and summary say BLOCKED. Before, it exited 0 with a warning, which showed a green tick.

New robot check **R11c**: on the live test site, Meal ideas always settles on a real screen and never shows null/undefined/NaN.

## 5. Found by the robot: the app reloaded itself on a first visit
**Bug:** on a brand-new phone or browser, the app reloaded itself a few seconds after opening. That wiped a half-typed phone number or PIN, or an open panel.

**Cause:** the "reload when a new version takes over" rule also fired the first time the offline helper took control, when there's no old version to replace.

**Fix:** `client/src/utils/swReload.js` (new), used by `client/src/main.jsx`, reloads only when a new version replaces an old one.

**Proven in real Chrome on a production-mode copy:**
- a fresh visit now loads **once** in 15 s (it was twice, every time);
- a simulated deploy still shows "New version available" and reloads into it.

**Tests:**
- test-day-lib [7d3]:
  - first install → no reload;
  - a later new version → reload;
  - a version swap reloads exactly once;
  - main.jsx uses the rule.
- Robot **R00:** a first visit on the live site loads once.

**Also:** the "no food history" Meal ideas screen printed its heading twice. It now has its own short title, and a ui-test checks the heading appears once.

## Tests (all new, none weakened)
- **test-day-lib:**
  - every target combination × with history, no history, nothing fits: no null/undefined/NaN;
  - exact wording for protein only, calories only and both;
  - neither target → no suggestion;
  - each outcome has a reason;
  - `weighingBasis` for cooked, raw and unknown names.
- **ui-tests [38]:** the real sheet in a browser:
  - no targets (and no request made);
  - loading;
  - failed request → "Try again" → suggestion;
  - no history;
  - a valid suggestion;
  - all four target combinations with and without history;
  - the weighing hint for cooked, raw, unknown and empty;
  - the food sheet no longer says "Enter weight before cooking".
- **Mutation-checked:** on the old code these fail, reproducing "80 g protein and null kcal still to go." word for word.
- **Size contract:** FoodLog must stay under 800 lines; one blank line was removed to keep it at 799 (the limit wasn't changed).
- **Full gate green locally:** 5,765 assertions (after the reload fix). Robot on the local copy: 47/47.

## Screens checked
Phone 390 px and desktop 1280 px, light and dark:
- Meal ideas with no targets;
- Meal ideas with a suggestion;
- the add-food form with the cooked-rice hint.

On desktop, panels still open at the bottom of the screen; that's delivery 2.

## Still manual (real phone only)
Microphone, camera, keyboard over inputs, installing the app.

## Files
- **Changed:**
  - `client/src/components/sheets/MealIdeaSheet.jsx`
  - `client/src/lib/day/mealSuggest.js`
  - `client/src/components/sheets/FoodSheet.jsx`
  - `client/src/components/FoodLog.jsx` (one import, one line)
  - `client/src/utils/foodProvenance.js`
  - `client/src/main.jsx`
  - `server/scripts/robot-phone-run.mjs`
  - `server/scripts/test-day-lib.js`
  - `server/scripts/ui-tests.mjs`
  - `DELIVERY-PHONE-ROBOT.md`
  - `client/dist/*`
- **New:**
  - `client/src/components/food/WeighingHint.jsx`
  - `client/src/utils/swReload.js`
  - `DELIVERY-FIXES-2d.md`
- Nothing renamed or deleted.
