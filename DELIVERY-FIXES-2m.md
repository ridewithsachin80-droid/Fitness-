# FitLife — Fixes-2m: the 19 Oct voice recordings, honest scoring, the learning features, and the supplement proposal (19 Oct 2026)

Test branch only. Production (`main` 1ca6ae7) is unchanged and needs Sachin's explicit approval.
The 2l nutrition fixes are untouched: the same suites still pass (day-lib 331, nutrient-provenance 93, adaptive 59). Nutrient enrichment stays unapplied, pending identity and source review and approval.

## 1. The two real recordings: what happened, step by step

| Step | What it held | Finding |
|---|---|---|
| **Groq Whisper call** | Sent with no `language`, `response_format: json` | Whisper guessed the language. For the idli line it guessed **Tamil**. |
| **Provider reply** | JSON (UTF-8) | `விளைகே இரடு இட்ளி, ஒந்து போல் சாம்பா திந்தே.` is Tamil script, sounding out the Kannada sentence. No error. |
| **Stored text** | `voice_samples.whisper_text` | Correct UTF-8 Tamil. The spreadsheet cell decodes back to exactly this text, so nothing was damaged up to the file. |
| **Keyword score** | 0% | Right for what it measures: the key words are in English letters, and Tamil script can never match them. |
| **Admin screen** | Shows the text as stored | The Tamil displays correctly, but nothing said "this is Tamil, the wrong language". |
| **CSV from FitLife** | Starts with the UTF-8 mark (EF BB BF) | Verified on the server and in real Chromium through the app's own download code: the saved file is byte-identical to what the server sent. |
| **Spreadsheet conversion** | Your `.csv.xlsx` | The cell is exactly the Tamil text's UTF-8 bytes read as **Windows-1252**, one wrong decoding step after the file left FitLife. |

**More on the conversion step:**
- **The header cell reads `member`, not `ï»¿member`.** So the program that made the .xlsx either never saw the UTF-8 mark or ignored it.
- **LibreOffice reproduces it:**
  - opening the CSV as Windows-1252 garbles the Tamil the same way;
  - with the mark it shows `ï»¿member`, without it `member`;
  - opening it as UTF-8 is correct.
- **What I can't see:** which program did the conversion, or whether the mark was lost on the way (phone share, another app). The file properties show only "Sachin" and an app version of 12.0000.

**Upma line:** Whisper returned `breakfast 1 cup coffee`. It left out "ondu plate upma"; nothing was lost after the reply.

## 2. What changed

### Whisper is told the language, and says which it used
- **The pilot asks Whisper for Kannada (`kn`)** and requests `verbose_json`.
- **Both are stored on each new recording:** the language asked for (`whisper_setting`) and the language Whisper reports using (`whisper_language`).
- **`VOICE_PILOT_WHISPER_LANGUAGE`** can change the setting; `auto` goes back to guessing.
- **The two 19 Oct recordings keep their original text and scores.** They show "Language asked: not set (Whisper guesses)".

### Scripts are named, and Kannada script can be scored
- **Each answer is labelled by script.** A Tamil, Telugu, Hindi or Malayalam answer reads "… script: wrong language". It is never converted or re-scored.
- **Kannada script is spelled out in English letters before key words are matched** (ಇಡ್ಲಿ → idli, ಎರಡು → eradu). With `kn` set, Whisper is expected to answer in Kannada script, so this is needed for a fair score.
- **English-letter answers score exactly as before.** 3,564 line × answer pairs were compared against the old scorer, and none moved. Every stored score stays valid.

### Re-runs beside the original (evaluation tool)
- **New buttons on the panel: "Whisper · Kannada" and "Whisper · English".** They ask Whisper again about the stored recordings, with the language fixed.
- **The answer is kept in a new table, `voice_sample_reruns`**, beside the original, which is never changed.
- **Each re-run has its own keyword score, meaning checks and reported language.**
- **Re-runs are removed with the recording:** when the member withdraws, records the line again, or the 90 days pass.

### Excel download
- **"Download results (Excel)" is now the main button.** It produces a real .xlsx file, so no program has to guess an encoding.
  - It is written by NEW `server/services/xlsxLite.js`, with no dependency.
  - Every cell is text, so nothing can run as a formula.
  - Sheet 2 lists the re-runs.
- **The CSV stays as "or as CSV",** with the UTF-8 mark as before.
- **Verified:** LibreOffice and openpyxl both read the Tamil exactly.

### The percentage is a "keyword score"
- **The panel header, table, per-recording lines and file columns** all say keyword score (`gemini_keyword_score`, `whisper_keyword_score`).
- **The panel says what it can't tell:** "sugar" scores the same as "no sugar".

