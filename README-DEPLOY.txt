FitLife — audit fixes
=====================

IMPORTANT: if you are deploying "fitlife-features-1-5.zip", you do NOT need
this zip. That bundle already contains every fix below, plus the new features.
Use one or the other, not both.

Extract, drag the "client" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change.

FILES (4)
client/src/pages/DailyLog.jsx          CRASH FIX - restores QUICK_MICRO_KEYS
client/src/components/WorkoutLog.jsx   duration moved above cardio
client/src/components/FoodLog.jsx      removes duplicate 'coconut water' key
client/src/api/logs.js                 corrects two wrong AI-food API paths

CRITICAL: DailyLog.jsx fixes a white-screen crash. Any member who had macro
targets set AND food logged would hit "QUICK_MICRO_KEYS is not defined" and
see a blank Today page.

NOTE ON DailyLog.jsx
This file is the current version, so it also contains the personal-best
milestone from the features build. That code calls GET /api/workouts/summary,
which only exists if you also deploy the server files from the features zip.
Without them the call fails silently (it is wrapped in a catch) and the rest
of the page works normally - but this is why deploying the features zip
instead is the cleaner path.

OPTIONAL CLEANUP (not included)
client/src/app.js is 2,033 lines of dead pre-React code. Nothing imports it.
Safe to delete.
