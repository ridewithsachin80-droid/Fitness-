FITLIFE — PHASE 4: ACCESSIBILITY AND MODAL INTERACTIONS
Cumulative Phase 3 + Phase 4 updated files; repository paths retained.

Verified deployment / patch target: 8a1da6560e422bdd313e54b70565a455a9815d07
Source diff base: 43a69b3fcf149132d13a890fff6add8e5d4c2c57
Phase 4 development base: 3386271329f259e6f5954e29b9d2d0a33b049af5
Final package revision: see PHASE4-INSTALL.txt in the code ZIP
Final frontend asset: /assets/index-zar7u_1L.js
Target: https://fitness-test.up.railway.app/ (branch test only)

WHICH ZIP TO USE
Use one cumulative FitLife-Phase4-Updated-Files.zip. It includes Phase 3 and
Phase 4 because Phase 3 deployment has not been confirmed. Its source diff is
prepared from 43a69b3, whose app source matches verified deployment 8a1da65;
unrelated workflow differences and installation-aid deletions are excluded.
The final patch must be checked against a clean 8a1da65 checkout before release.
The folder overlay supports the verified baseline or an existing Phase 3
checkout. Do not install the separate Phase 3 ZIP as well. The Excel and
evidence ZIP are reports, not app code.

INSTALL
1. Extract the cumulative ZIP. Copy every included path into the repository
   root on branch test, preserving client/, server/, qa/, docs/ and included
   root files. Replace matching files. If the checkout contains later changes,
   review and merge them instead of overwriting them blindly.
2. Include every new hook, utility and test. Apply the coherent client/dist
   build. This overlay does not require file deletions.
   A separate Phase 3 installation is not required.
3. Run the complete regression gate and require a NEW green GitHub Test result
   for the final package commit. Historical run 59 passed 74 suites / 4,447
   assertions for the preceding release; it does not certify this package.
4. Deploy that exact commit to the named Railway test service. Reload FitLife,
   accept the update prompt and verify the deployed revision and frontend asset
   against the final package manifest. A green Railway service alone does not
   prove that this UI and its matching server revision are running.
5. Run node server/scripts/test-deployment.mjs, then the workbook's P0 cases,
   Phase 3 UAT-175–192 and Phase 4 UAT-193–208 using disposable test accounts.
   The catalog contains 208 cases, including 16 new Phase 4 cases. Include
   supported Android/iPhone browser/PWA paths, keyboard, both themes and larger
   text. Keep real member records intact.

INCLUDED SCOPE
- Phase 3 per-card AI Save/Edit/Undo receipts and truthful partial-save status,
  safe retry, account/day guards and protection for unrelated later edits.
- Shared modal stack for Sheet and participating AI modal roots: topmost focus
  containment, nested Escape handling, scroll locking and focus return.
- Visible keyboard focus, 44px targets in touched controls, readable dialog
  titles, MacroEditor units/status and VoiceComposer transcript/status labels.
- Progress past-day review uses the shared Sheet behavior.
- Existing logging, review, correction and navigation features remain:
  minimal Today / Progress / More, Weight, light/dark themes, direct Speak /
  Snap / Type, editable quantities/macros and existing member/staff tools.

WHAT REMAINS
This is a partial accessibility pass. Physical screen-reader/device testing,
remaining legacy Milestone/staff modals and the broad measured contrast review
remain pending. This package does not claim WCAG certification.
Phase 3 backend limits also remain: atomic cross-device workout revisions,
body-metric idempotency/reversal and complete standalone lab-record receipts.
See docs/reviews/PHASE4-PENDING-PLAN.md for the full ordered backlog.

VERIFICATION
Phase 4 production build: PASS
Phase 4 focused modal/browser test: PASS — 84 assertions (included below)
Phase 4 available local gate: PASS — 27 suites / 2,326 assertions; 0 failed
Phase 4 new full GitHub CI: PENDING
Matching deployment and signed-in/device acceptance: PENDING
Historical Phase 3 local result: 26 suites / 2,242 assertions passed; deployment
is not confirmed. Do not add historical counts to the Phase 4 total.
Local PostgreSQL is unavailable; new database acceptance requires the isolated
CI gate. See qa/REGRESSION-README.txt and the final workbook/evidence package.

PATCH ALTERNATIVE — CLEAN 8a1da65 CHECKOUT ONLY
  git apply --check /path/to/phase4-update.patch
  git apply /path/to/phase4-update.patch
The patch alternative is cumulative and targets 8a1da65; do not apply it to an
already-updated Phase 3 checkout. Use the folder overlay there. Apply either the
cumulative patch OR the folder replacement, not both.
