# FitLife — Fixes-2x: the voice calibration kit (23 Oct 2026)

**Scope:**
- **Test branch only.** The kit works only on the test server.
- It answers the reviewer's *Calibration Plan Review and Builder Instructions* (23 Oct).
- The plan is `claude/FitLife-Voice-Calibration-Plan-2026-10-23.md`, **revision 3**.

**Unchanged:**
- production (`main` 1ca6ae7);
- the live speech check's **200 ms** minimum, its other limits and its version;
- the provider order (Gemini first, Whisper only as the fallback);
- nutrient enrichment and supplement accounting.

**B18 and B19 stay open.** Earlier evidence and verdicts are kept as recorded.

**No real provider was called and collection has not started.** Every result below uses mocked providers. Building the kit started no 144-recording session and no real-provider batch. Fluent speakers must confirm the script wording first, and the kit enforces that.

## The review, item by item

| Review item | What the kit does | Proved by (`test-voice-calibration.js` unless named) |
|---|---|---|
| **Bounds** | 6 volunteers (Kannada 3 / Hindi 2 / English 1, quotas checked inside a locked transaction). 144 slots = 3×28 + 2×22 + 1×16 (108 speech + 36 controls). 6 settings. 32 controlled Part C tries + up to 32 Retries = 64 before technical retakes. 288 initial calls stated as an estimate; Gemini's second model, retakes and rule 3 calls each budgeted separately | [0], [7] About sheet |
| **1. Actual transcription path** | Every Part C event records what happened: a server recording (speech check, the engine trail model by model, who answered, upload yes) or **on-device dictation** (upload no, "browser/on-device (no upload)"). Each preview is linked to the attempt whose text it used. A Retry is linked to its original recording by audio fingerprint. Nothing is inferred from the switch or the language selector | [4] |
| Controlled leg | A clearly labelled **test-account-only** mode: only while a try is armed for that account, on the test site, the app uploads the recording instead of using on-device words. A label says so. The ordinary microphone path is unchanged everywhere else. **A try counts for its planned provider only if that provider answered**; a Gemini try that fell back to Whisper is marked "not run as planned" | [4]; browser check: production address never asks |
| Natural trials | Tries 33–40 record the ordinary path as it occurs, on-device dictation included | [4] |
| **2. Everyday configurations, same audio** | Both engines get **the same stored audio** with the everyday voice route's exact requests: prompts, Gemini's two models in order, settings, and each line's language hint. Provenance per call: audio hash, prompt hash, model asked and answered (with version), every Gemini attempt, language sent and reported, result or error, and the fallback's accept/refuse decision. The old pilot tables, prompts and results are untouched | [2], [3] |
| Gate bypass confined | The live speech check is measured on every take but never hides a take from recognition. The bypass exists only in the private calibration route: no log is saved and live acceptance is unchanged | [3] |
| **Rule 3 amended** | Each newly admitted take goes through each leg's everyday verdict and then **the logging parser's preview**, in an evaluation-only mode with **no database write at all**: no coach message, no correction record, no food learning, no evaluation-set record. Judged: correct reviewable / explicit refusal / missing-unresolved (visible) / needs a hand check / disqualifying (wrong number, wrong unit, invented item, unspoken weight, water, sleep, activity, supplement, workout or correction) / provider error. De-duplicated by take; at most 20 parser calls per tap, counted separately | [6] |
| Screening, not release | All 6 settings are reported, with absolute non-speech accepts as well as change from live. Results per volunteer show whether a benefit sits in one speaker or one phone | [7] |
| **Decision precision** | The live check now has one decision function, `decide(features, limits)`. It stores raw whole-frame counts and the **unrounded** pitch spread (exact `DOUBLE PRECISION` columns); the offline settings use the same function. **The review's boundary case:** a tone reported as 6 Hz but really 5.60 Hz is refused live and in replay, through the database too; one at 6.16 Hz is accepted. The refactored check matches a frozen copy of the 2w check on 32 real recordings | [1] |
| **3. Every take kept** | Distinct round, volunteer, slot (line × place) and take. A noisy take never replaces a quiet one. A technical retake needs a reason and marks the earlier take superseded; nothing is overwritten, and the first complete take is kept. Superseded and failed takes stay in the export ledger | [3] |
| Listener reference | Heard: speech / no speech / uncertain. Said as written: yes/no. A reference transcript and the numbers actually said. Every label change is kept. An apparent wrong number on an unconfirmed take is "recheck needed", not an engine error | [3], [5] |
| **Complete outcomes** | 9 line outcomes: all correct, wrong number, wrong unit, missing, extra, empty answer, wrong language/script, provider error, uncertain/unscorable. Item flags coexist, and "all correct" excludes every material error | [5] |
| **Curd** | No amount is spoken. Curd heard is correct; an amount nobody said is "extra". In a preview it must be shown as an estimate | [5], [6] |
| Task lists and consent | Each volunteer sees only their own group's 28 / 22 / 16 slots. Pilot members get nothing new. Consent (`calibration-v1`) names the languages, repetitions, controls, about 30 minutes, phone and browser, who listens, both services, codes and 90-day deletion | [3]; browser check |
| Deletion | Withdrawal, removal by an administrator and the 90-day expiry delete the takes, the audio and the linked preview judgments | [3] |
| **4. Denominators** | Per setting, language, place, line type, phone and volunteer: current takes, retakes, capture failures, uncertain, protocol deviations, unlabelled. A TV voice in a control is a labelled protocol deviation, never a detector accept | [7] |
| No 8% claim | Removed from the plan and the workbook (tested absent). The About sheet says no rate guarantee is claimed | [7] |
| **5. Part C safety** | One try at a time (a second arm is refused until Finish). Arming saves the day and workouts as the baseline. **Read back** lists every change; **Restore** puts back only this try's changes and compares the whole day with the baseline; **Finish** verifies the switch is off, warns if not, and closes the try. Text edited before a preview is flagged EDITED, and hand marks keep their history | [4] |
| **Export** | 14 sheets, codes only, **no names and no audio**: About, Volunteers, Plan, Lines, Slots, Takes, Items, Part A summary, Rule 3 previews, Part B summary, Number words, Controls, Part C tries, Part C events | [7] |

