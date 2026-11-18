# FitLife — Fixes-2n: the 2m review (rule checks, everyday Whisper fallback, consent wording, supplement proposal) (19 Oct 2026)

Test branch only. Production (`main` 1ca6ae7) is unchanged and needs Sachin's explicit approval. Nutrient enrichment stays unapplied.
**Kept from 2m:** the language setting, script labels, the Excel export, the original recordings and their scores, and the re-run table.

## 1. Rule checks: the five false passes fixed
**The reviewer's cases (2m result → 2n):**

| Transcript | Check | 2m | 2n |
|---|---|---|---|
| tea with sugar no milk | no sugar | ✓ | ✗ |
| morning 2 idli one bowl rice | 1 bowl sambar | ✓ | ✗ |
| morning 1 idli 2 bowls sambar | 2 idli | ✓ | ✗ |
| today weight 72.5 pounds | 72.5 kg | ✓ | ✗ |
| breakfast one plate rice then two plates upma one cup coffee | 1 plate upma | ✓ | ✗ |

**How it works now** (`server/services/voicePilot.js`):
- **The transcript is split into phrases** at commas, full stops, "and", "then", "mattu" and "aamele".
- **Quantity phrases are read out:** "‹number› [unit or container] [of] ‹food›". The number can also close the phrase: "akki rotti eradu".
- **Numbers are read as members say them:** digits, English words, Kannada words and "point" (eppattu eradu point aidu = 72.5).
- **A check looks only at the phrases for its own food (and container).** For the weight check, at the unit.
- **"No" counts only right next to the item:** before it ("no / without / zero sugar") or after it ("sakkare haakilla / illa / nahi / not added").
- **Three outcomes:**
  - ✓ **pass**, when every relevant phrase agrees;
  - ✗ **fail**, when none does, or the item was never heard;
  - **? unverified**, when they conflict, e.g. "2 idli and 3 idli", "no sugar in tea but sugar in coffee", "72.5 kg, last week 74 kg", or a bare "72.5" with no unit.
- **Kannada script** is spelled out first and gets the same rules.
- **The checks change nothing stored.** Raw answers, original keyword scores and the 2m re-runs are untouched.
- **The real 19 Oct answers give the same results as in 2m:** Gemini passed all 6; Whisper passed 2 (breakfast, cup of coffee) and failed 4.
- **Wording:**
  - The panel now calls them "limited, rule-based checks, not a guarantee of meaning", and shows "?" for unverified.
  - The file columns are renamed `*_rule_checks`.
  - The summary counts unverified separately.

## 2. Everyday voice logging: the Whisper fallback (B18)
Whisper runs only after Gemini fails. Its text becomes the member's AI preview, which the member must still Apply.
- **The member's chosen voice language sets what Whisper is told:**
  - **Kannada → "kn".**
  - **Hindi → "hi".** Without it, Whisper often writes Hindi in Urdu script.
  - **English → not set.** Members who choose English mix in Hindi and Kannada, and forcing English makes Whisper translate those words.
- **Whisper now returns `verbose_json`:** its language and its own confidence numbers.
- **The answer is checked** (`services/voiceLanguage.reviewWhisper`). It is refused when:
  - any letters are in a script the choice doesn't cover, e.g. Tamil, or Urdu for Hindi;
  - Whisper reports a language outside the choice;
  - Whisper's own numbers say it was unsure, heard no speech, or looped.
  - The limits are Whisper's documented defaults: no-speech 0.6, mean log-prob −1.0, compression ratio 2.4.
- **A refused answer returns an empty transcript with a reason.** So:
  - no preview is made and nothing can be saved;
  - the app keeps the recording for Retry;
  - the member reads "That came back in a different language from the one you chose. Retry this recording, check your voice language, or type your log."
  - No engine or vendor is named.
- **An accepted answer is passed on exactly as written:** mixed scripts, quantities, units and decimals.
- **When Gemini answers, nothing changes.**
- **Not yet checked with the real provider.** The thresholds and the "kn"/"hi" settings need real recordings (see "Real-provider results").

## 3. Consent wording
- **"Only your coach hears the recordings" is now:** "Your assigned coach and authorised FitLife administrators can listen to the recordings and read what was heard."
- **This matches the existing routes:** the assigned coach, plus administrators. Access is unchanged.
- **The Gemini and Whisper-on-Groq disclosure stays.**

## 4. Supplement proposal, revision 2 (B17 still open; nothing built)
`claude/FitLife-Supplement-Accounting-Proposal.md` now says:
- **Unknown by default.** An estimate only when someone explicitly chooses a documented assumption.
- **Intake events are separate from schedules.** Each stores a product-version snapshot, and corrections keep the history.
- **Dated doses stay primary.** Weekly or N-day summaries come second, including schedules longer than 7 days.
- **No blanket 7-day upper-limit rule.** Prescribed treatment is kept out of dietary totals and limits, and the app never declares a dose safe.
- **History keeps its meaning:** a new product doesn't reinterpret old ticks.
- **Injections are separate from dietary targets.**
- **Coach approval for numeric product data;** members may submit evidence.

## 5. B19 (choosing a speech engine) stays pending
- **No real Whisper re-run with the language set exists yet** for the two recordings. The 2m screenshot of a 100% Kannada re-run was mocked.
- **The originals stay as they are:** Gemini 100% and 100%; Whisper 0% (Tamil script) and 50%.

## Tests
**Mocked (providers stubbed); real Postgres where the suite uses a database:**
- **`test-voice-pilot.js` [3c], new (10 checks):**
  - the five cases and their counterparts;
  - Kannada script;
  - conflicting text stays unverified;
  - a container must be the right one;
  - numbers don't run across phrases;
  - spoken numbers;
  - every line's own words pass;
  - the summary;
  - stored rows untouched.
- **`test-voice-phase2.js`, 13 new checks on the real route:**
  - Gemini fails, then Whisper, for Kannada, English and Hindi;
  - Tamil and Urdu refused;
  - language reported outside the choice refused;
  - unsure, no-speech and looping answers refused;
  - quantities and units exact;
  - no vendor named;
  - Gemini success unchanged.
- **`test-logging-phase2.mjs`, 2 new checks:** a refused answer reaches no consumer, the take is kept for Retry, and the message is shown.
- **`ui-tests.mjs`:** 2 new checks ("?" shown; the panel wording).
- **Changed tests, each with the reason in the file:**
  - `test-voice-pilot` header check: columns renamed `*_rule_checks`; still compared exactly.
  - `ui-tests` "rule checks per recording": the label "Meaning:" is now "Rule checks:".
  - `ui-tests` consent check: now expects the assigned-coach-and-administrators wording, and checks the old wording is gone.
- **Mutation checks:** 11 rules broken on purpose; each turned a test red.

## Real-provider results
None new. The only real results are still the two 19 Oct recordings (above). The Kannada re-run needs Sachin's tap on the live test app, and the everyday fallback needs a real Gemini failure, or a test account set to force it.
