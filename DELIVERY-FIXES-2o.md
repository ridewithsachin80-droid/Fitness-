# FitLife — Fixes-2o: the Whisper fallback judges each spoken section on its own (20 Oct 2026)

Test branch only. Production (`main` 1ca6ae7) is unchanged and needs Sachin's explicit approval. Nutrient enrichment stays unapplied.
**Unchanged from 2n:** the language checks, the original recordings and their scores, re-runs, the Excel export, the consent wording, the five corrected rule-check cases, and the learning features.

## The defect (2n review)
`reviewWhisper` (`server/services/voiceLanguage.js`) averaged Whisper's log-probability over the whole clip, and refused for "no speech" only when every section looked silent. So a clear section hid an uncertain one:

| Section | log-prob | no-speech |
|---|---|---|
| "2 idli," | −0.1 | 0.01 |
| "weight 82.5 kg" | −1.8 | 0.95 |

The average was −0.95, above the −1.0 limit, and the route handed "2 idli, weight 82.5 kg" on as accepted.

## The fix
Only `reviewWhisper` changed. Every **meaningful** section (one with any letter or digit) is now judged on its own:
- **Any section unsure** (log-prob below −1.0) **or looking like words made from silence** (no-speech above 0.6) → the whole answer is refused as `unsure`.
- **Any section looping** (compression ratio above 2.4) → refused as `repetitive`.
- **Every section looking like words from silence** → refused as `no_speech` (as before).
- **Pause sections** (no letters or digits, e.g. "", " … ") are ignored, so they never block clear speech.

**Nothing is dropped quietly.** A refusal returns the existing response: empty transcript, the reason, and "Retry this recording, or type your log." No preview is made, nothing can be saved, the app keeps the recording for Retry, and no engine or vendor is named. An accepted answer is still passed on exactly as written.

The thresholds (0.6, −1.0, 2.4) are unchanged and still need checking on real recordings.

## Tests
**Mocked (Whisper and Gemini stubbed); real route:** `test-voice-phase2.js`, 9 new checks, now 76 (was 67):
- the reviewer's exact response → refused, empty transcript, `unsure`, retry/type message, no engine;
- clear speech in three sections, with quantities and a decimal → accepted exactly;
- clear speech with empty pause sections between → accepted exactly;
- all sections uncertain → refused;
- all sections words-from-silence → `no_speech`;
- one unsure section holding a decimal weight → refused;
- one words-from-silence section holding a quantity → refused;
- one looping section beside a clear one → `repetitive`;
- the same rule for a Kannada answer.

Retry and the kept recording on refusal stay covered by the 2n checks in `test-logging-phase2.mjs`.

**No existing test changed.**

**Mutation checks:** 6 rules broken on purpose (back to the clip average; one silent section ignored; one unsure section ignored; pauses counted; looping only if every section loops; no-speech on any section). Each turned a test red.

## Supplement proposal, revision 2.1 (B17 still open; nothing built)
`claude/FitLife-Supplement-Accounting-Proposal.md` adds:
- **Section 2a, how totals are counted:** each dose is a chain of events; only the latest event in the chain counts (a correction's amount, or 0 after an untick), so old and corrected amounts never both count.
- **Duplicate protection narrowed** to a repeated submission (same request id). A second tick asks "Did you take an extra dose?"; yes records a separate `additional_dose` that nothing later erases.
- **Every recorded dose visible,** including unticked, corrected, prescribed and injected doses, even though treatment stays out of dietary totals.
- **The reviewer's recommended product choices** written in as assumed answers, still awaiting Sachin's confirmation.

## Real-provider results
None new. B18 (everyday fallback) still needs a real Gemini failure on a designated test account. B19 still needs Sachin's tap on "Whisper · Kannada" on the live test app for the two existing recordings.