**The review's key finding is confirmed in the code.** The shipped app uses the phone's own dictation whenever the browser gives words, and then nothing is uploaded. The Voice backup switch cannot reach those results. This is why controlled and natural tries are kept apart.

## Files
**NEW:**
- `server/services/voiceCalibration.js`
- `server/routes/voiceCalibration.js`
- `server/scripts/test-voice-calibration.js` (in the gate)
- `server/scripts/fixtures/voice/speechPresence-2w-reference.js`: a frozen copy of the 2w speech check, for the equivalence test; never edited
- `server/scripts/sim/screens-2x.mjs` and `server/scripts/sim/calibration-storage.cjs`: the on-demand browser check; simulation only
- `client/src/utils/calibrationMode.js`
- `client/src/components/voicecalibration/VoiceCalibrationCard.jsx`
- `client/src/components/voicecalibration/VoiceCalibrationSheet.jsx`
- `client/src/components/voicecalibration/VoiceCalibrationPanel.jsx`
- `DELIVERY-FIXES-2x.md`

**Changed:**
- `server/services/speechPresence.js`: `decide()`, `LIVE_LIMITS` and the raw `features`. Decision, reply fields and version are unchanged.
- `server/routes/aiChat.js`:
  - the voice route keeps an engine trail, read only when a Part C try is armed on the test server;
  - the parse route links a preview to an armed try;
  - `parseMemberMessage` gains the `evaluation` option.

  Default behaviour is unchanged and the kit is loaded lazily.
