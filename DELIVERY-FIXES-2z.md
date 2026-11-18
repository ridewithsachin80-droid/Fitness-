# FitLife — Fixes-2z: three corrections after the 2y kit review (25 Oct 2026)

**Scope:**
- **Test branch only.** The kit works only on the test server.
- It answers the reviewer's *Fixes-2y review* (24 Oct): its three remaining cases. Every Fixes-2y fix and every earlier test is kept.
- The plan is `claude/FitLife-Voice-Calibration-Plan-2026-10-23.md`, **revision 5**.

**Collection and real-provider batches stay closed.** No real provider, volunteer, invitation or recording was used to verify this patch; every result below uses mocked providers.

**Wording:** fluent speakers may continue reviewing it. Collection stays closed until the reviewer checks this patch and the final wording is confirmed against its hash.

**Unchanged:**
- production (`main` 1ca6ae7);
- the live speech check (200 ms / 60 ms / 6 Hz, same version);
- the provider order;
- old pilot evidence and historical verdicts;
- nutrient enrichment and supplement accounting.

**B18 and B19 stay open.**

## The review, case by case

**Where each result is tested:** `test-voice-calibration-2z.js` (new, in the gate). The 2y and 2x suites run unchanged.

| # | The review found | Fixed by | Counterexample → now (positive control) |
|---|---|---|---|
| 1 | A complete cohort with all 36 controls marked unsure, or all heard as speech, "passed the screen on 108 speech and 0 no-speech takes" | A control counts for rule 1 only if it is **usable**: the current take has a frozen **"no speech"** label and the live check measured it. **Required before any pass, defined now: a usable control in every volunteer × control × place slot, 36 of 36.** The screen line says how many are usable and why the others are not (unsure, speech heard, not measured, not labelled, not recorded). Exclusions stay visible. **Authorised replacements:** an administrator can ask for one only on an excluded take (frozen label; unsure, the wrong kind of sound, or not measured). Eligibility never depends on the detector's verdict, so an accepted control cannot be swapped out. The volunteer can choose the "replacement" reason only when asked. The excluded take is kept and superseded. **Budget: at most 12 for the round**, then a stop for review. The About sheet shows asked, recorded and the calls already spent; Takes, Controls and History show each one | [1]: all unsure → **incomplete, 0 of 36 usable (36 unsure)**; all speech → **incomplete (36 speech)**, with 36 protocol deviations still shown; one volunteer's 6 controls, or every noisy-place control, or one unmeasured clip → incomplete; one excluded control → incomplete, and its authorised replacement → passes again. Routes: replacement refused before the label is frozen, refused on a usable take, refused on a control the detector **accepted**, refused to the volunteer unasked, refused past the budget. **Full valid cohort → passes, "36 of 36 controls usable"; a newly accepted valid control → fails rule 1** |
| 2 | "2 idli and 2 idli and 1 bowl sambar" scored all correct; a preview showing Idli "2 idli and 3 idli" was correct reviewable | **Every quantity mention is judged**, in transcripts and previews. Two different counts for one food: a **wrong number** in a preview (disqualifying), conflicting (uncertain/unscorable) in a transcript, as before. The same count twice: a **hand check** ("said more than once: one serving or two?"); mentions are never added up. **Count plus weight, handled deliberately:** in a preview, a gram figure beside a single count is the app's estimate, so the count decides. In a transcript, a weight straight after a count ("2 idli, 100 grams") is that portion's weight: correct only if the listener recorded that weight with the item (a new grams box on count items in the reference editor), a **wrong number** if different, and a **hand check** if not recorded. A weight after "and" is a hand check; a weight with its own food is still an extra | [2]: the review's transcript → **needs a hand check**; its preview → **disqualifying**, the "3" named; "2 idli and 2 idli" preview → hand check. **"2 idli 1 bowl sambar", Kannada number words, "2 pieces idli", preview "2 idli", "2 pieces" and "2 idli (100 g)", and "2 idli, 100 grams" with the weight in the reference → correct.** "150 grams" against a recorded 100 → wrong number. The 2y unit ("2 kg idli") and extra ("… and banana") tests still hold, and curd's unspoken amount is still a hand check |
| 3 | A registered name typed as a phone model was removed from the detail sheets but survived in About's phone mix and Part A's model-slice labels | Name removal now runs over **every data cell of every sheet**, after all counting and grouping (which use the original values). The Free text sheet always lists the **derived cells** (About's phone mix, Part A's "phone model …" slices) and the hand-check and replacement notes. Codes shaped like P1, R2, A1 or C1 are never removed, by an explicit rule | [3]: unscrubbed, the name is in About and all 6 Part A model slices (so the test is real); with the name registered, it is in **no cell of any sheet**, and the **whole serialized workbook from the real route** (every XML part, any case) contains neither it nor the volunteer's name. **Every Part A number is identical with and without removal; ordinary model labels survive; R2/P1 survive** |

## Files
**NEW:**
- `server/scripts/test-voice-calibration-2z.js` (gate)
- `server/scripts/sim/screens-2z.mjs` (on demand, simulation only; `screens-2y.mjs` is kept unchanged and was run too)
- `DELIVERY-FIXES-2z.md`

