# FitLife — Fixes-2e (18 Oct 2026)

Test branch only. Nothing goes to production without Sachin's go.

## 1. Desktop dialogs
The six member panels now open as **centred dialogs on a computer** (768 px and wider) and stay **bottom sheets on phones**. The panels are food, workout, meal ideas, water, sleep and weight.

- **Widths by content:**
  - water, sleep and weight: 440 px;
  - meal ideas: 560 px;
  - food and workout: 720 px.
- The panel never goes taller than the window. The content scrolls, and the last button stays reachable, even at a short window height (1280×480) and at 200% zoom.
- **Keyboard:**
  - focus starts inside the panel;
  - Tab and Shift+Tab stay inside;
  - Esc closes it;
  - focus goes back to the tile that opened it.
- The page behind is locked while the panel is open and unlocked after it closes.
- **Resizing keeps what you typed.** The dialog and the sheet are the same panel, so it is not rebuilt. Proven: typed 71.3 into weight, narrowed to phone width, widened again, and 71.3 was still there.
- Both themes.
- Changed: `primitives/Sheet.jsx` (new `size` option), plus one line each in `WaterSheet`, `WeightSheet`, `SleepSheet`, `FoodSheet` and `WorkoutSheet`.

## 2. Weighing guidance: record first, name second
- The raw/cooked rule now reads the food record's own preparation field first. It uses the food name only when the record says nothing.
- **When the record and the name disagree**, the app does not guess. The hint says: "This food's record says raw but its name says cooked — check which the numbers are for, and weigh it the same way." The label says "Check: raw or cooked?".
- **The label and the hint now come from the same rule.** Before, "Idli (Steamed)" showed "Preparation not specified" in the label but a cooked hint.
- **Honest limitation:** no food record carries a preparation field today. The foods table has no column for it, and neither the stored nutrients nor the AI replies include one. So in practice the name is still what decides. The code is ready for the field when we add it. It would be a new column, added the safe way, and needs your OK.
- Changed: `utils/foodProvenance.js`, `food/WeighingHint.jsx` and `FoodLog.jsx` (passes the selected food, not just the typed text; still under the 800-line limit).

## 3. Robot: retries recorded, not hidden
- A check that needed a second tap now shows as **"passed after retry"**. It is never counted as a clean pass or as a covered workbook case.
- Each retry is listed with:
  - the screen and the intended panel;
  - what the first tap hit, or what covered the tile;
  - whether the page reloaded in between;
  - what the retry did.
- Each retry also appears as a yellow warning on GitHub.
- Failures save a screenshot plus a text file with the page address and the page text.
- The account-isolation checks (R15, R16) still fail immediately; they are never retried.
- Missing logins: still **BLOCKED** (red).

**First-tap miss found and fixed (real app bug).** The first run with retry logging showed R14, "coach saves a note", passing only after a retry. The real tap on "Save note" failed. Cause: on the coach's member page, a long unbroken line in the weekly brief pushed the whole page to 446 px wide on a 390 px phone, so the button sat partly off screen. The brief text now wraps (`coach/WeeklyBrief.jsx`). The robot's R13 now also checks that the coach member page has no sideways scroll. Rerun: 47 passed cleanly, **0 retries**.

**Account-switching failures (R15).** The two earlier live failures were "weight input not found" and "page navigated during the check". Both happened while the app was reloading itself on a first visit. That reload was fixed in Fixes-2d (commit 939c894), and the robot's R00 check guards it. No account-switch failure has happened since. If one comes back, the retry log and the evidence file will show exactly where.

## 4. Tests
- **No test was deleted or weakened.**
- Added in `test-day-lib.js` [7d2]:
  - the record marker wins;
  - a marker in the nutrients block counts;
  - the name is used only as a fallback;
  - a conflict gives "check";
  - an unknown marker is ignored;
  - the label always agrees with the rule.
- Added in `ui-tests.mjs`:
  - desktop dialog at 440 px;
  - narrowing turns it into a sheet and keeps the typed value;
  - widening turns it back into a dialog;
  - the weighing hint for a record marker and for a conflict;
  - the week brief must keep wrapping.
- The dialog tests fail on the old panel, which shows they really test the change.

## 5. Results
- **Local gate:** all suites pass, 5,778 assertions (layout contracts 159, day-lib 282, ui-tests 894).
- **Browser dialog checks:** 299 of 299 pass. They cover phone, desktop, short window and 200% zoom, in both themes.
- **Local robot:** 47 passed cleanly, 0 after retry, 0 failed; 53 workbook cases covered.

## 6. Not tested (needs a real phone)
- microphone;
- camera;
- the phone keyboard over inputs;
- installing the app.

The week brief overflow was seen with a fake AI reply locally. Whether real AI replies ever contain such long unbroken lines on the live site is not confirmed. The wrap fix is harmless either way.

## 7. Unfinished
- **Saving raw/cooked on food records is not built.** The app can read a preparation field, but:
  - no column stores it;
  - nothing fills it in (not the admin food screen, not the AI, not imports);
  - no record has one today.
  Until it is stored and filled, the food name decides. Building it needs your OK: a new column (add-only), a way to set it, and filling in the existing foods.
- **Real-phone checks** (microphone, camera, phone keyboard, installing the app) must pass before asking for production approval.
- **Production is unchanged.**

## 8. Evidence added 18 Oct (no app change)
- The robot workflow now does two more things after each run:
  1. It compares every file of the build (`index.html`, `sw.js` and all 33 files it loads) **byte for byte** with what the test site serves.
  2. It publishes the full robot report, together with that comparison, on the commit as the check **"Phone robot report"**. Anyone can read it on GitHub without downloading the artifact zip.
- Proven locally:
  - 35 of 35 files identical against a copy of the build;
  - one changed byte in the app file is caught and fails the check.
- **NEW** `server/scripts/check-live-assets.mjs`; changed `.github/workflows/phone-robot.yml`.

## Files
- **NEW:** `DELIVERY-FIXES-2e.md`
- **Changed:**
  - `client/src/components/primitives/Sheet.jsx`
  - `client/src/components/sheets/WaterSheet.jsx`, `WeightSheet.jsx`, `SleepSheet.jsx`, `FoodSheet.jsx`, `WorkoutSheet.jsx`
  - `client/src/utils/foodProvenance.js`
  - `client/src/components/food/WeighingHint.jsx`
  - `client/src/components/FoodLog.jsx`
  - `client/src/components/coach/WeeklyBrief.jsx`
  - `server/scripts/robot-phone-run.mjs`
  - `server/scripts/test-day-lib.js`
  - `server/scripts/ui-tests.mjs`
  - `DELIVERY-PHONE-ROBOT.md`
  - `client/dist/` (rebuilt app)
- Nothing renamed or deleted.
