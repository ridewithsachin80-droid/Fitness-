FitLife — Nutrition gets its own hero tile
==========================================

1 FILE. Extract, drag the "client" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change.

client/src/pages/DailyLog.jsx

WHAT CHANGED
- New 7th hero tile: "🔬 NUTRITION", full width under Sleep. Shows how many
  micro-nutrient targets are met, e.g. "20 / 31 targets met".
- Nutrition Summary moved OUT of the food panel into its own panel. It was 31
  nutrient rows sitting under the food log, which buried the food entries
  themselves - you had to scroll past everything to get back.
- Before logging any food the tile reads "— log food first" and the panel
  explains that vitamins are calculated from what you eat.

IMPLEMENTATION NOTE
The tile count and the panel now share one helper (countMicrosMet) and one set
of nutrient key lists, so the badge and the panel can never drift apart.
Upper-limit nutrients like sodium count as MET while under the cap, matching
the panel's existing colour logic.
