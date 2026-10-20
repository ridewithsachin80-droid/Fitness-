# FitLife — Fixes-2p: intermittent UI failures fixed at the cause; a test-only switch for the real voice fallback test (20 Oct 2026)

Test branch only. Production (`main` 1ca6ae7) is unchanged and needs Sachin's explicit approval. Nutrient enrichment stays unapplied.
**Unchanged:** the voice rules corrected in 2n/2o, the five rule-check fixes, consent, the original recordings and scores, re-runs, the Excel export and the learning features.

## 1. The intermittent UI failures (2o gate), investigated
The 2o gate's first UI run had 5 failures that passed on rerun. Each was reproduced or traced, and fixed at the cause rather than retried.

### a. "Timed out: entries disclosure" — a real app glitch
- **Reproduced:** 2 failures in 6 runs under CPU load.
- **Evidence:** at the moment of failure, the "Logged today" button the test had tapped was no longer on the page. Today had thrown that section away and rebuilt it, closed.
- **Cause** (`client/src/hooks/useTodayModel.js`):
  - Coming back to Today (e.g. from More), the first frame showed the day as it was when the member last left.
  - Today then swapped that for the loading placeholder while it fetched the day, and back again.
  - **A tap in that moment was lost**, and a section the member opened snapped shut. On a slow phone that moment is long enough to hit.
- **Fix:** Today shows the loading placeholder from its very first frame, until its own load has begun. Leftover content is never shown, so it can't be tapped.
  - Saving, the offline queue and the date logic are unchanged.
  - Only the `loading` value Today's screen reads changed.
- **Regression check** (`test-premium-ui.mjs`, new): it slows the day's load and records, with a mutation observer, every "Logged today" section ever put on the page. There must be exactly one, and it must stay.
  - Old code: red 3 of 3. Fixed: green 3 of 3.
  - The original test then passed 10 of 10 under the same load (2 of 6 failed before).

### b. "slow start (dark)" × 4 — a test design flaw
- **Evidence:** the gate log shows `booted: true, shown: false`. The app had already started before the test ever saw the 10-second recovery screen.
- **Cause** (`ui-tests.mjs`): the test held the app file back on a fixed 11.5-second timer. That left only 1.5 seconds to see a screen due at 10 seconds; under load the poll missed it.
  - It did not reproduce in isolation (4 of 4 clean under load). The recorded state fits only this explanation.
- **Fix:** the file is now held **until the test has seen the screen** (30 seconds at most), then released. There is no window to miss.
- **Stronger, not weaker:** a new check makes sure the screen does **not** come up before about 10 seconds. Mutation check: a watchdog at 2 seconds → both themes red.
- **Changed test:** "slow start" in `ui-tests.mjs`. Its timing changed from a fixed 11.5 s release to release-after-seen; every existing assertion is kept, and one is added. Reason above.

**Still tracked** (backlog B20): if either failure appears again on GitHub or locally, the evidence goes to the backlog. A rerun alone is not treated as a fix.

## 2. Voice fallback test switch (B18), test server only
**Why:** Whisper writes down a member's voice note only when Gemini fails. A real Gemini failure can't be produced on demand without changing the shared provider settings, which would affect every member.

**What it does:** an administrator names **one** test account on the admin dashboard ("Voice backup test"). For 24 hours that account's voice notes skip Gemini and go to the real Whisper backup.
- Everything after that is the normal path: the language setting, the per-section checks, Retry, the member's preview and Apply.
- Only the transcription step changes. Parsing into a preview is unchanged.
- **Each try is recorded:** what Whisper returned (text, language, per-section numbers) and what FitLife decided. No audio is kept.
- The tries show on the card and download as Excel.

**Four locks:**
1. **Test server only.** Railway reports the deployed branch in `RAILWAY_GIT_BRANCH`; only `test` counts.
   - **Back-up:** if no branch is reported, the test service may set `FITLIFE_TEST_SERVER=yes`.
   - The back-up is ignored whenever a branch is reported, so on production (branch `main`) the switch can never turn on, even if a copy of that setting is there.
   - Production makes **no extra database read**: the check stops at the branch.
2. **Administrators only** can see, set, clear or download (members and coaches get 403).
3. **One account at a time.** Naming another replaces it.
4. **Off after 24 hours** by itself, or at once with "Turn off".

**On the live server the card says, in one line, that it is off there.** Nothing changes for any member.

**New tables** (additive, in `schema.sql`): `voice_fallback_test_account` (one row at most) and `voice_fallback_test_runs`.

## 3. Supplement proposal, revision 2.2 (B17 still open; nothing built)
- **A separate "Add extra dose" action** replaces 2.1's question on a second tick.
- **The regular tick stays on/off** for the scheduled dose: tapping a ticked item unticks it and never adds a dose.
- **All five recommended product choices** are written in, awaiting Sachin's confirmation.

## 4. Real-provider tests: step-by-step for Sachin
`claude/FitLife-Real-Provider-Test-Steps.md` (project doc) covers:
- **B19:** the pilot re-run.
- **B18:** the everyday fallback with the switch, with 7 lines to say.
- A results sheet to fill in.

## Tests
**Mocked (providers stubbed); real Postgres where the suite uses a database:**
- **`test-voice-fallback-test.js`** (new, real Postgres, real routes), 31 checks:
  - off for branch unset / `main` / `Test` / empty, even with an account row;
  - the back-up setting ignored when a branch is reported, and only exactly `yes` counts;
  - members and coaches refused, no sign-in refused;
  - unknown and switched-off accounts refused;
  - 24 hours;
  - the named account skips Gemini, Whisper is told the right language, accepted text is exact;
  - the 2n mixed-confidence answer is refused and recorded as refused;
  - a Whisper error is recorded;
  - everyone else is untouched;
  - replacing, expiry, Turn off, the Excel file, Clear.
- **`ui-tests.mjs`:** 7 new panel checks, plus 320/360/390 px no sideways scroll; slow start: 2 new checks.
- **`test-premium-ui.mjs`:** 1 new check (no leftover content on returning to Today).
- **Mutation checks:**
  - switch: 10 rules broken on purpose, each red;
  - Today fix reverted: red;
  - early watchdog: red.
- **Screenshots** (MOCKED DATA banner): the panel on, choosing an account, and the live-server line, at 320 and 390 px, dark and light.

**Changed tests** (no test was deleted or weakened):
- **"slow start"** (section 1b).
- **The fixture stub in four suites:** `test-mixed-request-answer`, `test-sleep-clarification`, `test-draft-food-edits` and `test-food-clarifications`.
  - They load `routes/aiChat.js` in a sandbox that only allows listed dependencies.
  - Each gained one stub for the new `services/voiceFallbackTest`, returning "switch off", as production sees it.
  - Their assertions are unchanged.

## Real-provider results
None yet. Both tests need Sachin on the test server (steps doc above).
