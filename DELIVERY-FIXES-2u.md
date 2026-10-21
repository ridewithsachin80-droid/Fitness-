# FitLife — Fixes-2u: silence refusal and voice-robot corrections after the first real run (21 Oct 2026)

Test branch only. Production (`main` 1ca6ae7) is unchanged. Nutrient enrichment and supplement accounting are unchanged.
**B18 and B19 stay open.** The first real run's evidence and its FAILED verdict are kept exactly as recorded; nothing here re-scores that run.

## 1. App (B18): a recording with no speech is refused before any provider
**What happened on 21 Oct (S4):**
- 6 s of silence came back from Whisper as "Transcription by ESO. Translation by —", reported English, with log-prob −0.448, no-speech 0.187 and compression 1.025.
- FitLife accepted it and echoed it into the chat.

**Now, in `POST /api/ai-chat/voice-transcribe`:**
- **The recording itself is checked for speech, on the server, before Gemini or Whisper is asked** (`server/services/speechPresence.js`, NEW).
  - **Decoding:** ffmpeg decodes webm/opus and iPhone mp4/AAC to 16 kHz.
  - **What counts as a voiced frame:** louder than the recording's own background and than −55 dBFS, AND periodic like a voice (a YIN pitch between 80 and 400 Hz).
  - **What counts as speech:** at least 200 ms of voiced frames and a pitch that moves.
- **What the check refuses:** noise alone (pink, white, brown, room rumble, very loud) has no voiced frames; a steady beep, two-tone beat or mains hum has a pitch that never moves. Neither counts as speech.
- **What still passes:** quiet speech, female and male voices, Kannada, Hindi, mixed sentences and an iPhone recording all pass. These are regression fixtures.
- **Refusal:**
  - The reason is `no_speech_detected`, with the message "Didn't catch any speech in that recording. Retry it, speak a little closer to the phone, or type your log."
  - The take stays on the phone for Retry (the identical recording) or Discard.
  - No chat message, preview or saved item is created, and no provider is called.
- **A narrow guard for generated credit/subtitle text** (`generatedText` in `services/voiceLanguage.js`; the same list is in the client, and the tests check the two lists match):
  - A transcript, or a Whisper section, that is nothing but text like "Transcription by …", "Translation by …", "Subtitles by …", "Thanks for watching" or "Please subscribe" is refused as `generated_text`.
  - Nothing is ever stripped out of a real sentence: "2 idli. Thanks for watching." passes unchanged.
- **Every entry path:**
  - **The in-app voice note (Gemini or Whisper):** the audio check, then the guard.
  - **The phone's on-device dictation** (text only, so no audio check is possible): the client guard ignores credit-only words, and that recording then goes to the server instead.
  - **Hands-free mode:** the guard.
  - **The phone shortcut `/api/quick-log`** (saves with no preview): the server guard.
  - **The pilot recordings** are evaluation records, not logs; their raw answers are kept as heard.
- **When the check can't run:** if ffmpeg can't read a recording, or the server has no ffmpeg, the check reports `undecodable`/`unavailable` and the voice note carries on as before. `/health` now reports `speech_check: true|false`, and the voice robot blocks unless it is true.
- **`routes/aiChat.js` loads the speech check on first use, not when the file loads.** The parser suites load `aiChat.js` with a strict list of allowed modules; this keeps those lists unchanged.
- **ffmpeg comes from the npm package `ffmpeg-static` 5.2.0** (pinned in `server/package.json`). npm downloads a static ffmpeg binary at install time, on Railway and on GitHub. That binary is GPL-licensed and is run only as a separate program on the server; it is never shipped to phones.
- **Tests:**
  - `test-speech-presence.js` (NEW, in the gate): 18 recorded audio fixtures plus synthetic signals, with the S4 reply as an exact fixture.
  - `test-voice-phase2.js`: route checks.
  - `test-voice-fallback-test.js`: the tries record keeps the speech check and request.
  - `test-quick-log.js`, `test-logging-phase2.mjs`: client refusal, Retry identity, no echo.

## 2. Pilot (B19): an empty answer is not an answer, and is asked again
- **The re-run now counts five things separately:** requests, provider responses, answers with words, empty answers and errors.
  - The first run's case reads "2 requested · 2 provider responses · 1 with words · 1 empty", where before it read "answered 2 of 2".
- **Which recordings are re-run:** a recording whose latest answer is empty or blank is asked again, within the approved `sample_ids` scope. An answer with words is not re-asked.
- **Every attempt is kept** in `voice_sample_rerun_attempts` (NEW table, `CREATE TABLE IF NOT EXISTS`).
  - The answer being replaced is copied there first, so the first run's empty k01 answer is never lost.
  - Each attempt records model, language, prompt hash and audio hash (never the audio).
