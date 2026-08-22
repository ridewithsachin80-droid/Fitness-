FitLife — everything from today, in one deploy
==============================================

Extract, drag the "client" and "server" FOLDERS onto GitHub at the ROOT of
your repo (the level with DEPLOY.md, build.sh, client, server).

ONE RENAME: server/server-package.json  ->  package.json   (inside server/)

No new npm packages. schema.sql adds tables and columns, and re-runs safely -
verified by dropping the schema entirely and rebuilding from empty.

This supersedes every zip sent today. Deploying this one alone is enough.


FOLDER STRUCTURE
----------------
client/
  src/
    index.css                        orb breathing animation
    components/
      AIChatLog.jsx                  photo food logging, lab PDF reader,
                                     editable portions, camera + document buttons
      LabResults.jsx            NEW  member lab entry + interval analysis
      MacroLab.jsx              NEW  adherence + controlled trials (coach only)
      MetabolicInsight.jsx      NEW  measured metabolism, learned model,
                                     clinic-wide calibration
      UI.jsx                         AI orb in the bottom nav
    pages/
      DailyLog.jsx                   Today's read, serif numerals, streak context,
                                     nutrition tile, all panels inside the hero
      Monitor.jsx                    coach: metabolic insight, macro lab, labs,
                                     training summary
      Profile.jsx                    member: labs, portion memory, metabolism
    utils/
      dailyRead.js              NEW  the daily coaching sentence (17 branches)

server/
  db/
    schema.sql                       member_portions, macro_trials, lab_values
                                     columns, cardio column, food backfills
  routes/
    aiChat.js                        lab-report reader, photo, portions,
                                     food learning, weekly summary
    patients.js                      labs, lab-analysis, adaptive, model,
                                     population prior, adherence, trial
  services/
    adaptiveEngine.js         NEW    true maintenance calories from weight response
    labAnalysis.js            NEW    lab interval comparison
    learningModel.js          NEW    multivariate weekly regression
    macroLab.js               NEW    adherence + trial comparison
  scripts/
    seed-nin-india.js                two corrected foods
    validate-foods.js         NEW    nutrition data validator
    test-adaptive.js          NEW    26 assertions
    test-food-learning.js     NEW    16
    test-food-lookup.js       NEW    23
    test-labs.js              NEW    37
    test-learning-model.js    NEW    25
    test-macrolab.js          NEW    26
    test-portion-memory.js    NEW    14
  server-package.json              -> RENAME to package.json


AUDIT RESULTS
-------------
I checked specifically for the gaps you asked about.

TWO REAL GAPS FOUND AND FIXED:

1. Portion memory was invisible to members.
   The app was learning their katori and glass sizes from AI-chat corrections
   and feeding them back into every prompt - but nothing showed it. Invisible
   personalisation is indistinguishable from the app guessing, so it earns no
   trust. Profile now has a "Your Portion Sizes" card listing every learned
   phrase, its weight, and how many corrections it came from.

2. The clinic-wide calibration was computed but never shown.
   Every well-measured member contributes to a correction factor for the
   standard formula, and new members inherit it - but a coach could only see
   its effect, never the number. The Metabolic Insight card now shows
   "the standard formula runs N% low for your members", or explains that three
   calibrated members are needed before it activates.

CLEAN ON EVERYTHING ELSE:
  · all 4 new components mounted on the right pages
  · all 16 new endpoints called from the client (both gaps above were the only
    orphans)
  · no shadowed routes - the '/:id' vs literal-path trap that bit three times
    today is now absent across every route file
  · 19 server modules load without error
  · schema drops and rebuilds from empty with zero errors
  · 0 lint errors in every file changed today
  · production build clean, no warnings

Nine pre-existing lint warnings remain elsewhere (AIFoodSearch, FoodLog,
AdminDashboard) - all are references inside callbacks that run after mount, so
they are safe. Untouched deliberately.


TESTS
-----
  cd server
  npm run test:adaptive test:macrolab test:model test:labs
  npm run test:foods test:learning test:portions
  npm run validate:foods

284 assertions across ten suites, all passing on a database built from scratch.


REQUIRES
--------
GEMINI_API_KEY must be set in Railway for photo food logging and lab report
reading. Groq's text models cannot read images or documents.
