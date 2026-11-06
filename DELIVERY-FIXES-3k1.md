# FitLife — Fixes-3k.1: every test-site member moves to the new protocol rule (6 Nov 2026)

**Asked by Sachin (6 Nov, 07:18 IST):** "Change all are test members." Fixes-3k moved only new members to the new rule. Every member on the test site is a test member, so they all move.

**Scope:** test site only, based on **e2eafd3**.
- **Production (`main` 1ca6ae7) is not touched.** The switch runs only where Railway reports the git branch exactly `test`.
  - There is no fallback setting. This is stricter on purpose than the voice fallback switch's check, because this is a one-time data change that runs with nobody pressing anything.
  - A deploy that reports no branch (CLI, image or manual) never runs it.
  - Branch `main`, or names like "Test", "testing" or "main-test", never run it.
- If this code is ever released to production, the switch still won't run there. Whether production members also move is a separate decision for that release.
- **Check on the test site after the deploy.** The boot log shows either "🧪 Test server: N members moved to the new protocol rule", or "Protocol rule switch not run: …" with the reason and the branch Railway reported. A manual redeploy that reports no branch would skip it.

## What happens on the test site
On the first start after this deploy, once:
- **Every member with the old meaning moves to the new rule.** If the coach never chose their supplements or apple cider vinegar (ACV), they now have none. This includes members whose coach had ticked all of them under the old app, because the old app saved "all ticked" and "never chosen" the same way.
- **What doesn't change:**
  - Items the coach chose for a member (a list) stay exactly as they are.
  - The coach's own items stay.
  - Activities, water and sleep stay.
  - Coaches and admins are untouched.
- **A member with no profile row gets one** on the new rule.
- **It can be undone exactly.** Each member moved is written to `protocol_rule_switch_log`. The undo is `UNDO_SQL` in `server/services/protocolRuleSwitch.js`: two statements in one transaction.
  - Moved members go back to the old meaning.
  - Profile rows the switch created are deleted.
  - Caution: a created row the coach has edited since would lose those edits.
- **It runs once per database.** A second start does nothing, and two starts at the same moment run it once.
- **Saved days keep their scores.** Only days logged from now on use the new count.

For these members the two open questions from 3k (the old score count and the ACV reminder when every dose is off) no longer apply. Both disappear with the new rule.

## Files
**NEW:**
- `server/services/protocolRuleSwitch.js`
- `server/scripts/test-protocol-rule-switch.mjs` (gate)
- `DELIVERY-FIXES-3k1.md`

**Changed:**
- `server/db/schema.sql`:
  - one additive table, `protocol_rule_switch_log`;
  - the Fixes-3k column line moved, unchanged, to the end of the file with it. The schema is append-only for the calibration upgrade test; everything above that test's marker is again byte-identical to 103c98a.
- `server/startup.js` (calls the switch on boot and logs the result either way; never fatal)
- `server/scripts/test-local.sh` (the new suite in the gate)
- `server/scripts/android-emulator-robot.mjs` (one information-only line: which supplement rule the robot member's Plan shows, so the switch can be confirmed on the live test site from the run log)

No client change, so no new `client/dist`.

## Changes to existing tests
None.

## Independent QA review (before any push)
| # | QA finding | Severity | Done |
|---|---|---|---|
| S1 | The guard was the voice switch's guard. A production deploy with no branch reported and a copied `FITLIFE_TEST_SERVER=yes` would have moved every production member at boot, with nobody acting | should-fix | Own guard: `RAILWAY_GIT_BRANCH === 'test'` only, no fallback |
| S2 | The undo described in the header left the created rows in place | should-fix | `UNDO_SQL`: NULL for moved rows, delete created rows |
| S3 | The undo test ran a different query from the one described | should-fix | The suite runs `UNDO_SQL` itself and checks the created row is gone |
| A4–A6 | Untested: the role filter on created rows, the service's own guard, a failure halfway; the suite moved every member of the shared gate database | advisory | Tests added (admin with no row; main, no branch, Test, testing; a trigger that fails the last step); own scratch database |
| A7 | The new table (and the 3k column) sat above the calibration test's marker, breaking "append-only" | advisory | Both moved to the end; byte-identical above the marker |
| Re-check | All fixed. Two notes: the delivery note was out of date (fixed here); the boot logs nothing when it skips (now it says why) | — | **PASS** |

## Results
| Check | Result |
|---|---|
| `test-protocol-rule-switch.mjs` (new) | **22/22** on real Postgres, on its own scratch database. Covers: the service's own guard (main + `FITLIFE_TEST_SERVER=yes`, no branch, nothing set, production, Test, testing, "test ", main-test: none run); NULL → TRUE; a missing profile row created; coaches and admins untouched; coach lists and own items untouched; the log names exactly the members moved; once per database; two boots at once → one switch; a failure halfway → nothing changed, next boot clean; afterwards the score total is 6 and no ACV reminder goes out; `UNDO_SQL` restores the database exactly. Breakages caught (each reverted on its own): no role filter, a loose guard, no lock, an undo leaving created rows, no transaction |
| Real boots (`startup.js`, local database) | `RAILWAY_GIT_BRANCH=main`: "not run: not the test server", member unchanged. `test`: "1 members moved", logged. `test` again: "not run: already done", nothing more logged |
| Full local gate | **all suites pass, 7,139 assertions** (7,117 before; the new suite adds 22); test-voice-calibration-3f and test-ux-3k pass with the schema change |
| Live after the push | (follow-up) |
