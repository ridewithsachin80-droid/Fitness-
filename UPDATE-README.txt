FITLIFE — PHASE 3: RELIABLE AI SAVE, EDIT AND UNDO
Updated files only; repository folder structure retained.

Base test commit: 8a1da6560e422bdd313e54b70565a455a9815d07
Target: https://fitness-test.up.railway.app/

INSTALL
1. Extract FitLife-Phase3-Updated-Files.zip. Copy its client/, server/, qa/ and
   docs/ folders plus UPDATE-README.txt into the existing repository root on
   branch test. Preserve paths and replace matching files.
2. Include all new components, hooks and utilities. client/dist contains the
   rebuilt UI. There are no new dependencies, migrations or environment values.
3. Commit to test and require a NEW green GitHub Test gate. The previous run59
   passed 74 suites / 4,447 assertions; that is baseline evidence only.
4. Deploy that exact test revision through Railway. Reload FitLife and accept
   the update prompt. Check the frontend asset named in PHASE3-INSTALL.txt.
5. Run node server/scripts/test-deployment.mjs and the Excel's new UAT-175–192
   plus existing P0 cases with disposable member/coach accounts and real phones.

WHAT CHANGED
- Each AI review owns its Save/Edit/Undo receipt, account, session and day.
- Undo preserves unrelated later entries and explains overlapping corrections.
- Failed persistence remains recoverable without applying the review twice.
- Daily log, workout and body-metric outcomes are reported independently.
- Workout reversal restores the prior contents, including a previously empty
  session. A later conflicting workout is protected by a read/compare check.
- Body metrics already saved remain in Health records when the daily review
  is reversed. An uncertain append cannot be blindly retried or auto-resubmitted.
- Home remains minimal with Today / Progress / More, Weight, both themes,
  direct Speak / Snap / Type, editable quantities/macros and existing tools.

LIMITS AND REMAINING WORK
See docs/reviews/PHASE3-PENDING-PLAN.md for the complete prioritized backlog.
Truly simultaneous workout writes need atomic server revision checks. The
append-only body-metric API needs idempotency and supported record reversal.
This client build does not claim to supply those server guarantees.

VERIFICATION
See qa/REGRESSION-README.txt, the updated Excel and evidence ZIP for actual
results. The new complete CI, deployment and signed-in acceptance are pending.
Local PostgreSQL is unavailable, so 49 database suites require the GitHub gate.
The assistant has not pushed or deployed this build.

PATCH ALTERNATIVE (clean checkout at the stated base)
  git apply --check /path/to/phase3-update.patch
  git apply /path/to/phase3-update.patch
Use the folder replacement OR the patch, not both. PHASE3-INSTALL.txt and the
patch are installation aids. The Excel/evidence ZIP are testing reports.
