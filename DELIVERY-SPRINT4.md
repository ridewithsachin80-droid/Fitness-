# Sprint 4 delivery — the AI is on the page

**The AI-first moment.** The chat is no longer a full-screen overlay behind the ✨ orb. The
conversation is a card on Today, and the composer (text · lab report · camera · mic · send)
is docked just above the bottom nav on every scroll position. A member can log a whole day
without opening a single sheet.

Gate: **1,951 assertions green** (Sprint 3: 1,920 · Sprint 0: 1,802 · your original zip: 1,710).
Only `test-twa-contract` is red — it reads `android/.gitignore`, a dotfile the uploaded zip
does not contain. Please confirm it exists on GitHub.

This zip is **cumulative** (Sprints 0 + 3 + 4, 96 files). It supersedes every earlier zip.
Upload the whole thing and overwrite.

## Upload — every file, exact destination (drag-drop onto GitHub, overwrite)

Root of the repo is `Fitness--main/`. Nothing renamed, nothing deleted.

### NEW in this sprint (flagged)
| Deliver as | Destination |
|---|---|
| `DELIVERY-SPRINT4.md` | `Fitness--main/DELIVERY-SPRINT4.md` |
| `client/src/hooks/useKeyboardInset.js` | `Fitness--main/client/src/hooks/useKeyboardInset.js` |

### NEW from Sprints 0 and 3 (still flagged — they are in this zip)
`client/src/pages/Today.jsx` · `client/src/pages/DevKit.jsx` · `client/src/hooks/useTodayModel.js` ·
`client/src/components/today/` (10 files) · `client/src/components/sheets/` (8 files) ·
`client/src/components/primitives/` (10 files) · `client/src/lib/day/` (6 files) ·
`server/scripts/lib/class-map.json` · `server/scripts/lib/sweep-classes.js` ·
`server/scripts/test-day-lib.js` · `DELIVERY-SPRINT0.md` · `DELIVERY-SPRINT3.md`

### Overwritten in this sprint
- `client/index.html` — viewport meta gains `interactive-widget=resizes-content` (Android keyboard)
- `client/src/components/AIChatLog.jsx` — overlay removed; thread renders inline; composer portaled and docked
- `client/src/components/today/MilestoneModal.jsx` — `aria-label` so tests can tell it from a sheet
- `client/src/hooks/useTodayModel.js` — workout refresh keyed on `lastAppliedAt`; `openChat()` closes any sheet
- `client/src/pages/Today.jsx` — thread card below the timeline; bottom padding for the docked bar
- `server/scripts/ui-tests.mjs`, `server/scripts/test-layout-contracts.js`

### Overwritten from Sprints 0 and 3 (unchanged since, still in the zip)
`client/src/pages/DailyLog.jsx` (20-line wrapper) · `client/src/pages/Profile.jsx` · `client/src/App.jsx` ·
`client/src/components/UI.jsx` · `client/src/index.css` · `client/tailwind.config.js` ·
`client/package.json` · `client/package-lock.json` · 36 other swept `client/src/**/*.jsx` ·
`server/scripts/test-local.sh`

No schema, route or server-runtime file is touched in Sprints 0, 3 or 4.

## What members see

Below "Today so far" there is now a **FitLife AI** card: the greeting message, then the
conversation as it grows — member bubbles, AI replies, the preview with "Apply N items to
today", then "Applied & saved" with Edit and Undo. Suggestion chips show while the
conversation is empty.

At the bottom of the screen, above the nav, a glass bar: **"Tell me about your day…"** with
lab-report, camera and mic buttons and a gold send. It stays there while you scroll. It rises
with the keyboard on Android (viewport meta) and on iOS (visualViewport inset).

The ✨ orb still exists. Tapping it — or Today's read, or the timeline's "Log with AI", or a
sheet's "Log with AI Chat" banner — now closes any open sheet, scrolls the conversation into
view and puts the cursor in the composer. From Progress/Profile/Settings the orb navigates to
Today first, as before.

After Apply, the hero weight, the chips, the dots and the timeline update in place — no
reload — and the Workout sheet remounts so it never shows sets the AI just wrote as stale.

## Deliberate deviation from the plan

The sprint plan listed `GET /api/logs/me/read` (Today's read computed server-side). Not
built here, on purpose. The client's `dailyRead()` already produces the read from tested
`lib/day` inputs; a second server implementation now would be two definitions that drift —
the exact pattern this codebase has paid for before (two `calcBMR`s, two calorie sums). It
moves to Sprint 9, where the `ai_reads` cache is built and the server version *replaces*
the client one for Today, WhatsApp and push at once.

## How it was verified

- **jsdom (the real `DailyLog` route, API stubbed):** thread on the page and no overlay
  element; composer portaled to `<body>`, fixed, with all four controls; `openChat()` closes
  an open water sheet and focuses the input; a second `openChat()` bumps the counter;
  Enter sends "drank 500ml water, took b12, weight 82.0" → member bubble + AI reply →
  "Apply 3 items to today" → weight 82, +500 ml and the B12 tick in the store → "Applied &
  saved" with Undo → `lastAppliedAt` stamped → hero, chips and dots reflect the new day
  without a reload → the final debounced POST carries the applied day plus a later edit.
- **Real Chrome at 320/360/390 px:** the composer is inside the viewport above the nav;
  scrolled to the very end, the notes card clears the composer (the page bottom is
  reachable); the food and protocol sheets still open and close; no sideways scroll anywhere.
  Screenshots: `today-360.png`, `today-360-bottom.png`, `today-360-food-sheet.png`,
  `today-360-protocol-sheet.png`.
- **Source contracts [10]:** no `fixed inset-0` in AIChatLog; composer portal + `COMPOSER_BOTTOM_PX`;
  `focusRequest` counter; `markApplied()` + `lastAppliedAt`; sheet closes on focus request;
  Today renders the thread inside a Card; viewport meta; keyboard-inset hook.
- Two harness bugs found and fixed while doing this (both in the test, not the product):
  `html { scroll-behavior: smooth }` made a scroll-then-measure read mid-animation; and at
  320 px the wrapped header pushes the day strip under the docked composer, so a bare tap hit
  the composer — the harness now scrolls a target into view first, as a thumb would.

## Known and deferred
- `GET /logs/me/read` → Sprint 9 (see above).
- `MacroProgress` inside the food sheet is still a card-in-a-sheet; restyled with the
  widgets in Sprint 5.
- Grey consolidation on screens not yet redesigned — Sprints 5–7.
