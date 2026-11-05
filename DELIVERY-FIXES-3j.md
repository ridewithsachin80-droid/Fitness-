# FitLife — Fixes-3j: UX fix plan, Phase 1 (5 Nov 2026)

**Scope:** test branch only, based on **769c24e**. Phase 1 of `claude/FitLife-UX-Fix-Plan-2026-11-05.md`, which Sachin asked for on 5 Nov ("Need to build all fixes, but plan phase-wise … and start"). It covers six findings from the 5 Nov UX review and the Android emulator robot: wrong information and blocks on logging. None needed a product decision.

**Unchanged:**
- production (`main` 1ca6ae7);
- the voice calibration kit and its hashes;
- the wording check (still 0/3);
- collection;
- the speech check, provider order, nutrients and supplements.

**Still open:** B18/B19, Scenario G (3u), B20 and 3z-b.

| # | Finding | Fixed by | Proof |
|---|---|---|---|
| 1 | Profile said **"Lose 9 kg · goal reached"** while the member was 7.6 kg away, because today's log had no weight yet; the weight tiles, BMI and TDEE were blank | `server/routes/patients.js` (GET /me): `current_weight` is the latest log **with** a weight. `client/src/utils/goalHeadline.js` (NEW, used by `pages/Profile.jsx`): "goal reached" only with a known weight at or past the target; an unknown weight says just "Lose 9 kg" | `test-ux-3j` [1] real Postgres + route: today without a weight → 77.6, not null; [2] the sentence in every case. Screens: "Lose 9 kg · 7.6 kg to go", 77.6 / 1.4 / 7.6 |
| 16 | On Android Chrome the **"Add to Home Screen" card floated over "Type to log"** (`fixed bottom-24 z-50`); its × was 11×20 px | `components/InstallPrompt.jsx`: an ordinary card at the end of Today (`pages/Today.jsx`), × 44×44 px, Install 44 px tall, and **not on a phone's first day** (first visit noted on the phone only) | [5] in jsdom: no `fixed/bottom-24/z-50`; × ≥ 44×44; dismiss remembered; first visit and 3 h in: no card. Screens: card in the page, "Type to log" not covered |
| 2 | Offline, the AI box said only "Your message could not be processed" | `utils/aiRequestRecovery.js`: offline → "You're offline. Your message is kept here — tap Retry when you're back online. Water and weight can still be logged from the Today tiles."; no answer while online → "No answer from FitLife — check your internet…". The other messages are unchanged | [4]; screens offline |
| 7 | A 4.9 kg overnight weight saved with no question | `utils/weightCheck.js` (NEW): more than 2 kg from the day before → "That's 4.9 kg more than the day before (77.6). Please check it's right — you can still save it." Shown in the weight sheet (`hooks/useTodayModel.js`) and under the AI preview's weight (`components/chat/WeightJumpNote.jsx`, NEW). Never blocks | [3] incl. negative controls (0.9 kg, exactly 2 kg, no earlier weight); screens: sheet and preview |
| 9 | A brand-new member saw "A fresh look — same coach, same data" | `components/member/WhatsNew.jsx` `markWhatsNewSeen()`, called by `components/Onboarding.jsx` when setup finishes. Earlier members still see it once | [6] |
| 10 | Settings: the notifications switch showed **ON** above "Notifications are blocked… address bar" | `pages/Settings.jsx`: blocked by the phone → the app switch shows off and is disabled, "Blocked on this phone — how to allow it is below"; the member's saved choice is kept. The help text names the phone's Settings when FitLife is installed, and the address bar only in a browser | [7]; screens with notifications blocked |

## Independent QA review (before any push)
Under the AI Engineering Team framework, a separate QA agent reviewed the staged change. **No blockers. Three should-fix findings in my first draft**, all fixed before anything was committed:

