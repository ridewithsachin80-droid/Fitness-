# Current roadmap update — Phase 5

The current release plan is [PHASE5-AI-DRAFT-EDITS.md](PHASE5-AI-DRAFT-EDITS.md).
Verified installed baseline is test `3da43bd01b731b8bc09687b208de51b0c2680e01`,
matching local `b4d1dce`; CI63 passed 78 suites / 4,760 assertions. The nutrition
fix is deployed: observed text consistency passed, UAT-213 remains Partial
because photo/save acceptance is pending. UAT-212 remains Fail for spaced
hyphen ambiguity. Phase 5 implements bounded unsaved-food AI edits; it still
needs its own CI, deployment and live/device acceptance. Catalog:233 cases.

The following Phase 4 plan is preserved as a historical record. Its earlier
package, pending-deployment and Not run statements describe that release stage;
use Phase 5 for current deployment instructions and backlog status.

---

# Phase 4 — accessibility pass and complete pending plan

Release-plan update: 13 October 2026. Verified installed meal-clarification
baseline: test `4b1f605a12c38d6001b4f1874792f2aa911db585`, matching local
application source `f6686fc431006ff46a787e4943d3a6c40cdbbe3f`. CI 62 passed
78 suites / 4,748 assertions. Original sambar and UAT-209–211 observed text
branches passed live. A separate carbohydrate-preview consistency fix is local
and needs fresh CI/deployment; symbolic-minus interpretation remains open with
prompt hardening only. See `PHASE4-NUTRITION-CONSISTENCY-FIX.md`.

The catalog now has 213 cases. New UAT-213 covers preview/portion carbohydrate
consistency; UAT-212 retains the live symbolic-minus failure. Historical result
counts and Not run statements below describe their original release stages.

This phase improves interaction with existing dialogs and controls. It preserves
the minimalist Home and existing functionality. It is a **partial accessibility
pass**, with physical assistive-technology testing, remaining legacy modals and
a broad contrast review still pending. It does not claim WCAG certification.

“Phase 4” here follows the October member logging, voice/recovery and AI review
receipt builds. The older `DELIVERY-PHASE4.md` is a different historical release.
This plan carries forward the complete Phase 3 backlog and limits; an item listed
below is not an assertion that the entire feature is missing or newly delivered.

## Evidence, deployment and package state

| Evidence | Revision / result | How to use it |
| --- | --- | --- |
| Verified Phase 4 baseline | `1c0c0408`, matching local `507c2e4` | Frontend verified; all 58 packaged files match GitHub blob hashes. Matching app source includes the Phase 3 foundations. This does not close device/member UAT. |
| Phase 4 GitHub Test run 61 | **76 suites / 4,642 assertions passed** | 26 logic/module suites / 1,509; 49 database suites / 2,316; full UI / 817. Client build passed. Evidence in `qa/results/phase4-deployed/`. Optional ESLint was Not run. |
| Historical GitHub Test run 59 | 74 suites / 4,447 assertions passed | Evidence for the preceding release only. |
| Historical Phase 3 local gate | 26 available suites / 2,242 assertions passed | Includes 25 logic/module suites with 1,425 assertions and full UI with 817, including 124 premium assertions. Do not add the focused premium rerun again. |
| Phase 4 production build | **PASS** | Final frontend asset: `/assets/index-zar7u_1L.js`. |
| Phase 4 focused modal/browser run | **84 assertions passed** | `test-modal-accessibility.mjs`; included in the local total below. Synthetic accounts and media do not replace physical-device acceptance. |
| Phase 4 available local gate | **27 suites / 2,326 assertions passed; 0 failed** | 26 logic/module suites with 1,509 assertions, plus full UI with 817 (693 core and 124 nested premium). Historical and separate focused reruns are not added again. |
| New meal-clarification fix: build and available local regression | **Build PASS; 29 suites / 2,432 assertions passed; 0 failed** | Includes new server 46 and client 60 checks. Main asset: `/assets/index-DyjU6GwD.js`; exact revision in `MEAL-CLARIFICATION-INSTALL.txt`. Baseline CI run 61 does not certify this changed source. |
| New fix complete CI/database gate, deployment and live/device acceptance | **PENDING** | New fix is not deployed. Preserve device/UAT gaps separately from baseline source/CI confirmation. |

