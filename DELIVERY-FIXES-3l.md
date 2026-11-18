# FitLife — Fixes-3l: UX fix plan, Phase 2b (18 Nov 2026)

**Scope:** test branch only, based on **f94c168** (Fixes-3k.2). Phase 2b of `claude/FitLife-UX-Fix-Plan-2026-11-05.md`, which Sachin asked to build on 18 Nov ("build next and push to test"). It covers the rest of Phase 2, plus one item from the 3k QA review.

**Unchanged:**
- production (`main` 1ca6ae7);
- the voice calibration kit and the wording check;
- the supplement rule (3k) and its switch (3k.1/3k.2);
- scores, reminders and the AI.

| # | Finding | Fixed by |
|---|---|---|
| 6 | Onboarding asked for start and target weight even when the coach had set them, then ignored what was typed (the server keeps the first value) | `components/Onboarding.jsx` reads the member's record (`GET /members/me/onboarding`). A weight already set is shown read-only, with "Set by your coach" (or "Already set" if the member set it on an earlier setup), and is not sent again. The line above says which: both set, one set, or both optional. A screen reader reads each set weight as one item. If the record arrives after the member has started typing, the box they typed in is replaced and does not block "Next". If the record can't be read (offline), the boxes stay as before |
| 8b | Profile's current weight could be weeks old with no date (3j QA) | `GET /api/patients/me` also returns `current_weight_date`. Profile shows the day under "Current weight": "today", "yesterday", "4 Nov" (`utils/dayLabel.js`, NEW) |
| 13 | Leftover hard-coded amber on the coach's 14-day logging streak | `pages/Monitor.jsx`: the theme's warn colour |
| 14 | Jargon and mismatches | "ACV" written out as **apple cider vinegar** wherever a member reads it. This covers: "Still pending" ("1 apple cider vinegar dose"), the AI reply's pending line and its group heading, the checklist line, the checklist sheet ("Apple cider vinegar · 1/3", "Why?"), Plan's routine note, the day summary, the day log on Progress, the coach's ready-made message to a member, the reminder notifications ("🍎 Apple cider vinegar time!", "Take your apple cider vinegar now"), and the offline-merge notice ("Your offline apple cider vinegar was not saved…"). **Still "ACV" (3m):** the AI's own prompt context, which the AI may echo in a reply. **One age picker:** Settings uses onboarding's list (Child · Under 18, Adult · 18–59, Senior · 60+; it had "Child (5–17)"). **"Since 30 Oct"** instead of "over 30 days" when the data starts later than the window ("today" if the only weight is today's), for the weight change and the 30-day checklist average (`spanLabel`). Settings' footer says "FitLife" (was "FitLife · Enhanced UX") |
| 15 | "Log weight" (and "0.00 / 3.0 L", backlog B13) wrapped at 360 px; the weight box showed "e.g. 92.5", which looked like a weight | `components/member/member.css`: below 380 px a tile's value is 15 px with an 8 px gap (it had about 87 px for about 90 px of text). `components/sheets/WeightSheet.jsx`: an empty box, and "Yesterday 77.4 kg" below it when there was a weight yesterday ("The day before …" when looking back at an earlier day). With large text (senior mode) the value is 16 px below 380 px |
| 3k-A4 | On the Progress calendar a day with no log looked like a logged 0% day | `pages/Progress.jsx`: a day with no log has a dashed outline in the theme's `lo` colour; the legend shows it |

**Not in 3l (left for 3m, the review-card redesign):** the food labels "Food database" and "Preparation not specified", and the ellipses on "Next: …". The "ACV" item names ("ACV before Meal 1") also stay, as do the coach's own screens. The item names sit under a heading that now says "Apple cider vinegar", and they are shared with the coach's screens.

**Found while checking (backlog, not changed):** Profile and Progress can show different 30-day checklist figures for the same member (60% and 53% in the simulation). A day with a weight but no checklist counts as 0% on Progress and is left out on Profile. This predates 3l.

## Files
**NEW:**
- `client/src/utils/dayLabel.js`
- `server/scripts/test-ux-3l.mjs` (gate)
- `DELIVERY-FIXES-3l.md`
- `client/dist/assets/`: the new build's files

