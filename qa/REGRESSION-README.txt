FITLIFE — PHASE 5 AI DRAFT EDIT REGRESSION
New suites validate server contract/side-effect isolation, immutable client
draft targets/revisions, and actual mounted AIChatLog interaction/race cases.
Build and complete available local totals: PHASE5-INSTALL.txt.
New full CI with49 isolated database suites and deployment/live acceptance
are pending. Do not use historical CI63 as proof of this changed source.
233 manual cases are retained; UAT214–233 appended as Not run. Automated
fixtures are separate from live member/device outcomes. UAT212 remains Fail;
UAT213 Partial. Preserve prior history, diagnostics and pending gates.
See docs/reviews/PHASE5-AI-DRAFT-EDITS.md and qa/results/phase5-draft-edit.

HISTORICAL REGRESSION RECORDS BELOW — counts refer to their own revisions.
FITLIFE — CURRENT NUTRITION CONSISTENCY REGRESSION
Installed baseline: test 4b1f605a12c38d6001b4f1874792f2aa911db585
Matching local source: f6686fc431006ff46a787e4943d3a6c40cdbbe3f
Deployed CI 62: 78 suites / 4,748 assertions PASS; build PASS.
Live scope: 16 passed observations, 2 issues; no member records saved.
Original sambar omission and observed UAT-209–211 text paths now pass.
UAT-212 retains symbolic-minus ambiguity. New UAT-213 records the initial
total-carb preview versus existing net-carb portion/daily calculation mismatch.

The new server fix aligns text/photo previews with the existing net-carb basis.
It also strengthens signed-quantity prompt guidance without a deterministic
interpretation guarantee. The new patch is NOT deployed or certified by CI 62.
Run a fresh complete gate and deploy the same commit. Frontend asset unchanged:
/assets/index-DyjU6GwD.js cannot independently identify the new backend.
Local results and revision: NUTRITION-CONSISTENCY-INSTALL.txt in the new ZIP.
Focused server suite: 58 assertions, including 12 consistency checks; test
fixtures exercise actual text/photo handlers and real client math. Do not count
focused reruns again in complete gate totals. Catalog: 213 manual cases.
See docs/reviews/PHASE4-NUTRITION-CONSISTENCY-FIX.md and full pending plan.

HISTORICAL MEAL-CLARIFICATION PREPARATION RECORD (BELOW)
The remaining counts/pending states describe the prior package before CI 62.
FITLIFE — MEAL CLARIFICATION REGRESSION
Scope: incremental named-food quantity clarification on verified Phase 4.
Intended deployment baseline: 1c0c0408b80134d8d26812c7e1f0073271e8e939
Matching local baseline: 507c2e4434a14e57400cf079dc971dce8ba99051
New fix revision: see MEAL-CLARIFICATION-INSTALL.txt in the code ZIP
New build asset: /assets/index-DyjU6GwD.js
Target: https://fitness-test.up.railway.app/ (test only)

REPEATABLE GATE
1. Install dependencies from the repository and server package locks.
2. Run npm test from server. Its pretest builds the client; test-local.sh
   creates isolated localhost PostgreSQL on port 5433 and runs registered
   suites. Never use the live database for fixtures. Existing database guards,
   component-size gates and layout thresholds remain in force.
3. Require a new green Test gate for the exact incremental fix commit.
   Preserve failures, fix defects, rebuild, then repeat focused checks and
   the complete available gate. Historical counts remain separate.
4. Deploy the matching test commit, verify frontend/server identity, then run
   node server/scripts/test-deployment.mjs from the repository root.
5. Use disposable accounts for live acceptance. Start with relevant P0 and
   UAT-209–212; continue remaining Phase 3 UAT-175–192 and Phase 4 UAT-193–208
   where not yet executed. Retain physical device/screen-reader checks.
6. Record expected/actual result, revision, device and evidence. Not run,
   Blocked, Failed and Passed differ. Preserve real member data; synthetic
   provider responses do not prove live AI accuracy.

NEW FIX COVERAGE
test-food-clarifications.js tests the real server parse pipeline with an
isolated provider/database stub: valid portions, unresolved preservation,
bounded context, canonical DB nutrition, truthful pending status, no daily-log
or workout writes, and the known omission-from-both-arrays limitation.
test-ai-food-clarifications.mjs mounts the actual AI component: mixed and
unresolved-only replies, no automatic save, canonical edited quantities,
short-answer context, exact Retry/newer-draft preservation, boundaries and
photo-response handling. Model no-repeat behavior is synthetic in fixtures,
not a guaranteed live-provider property.

Prior modal accessibility, Save/Edit/Undo, voice/photo/portion, cache/offline,
session and full UI suites remain registered. Do not add nested premium
checks or focused reruns again when reporting combined suite totals.
The manual catalog contains 212 cases. New UAT-209–212 remain Not run.

NEW FIX RESULTS
Production build: PASS
Focused server/client checks: PASS — 46 server + 60 client assertions
Available local suites/assertions: PASS — 29 suites / 2,432 assertions
Breakdown: 28 logic/module suites / 1,615 assertions; full UI / 817 assertions
The UI total includes 693 core and 124 nested premium assertions, counted once.
Failures: 0
New complete GitHub CI, including 49 database suites: PENDING
New deployment/asset verification: PENDING
Live provider/member/device acceptance: PENDING
Optional lint: report the actual new-run outcome; do not infer a pass

VERIFIED BASELINE EVIDENCE — NOT THE NEW FIX
Local Phase 4 507c2e4 corresponds to uploaded test head 1c0c0408. All 58 packaged
files match Git blob hashes; frontend is verified. GitHub Test gate run 61,
run ID 38415568836, gate job 115358963035, passed 76 suites / 4,642 assertions
and client build:
- 26 logic/module suites / 1,509 assertions
- 49 database suites / 2,316 assertions
- Full UI / 817 assertions (693 core plus 124 nested premium)
Optional ESLint was not installed, so it was Not run. Baseline local available
gate was 27 suites / 2,326 assertions; its 84 modal checks are already included.
Evidence: qa/results/phase4-deployed/github-verification.txt.
Older deployment 8a1da65 / CI run 59 (74 suites / 4,447 assertions) and Phase 3
local 26 suites / 2,242 assertions remain historical only. Do not add them.

BOUNDARIES AND PACKAGE
The new fix is not deployed. Ship incremental updated files from local 507c2e4
to the new revision for remote 1c0c0408. No deletions, migrations or new
environment variables; preserve repository structure. The remote baseline
workflow runs npm test and a separate client build without uploading local
regression artifacts; its job logs confirm the full gate. Local PostgreSQL
unavailability does not waive the new isolated CI database gate.

The original live omission's provider response/path was not captured. A model
can omit both arrays or repeat reviewed rows despite instructions; earlier
clarification notices remain historical. No fixture pass removes these limits.
Accessibility remains partial: physical device/screen-reader acceptance,
legacy Milestone/staff modals and broad contrast review remain pending.
Browser 20px text is 125% coverage, not physical 200% acceptance or certification.
Phase 3 standalone-lab receipts/idempotency, atomic cross-device workout
revisions and body-metric idempotency/reversal remain follow-ups.
Full backlog: docs/reviews/PHASE4-PENDING-PLAN.md.
Fix details: docs/reviews/PHASE4-MEAL-CLARIFICATION-FIX.md.