Deliver **one incremental meal-clarification updated-files ZIP** on top of
installed `1c0c0408`, using matching local `507c2e4` as the source base. Include
only changed/new files, the matching client build and new helper/test files in
their repository paths. No deletions, migrations or new environment variables
are required. Do not reapply the older cumulative Phase 3/Phase 4 ZIP.

The final fix package manifest must record the new revision and frontend asset;
both are currently pending. Verify included files, archive CRC and any patch
against the clean intended baseline. A green Railway service
or anonymous health response does not prove the changed UI, matching backend or
member writes are working. Keep Failed, Blocked and Not run distinct.

The user's earlier Android/iPhone one-tap camera and microphone confirmation is
preserved as historical acceptance. Repeat relevant cases for the new revision;
synthetic capture/speech fixtures do not prove physical behavior or recognition
quality. Source review and synthetic tests are not destructive live testing.

The live review `2 idlis and sambar for breakfast` showed only Idli (80 g,
107 kcal); specifying `1 bowl sambar` showed both foods (176 kcal). The new fix
retains named missing/invalid amounts as separate unresolved questions and adds
bounded latest-review clarification context. It cannot detect a model omitting
both arrays or guarantee a model never repeats reviewed food. Earlier notices
remain historical; the original raw provider path was not captured. See
`PHASE4-MEAL-CLARIFICATION-FIX.md`. The manual catalog now has 212 cases;
new UAT-209–212 are Not run. This does not complete general pending-card editing.

The roadmap source remains `docs/reviews/FitLife-UX-Review.html`, especially its
feature-preservation map and prioritized enhancements. Its October 12 validation
section is historical; the September sprint document also contains completed
work and superseded navigation proposals.

## Feature checklist — retain throughout every build

- [ ] Today, Progress and More remain the three main destinations; both themes,
  larger text, compact Home and progressive disclosure remain available.
- [ ] Speak opens capture from the initial tap; Snap invokes the camera from the
  initial tap; Type focuses the composer. Gallery upload stays a separate action.
- [ ] Photo selection starts analysis. AI output remains an editable review,
  with explicit Save; no parse, retry, example or repeat suggestion silently logs.
- [ ] Food quantities, grams, household portions, meal slots, inclusion toggles
  and macros remain editable. Canonical quantities/macros drive the review;
  model prose cannot claim an unsaved entry is saved or contradict its totals.
- [ ] My usual, recent/saved meals, manual search, copy previous meals, supported
  barcode lookup, personal labels, portion memory and forgetting corrections stay.
- [ ] Weight, water, sleep, activity, habits/protocol, supplements, notes,
  workouts, body measurements and lab review retain their existing entry routes.
- [ ] English, Hindi and Kannada use the shared speech preference. Request Retry,
  Edit and Replace preserve their exact request and any newer composer draft.
  Raw retry photos/audio remain bounded, memory-only and owner/session/day scoped.
- [ ] Full meal/training plans, nutrition detail, fasting where enabled,
  historical dates, daily entries, check-ins, progress photos, voice pilot,
  health/lab reports, devices, preferences, PIN and sign-out stay accessible.
- [ ] Coach replies, triage, programs, member views and protected admin tools stay.
- [ ] P0 authentication/date guards, owner-aware offline queue, conflict handling,
  private cache isolation, explicit failed-save recovery and source labels stay.

The checkboxes are regression obligations for the new build, not unfinished
feature claims. The foundations are already present in `DailyLog.jsx`,
`MemberMore.jsx`, the existing sheets/stores and the October preservation map.

## Phase 4 scope and acceptance still to record

