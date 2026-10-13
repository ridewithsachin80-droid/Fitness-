FITLIFE PHASE 1 — REGRESSION AND DEPLOYMENT

Target repository: ridewithsachin80-droid/Fitness-, branch test
Target app: https://fitness-test.up.railway.app/
Baseline commit: 65a70a5e6d4ec022b2de284d68a96164f1908d60

Build scope
- My usual inside AI opens an editable review before anything is logged.
- Household portion units, counts and grams per unit; opt-in memory and forget.
- Nutrition provenance labels and visible raw/cooked/unspecified preparation.
- Recent foods use the latest quantity; household memory stores one unit.
- Expanded automated regression and read-only deployment smoke workflows.

Run after every source build
1. Install client and server dependencies. Build from the repository root:
   npm run build
2. Install browser-only QA dependencies in server (not needed in production):
   npm install --no-save puppeteer-core@25.13.0 @sparticuz/chromium@153.0.0
3. On a machine with PostgreSQL binaries, run from server:
   npm test
   This creates/recreates a disposable localhost database called fitlife_test
   on port 5433. NEVER substitute a live Railway database URL.
4. The test gate runs logic, component, database and UI/browser suites.
   It writes evidence to qa/results. Missing listed suites fail the gate.
   For a locally installed Chromium, set CHROME_EXECUTABLE_PATH to that binary.
5. Deploy the matching commit to the named test service only.
6. From the repository root run:
   node server/scripts/test-deployment.mjs
   Exit 2 means the matching new build or connectivity could not be verified.
   Exit 1 means a smoke assertion failed. Exit 0 verifies HTTP smoke only.
7. Execute qa/manual-regression.tsv using dedicated test member/coach/admin
   accounts. Complete P0 cases on Android, iPhone Safari and installed PWAs.
   Record actual deployed results in the accompanying Excel workbook.
8. Fix reproducible failures; rebuild; repeat the relevant checks and the full
   registered gate. Do not count an older green CI run as the new build passing.

Automation
- Test gate builds the client first, installs browser QA tooling and runs all
  registered suites on branch pushes, then uploads logs/screenshots.
- Test deployment smoke supports manual dispatch on test and a successful
  deployment_status event whose environment URL is the exact test URL.
- If Railway does not emit that event or uses a different URL spelling, run
  Test deployment smoke manually on test after confirming the deployed commit.
- HTTP smoke does not authenticate, edit health records, send notifications,
  or certify real phone camera/mic behavior.

Current limitations
- GitHub writes returned 403 Resource not accessible by integration.
- Command-line git push has no available write credentials.
- This workspace has no PostgreSQL binaries; new DB integration runs are
  blocked here and cannot yet be run in CI without publishing the branch.
- The live test app still serves the prior baseline build.
- Real-device and signed-in live acceptance are pending.
- Undefined-identifier lint was not run locally because ESLint is absent.

Excel workbook usage
- Overview summarizes actual runs and release blockers.
- Acceptance cases contains manual preconditions, steps and expected results.
- Suite runs shows the entire registered regression set and blocked DB suites.
- Executed checks records actual final local assertion output.
- Automated catalog lists assertion declarations and source locations.
- Deployment separates current public-site checks from phase 1 acceptance.
- Defects records fixes, retests and outstanding access/environment blocks.

Artifact boundary
Screenshots and UI tests use synthetic fixture data. AI, storage and other
external services may be stubbed by individual suites. A fixture pass is not
proof of live AI accuracy, production integrations or physical device support.
