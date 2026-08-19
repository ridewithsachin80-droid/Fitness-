FitLife — AI chat banner in the workout log
===========================================

1 FILE. Extract, drag the "client" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change.

client/src/components/WorkoutLog.jsx

WHAT CHANGED
- Added the "Log with AI Chat" banner to the workout log, matching the one in
  the food log. Subtitle prompts with workout-specific examples:
  "Bench press 3 sets of 20kg" or "5 km walk in 1 hour".
- Removed the duplicated "Workout Log" title. The hero panel header already
  says "Workout log", so the card repeated it directly underneath.

IT USES THE SAME CHAT INSTANCE
The banner opens the shared AI chat (one mounted instance, opened via a shared
store), so sets and cardio logged there flow into the same session. Closing the
chat bumps the refresh key, so anything the AI logs appears in the workout log
straight away without a manual reload.