| ID | Bounded change in this build | Required acceptance |
| --- | --- | --- |
| P4-01 | Shared modal stack for Sheet and participating AI modal roots. | Only the topmost modal owns focus and Escape; underlying interactive roots do not intercept the active dialog's input. |
| P4-02 | Nested focus containment, Escape handling, scroll locking and focus return. | Tab/Shift+Tab remain in the active dialog; closing its child preserves the parent; close order restores scroll and a valid trigger/fallback focus. |
| P4-03 | Visible keyboard focus, readable dialog titles and 44px targets in the touched controls. | Keyboard paths, accessible names, both themes, narrow widths and enlarged text remain usable; verify actual target dimensions. |
| P4-04 | MacroEditor units and status; VoiceComposer transcript label and status. | Keyboard editing, unit interpretation and meaningful status exposure remain correct. Physical screen-reader announcements require supported-device testing. |
| P4-05 | Progress past-day review uses shared Sheet behavior. | Historical entries remain reachable; opening, nesting and closing preserve the selected day, navigation and focus without changing saved data. |
| P4-06 | New modal browser suite and manual acceptance extension. | The baseline browser suite passed 84 assertions. The catalog now has 212 cases: Phase 4 UAT-193–208 and new meal-clarification UAT-209–212 retain separate manual results. New 209–212 remain Not run. |

The shared infrastructure does not mean every older modal was migrated. Remaining
legacy Milestone/staff modals, the broad measured contrast pass and physical
screen-reader/device acceptance are explicit follow-up work. No standing logging
feature or entry route is removed to make this pass look complete.

## Phase 3 foundation retained in the verified Phase 4 baseline

| ID | Existing Phase 3 source behavior retained | Member acceptance still required where not executed |
| --- | --- | --- |
| P3-01 | Per-card Save/Edit/Undo receipts are tied to the review, owner, session and date. | Apply A then B; acting on A does not use B's receipt or duplicate writes. |
| P3-02 | Reversal protects unrelated later edits and reports overlapping changes. | Manual entries survive; Edit returns to review before reapplying. |
| P3-03 | Saving, queued, failed and reverted status reflects persistence outcomes. | Failed reversal and safe retry never claim success prematurely or duplicate a log. |
| P3-04 | Daily-log, workout and body-metric outcomes are reported independently. | Successful destinations are not reapplied; unknown append outcomes are not blindly retried; weight is not claimed saved when absent, queued or failed. |
| P3-05 | Workout reversal handles the previous session, including a previously empty session, with a client read/compare safeguard. | Preserve later conflicting workouts; do not describe the safeguard as an atomic cross-device guarantee. |
| P3-06 | Async save/retry/undo uses account/session/day/chat guards. | Late outcomes cannot change a replacement chat, another day/account or a newer draft. |

These source changes now match the verified Phase 4 baseline and passed CI run
61. Retest them in the incremental fix's regression; source/CI confirmation does
not replace unexecuted live write/device acceptance. Keep the existing component-
size gate rather than relaxing it for integration work.

## Phase 3 backend limits retained

- **Standalone lab report save receipts:** `AIChatLog.jsx` also has a separate
  lab-report `saveLabs` flow. Phase 3 adds owner/session/chat/date guards,
  duplicate protection that survives remount/day return, protection for newer
  weight edits, confirmed-result locking and truthful weight-save status.
  Confirmed lab rows are not appended again when retrying the weight save;
  unknown append outcomes remain protected from blind retry. Complete per-record
  receipts, server idempotency and reversal are still follow-up work. Lab upload,
  review and save already exist; this is not a missing lab feature.
- **Cross-device workout concurrency:** checking the current session with GET
  before POST is a best-effort client safeguard. A different device can change
  the workout between those requests. Complete protection needs a server-side
  revision/conditional-write or transactional operation contract and concurrent
  database tests; client comparison alone must not be described as atomic.
- **Body-metric idempotency and reversal:** saving scale measurements already
  exists. Safe replay after an unknown network outcome and precise reversal need
  an idempotent record API and an owned record/reversal contract. Until those
  exist, preserve the unknown-outcome warning, avoid blind retry and do not claim
  that a body-history record was removed by reversing only the daily log.

## P0 acceptance and new-fix release gates

