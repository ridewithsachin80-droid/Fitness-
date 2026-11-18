# FitLife — Fixes-2y: the calibration kit, corrected after the 2x review (24 Oct 2026)

**Scope:**
- **Test branch only.** The kit works only on the test server.
- It answers the reviewer's *Fixes-2x calibration kit review* (24 Oct), all six finding groups.
- The plan is `claude/FitLife-Voice-Calibration-Plan-2026-10-23.md`, **revision 4**.

**Collection and real-provider batches stay closed.** No real provider, volunteer, invitation or recording was used to verify this patch; every result below uses mocked providers.

**Wording:** fluent speakers may review it now. After any wording change, each language is confirmed against its final script hash, by reviewer code.

**Unchanged:**
- production (`main` 1ca6ae7);
- the live speech check (200 ms / 60 ms / 6 Hz, same version);
- the provider order;
- old pilot evidence and historical verdicts;
- nutrient enrichment and supplement accounting.

**B18 and B19 stay open.**

## The review, finding by finding

**Where each result is tested:**
- **2y:** `test-voice-calibration-2y.js` (new, gate).
- **mode:** `test-calibration-mode.mjs` (new, gate).
- **2x:** `test-voice-calibration.js`.
- **screens:** `scripts/sim/screens-2y.mjs`.

| # | The review found | Fixed by | Counterexample → now (positive control) |
|---|---|---|---|
| 1 | The screen "passed" when both legs were provider errors, hand checks or missing/unresolved, or with zero controls | A leg counts only with a **current, completed, valid** judgment (correct reviewable or an explicit refusal with nothing saveable). Errors, hand checks, stale or running judgments and unfrozen references leave it **incomplete**. Missing or unresolved items **fail** it: the agreed rule applied explicitly. A pass also needs full coverage: 6 volunteers, 144 slots, every reference frozen, 36 controls labelled, every take re-measured, and the phone mix. Replay or re-measure mismatches **block** it. Exclusions are shown | 2y [1]: provider errors → incomplete; hand checks → incomplete until a hand verdict (then pass; "disqualifying" fails); missing/unresolved → fails; zero controls → incomplete; stale, other judge version, unfrozen, not re-measured, phone mix, 5 of 6, an unjudged or running leg → incomplete; replay mismatch → blocked; extra non-speech → fails rule 1. **Full valid cohort → passes** (a proposal only) |
| 2 | "2 kg idli" and "… and banana" scored all correct; a "2 kg" idli preview and curd "1 bowl" were correct reviewable; a question flag bypassed inspection | A counted food takes no unit but a count word. Unnumbered extra foods are caught (strict word match, so "minutes" is never read as "meenu"). Every unexplained word or stray number sends the line to a **hand check**: a pending state, the nine outcomes unchanged. Every saveable field is inspected; a note, draft edit or unrecognised field goes to a hand check. A refusal flag counts only with nothing saveable. **Curd's unspoken amount is always a hand check: the voice preview card shows portions with no estimate label** (only photos say "estimates") | 2y [2]: each of the review's four rows, the mixed question, and every health field (water, sleep, activities, ACV, supplements, workouts, corrections) → caught. **The script, Kannada script, an English translation, Devanagari, k13 sets, e03 minutes and a correct preview stay correct** |
| 3 | The card showed transcripts before the listener's reference; unfrozen takes counted; a changed reference reused the old successful judgment; references could not describe other foods; sequential de-duplication only | **Reference first:** no transcript, verdict or score until the listener (by code) saves the reference. **Frozen and versioned:** every version kept with its hash. **Complete corrected items** (any readable food or unit, added, dropped or changed) or **"can't be scored"**. **Judgments** are keyed by take, engine, reference hash and judge version: a change makes earlier ones **stale** (kept, never reused), and re-evaluation runs only when asked, counted apart. A **claim row** before the parser call means two taps never evaluate a leg twice. Part B hand checks re-open on a new reference | 2y [3]: the card hides every engine field before freezing; an unfrozen take adds 0 to "all correct" (shown as awaiting); a reference corrected 2 → 1 idli makes the old judgment stale, re-evaluation then disqualifies, and all 4 rows are kept; complete items score a different food, an extra and an omission; an unreadable food is refused; two simultaneous taps → 2 parser calls, not 4 |
| 4 | Controlled mode was a cached flag that outlived the try | The mode is bound to the **signed-in account and the armed session's key and expiry** (time left, so phone clocks don't matter). It is read afresh **at the start of every recording** and fixed for that take. It is cleared on expiry, Finish, sign-out or account change. Each upload carries the take's session key; only matching recordings count | mode: the review's repro (31 minutes later, no refresh) → no longer forces upload; arming after the composer opened is picked up at the next recording; Finish mid-take keeps that take's mode; account change, sign-out and a late answer are handled; production makes **no** calibration request. screens: the same in a real browser |
| 5 | Finish returned ok and removed Restore while the day was unrestored and the switch on | Each arming is a **session** with its own baseline. Finish stops recording at once but **completes only when the day equals the session's baseline and the switch is off**; otherwise it reports what is left and the session stays open (Restore and Finish by session). No new try while any session is unresolved, with a database guard as well. Expired sessions stay recoverable. Repeats keep every session. Restore touches only the session's account and date, and the switch is never changed | 2y [5]: the review's repro → ok false, both problems listed; Restore after Finish works (was 409); arming refused until resolved; switch off then Finish → complete; an expired session restored and finished; try 1 repeated keeps both baselines; another account's day, another date and the switch untouched; recordings with no key or another session's key don't count |
| 6 | Only a phone tier was recorded; the export lacked provenance and history; a name in a wording check was exported | **Phone details:** make, model, OS, OS version and browser version, each with "I don't know", pre-filled from the browser and snapshotted per take. **Reviewers:** registered privately and acting **by code**; a name is refused. **Export, 17 sheets:** adds Part C sessions, History (labels, every reference version, hand checks, judgments, hand verdicts, marks, session steps, wording checks; "by" as A1/R1 codes) and Free text. Part C events gain session, audio fingerprint, language, HTTP status and model version; rule 3 rows show the full preview content and parser. **Names:** registered names (and their parts) and every account's full name are removed from free text; the Free text sheet lists what to read before sharing | 2y [6]: consent without device refused; "unknown" stored; each take keeps its own phone after a change; a name, a listener-only code or an old hash refused for wording; no registered name or name part anywhere in the shared file; an account's full name removed from a note; an unregistered name's column flagged for reading; History "by" values are codes only |

