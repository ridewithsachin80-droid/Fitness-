FitLife — macro targets as percentages
======================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change.

WHAT'S NEW
The lab analysis now ends with a macro target: calories, grams, and the split
as percentages, with a proportional bar so the shape reads at a glance.

    1,750 kcal      36% P · 22% C · 42% F
                    158g     98g     81g
                    2.11 g protein per kg

Percentages also now appear on the adaptive engine's targets, derived from the
same grams so the two can never disagree.

Both are shown because they answer different questions. Grams are what a member
shops and cooks to. Percentages are how a coach reads a plan in one glance.

COMPUTED IN CODE, NOT BY THE MODEL
Dividing calories into grams is arithmetic. A language model doing arithmetic
produces plausible-looking errors nobody catches, and the same panel must
always give the same answer. So the split is deterministic; the model only
writes the surrounding explanation.

HOW THE PANEL MOVES THE SPLIT
  raised HbA1c        protein up, carbohydrate share down
  high triglycerides  carbohydrate down further — they respond to refined
                      carbohydrate and alcohol more than to dietary fat
  low HDL             a little more fat, weighted to unsaturated sources
  high LDL            NOTHING CHANGES, and the card says why: the lever there
                      is saturated fat and soluble fibre, neither of which
                      shows up in a macro ratio
  B12, vitamin D,     nothing changes. These are food-choice problems, not
  ferritin            macro-ratio problems, and pretending otherwise would be
                      theatre

A BUG CAUGHT WHILE BUILDING IT
The first version derived carbohydrate as whatever remained after a fixed fat
figure. A carbohydrate floor then bound in every single scenario, so none of
the lab adjustments moved the numbers at all — while the explanation still
claimed they had. Reasoning that describes changes which did not happen is
worse than no reasoning. Rebuilt to split the non-protein calories by share,
and there is now a test asserting every stated reason corresponds to a real
change.

Also fixed: three independent roundings made the percentages sum to 99 or 101.
The last share is now derived from the other two.

TESTS
  npm run test:insight   67 assertions, 14 of them on the macro maths alone
Regression: 226 across five suites, all passing.
