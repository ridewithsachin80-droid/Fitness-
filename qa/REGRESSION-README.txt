FITLIFE — PHASE 2 REGRESSION
Base: d7a2826b0ffc62cae8ea58c0a475b49331f6db24 on test.
Target: https://fitness-test.up.railway.app/ (test only).

Phase 2 adds shared English/Hindi/Kannada speech preferences and request-specific
recovery for AI text, photos and recorded audio. Home remains minimal. Existing
AI reviews, quantities/macros, weight, tools, themes and P0 fixes remain.

REPEATABLE GATE
1. Install from repository root, then npm ci in server.
2. cd server; npm test
   This builds the client first, creates an isolated localhost PostgreSQL on
   port 5433 and runs all 73 registered suites. Never point fixture tests at
   a live database. The existing database guard is retained.
3. Require a new green GitHub Test gate on the Phase 2 commit.
4. Deploy that test revision, then from repository root run:
   node server/scripts/test-deployment.mjs
5. Run the Excel Acceptance cases with disposable member/coach/admin accounts.
   Start with P0; then run Phase 2 voice/recovery cases on Android and iPhone,
   browser/PWA where applicable, both themes and enlarged text.

NEW COVERAGE
- test-logging-phase2.mjs: actual components/hooks/shared consumers, request
  snapshots, retry/edit/newer drafts, native picker ownership, session/day
  invalidation, bounded recordings, permission fallback and 320/390px layouts.
- test-voice-phase2.js: authenticated Express route with synthetic providers,
  language allowlist, regional/mixed speech prompts, fallback, payload bounds,
  retry byte fidelity and member-facing errors.
- All original 71 suites remain registered; layout/theme assertions unchanged.
- Component-size regression caught during first build was fixed by extracting
  request recovery and food voice status. No test threshold was relaxed.

EVIDENCE SCOPE
Final local build passed. All 24 available suites passed: 2,085 assertion rows,
zero failures (1,280 logic/component checks + 805 full UI checks including
112 nested premium checks). The focused new suites account for 227 checks.
The complete results are in the accompanying Excel and evidence ZIP.
The complete local database gate is blocked by missing PostgreSQL. Baseline
GitHub run 57 passed 71 suites / 4,174 assertions, including 49 database suites;
this historical green result is not a Phase 2 CI pass.

Read-only Railway smoke currently sees the previous frontend. Phase 2 is not
pushed or deployed. Health/authenticated-access rejection checks do not replace
signed-in member/coach acceptance. Earlier physical camera/mic confirmation is
retained in report notes; repeat it after this voice change. Synthetic speech
fixtures do not prove real recognition quality or Kannada accuracy.

qa/manual-regression.tsv is the complete manual case checklist. The Excel also
contains actual executed assertion rows, all registered suites and the source
catalog, with local, baseline CI and deployed results distinguished.
