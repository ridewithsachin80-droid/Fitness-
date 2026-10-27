# FitLife — Fixes-3e: a blank settlement is refused, and every count says what it counts (after the 3d kit review, 27 Oct 2026)

**Scope:**
- **Test branch only.** The kit works only on the test server. Based on **d58250c**.
- It answers the reviewer's *Fixes-3d review* (27 Oct): its two P2 corrections. Every earlier fix and test is kept.
- The plan is `claude/FitLife-Voice-Calibration-Plan-2026-10-23.md`, **revision 10**. It corrects revisions 7–9, which said a rule 3 preview check makes at most one parser call.

**Collection, invitations for collection and real-provider batches stay closed.** No real provider, volunteer, invitation or recording was used to verify this patch. Every result below uses the real parser and real routes with the HTTP layer stubbed; the stub counts each outbound request itself.

**Unchanged:** production (`main` 1ca6ae7); the live speech check (200 ms / 60 ms / 6 Hz); the detector settings; the provider order, fallbacks and retries, and the everyday voice and logging routes; historical evidence and verdicts; nutrient enrichment and supplement accounting; the 12-grant cap; `judge-3a.1`; the app (no client file changed). **B18 and B19 stay open.** Scenario G (backlog 3u) stays open. No settlement panel was added (not requested).

## The review, finding by finding

**Where each result is tested:** `test-voice-calibration-3e.js` (new, in the gate). It uses the **real parser** (`parseMemberMessage` → `callAI`, with its provider/model fallback and retries); only `axios.post` is replaced, and the replacement counts every request it receives. Restarts are real: a child node process makes the requests and exits, or is killed with SIGKILL, while the parent, a separate process, inspects the same PostgreSQL database and the real export.

| # | The review found | Fixed by | Counterexample → now (positive controls) |
|---|---|---|---|
| 1 | `Number(calls)` turned `null`, `false`, `""`, spaces and `[]` into a confirmed 0, which then could not be corrected | The count is checked **before** any conversion: only a JSON number, or a string of digits (spaces around it allowed), is read. Everything else is refused with 400 before the database is touched. The existing checks stay: whole number, 0 to the attempt's maximum, a reason of 5+ characters, over 10 minutes old, once only, row-locked | [1] **`null`, `false`, `""`, `"   "`, `[]`, `{}`**, plus missing, `-1`, `1.5`, `"1.5"`, `true` and above the maximum → **all 400; the attempt stays started, no spend row, the export still says UNRESOLVED**. Positive controls: an explicit `0` settles (no spend row, warning cleared); `2` and the string `"2"` settle as 2; two settlements at once → one 200, one 409, one spend row |
| 2 | Rule 3 reserved and recorded **1** per preview check, but the real parser made **2** requests after an empty HTTP-200 answer and **12** when every model stayed busy | **Checks and requests are counted apart.** `callAI` gained an optional `onRequest` hook, awaited just **before** each outbound request inside its own retry loop (calibration only; every everyday caller passes nothing and behaves exactly as before). Provider order, fallbacks, retry statuses and waits are unchanged. For each check: the **first** request's hook writes the attempt (`requests_started = 1`, retried once); each later request adds one to `requests_started` before it leaves; if either write fails, **that request is not made**. The bound is computed from the parser's own lists: providers × models × (retries + 1) = **12** with both keys. Recordings use the same hook (one per Gemini model tried, plus Whisper; bound 3). After a restart, the export says how many requests had **started**, the most there could be, and keeps the screen incomplete; settlement accepts 0 to that bound. Older rule 3 rows (no unit) counted checks: they are reported as **checks whose request number was never recorded (at least one each)**, not re-read as requests | [2] first answer valid → **1 check, 1 request made, 1 counted**, bound 12; **empty answer, then valid → 1 check, 2 made, 2 counted (was 1)**, parsed; **every model busy through every retry → 1 check, 12 made, 12 counted (was 1)**, a provider error; the attempt cannot be written → 503, **0 requests**, claim released; a fallback request whose start cannot be recorded → not sent (1 request each, 1 started). A recording: 2 made, 2 started, bound 3. [3] restarts: first-answer success → the fresh process sees **1 started, at most 12**, settled as 1; empty-then-valid → **2 started, at most 12**, settled as **2** (refused as "above the maximum" under 3d); a child **killed mid-retries** → its own stub trace says it sent 4, the database says 4 started, the export says "4 had been started, at most 12", 13 refused, 4 accepted. No provider was called to repair anything. [4] the ledger totals equal the independently counted requests: 25 parser (this process 17, the children 1 + 2 + 4, one older check) and 14 transcription |