| ID | Required evidence for this revision | Boundary |
| --- | --- | --- |
| RELEASE-01 | Fresh production build, focused clarification/modal/transaction/component/route tests and the complete registered regression gate for the new fix commit; preserve failed-run evidence and rerun after fixes. | Phase 4 CI run 61 passed all 49 database suites but cannot certify changed source. The new database gate needs isolated disposable PostgreSQL; never use the live database for fixtures. |
| RELEASE-02 | Require the new fix's GitHub Test gate and matching frontend/server deployment, then run health and asset checks. | Baseline source/CI and frontend are verified at `1c0c0408`; the fix is not deployed. Health alone does not prove member writes or a matching backend. |
| RELEASE-03 | On disposable test accounts: text/photo/voice review, quantity and macro edit/cancel, single save, two cards, older-card Edit/Undo, intervening manual edit, partial failure and retry, account/day changes. | Record expected result, actual result, revision and evidence for each case. Use controlled fixture failures locally when an equivalent live failure cannot safely be induced. |
| RELEASE-04 | Android and iPhone browser/PWA where supported: direct camera/mic, permission denial recovery, interruption, keyboard, navigation, reopen and retry; light/dark and enlarged text. | Record actual device/browser and outcome. Test fixtures and desktop emulation remain separate evidence. |
| RELEASE-05 | Owner-safe offline queue/reconnect, pending-sync status, restart behavior, conflicting edits and shared-device sign-out/account switch under an installed service worker. | Distinguish supported warm-session offline behavior from the not-yet-designed cold-start offline experience. |
| RELEASE-06 | Regression workbook plus changed-files ZIP in original repository structure, with exact baseline, release revision, gate results and pending/UAT rows. | “Not run,” “blocked” and “failed” stay distinct. Do not report a workbook's unexecuted checklist as passed testing. |
| RELEASE-07 | Execute UAT-193–208 on supported browsers/devices: nested dialogs, topmost focus and Escape, scroll/focus restoration, history, voice/macro status, both themes and larger text; verify the final 16-case extension. | A synthetic browser pass does not certify physical screen-reader behavior or app-wide WCAG compliance. Record device, assistive technology and actual outcome. |
| RELEASE-08 | Execute new UAT-209–212 after deploying the meal fix: mixed/unspecified portions, short answers, invalid quantities, totals and deliberate Save. | All four are Not run. Distinguish labeled editable estimates from unresolved rows; preserve actual provider outputs and do not claim deterministic omission/repetition protection. |

## Remaining P1 enhancements

| ID | Present foundation | Remaining bounded work | Acceptance |
| --- | --- | --- | --- |
| P1-A11Y | Phase 4 addresses the shared Sheet/participating AI modal stack, topmost focus/Escape/scroll restoration, touched labels/status, focus styling, target sizes and Progress past-day Sheet. | Finish physical screen-reader/device checks; migrate and test remaining legacy Milestone/staff modals; complete measured contrast and enlarged-text review across the wider app. Current work is a partial pass. | Real supported-browser keyboard and assistive-technology results; measured contrast; no inaccessible or clipped controls at narrow widths/enlarged text. Do not infer WCAG certification from fixture focus or overflow checks. |
| P1-DRAFT-EDIT | Current unsaved foods/metrics are summarized for AI context by `aiContextText`; saved foods support name-based corrections. | Give pending cards/rows stable correction targets so “make that 150 g” or “that was dinner” edits the intended unsaved review. `context.lastFoods` and the server correction whitelist currently contain saved foods only. Clarify ambiguous references instead of guessing or creating another meal. | Photo → follow-up quantity/meal edit updates the same review; no daily-log write before Save; two similarly named foods remain distinguishable; account/day/reset guards hold. |
| P1-ADVICE | Standalone questions preserve model answers. Structured logging reviews show deterministic pending prose and canonical totals. | Separate advisory text from logging/status claims so a mixed “log this and answer my question” can show useful advice without reintroducing false saved claims or stale model totals. | Pure Q&A unchanged; mixed request displays useful answer plus editable unsaved entries; Hindi/Kannada/mixed-language cases; no model-sourced save receipt. |
| P1-TIMELINE | Logged-today rows already open working manual sheets. | Carry the selected meal/item target into FoodSheet, initially focus/scroll to it, and keep every other food reachable. `Timeline.jsx` currently opens the whole food sheet for every meal. | Tapping Breakfast opens Breakfast's relevant controls with fewer navigation steps, while historical dates, unsorted foods and the full editor still work. |
| P1-OFFLINE | Owner-aware queue, warm-session cached reads, failed-save retry and safe temporary auth-restoration failure handling exist. | Design an explicit account-safe cold-start offline re-entry policy and unavailable-action messaging. `App.jsx` still restores identity through `/api/auth/refresh`; `authStore.js` keeps access tokens in memory. Decide access, expiry, sign-out and shared-device rules before implementation. | Approved offline-access model; draft retention without cross-account disclosure; network loss, restart, expired/revoked session and account-switch acceptance. Never restore private records by URL alone. |
| P1-CACHE | Private API caches are session partitioned and cleared on sign-out. | Complete the October review's follow-up on retention bounds/storage lifecycle and installed-worker account-switch behavior; do not undo cache isolation to enable offline entry. | Bounded stale data, cleanup across updates/rotation/sign-out, and no prior member data under another account or unauthenticated request. |

