# FitLife — Fixes-3d: unrecorded calls survive a restart as visible, settleable uncertainty (after the 3c kit review, 26 Oct 2026)

**Scope:**
- **Test branch only.** The kit works only on the test server.
- It answers the reviewer's *Fixes-3c review* (26 Oct): its one remaining accounting correction and the small export-label correction. Every earlier fix and test is kept.
- The plan is `claude/FitLife-Voice-Calibration-Plan-2026-10-23.md`, **revision 9**. It also corrects revision 8's claim that the ledger "survives restarts": under 3c it did not.

**Collection, invitations for collection and real-provider batches stay closed.** No real provider, volunteer, invitation or recording was used to verify this patch; every result below uses mocked providers.

**Unchanged:** production (`main` 1ca6ae7); the live speech check (200 ms / 60 ms / 6 Hz); the provider order and the everyday voice route; historical evidence; nutrient enrichment and supplement accounting; the 12-grant cap; `judge-3a.1`; the app (no client file changed). **B18 and B19 stay open.** Scenario G (backlog 3u) stays open.

## The review, finding by finding

**Where each result is tested:** `test-voice-calibration-3d.js` (new, in the gate). The restart is **real**: a child node process makes the calls while ledger writes fail and then exits without writing them; the parent, a separate process with its own copy of the routes, inspects the same PostgreSQL database and the real export. Provider and parser calls are counted by the stubs themselves.

| # | The review found | Fixed by | Counterexample → now (positive controls) |
|---|---|---|---|
| 1 | The waiting list was a JavaScript Map: after a restart, a parser call whose ledger writes had failed vanished: export 0 parser calls, no UNRESOLVED | **An attempt is started in the database before every external call** (`voice_calibration_attempts`, NEW; `startAttempt`, retried once). If it cannot be written, **the call is not made** (upload: 503 before anything is uploaded; rule 3: 503 and the claim is released). It is marked **recorded in the same statement** that writes its call count (the early spend write, the take's transaction, the judgment's statement, and the waiting-list retry). An attempt still **started** when its process is gone has **unknown** calls: the export says UNRESOLVED with the upper bound (3 per recording: two Gemini models and Whisper; 1 per parser check), keeps them out of the totals rather than inventing a number, and the screen's coverage says "N attempt(s) not yet written (N with unknown calls, to be settled)". Nothing calls a provider to repair it. An administrator **settles** it from the provider's own usage records (`POST /admin/attempts/settle {attempt_key, calls, why}`): only an attempt still started and over 10 minutes old, never one this process still knows, calls from 0 to its maximum, a reason required, once. The settlement is kept on the attempt and as a spend row, and the export says how many were settled by hand. An attempt that ends before any call (an upload that never reached storage) is closed as **no call**. The same-process waiting list stays as a shortcut: if the database recovers before a restart, the known count is written as before | [1] ordinary flows: an upload and a judged take → 3 attempts, all recorded, none started. [2] **no attempt, no call:** upload → 503, 0 engine calls, nothing registered; parser → 503, 0 parser calls, claim released; a one-off failure writing the attempt is retried and the check runs (2 and 2); an upload that cannot reach storage → "no call". [3] **the review repro across a real restart:** the child's parser answered (1 call), every write failed, it exited; **the fresh process's export says UNRESOLVED, calls unknown, at most 1, not in the totals, screen incomplete, no provider called.** The same for a failed upload (2 engine calls) and a refused replacement upload, run in the child: 3 unresolved, "at most 7". [4] repeated flushes and exports change and call nothing; a double submit gives two distinct recorded attempts; withdrawal, expiry and two schema replays keep the 3 unresolved. [5] settling: refused under 10 minutes, above the maximum, or without a reason; once only; afterwards UNRESOLVED clears and the totals include the 5 settled calls, labelled as settled by hand |
| 2 | "Recordings never kept" counted every deleted upload, so a kept recording later withdrawn showed as never kept | `voice_calibration_uploads.ever_kept` (NEW column), set when the take commits; uploads kept under 3c are back-filled (still `kept`, or `deleted` by withdrawal with no reason). The export has two lines: **recordings never kept (refused or not saved)** and **recordings kept, then deleted** (withdrawal, removal or the 90-day limit). The 90-day clean-up now marks a kept upload deleted too | [6]: 7 kept recordings deleted later (4 by withdrawal, 3 by the 90-day limit) → "kept, then deleted"; the upload that never reached storage, the failed take and the refused replacement → "never kept: 3 deleted" |

