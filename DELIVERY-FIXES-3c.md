# FitLife — Fixes-3c: the call ledger survives restarts and failures; no unkept recording left behind (after the 3b kit review, 26 Oct 2026)

**Scope:**
- **Test branch only.** The kit works only on the test server.
- It answers the reviewer's *Fixes-3b review* (26 Oct): its three bounded corrections. Every earlier fix (including 3b's 4-of-4 concurrent-upload accounting) and every earlier test is kept.
- The plan is `claude/FitLife-Voice-Calibration-Plan-2026-10-23.md`, **revision 8**.

**Collection, invitations for collection and real-provider batches stay closed.** No real provider, volunteer, invitation or recording was used to verify this patch; every result below uses mocked providers.

**Wording:** fluent speakers may continue reviewing it. Collection stays closed until the reviewer checks this patch and the final wording is confirmed against its hash.

**Unchanged:** production (`main` 1ca6ae7); the live speech check (200 ms / 60 ms / 6 Hz); the provider order and the everyday voice route; historical evidence; nutrient enrichment and supplement accounting; the 12-grant cap and its history; `judge-3a.1`; the app (no client file changed). **B18 and B19 stay open.**

## The review, finding by finding

**Where each result is tested:** `test-voice-calibration-3c.js` (new, in the gate): real PostgreSQL, the real routes, the **full `schema.sql` replayed exactly as startup runs it**, and provider/parser calls counted by the stubs themselves.

| # | The review found | Fixed by | Counterexample → now (positive controls) |
|---|---|---|---|
| 1 | Each schema run (every boot) added a legacy-style row for completed 3b parser calls, because the back-fill checked only `judgment_id` while 3b rows use `judgment_ref`: 3 calls became 5 | Reproduced first on real PostgreSQL (3 → 5 → 5). The back-fill now skips a judgment whose calls are recorded **either** way (`judgment_id` or `judgment_ref`). The 3b spend columns are created with the table, **before** any back-fill reads them, so a database from before 3b migrates. **Existing duplicates:** a legacy-shaped row (no attempt key) for a judgment that also has attempt-recorded calls is provably a duplicate (a judgment completed under 3b was never completed before), so it is moved to `voice_calibration_spend_reconciled` (NEW; kept, not erased) and removed from the ledger. Several genuine attempts for one judgment are never touched. The export reports any reconciliation separately | [1]: two full replays on an empty database → no rows; a pre-3b database (columns dropped) → migrates; **completed new work + a legacy call + an unrecorded judgment → 5 after the first and second replay (was +2 per replay)**; two genuine attempts on one judgment both kept, the legacy row single, the unrecorded judgment back-filled once; 2 duplicates an earlier boot added → reconciled, ledger back to 5; the real export equals the independent count after the replays, withdrawal, expiry and one more replay. On a copy of the review's state (5 rows for 3 calls), the corrected schema reconciled it to 3 and kept it there |
| 2 | `recordSpend` swallowed a failed INSERT; the judgment then saved with its spend row missing: 2 parser calls, 1 counted, HTTP 200 "judged 2" | A failed spend write is **retried once with the same attempt key**; if it still fails it is held waiting and written by the next calibration request (`flushSpend`), never by calling a provider again. The judgment's own statement now **writes** its spend row (insert or update by attempt key), so a judgment cannot be saved without its call; if that statement fails, neither is saved and the judgment stays "running". The take transaction already wrote its spend row the same way. Anything still waiting is **UNRESOLVED** in the export (totals short by N) and adds "call ledger: N attempt(s) not yet written" to the screen's coverage, so it cannot read as complete. The preview-eval answer reports `accounting_unresolved` | [2]: one failed INSERT → judged 2, 2 made, 2 counted. The early record failing twice → the judgment writes it: 2 and 2, both "judged", nothing waiting. **Persistent failure → 500, judgment not saved, 1 call waiting (not lost), export UNRESOLVED and screen incomplete; when writes work again, the next request records it with the same key and no new provider call.** The shared helper on the upload paths: two replacement uploads at once with failing spend writes → one 200, one 409, 4 made = 4 counted, the refused one marked; a failed take write with a failing spend record → 2 counted, "not saved" |
| 3 | If `pool.connect()` failed after the engines answered, the uploaded audio stayed in storage with no take row to find it by (pre-existing gap) | Every recording is **registered before it is uploaded** (`voice_calibration_uploads`, NEW: storage key, volunteer, slot, state). Everything from the speech check to the commit sits inside one guard: on **any** failure (the speech check, the engines, getting a connection, the write) or a refusal, the audio is deleted and the registration says so; if deleting fails it is recorded **"delete failed"** and the daily clean-up retries it. An upload a crash left "uploading" for over an hour is deleted by the daily clean-up too. Kept recordings are marked "kept" in the take's transaction. Withdrawal also deletes a volunteer's unkept uploads | [3]: a kept upload stays, "kept", 2 counted; **no connection after the engines answered → 500, audio deleted (was left), no take, 2 made = 2 counted, "not saved"**; with the deletion also failing → "delete failed", still in storage, then deleted by the clean-up; a crash-left upload deleted after an hour; kept uploads untouched; no recording left in storage at the end |

