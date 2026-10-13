FITLIFE — PHASE 4 REGRESSION
Scope: partial accessibility pass plus cumulative Phase 3 AI-review changes.
Verified deployment / patch target: 8a1da6560e422bdd313e54b70565a455a9815d07
Source diff base: 43a69b3fcf149132d13a890fff6add8e5d4c2c57
Phase 4 development base: 3386271329f259e6f5954e29b9d2d0a33b049af5
Final package revision: see PHASE4-INSTALL.txt in the code ZIP
Target: https://fitness-test.up.railway.app/ (test only)

REPEATABLE GATE
1. Install dependencies from the repository and server package locks.
2. Run npm test from server. Its pretest builds the client; test-local.sh creates
   isolated localhost PostgreSQL on port 5433 and runs registered suites. Never
   point fixture tests at the live database. Existing database guards,
   component-size gates and layout thresholds remain in force.
3. Require a new green GitHub Test gate for the exact cumulative commit.
   Preserve failed-run evidence, fix reproducible defects, rebuild and repeat
   focused checks plus the complete registered gate after each source build.
4. Deploy the matching test commit and verify frontend/server identity.
   Then run from the repository root:
   node server/scripts/test-deployment.mjs
5. Run workbook Acceptance cases on disposable member/coach/admin accounts.
   Start with P0, then Phase 3 UAT-175–192 and Phase 4 UAT-193–208. Cover both
   themes, enlarged text, keyboard-only navigation and supported Android/iPhone
   browser/PWA paths. Preserve real member records.
6. Record actual outcome, exact revision, browser/device and evidence. Keep
   Not run, Blocked, Failed and Passed distinct. A written test case is not an
   executed pass, and an older green CI run cannot certify current source.

NEW PHASE 4 COVERAGE
test-modal-accessibility.mjs exercises participating real modal components in
the browser: modal stack ownership, topmost focus, nested Escape/scroll/focus
restoration and the touched accessible controls/announcements. All 84 assertions
passed on the final source; this suite is included in the local totals below.
The catalog contains 16 new manual cases, UAT-193–208, for 208 total.
The new cases remain unexecuted until actual supported
browser/device results are recorded. Fixture runs do not count as physical
screen-reader acceptance.

Phase 3's test-ai-save-receipts.mjs and all prior voice, photo, portion, cache,
offline, session and full UI suites remain in the gate. Retest AI review Save,
Edit, Undo and partial failures because the cumulative ZIP includes Phase 3.
Avoid double-counting premium assertions already included in the full UI run
or focused checks already included in a reported suite total.

CURRENT PHASE 4 RESULTS
Production build: PASS
Focused modal/browser run: PASS — 84 assertions (included in local totals)
Available local suites: 27 passed — 26 logic/module suites plus the full UI run
Passing assertions: 2,326 — 1,509 logic/module plus 817 full UI
Failing assertions: 0
Full UI includes 693 core assertions and 124 nested premium assertions.
Blocked/unexecuted suites: 49 PostgreSQL suites require the new isolated CI gate
New complete GitHub CI for final revision: PENDING
Deployed revision and asset verification: PENDING
Signed-in acceptance and physical device/screen-reader results: PENDING
Optional lint result: NOT RUN — eslint is not installed locally

HISTORICAL EVIDENCE — KEEP SEPARATE
- Last verified deployment: 8a1da65.
- Its GitHub Test run 59 passed 74 suites / 4,447 assertions. The preceding
  release also recorded 13 public deployment checks and a scoped draft-only
  live retest. Those results predate the new Phase 3 and Phase 4 source.
- Phase 3 locally passed 26 available suites / 2,242 assertions: 25 logic/module
  suites with 1,425 assertions plus full UI with 817 (including 124 premium).
  The separate focused premium run is not added again. Phase 3 deployment has
  not been confirmed.
- The user's earlier one-tap camera/microphone confirmation remains evidence
  for the phones/build tested then. Repeat relevant cases on the new revision;
  synthetic speech/capture fixtures do not prove physical behavior or accuracy.
- Local PostgreSQL is unavailable. The 49 database suites in the preceding
  gate remain a required separate CI step; use the final registered manifest
  for this build's total. No database pass is inferred from fixture tests.

ACCESSIBILITY AND ARTIFACT BOUNDARIES
This pass covers shared Sheet/participating AI modal behavior, focus styling,
touched target sizes and labels/status, plus Progress's past-day Sheet. It is
not a completed app-wide accessibility audit or WCAG certification. Physical
screen-reader/device checks, remaining legacy Milestone/staff modal migration
and a broad measured contrast pass remain pending. Desktop emulation and
overflow checks are distinct from assistive-technology acceptance.

Health/asset smoke tests do not prove authenticated save/reload, coach-visible
records, backend revision or physical device behavior. Individual browser and
component suites use synthetic data and may stub AI/storage/network boundaries.
The workbook and evidence ZIP must state those boundaries for actual runs.

PACKAGE AND BACKLOG
Deliver one cumulative updated-files ZIP containing Phase 3 + Phase 4. Generate
its app-source diff from 43a69b3; exclude unrelated workflow differences and
installation-aid deletions. Verify the patch against uploaded baseline 8a1da65.
The folder overlay supports 8a1da65 or a Phase 3 checkout; the patch alternative
supports only a clean 8a1da65 checkout. Preserve original repository paths.
The workbook and evidence ZIP are reports, not deployable app packages.
docs/reviews/PHASE4-PENDING-PLAN.md retains the full release gate, feature
preservation checklist, Phase 3 backend limits and remaining P1/P2 backlog.
