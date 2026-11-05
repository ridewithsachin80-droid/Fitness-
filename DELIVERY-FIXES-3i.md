# FitLife — Fixes-3i: the Kannada wording after the fluent speaker's review (5 Nov 2026)

**Scope:** test branch only. Based on **b979c4d** (Fixes-3h, accepted). It carries the first fluent-speaker review of the round-1 script: **R1 reviewed the seven Kannada lines** (5 Nov, reported by Sachin):

| Line | R1 | Done |
|---|---|---|
| k01, k06, k13, sk1 | ok | unchanged |
| k02 | "upma can be upitu in Kannada" | the line now says **uppittu**: "Breakfast-ge ondu plate uppittu, ondu cup coffee" (means "a plate of uppittu (upma)…", scored "1 plate uppittu") |
| k04 | "katori can be batalu in Kannada" | the line now says **battalu**: "Lunch-ge eradu chapati, ondu battalu dal mattu mosaru" (means "a battalu (bowl) of dal…", scored "1 battalu dal") |
| k11 | "eppatu is 70, epatu is 20" | **unchanged**: the line says "eppattu eradu" (72), which is right for 72.5 kg. Read as a warning that 70 and 20 sound alike; the scorer already tells them apart (ippattu 20, eppattu 70), and whether the engines do is what the recordings will show. To be confirmed with R1 when they read the new version |

Sachin's instruction (5 Nov): **"any spelling is ok, app should identify"**. So the scorer now accepts every common spelling, and Kannada script:
- **uppittu / uppitu / upittu / upitu / uppit / upma / ಉಪ್ಪಿಟ್ಟು / ಉಪ್ಮಾ** → upma;
- **battalu / battlu / batalu / batlu / bataalu / ಬಟ್ಟಲು** → the katori family (as katori; "bowl" stays the accepted alias for dal, as before).

**This is not a confirmation.** The Kannada lines now have a **new hash, `4087ba15e0a6`** (full: `4087ba15e0a683b81a346f844d0f8dc2dd010637213bc3e8220a791ccd138fc0`). Kannada stays **not confirmed, locked** until a fluent speaker reads the new lines and the check is recorded in the panel against that hash. A check recorded against the old `02dc7a808038…` reads **"check void (lines changed), locked"** (none was recorded: the live panel showed 0/3). **Hindi `21ef021a6c57…` and English `9bd51a13bb06…` are byte-for-byte unchanged**, so their reviews can go ahead as they are.

**Unchanged:** production (`main` 1ca6ae7); the older pilot (Kannada Voice Test: its k02 still says "upma", its history and verdicts stay as they were); the transcription prompts, provider order, live speech check (200 / 60 / 6), nutrients and supplement accounting; every wording record. No confirmation was made on anyone's behalf. Collection, invitations for collection and real-provider batches stay closed. **B18/B19, Scenario G (3u), B20 and the 61/63 simulation anomaly (3z-b) stay open.** No client change, so no new `client/dist` (the gate's built-client check confirms the committed build still matches the source).

**Versions:** script `round1-script-v1` → **`round1-script-v2`** (the lines changed; no take was ever recorded under v1). Judge `judge-3a.1` → **`judge-3i.1`** (the scorer's word lists changed; any judgment made under an earlier version is stale and never reused — there are none: no take has been recorded).

## Files
**NEW:**
- `server/scripts/test-voice-calibration-3i.js` (gate, module suite, 16 checks)
- `server/scripts/sim/screens-3i.mjs` (the screen check below; simulation only, not in the gate)
- `DELIVERY-FIXES-3i.md`

**Changed:**
- `server/services/voiceCalibration.js` (k02 and k04, the uppittu and battalu spellings, the two version labels)
- `server/scripts/test-local.sh` (the new suite in the gate)
- `server/scripts/test-voice-calibration-3a.js`, `server/scripts/test-voice-calibration.js`, `server/scripts/check-live-calibration-panel.mjs` (one assertion each, below)

## Changes to existing tests
1. **`test-voice-calibration-3a.js`** — "the judge version changed with these rules": expected `judge-3a.1` → **`judge-3i.1`**. The scorer's rules changed in this delivery, so its version must move (that is what makes older judgments stale). What the check protects is unchanged: a judgment cached under an older judge (2y, and now 3a) is never reused.
2. **`test-voice-calibration.js`** — the unpopulated export's About sheet: expected `round1-script-v1` → **`round1-script-v2`**. Everything else in that assertion is unchanged (still 3 × NOT CONFIRMED).
3. **`check-live-calibration-panel.mjs`** (robot workflow) — the wording **status inventory**'s reference hash for Kannada: `02dc7a808038` → **`4087ba15e0a6`**. This row reports, it does not gate; Hindi and English references unchanged.

No other test changed. No test was removed or loosened.

## Results
| Check | Result |
|---|---|
| `test-voice-calibration-3i.js` (new) | **16/16**. [1] new lines and hash, Hindi/English hashes identical, versions, pilot untouched; [2] every spelling above scores k02/k04 correct, k04 wholly in Kannada script correct, "bowl" still the alias; **negative controls**: poha is not uppittu, a cup or glass of dal is still a wrong unit, "eradu battalu dal" is still wrong; [3] the preview judge reads "Uppittu" and "1 battalu" exactly as "Upma" / "1 katori"; a cup of dal still differs |
| Mutation checks on the new suite | removing the battalu spellings → 3 checks fail; removing upitu/upittu → 1 fails; making battalu its own unit (not the katori family) → 4 fail; the 3h service (b979c4d) → 7 fail |
| Calibration suites on a real local Postgres (from `schema.sql`) | calibration 126, 2y 99, 2z 46, 3a 29, 3b 14, 3c 21, 3d 20, 3e 19, 3f 26, panel 18, pilot 134: **all pass** |
| Screens (`screens-3i.mjs`, SIMULATED, local server, real client build) | **40/40**: at 360 and 390 px, light and dark: Kannada shows the new k02/k04 and hash `4087ba15e0a6`, Hindi/English hashes unchanged, "not confirmed, locked", 0/3; with a check recorded against the old hash → "check void (lines changed), locked", still 0/3; text contrast 6.17–14.57; no sideways scroll |
| Full local gate | **all suites pass, 7,006 assertions** (3h: 6,990; + 16 new). Three existing assertions updated as listed above |
| Live site after the push | recorded in the follow-up delivery-note commit |

## For Sachin
1. **Hindi and English:** go ahead exactly as in the guide; their lines and hashes did not change.
2. **Kannada:** after this deploy, the Kannada box shows the new k02 and k04 and **Script hash `4087ba15e0a6`**. Send R1 the new Kannada reading sheet. When R1 approves, choose R1's code in the Kannada box and tap Confirm.
3. If R1 meant something else by the k11 note, tell me before confirming.
