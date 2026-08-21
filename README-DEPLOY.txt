FitLife — the AI chat now learns foods
======================================

Extract, drag the "server" FOLDER onto GitHub at the ROOT of your repo.
ONE RENAME: server/server-package.json -> package.json (in server/)
No new packages. No schema change. Client untouched.

THE GAP
The AI Food Search saved what it estimated. The AI Chat - the path members
actually use - read from the foods table but never wrote to it. So logging
"upma" every morning made the AI re-estimate it from scratch every single
time: the same guess, never reviewed, never improving, and invisible to you
in the Food Database Manager.

WHAT IT DOES NOW
Foods the chat estimates are written to `foods` with source 'ai' and
verified=false - the same contract the search path already used. Usable
immediately, clearly marked unverified, and visible to a coach to confirm or
correct. Both the typed and photo paths learn.

The write is fire-and-forget and never awaited, so a member's preview appears
at the same speed as before and a database hiccup can never fail their log.

WHAT IT REFUSES TO LEARN
  · foods that already matched the database  (nothing to learn)
  · anything the per-serving guard flagged    (saving a suspect value would
    bake that error in for every future member)
  · energy density of 0 or above 920 kcal/100g
  · names under 2 or over 100 characters

YOUR SEED DATA IS SAFE
The unique index is on (lower(name), source), so an AI row and a verified NIN
row coexist as separate rows - an AI estimate can never overwrite curated
data. The lookup orders by verified DESC, so when both exist the verified row
always wins. Both behaviours are asserted in the tests.

CATEGORIES
The AI now returns a category, validated against the table's CHECK constraint.
When it gives none or an invalid one, a keyword fallback files the food
(upma -> grain, moong dal khichdi -> pulse, buttermilk -> dairy, unknown ->
other), so nothing lands uncategorised.

WHAT TO EXPECT AFTER DEPLOYING
The Food Database Manager will start filling with source='ai' entries as
members log. Reviewing those and flipping the accurate ones to verified is
how the database gets genuinely good - each confirmation permanently removes
one guess from the system.

TESTS
scripts/test-food-learning.js, 16 assertions.
  npm run test:learning
Full regression: 167 across six suites, all passing.