- `server/db/schema.sql`: 6 new tables, `CREATE TABLE IF NOT EXISTS`; nothing renamed or altered.
- `server/index.js`: mounts `/api/voice-calibration`.
- `server/services/cronService.js`: the 90-day clean-up.
- `server/scripts/test-local.sh`: `test-voice-calibration` added to the database suites.
- `client/src/hooks/useVoiceInput.js`: on the test site only, an armed controlled try uploads instead of using on-device words; a natural try reports on-device dictation.
- `client/src/components/VoiceComposer.jsx`: the "calibration try" label.
- `client/src/pages/Today.jsx`: the volunteer card, under "Check-ins & recovery".
- `client/src/pages/AdminDashboard.jsx`: the panel.

**No existing test was changed or removed.**

## Results (mocked providers; real Postgres 16; the real speech check on real recordings)
| Check | Result |
|---|---|
| `test-voice-calibration.js` (new, in the gate) | **126/126** |
| Existing voice suites, unchanged | everyday voice 95, Voice backup switch 44, speech check 52, pilot 133: all pass |
| Refactored speech check vs the frozen 2w copy | identical on **32 recordings**, plus the review's 5.60 Hz boundary tone |
| Full local gate (schema.sql on an empty database) | **all suites pass, 6,657 assertions** (2w: 6,531) |
| Browser check `screens-2x.mjs` (360 and 390 px, light and dark) | **36/36**: volunteer card and recording, a retake reason, the wording lock, the admin panel; Part C not armed / natural / controlled with a fake microphone; **the production address makes no calibration request**. Contrast at least 5.3:1 light and 6.6:1 dark; no sideways scroll |
| Deliberate breakages (one at a time, each file restored byte for byte) | **25/25 caught** (list below) |
| End-to-end voice simulation A–M (the voice and parse routes changed; run alone) | **63/63**, the same as 2w |

The 25 breakages, each caught:
- **Exact replay:** deciding on the rounded pitch spread; `>` for `>=`; raw measurements stored rounded.
- **Take history:** a retake replacing the earlier take; no retake reason.
- **Wording:** the wording gate skipped; the wording hash ignoring the words.
- **Engines:** a different Gemini request from everyday logging; the answering model not recorded.
- **Part C:**
  - the engine trail dropped;
  - an arming that never expires;
  - the recorder changing the member's reply;
  - on-device dictation labelled as Gemini;
  - restore leaving added workouts;
  - a second try armed while one is open;
  - Finish always reporting the switch off.
- **Rule 3:**
  - evaluation mode learning foods;
  - evaluation mode recording a correction;
  - invented items ignored;
  - an unspoken weight ignored;
  - "newly admitted" meaning accepted by both settings.
- **Scoring and counts:** an extra item not flagged; protocol deviations counted as intended; quotas off.
- **Scope:** the kit available off the test server.

**Unpopulated export example:** `FitLife-Voice-Calibration-EXAMPLE-unpopulated.xlsx`, from the real route on an empty database:
- 14 sheets;
- 0 of 6 volunteers and 144 planned slots;
- every language NOT CONFIRMED;
- budgets and denominators all at zero;
- the full slot plan (66 rows), the 15 lines and the 32 controlled tries. Natural observations (33–40) appear as they are recorded.

**Found and fixed while testing:**
- **A gap in the kit's own test, found by a breakage.** The first round of deliberate breakages showed that evaluation mode could record a correction to an earlier entry without any test failing. A new check now sends a preview with a correction: evaluation mode records nothing, and the same message on the live path does record one (the positive control). Two related fixes:
  - the no-write check's spy now records only during the evaluation calls, because pooled database connections keep the spy after release;
  - its new food gets a unique name per run, because a food left over from an earlier run would hide a learning write.
- A test hang: the no-write spy's database `connect` ignored the callback form.
- The admin panel crashed when it opened: a hook sat after an early return.
- Under the production-address check, helmet's upgrade rule blocked plain HTTP; the check now serves the build through request interception.

`qa/voice-evidence/REQUEST.md` is unchanged, so this push starts no real voice run.

## Before collection
1. The reviewer checks plan revision 3 and this kit.
2. Fluent speakers confirm each language's wording on the admin card.
3. Only then do the 144-slot session and the Part C tries begin.