**Changed:**
- `server/routes/patients.js`
- `client/src/components/Onboarding.jsx`, `AIChatLog.jsx`, `DaySummary.jsx`, `member/member.css`
- `client/src/components/sheets/ProtocolSheet.jsx`, `WeightSheet.jsx`
- `client/src/components/today/ProtocolDots.jsx`
- `client/src/lib/day/pending.js`
- `client/src/pages/Monitor.jsx`, `Plan.jsx`, `Profile.jsx`, `Progress.jsx`, `Settings.jsx`
- `server/services/cronService.js`, `server/routes/reminders.js` (notification wording only), `server/services/dayMerge.js` (the offline-merge notice's label only)
- `client/src/utils/personalMessage.js`
- `client/dist/index.html`, `client/dist/sw.js`
- `server/scripts/test-local.sh` (the new suite in the gate)
- `server/scripts/test-day-lib.js`, `server/scripts/test-ux-3k.mjs`, `server/scripts/ui-tests.mjs`, `server/scripts/test-progress-weight.mjs` (assertions, below)

## Changes to existing tests
Items 1–5, 7 and 8 are wording changes that finding 14 asks for; none is made looser (7 and 8 now pin the exact day). Item 6 follows 3l's new calendar outline; it is exactly as strict as before (a no-log day must use `text-lo` and no other text colour), and test-ux-3l also pins the full class string.
1. **`test-day-lib.js`**, "counts what is left, pluralised": `'1 ACV dose'` → `'1 apple cider vinegar dose'`.
2. **`test-day-lib.js`**, "nothing logged → all counts": the same change.
3. **`test-ux-3k.mjs`**, "NEW member: 'Next' / 'Still pending today' names no ACV or supplements": the check now looks for `apple cider vinegar|ACV|supplement`, so it cannot pass just because the word changed.
4. **`test-ux-3k.mjs`**, "EXISTING member: still names them": looks for "apple cider vinegar" (was "ACV").
5. **`ui-tests.mjs`**, "mixed: the routine note names the groups still standard": "Apple cider vinegar and Supplements: FitLife standard." (was "ACV and Supplements"). Same exact-sentence match.
6. **`test-ux-3k.mjs`**, "Progress calendar: a day with no log uses `lo` text": it matched the exact class string, which 3l extends with the dashed outline. It now allows other classes after `text-lo`, but fails if any of them is another text colour (QA's suggested pattern). The colour it checks is unchanged.
7. **`test-progress-weight.mjs`**, "90-day delta expands while the latest weigh-in stays unchanged": its weights start 60 days back in a 90-day window, which is exactly finding 14's case. It now expects "since <that day>" (worked out from the date, e.g. "since 19 Sep") and fails on "over 90 days" (was: "over 90 days"). The weight and change checks are unchanged. Found by the first full gate run.
8. **`ui-tests.mjs`**, "90d widens the window…": the same case (the 86.0 kg point is 60 days back). Same change; the name now ends "since the day of that point" (was "over 90 days"). The "over 30 days" and "over 7 days" checks there are unchanged and still pass, because those windows start with data.

## Results
| Check | Result |
|---|---|
| `test-ux-3l.mjs` (new) | **38/38**. [1] the real route on real Postgres: the date is the day of the weight shown, not today's log without one. [2] day names and spans, including the two-day boundary and "today". [3] the real Onboarding in jsdom: both set, only start set, set earlier by the member, record unreadable, and the record arriving after a half-typed "7" (Next works again, the "7" is not sent). [4] the real weight sheet: hint, no hint, hint hidden once a weight is typed, "The day before". [5] wording (including Plan, the day summary, the notifications and the offline-merge notice) and the shared age list. [5b] tile sizes below 380 px, normal and large text. [6] colours. Mutation checks: putting back "since today" fails [2]; removing both onboarding fixes fails [3] |
| Affected suites | `test-day-lib` 331/331; `test-ux-3k` 67/67; `test-progress-weight` 43/43; `ui-tests` 865/865; `test-day-merge` 42/42; `test-offline-queue` 103/103 |
| Screens (SIMULATED, local production server, real build, synthetic data) | **56/56** at 360 and 390 px, light and dark. Today's four tiles each on one line (the first run failed at 360 px; fixed with the 380 px rule). Weight-sheet hint 6.17–8.23:1. Profile "yesterday" 4.53–6.32:1. Progress "since 30 Oct". Calendar: all 21 days with no log dashed, no logged day dashed. Settings age picker. Onboarding (coach set 88 → 80 kg) read-only, "Set by your coach" 5.02–7.29:1. Coach streak: the 60% day in the warn colour, no amber. No sideways scroll anywhere. Extra (QA advisories), 4/4: with large text at 360 px all four tiles are 16 px on one line in both themes; the dashed outline against the page is 5.3:1 light, 6.58:1 dark |
| Full local gate | **7,193 assertions, all pass** (6353d5a). The first full run (on an earlier version) failed `test-progress-weight`'s 90-day check; that led to changed assertions 7 and 8 |
| Independent QA agent | Round 1: S1 onboarding could stall (a half-typed weight blocked Next when the record arrived late), S2 "ACV" left in 5 member places, S3 tests too weak, plus advisories. All fixed. **Re-check: PASS on S1, S2, S3 and every advisory**, with its own race reproduction and 8 mutations (7 caught; the survivor, Progress's `firstInRange` checked by source only, is covered by the screens). Its follow-ups applied: check #6 tightened, the offline-merge label, this note's wording |
| Live after the push | **6353d5a live on fitness-test** (18 Nov, 08:19 UTC). Phone robot 51/51 clean, 36 of 36 live files identical (app `index-B_8oPiY_.js`). GitHub gate green. Android emulator robot (request c2ca84d): all checks passed at both sizes (Nexus 5, Pixel 6; Android 14, Chrome 113) |
