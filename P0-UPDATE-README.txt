FITLIFE P0 FIXES — UPDATED FILES ONLY

Target: ridewithsachin80-droid/Fitness-, branch test
Patch baseline: 66b8bc9171f52d28943e37b4df7465d5de4eb805
Local reviewed commit: 82efb175673b0d1575d5e45a61487c3dba1686c1
Test site: https://fitness-test.up.railway.app/

This archive contains only changed files in their repository folder structure.
Apply it AFTER the uploaded 66b8bc9 version; it retains Phase 1 functionality.
Merge files into the repository root. Include the hidden .github and .gitignore
files: the prior browser upload omitted the updated workflow. Do not deploy the
ZIP itself. P0-UPDATE-README.txt, P0-DELETE-FILES.txt and p0-update.patch are
installation aids and do not need to be copied into the application repository.

Preferred in a clean checkout of test at the baseline commit:
  git apply --check /path/to/p0-update.patch
  git apply /path/to/p0-update.patch
This applies replacements and removals together. Otherwise merge the files
and remove only obsolete assets listed in P0-DELETE-FILES.txt.

The rebuilt client/dist is included. Server startup applies the idempotent
schema migrations. Deploy frontend and server from the same tested revision.
Run npm run build, then the complete disposable PostgreSQL gate (cd server;
npm test). The new P0 database integration tests have NOT run locally because
PostgreSQL is absent; they must pass in CI before release approval.

After test deployment run node server/scripts/test-deployment.mjs, then the
signed-in P0 cases in the updated regression workbook. Physical camera/mic
one-tap behavior was user-confirmed on Android and iPhone before this patch.
No authenticated live acceptance or production release is claimed.

Files replaced/added: 51. Obsolete files removed: 36.
