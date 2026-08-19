FitLife — deploy batch (volume-based strength calories + cardio logging)
=======================================================================

The folders below mirror your repo exactly. Extract this zip, then drag the
"client" and "server" folders onto GitHub at the ROOT of your repo
(Fitness--main). GitHub keeps the folder paths, so each file lands in the
right place and replaces the existing one.

FILES IN THIS BATCH (8)
-----------------------
client/src/utils/exerciseCalories.js      NEW  shared calorie model
client/src/components/WorkoutLog.jsx      replace  cardio UI + calories card
client/src/pages/DailyLog.jsx             replace  hero chip uses new model
client/src/pages/Profile.jsx              replace  TDEE uses new model
server/routes/workouts.js                 replace  cardio save/load + validation
server/routes/patients.js                 replace  /me returns sets + cardio
server/db/schema.sql                      replace  adds cardio column (idempotent)
server/scripts/test-cardio.js             NEW  regression test (optional)

NOTHING TO RENAME in this batch.
No new npm packages. No manual migration — schema.sql re-runs safely on deploy.

AFTER DEPLOYING
---------------
1. Hard-refresh / reopen the app twice so the service worker picks up the
   new bundle.
2. Open a member's Workout log -> "+ Add cardio" to test.
3. Session duration no longer affects calories. Subramanya's stale 240 is
   harmless, but worth clearing.
