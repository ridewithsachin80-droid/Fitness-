FitLife — wrong calories on AI-logged foods
===========================================

Extract, drag the "client" and "server" FOLDERS onto GitHub at the ROOT of
your repo. NOTHING TO RENAME. No new packages. No schema change.

YOU WERE RIGHT, AND IT WAS ONE ITEM
Checked all five foods in Subramanya's log against reference values:

  Egg     110g  171 kcal  correct
  Okra     50g   17 kcal  correct
  Yoghurt 100g   60 kcal  correct
  Upma    150g  212 kcal  correct
  Whey     30g   36 kcal  WRONG - should be 120 kcal, 24g protein

Whey was out by a factor of 3.3. The day's total was understated by ~84 kcal
and 17g of protein.

ROOT CAUSE
Two failures stacked.

1. The database lookup never matched. The food seeds store the full product
   name in `name` ("Whey Protein (Unflavoured)") and the everyday name in
   `name_local` ("Whey Protein") - but the lookup only searched `name` and
   `name_aliases`. So the food members actually type never matched, and we
   silently fell back to the AI's own estimate. This affected every seeded
   food, not just whey; the others happened to be close enough that nobody
   noticed.

2. The AI read a per-scoop label. Supplement labels print nutrition per 30g
   scoop, so it returned 120 kcal / 24g protein as if that were per 100g. The
   client then took 30% of it, giving 36 kcal.

THREE FIXES
1. The lookup now searches name, name_local, name_hindi and aliases, plus a
   prefix match, ranked so exact hits win and "Whey Protein" prefers the plain
   entry over the chocolate one.
2. Both AI prompts now state explicitly that per_100g means per 100 grams of
   the food, never per scoop or serving, with reference points (whey ~400
   kcal/100g, oil ~900, peanut butter ~590) and the rule that a dry powder
   under 300 kcal/100g means the label was misread.
3. A server-side guard flags dense foods that come back under 300 kcal/100g as
   low-confidence, with a warning shown in the chat preview before the member
   applies it. Flagged, not auto-corrected - guessing a correction would be
   worse than telling someone to check.

The guard is deliberately narrow: it only looks at foods whose names suggest
concentrated powders or fats, so genuinely low-calorie foods are never
flagged. Verified okra at 33 kcal and yoghurt at 61 kcal stay clean.

TESTS
New scripts/test-food-lookup.js, 13 assertions covering the exact bug, the
other four foods, exact-vs-prefix ranking, and the guard's false-positive
cases. Full regression: 130 assertions across five suites, all passing.

AFTER DEPLOYING
Ask Subramanya to delete and re-log the whey entry - the stored figure will
not correct itself. New logs will be right.