- **Screen, Excel and summaries keep three things apart:** "empty answer (no words)", "no answer" (an error), and an answer that left out a food (rule checks). The Excel export gains an "every attempt" sheet.
- **Retry for missing answers** still covers only recordings with NO answer; an empty answer is a result.
- **Both Whisper paths already used `verbose_json`;** the run-1 note saying otherwise is corrected. The tries record now carries the exact request (path, model, language, prompt hash, audio hash, MIME type), so the pilot and everyday paths can be compared like for like.
- **Not done (needs your go-ahead):** a vocabulary-prompt experiment. The provider order is unchanged.

## 3. Voice evidence robot
- **Chat-only reply:** an accepted transcript followed by an AI reply with no new log card is now an outcome.
  - The robot records the reply and the parse, and verifies nothing was saved.
  - For S4 it is a quality FAIL ("a chat reply is not a refusal").
  - An HTTP error, timeout or unfinished answer is still an error (INCOMPLETE).
- **Blank sleep:** only `{}` and the exact template `{bedtime:'', waketime:'', quality:0}` compare as empty. Real times, a non-zero quality, extra fields and zeros elsewhere still count. Raw values are kept and the report explains the rule.
- **Two read-back failures are now reported separately:** "saved items differ from their preview" and "an unrelated day field changed".
- **Case isolation:**
  - Every attempt runs in a brand-new page (fresh app, conversation, recorder); an old Save card can't be mistaken for the current one.
  - The robot checks that the recorder started (recording state shown AND the microphone taken) and that Stop ended it.
  - Audio sources, tracks and contexts are released, and the page closed, on success and failure.
- **Captured audio is proven:**
  - The ACTUAL upload is decoded and its loudness envelope matched against the source sound (r ≥ 0.6 at the best delay). The upload must be sounding over at least 90% of the source's sounding part; silence must arrive as silence.
  - A capture that fails is **INVALID**: repeated once, never counted, and excluded from the quality totals.
  - Computer-voice uploads are kept in the evidence; human recordings never are (hashes only).
- **The dal portion rule (approved):** "1 katori dal" shown as "1 bowl dal" passes only at the same estimate.
  - The estimate is the member's own learned portion when they have one, otherwise the app's 150 g. Other amounts fail.
  - Katori vs bowl for any other food is UNVERIFIED; one vs two still fails; a cup is still not a bowl.
  - The spoken words and grams stay in the evidence as an app estimate, not a measurement.
- **Names:**
  - The admin screenshot is cropped to the voice-test card. Every member, coach and admin name on the page is replaced with [M1]… before the picture is taken. If any name could still be found, the picture is not taken.
  - Report, results and workbook are checked against those names before they are written.

## Changed tests (and why)
- `test-voice-evidence-sim.mjs` scenario A, two assertions:
  - **S5** is now refused by the server's speech check (`no_speech_detected`; a refusal is allowed for S5), instead of the canned preview FAIL.
  - **The re-run line** reads "2 requested · 2 provider responses · 2 with words · 0 empty · 0 errors", instead of "asked 2, answered 2".
  - Both follow directly from the reviewed changes.
- `test-voice-pilot.js`: the Whisper stand-in can return a queue of answers. Existing assertions are unchanged.
- `test-local.sh`: adds `test-speech-presence`.
- No other existing assertion was changed or removed.

## NEW files
- `server/services/speechPresence.js`
- `server/scripts/test-speech-presence.js`
- `server/scripts/fixtures/voice/` (18 audio fixtures and `make-fixtures.sh`)
- `server/scripts/sim/screens-2u.mjs`
- `DELIVERY-FIXES-2u.md`

## Test results (local, before push; mocked or simulated; no real provider)
- **Full gate (real Postgres 16, schema.sql on an empty database): all suites pass, 6,467 assertions** (2t: 6,328). New checks per suite:
  - `test-speech-presence` 52 (NEW suite);
  - `test-voice-phase2` 95 (+19);
  - `test-voice-pilot` 134 (+14);
  - `test-voice-evidence-robot` 142 (+38);
  - `test-voice-fallback-test` 44 (+5);
  - `test-logging-phase2` 180 (+5);
  - `test-quick-log` 37 (+3);
  - `ui-tests` 992 (+3).
- **Mutation checks:** 17 robot rules and 9 app rules broken on purpose, each caught by a failing test.
  - One robot mutation (capture correlation not required) first survived. A check was added for loud noise captured in place of speech; it is now caught.
- **Simulated end to end (`test-voice-evidence-sim.mjs`; real robot, browser, server and Postgres, CANNED providers; SIMULATED):** scenarios A–I pass; J passes after one fix.
  - **J's fix:** the simulation-only broken microphone was a disconnected source, so the app uploaded nothing; it now uploads silence. The robot had correctly marked the first version INVALID, but for a different reason.
- **Screens (SIMULATED server):** `scripts/sim/screens-2u.mjs`, at 360 and 390 px, light and dark.
  - **Member refusal message:** contrast 6.16:1 light, 9.33:1 dark.
  - **Coach "empty answer (no words)":** 5.83:1 light, 10.34:1 dark.
  - **Coach "Attempts kept":** 5.02:1 light, 7.29:1 dark.
  - No sideways scroll.
