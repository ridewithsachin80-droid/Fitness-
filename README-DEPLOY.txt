FitLife deploy — workout log layout fix
=======================================

1 FILE. Extract, then drag the "client" FOLDER onto GitHub at the ROOT of your
repo (the level with DEPLOY.md, build.sh, client, server).

client/src/components/WorkoutLog.jsx   replace

WHAT CHANGED
- "Session duration" was stranded below the Cardio and Calories sections,
  reading as though it belonged to cardio. Moved directly under the strength
  exercises where it applies.
- Relabelled "Time in gym" and marked optional, because it no longer feeds any
  calorie calculation (strength = volume lifted, cardio = MET x time).
- Section order is now: Strength -> Time in gym -> Cardio -> Calories burned
  -> Session notes, so the calories card reads as the summary of everything
  above it.

NOTHING TO RENAME. No new packages. No schema change.
