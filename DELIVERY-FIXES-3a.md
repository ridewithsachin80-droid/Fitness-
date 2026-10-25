# FitLife — Fixes-3a: two corrections after the 2z kit review (25 Oct 2026)

**Name:** Fixes-3a is the follow-up to Fixes-2z (the 2-series ran out of letters).

**Scope:**
- **Test branch only.** The kit works only on the test server.
- It answers the reviewer's *Fixes-2z review* (25 Oct): its two remaining cases, and the screenshot stamps. Every Fixes-2z fix and every earlier test is kept.
- The plan is `claude/FitLife-Voice-Calibration-Plan-2026-10-23.md`, **revision 6**.

**Collection and real-provider batches stay closed.** No real provider, volunteer, invitation or recording was used to verify this patch; every result below uses mocked providers.

**Wording:** fluent speakers may continue reviewing it. Collection stays closed until the reviewer checks this patch and the final wording is confirmed against its hash.

**Unchanged:**
- production (`main` 1ca6ae7);
- the live speech check (200 ms / 60 ms / 6 Hz, same version);
- the provider order and the everyday voice route;
- old pilot evidence and historical verdicts;
- nutrient enrichment and supplement accounting;
- the app (no client file changed).

**B18 and B19 stay open.**

## The review, case by case

**Where each result is tested:** `test-voice-calibration-3a.js` (new, in the gate). The 2z, 2y and 2x suites run unchanged.

| # | The review found | Fixed by | Counterexample → now (positive control) |
|---|---|---|---|
| 1 | Against a reference of 2 idli (100 g), `{qty_text: "2 idli (100 g)", grams: 150}` and `{qty_text: "2 idli (100 g) (150 g)", grams: 150}` were correct reviewable, although the real normaliser and Save builder write 150 g | `weightCheck()` judges **every weight in the label and the saved amount** (`foods[].grams`, what Save writes). **Spoken weight in the reference:** every gram figure and the saved amount must equal it, otherwise a **surfaced wrong number** (disqualifying); a figure in another unit (ml) cannot be compared, so it is a hand check. **No spoken weight:** the weight is the app's estimate for a correct count; one consistent amount (label figures and saved amount agree, ml taken as g) passes, and an estimate that disagrees with itself is a **hand check**, never silent. **Judge version → `judge-3a.1`**, so judgments made under `judge-2y.1` are stale and never qualify | [1]: both exact examples → **disqualifying**; "(100 g) (150 g)" saved as 100 → disqualifying; 100 ml → hand check; with no spoken weight, label 100 saved 150 → hand check. **The save payload:** the real `normaliseFoodReview` and the app's real `createDailyChange` (bundled from `client/src/utils/aiSaveReceipt.js`) write 150 g under the "100 g" label, and the judge reads that same number. **Positives: "2 idli (100 g)" + 100, "2 idli" + 100, "2 pieces" + 100, an estimate beside a correct count, a drink "(250 ml)" + 250; the 2y/2z cases ("2 kg", "2 idli and 3 idli", curd) unchanged** |
| 2 | With 11 used, two simultaneous requests both succeeded and made 13 authorisations | A **grants ledger** (`voice_calibration_replacement_grants`, NEW). `POST /admin/replacement` decides in **one transaction** under an advisory lock for the round: the take row locked, a repeated request answered from the ledger, eligibility, the count, the grant. The **database enforces the cap**: grant numbers are `CHECK (1..12)` and unique per round, and a take can be granted once. **Repeated request:** the same grant comes back (`already: true`); no new allowance, and its reason and time are not overwritten. **One grant, one replacement:** the replacement recording uses the grant in the same transaction (`replacement_take_id`), or is refused. **Never replenished:** the ledger has no foreign key to takes, so withdrawal, removal and the 90-day clean-up never delete a grant. A **spend ledger** (`voice_calibration_spend`, NEW) keeps every transcription and parser call for the same reason. Grants made under 2z (only on the take) join the ledger at boot, up to 12, once. The export's budget lines and History come from the ledgers | [2]: sequential 12th granted, 13th refused; **two simultaneous requests for the last place → exactly one granted, 12 grants (5 of 5 rounds)**; a forced interleaving (a competing grant lands while the request waits for the lock) → refused; the database alone refuses a second grant 12 (unique) and a grant 13 (check); repeated requests, one after another and two at once → one grant, reason and time unchanged; a second replacement on one grant refused; withdrawal and the 90-day clean-up delete takes but leave all 11/12 grants and the spent calls; the budget stays full afterwards; the export shows grants on deleted takes; legacy grants migrate as 1..12 and never past the cap. **The existing refusals stay: a usable take, an unfrozen take, a detector-accepted control, and the volunteer's unrequested "replacement"** |
| — | Cropped admin screenshots had no visible stamp | Each cropped picture now carries the SIMULATED stamp inside the crop (`screens-2z.mjs` and `screens-2y.mjs`, the picture helper only) | Every crop checked by eye in both themes |

