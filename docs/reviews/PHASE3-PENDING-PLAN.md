# Phase 3 — reliable review actions and pending member experience work

Release-plan update: 13 October 2026, local baseline `43a69b3`.

This build implements **per-card Save, Edit and Undo, with honest partial-save status**.
It improves trust in the existing AI review without adding Home cards or tabs.
The later items below are an ordered backlog, not a claim that they are included
in this build. “Phase 3” here follows the October member logging Phase 1 and
voice/recovery Phase 2; older `DELIVERY-PHASE3.md` describes a different release.

## Evidence and release state

- The delivery workflow records the preceding test deployment as `8a1da65` and
  GitHub Test run 59 as passing 74 suites / 4,447 assertions. That is **baseline evidence**,
  not a test result for the new Phase 3 changes.
- Phase 3's production build passed. All 25 local logic/module suites passed
  1,425 assertions. The full UI suite passed 817 assertions, including its 124
  premium assertions: **26 available local suites / 2,242 assertions passed**.
  The separate focused premium run is not added again to that total.
- The complete new GitHub CI gate, including 49 database
  suites, is still pending. Phase 3 is not deployed; post-deployment, physical
  device and member/coach/admin UAT remain pending for this revision.
- Keep each gate's actual result and revision separate. Baseline CI evidence
  and previous device acceptance do not certify the new build.
- The user previously confirmed one-tap camera and microphone behavior on both
  phones. Preserve that acceptance record, then repeat relevant device cases
  against the newly deployed revision. Synthetic browser fixtures cannot prove
  physical capture behavior or real speech-recognition quality.
- Source findings below were read-only. They identify behavior to reproduce and
  test with isolated fixtures; they are not reports of destructive live testing.
- The current roadmap source is `docs/reviews/FitLife-UX-Review.html`, especially
  “Feature preservation map” and “Prioritized enhancements.” Its October 12
  validation section is historical. The September `FitLife-Sprints-Revised.md`
  also contains already delivered work and superseded navigation decisions.

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

## Current build: P0 reliability of an AI review

| ID | Baseline finding | Bounded change and acceptance |
| --- | --- | --- |
| P3-01 | `AIChatLog.jsx` uses one shared `undoSnap` and `workoutUndoSnap`; every applied card offers Edit/Undo. A later application replaces the earlier snapshot. | Bind receipts and actions to the exact card, account, session and date. Applying A then B and acting on A must not restore B's snapshot or change B's status. Repeated taps must not duplicate writes. |
| P3-02 | Rollback restores the entire daily snapshot, which may overwrite unrelated manual changes made after the application. | Reverse only safely owned changes. Preserve later/manual entries. When a value was subsequently changed, explain the conflict and keep the existing editor available instead of silently replacing it. Editing returns to review before reapplying. |
| P3-03 | Rollback updates the card immediately and does not await/report all persistence failures. | Track saving, saved, queued, failed and reverted states truthfully. A failed or pending reversal cannot be labelled complete. Retry retains the same operation and does not duplicate the log. |
| P3-04 | Body metrics POST separately and are absent from the card's save receipt. Its error sentence asserts weight saved before daily-save completion. Workouts also save separately. | Report daily log, workout and body-metric outcomes independently. Retry only work whose outcome and duplication policy make retry safe; protect unknown outcomes from blind retry. Never claim weight saved if it was absent, queued or failed. Successful destinations must not be reapplied by a failed-destination retry. |
| P3-05 | Existing workout rollback restores an earlier session only when one existed; a newly created session stays despite a reverted card. | Keep workout status accurate. Implement safe reversal only for supported, owned changes; otherwise provide a clear supported correction path. Do not claim a session was removed when it remains. |
| P3-06 | Async save/retry/undo can outlive the review's owner, day or selected log. | Guard completion and writes against account/session/date/reset changes. Late results cannot update a replacement chat, save into the wrong day or overwrite a newer draft. |

Source anchors at the planning baseline: `client/src/components/AIChatLog.jsx`
`applyAll`, `applyWorkouts`, `rollback` and applied-card actions;
`client/src/store/aiChatStore.js` shared snapshots; `client/src/utils/chatCard.js`.
Line numbers will move during extraction. Keep the existing component-size gate;
extract cohesive transaction logic instead of relaxing that gate.

The implementation may explicitly limit which operations are safely reversible.
Any remaining limitation belongs in the release notes and acceptance workbook,
with a usable correction route; a disabled or honest action is preferable to a
false success receipt. Do not widen this build into an offline authentication or
new workout-screen rewrite.

Specific deferred limits must remain visible after this build:

- **Standalone lab report save receipts:** `AIChatLog.jsx` also has a separate
  lab-report `saveLabs` flow. This build adds owner/session/chat/date guards,
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

## P0 deployment and member acceptance still required

| ID | Required evidence for this revision | Boundary |
| --- | --- | --- |
| RELEASE-01 | Fresh production build, focused transaction/component/route tests and the complete registered regression gate for the exact commit; preserve failed-run evidence and rerun after fixes. | Baseline CI run 59 cannot certify a changed build. Database tests need an isolated disposable PostgreSQL; fixtures must never use the live database. |
| RELEASE-02 | Confirm GitHub Test gate and the deployed frontend/server revision, then run deployment health and asset checks. | A green Railway service or an anonymous health response does not establish that the new UI is loaded or member writes work. |
| RELEASE-03 | On disposable test accounts: text/photo/voice review, quantity and macro edit/cancel, single save, two cards, older-card Edit/Undo, intervening manual edit, partial failure and retry, account/day changes. | Record expected result, actual result, revision and evidence for each case. Use controlled fixture failures locally when an equivalent live failure cannot safely be induced. |
| RELEASE-04 | Android and iPhone browser/PWA where supported: direct camera/mic, permission denial recovery, interruption, keyboard, navigation, reopen and retry; light/dark and enlarged text. | Record actual device/browser and outcome. Test fixtures and desktop emulation remain separate evidence. |
| RELEASE-05 | Owner-safe offline queue/reconnect, pending-sync status, restart behavior, conflicting edits and shared-device sign-out/account switch under an installed service worker. | Distinguish supported warm-session offline behavior from the not-yet-designed cold-start offline experience. |
| RELEASE-06 | Regression workbook plus changed-files ZIP in original repository structure, with exact baseline, release revision, gate results and pending/UAT rows. | “Not run,” “blocked” and “failed” stay distinct. Do not report a workbook's unexecuted checklist as passed testing. |

## Remaining P1 enhancements

| ID | Present foundation | Remaining bounded work | Acceptance |
| --- | --- | --- | --- |
| P1-A11Y | Modern tokens, two themes, enlarged text and a reusable `Sheet` already exist. | Complete the older-sheet/report pass: topmost modal focus containment, nested Escape/scroll locking and focus return; meaningful labels/status announcements; targets, contrast and enlarged-text layouts. `Sheet.jsx` currently focuses initially but handles only Escape, not Tab containment. | Keyboard-only and screen-reader spot checks on real supported browsers, nested macro editor included; no inaccessible/clipped controls at narrow widths/enlarged text; measured contrast. Overflow checks alone do not establish accessibility compliance. |
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

Recommended sequencing: finish Phase 3 transaction reliability and its release
gate; complete accessibility; then targeted AI draft corrections/advice and
timeline editing. Design cold-start offline separately. Bring workout/reminder
presentation and measurement forward only when the reliability gates and member
evidence support the change. This plan preserves all existing functionality and
keeps the member's entry point simple.
