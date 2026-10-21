# FitLife — Fixes-2t: the three remaining voice-robot gaps (21 Oct 2026)

Test branch only. Production (`main` 1ca6ae7) is unchanged. Nutrient enrichment stays unapplied.
**Kept from 2s:** the target, deployment, dedicated-account, Retry-identity and simulation-label fixes.
**App behaviour is unchanged.** The one server change is optional and used only by automation: the pilot re-run route accepts `sample_ids`. Without it, the dashboard button re-runs every recording as before.
**No real-provider run was requested:** `qa/voice-evidence/REQUEST.md` is untouched.

## Gap 1 — the pilot re-run is scoped to the approved recordings
- **`POST /api/voice-pilot/results/rerun`** (`server/routes/voicePilot.js`) accepts `sample_ids` (1–20 recording ids).
  - Only those recordings reach Whisper and get a re-run row.
  - The response lists the ids it processed.
  - An empty, non-list, fractional, negative or over-20 list is refused (400).
  - The existing coach/admin visibility rule still applies.
- **The robot no longer taps the dashboard button.** It sends a request naming only the approved recordings.
  - It validates the approved set before the first change: exactly the 2 scripted lines recorded on 19 Oct (IST); otherwise BLOCKED.
  - It refuses any id in the response it did not ask for.
  - It checks that every other recording's re-runs are exactly as before. Any change is FAILED ("re-run reached unapproved recording(s)").

## Gap 2 — a case is complete only when every stage is
Each case now records its stages:
1. **Transcription.**
2. **A preview, or an explicit refusal** (HTTP 200, no words and a reason). An HTTP or provider error, or a 200 with no words and no reason, is an **error, not a refusal**.
3. **A quality judgement.**
4. **Then:** a confirmed save plus read-back; or a **verified no-save** (the whole day re-read and unchanged); and Retry where required.

The verdict requires all 5 cases and each one's stages. An error at any stage, before or after transcription, keeps the run from COMPLETE. The reviewer's S1 example (`collected: true`, preview timeout in `error`) is now INCOMPLETE, exit 1; it was COMPLETE, exit 0.

## Gap 3 — everything Save would apply is checked, and every field is restored
- **The whole parse is judged before Save, not just foods and weight.**
  - Any unspoken water, sleep, activities, ACV, supplements, notes, corrections to earlier entries, workouts, a message to the coach or a draft edit → **FAIL**, not saved.
  - A field the robot does not recognise, or something heard but not included → **UNVERIFIED**, not saved.
  - The reviewer's example (correct S1 plus `water_ml_add: 1000`) is now FAIL; it was PASS.
- **After a save, the read-back also requires** earlier entries unchanged and no other field changed. Only the expected weight may change.
- **Snapshots cover every destination** a Save can reach: every entry, weight, water, sleep, activities, ACV, supplements and notes, plus the day's workouts.
- **Clean-up writes back every field as it was.** Verification compares all of them; water 0 → 1000 is now reported.
- **Count-aware for entries without ids:**
  - clean-up removes exactly one entry per recorded creation, newest first, so an identical earlier entry survives (it was removing both);
  - verification counts duplicates, so a missing one of two identical entries is reported (it said ok).

## Deployment of 44e1662
**What GitHub shows:**
- Railway created a GitHub deployment record within a second of every push to `test` up to 93b8adf (20 Oct 14:41 UTC).
- For 44e1662 (17:55 UTC) there is **no deployment record and no Railway commit status**, although GitHub did create Railway's check suite for the commit.
- **So Railway received the push but never started a deploy.** This was not a failed build or start.

**What is not known from here:** why. Railway's build, deploy and activity logs and the service's branch setting are not reachable from the builder's environment; they must be read in the Railway dashboard.

**Next step:** a known Railway failure mode (a missed push notification, which GitHub does not resend) shows exactly this, but it is not confirmed. This delivery's push is itself the test:
- **if Railway creates a deployment record for it,** deploys have resumed;
- **if not,** the dashboard is needed (Redeploy, or reconnect the GitHub connection).

The voice run will not be requested until the new commit is confirmed live and the tries list returns `user_id`. The robot itself blocks otherwise.

## Tests
**Mocked or simulated; no real provider:**
- **`test-voice-evidence-robot.mjs`** (gate): 104 checks (69 from 2s + 35 new). The new ones include the reviewer's exact examples:
  - S1's late timeout;
  - unspoken water;
  - water 0 vs 1000;
  - both duplicate-entry cases;
  - unapproved re-runs;
  - HTTP 502 and no-reason empty answers not counted as refusals;
  - nine other unspoken changes;
  - missing case, quality, read-back, no-save check or Retry.
- **Mutation checks:** 14 new rules broken on purpose, each caught (18 earlier ones unchanged).
- **`test-voice-pilot.js`** (real Postgres): 4 new checks, now 120 (was 116).
  - `sample_ids` reaches only that recording: 1 Whisper call, 1 re-run row.
  - Bad lists are refused.
  - Another coach naming them touches none.
  - Without `sample_ids` the button still re-runs the rest.
- **`test-voice-evidence-sim.mjs`** (on demand; real robot, browser, server, Postgres; canned providers; SIMULATED). Scenarios A–E re-run, plus new F and G:
  - **A:** re-run rows only for k01 and k02 (none for own-words f01 or other-day k03); every case through all its stages.
  - **F, unspoken water in every preview:** nothing saved, water still 0.
  - **G, no preview after transcription:** INCOMPLETE, naming S1 "after transcription".

**Changed test:** `test-voice-evidence-robot.mjs` [7]. Its "good run" fixture now carries all 5 cases with their stage fields, because the verdict requires them. Every assertion is kept; one fixture line adds `no_save_verified` to the "not saved" case.

## Before the real run
1. The new commit is live: the phone robot or the voice robot sees it on `/health`.
2. The secrets and the "Voice Robot" member are in place.
3. A line is added to `qa/voice-evidence/REQUEST.md`.

B18 and B19 stay pending until real results are reviewed.
