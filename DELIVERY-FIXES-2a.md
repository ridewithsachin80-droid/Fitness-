# Delivery — Fixes 2a: lost fixes back, new bugs fixed, AI on past days (16 Oct 2026)

Pushed straight to the **test** branch (Sachin's go-ahead, 16 Oct). Built on top of test e170d67. All the new work from 12–15 Oct is kept.

## Why this was needed
Between 12 and 14 Oct, another assistant built from `main` instead of `test`. Its uploads overwrote most of the 10 Oct fixes and deleted the tests that guarded them, so GitHub stayed green. This build brings the fixes back, and their tests with them.

## Back again (10 Oct fixes)
| Case | What members / coaches get again |
|---|---|
| VOI-011 | Phone-shortcut and hands-free voice saves weight, water and sleep again (it saved only food). |
| VOI-012 | Hands-free food goes to the meal due now, not always Breakfast. |
| VOI-013 | "Open workout" / "open food" by voice opens the sheet, even when Today is already on screen. |
| MSG-003 | The 06:30 message respects the member's WhatsApp switch. |
| PRG-007 | Progress → "Your diet plan, PDF and grocery list" opens Plan on Nutrition. |
| CMP-010/011 | The coach's "⚖️ Log Weight" and "+ Create / Edit" program buttons work again. |
| ADM-017 | Weight and ACV reminder editors have their own titles. |
| ADM-021 | Admin food ✏️/🗑 are visible on phones. |
| ADM-022 | The admin "NO LOG" badge uses India's date. |
| UI-012 | "Connect Fitbit" renews the sign-in first, or says in words that it has run out. |
| UI-014 | The Devices tile says "Fitbit, WHOOP and Polar". |
| SET-006 | Settings choices are no longer reset on every launch. |
| ONB-005 | The goal hint says what tapping does. |
| LAB-005 | Lab arrows follow the number; the colour says good or bad. |
| Tracker sign-in | The link lasts 15 minutes again (it was cut to 10). |

## New in this build
- **AI on past days (Sachin's decision):**
  - A member can open yesterday (or any earlier day) and log by Speak / Snap / Type.
  - The button names the day: "Save 2 items to yesterday's log", or "… to the log for Thu 8 Oct".
  - A chat belongs to one day; a review made on one day can't be saved to another.
- **Food source and household portion saved:** "2 rotis" and "Verified food database" now survive the auto-save (before, they read "Nutrition source not recorded").
- **Saves can't hang:** if the phone's offline storage stalls (iOS), the save goes straight to the server after 3 seconds instead of waiting forever.
- **Browser cache stays small:** a member's cached reads keep one copy per page instead of a new copy every 15 minutes. Capped at 150 entries, and cleared when a session has expired at start-up.
- **Lab values with units:** "5.6 %" or "200 mg/dL" are accepted again (they were refused after 14 Oct).
- **AI:** a stray "draft edit" in an ordinary reply no longer throws the log away.
- **Workouts:** the 40-exercise cap on not-started exercises is back, and rows saved by the 10 Oct app keep their program badge.
- **Small screens:** inputs never get wider than a 320 px screen with large text, and scrolled-to items stop clear of the bottom logging bar.

## Kept as the new build designed it
- **AIC-011:** older AI cards keep their own Undo. Each card has a save receipt and undoes only its own change; it refuses rather than touching a newer card's food. (The 10 Oct fix hid Undo on older cards; the new design is safe, and the test now checks exactly that.)
- **WKT-011:** the workout sheet no longer sends notes, and the server keeps them when none are sent, so a blank can't erase them.

## Tests
- **Restored:**
  - the VOI-011/012 block (test-member-apply);
  - MSG-003 (test-morning-nudge);
  - WKT-012 (test-day-lib);
  - the whole known-fixes UI block (ui-tests [37]), adapted to the new screens.
- **New checks** for every item above. Each one fails when its fix is removed (mutation-checked).
- **Changed on purpose:**
  - test-timeline-meal-entry centres the row before tapping, because past days now show the logging bar.
  - The restored UI block uses the new "Save …" button and receipt Undo.
- **Full gate green locally:** 5,500+ assertions, real Postgres, headless Chrome.

## Files (all overwritten in place; nothing renamed or deleted)
New: `DELIVERY-FIXES-2a.md` (this note).
