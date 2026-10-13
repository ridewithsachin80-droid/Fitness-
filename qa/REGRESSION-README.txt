FITLIFE — PHASE 3 REGRESSION
Base test commit: 8a1da6560e422bdd313e54b70565a455a9815d07
Target: https://fitness-test.up.railway.app/ (test only).

REPEATABLE GATE
1. Install dependencies from the repository root and server package locks.
2. cd server; npm test
   The pretest builds the client. test-local.sh creates isolated localhost
   PostgreSQL on port5433 and runs every registered suite. Never point fixture
   tests at the live database. Existing database guards remain.
3. Require a new green GitHub Test gate for this exact Phase 3 commit.
4. Deploy that test revision, then from the repository root run:
   node server/scripts/test-deployment.mjs
5. Run the Excel Acceptance cases with disposable member/coach/admin accounts.
   Start with P0, then UAT-175–192. Test Android/iPhone browser/PWA as applicable,
   both themes, larger text and interrupted saves. Keep real member logs intact.

NEW COVERAGE
test-ai-save-receipts.mjs mounts the actual AI review and log store with
synthetic storage. It covers independent cards, newer manual edits, overlap
conflicts, repeated taps, Edit/resave, failed reversal, safe retry, partial
destinations, date/account guards and workout/body-metric boundaries.
All prior voice, photo, portion, cache, offline, session and full UI suites
remain registered. No component-size or layout threshold is relaxed.
qa/manual-regression.tsv now has 192 scenarios, including 18 new receipt cases.

EVIDENCE SCOPE
The accompanying workbook's Phase 3 runs and Phase 3 checks hold actual local
results; previous suite/catalog/patch sheets retain historical evidence.
Production build passed. All 26 available local suites passed 2,242 assertions:
25 logic/module suites: 1,425; full UI: 817 (includes 124 premium assertions).
The separate focused premium pass is not added again. No app gate was relaxed.
Optional lint was not run: eslint is not installed in this local environment.
Local PostgreSQL remains unavailable. A new full CI must run the 49 database
suites before test deployment; previous CI success cannot certify this revision.

The preceding deployment (8a1da65) passed GitHub run59:74 suites /4,447
assertions, 13 public deployment checks and a scoped draft-only live retest.
Phase 3 is a new local build, not deployed. Health checks alone do not verify
member save/reload, coach visibility, backend revision or physical devices.
The user's earlier camera/mic confirmation is preserved; retest relevant cases
on this build. Synthetic speech fixtures do not prove real recognition quality.

Known backend limits and all remaining enhancements are recorded in
docs/reviews/PHASE3-PENDING-PLAN.md. Unexecuted acceptance cases stay Not run.
