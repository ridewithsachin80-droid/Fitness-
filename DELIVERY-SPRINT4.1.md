# Sprint 4.1 — day tiles as a grid (from your screenshot, 7 Sep)

**Change:** the Food · Water · Sleep · Workout · Nutrition row no longer scrolls sideways.
It is a fixed two-column grid — four tiles, each with a thin progress bar (kcal vs target,
water vs target, sleep vs 8 h) — and Nutrition as one full-width row with its own bar.
Everything is visible at once; nothing to swipe or discover.

Gate: **1,952 assertions green**; `test-twa-contract` still red for the `android/.gitignore`
reason. This zip is **cumulative** (Sprints 0 + 3 + 4 + 4.1) and supersedes all earlier zips.

## Files changed in 4.1 (overwrite)
| File | Destination |
|---|---|
| `client/src/components/today/DayStrip.jsx` | `Fitness--main/client/src/components/today/DayStrip.jsx` (same file name — it is the grid now) |
| `server/scripts/test-layout-contracts.js` | `Fitness--main/server/scripts/test-layout-contracts.js` |
| `server/scripts/ui-tests.mjs` | `Fitness--main/server/scripts/ui-tests.mjs` |
| `DELIVERY-SPRINT4.1.md` | `Fitness--main/DELIVERY-SPRINT4.1.md` (NEW) |

Everything else in the zip is unchanged from `DELIVERY-SPRINT4.md`.

## Verified
- Contract: the strip is `grid grid-cols-2`, has no `overflow-x-auto` / `snap-x`, and each
  tile with a target draws a bar.
- jsdom: all five tiles render in the grid, values unchanged (666 / 1,800 kcal, 1.5 / 3.0 L,
  7h 45m, program day, N / 31 targets).
- Real Chrome at 320/360/390 px: no sideways scroll; screenshots re-taken and checked by eye.
