FitLife — the app now learns from every entry
=============================================

Extract, drag the "client" and "server" FOLDERS onto GitHub at the ROOT of
your repo. ONE RENAME: server/server-package.json -> package.json (in server/)
No new packages. schema.sql adds a table and re-runs safely.

TWO THINGS NOW COMPOUND WITH EVERY ENTRY

1 · FOOD KNOWLEDGE  (shipped in the previous batch, included here)
   Foods the chat estimates are saved as source='ai', verified=false. Log a
   dish once and it is in the database for everyone, waiting for a coach to
   confirm it. Verified seed data can never be overwritten.

2 · PORTION MEMORY  (new)
   "1 katori" is not a fixed weight - it depends on whose kitchen the katori
   came from. Portion estimation is the single biggest source of error in the
   whole chain, far bigger than the nutrition values themselves.

   Grams are now editable in the chat preview. When a member corrects one, the
   app records what THEIR "katori dal" or "glass milk" actually weighs, and
   feeds their own measurements into the next prompt in preference to the
   generic conversion table.

   The row shows "· I'll remember this" the moment they change a number, so the
   learning is visible rather than silent.

DESIGN DECISIONS WORTH KNOWING
 · Corrections are averaged, not overwritten, so one mistyped number cannot
   permanently skew a member's portions. Tested: a 2000g typo on a well-
   established 200g portion moves the average by ~256g, not to 2000.
 · The sample count is capped at 8, so the average stays responsive if someone
   genuinely changes bowl size rather than freezing after months of data.
 · Memory is per member and never shared. Two members can have very different
   katori sizes for the same dish; both are correct.
 · Learning is keyed on the UNIT phrase ("katori dal"), not the food id,
   because the unit is what is being learned.
 · The portion write is fire-and-forget - it can never delay or fail a log.

WHAT THIS MEANS IN PRACTICE
A new member gets generic estimates. After a week of small corrections the app
knows their kitchen, and the AI stops guessing at the thing it was worst at.
Meanwhile every dish they log makes the shared food database better for
everyone else.

TESTS
  npm run test:portions   14 assertions on the learning loop
  npm run test:learning   16 assertions on food learning
Full regression: 170 across six suites, all passing.
