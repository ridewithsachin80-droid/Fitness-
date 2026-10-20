# FitLife — Fixes-2q: the voice backup test's record keeps unknown confidence values unknown (20 Oct 2026)

Test branch only. Production (`main` 1ca6ae7) is unchanged and needs Sachin's explicit approval. Nutrient enrichment stays unapplied.
**Unchanged:** the voice accept/refuse rules (2n/2o), the test switch and its locks (2p), the Today and test-timing fixes (2p), and every recorded try.

## The defect (2p review)
`server/services/voiceFallbackTest.js` used `Number(v)` to read Whisper's per-section numbers for the record. That turned values Whisper did not give properly into numbers:

| Whisper's field | Recorded before | Recorded now |
|---|---|---|
| `null` | 0 | **unknown (empty)** |
| `""` or spaces | 0 | **unknown** |
| `false` | 0 | **unknown** |
| `true` (also found) | 1 | **unknown** |
| `[5]`, `{}`, `"0x1A"` (also found) | 5, null, 26 | **unknown** |
| `NaN`, `Infinity`, `"abc"` | unknown | unknown |
| genuine `0` | 0 | **0** |
| `-0.3` | -0.3 | -0.3 |
| `"-0.3"`, `"1e-3"` (decimal text) | -0.3, 0.001 | -0.3, 0.001 |
| missing | unknown | unknown |

## The fix
Only a real finite number, or text that is plainly a decimal number, is recorded. Anything else is recorded as unknown (null), which shows as an empty cell in the Excel file.

- **Recording only.** What FitLife accepts or refuses is decided separately, in `services/voiceLanguage.reviewWhisper`. That is unchanged, as the review asked.
  - I checked it: there, a null, blank or false value already behaves exactly like a missing one (it counts neither as unsure nor as silent).
- **Earlier tries are not touched.** There is no migration.
- **No schema change.**

## Tests
**Mocked (Whisper and Gemini stubbed); real Postgres, real routes:** `test-voice-fallback-test.js` [6], 7 new checks, now 38 (was 31):
- null, blank, spaces, false, true, words, NaN, Infinity, a list, hex and an object → unknown;
- a genuine 0, -0.3 and decimal text are kept;
- per section: null/blank/false → null, genuine zeros → 0, missing → null;
- through the route, the voice decision is unchanged (same accepted text);
- stored: unknown values are null, the genuine 0 is 0;
- an earlier try (with zeros) is left exactly as it was;
- the Excel file shows unknown as an empty cell and 0 as "0".

**Mutation checks:** 5 versions broken on purpose, each red:
- back to `Number(v)`;
- a genuine 0 dropped;
- booleans counted as numbers;
- blank text counted as 0;
- decimal text ignored.

**No existing test changed.**

## Real-provider test steps (project doc `claude/FitLife-Real-Provider-Test-Steps.md`)
- **Corrected:** the two original 19 Oct recordings were real. The corrected Kannada re-run and the everyday fallback still need real-provider results.
- **Added:** refresh or reopen Admin after recording on the phone, because the tries card does not update by itself.
- **Added:** an empty number cell means "not given", not zero.
- **Added:** keep the tries until the evidence is reviewed.

## Real-provider results
None yet. B18 and B19 stay pending until Sachin runs tests 1 and 2.
