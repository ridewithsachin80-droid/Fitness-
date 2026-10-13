# Meal quantity clarification — incremental Phase 4 fix

Prepared 13 October 2026. Intended installed baseline:
`1c0c0408b80134d8d26812c7e1f0073271e8e939`, matching local
`507c2e4434a14e57400cf079dc971dce8ba99051`. The new fix is **not deployed**.
New revision: see `MEAL-CLARIFICATION-INSTALL.txt` in the code ZIP.
Frontend asset: `/assets/index-DyjU6GwD.js`. Final local totals are recorded below.

## Observed behavior

The deployed member AI review showed these results before any Save:

| Typed request | Observed review |
| --- | --- |
| `2 idlis and sambar for breakfast` | Only Idli, 80 g, 107 kcal; sambar absent. |
| `2 idlis and 1 bowl sambar for breakfast` | Idli and Sambar; 176 kcal total. |

The raw live provider response/path was not captured. The observation does not
prove whether the provider omitted sambar or quantity validation discarded it.
The server previously discarded named rows without usable grams. This patch
closes that validation gap and strengthens the prompt's requirement to represent
every named consumed accompaniment.

## Bounded implementation

- The server retains missing/invalid amounts as `unresolved_foods`: bounded name,
  meal and quantity-needed reason, without invented grams or nutrition. Existing
  valid portion normalization, food enrichment and canonical macro calculation stay.
- A known standard serving may be proposed with an `Estimated:` label. Explicit
  amounts take precedence. Unresolved items stay outside selectable foods, totals
  and Save counts. Member AI parse/clarification never auto-saves.
- A compact notice asks for an amount. A valid and unresolved row of the same food
  may be separate portions; wording must not imply the entire food is absent.
  The code does not blindly deduplicate these by name.
- Bounded `context.foodClarification` contains the latest unsaved same-day
  unresolved names and current reviewed names/grams/meals. No model prose or
  nutrition enters this hint. Exact request Retry and existing owner/session/day/
  reset guards apply. The prompt asks for newly resolved food without repetition.
- Newly resolved quantities and macros remain editable and require Save.
  Home, themes, direct Speak/Snap/Type, manual entry and receipts remain.
  This is not general correction targeting for arbitrary unsaved cards.

## Verification and deployment

| Gate | Current result |
| --- | --- |
| Phase 4 baseline | Frontend verified; all 58 package files match uploaded `1c0c0408`. |
| Baseline GitHub Test gate 61 | 76 suites / 4,642 assertions passed, including 49 database suites / 2,316 assertions; client build passed. |
| New fix production build | **PASS** |
| New focused server/client checks | **106 passed: 46 server + 60 client**, included in the available local total. |
| New complete available local regression | **29 suites / 2,432 assertions passed; 0 failed.** Includes 28 logic/module suites with 1,615 assertions plus 817 full UI assertions (693 core + 124 nested premium). |
| New exact-commit GitHub/database gate | **PENDING** |
| New deployment/live acceptance | **PENDING** |
| Manual catalog | 212 cases; UAT-209–212 **Not run**. |

Baseline evidence does not certify changed source. Focused tests use synthetic
provider responses. The server suite runs the actual parse/enrichment route with
isolated dependencies; the client suite mounts actual review code. Run complete
available regression after the final build, then require fresh full CI and
deployed checks. Preserve failures and actual device evidence.

Deliver an **incremental updated-files ZIP** for installed `1c0c0408`, using local
`507c2e4` as the source base. Preserve folders; include the matching client build
and all new helpers/tests. No deletions, migrations or new environment variables
are required. Do not reapply the older cumulative ZIP.

## Limits retained

The validator cannot recover a food omitted from both arrays. A provider may
repeat reviewed food despite instructions; there is no deterministic no-repeat
guarantee. Earlier amount notices remain historical after a later card resolves
the portion. The original live provider path remains unknown until independently
observed. Standard serving estimates remain editable proposals. Synthetic tests
do not prove physical speech/photo recognition accuracy. The separate quick-log
voice integration keeps its existing behavior; explicit review applies to the
member AI workspace.

The full accessibility/device, pending-card editing, mixed logging/Q&A, timeline,
offline/cache, workout/reminder, measurement and pilot backlog remains in
[PHASE4-PENDING-PLAN.md](PHASE4-PENDING-PLAN.md). Phase 3 standalone-lab
receipt/idempotency, atomic workout revision and body-metric idempotency/reversal
limits remain unchanged.
