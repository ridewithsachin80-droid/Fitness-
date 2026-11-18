# Phase 5 — correct an unsaved food with AI

This incremental build adds quantity and meal corrections to the existing AI
review. It keeps Today, Progress and More, both themes, Home Weight and the
current one-tap Speak/Snap/Type entry routes. Nothing is added to Home.

Installed baseline verified on 13 October 2026: GitHub test
`3da43bd01b731b8bc09687b208de51b0c2680e01`, matching local application source
`b4d1dceff9ab96e0101cc7ea582e5d1147a16b89`. Baseline CI63 passed 78 suites /
4,760 assertions. That result is historical and does not certify this build.
Exact new revision, build asset, local gate counts and archive checks are in
`PHASE5-INSTALL.txt` supplied with the updated-files ZIP.

## Member experience

- With one eligible unsaved food, ask “make that 150 g” or “that was dinner.”
- With several foods, choose **Edit with AI** on the intended row, then type or
  speak its new grams, meal, or both. The composer identifies the selected food,
  current quantity and meal. Cancel exits this selection without changing it.
- The original row updates and its macros recalculate from its current nutrient
  data. Photo provenance, member nutrition corrections and inclusion stay intact.
  Household portion quantity and the displayed grams remain consistent.
- An update is still a review. **Save remains explicit.** AI does not append a
  duplicate meal, save the edit or send a coach message as part of this operation.
- Saved, saving, queued, failed-save, reverted or receipt-owned cards use their
  existing receipt Edit/Undo controls. This first increment does not replace them.

The bounded edit supports grams and a configured meal, one food per request.
Renaming a food, AI macro edits, multi-food batch edits and AI edits of other
metrics are follow-up scope; all existing manual fields remain available.
Targeted mode rejects unrelated actions. Cancel the selection before asking AI
to add a new entry. Normal additions and saved-log correction previews remain
available when no explicit draft target is selected.

## Safety and regression contract

Each review and food has a stable local identity independent of saved-log IDs
and receipts. A monotonically increasing review revision also rejects a manual
edit followed by restoration of its original values. Only bounded food names,
grams, meals and opaque IDs go into the draft context; full snapshots remain
in-memory on the current request and are not persisted or sent to the provider.

The server accepts only the selected ID pair, or the single eligible food when
there is no selection. Multiple eligible foods always require selection, even
if the model claims it knows which name was intended. Invalid IDs, amounts,
meals or fields reject the entire operation. A selected edit cannot fall through
to appending foods, saved corrections, learning, evaluation or coach messaging.

The client checks the exact captured review, configured meals and eligibility
before applying. Manual edits, Save, account/session/day changes, chat reset and
stale retries cannot overwrite a newer or different review. If the state changed,
the member chooses again and retries. No changes occur on rejected responses.

AI recognition is still provider-dependent. With no explicit selection, a model
can fail to recognize a natural-language correction and emit a normal logging
proposal; that proposal remains unsaved and editable. The explicit Edit with AI
path is the reliable way to express edit intent. Language and physical speech
acceptance require live testing. This build does not claim to resolve every
ambiguous phrase or the existing spaced-hyphen amount issue.

## Verification and deployment

The complete regression also exposed an existing timezone defect. Calendar
date keys were parsed as device-local noon and then converted to IST. On a
device in America/Los_Angeles, Previous day could retain the selected day,
the previous-weight comparison could read that same day, and the Progress
30-day grid could omit its oldest day and include tomorrow. This build uses
timezone-independent calendar arithmetic for those date keys and for Progress
range bounds. The app's definition of today remains IST. The original failing
UI expectations are retained, with additional timezone/boundary regression
coverage. Failed-run evidence is preserved separately from the final gate.

New registered suites:

| Suite | Purpose |
| --- | --- |
| `test-draft-food-edits.js` | Bounded server contract and actual parser branch; invalid/ambiguous proposals; no downstream writes or unrelated actions. |
| `test-ai-draft-food-edits.js` | Stable identities/revisions, target snapshots, photo/custom nutrition, portions, totals and stale eligibility. |
| `test-ai-draft-food-edits-ui.mjs` | Mounted AIChatLog, selection/focus, original-card update, no writes, malformed replies, manual-change/Save/owner/session/day/reset races. |

The existing `test-day-lib.js` suite also covers the new date-key helper across
UTC, India, US and UTC+14 timezones, including DST, leap/year boundaries and the
IST midnight boundary. Existing Today/Progress UI cases exercise the actual
navigation, previous-weight request, compliance grid and daily-read refresh.