| # | QA finding | Severity | Done |
|---|---|---|---|
| 1 | A real timeout (axios sets `error.request`) now said "No answer from FitLife" instead of "That took too long"; my test used a fake timeout without `request`, so it passed vacuously | should-fix | Timeout checked first; test uses a real-shaped timeout (ECONNABORTED and ETIMEDOUT, both with `request`) |
| 2 | Moving the install card into Today's loaded content meant Chrome's once-per-load install offer was lost if it arrived while Today was still loading | should-fix | `client/src/utils/installOffer.js` (NEW) catches the offer from the app's first moment (`main.jsx`); the card reads it when it mounts. Test: offer sent before mounting → card shows |
| 3 | Answering "Block" in FitLife's own notification prompt left the App-notifications switch ON (the parent didn't re-render); my test only matched source text | should-fix | Settings re-reads the permission when the prompt is answered and when the member returns to the app. Test renders the **real Settings page**: Turn on → Block → switch off, disabled, "Blocked on this device" |
| 4 | Weight-sheet note set only on a keystroke: stale across days, missing for a saved weight | advisory | Fixed: worked out from the shown day's weight and the day before at every render; warnings clear when the day changes; out-of-range still wins |
| 5 | AI-preview note stayed when the weight chip was switched off | advisory | Fixed: shown only while the weight is included |
| 6 | Wording "this phone" wrong on desktop; installed-app path Android-only; no `aria-describedby` | advisory | Fixed: "this device"; Android and iPhone paths; switch described by its note |
| 3b | (re-check) The reverse path: allowing notifications in the phone's settings and coming back left the "blocked" card under an ON switch | should-fix | The card re-reads the permission with the switch (when the app becomes visible again). Test: blocked → allowed in phone settings → back → switch on, no blocked card |
| T | (re-check) The suite's API stand-in missed `api/logs.js`'s `./client` import, so rendering Settings tried to reach the test site's address (no network here, so nothing was sent) | should-fix | Every import of the API client is replaced; any real HTTP client in the test bundle throws; pages use `http://localhost`. A check proves the page used the stand-in |
| 2b | (re-check) The install offer is now always caught, so Chrome's own small install banner no longer appears on a phone's first day or within 14 days of a dismissal | advisory | Intended (one quiet offer, not two); noted here |
| 7 | A member onboarded on another phone still sees "A fresh look" on a new phone | advisory | Not changed (they may have used the old look) |
| 8 | Profile's current weight can be weeks old with no date | advisory | Not changed in 3j; added to Phase 2 (show the date of that weight) |

## Files
**NEW:**
- `client/src/utils/goalHeadline.js`
- `client/src/utils/weightCheck.js`
- `client/src/components/chat/WeightJumpNote.jsx`
- `client/src/utils/installOffer.js`
- `server/scripts/test-ux-3j.mjs` (gate)
- `DELIVERY-FIXES-3j.md`
- `client/dist/assets/`: the new build's files

**Changed:**
- `server/routes/patients.js`
- `client/src/pages/Profile.jsx`, `Today.jsx`, `Settings.jsx`
- `client/src/components/InstallPrompt.jsx`, `AIChatLog.jsx`, `Onboarding.jsx`, `member/WhatsNew.jsx`
- `client/src/hooks/useTodayModel.js`, `client/src/components/sheets/WeightSheet.jsx`, `client/src/main.jsx`
- `client/src/utils/aiRequestRecovery.js`
- `client/dist/index.html`, `client/dist/sw.js`
- `server/scripts/test-local.sh` (the new suite in the gate)

## Changes to existing tests
**None.** No existing assertion changed.

## Results
| Check | Result |
|---|---|
| `test-ux-3j.mjs` (new) | **39/39** (27 in the first draft, 12 added from the two QA rounds). Breakages caught: old server query → 1 fails; card floating again → 1; no first-day rule → 2; unknown weight "goal reached" → 1; offline message removed → 2; no-answer before timeout → 2; Settings not told of the answer → 1; offer only after mount → 1; card not re-reading the permission → 1 |
| Screens (SIMULATED, local production server, real build, synthetic member) | **28/28** at 360 and 390 px, light and dark. New text contrast 5.83–10.34:1; no sideways scroll |
| Full local gate | **all suites pass, 7,050 assertions** (7,010 before; the new suite adds 39) |
| Independent QA agent | three rounds: first review (3 should-fix, all fixed), re-check (2 more should-fix, fixed), final re-check **PASS** (incl. a network log of the whole suite: only localhost Postgres and its own server) |
| Live after the push | (follow-up) |
