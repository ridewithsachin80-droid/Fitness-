FITLIFE — TEST GATE #55 REPAIR

Apply after uploaded test commit 18ef815660225d5aaf67d5f0e679da70e696123b.
Target: https://fitness-test.up.railway.app/ (test only).

Observed run: https://github.com/ridewithsachin80-droid/Fitness-/actions/runs/38347452601
Three suites failed: private cache browser (missing puppeteer-core), journey
(old assertion removed the unfinished exercise), known fixes (one-sided lab
limits). The known-fix suite also stopped before its tracker-state checks.
Its 47 successful database suites are historical results for that upload,
not proof that this subsequent correction passes the complete gate.

Repair
- Browser packages are pinned development dependencies in server/package.json
  and package-lock.json. A normal npm install now installs them for testing.
- Lab entry and analysis share finite number and one-sided reference handling.
- Tracker callback state is signed, expires, and is bound to member/provider.
- The workout journey checks no completed sets and preserves the selection.
- Every client build removes generated dist before rebuilding the PWA worker.
- The corrected workflow builds first, runs every registered suite and stores
  logs/screenshots even on failure. Upload the hidden .github folder too.

Verification
1. npm install from the repository root; npm ci in server.
2. npm run build from the root (safe to repeat over an existing dist).
3. cd server; npm test
   Uses disposable localhost PostgreSQL on port 5433. Never use a live DB URL.
4. Require a green run on the resulting test commit, then deploy that commit.
5. Run node server/scripts/test-deployment.mjs, then the workbook's signed-in
   P0 member/coach/device cases with dedicated test accounts.

Local focused tests run actual Express routes against synthetic SQL/HTTP
adapters. They never contact real members or wearable providers. Their pass
is not a PostgreSQL integration pass or live acceptance.
The local workspace still has no PostgreSQL binaries. The complete database
gate and real tracker integration must be rerun in CI/test deployment.
The user confirmed one-tap camera and mic on Android and iPhone before this
repair; browser fixtures cannot independently certify physical capture.

GitHub browser uploads omitted the previous hidden .github files. If drag
upload omits them again, edit .github/workflows/test-gate.yml directly on test
using the complete file supplied in the repair archive. The package dependency
fix remains effective even before the workflow is updated.
