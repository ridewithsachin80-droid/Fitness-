# FitLife — Fixes-2s: the voice evidence robot corrected before its first real run (20 Oct 2026)

Test branch only. Production (`main` 1ca6ae7) is unchanged. Nutrient enrichment stays unapplied.
**App behaviour is unchanged.** The one server change is narrow: the admin-only tries list now includes each try's account id, so the robot can keep only its own.
**No real-provider run was requested:** `qa/voice-evidence/REQUEST.md` is untouched.

## The four corrections (2r review)
### 1. Target and deployment
The decisions are in `server/scripts/lib/voice-evidence.mjs` (NEW).
- **Real runs go only to exactly `https://fitness-test.up.railway.app`.** These are refused:
  - any other origin, a lookalike, plain `http`, another port, or a user/password in the address;
  - production;
  - `localhost`, unless simulation is asked for.
- **Simulation (`ROBOT_SIMULATION=1`) runs only against this computer.** It is labelled SIMULATED in the report's first line and title, every section, the Excel file name and first sheet, and a banner on every screenshot.
- **The server must report exactly the expected commit** (`ROBOT_EXPECT_COMMIT`, set to the workflow's commit). A missing commit, no commit field, an unreachable server, a different commit or no expected commit means BLOCKED after the bounded wait, before any sign-in.

### 2. Outcomes are checked, and collection is kept apart from quality
- **Each preview is compared item by item with what was said, before Save:** food, count, unit (bowl, katori…) and weight.
  - Extra or missing items, a wrong count, unit or weight → **FAIL**.
  - A missing amount or unit → **UNVERIFIED**.
  - **Only a PASS is saved.** FAIL and UNVERIFIED previews are reported, not saved.
- **After Save, the day is read back:** the entries this save created must match, and the weight must be what this save changed.
- **Retry must re-send the identical recording:** the SHA-256 of the audio in both requests must match.
- **Two separate answers:**
  - **Run:** COMPLETE, INCOMPLETE, FAILED or BLOCKED. FAILED covers changed originals, a missing "Saved" confirmation, a read-back mismatch, Retry not identical, failed clean-up, the switch not confirmed off, and an unexpected try in this run's window. INCOMPLETE covers a missing approved recording, re-run, export or case answer.
  - **Recognition quality, per case:** PASS, FAIL or UNVERIFIED. A poor transcript that was accurately collected is a quality FAIL, never hidden and never an acceptance.
  - **Exit 0 only when the run is COMPLETE.**

### 3. Isolation
- **A dedicated voice account:** a member named **"Voice Robot"**, with new secrets `FITLIFE_ROBOT_VOICE_MEMBER_PHONE` / `_PIN`. The phone robot never uses it.
  - The robot checks the name, and refuses if the number is one of the phone robot's.
  - The unreliable "wait for the phone robot" step is removed; there is nothing to share any more.
  - Voice runs never overlap each other (workflow concurrency group, no cancelling).
- **The switch:** if another account holds it, the run is BLOCKED and nothing is replaced. If it is still on for the voice account (an earlier aborted run), this run takes it over and turns it off.
- **Evidence:**
  - Only the approved recordings: the scripted lines recorded on 19 Oct 2026 (IST); free-text "own words" lines and other days are excluded.
  - Only this account's tries made during this run.
  - The robot writes its own Excel file from that scoped data; it no longer saves the shared exports.
  - No member names appear in the report, the commit check or the file.

### 4. Clean-up and switch-off, guaranteed
- **Before anything changes,** the voice account's day is recorded.
- **In `finally`** (it also runs after an error):
  - the browser is closed first, so no open page can save over the clean-up;
  - only the entries this run created (recorded at each save) are removed, and the weight is restored;
  - the day is then read again and must equal the recorded day.
- **Entries that existed before the run are kept,** even one with the same name as a new entry. The app adds empty fields (e.g. `food_id: null`) to older entries whenever a day is saved; that is not counted as a change, but any real value is.
- **The switch is turned off with up to 3 tries and then verified off.** If it cannot be confirmed, the job fails with an error naming the fix: Admin → Voice backup test → Turn off; otherwise it turns itself off 24 hours after it was set. An abruptly killed job cannot clean up; that same 24-hour limit is the fallback.
- **Pilot originals and recorded tries are never changed.**

## Tests
**Mocked or simulated (no real provider, no site):**
- **`test-voice-evidence-robot.mjs`** (NEW, in the gate), 69 checks:
  - 10 wrong targets refused, and simulation only on this computer;
  - 7 deployment cases: exact commit, no commit, no commit field, different, none expected, arriving during the wait, unreachable;
  - 12 preview cases, including the dry run's canned preview (roti and dal added) → FAIL, a wrong weight, a cup instead of a bowl, a missing amount, Kannada and Hindi number words;
  - SHA-256 identity;
  - approved-sample and run scoping;
  - clean-up: same-name entries, a weight restore, leftovers, missing entries, key order, empty fields;
  - verdicts, including the reviewer's exact controlled bad result → FAILED, exit 1 (was "Completed", 0);
  - the real script run as a process: blocks on a wrong origin, `localhost` without simulation, no expected commit, a missing secret, or the voice account being a phone-robot account; a simulated blocked report labelled from its first line.
- **`test-voice-evidence-sim.mjs`** (NEW, on demand, about 15 minutes): the real robot through a browser, against a real local server and Postgres, with canned providers (`scripts/sim/voice-evidence-providers.cjs`, NEW, test only). **22/22**:
  - **A, normal:** COMPLETE; previews checked; S1–S3 saved and read back; Retry identical; the earlier idli and coffee and the 81 kg weight intact; switch off; another account's try during the run excluded; labelled SIMULATED; no names.
  - **B, wrong previews:** S1/S2 not saved; still COMPLETE.
  - **C, switch held by another account:** BLOCKED; nothing changed.
  - **D, switch-off fails:** FAILED with the manual instructions; clean-up still done.
  - **E, an original answer changed:** FAILED.
- **The simulation caught 2 robot bugs, now fixed:** the whole-day weight was judged per save, and empty fields added by the app counted as changes.
- **Mutation checks:** 18 decisions broken on purpose, each caught.
- **`test-voice-fallback-test.js`:** 1 new check (each try carries its account id); now 39.

## To unblock the real run (Sachin)
1. On the test site, create a member named **Voice Robot** with a PIN, used for nothing else.
2. Add the repository secrets `FITLIFE_ROBOT_ADMIN_EMAIL`, `FITLIFE_ROBOT_ADMIN_PASSWORD`, `FITLIFE_ROBOT_VOICE_MEMBER_PHONE` and `FITLIFE_ROBOT_VOICE_MEMBER_PIN`. Never put the values in chat or reports.
3. Request the run: add a line to `qa/voice-evidence/REQUEST.md` on `test`.

B18 and B19 stay pending until the real results are reviewed.