The first four October P1 proposals are already delivered foundations: My usual
(`chat/UsualMeals.jsx`), household portions (`HouseholdPortion.jsx`,
`householdPortions.js`), food provenance (`AIFoodReview.jsx`) and shared language /
request recovery (`useVoiceInput.js`, `useAIRequestRecovery.js`). Real-device
speech accuracy and member acceptance remain validation work; they do not make
those entire features “not built.” P1-DRAFT-EDIT, P1-ADVICE and P1-TIMELINE are
source-review follow-ups, not entries copied from the original October table.

## Remaining P2 enhancements

| ID | Present foundation | Remaining bounded work | Acceptance |
| --- | --- | --- | --- |
| P2-WORKOUT | `WorkoutLog.jsx` already contains exercise/set logging, history, suggested loads, rest timer, voice set input, substitutions and autosave, inside `WorkoutSheet.jsx`. | A compact focused-session presentation with a clear next set and previous performance. Reuse the current models; retain the full-session route. | Previous/load/reps are visible at the moment of entry; coach changes remain reviewable; interrupted edits recover; no repeated or dropped sets. This is consolidation, not building workouts from zero. |
| P2-REMINDERS | Admin/personal schedules, acknowledgement-based retries, member schedule display, messaging quiet hours, daily reads/digests and nudge tracking exist. | Consolidate a relevant next action, personal quiet-time/snooze controls and completed-task suppression across the applicable channels. Generic reminder retries currently key off acknowledgement; quiet hours exist in `messaging.js` but are not a uniform member control for every direct push path. | Once the target is complete, the relevant reminder stops; snooze/quiet times apply as described; deduplication and coach ownership remain; no extra dashboard badges or guilt-driven pressure. |
| P2-MEASURE | Existing operational notification logs, evaluation samples and progress analytics are not a member logging funnel. | Add minimal privacy-conscious completion/abandonment/correction/latency events and 7/28-day logging return measurement. No dedicated funnel integration was found in the inspected client/server source. | Document event definitions and retention/access; collect no raw foods, photos, recordings or medical text in event properties; validate counts/deduplication before drawing product conclusions. |
| P2-PILOT | Source and fixture/browser checks describe behavior, not real member ease or retention. | Run the October review's small 8–12-member pilot across meal photo, mixed voice, repeat breakfast, past-day correction and interrupted save. Include larger text and mixed-language members. | Record taps, time, uncertainty and errors against a comparable baseline; use findings to order subsequent changes. Do not infer retention gains from visual polish. |

Recommended sequencing: finish the incremental meal fix's build/CI/deployment
gates and record remaining accessibility/device findings; then work on targeted AI draft
corrections/advice and timeline editing. Design cold-start offline access
separately. Bring workout/reminder presentation and measurement forward when
reliability results and member evidence support the change. Preserve existing
functions and keep the member's entry point simple throughout.
