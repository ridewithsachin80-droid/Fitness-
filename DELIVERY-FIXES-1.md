# Delivery — Fixes 1: the 23 "expected to fail" cases (10 Oct 2026)

**Upload to the `test` branch first.** The test workbook v2 had 23 cases marked "expected to fail". They were found by reading the code on 8 and 10 Oct. All 23 are fixed here, each with an automatic test that fails without the fix.

This zip is checked against GitHub `main` 1ca6ae7, which already has the macros build. It contains only the fixes.

## What was fixed (by test case)

| Case | Was | Now |
|---|---|---|
| TOD-018, MAC-025 | Edits on a past day (water, food, macros…) were never saved — auto-save ran only for today | A past day saves like today, 4 seconds after the edit |
| AIC-029 | The chat said "Apply … to today's log" while writing to the day on screen | Says "to yesterday's log" / "the log for Thu 8 Oct" — wherever it actually writes |
| AIC-011 | Undo on an older chat card undid the NEWER one | Only the latest card has Undo/Edit; older cards say "tell me to change it" |
| VOI-011 | Hands-free / phone-shortcut weight, water and sleep were never saved | Saved (the 20–300 kg check still applies) |
| VOI-012 | Voice food always went under the first meal (Breakfast) | The meal due now — same rule as the app: a planned meal within 2½ h, else by time of day |
| VOI-013 | "open workout" / "open food" went to pages that don't exist | Opens the workout / food sheet on Today |
| WKT-011 | Adding a set in the workout sheet erased the session notes (e.g. what the AI chat wrote) | Notes kept; an older app that sends no notes also keeps them |
| WKT-012 | A program day pulled in but not started vanished on reopening | Still listed, still swappable |
| PRG-007 | Progress → "Your diet plan, PDF and grocery list" opened Plan on Today | Opens on Nutrition |
| LAB-004 | A value was only flagged when BOTH limits were entered ("< 200" printed ranges never flagged) | One limit is enough — member and coach entry; shown as "≤ 200" / "≥ 40" |
| LAB-005 | Vitamin D rising 20 → 35 (good) showed "↓" | The arrow follows the number (↑), colour says good (gold) or bad (amber) |
| CMP-010 | Coach "⚖️ Log Weight" did nothing | Opens the weight form; saves |
| CMP-011 | Coach Training → "+ Create"/"Edit" did nothing | Opens the program builder |
| ADM-017 | Weight and ACV reminder editors were titled "🏃 Activity" | Each titled for its own type |
| ADM-021 | Food ✏️/🗑 only appeared on mouse hover — unreachable on a phone | Always visible on touch screens |
| ADM-022 | "NO LOG" used the UTC date — wrong 00:00–05:30 IST | India's date |
| MSG-003 | 06:30 message ignored a member's WhatsApp switch | WhatsApp only if left on; otherwise push |
| UI-012 | "Connect Fitbit" after ~15 min showed `{"error":"Token expired"}` | Sign-in renewed first; if it has truly run out, says so in words |
| UI-014 | Devices tile promised "HART, Garmin, Apple Watch, Samsung & more" | "Fitbit, WHOOP and Polar" |
| SET-006 | Every launch reset text size, nutrition display, age group and avatar | The setup answers only set up a NEW device; Settings choices stay |
| ONB-005 | Hint said "tap to reorder"; tapping un-picks | Hint now says what tapping does (see below) |
| MAC-014 | "N kcal under target" — the number was against estimated burn, not the target | "N kcal below / above estimated burn" |

**Also fixed (found while doing UI-012):** the tracker sign-in "state" was plain text naming the member. Anyone could craft one and attach their own Fitbit/WHOOP/Polar account to another member's day. It is now signed, lasts 15 minutes, and is checked against the provider.

## Two choices made — tell me if you want them the other way
1. **ONB-005: I fixed the hint, not the behaviour.** Tapping a picked goal still un-picks it. Tapping it again puts it at the end. The hint now says exactly that. Real drag-to-reorder is a bigger change for a one-time setup screen.
2. **AIC-011: older cards lose Undo instead of undoing selectively.** Undoing card A after B would mean picking A's items out of a day that B has since changed. "Tell me what to change" is safer and already works.

## Not fully testable until later
- **MSG-003:** only matters once WhatsApp Business is switched on (keys set). Tested with a stand-in.
- **UI-012:** tested with a stand-in for the sign-in renewal. Check on a phone after 20 minutes in the app.

## Files

### New (4) — all added, nothing renamed
| Destination | What |
|---|---|
| `server/services/mealSlot.js` | "Which meal is due now" for voice logs (same rule as the app) |
| `client/src/components/coach/WeightEntryModal.jsx` | The coach weight form, moved out of Monitor.jsx and now mounted |
| `server/scripts/test-known-fixes.js` | New DB suite: workouts, labs, tracker sign-in (26 checks) |
| `DELIVERY-FIXES-1.md` | This note |

### Changed
- **Server:**
  - `server/db/schema.sql`: `workout_sessions.pending_exercises` (ADD COLUMN IF NOT EXISTS; runs on boot).
  - `server/routes/workouts.js`, `server/routes/patients.js`, `server/routes/trackers.js`
  - `server/services/memberLogApply.js`, `server/services/labAnalysis.js`, `server/services/digests.js`
- **Client:**
  - `client/src/utils/workoutSession.js` (`doneExercises`), `client/src/components/WorkoutSessionViewer.jsx` — Today's Move row and the coach's session view count only exercises with a done set, so a not-started program day is not shown as logged
  - `client/src/hooks/useTodayModel.js`, `client/src/App.jsx`, `client/src/utils/voiceCommands.js`, `client/src/utils/chatCard.js`
  - `client/src/components/AIChatLog.jsx`, `client/src/components/WorkoutLog.jsx`, `client/src/components/LabResults.jsx`
  - `client/src/components/AdminReminders.jsx`, `client/src/components/Onboarding.jsx`, `client/src/components/today/TodaysPlan.jsx`
  - `client/src/pages/Monitor.jsx`, `client/src/pages/Plan.jsx`, `client/src/pages/Progress.jsx`, `client/src/pages/AdminFoods.jsx`, `client/src/pages/AdminDashboard.jsx`, `client/src/pages/DeviceConnect.jsx`, `client/src/pages/Settings.jsx`
  - `client/src/api/trackers.js`
- **Tests:**
  - `server/scripts/test-local.sh`
  - `server/scripts/test-member-apply.js`, `server/scripts/test-morning-nudge.js`, `server/scripts/test-day-lib.js`
  - `server/scripts/test-journey.js`: one check updated on purpose — a 0-rep set is still discarded, but the exercise now stays listed (WKT-012)
  - `server/scripts/ui-tests.mjs` (new block [37], 28 checks)

## QA
- The full gate is green: **3,949 assertions** (3,874 before). That covers the client build, all logic and database suites on a real Postgres, lint, and 833 UI checks in jsdom plus headless Chrome at phone widths.
- Every fix was mutation-checked: putting the bug back makes a test fail. 26 of 28 mutations were caught directly; MAC-014 is caught by the Today test.
- One mutation can't be caught on screen by design: the extra owner check on Undo. Since older cards no longer show the button, it can't be reached.
- New workbook: **FitLife-Test-Cases-v3.xlsx**.
  - The 23 cases are now regression cases (Since = "Fixes 10 Oct"), with no expected-to-fail cases left.
  - Two cases were added: tracker sign-in forging, and a smoke check for this build.
