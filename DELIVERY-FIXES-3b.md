# FitLife — Fixes-3b: every call counted when it happens (after the 3a kit review, 25 Oct 2026)

**Scope:**
- **Test branch only.** The kit works only on the test server.
- It answers the reviewer's *Fixes-3a review* (25 Oct): its one remaining correction. Every Fixes-3a fix and every earlier test is kept.
- The plan is `claude/FitLife-Voice-Calibration-Plan-2026-10-23.md`, **revision 7**.

**Collection and real-provider batches stay closed.** No real provider, volunteer, invitation or recording was used to verify this patch; every result below uses mocked providers.

**Wording:** fluent speakers may continue reviewing it. Collection stays closed until the reviewer checks this patch and the final wording is confirmed against its hash.

**Unchanged:**
- production (`main` 1ca6ae7);
- the live speech check (200 ms / 60 ms / 6 Hz, same version);
- the provider order and the everyday voice route;
- old pilot evidence and historical verdicts;
- nutrient enrichment and supplement accounting;
- the 12-grant cap, one grant / one replacement, idempotent grant history, `judge-3a.1`, the crop stamps;
- the app (no client file changed).

**B18 and B19 stay open.**

## The review's correction

| The review found | Fixed by | Counterexample → now (positive controls) |
|---|---|---|
| Two simultaneous replacement uploads for one grant both called Gemini and Whisper before the lock; the losing one was correctly refused and rolled back, but it returned before its spend row was written: **4 provider calls, 2 counted** | Calls are counted **when they happen**. Right after the engines answer, `/take` commits a spend row of its own (`recordSpend`), outside the take's transaction, with an **attempt key** (`take:<uuid>`). When the take commits, the same row is linked to it (`ON CONFLICT (attempt_key) DO UPDATE`: one attempt, one row, even if written twice). A refusal marks it **"refused (the grant was already used)"**; a failed write marks it **"not saved"** and deletes the uploaded audio. Rule 3 works the same way: the parser's call is recorded as soon as the parser answers (`rule3:<uuid>`), and the judgment's own statement marks it **"judged"**. The export separates calls on **recordings deleted since** from calls on **attempts whose result was never kept**. I chose "count every attempt" over "stop the losing request before the engines": it is the one rule that also covers a write failing after the engines answered | `test-voice-calibration-3b.js` (new, gate), with provider and parser calls **counted by the stubs themselves**, independently of the ledger: **the review repro → one 200, one 409, one replacement kept, one grant used, 4 calls made and 4 counted**, the refused one marked as such. **One ordinary upload → 2 made, 2 counted, one row.** A take whose write fails after the engines answered → 2 counted, "not saved", its audio deleted. A repeated upload refused before the engines → 0 and 0. A double submit → 4 and 4, two attempt keys. A judgment that cannot be saved → its parser call counted, not marked judged; ordinary judgments → counted once, "judged". Withdrawal and the 90-day clean-up → ledger unchanged. **The real export's totals equal the independently counted calls**, and the 5 calls whose result was never kept are reported as such |

## Files
**NEW:**
- `server/scripts/test-voice-calibration-3b.js` (gate)
- `DELIVERY-FIXES-3b.md`

**Changed:**
- `server/routes/voiceCalibration.js`: `recordSpend` / `markSpend`; `/take` records its calls when the engines answer, links them on commit, marks refusals and failed writes, and deletes the audio of a failed write; rule 3 records the parser call when the parser answers.
- `server/services/voiceCalibration.js`: the export's spend line (kept / deleted since / never kept).
- `server/db/schema.sql`: additive only: `voice_calibration_spend` gains `attempt_key`, `outcome`, `judgment_ref` (`ADD COLUMN IF NOT EXISTS`) and a unique index on `attempt_key`. Loaded twice to check.
- `server/scripts/test-local.sh`: the new suite added to the gate.

## Changes to existing tests
**None.** `test-voice-calibration-3a.js` (29), `-2z.js` (46), `-2y.js` (99), `test-voice-calibration.js` (126) and `test-calibration-mode.mjs` (24) are byte-for-byte unchanged and pass. The 2y "two taps at once" check was run three extra times on its own after the parser change, and passed each time.

## Results (mocked providers; real Postgres 16)
| Check | Result |
|---|---|
| `test-voice-calibration-3b.js` (new) | **14/14**: the review repro and every case it asked for, with calls counted independently by the stubs |
| `test-voice-calibration-3a.js`, `-2z.js`, `-2y.js`, `test-voice-calibration.js`, `test-calibration-mode.mjs` (unchanged) | **29/29, 46/46, 99/99, 126/126, 24/24** |
| Full local gate (schema.sql on an empty database; also loaded twice to check it re-runs cleanly) | **all suites pass, 6,869 assertions** (3a: 6,855; run last, on the pushed code) |
| Deliberate breakages (one at a time, each file restored byte for byte) | **9 of 9 caught** (list below) |
| End-to-end voice simulation A–M (run alone) | **63/63** (see the note below) |
| Browser screens | not rerun: no client file changed, and no screen shows anything new |

The 9 breakages: calls not recorded when the engines answer; the commit link writing a second row; a refusal not marked; a failed write not marked; the parser call not recorded when the parser answers; a judged call not marked; the export not separating never-kept calls; one attempt key per volunteer and slot instead of per attempt; the audio of a failed write kept.

**Simulation note:** the first full run gave 62/63. Scenario G (a robot run whose preview never appears) reported "clean-up: 2 entries left over", and one of two runs of G on its own failed the same way. Both failures were between 18:30 and 18:45 UTC, just after midnight IST. G does not touch any code this patch changes (the calibration routes). Afterwards G passed 3 of 3 on this code and 2 of 2 on the pushed 3a code, and a fresh full run passed 63/63. My reading, unproven: the robot's day clean-up is sensitive to running across the IST date change. Logged in the backlog to look at separately; nothing was changed for it here.

**Found while building:** checking the plan's privacy wording showed that a take whose write failed kept its uploaded audio in storage (only the refused path deleted it). It is now deleted too, and tested.

**Unpopulated export example:** `FitLife-Voice-Calibration-EXAMPLE-unpopulated-3b.xlsx`, from the real export route on a brand-new database: 17 sheets; About's "calls spent in the round (ledger)" shows 0 and 0, with the new split (deleted since / never kept).

`qa/voice-evidence/REQUEST.md` is unchanged, so this push starts no real voice run.

## Before collection
1. The reviewer checks Fixes-3b and plan revision 7.
2. Fluent speakers finish the wording; after any change, each language is confirmed in the app against its final hash.
3. Then the 144-slot session and the Part C sessions begin.
