FitLife phase 1 — updated files only

Base: 65a70a5e6d4ec022b2de284d68a96164f1908d60
Commit: 5091dd007814b6f46a858f48c24f1bef1d6acd50

Copy the included .github, client, server and qa folders into the repository root on branch test. Include .gitignore. Do not upload the ZIP itself as the app.
DELETE-FILES.txt lists obsolete tracked build files to remove. Unchanged source files and dependencies are intentionally omitted. No database migrations are required.

For a clean checkout of the exact baseline, update.patch is an alternative: git apply --check update.patch, then git apply update.patch. Apply either the patch OR the folders, not both.

Run npm run build, then server npm test on isolated localhost PostgreSQL before release. Deploy the matching test commit and run server/scripts/test-deployment.mjs followed by P0 acceptance cases in Excel. See qa/REGRESSION-README.txt.

GitHub write access was denied, so this build has NOT been pushed or deployed.