### Meaning checks, separate from the keyword score
Each recording is checked for:
- **sugar vs no sugar:** the sugar word AND a "no" word must be heard;
- **quantities:** the right number next to the item, so "mooru idli" fails "2 idli";
- **decimal weight:** 72.5 passes; 725 and 72 fail;
- **meal or time of day;**
- **day:** today vs last night, and not the other one.

They show per recording, in a per-engine summary, and in both files. **No engine is chosen from them:**
- the app's speech engine is unchanged;
- the panel says 2 recordings are far too few to choose one.

### Wording
- **Member card:** "Read out short lines so FitLife learns how you speak" became "…to test how well two speech services understand Kannada".
- **Consent:** a new line says "FitLife does not learn or store a model of your voice from it."
- **Coach metabolism card:** "New members inherit that correction" now says the correction changes a new member's starting estimate on that screen, and changes no targets unless the coach applies them. That is what the code does.

## 3. The learning features (verified; nothing rebuilt)

| Feature | Where it appears | What it remembers | Kind | Functional result (real Postgres) |
|---|---|---|---|---|
| Kannada voice test | Member: Today card. Coach/admin: "Kannada voice test" panel | `voice_samples` (both transcripts, keyword scores; since 2m the language too) and `voice_sample_reruns` | **Evaluation only.** Nothing reads it for logging. | `test-voice-pilot` 105/105, including the 19 Oct Tamil answer kept with its 0% and a Kannada re-run beside it |
| Personal portion memory | Member: AI review "your portion"; Profile "Your portion sizes" | `member_portions` (member + phrase, e.g. "katori dal" → 210 g, running average) | **Automatic** | NEW `test-learning-features`: member A's parse prompt carries "katori dal = 210g"; member B's does not. `test-portion-memory`: "200 then 220 → 210 (mean, not last)" |
| Reusing saved food estimates | Every member's parse (no screen of its own) | `foods` rows the AI created (source `ai`, unverified), shared by all members; a member's own labels (`member_foods`) for that member only | **Automatic** | NEW: the first parse saves "Kosambari" at 80 kcal per 100 g; the next parse, given a new AI guess of 140, uses the saved 80, and the iron still says "AI estimate". The AI is still asked every time. |
| Correction evaluations | Admin: "AI evals" tab | `ai_parse_samples`: corrections and uncorrected "control" parses | **Evaluation only.** No accuracy figure is computed; scoring is a manual script (`replay-evals.js`). | `test-evals`: "the same correction twice is one lesson, not two"; "the QUESTION is the original message, not the correction" |
| History-based insights | Member Profile "Your Metabolism"; coach member page; weekly report; gaps; triage | Calculated when asked (not stored), except weekly reports and coach briefs | **Insight only.** Targets change only when a coach presses Apply. | `test-learning-model`: "recovers planted coefficients exactly", "NO effect planted → reports unproven" |

**Two existing test gaps closed** (NEW `test-learning-features.js`):
- portions reaching the AI for the right member;
- the save-then-reuse round trip.

The old `test-food-learning` tests a copy of the code, not the code itself.

## 4. Supplements (B17 stays open)
A proposal, not built: `FitLife-Supplement-Accounting-Proposal.md` in the project. It covers:
- recording the actual product, dose and schedule;
- weekly doses judged over 7 days;
- assumed doses shown as estimates;
- unknown amounts left unknown;
- four decisions for Sachin.

## 5. Not changed, flagged
**The app's real voice logging (B18, new):** the fallback Whisper call, used when Gemini fails, also sends no language, so it could write Tamil script into a member's log. I did not change that path: it is not where the 19 Oct problem showed up, and it can't be tested here with the real provider. It is in the backlog, with the guard I'd suggest.

## Results (local gate, real Postgres 16 from `schema.sql`)
- **All suites pass: 6,128 assertions** (2l: 6,078), lint clean, client built.
- **The 2l nutrition suites have the same counts as in 2l:** day-lib 331, nutrient-provenance 93, adaptive 59, target-origin 29.
- **Screens at 360 px, dark and light, with mocked data:** the admin voice test opened on the Tamil recording with a Kannada re-run, the member card, and the consent sheet. No sideways scroll, no page errors.

## Tests (mocked; the speech providers are stubbed)
- **`test-voice-pilot.js`:** 73 → 105 checks. New section [3b] and one check in [4]. **Changed, with the reason in the file:**
  - the header check now expects the renamed `*_keyword_score` columns and six new ones, still compared exactly;
  - the "no answer" check looks for the reason followed by the new columns, instead of at the end of the line.
- **`ui-tests.mjs`:** 10 new checks.
- **NEW `test-learning-features.js`:** 6 checks, on real Postgres with the real parse. Added to the gate.
- **Mutation checks:** 13 rules broken on purpose; each turned a test red.

## Real-provider results
**Only the 19 Oct recordings so far** (keyword scores as stored: Gemini 100% and 100%; Whisper 0% and 50%). The Kannada and English re-runs on those two recordings need a tap on the live test app. See the delivery message.
