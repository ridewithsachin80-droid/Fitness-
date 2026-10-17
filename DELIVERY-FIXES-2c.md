# Delivery — Fixes 2c: last gold removed, over-target amber back, gate reports (17 Oct 2026)

Pushed to the **test** branch on top of Fixes 2b.

## Why this was needed
- **The test site was serving the 15 Oct build until 17 Oct.** The test service serves the compiled app committed in `client/dist`, and Fixes 2a and 2b had pushed only the source.
  - 17 Oct (764a39f): the compiled app was shipped and checked on the live test site.
  - **From now on, every client change commits `client/dist`** (`git add --ignore-removal client/dist`, which adds and overwrites only).
- While writing test workbook v4, the old light gold (`#e0c98a`) turned up in four places. The 16 Oct "no gold" check missed it because it matched a fixed list of colour codes.

## What changed
- **Food sheet:** the dot before each food's numbers is green, or amber or red against the calorie target, not gold. The grey numbers beside it use the theme's text colour; they were 3.2:1 on light.
- **Progress → Nutrition:**
  - calorie bars and the calorie-target line use the brand colour in both themes;
  - carbs moved from mustard (it read as the old gold) to burnt orange, still distinct from protein (blue) and fat (pink).
- **Connected devices:** HRV is shown in violet, not gold.
- **Coach AI voice review:** uses the theme colour, not gold.
- **Today:** a macro over the coach's target turns its number and bar amber again, as production's Eat row did (MAC-003). The redesign had dropped this.
- **Test gate on GitHub:** a failed suite is now also written as a GitHub annotation. The job log cannot be read from the build workspace; annotations can. Output only, no checks changed.

## Tests
- **New, all strengthening (none weakened):**
  - test-layout-contracts finds gold by **hue**, not by a list. It also checks that it recognises the old golds and passes the greens.
  - ui-tests [38] checks that an over-target macro is marked amber and the others are not.
- Both new checks were mutation-checked: each fails when its fix is removed.
- **Full gate green locally:** 5,722 assertions (real Postgres, client build, headless Chrome at phone widths in both themes).
- **Visual check:** a production-mode copy at 390 px, light and dark, covering Today (over-target fat), the food sheet and Progress → Nutrition.

## Files
- Changed:
  - `client/src/components/food/TrafficBadge.jsx`
  - `client/src/components/member/DailyEssentials.jsx`
  - `client/src/components/member/member.css`
  - `client/src/components/CoachAIChat.jsx`
  - `client/src/pages/Progress.jsx`
  - `client/src/pages/DeviceConnect.jsx`
  - `server/scripts/test-layout-contracts.js`
  - `server/scripts/ui-tests.mjs`
  - `server/scripts/test-local.sh`
  - `client/dist/*` (the compiled app)
- **New:** `DELIVERY-FIXES-2c.md` (this note).
- Nothing renamed or deleted.