## Files
**NEW:**
- `server/scripts/test-voice-calibration-2y.js` (gate)
- `server/scripts/test-calibration-mode.mjs` (gate, 24; jsdom, the real hook and composer)
- `server/scripts/sim/screens-2y.mjs` (on demand, simulation only; `screens-2x.mjs` is kept unchanged as the 2x record)
- `DELIVERY-FIXES-2y.md`

**Changed:**
- `server/services/voiceCalibration.js`: the judges, the references, the screen, sessions and the export.
- `server/routes/voiceCalibration.js`: reviewers, reference, hand checks, versioned rule 3 with claims and hand verdicts, Part C sessions, device capture, the export inputs.
- `server/routes/aiChat.js`: the voice route passes the app's session key to the Part C record. One line; members' replies are unchanged.
- `server/db/schema.sql`: additive only.
  - New tables: `voice_calibration_reviewers`, `voice_calibration_preview_judgments`, `voice_calibration_partc_sessions` (with a one-unresolved-session index).
  - New columns: device and reference-version columns on participants and takes, and the session on the armed row.
  - The 2x table `voice_calibration_preview_evals` is kept and no longer written.
- `server/scripts/test-local.sh`: the two new suites added.
- `server/scripts/test-voice-calibration.js`: setup changes only (below).
- `client/src/utils/calibrationMode.js`: session-bound mode.
- `client/src/hooks/useVoiceInput.js`: the mode is read at a take's start and fixed for it; the take's session key is sent with the upload. Off the test site nothing changes, and the upload body is identical.
- `client/src/components/VoiceComposer.jsx`: the label is kept current (every minute and on returning; no request off the test site).
- `client/src/components/voicecalibration/VoiceCalibrationPanel.jsx`: reviewers, reference-first take cards, hand checks, re-evaluate, recoverable sessions.
- `client/src/components/voicecalibration/VoiceCalibrationSheet.jsx`: phone details on the agreement screen.

## Changes to an existing test (`test-voice-calibration.js`, 2x): why