## Files
**NEW:**
- `server/scripts/test-voice-calibration-3c.js` (gate)
- `DELIVERY-FIXES-3c.md`

**Changed:**
- `server/db/schema.sql`: additive only. The 3b spend columns moved up to the table (same statements, before the back-fills); new tables `voice_calibration_spend_reconciled` and `voice_calibration_uploads` (`CREATE TABLE IF NOT EXISTS`); the reconciliation step; the corrected back-fill condition. Loaded twice on an empty database, replayed on populated ones inside the 3c suite, and run on a copy of the review's duplicate state.
- `server/routes/voiceCalibration.js`: `recordSpend` (retry, waiting list), `flushSpend`, `markSpend` (waiting rows too), `discardUpload`, `sweepUploads`; `/take` registers the upload first and guards everything up to the commit; rule 3 writes its spend row with the judgment; the export reports unresolved accounting, reconciliations and unkept uploads; the daily clean-up sweeps uploads.
- `server/services/voiceCalibration.js`: the export's spend line (UNRESOLVED, reconciliation), the "recordings never kept" line, and the coverage line for unresolved accounting.
- `server/scripts/test-local.sh`: the new suite added to the gate.

## Changes to existing tests
**None.** The 3b (14), 3a (29), 2z (46), 2y (99), 2x (126) and app-mode (24) suites are byte-for-byte unchanged and pass.

## Results (mocked providers; real Postgres 16)
| Check | Result |
|---|---|
| `test-voice-calibration-3c.js` (new) | **21/21**: each finding's counterexample and every case the review asked for, with calls counted independently by the stubs |
| `test-voice-calibration-3b.js`, `-3a.js`, `-2z.js`, `-2y.js`, `test-voice-calibration.js`, `test-calibration-mode.mjs` (unchanged) | **14/14, 29/29, 46/46, 99/99, 126/126, 24/24** |
| Full local gate (schema.sql on an empty database; also loaded twice) | **all suites pass, 6,890 assertions** (3b: 6,869; run last, on the pushed code) |
| Deliberate breakages (one at a time, each file restored byte for byte) | **15 of 15 caught** (list below) |
| End-to-end voice simulation A–M (run alone, 05:52–06:21 UTC) | **63/63** |
| Browser screens | not rerun: no client file changed, and no screen shows anything new |

The 15 breakages: the back-fill checking only `judgment_id` (the 3b bug); provable duplicates not reconciled; reconciliation also removing genuine legacy rows; the 3b columns not created before the back-fills; no retry of a failed spend write; the judgment statement not writing its spend row; a failed spend write dropped instead of kept waiting; the export not saying UNRESOLVED; unresolved accounting not keeping the screen incomplete; the export not writing waiting spend first; a failure before the transaction leaving the audio; a failed deletion recorded as deleted; the clean-up ignoring failed deletions; the upload not registered before it is sent; a kept upload not marked kept.

**Found while building (in my own test, not the app):** a "fail once" switch built on a table counter failed every time, because the raised error also undid its own countdown; it now counts with a database sequence, which a rollback does not undo. And forcing `pool.connect()` to fail at first also hit the database library's internal use of it inside ordinary queries; the switch now fires only for the route's own call.

**Scenario G (backlog 3u) stays open:** the midnight-IST clean-up failures of 25 Oct are not explained by later passes, including this run's 63/63.

**Unpopulated export example:** `FitLife-Voice-Calibration-EXAMPLE-unpopulated-3c.xlsx`, from the real export route on a brand-new database: 17 sheets; About's ledger line shows 0 and 0 (no UNRESOLVED, no reconciliation), and the new "recordings never kept" row shows none waiting.

**One limit, stated plainly:** the waiting list for spend that could not be written lives in the server process. If the database refuses writes **and** the server restarts before they are written, those attempts survive only in the server log, which records each one's attempt key and number of calls. A stored fallback would need storage that can be listed, which the storage service does not offer.

`qa/voice-evidence/REQUEST.md` is unchanged, so this push starts no real voice run.

## Before collection
1. The reviewer checks Fixes-3c and plan revision 8.
2. Fluent speakers finish the wording; after any change, each language is confirmed in the app against its final hash.
3. Then the 144-slot session and the Part C sessions begin.
