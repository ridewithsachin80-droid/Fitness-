FITLIFE — TEST GATE #56 REPAIR

Apply these nine changed files ON TOP OF your current test branch.
Base: fc7003fc1baa94d61dc39143052c355f1309adda
Repair: cb9a1ac17ed86ef40818ec1dc818f861d736f109

1. Extract the ZIP. Upload server/ and qa/ to the repository ROOT on branch
   test, replacing matching files and preserving the folder structure.
   Keep all other app files. Do not upload a wrapper folder or the ZIP itself.
2. Include .github/workflows/test-gate.yml for regression evidence uploads.
   If your file picker hides .github, edit that file directly in GitHub and
   paste the supplied replacement. The core fix works with your existing
   workflow because npm test now builds before testing.
3. Commit these changes to test. Wait for the NEW Test gate run; rerunning
   run #56 uses its old commit and cannot apply the fix.
4. Require the new gate to pass, deploy that test revision, then run the
   signed-in P0 cases in the updated Excel workbook.

Cause: UI tests combined obsolete CSS files left by previous uploads, while
the old workflow tested before a clean build. This repair uses only the
stylesheets referenced by the built HTML and makes npm test build first.
No application feature or visual design is changed. Layout/theme checks
remain intact, and a new four-check regression protects stylesheet loading.

Verified:
- GitHub fc7003f: all 49 PostgreSQL suites passed (2,316 assertions), and
  20 logic/module suites passed (1,049 assertions). Only UI failed.
- Reproduced: premium UI had 92 passing and 20 failing checks.
- CSS-only correction, with obsolete files retained: all 112 checks passed.
- Clean build, then 1,858 local assertions across 22 suites: zero failures.
- npm test ran its build first and then stopped because local PostgreSQL
  is unavailable. A full local database-gate pass is not claimed.
- Read-only test-site smoke: 13 checks passed. Signed-in acceptance blocked.

This repair has not been pushed or deployed by the assistant. GitHub write
access was denied. No production or real member data was changed.

Alternative for a clean checkout at the base commit:
  git apply --check /path/to/ci56-repair.patch
  git apply /path/to/ci56-repair.patch

CI56-README.txt and ci56-repair.patch are installation aids, not app files.
