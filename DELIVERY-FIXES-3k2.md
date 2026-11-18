# FitLife — Fixes-3k.2: production members move to the new protocol rule at release (18 Nov 2026)

**Asked by Sachin (18 Nov):** "there are real members but no supplements are taken as of now", then "build next and push to test". So, at release, production members move to the new rule too: no supplements or apple cider vinegar (ACV) until the coach adds them. Nobody loses anything real, because nobody takes any.

**Scope:** test branch, based on **b084761**. **Nothing changes on production until the release** (merging test into `main`).

## What happens
- **On the first production start after the release, once:**
  - every member still on the old meaning moves to the new rule;
  - a member with no profile row gets one.
- **This applies per group.** A member whose coach chose supplements (e.g. D3) but never chose ACV:
  - keeps the D3;
  - loses the built-in ACV doses, which were never chosen.

  **Confirm before the release that no production member takes apple cider vinegar either.** The decision so far covers supplements.
- **Not touched:**
  - lists the coach chose (e.g. D3 for one member);
  - the coach's own items;
  - activities, water and sleep;
  - coaches and admins;
  - past days' scores.
- **It is the same one-time switch the test site ran on 6 Nov (Fixes-3k.1).** It now runs where Railway reports the branch exactly `main` as well as `test`, and each site has its own record:
  - `protocol_rule_all_new_test_v1`: the test site; already done, never runs again;
  - `protocol_rule_all_new_main_v1`: production.
- **It never runs anywhere else:** no branch reported, `Main`, `master`, "main ", "production" and similar names are all refused.
- **Members the old version creates during the release are caught up.**
  - While Railway switches over, the old version keeps serving for a few minutes. It also serves again after a rollback. Members it creates have the old meaning.
  - On every later start, and once 15 minutes after each start, members created after the switch who still have the old meaning are moved and logged under the same record. This is the "catch-up".
  - Members from before the switch, and members already moved once (in the log), are never touched again, so an undo stays undone for everyone.
- **Every member moved is logged and can be undone exactly** with `undoSql('protocol_rule_all_new_main_v1')` in `server/services/protocolRuleSwitch.js`. It only accepts the two record names.
  - Run it **once, after a backup**. It deletes whole profile rows the switch created, including anything entered on them since.
  - It leaves the switch's record in place, so the switch does not run again.
- **After the release, this read-only check must return 0** (members still on the old meaning):
  `SELECT count(*) FROM users u LEFT JOIN patient_profiles pp ON pp.user_id = u.id WHERE u.role = 'patient' AND pp.protocol_default_none IS NOT TRUE;`
- **The boot log says what happened:** "✅ protocol_rule_all_new_main_v1: N members moved…", or "Protocol rule switch not run: …" with the reason and the branch.
- **Release order:** back up the production database first. The switch runs on the first start.

## Files
**NEW:**
- `DELIVERY-FIXES-3k2.md`

**Changed:**
- `server/services/protocolRuleSwitch.js`: one record per site; `migrationForBranch`, `undoSql(name)`, `switchMembersToNewRule`. The 3k.1 names stay as aliases.
- `server/startup.js`: calls `switchMembersToNewRule`; the log line names the record and any catch-up; a second look 15 minutes after start.
- `server/scripts/test-protocol-rule-switch.mjs`: the production checks, [7], and the catch-up, [8].
- `server/db/schema.sql`: one comment in the 3k block (at the end of the file) updated to say production is included. No schema change.

No client change, so no new `client/dist`.

## Changes to existing tests
Three assertions in `test-protocol-rule-switch.mjs` (written in 3k.1) changed, because what is correct has changed:
1. **[1]** "the service itself does not run on branch main…": `main` is no longer in the must-not-run list; it now runs under its own record, checked in the new [7]. The rest of that list is unchanged. Added to it:
   - `master`;
   - near-misses: `Main`, "main ", `constructor`, `__proto__`;
   - a check that an explicit "not the test server" wins even on `main`.
2. **[1]** "not the test server → it does not run": the refusal reason now reads "not the test or production server". The check is otherwise unchanged.
3. **[3]** "a second boot does nothing; a row made afterwards without the flag is left alone": a member created after the switch with the old meaning is now moved on the next start (the catch-up, from the QA review). The switch itself still does not re-run, and members from before it are not touched; [8] checks both.

## Independent QA review (before any push)
| # | QA finding | Severity | Done |
|---|---|---|---|
| 1 | The record names were not pinned. Renaming the test record would have made the live test site switch everyone again | should-fix | Both names asserted as literals |
| 2 | Members the old version creates during the release (or after a rollback) keep the old meaning forever; the switch is already recorded | should-fix | Catch-up on every start and 15 minutes after start, for members created after the switch; post-release check (must be 0) |
| 3 | The note said only members "whose coach never chose supplements or ACV" move; in fact each group moves separately (chosen D3, never-chosen ACV → no ACV) | should-fix | Note corrected; Sachin to confirm that nobody takes ACV either |
| 4 | Undo caveats: it keeps the record, and deletes whole created rows | advisory | Written in the note |
| 5 | A schema comment still said "production is not touched" | advisory | Updated |
| 6 | `startup.js` itself was not covered by the suite | advisory | Source check of the exact call (no options) and the 15-minute look; release rehearsal on production's schema |
| — | Guard, lock, rollback on failure, undo safety, and the two changed assertions | — | Confirmed sound |
| Re-check 1 | After an undo, the catch-up moved the release-window members straight back (it did not look at the log) | should-fix | Catch-up skips members already in the log; test: undo, then a start → nobody moved back |
| Re-check 2 | A tiny race: a member whose sign-up transaction started before the switch and finished after it is seen by neither | advisory | Milliseconds; the post-release check (must be 0) shows it |

## Results
| Check | Result |
|---|---|
| `test-protocol-rule-switch.mjs` | **38/38** (32 before the QA fixes), on two scratch databases: one stands for the test site, one for production. On production (branch `main`), it moves once under its own record. A coach-chosen D3 stays and the coach is untouched. A second start does nothing. The test site does not run again. The production undo restores the profiles byte for byte. The undo refuses unknown names. Breakages caught (each reverted on its own): production sharing the test record (1 fail), a loose branch match (4), the undo taking any name (1), prototype names like `constructor` (7), the explicit "not test" flag ignored (7). Catch-up: none (2), moving older members too (2), not logged (2), ignoring the log after an undo (1); a renamed record, test or production (1 each) |
| Release rehearsal (local) | A database built from **production's own `schema.sql`** (`main` 1ca6ae7), with two members (one with nothing chosen, one with D3 chosen). The real `startup.js` was started as production (`RAILWAY_GIT_BRANCH=main`). First start: "✅ protocol_rule_all_new_main_v1: 2 members moved"; D3 kept. Second start: "not run: already done". One record, two log rows. Repeated after the QA fixes with a member added as the old version would (no flag) between the two starts. The second start said "already done — 1 members created since moved", and both members are on the new rule. The 15-minute look calls the same function; it is source-checked, not waited for |
| Full local gate | **all suites pass, 7,155 assertions** (7,139 before; the switch suite went from 22 to 38), run on the commit itself in a separate copy |
| Independent QA agent | three rounds: first review (3 should-fix, 3 advisory, all done), re-check (1 should-fix: undo vs catch-up, fixed), final re-check **PASS** |
| Live after the push | (follow-up) |