The release gate rebuilds production assets and runs every locally available
registered logic/module suite plus the complete UI harness. Focused reruns are
included in those totals, never added twice. Known harness/network/IndexedDB
diagnostics remain recorded; a passing gate is not a clean-console claim.

Fresh full CI, including 49 isolated database suites, is still required. No local
PostgreSQL is available; no tests target the live database. Optional ESLint is
unavailable locally. New deployment, live/provider checks and physical-device
acceptance are **Not run**. Do not infer them from a green Railway service.

Use **FitLife-Phase5-AI-Draft-Edits-Updated-Files.zip**, overlaying its original
repository paths on the baseline above. Client and server must deploy together.
No migrations, new environment variables, dependency changes or deletions are
required. The binary patch is an alternative to the folder overlay; use one
method. Old tracked assets are preserved for incremental-overlay compatibility.

After the exact commit passes CI and deploys, verify asset identity and run
UAT-214–233 on a disposable account. The workbook now has **233 cases**, with
the new 20 manual/device cases marked **Not run**, separately from automation.
Retain prior outcomes: **UAT-212 Fail** (spaced-hyphen interpretation), and
**UAT-213 Partial** (deployed text consistency passed; photo/save pending).

## All pending work retained

| Priority / item | Current state and next work |
| --- | --- |
| P0 release gates | Fresh exact-commit CI/database gate; deploy matching client/server; health/asset check; controlled-account live text/photo/voice, Save/Edit/Undo/retry and coach acceptance. |
| P0 device/accessibility | Android and iPhone browser/PWA camera/mic, denial recovery, interruptions, keyboard, screen readers, both themes and enlarged text. Earlier user confirmation is historical, not this build's acceptance. |
| P0 offline/cache acceptance | Installed-worker offline queue/reconnect, pending sync, restart, conflicts and shared-device sign-out/account switching. Keep warm-session and cold-start behavior distinct. |
| Open live issues | UAT-212 spaced-hyphen ambiguity remains; UAT-213 photo and persisted-record comparison remain. No deterministic signed-language guarantee is claimed. |
| P1 draft edits | This bounded food grams/meal implementation needs live acceptance. Other pending-metric edits, batch edits and receipt-owned AI corrections remain outside it. |
| P1 advice | Separate useful mixed-request answers from canonical logging status/totals; test Hindi/Kannada and mixed language. |
| P1 timeline | Open/focus the selected meal or food directly in the existing FoodSheet while retaining all foods and historical dates. |
| P1 accessibility | Remaining Milestone/staff modal migration, measured contrast, enlarged text and physical assistive-technology checks. No app-wide WCAG claim. |
| P1 cold-start offline | Define account access, expiry/revocation, shared-device and sign-out rules before implementation; never restore private data by URL alone. |
| P1 cache lifecycle | Retention/storage bounds and cleanup across updates, session rotation and installed-worker account changes. Preserve current private-cache isolation. |
| Backend lab receipts | Complete standalone lab record receipts, idempotency and reversal; retain current confirmed-result/unknown-outcome protections. |
| Backend workouts | Replace best-effort GET-before-POST conflict detection with an atomic revision/conditional write and concurrent database tests. |
| Backend body metrics | Owned idempotent records and precise reversal; do not blindly retry an unknown append outcome or claim reversal removed body history. |
| P2 workout presentation | Focused next-set/previous-performance view reusing existing sessions, rest timer, substitutions, voice and full editor. |
| P2 reminders | Consolidate next action, quiet time/snooze and completion suppression across channels, retaining coach ownership and deduplication. |
| P2 measurement | Minimal completion/abandonment/correction/latency and 7/28-day return metrics, without raw health text, food, photos or audio. |
| P2 member pilot | 8–12 members across photo, mixed voice, repeat breakfast, history and interrupted saves; measure taps/time/errors and prioritize from findings. |

The complete feature-preservation checklist and detailed historical acceptance
boundaries remain in [PHASE4-PENDING-PLAN.md](PHASE4-PENDING-PLAN.md). Existing
usual meals, food search/copy/barcodes/personal labels/portion memory, workouts,
water/weight/sleep/protocol/supplements/notes, plans/progress/check-ins/photos,
labs/devices/preferences/PIN, coach and admin routes are retained.

Recommended next increment after this build's release gates: meal-specific
timeline entry, then mixed-request advice. Cold-start offline access requires
its separate account-safe design before coding.