**Changed:**
- `server/services/voiceCalibration.js`: usable control coverage, the replacement budget, every quantity mention, count plus weight, scrubbing every cell, the derived-text checklist.
- `server/routes/voiceCalibration.js`: `POST /admin/replacement` (with the budget); the "replacement" retake reason only when asked; the volunteer's list says when a replacement is asked for; take cards show exclusion, replacement and ambiguities.
- `server/db/schema.sql`: additive only, one column: `voice_calibration_takes.replacement_authorised JSONB` (`ADD COLUMN IF NOT EXISTS`).
- `server/scripts/test-local.sh`: the new suite added to the gate.
- `client/src/components/voicecalibration/VoiceCalibrationPanel.jsx`: grams box on count items (the food picker keeps a readable width); "Not usable: ask for a replacement"; the ambiguity reasons in the score line.
- `client/src/components/voicecalibration/VoiceCalibrationSheet.jsx`: "Your coach asked you to record this one again" on that clip, with the reason chosen.

## Changes to existing tests
**None.** `test-voice-calibration-2y.js` (99), `test-voice-calibration.js` (126) and `test-calibration-mode.mjs` (24) run byte-for-byte unchanged and pass.

## Results (mocked providers; real Postgres 16; the real speech check)
| Check | Result |
|---|---|
| `test-voice-calibration-2z.js` (new) | **46/46**: each of the review's counterexamples fails safely, beside its positive controls |
| `test-voice-calibration-2y.js`, `test-voice-calibration.js`, `test-calibration-mode.mjs` (unchanged) | **99/99, 126/126, 24/24** |
| Full local gate (schema.sql on an empty database; also loaded twice to check it re-runs cleanly) | **all suites pass, 6,826 assertions** (2y: 6,780; run last, on the pushed code) |
| Browser check `screens-2z.mjs` (new; 360 and 390 px, light and dark; every picture stamped SIMULATED) | **25/25**. The excluded control's "Not usable: ask for a replacement" and the kept take; the repeated count's hand check and reason; the grams box (food picker at least 120 px wide); the volunteer's "Your coach asked you to record this one again" with the reason chosen; "replacement" not offered unasked. Contrast at least 5.3:1 light and 6.58:1 dark; no sideways scroll |
| Browser check `screens-2y.mjs` (unchanged) | **45/45** |
| Deliberate breakages (one at a time, each file restored byte for byte) | **23 of 23 caught** (20 on the first pass; the 3 survivors exposed gaps in my new tests, now closed; list below) |
| End-to-end voice simulation A–M (run alone) | **63/63**, the same as 2y |

The 23 breakages, by case:
- **1 (11):** any frozen label, an unmeasured clip, or an unfrozen clip counted as a usable control; the usable-control coverage not required, or only 6 needed; a replacement without the administrator's request, on a usable take, or before the label is frozen; the budget not enforced, or not counted.
- **2 (9):** a repeated count simply correct (transcript and preview); only the first count judged (transcript and preview); a weight not in the reference dropped; a weight after "and" accepted; a mismatched reference weight ignored (transcript and preview); ambiguities not holding the line for a hand check.
- **3 (4):** only the detail sheets scrubbed (the 2y behaviour); the derived cells missing from the checklist; codes registered as names removed; the hand-check notes missing from the checklist.

**The 3 first-pass survivors, and what they found:**
- *An unfrozen control counted as usable:* the screen stayed incomplete for another reason (an unfrozen reference), but the count of usable controls would have been wrong. A test now checks that count ("35 of 36; 1 not labelled").
- *A replacement before the label is frozen:* a later guard ("usable as it is") also refused it, so a status check could not tell which guard answered. The test now checks the message.
- *A weight after "and" accepted:* with no weight in the reference, another rule also gave a hand check. The test now covers a reference that does record 100 g.

**Found while building:**
- At 360 px the new grams box squeezed the food picker in the reference editor down to one letter. It now keeps at least 8 rem and wraps to its own line; the screen check fails if it is narrower than 120 px.
- "Separately budget" needed a real limit, not only a count: 12 replacements for the round, enforced by the route.
- Eligibility for a replacement depends only on the listener's label. A control the detector accepted cannot be replaced, so rule 1 cannot be gamed by swapping out an inconvenient clip (tested).

`qa/voice-evidence/REQUEST.md` is unchanged, so this push starts no real voice run.

**Unpopulated export example:** `FitLife-Voice-Calibration-EXAMPLE-unpopulated-2z.xlsx`, from the real route on an empty database: 17 sheets, with the new columns (Takes: "replacement authorised", "quantity ambiguities"; Controls: "usable for rule 1", "replacement authorised") and the derived rows on the Free text sheet.

## Before collection
1. The reviewer checks Fixes-2z and plan revision 5.
2. Fluent speakers finish the wording; after any change, each language is confirmed in the app against its final hash.
3. Then the 144-slot session and the Part C sessions begin.
