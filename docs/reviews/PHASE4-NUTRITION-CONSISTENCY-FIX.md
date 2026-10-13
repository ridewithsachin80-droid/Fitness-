# AI review carbohydrate consistency — incremental fix

Prepared 13 October 2026 after testing the deployed meal-clarification patch.
Installed test baseline: `4b1f605a12c38d6001b4f1874792f2aa911db585`, matching
local application source `f6686fc431006ff46a787e4943d3a6c40cdbbe3f`.
This new server fix is not deployed. See `NUTRITION-CONSISTENCY-INSTALL.txt`
inside the updated-files ZIP for its revision and final local gate results.

## What the live test established

- The original `2 idlis and sambar for breakfast` omission now produces a named
  Sambar quantity question. Replying `200 grams` resolves only Sambar and retains
  the prior edited Idli card. UAT-209–211 passed their observed text branches.
- Deployed CI 62 passed 78 suites / 4,748 assertions, including 49 database
  suites / 2,316 assertions. All 32 installed package files match GitHub.
- Scoped live testing recorded 16 passed observations and 2 issues. No member
  records or macro labels were saved. Home values were unchanged after reload.
- Sambar 200 g initially showed 15 g carbs; editing its quantity and restoring
  200 g changed carbs to 11 g. Calories stayed at 92. The initial server preview
  used total carbs while portion editing and the daily log use net carbs.
- `rice -50 g` became positive 50 g. Explicit `negative 50 grams`, zero and NaN
  produced quantity questions. This is an AI interpretation ambiguity; the
  negative provider-number guard itself was not observed accepting a negative.

## Bounded change

Both text and photo AI previews now use the same carbohydrate basis as existing
portion editing and the daily log: net carbs when available, total carbs as a
fallback. Explicit net zero is retained. Stored calories, fibre, total carbs,
nutrition database records and per-100 g snapshots are unchanged. This aligns
the basis; existing per-food versus aggregate rounding can still differ by 0.1 g.

Prompt guidance asks for a positive amount instead of removing a minus sign or
assuming an ambiguous hyphen is a separator. This is prompt hardening, not a
deterministic guarantee. PH4-LIVE-03 stays open until provider-level retesting.

No client functionality, navigation, theme, camera/microphone entry, AI review,
Save/Edit/Undo, account guards, or manual logging route is removed. MacroEditor
continues to preview calories computed from entered macros; cancelling it keeps
the review's stored calorie value. This patch does not change that behavior.

## Test and deploy

The focused suite exercises the actual text parser and photo handler against
isolated provider/database responses, then compares their payloads using the
real client portion and daily helpers. It has 58 assertions, including 12 new
ones. Restoring the old preview calculations makes six regression checks fail.
These checks do not prove live model accuracy or HTTP middleware behavior.

Run the production build and complete available local gate before packaging;
final counts are recorded in the install file and updated regression workbook.
Require a fresh full GitHub gate for this new revision, including database tests.
CI 62 verifies the installed baseline only. Deploy to test, then retest UAT-212
and new UAT-213 plus the original sambar sequence. Use a disposable account for
Save/Edit/Undo and coach acceptance. Physical-device checks remain pending.

This is a server-only application change. Rebuilding the unchanged frontend
produces the same `/assets/index-DyjU6GwD.js`; that asset alone cannot prove this
new backend fix is deployed. Verify the deployed commit and live behavior.
No migrations, new environment variables or deletions are required.

The complete pending plan and Phase 3 limitations remain in
`PHASE4-PENDING-PLAN.md`. Earlier omission and clarification evidence is retained
in `PHASE4-MEAL-CLARIFICATION-FIX.md` and the versioned QA reports.
