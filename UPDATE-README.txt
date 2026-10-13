FITLIFE — CURRENT AI NUTRITION CONSISTENCY FIX
Use FitLife-Phase4-Nutrition-Consistency-Fix.zip (updated files only).
Installed baseline: test 4b1f605a12c38d6001b4f1874792f2aa911db585
Matching local source: f6686fc431006ff46a787e4943d3a6c40cdbbe3f
New revision and final local test totals: NUTRITION-CONSISTENCY-INSTALL.txt.

Copy the included paths over the installed baseline, preserving folders.
The application changes are server-only: initial text/photo carbohydrate
previews now use the same existing net-carb basis as portion editing/daily
totals. Signed-amount prompt guidance is stronger but remains probabilistic.
No migrations, new environment variables, file removals or client changes.
The rebuilt frontend is byte-identical; unchanged index-DyjU6GwD.js is not
proof of the new backend deployment. Do not reapply the older code ZIPs.

Deployed CI 62 passed 78 suites / 4,748 assertions and production build.
Original sambar clarification and UAT-209–211 observed text paths pass live.
The new carbohydrate patch is NOT deployed. Require fresh full CI, including
database suites, then deploy that exact test commit and retest UAT-212/213.
UAT-212 symbolic-minus ambiguity remains OPEN; prompt guidance is not a
deterministic fix. UAT-213 captures the carbohydrate issue observed live.
The regression catalog now has 213 cases. Preserve physical-device,
screen-reader, disposable-account Save/Edit/Undo and coach acceptance gates.

See docs/reviews/PHASE4-NUTRITION-CONSISTENCY-FIX.md for scope and limits,
and PHASE4-PENDING-PLAN.md for the full retained backlog.
Excel and evidence ZIPs are reports, not application code.

HISTORICAL MEAL-CLARIFICATION PREPARATION RECORD (BELOW)
The following instructions/results describe the prior ZIP, now deployed.
FITLIFE — MEAL QUANTITY CLARIFICATION FIX
Incremental updated files only; original repository paths retained.

Intended installed baseline: 1c0c0408b80134d8d26812c7e1f0073271e8e939 (test)
Matching local Phase 4 source: 507c2e4434a14e57400cf079dc971dce8ba99051
New fix revision: see MEAL-CLARIFICATION-INSTALL.txt in the code ZIP
New frontend asset: /assets/index-DyjU6GwD.js
Target: https://fitness-test.up.railway.app/ (branch test only)

WHICH ZIP TO USE
Use the new incremental meal-clarification updated-files ZIP on the deployed
Phase 4 baseline above. Do not reapply the older cumulative Phase 3/Phase 4 ZIP.
The archive must include only changed/new files and its coherent client/dist
build, preserving repository paths. Excel and evidence ZIPs are reports, not
app code. This new fix is not deployed yet.

WHAT THIS FIX CHANGES
The live text "2 idlis and sambar for breakfast" produced only Idli, 80 g,
107 kcal. Adding "1 bowl" for sambar produced both foods, 176 kcal total.
The parser is instructed to represent every named consumed food. Missing or
invalid grams become a separate amount question instead of silent omission.
A known standard serving may still be proposed with an explicit Estimated
label and editable quantity.

Unresolved foods have no invented grams/macros and do not enter totals or the
Save count. A short answer uses bounded context from the latest unsaved same-day
review. Reviewed food stays available; the prompt asks for only newly resolved
food. Every resolved portion still requires explicit Save. Existing quantities,
macros, canonical nutrition, receipts, account/day guards, minimal navigation,
themes and one-tap Speak/Snap/Type remain in place.

INSTALL
1. On branch test at the installed baseline, copy all included paths into the
   repository root, replacing matching files and preserving folders. Review
   later checkout changes before merging; do not overwrite them blindly.
2. Include all new helpers/components/tests and the matching client build.
   No deletions, database migrations or new environment variables are required.
   If using an accompanying patch, run git apply --check on the exact baseline.
   Apply the patch OR folder overlay, not both.
3. Run the complete registered gate and require NEW green GitHub CI for this
   fix's exact commit. Baseline run 61 does not certify changed source.
4. Deploy the same commit to the Railway test service. Verify frontend asset
   and backend revision, accept the app update and run deployment smoke.
5. Run relevant P0 cases and UAT-209–212 using disposable accounts. The catalog
   has 212 cases; cases 209–212 are Not run. Preserve real member records.
   Physical camera/mic and screen-reader acceptance remain separate evidence.

VERIFICATION
Phase 4 baseline: frontend verified; all 58 packaged files match GitHub
1c0c0408. Test gate run 61 passed 76 suites / 4,642 assertions, including
49 database suites / 2,316 assertions; its client build passed.
New fix production build: PASS
New fix local available regression: PASS — 29 suites / 2,432 assertions; 0 failed
New fix focused parser/client regression: PASS — 46 server + 60 client assertions
New fix complete GitHub CI and deployment: PENDING
New fix physical-device/member acceptance: PENDING

LIMITS AND BACKLOG
A model can still omit food from both output arrays or repeat reviewed food
despite instructions. No name-only deduplication hides a possibly separate
portion. Earlier amount notices remain historical after a later clarification.
The exact live provider response/path behind the original omission was not
captured. The separate quick-log voice integration keeps its existing behavior;
the explicit-review guarantee here applies to the member AI workspace.
Accessibility/device work and Phase 3 backend limits remain open.
See docs/reviews/PHASE4-MEAL-CLARIFICATION-FIX.md and PHASE4-PENDING-PLAN.md.
