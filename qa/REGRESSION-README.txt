FITLIFE — TEST GATE #56 REPAIR

Apply on top of test commit fc7003fc1baa94d61dc39143052c355f1309adda.
Target: https://fitness-test.up.railway.app/ (test only).

Run https://github.com/ridewithsachin80-droid/Fitness-/actions/runs/38350096105
passed all 20 logic/module suites and all 49 PostgreSQL suites (3,365 passing
assertions). Only the UI suite failed. CI used the old workflow and tested
before building. Uploaded dist contained three generations of CSS; the UI
harness combined them or selected the first obsolete file in the directory.

Repair
- Both UI suites load local CSS referenced by dist/index.html, in HTML order.
  Missing linked CSS fails explicitly. All layout/theme assertions remain.
- npm test, npm run test:ui and npm run test:premium build the client first.
  This works even when GitHub browser upload omits the hidden .github folder.
- The corrected workflow relies on npm test to build and retains QA evidence.
- A focused regression checks stale files, CSS order and missing build output.
- No application functionality or visual design is changed in this repair.

Verification
1. npm install from the repository root; npm ci in server.
2. cd server; npm test
   Uses disposable localhost PostgreSQL on port 5433. Never use a live DB URL.
3. Require a green NEW run on the resulting test commit. Rerunning #56 tests
   the old files. Then deploy the matching test revision.
4. Run node server/scripts/test-deployment.mjs, then the workbook's signed-in
   P0 member/coach/device cases with dedicated test accounts.

Reproduction: premium UI failed 20 checks with the uploaded CSS directory.
After changing stylesheet selection only, all 112 premium checks passed,
with obsolete CSS files still present. npm test then successfully built the
client before stopping at the local PostgreSQL prerequisite. The database
suites passed on GitHub fc7003f; this repair changes only test tooling/docs.
See the Excel workbook and QA evidence ZIP for the final regression results.

Physical camera and microphone are user-confirmed. Browser fixtures do not
independently certify hardware or signed-in deployed member/coach workflows.
Repository writes are unavailable to the assistant; this package is not pushed.

Upload server/ and qa/ into the repository root, preserving their paths.
If hidden .github is omitted, the build-order correction still takes effect.
For evidence uploads, also replace .github/workflows/test-gate.yml via GitHub's
Edit button with the full supplied file. Do not add a wrapper folder.