## Files
**NEW:**
- `server/scripts/test-voice-calibration-3a.js` (gate)
- `DELIVERY-FIXES-3a.md`

**Changed:**
- `server/services/voiceCalibration.js`: `weightCheck()` and the judge, `JUDGE_VERSION = 'judge-3a.1'`, `REPLACEMENT_ROUND`, the budget and spend lines and History from the ledgers.
- `server/routes/voiceCalibration.js`: `/admin/replacement` as one locked transaction; the replacement recording uses its grant; spend rows for transcriptions and parser calls; the export reads the ledgers.
- `server/db/schema.sql`: additive only. New tables `voice_calibration_replacement_grants` and `voice_calibration_spend` (`CREATE TABLE IF NOT EXISTS`), two partial unique indexes, and one-time back-fills of the 2z grants and existing call counts (idempotent; loaded twice to check).
- `server/scripts/test-local.sh`: the new suite added to the gate.
- `server/scripts/sim/screens-2z.mjs`, `server/scripts/sim/screens-2y.mjs`: the picture helper stamps crops; in `screens-2z.mjs` the seed reset between theme passes also clears the ledger grant. No check changed.

## Changes to existing tests
**No assertion changed.** `test-voice-calibration-2z.js` (46), `test-voice-calibration-2y.js` (99), `test-voice-calibration.js` (126) and `test-calibration-mode.mjs` (24) are byte-for-byte unchanged and pass. The two screen scripts changed only in how a cropped picture is stamped (and, in `screens-2z.mjs`, how its seed is reset).

## Results (mocked providers; real Postgres 16)
| Check | Result |
|---|---|
| `test-voice-calibration-3a.js` (new) | **29/29**: both weight examples and the budget race fail safely, each beside its positive controls |
| `test-voice-calibration-2z.js`, `-2y.js`, `test-voice-calibration.js`, `test-calibration-mode.mjs` (unchanged) | **46/46, 99/99, 126/126, 24/24** |
| Full local gate (schema.sql on an empty database; also loaded twice, and run twice inside the 3a suite, to check it re-runs cleanly) | **all suites pass, 6,855 assertions** (2z: 6,826; run last, on the pushed code) |
| Browser check `screens-2z.mjs` (360 and 390 px, light and dark; crops now stamped inside the picture) | **25/25**; the 2z screens are unchanged (no client change) |
| Browser check `screens-2y.mjs` | **45/45** |
| Deliberate breakages (one at a time, each file restored byte for byte) | **16 of 17 caught**; the other is redundant (below) |
| End-to-end voice simulation A–M (run alone) | **63/63** |

The 17 breakages:
- **Weights (6, all caught):** only the first label figure compared; the saved amount ignored; a weight in another unit passing; an estimate that disagrees with itself passing; the weight hand check not raised; the judge version not changed.
- **Budget (11):** no lock for the round; a repeated request making a new grant; 2z-era grants not counted; a replacement recording not needing an unused grant; withdrawal deleting grants; withdrawal deleting spend rows; transcription calls not logged; the route's budget check removed (caught on its message; the database CHECK still refused the 13th grant, so the cap held); the export ignoring the ledgers; the boot back-fill ignoring the cap. **Redundant:** a repeated request overwriting the original reason. The repeated-request branch answers before that update can run, under the same row lock, and breaking that branch is caught.

**Found while building:**
- My first run of the gate failed the 2y "two taps at once" test. My new spend-row query added a round trip between the two legs, so the second tap sometimes finished first and was not "busy". Each leg was still evaluated once. The judgment and its spend row are now written in **one statement**, which restores the timing and records them together. The 2y test was not changed.
- The first breakage pass found two gaps in my new tests. Without the lock, the forced-interleaving test hung instead of failing (its connection was not released); it now fails cleanly. Two simultaneous replacement recordings for one grant were not tested; they are now (exactly one recorded).
- `screens-2z.mjs` reset its seed by clearing the take's column; with the ledger it now clears the grant too (seed only).
- Older, not from this patch: the very tall 2y admin-panel crop (`screens-2y.mjs`, about 14,000 px) repeats the top of the panel after about 8,200 px, a Chromium capture limit. It was the same in the 2y delivery. Those pictures are not part of this delivery; worth a small fix before they are shared again.
- Rule 3 parser calls reach the spend ledger through the real route (checked by running the 2x suite: 3 rows remain after that suite deleted its judgments). The 3a suite proves the transcription side and the survival of both.

`qa/voice-evidence/REQUEST.md` is unchanged, so this push starts no real voice run.

**Unpopulated export example:** `FitLife-Voice-Calibration-EXAMPLE-unpopulated-3a.xlsx`, from the real export route on a brand-new database: 17 sheets; About shows `judge-3a.1`, the replacement budget from the grants ledger (0 of 12) and the new "calls spent in the round (ledger)" row (0 and 0).

## Before collection
1. The reviewer checks Fixes-3a and plan revision 6.
2. Fluent speakers finish the wording; after any change, each language is confirmed in the app against its final hash.
3. Then the 144-slot session and the Part C sessions begin.