## Files
**NEW:**
- `server/scripts/test-voice-calibration-3d.js` (gate; runs a child process of itself for the restart)
- `DELIVERY-FIXES-3d.md`

**Changed:**
- `server/db/schema.sql`: additive only: `voice_calibration_attempts` (`CREATE TABLE IF NOT EXISTS`), `voice_calibration_uploads.ever_kept` (`ADD COLUMN IF NOT EXISTS`) with its back-fill. Loaded twice on an empty database and replayed twice inside the 3d suite.
- `server/routes/voiceCalibration.js`: `startAttempt`, `endAttemptNoCall`, `accountingState`; the spend writes mark their attempt recorded in the same statement; `/take` and rule 3 start the attempt before the call; `POST /admin/attempts/settle`; the export reads started and settled attempts and kept-then-deleted uploads; the 90-day clean-up marks kept uploads deleted.
- `server/services/voiceCalibration.js`: the export's UNRESOLVED wording for unknown calls, the settled-by-hand note, the coverage line, and the two upload lines.
- `server/scripts/test-local.sh`: the new suite added to the gate.

## Changes to existing tests
**None.** The 3c (21), 3b (14), 3a (29), 2z (46), 2y (99), 2x (126) and app-mode (24) suites are byte-for-byte unchanged and pass. The 2y "two taps at once" check was run three extra times on its own after the parser path gained the attempt write, and passed each time.

## Results (mocked providers; real Postgres 16)
| Check | Result |
|---|---|
| `test-voice-calibration-3d.js` (new) | **20/20**: the review repro across a real process restart, each path it asked for, and the positive controls |
| `test-voice-calibration-3c.js`, `-3b.js`, `-3a.js`, `-2z.js`, `-2y.js`, `test-voice-calibration.js`, `test-calibration-mode.mjs` (unchanged) | **21/21, 14/14, 29/29, 46/46, 99/99, 126/126, 24/24** |
| Full local gate (schema.sql on an empty database; also loaded twice) | **all suites pass, 6,910 assertions** (3c: 6,890; run last, on the pushed code) |
| Deliberate breakages (one at a time, each file restored byte for byte) | **14 of 14 caught** (13 on the first pass; list below) |
| End-to-end voice simulation A–M (run alone, 14:03–14:32 UTC) | **63/63** |
| Browser screens | not rerun: no client file changed, and no screen shows anything new |

The 14 breakages: the upload attempt never started; the engines called even when the attempt cannot be written; the parser called even when the attempt cannot be written; a written spend row not marking its attempt recorded; a kept take not marking it; a saved judgment not marking it; the export ignoring attempts started but never recorded; settling an attempt that may still be running; settling above the maximum; settling twice; a failed upload leaving its attempt unresolved; a kept upload not marked "ever kept"; the export not telling kept-then-deleted apart; the parser claim not released when its attempt cannot be written.

**The first-pass survivor:** "a kept upload not marked ever kept" survived because the schema's back-fill, run by the suite before the label check, filled the flag in. The suite now checks the flag right after the take is saved, before any schema run; caught.

**Unpopulated export example:** `FitLife-Voice-Calibration-EXAMPLE-unpopulated-3d.xlsx`, from the real export route on a brand-new database: 17 sheets; the ledger line shows 0 and 0 with no UNRESOLVED; "recordings never kept" and "recordings kept, then deleted" both show none.

**What remains true, stated plainly:**
- If a server stops **during** a call, nobody can know whether that call completed. The kit does not guess: the attempt stays unresolved with its upper bound until an administrator settles it from the provider's usage console.
- There is no panel button for settling yet; it is an admin route. It should be rare: it is needed only after a restart or a database fault during a call. A panel control can be added if wanted.

`qa/voice-evidence/REQUEST.md` is unchanged, so this push starts no real voice run.

## Before collection
1. The reviewer checks Fixes-3d and plan revision 9.
2. Fluent speakers finish the wording; after any change, each language is confirmed in the app against its final hash.
3. Then the 144-slot session and the Part C sessions begin.
