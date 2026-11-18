# FitLife — Fixes-2r: a voice evidence robot for the real-provider tests (20 Oct 2026)

Test branch only. Production (`main` 1ca6ae7) is unchanged. Nutrient enrichment stays unapplied. **No app or server code changed**: this adds a robot, its workflow and a request file.

## Why
B18 (everyday Whisper fallback) and B19 (Kannada pilot re-run) need real-provider evidence. Sachin asked for the robot to collect it, as the phone robot does for the rest of the app.

## What it does (`server/scripts/robot-voice-evidence.mjs`, NEW)
It runs against **fitness-test only**: production is refused, and nothing in it is simulated.

**Part 1 (B19):** as admin it taps **Whisper · Kannada** on the dashboard, re-running the stored pilot recordings.
- It snapshots the original answers and scores before, and compares them after; they must be unchanged.
- It reports each new answer: text, script, English-letter spelling, keyword score and rule checks.
- It saves the results Excel file.

**Part 2 (B18):** as admin it turns the **Voice backup test** switch on for the robot's own member, "Auto Member".
- **2a. The real 19 Oct recordings (human voice):** fetched as stored and sent, as that member, to the same endpoint the app uses. Each is sent with the voice language set to Kannada and to English.
- **2b. Computer-generated speech (espeak-ng)** played into the app's microphone, through the real voice screen:
  - **S1:** English with a decimal weight; Save, then check the day.
  - **S2:** Kannada; Save.
  - **S3:** Hindi; Save.
  - **S4:** silence; refusal, Retry sends the same recording again.
  - **S5:** a quiet line under noise; not saved.
- **Then:**
  - The robot's food is removed from today.
  - **The switch is always turned off at the end**, even after an error.
  - The recorded tries are kept.
  - The tries are read back with Whisper's raw text, language and every section's numbers, and saved as Excel.

**Report:** each line is marked **REAL human recording** or **COMPUTER VOICE**. Computer speech shows how the providers and FitLife's checks behave, not how well real members are understood.

## How it runs (`.github/workflows/voice-evidence-robot.yml`, NEW)
- It starts only when `qa/voice-evidence/REQUEST.md` (NEW) changes on `test`, or when "Re-run all jobs" is pressed on one of its runs. Each run calls the real providers, so it is never automatic.
- It waits for the phone robot on the same commit to finish first, because both use "Auto Member".
- The report is published as the check **"Voice evidence report"** on the commit. The Excel files and screenshots are kept as the run's artifact "voice-evidence" for 30 days.
- **Needs two new repository secrets:** `FITLIFE_ROBOT_ADMIN_EMAIL` and `FITLIFE_ROBOT_ADMIN_PASSWORD`, for an admin on the TEST site. Without them the run is BLOCKED (red): nothing is tested.

## Checked before it touched the real site (local dry run)
A full run against a local copy of the server, with a fresh Postgres loaded from `schema.sql`, the current app build, and simulated providers (scratch only, not shipped):
- admin and member sign-in;
- the re-run tap, with the originals unchanged;
- the switch turned on and off;
- 4 real-recording tries (stored audio fetched and sent; Kannada → `kn`, English → not set);
- 5 microphone cases through the screen: preview, Save, the day total rising, clean-up back to the starting total;
- the silence refusal, with Retry sending the same recording again;
- only this run's tries reported, with section numbers;
- both Excel files saved.

The provider answers in that dry run were canned. **The real results come only from the GitHub run.**

## Tests
No app code changed, so the existing suites apply unchanged. The robot is not part of the gate: it calls real providers.
