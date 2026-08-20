FitLife — "Egg" was matching Egg Yolk
=====================================

Extract, drag the "server" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change. Client untouched.

THE BUG, AND IT WAS MINE
Egg 165g logged as 531 kcal. That works out at 322 kcal per 100g, which is
exactly egg YOLK. Whole egg is 155.

  logged     165g  531 kcal  P26.2  F43.7   = 322 kcal/100g  (egg yolk)
  correct    165g  256 kcal  P20.8  F17.5   = 155 kcal/100g  (whole egg)

Yesterday's fix widened the food lookup so it would stop missing the database,
and I ranked the prefix matches by LENGTH(name) - shortest wins. That looks
sensible and is wrong. For "Egg" the candidates are:

  14  Egg Yolk (Raw)              <- shortest, so it won
  15  Egg White (Raw)
  17  Eggs (Whole, Raw)           <- what it should be
  26  Egg Bhurji (Scrambled Egg)
  28  Eggplant / Brinjal (Baingan)

A component of a food beat the food itself purely on name length.

THE FIX
Matching now compares against the BASE name - the part before any bracket - so
"Egg" is compared with "Eggs", not with the whole string "Egg Yolk (Raw)".
Singular and plural are treated as the same word. Ranking is now:

  0  exact full name
  1  base name equals the query
  2  base equals the plural or singular of the query   <- "Eggs" for "Egg"
  3  declared alias
  4  base starts with the query AND a word break follows
     ("Egg Bhurji" qualifies, "Eggplant" does not)

The word-break rule is what stops "Egg" matching "Eggplant".

TESTS
test-food-lookup.js now seeds the real egg family and asserts every variant
resolves to itself while the bare word resolves to whole egg. 19 assertions.
Full regression: 147 across five suites, all passing.

AFTER DEPLOYING
Ask Subramanya to delete and re-log the 165g egg - the stored figure will not
correct itself. It should come back as 256 kcal.
