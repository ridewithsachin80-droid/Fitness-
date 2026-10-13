# Phase 4 — accessibility pass and complete pending plan

Release-plan update: 13 October 2026. Development baseline:
`3386271329f259e6f5954e29b9d2d0a33b049af5`.

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
| Last verified deployment | `8a1da65` | Deployment baseline; Phase 3 deployment has not been confirmed. |
| Historical GitHub Test run 59 | 74 suites / 4,447 assertions passed | Evidence for the preceding release only. |
| Historical Phase 3 local gate | 26 available suites / 2,242 assertions passed | Includes 25 logic/module suites with 1,425 assertions and full UI with 817, including 124 premium assertions. Do not add the focused premium rerun again. |
| Phase 4 production build | **PASS** | Final frontend asset: `/assets/index-zar7u_1L.js`. |
| Phase 4 focused modal/browser run | **84 assertions passed** | `test-modal-accessibility.mjs`; included in the local total below. Synthetic accounts and media do not replace physical-device acceptance. |
| Phase 4 available local gate | **27 suites / 2,326 assertions passed; 0 failed** | 26 logic/module suites with 1,509 assertions, plus full UI with 817 (693 core and 124 nested premium). Historical and separate focused reruns are not added again. |
| New complete GitHub gate, matching deployment and signed-in/device acceptance | **PENDING** | Required for this exact revision. Local PostgreSQL is unavailable; prior database passes do not certify current source. |

Deliver **one cumulative updated-files ZIP containing Phase 3 + Phase 4**. Its
app-source diff is prepared from local source base
`43a69b3fcf149132d13a890fff6add8e5d4c2c57`, whose app source matches uploaded
`8a1da6560e422bdd313e54b70565a455a9815d07`; unrelated workflow differences and
installation-aid deletions are excluded. Verify the cumulative patch against a
clean `8a1da65` checkout before release. The folder overlay supports either that
baseline or an existing Phase 3 checkout. The patch alternative targets only the
clean `8a1da65` baseline. A separate Phase 3 ZIP is not required.

The code ZIP's `PHASE4-INSTALL.txt` records the exact final local revision and
frontend asset. Package generation verifies every included file, archive CRC
and patch applicability to the clean uploaded baseline. A green Railway service
or anonymous health response does not prove the changed UI, matching backend or
member writes are working. Keep Failed, Blocked and Not run distinct.

The user's earlier Android/iPhone one-tap camera and microphone confirmation is
preserved as historical acceptance. Repeat relevant cases for the new revision;
synthetic capture/speech fixtures do not prove physical behavior or recognition
quality. Source review and synthetic tests are not destructive live testing.

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
| P4-06 | New modal browser suite and manual acceptance extension. | The browser suite passed 84 assertions. The catalog has 208 cases, including 16 new cases UAT-193–208; their deployed/manual results remain Not run. |

The shared infrastructure does not mean every older modal was migrated. Remaining
legacy Milestone/staff modals, the broad measured contrast pass and physical
screen-reader/device acceptance are explicit follow-up work. No standing logging
feature or entry route is removed to make this pass look complete.

## Phase 3 foundation included in the cumulative package

| ID | Existing Phase 3 source behavior retained | Acceptance still required for the cumulative release |
| --- | --- | --- |
| P3-01 | Per-card Save/Edit/Undo receipts are tied to the review, owner, session and date. | Apply A then B; acting on A does not use B's receipt or duplicate writes. |
| P3-02 | Reversal protects unrelated later edits and reports overlapping changes. | Manual entries survive; Edit returns to review before reapplying. |
| P3-03 | Saving, queued, failed and reverted status reflects persistence outcomes. | Failed reversal and safe retry never claim success prematurely or duplicate a log. |
| P3-04 | Daily-log, workout and body-metric outcomes are reported independently. | Successful destinations are not reapplied; unknown append outcomes are not blindly retried; weight is not claimed saved when absent, queued or failed. |
| P3-05 | Workout reversal handles the previous session, including a previously empty session, with a client read/compare safeguard. | Preserve later conflicting workouts; do not describe the safeguard as an atomic cross-device guarantee. |
| P3-06 | Async save/retry/undo uses account/session/day/chat guards. | Late outcomes cannot change a replacement chat, another day/account or a newer draft. |

These source changes are included because Phase 3 deployment is not confirmed.
Retest them with the Phase 4 build; the historical 26-suite local result is not a
new deployment acceptance result. Keep the existing component-size gate rather
than relaxing it for integration work.

## Phase 3 backend limits retained in the cumulative package

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

## P0 deployment and member acceptance still required for Phase 4

| ID | Required evidence for this revision | Boundary |
| --- | --- | --- |
| RELEASE-01 | Fresh production build, focused modal/browser and transaction/component/route tests and the complete registered regression gate for the exact commit; preserve failed-run evidence and rerun after fixes. | Historical CI run 59 and Phase 3 local passes cannot certify this changed build. Database tests need an isolated disposable PostgreSQL; fixtures must never use the live database. |
| RELEASE-02 | Confirm GitHub Test gate and the deployed frontend/server revision, then run deployment health and asset checks. | A green Railway service or an anonymous health response does not establish that the new UI is loaded or member writes work. |
| RELEASE-03 | On disposable test accounts: text/photo/voice review, quantity and macro edit/cancel, single save, two cards, older-card Edit/Undo, intervening manual edit, partial failure and retry, account/day changes. | Record expected result, actual result, revision and evidence for each case. Use controlled fixture failures locally when an equivalent live failure cannot safely be induced. |
| RELEASE-04 | Android and iPhone browser/PWA where supported: direct camera/mic, permission denial recovery, interruption, keyboard, navigation, reopen and retry; light/dark and enlarged text. | Record actual device/browser and outcome. Test fixtures and desktop emulation remain separate evidence. |
| RELEASE-05 | Owner-safe offline queue/reconnect, pending-sync status, restart behavior, conflicting edits and shared-device sign-out/account switch under an installed service worker. | Distinguish supported warm-session offline behavior from the not-yet-designed cold-start offline experience. |
| RELEASE-06 | Regression workbook plus changed-files ZIP in original repository structure, with exact baseline, release revision, gate results and pending/UAT rows. | “Not run,” “blocked” and “failed” stay distinct. Do not report a workbook's unexecuted checklist as passed testing. |
| RELEASE-07 | Execute UAT-193–208 on supported browsers/devices: nested dialogs, topmost focus and Escape, scroll/focus restoration, history, voice/macro status, both themes and larger text; verify the final 16-case extension. | A synthetic browser pass does not certify physical screen-reader behavior or app-wide WCAG compliance. Record device, assistive technology and actual outcome. |

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

Recommended sequencing: close the cumulative Phase 3 + Phase 4 release gate and
record remaining accessibility/device findings; then work on targeted AI draft
corrections/advice and timeline editing. Design cold-start offline access
separately. Bring workout/reminder presentation and measurement forward when
reliability results and member evidence support the change. Preserve existing
functions and keep the member's entry point simple throughout.
