FitLife — audit fixes
=====================

2 FILES. Extract, drag the "client" FOLDER onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change. Server untouched.

client/src/api/logs.js                 <- THIS ONE MATTERS
client/src/components/AIFoodSearch.jsx <- unchanged in effect, included for safety

THE ONE REAL FINDING, AND IT WAS MINE
In an earlier audit I "fixed" two API paths that were not broken.

routes/aiFoods.js is mounted at /api/foods, not /api/ai-foods:

    app.use('/api/foods', aiFoodsRoutes);   // index.js line 60

I inferred the mount path from the filename instead of reading index.js, decided
/foods/ai-identify looked wrong, and changed it to /ai-foods/ai-identify — which
pointed at a route that does not exist. Both helpers in api/logs.js have been
broken since. They are currently unused exports, so nothing failed in production,
but anyone wiring up AI food search would have hit a 404 with no obvious cause.

Reverted to the correct /foods/ path.

I also rewrote the audit script itself. It now parses the real app.use() mounts
from index.js rather than guessing from filenames — the assumption that created
this bug in the first place. Under the corrected script, all 94 client API calls
resolve against all 108 server routes with zero mismatches.

EVERYTHING ELSE CLEAN
  · 24 server modules load without error
  · no shadowed routes — every literal path is declared before its /:id sibling
    (this trap has bitten four times, so it is now checked explicitly)
  · all 6 new components mounted; all 7 new services imported by a route
  · schema drops and rebuilds from empty with zero errors, twice — genuinely
    idempotent
  · 463 assertions across 16 suites, all passing on the rebuilt database
  · nutrition validator: 0 errors across 579 foods
  · production build clean, no warnings

NINE PRE-EXISTING LINT WARNINGS REMAIN, DELIBERATELY UNTOUCHED
AIFoodSearch, FoodLog and AdminDashboard each reference a setter before its
declaration. I checked each one: all are inside useEffect or event handlers,
which run after mount, so the constant exists by the time it is read. Left alone.
