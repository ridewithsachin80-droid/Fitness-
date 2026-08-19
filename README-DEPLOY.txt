FitLife — priority build 1-5 + audit fixes
==========================================

Extract, drag the "client" and "server" FOLDERS onto GitHub at the ROOT of your
repo (the level with DEPLOY.md, build.sh, client, server).

NOTHING TO RENAME. No new npm packages. No schema change.

CRITICAL FIX INCLUDED
DailyLog.jsx repairs a white-screen crash: any member with macro targets set
AND food logged hit "QUICK_MICRO_KEYS is not defined" and saw a blank Today
page. Deploy this regardless of the features below.

WHAT'S NEW
1. Coach sees training data (Monitor page -> "Training Summary")
   Volume lifted, cardio distance/speed, calories burned, per-session history,
   7/30/90 day ranges, personal-best highlighting.
2. Progress page gets training trends (same card, member's own data).
3. Photo food logging - tap the camera icon in AI chat, snap your plate.
   Uses Gemini vision. Client downscales to 1280px before upload.
4. Personal-best milestone - celebrates when today's volume beats every
   previous session. Streak milestones extended to 50 and 100 days.
5. One-tap weekly summary - coach's member menu (the ... button) ->
   "Send weekly summary". Builds the message from real data and sends it as a
   coach note + push. Audit-logged.

ALSO FIXED
- FoodLog: removed duplicate 'coconut water' key (build-log warning)
- api/logs.js: two AI-food helpers pointed at the wrong path
- index.js: body limit 2mb -> 12mb so photo uploads are not rejected

REQUIREMENT FOR PHOTO LOGGING
GEMINI_API_KEY must be set in Railway. Groq's text models cannot see images,
so this feature uses Gemini specifically. If the key is missing the endpoint
returns a clear error rather than failing silently.

OPTIONAL CLEANUP (not included)
client/src/app.js is 2,033 lines of dead pre-React code. Nothing imports it.
Safe to delete.

AFTER DEPLOYING
1. Reopen the app twice so the service worker updates.
2. Coach: open a member -> Training Summary card.
3. Member: AI chat -> camera icon -> photograph a meal.
4. Coach: member ... menu -> Send weekly summary.
