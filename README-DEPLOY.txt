FitLife — hint line removed
===========================

Extract, drag the "client" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change.

FILES (3)
client/src/pages/DailyLog.jsx         removed the "Tap a tile above..." hint
client/src/components/UI.jsx          AI orb in the bottom nav
client/src/components/WorkoutLog.jsx  AI banner in the workout log

WHAT CHANGED
Removed the "Tap a tile above to open it - or tap to tell the AI your whole
day" line. The tiles have chevrons and the orb is visible in the nav, so the
sentence explained something already obvious and pushed Notes further down.

The Today page now goes: hero tiles -> coach message -> macros -> notes.

If UI.jsx and WorkoutLog.jsx are already deployed from the previous batch,
they are identical here - no harm in uploading again.