No assertion was weakened or removed. The 2x behaviours these touched are now required to be different by the review:
- **Agreeing:** the three consent calls now send the phone's details. Agreeing without them is refused (finding 6).
- **Wording:** the two wording checks register a reviewer and confirm with the code. A name is refused (finding 6). The "needs who checked it" assertion is unchanged.
- **Part C recordings:** the test's voice calls send the session key, as the app now does. Without it a recording cannot count as a controlled test (finding 4). The 2y suite proves that a recording without the key does not count.
- **The switch-on Finish:** after it, the test turns the switch off and calls Finish again before arming the next try. 2x armed straight away; 2y refuses that until the session is resolved (finding 5). The assertion that the switch was NOT verified off at that Finish is unchanged and still passes.
- **The Part C export check:** it now also receives the sessions, where restores and switch checks live.
- **Rule 3:** the section freezes the two takes' references (said as written) before evaluating, and reads the versioned judgments table (finding 3). Every assertion in it is unchanged.
- **The sheet list:** "14 sheets" becomes "17 sheets". The 14 earlier sheets keep their names and order; Part C sessions, History and Free text are added.
- **Clean-up lists:** they include the new tables.

## Results (mocked providers; real Postgres 16; the real speech check)
| Check | Result |
|---|---|
| `test-voice-calibration-2y.js` (new) | **99/99**: every counterexample fails safely, each with a positive control |
| `test-calibration-mode.mjs` (new) | **24/24** |
| `test-voice-calibration.js` (2x, setup updated as above) | **126/126** |
| Full local gate (schema.sql on an empty database; also loaded twice to check it re-runs cleanly) | **all suites pass, 6,780 assertions** (2x: 6,657) |
| Browser check `screens-2y.mjs` (360 and 390 px, light and dark; every picture stamped SIMULATED) | **45/45**. The agreement screen's labelled phone details; the reviewer register; wording by code; reference-first take cards; a hand check; an unresolved session with what is left; the controlled upload carrying its session key; a long-open composer stopping after the window ended; the production address making no calibration request. Contrast at least 5.3:1 light and 6.58:1 dark; no sideways scroll |
| Deliberate breakages (one at a time, each file restored byte for byte) | **38 of 40 caught**; the 2 others are equivalent (a second guard keeps the behaviour), and breaking both layers of each is caught (list below) |
| End-to-end voice simulation A–M (the voice route changed; run alone) | **63/63**, the same as 2x |

The 40 breakages, by finding:
- **1 (7):** provider error / missing-unresolved / hand check counted as valid; a stale judgment reused; control or recording coverage not required; a replay mismatch not blocking.
- **2 (7):** a unit on a counted food accepted (transcript and preview); unnumbered extras missed; unexplained words ignored; a refusal flag winning over saveable content; curd's amount without a hand check; an unspoken sleep entry ignored.
- **3 (8):** transcripts shown before freezing; re-evaluation counted as initial; stale judgments re-run unasked; no claim before the parser call; unfrozen takes counted in Part B; a hand check surviving a new reference; and both freeze guards removed. The draft-label check alone is **equivalent**, because the database update also refuses a frozen take.
- **4 (6):** the cached mode never expiring; the recording start using the cache; a controlled snapshot reporting on-device dictation; a take reading its mode at its end; and the account ignored with sign-in changes unwatched. The account check alone is **equivalent**, because the sign-in watcher clears the mode first.
- **5 (6):** Finish completing with the day unrestored; Restore reaching only a recording session; arming over an unresolved session; the switch never checked; another session's recording counted as an attempt; counting ignoring the session key.
- **6 (6):** agreeing without phone details; no per-take device snapshot; the wording check accepting a name; names not removed; history showing account ids; a legacy wording name shown.

The breakages found a gap in my own new test: the direct check that a controlled snapshot never reports on-device dictation used a snapshot from another sign-in, so a different guard answered first. It now uses the same sign-in, with a positive control.

**Found while building:**
- A loose prefix match read "minutes" as "meenu" (fish). Extras now use a strict word match.
- In k13 ("squat 3 set"), the set count was taken as an amount for the squat. This was a 2x defect, now fixed.
- The admin listener picker defaulted to the first registered listener. It now starts empty, so a reference is never credited to someone by default.
- The new reviewer list showed a raw role value, which the gate's rename contract forbids. It now goes through a display map; the contract test is unchanged.
- Pre-filled phone details ("153") had no visible label. Each field now has one.

**Unpopulated export example:** `FitLife-Voice-Calibration-EXAMPLE-unpopulated-2y.xlsx`, from the real route on an empty database: 17 sheets with the revised columns.

`qa/voice-evidence/REQUEST.md` is unchanged, so this push starts no real voice run.

## Before collection
1. The reviewer checks Fixes-2y and plan revision 4.
2. Fluent speakers review the wording; after any change, each language is confirmed in the app against its final hash.
3. Then the 144-slot session and the Part C sessions begin.
