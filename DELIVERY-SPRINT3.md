# Sprint 3 delivery — the new Today screen

**The first visible change.** The member home is rebuilt as one scrolling surface with
bottom sheets for every logging action. Every number, save path and rule from the old page
is preserved — the container logic was moved line-for-line, not rewritten.

Gate: **1,920 assertions green** (was 1,802 after Sprint 0; 1,710 on your original zip).
The only red suite is `test-twa-contract`, which reads `android/.gitignore` — a dotfile the
uploaded zip does not contain. Please confirm it exists on GitHub.

This zip is **cumulative**: it contains Sprint 0 and Sprint 3. Upload the whole thing; it
supersedes `FitLife-Sprint0.zip`.

## Upload — every file, exact destination (drag-drop onto GitHub, overwrite)

Root of the repo is `Fitness--main/`. Nothing renamed, nothing deleted.

### NEW files (flagged)
| Deliver as | Destination |
|---|---|
| `DELIVERY-SPRINT0.md`, `DELIVERY-SPRINT3.md` | `Fitness--main/` |
| `client/src/pages/Today.jsx` | `Fitness--main/client/src/pages/Today.jsx` |
| `client/src/pages/DevKit.jsx` | `Fitness--main/client/src/pages/DevKit.jsx` (dev only, not in the production build) |
| `client/src/hooks/useTodayModel.js` | `Fitness--main/client/src/hooks/useTodayModel.js` |
| `client/src/components/today/` — `Greeting.jsx`, `DateNav.jsx`, `AIRead.jsx`, `ProtocolDots.jsx`, `DayStrip.jsx`, `Timeline.jsx`, `CoachCard.jsx`, `CoachNotes.jsx`, `MilestoneModal.jsx`, `DayWidgets.jsx` | `Fitness--main/client/src/components/today/` (new folder) |
| `client/src/components/sheets/` — `index.js`, `WeightSheet.jsx`, `WaterSheet.jsx`, `SleepSheet.jsx`, `ProtocolSheet.jsx`, `FoodSheet.jsx`, `WorkoutSheet.jsx`, `NutritionSheet.jsx` | `Fitness--main/client/src/components/sheets/` (new folder) |
| `client/src/components/primitives/` (10 files, from Sprint 0) | `Fitness--main/client/src/components/primitives/` |
| `client/src/lib/day/` (6 files, from Sprint 0) | `Fitness--main/client/src/lib/day/` |
| `server/scripts/lib/class-map.json`, `sweep-classes.js`, `server/scripts/test-day-lib.js` (Sprint 0) | `Fitness--main/server/scripts/…` |

### Overwritten files
- `client/src/pages/DailyLog.jsx` — now a 20-line wrapper that renders `Today` (route and filename unchanged)
- `client/src/pages/Profile.jsx`, `client/src/App.jsx`, `client/src/components/UI.jsx`, `client/src/index.css`, `client/tailwind.config.js`, `client/package.json`, `client/package-lock.json` — Sprint 0
- 37 other `client/src/**/*.jsx` — Sprint 0 token sweep
- `server/scripts/test-layout-contracts.js` — sections [8] tokens and [9] Today structure
- `server/scripts/ui-tests.mjs` — sections [5] primitives, [6] Today in jsdom, [8] Today in real Chrome
- `server/scripts/test-day-lib.js`, `server/scripts/test-local.sh`

No schema, route or server-runtime file is touched.

## What members see

Reading order, top to bottom: greeting with avatar and streak badge → ‹ Today › →
**this morning's weight, large, in Fraunces, with ↓/↑ vs yesterday** → *Today's read* (tap
opens the AI chat) → protocol dots (one per item, gold when done) → deficit/surplus chip →
the day strip (Food · Water · Sleep · Workout · Nutrition, scrolls sideways) → From your
coach today → **Today so far** (weight, each meal with its kcal, workout, water, sleep — every
row tappable) → streak card → coach messages with reply → fasting → notes.

Every logging action is a bottom sheet: slides up on a spring, drag down or Escape or Done
to close, stays above the keyboard, locks page scroll behind it. Tap the hero weight →
weight sheet. Tap a chip → its sheet. Tap the dots → protocol sheet. The ✨ orb still opens
the AI chat exactly as before (Sprint 4 docks a composer on the page).

Nothing was removed: the coach card rules (pending-only), PWA shortcuts (`?open=ai`,
`?open=weight`), auto-ticks from the Workout log, weight sanity warning, the ACV note,
long-press chip timings, the milestone celebration, past-day editing, the "Welcome to
FitLife" card before a protocol exists, the child/senior copy variants.

## One real bug fixed

Tick a supplement, press ‹ within four seconds to look at yesterday. The 4-second auto-save
fired AFTER the store had switched to yesterday's log, so it posted yesterday's data and the
tick was gone. The model now flushes a pending save before any date change. The jsdom
flow proves it: with the fix removed, the only POST carries `b12: false` and the old wake
time.

## How it was verified

- **jsdom (60 assertions):** the real `DailyLog` route mounts with the API stubbed; every
  chip opens its sheet; +500 ml writes to the store and the chip behind the sheet updates;
  weight warning appears at 350 kg and clears at 82.1; B12 tick becomes "4 of 5"; AUTO chip
  explains instead of ticking; wake time recomputes 6h 30m; ‹ loads yesterday with only a
  weight row; Jump to today returns; the debounce fires exactly one POST after 4 s with the
  accumulated edits.
- **Real Chrome (19 assertions):** `npm run test:ui:install` (puppeteer-core +
  @sparticuz/chromium from npm) works in a sandbox, so Today rendered at 320/360/390 px
  with the built stylesheet: no sideways scroll, none with the food sheet or protocol sheet
  open, Escape closes. Screenshots land in `/tmp/fitlife-shots/`. Without the browser
  installed this section prints "NOT RUN" and the rest of the gate still runs.
- **Source contracts:** `Today.jsx` has no fetches or state of its own; the model still owns
  the shortcuts, the visibility-change flush and additive-only auto-ticks; the day strip
  scrolls inside its own box; sheet z-index sits above the nav and below the milestone
  modal; all seven sheets hang off the single `sheet` value.
- Every new assertion mutation-checked.

## Known and deferred
- `MacroProgress` inside the food sheet is a card inside a sheet. Works; restyled in
  Sprint 5 with the other widgets.
- No language setting exists in the app, so the greeting is English only. Hinglish appears
  where the copy already carried it.
- Grey consolidation (Sprint 0 note) still pending for screens not yet redesigned.
