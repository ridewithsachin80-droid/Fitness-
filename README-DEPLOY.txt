FitLife — the safety filter was blocking its own good output
============================================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change.

DEPLOY THE PREVIOUS ZIP FIRST if you have not — that one carries the NaN
migration in schema.sql, which this does not repeat.

WHAT HAPPENED
The token fix worked: the analysis generated. Then my own safety filter
discarded it — "The analysis strayed into clinical territory".

The filter matched WORDS, not claims. That fails in both directions, and the
false-positive direction is the embarrassing one. All of these were blocked:

  "This is not a diagnosis — discuss it with the doctor who ordered the test."
  "A supplement may be needed; the doctor should decide the dose."
  "These numbers do not indicate anaemia on their own."
  "If you have questions about the plan, raise them with your coach."

Every one of those is exactly the careful phrasing the prompt asks for. The
filter could not tell an assertion from a denial, so the more carefully the
model wrote, the more likely its answer was thrown away. Meanwhile a fluent
claim avoiding those particular words would have passed untouched.

WHAT IT DOES NOW
It checks claims:

  · A DISEASE NAMED AS AN ASSERTION is blocked — but not when it is being
    denied or handed to a doctor. The preceding 60 characters are scanned for
    negation and referral ("not", "whether", "the doctor", "rule out").
  · A SPECIFIC DOSE is blocked — "take 60 mg", "start 2000 IU", "increase to
    2 tablets". Saying dosing is the doctor's call is fine, as is "add 2 tbsp
    of flaxseed", which is food.
  · A DIRECT ATTRIBUTION — "you have a deficiency" — is blocked.

Verified 17/17 in both directions: seven real overreaches blocked, nine
pieces of careful phrasing allowed, including all four the old filter ate.

REJECTIONS NOW EXPLAIN THEMSELVES
When something is genuinely blocked, the coach sees what tripped it —
'asserts "anaemia"' or 'prescribes a dose: "Take 60 mg"' — plus a Try Again
button. An opaque refusal gives a coach nothing to judge; a specific one lets
them decide whether to regenerate or handle it themselves.

TESTS
  npm run test:insight    53 assertions
Regression: 186 across the four affected suites, all passing.
