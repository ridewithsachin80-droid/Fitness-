FitLife deploy — workout log is the source of truth for exercise
================================================================

Extract, then drag the "client" and "server" FOLDERS onto GitHub at the ROOT
of your repo (the level with DEPLOY.md, build.sh, client, server).
GitHub preserves paths, so all 10 files land correctly in one commit.

NOTHING TO RENAME. No new npm packages. schema.sql re-runs safely.

WHAT CHANGED
- Protocol "Morning Walk" and "Resistance Training" are now READ-ONLY and
  tick themselves from the Workout log:
    walk       <- any walking / running / stairs cardio
    resistance <- any strength set logged
  They show an AUTO badge; tapping explains where the tick comes from.
- Sunlight and Post-Meal Steps stay manually tappable (they cannot be derived
  from workout data - see note below).
- All exercise calories come from the Workout log only. Protocol ticks no
  longer add calories, removing the double-count.
- AI chat: "5 km walk in 1 hour" creates a real cardio row AND ticks the walk.
- Hero workout tile shows calories burned.

FILES (10)
client/src/utils/exerciseCalories.js     shared calorie model
client/src/components/WorkoutLog.jsx     cardio UI + calories burned card
client/src/components/AIChatLog.jsx      AI writes cardio into workout log
client/src/pages/DailyLog.jsx            auto-ticks, read-only chips, kcal tile
client/src/pages/Profile.jsx             TDEE from workout log only
server/routes/aiChat.js                  AI extracts cardio type/speed/distance
server/routes/workouts.js                cardio save/load + validation
server/routes/patients.js                /me returns sets + cardio
server/db/schema.sql                     cardio column (idempotent)
server/scripts/test-cardio.js            regression test (optional)

AFTER DEPLOYING
1. Reopen the app twice so the service worker updates.
2. Test: log a walk in AI chat -> Workout log shows cardio, protocol walk
   ticks itself and cannot be tapped off.
