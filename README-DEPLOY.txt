FitLife — AI orb in nav, inline AI bar removed
==============================================

Extract, drag the "client" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change.

FILES (3)
client/src/pages/DailyLog.jsx         removed the "Tell me about your day" bar
client/src/components/UI.jsx          AI orb in the bottom nav
client/src/components/WorkoutLog.jsx  AI banner in the workout log

WHAT CHANGED
- Removed the "Tell me about your day…" bar from the Today page. The nav orb
  does the same job and never scrolls away, so the bar was duplicate weight
  taking up prime space right under the hero.
- The empty-state hint now points at the orb: "Tap a tile above to open it -
  or tap ✨ to tell the AI your whole day".

THREE AI ENTRY POINTS REMAIN, each in context
  1. Nav orb          - always visible, works from every member page
  2. Food log banner   - inside the food panel
  3. Workout log banner - inside the workout panel
