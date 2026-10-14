# Phase 6 — direct meal entry

Tapping a meal in Logged today (or Logged that day) opens the existing food editor at that meal. Its heading receives focus, and Tab proceeds to its controls. The entire editor, other meals, search, presets, macros and removal remain available. The daily Food summary keeps its general editor entry.

Targets carry the original meal value rather than a CSS selector or guessed display label. Existing FoodLog grouping resolves case differences, custom names and blank meals. The navigation target is scoped to the member and selected date, and is cleared by a general sheet launch or close. Opening a meal does not write food or change the selected day.

The reusable Sheet can receive an optional initial focus ref. It positions the content once after applying viewport height, avoiding scroll jumps during later edits. Other sheets retain their existing focus behavior.

Baseline: local 039a6a6, GitHub test 7270b98 (CI66: 86 suites / 5,352 assertions). This baseline result does not certify this release. Current exact-commit tests and deployment evidence belong in the regression workbook and ZIP.

## Acceptance

UAT238: selected meal, full editor and general entry.
UAT239: custom/unsorted meals, keyboard focus and return.
UAT240: past date, stale target and physical-device acceptance.

Real Chromium tests mount Today, its actual model, Timeline, Sheet and FoodLog against synthetic API data. Both themes and 390/1280px widths are covered. Physical phones and screen readers need separate acceptance.

## Pending

- Finish physical-device and remaining manual acceptance, including photo/voice and offline/account switching.
- Next feature increment: useful advice alongside mixed AI logging requests, keeping logging status and totals deterministic.
- Remaining backend reliability: atomic workout conflicts; idempotent/reversible lab and body-metric records.
- Account-safe cold-start offline design and bounded private-cache lifecycle.
- Remaining accessibility/staff modal work, focused workout presentation, reminder consolidation and member pilot.

No database migration or environment changes. Install changed files in their existing repository paths on the stated baseline; preserve older hashed assets for running clients.
