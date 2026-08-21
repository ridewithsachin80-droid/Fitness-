FitLife — full nutrition audit
==============================

Extract, drag the "server" FOLDER onto GitHub at the ROOT of your repo.
ONE RENAME: server/server-package.json -> package.json (in server/)
No new packages. No schema change. Client untouched.

WHAT I DID
Built a validator and ran it over all 579 seeded foods, checking:

  ATWATER     calories must agree with 4·protein + 4·carbs + 9·fat
  MASS        protein + carbs + fat cannot exceed 100g per 100g
  SUBSET      fibre and sugar cannot exceed total carbs; saturated and trans
              fat cannot exceed total fat
  DENSITY     per-category ceilings and floors (nothing beats pure fat at
              900 kcal/100g; a declared oil under 700 means a unit mix-up)
  MICROS      plausible per-100g bounds, to catch mg-where-mcg-was-meant
  DUPLICATES  same food seeded twice with materially different numbers

RESULT: 2 genuine data errors in 579 foods, both fixed.

  Cluster Beans (Gavar)   16 kcal stated, but its own macros give 60.
                          Most of the carbohydrate is fibre; the metabolisable
                          figure is ~40. USDA lists guar beans at 45.
                          16 -> 40 kcal.

  Pointed Gourd (Parwal)  carbs 2.2g sat BELOW its own fibre 3.0g, which is
                          impossible - fibre is a subset of carbohydrate.
                          Reference total carbohydrate is 4.2g.
                          2.2 -> 4.2g carbs.

A THIRD LOOKUP BUG, FOUND BY THE AUDIT
Five foods are seeded twice, once per 100g and once per serving:

  Flaxseed Oil (Alsi Tel) 884   vs  Flaxseed Oil (1 tsp / 5ml) 44   20x
  Psyllium Husk           200   vs  Psyllium Husk (Isabgol, 5g) 10  20x
  Moringa Powder          205   vs  Moringa Powder (per 5g)     10  20x
  Collagen Peptides       380   vs  Collagen Peptides (10g)     35  11x
  Wheat Germ              382   vs  Wheat Germ (2 tbsp)         76   5x

Both rows share a base name, so a plain query could land on the per-serving
row - the same class of fault as whey and egg, and worse in magnitude. The
lookup now always prefers the per-100g row unless the member names the unit
row exactly.

THE 21 REMAINING WARNINGS ARE CORRECT DATA
They are two legitimate patterns, left alone deliberately:
  · Spices and husks where stated calories sit below the Atwater figure -
    coriander, cinnamon, cloves, psyllium, ajwain, kalonji. These are mostly
    indigestible fibre, so metabolisable energy really is lower than 4/4/9
    predicts. NIN reports it this way.
  · Raw-versus-cooked pairs - dal at 334 raw and 105 cooked is correct, since
    cooking absorbs water.

ONGOING PROTECTION
  cd server
  npm run validate:foods   fails the build on any nutrition error
  npm run test:foods       23 assertions on food matching

Run validate:foods after any seed edit. It needs no database.

FULL REGRESSION: 151 assertions across five suites, all passing.
