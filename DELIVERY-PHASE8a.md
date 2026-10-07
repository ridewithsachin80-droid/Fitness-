# Delivery: Phase 8, part 1 — Progress in four groups — 6 Oct 2026

Built on the `main` ZIP uploaded on 6 Oct 2026 (with the audit fixes). This
zip holds only the files changed against that upload. Upload to `test`, wait
for green, try it on fitness-test.up.railway.app, then merge.

## What changed

The member's **Progress** page now has four tabs under the weight hero:

| Tab | What is in it |
|---|---|
| **Body** (opens first) | Progress photos; BMI and kg to goal; Your Journey; latest lab values |
| **Nutrition** | 7-day nutrition trend; a link to the diet plan, its PDF and grocery list |
| **Training** | Training trends, strength progress, muscle coverage |
| **Reports** | The weekly report; streak, 30-day compliance, days logged; the 30-day grid; log history |

- The weight, journey line and trend chart stay above the tabs on every tab.
- The tab bar stays in view while scrolling.
- The open tab is kept in the address (`/progress?tab=training`), so Back and
  a refresh return to it, and other screens can link straight to one.
- Nothing was removed: every section is on exactly one tab (a test checks it).
  The only new thing is the "To goal" box next to BMI.

## Files

Changed (2): `client/src/pages/Progress.jsx`, `server/scripts/ui-tests.mjs`.
New (1): `DELIVERY-PHASE8a.md`.

## Gate

- 3,386 checks green in one full run on this baseline, including real Chrome.
- The Progress page test now checks the four tabs, which sections each holds,
  that each section appears once, and the 360 px screenshot.

## Not in this part

- **Kannada-English voice pilot:** needs recordings from 5 to 10 members first.
- **Visual polish:** waiting for a list of what to change.
- **Stray folders in the repo** (`server/client/`, `server/server/`, and
  `server/DELIVERY-PHASE1.3.md`): old copies uploaded into the wrong folder.
  Never loaded, but drag-drop cannot delete them: remove them in GitHub by hand
  (open each file, "Delete file"), or leave them.
