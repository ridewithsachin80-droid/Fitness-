# Phase 5 authenticated regression fixes

Authenticated testing on 14 October 2026 found four defects in deployed test
commit `c6b7bf8712733122a0ce695b67d652ff00fc6174`. The member account is a
disposable test account. The initial desktop browser observations are recorded
in `qa/results/phase5-authenticated/browser-before-fixes.json`; they are
before-fix evidence, not acceptance of this patch.

## Changes

| Defect | Why it matters | Intended correction and acceptance |
| --- | --- | --- |
| Manual food grams leave an old caption | The editable quantity and saved food were correct, but a 125 g review still described 175 g. Conflicting values undermine trust in the review. | Keep the caption and household amount in sync with current grams while retaining nutrient data. Empty quantities must not retain a stale numeric caption or permit Save. Cover the unsaved review and receipt Edit/save/reload path in UAT-234. |
| A spaced minus becomes a positive food amount | `rice - 50 g` produced a positive 50 g proposal. It remained unsaved, but the requested sign was lost. | Require clarification for supported signed mass/volume syntax before provider parsing, without processing other categories from that held entry. Preserve ordinary positive amounts and documented bullet/range syntax. Retest the broader existing UAT-212; this is not a claim to interpret every language or ambiguous dash. |
| Duration-only sleep disappears from a mixed request | The combined water, eight-hour sleep, weight and walk request omitted sleep without asking for missing times. | Show a visible question for bedtime and wake time when duration alone cannot form the existing sleep record. Keep recognised categories reviewable, do not invent times, and require explicit Save. Cover mixed and sleep-only requests plus explicit-time completion in UAT-235. |
| Progress treats a newer unweighed day as no weight history | The latest daily entry had no weight, so Progress hid an earlier valid weigh-in and displayed an incorrect empty state. | Derive the latest-weight summary from the most recent finite positive weigh-in. Retain date-range filtering for plotted points and the true empty state. Cover a newer unweighed day and no-valid-weight history in UAT-236. |

The existing Today, Progress and More navigation, both themes, one-tap
Speak/Snap/Type, all manual fields and explicit Save/Edit/Undo controls remain
part of the regression contract. The earlier timezone/date-key fix is separate
from the Progress latest-valid-weight defect above.

## Verification status

The integrated production build passed. The available local gate passed 36
suites and 2,992 assertions with zero failed assertions: 35 logic/component
suites (2,175) plus the full UI gate (817, including 124 nested premium checks).
The source manifest remained unchanged through the run. Existing harness
network, IndexedDB and teardown diagnostics are retained; this is not a clean-
console claim. Optional ESLint was unavailable. All 49 database suites require
fresh GitHub CI for this exact commit; CI, deployment and live retests are
pending at source packaging time. See the versioned Excel/evidence for their
subsequent results.

After upload, verify the exact commit's full CI, Railway status and served
assets, then repeat the authenticated defect scenarios. Report public smoke,
authenticated observations, complete manual cases and physical-device checks
separately. A passing build or green Railway status does not complete live
acceptance. Before-fix observations remain preserved after retesting.

The manual catalog now has **236 cases**. New UAT-234–236 start **Not run**;
the negative-quantity regression retains UAT-212 rather than adding a duplicate.
Prior case results remain unchanged until supported by the final retest.
Desktop-only or partially exercised cases must remain scoped or Partial.

## Remaining acceptance and roadmap

Retain the open photo/save branches of UAT-213 and any unexecuted household
portion, saved-correction, race, offline, coach, accessibility and physical
Android/iPhone checks. The earlier live Phase 5 observations do not establish
device speech/camera acceptance or every fault-injection scenario. The complete
pending feature plan remains in `PHASE5-AI-DRAFT-EDITS.md` and
`PHASE4-PENDING-PLAN.md`; this patch closes no unrelated roadmap item.

Deliver the final patch as updated repository files in their original paths,
with matching client and server assets. Final packaging and deployment
instructions follow the frozen source and completed gates, not this pending
integration note.