### What every count means (Fixes-3e)

| Where it appears | What it counts |
|---|---|
| Spend ledger `calls`, rows from Fixes-3e on (`unit = 'requests'`) | **Outbound provider requests**, each counted just before it was sent, whatever came back (success, empty answer, busy error). A recording: 2 or 3 with both keys (Gemini's first model and Whisper, plus Gemini's second model after a failure). A preview check: 1 to 12 |
| Spend ledger `calls`, older rule 3 rows (`unit` empty) | **Parser checks**, one each. Their real request number was never recorded (at least one). Listed separately in the export, never added up as requests |
| `parser_calls` on a judgment; `parser_calls` / `reevaluation_calls` in the Check previews answer; the rule 3 budget line | **Parser checks**: one per leg sent to the parser (the plan's "at most 2 per newly admitted take") |
| `provider_requests` on a judgment, and in the Check previews answer | The outbound provider requests that check made (NEW column, additive) |
| An attempt's `max_calls` | The most requests that attempt could make with the configured providers: 3 per recording, 12 per preview check, computed from the code's own provider, model and retry settings |
| An attempt's `requests_started` (NEW column, additive) | Requests counted as started, each just before it was sent. If the process stopped, whether the last one was sent, answered or charged is not known (the killed child above sent exactly as many as were started; the count can be at most one higher) |
| A settlement's `calls` | Provider requests found in the provider's usage records, given explicitly as a whole number from 0 to `max_calls` |

These are request counts, not charges. Whether a failed request is billed is not inferred.

### One more change, for test stability (no behaviour change for one tap)
Adding the request hook moved the timing of the 2y "two taps at once" check: it failed 2 times in 5 runs. The cause was a real race, not the test: a tap evaluated legs one by one, so a second tap could arrive after a leg had already finished and report it neither busy nor its own. **Check previews now claims every leg it will evaluate first (within the 20-check limit), then evaluates them**; if it stops early (for example, an attempt cannot be written), the claims it never reached are released for the next tap. The 2y test is unchanged and then passed **6 of 6** runs in a row, and again in the gate.

## Files
**NEW:**
- `server/scripts/test-voice-calibration-3e.js` (gate; runs child processes of itself for the restarts)
- `DELIVERY-FIXES-3e.md`

**Changed:**
- `server/routes/aiChat.js`: the provider list and the retry count moved into `aiProviders()` and `AI_MAX_RETRIES` (same values, same order); `callAI` awaits `opts.onRequest` before each request when given; `parseMemberMessage` passes an optional `onAIRequest` through; `callAIMaxRequests()` exported. Without the hook (every everyday caller), nothing changes.
- `server/routes/voiceCalibration.js`: settlement count validation; `requestCounter`; `/take` and rule 3 count requests through the hooks; the bound from `callAIMaxRequests()` / `transcriptionMaxRequests()`; `unit 'requests'` on every new spend row; `provider_requests` and `parser_calls` kept apart on the judgment; started-request totals for the export; Check previews claims its legs first and releases unreached claims.
- `server/services/voiceCalibration.js`: the request hook in the Gemini and Whisper transcription calls; `transcriptionMaxRequests`; the export's wording for units, started requests and older rows.
- `server/db/schema.sql`: additive only: `voice_calibration_spend.unit`, `voice_calibration_attempts.requests_started`, `voice_calibration_preview_judgments.provider_requests` (`ADD COLUMN IF NOT EXISTS`). Loaded twice on an empty database.
- `server/scripts/test-local.sh`: the new suite added to the gate.
- `server/scripts/test-voice-calibration-3d.js`: **three existing assertions changed** (below).

## Changes to existing tests
Three assertions in `test-voice-calibration-3d.js` encoded the false bound of 1 request per preview check. Each now uses the real bound; none was removed or loosened.

| Assertion | Was | Now | Why |
|---|---|---|---|
| After the restart, the export is UNRESOLVED | `at most 1` | `at most 12,` | 12 is the parser's real worst case in this setup (2 providers × 2 models × 3 tries). The old pattern also matched "at most 12" by accident, because "at most 1" is a prefix of it; the trailing comma now makes the match exact |
| Three unresolved attempts after the restart | `at most 7` | `at most 18,` | 12 for the parser attempt + 3 for each of the two uploads (was 1 + 3 + 3) |
| A settlement above the maximum is refused | `calls: 2` | `calls: 13` | With the real maximum of 12, 2 is a valid count; 13 is the first number above it. The same check still requires 400 |

The 3c (21), 3b (14), 3a (29), 2z (46), 2y (99), 2x (126) and app-mode (24) suites are unchanged and pass.

## Results (mocked providers; real Postgres 16)
| Check | Result |
|---|---|
| `test-voice-calibration-3e.js` (new) | **19/19** |
| `test-voice-calibration-3d.js` (3 assertions changed, above) | **20/20** |
| `-3c`, `-3b`, `-3a`, `-2z`, `-2y` (6 runs in a row), `test-voice-calibration.js` (unchanged) | **21/21, 14/14, 29/29, 46/46, 99/99, 126/126** |
| Full local gate (schema.sql on an empty database; also loaded twice) | **all suites pass, 6,929 assertions** (3d: 6,910) on the second run. The first run failed one check in `test-modal-accessibility` (a 44 px height measured right after a dialog opens); no client file changed, and that suite alone failed 1 of 5 runs. Recorded as a B20 recurrence; the test is unchanged |
| Deliberate breakages (one at a time, each file restored byte for byte) | **17 of 17 caught** (list below) |
| End-to-end voice simulation A–M (run alone, 05:40–06:12 UTC) | **63/63** |
| Browser screens | not rerun: no client file changed, and no screen shows anything new |

The 17 breakages: the settlement count read with `Number()` again; true/false read as numbers; the parser bound back to 1; the bound ignoring retries; the hook called only before a provider's first request; the parser not given the hook; a check recorded as one request; later requests not added to "started"; a request sent even when its start could not be recorded; new rows written without their unit; the judgment storing requests as checks; the judgment storing checks as requests; older rows re-read as requests; the transcription bound back to 1; the Gemini transcription hook skipped; the export ignoring how many requests had started; claims a tap never reached not released.

**One weak first-pass check, corrected:** the first version of "the judgment storing requests as checks" also left one SQL parameter unused, so PostgreSQL refused the statement and the suite failed on that error rather than on the swap. It was rerun with valid SQL, together with the reverse swap; both were caught by the counting checks themselves.

**Unpopulated export example:** `FitLife-Voice-Calibration-EXAMPLE-unpopulated-3e.xlsx`, from the real export route on a brand-new database: 17 sheets; the ledger line shows 0 and 0 with no UNRESOLVED and no older checks, and says what its numbers count.

**What remains true, stated plainly:**
- If a server stops during a request, nobody can know whether that request was answered or charged. The kit records how many had started and the most there could be, and leaves the rest to an administrator reading the provider's own usage records.
- A request counted as started is counted **before** it is sent, so after a kill the started count can be one more than the requests actually sent, never fewer.
- Settlement is still an admin route, not a panel button.

`qa/voice-evidence/REQUEST.md` is unchanged, so this push starts no real voice run.

## Before collection
1. The reviewer checks Fixes-3e and plan revision 10.
2. Fluent speakers finish the wording; after any change, each language is confirmed in the app against its final hash.
3. Then the 144-slot session and the Part C sessions begin.
