FitLife deploy — cardio via AI, protocol = compliance only, calories in workout
==============================================================================

Extract, then drag the "client" and "server" FOLDERS onto GitHub at the ROOT
of your repo (the level with DEPLOY.md, build.sh, client, server).
GitHub preserves paths, so all 10 files land correctly in one commit.

NOTHING TO RENAME. No new npm packages. schema.sql re-runs safely.

FILES (10)
client/src/utils/exerciseCalories.js     shared calorie model
client/src/components/WorkoutLog.jsx     cardio UI + calories burned card
client/src/components/AIChatLog.jsx      AI writes cardio into workout log
client/src/pages/DailyLog.jsx            workout tile shows kcal; protocol = ticks
client/src/pages/Profile.jsx             TDEE uses workout log only
server/routes/aiChat.js                  AI extracts cardio type/speed/distance
server/routes/workouts.js                cardio save/load + validation
server/routes/patients.js                /me returns sets + cardio
server/db/schema.sql                     cardio column (idempotent)
server/scripts/test-cardio.js            regression test (optional)

WHAT CHANGED IN BEHAVIOUR
- "5 km walk in 1 hour" in AI chat now creates a real cardio row in the
  Workout log AND ticks the matching protocol activity.
- Protocol chips no longer show kcal. They are a compliance checklist.
- ALL exercise calories come from the Workout log (strength by volume,
  cardio by MET x time). This removes the double-count where a walk was
  billed once as a protocol tick and again as cardio.
- Hero "workout" tile now shows calories burned instead of exercise count.

AFTER DEPLOYING
1. Reopen the app twice so the service worker updates.
2. Try: "5 km walk in 1 hour" in AI chat -> check Workout log cardio section.
