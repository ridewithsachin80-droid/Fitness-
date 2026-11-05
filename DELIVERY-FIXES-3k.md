# FitLife — Fixes-3k: UX fix plan, Phase 2a (5 Nov 2026)

**Scope:** test branch only, based on **103c98a** (Fixes-3j). This is the first half of Phase 2 in `claude/FitLife-UX-Fix-Plan-2026-11-05.md`. Phase 2 was split because finding 3 changes a rule that the app, the server's score, the reminders, the AI and the coach's screens all share. The rest of Phase 2 (onboarding prefill, copy pass, gold, wraps, Profile weight date) follows as 3l.

**Unchanged:**
- production (`main` 1ca6ae7);
- the voice calibration kit and the wording check (0/3);
- collection;
- the speech check and provider order;
- the water and sleep "FitLife standard" (decision B3);
- the standard daily **activities**;
- **every existing member**: their lists, the coach's editor, their reminders, the AI's view of them and how their score is worked out.

Saved logs and their scores are never rewritten: earlier days keep the score they had.

## The blocker, and Sachin's decision
My first draft changed the rule for everyone: "no coach selection" would mean no supplements or ACV. The independent QA agent stopped it. The old app saved "the coach ticked them all" the same way as "never chosen" (both as empty), so **existing members whose coach had chosen every supplement would have lost them**. Nothing in the data tells the two apart.

I asked Sachin. His answer (5 Nov): **"Keep existing, change new"**.
- Existing members keep exactly what they see today, and the coach can still edit each one.
- Members created from now on start with no supplements or ACV until the coach adds them.
- Nobody loses anything.

**How:** one new column, `patient_profiles.protocol_default_none`.
- **Empty (NULL)** on every row that exists today, and on any row created without saying so: the old meaning (no selection = every built-in item).
- **TRUE** only where a member is created: the admin screen (`POST /api/admin/members`) and `POST /api/patients`. For these members, no selection for supplements and ACV means none; items the coach creates for them still count.
- No column default on purpose. A profile row made later for an old member must keep the old meaning.

| # | Finding | Fixed by |
|---|---|---|
| 3 | With no coach selection, the app listed **7 "FitLife standard" supplements and 3 ACV doses** nobody prescribed, put them in "Next" and "Still pending today", and counted them in the daily score | **For new members only**, the same rule everywhere: the app's list and its score total (`lib/day/protocol.js`, `utils/logSync.js`), Plan, the protocol sheet, the coach's day view and member card, the coach's protocol editor, the server's score (`services/compliance.js`, `routes/logs.js`, `services/memberLogApply.js`), the AI parser's tick list (`services/memberParse.js`), the coach AI's summary and commands (`routes/aiChat.js`), the coach's gap nudges (`services/gapDetector.js`, `services/triage.js`), the AI's routine text (`services/targetOrigin.js`) and the ACV push reminders (`services/cronService.js`). Plan says "Supplements · Your coach will add these if you need any" |
| 3 (coach) | The coach's day view listed every built-in ACV and supplement ("0/7") for every member | `components/coach/DayDetail.jsx`, **new members**: the items in force, plus any item ticked that day (history never loses a tick); empty groups hidden; "Apple cider vinegar" written out. Existing members: exactly as before. The coach's member card says "no supplements or ACV until you add them (Anita sees none)" for a new member |
| 8 | A day with food and water but few ticks showed **0% in red** | Member screens never show a low day in red, and they say "checklist" instead of "compliance" (`pages/Progress.jsx`, `pages/Profile.jsx`). A new member's walk, with nothing else assigned, is 1 of 6 = **17%**. Coach screens keep their percentages |
| 12 | Calendar day numbers were 4.19:1 in dark | `text-lo` instead of `text-ghost` (Progress). The low-day bar uses the same `lo` colour |

### What else comes with the rule (new members only)
- **ACV reminder.** A new member with no ACV in force (none chosen, or the coach switched every dose off) gets no "🍎 ACV Time!" push. Other reminders are unchanged.
- **Score.** For a new member, the app sends the number of items Today lists (6 when nothing else is assigned). A save without that number (an older app) uses the member's own total. Ticks of items they don't have (for example from an old copy of the app) are not counted.
- **Existing members' scores are worked out exactly as before**, in the app and on the server (typed and voice saves).

### Known, left as they are (to the backlog)
- **Existing members' scores have an old quirk.** Today shows "x of N". The stored score uses a different count when the coach chose only some groups, or created own items. For example, 4 ticks with 1 own supplement scored 100%. QA measured it. It is unchanged here because your decision keeps existing members' scores as they are. Fixing it is a separate decision for you. (The new members' score has no such quirk.)
- **Existing members whose coach switched every ACV dose off** still get the ACV reminder, as before. Also a separate decision.
- **An app still cached on a phone from before the update**:
  - shows a new member the old list until it refreshes;
  - the server already scores that member by the new rule.
- **Calendar:** a day with no log and a logged 0% day now look alike, and only the screen-reader label tells them apart. This goes to the 3l copy and visual pass.
- **Odd lists (new members only):** a coach list that names a deleted item, or the same item twice, is counted slightly differently by the app and the server. No current screen writes such lists. Existing members are unaffected (shared pre-3k formula).

## Files
**NEW:**
- `server/scripts/test-ux-3k.mjs` (gate)
- `DELIVERY-FIXES-3k.md`
- `client/dist/assets/`: the new build's files

**Changed:**
- `server/db/schema.sql` (one additive line: `ADD COLUMN IF NOT EXISTS protocol_default_none BOOLEAN`)
- server:
  - `server/routes/admin.js`, `patients.js`, `logs.js`, `aiChat.js`
  - `server/services/compliance.js`, `memberLogApply.js`, `memberParse.js`, `gapDetector.js`, `triage.js`, `targetOrigin.js`, `cronService.js`
- client:
  - `client/src/lib/day/protocol.js`, `client/src/utils/logSync.js`
  - `client/src/pages/Plan.jsx`, `Progress.jsx`, `Profile.jsx`
  - `client/src/components/admin/EditMemberModal.jsx`
  - `client/src/components/coach/DayDetail.jsx`, `WaterTargetCard.jsx`
  - `client/src/components/sheets/ProtocolSheet.jsx`
- `client/dist/index.html`, `client/dist/sw.js`
- `server/scripts/test-local.sh` (the new suite in the gate), `server/scripts/ui-tests.mjs` (one assertion, below)

Two functions are now exported for the new suite only: `getSchedulesForTime` (cronService) and `resolveProtocolGroup` (aiChat).

## Independent QA review (before any push)
Under the AI Engineering Team framework, a separate QA agent reviewed the change. It never saw my reasoning, only the code.

| # | QA finding | Severity | Done |
|---|---|---|---|
| 0 | (first draft) "No selection = none" for everyone would have taken supplements away from existing members whose coach had ticked them all | blocker | Asked Sachin → "keep existing, change new"; rebuilt on the per-member flag |
| B1 | For a new member, the coach's editor read the rule from the members LIST row, which didn't carry the flag. It showed all 7 supplements ticked, and unticking one saved the other six | blocker | The editor reads the full member row; the list query also carries the flag. Test mounts the real editor with a list-shaped row |
| C1 | Existing members with a partial selection or own items would have scored differently (a fix of an old quirk, but a change) | contract | Existing members keep the pre-3k formula in the app and on the server. Test: every shape gives the pre-3k number. The quirk itself is listed above for a decision |
| S1 | Existing members with every ACV dose switched off would have stopped getting the ACV reminder | should-fix | New members only. Test: existing still gets it |
| S2 | The coach's day view changed for existing members, and past days could lose ticks of items removed later | should-fix | Existing: exactly as before. New: items in force plus anything ticked that day. Test renders the real day view |
| A3 | The coach card said "chosen by you" for a new member whose ACV list is empty | advisory | Now counts what is really in force |
| A1, A2, A4 | Odd lists; cached older apps; calendar look-alike | advisory | Listed under "Known" |
| Re-check | All fixes verified (editor repro, score table equal to the pre-3k one on every shape, reminder SQL, day view). No existing-member difference left except the intended wording and colours. **PASS** | — | — |
| N1 | Coach card: "1 supplement and ACV item you added" reads awkwardly and is wrong for ticked built-ins | advisory | "1 supplement or ACV item assigned" |

## Changes to existing tests
1. **`ui-tests.mjs`**, "tapping a logged cell opens that day's full log": the check looked for the word `Compliance|compliance`, which finding 8 replaces on member screens.
   - Changing it showed the old check was weaker than it looked. It searched the page (`#root`), where it found the "30-day Compliance" label. The opened day log is drawn outside `#root`, so it was never read.
   - The check now reads the opened day log itself and requires that day's "90% of checklist". This is stricter than before.

No other existing assertion changed. `test-target-origin` and `test-member-apply` are untouched. An earlier draft had changed them, and that change was undone when the rule became "new members only".

## Results
| Check | Result |
|---|---|
| `test-ux-3k.mjs` (new) | **67/67** on real Postgres through the real routes, including the migration on a scratch database, both kinds of member, the coach's AI commands, the admin save, the reminders, and the real coach editor and day view in jsdom. Breakages caught (each reverted on its own): client rule → 7 fail; server ACV total → 3; reminder filter → 1; admin create without TRUE → 10; editor rule → 4; in-force ticks → 1; coach-AI list → 2; gap rule → 1; editor reading the list row (B1) → 2; new count for existing members, app (C1) → 2, server → 2; ACV clause for everyone (S1) → 1; day view new rule for existing (S2) → 1; day view dropping a ticked item → 1 |
| Suites touched by the rule (on their own) | journey 83, target-origin 29, member-apply 62, day-lib 331, gaps 94, coach-triage 31: all pass, none changed |
| Screens (SIMULATED, local production server, real build, synthetic member) | **16/16**: new member at 360 and 390 px, light and dark (no ACV in "Next"; Plan "Your coach will add these"; Progress has no red and says "checklist"); existing member, light 360 and dark 390 (still the 7 standard supplements); coach card, both kinds of member |
| Full local gate | **all suites pass, 7,117 assertions** (7,050 before; the new suite adds 67). Entry `index-B-STrgkX.js` |
| Independent QA agent | two rounds: first review (1 blocker, 1 contract breach, 2 should-fix, all fixed), re-check **PASS** (no existing-member difference left except the intended wording and colours) |
| Live after the push | **fa405d3 live** (phone robot 42029625863, 5 Nov 12:51 UTC): deployment matched, 51/51 clean, 35 of 35 live files identical (`index-B-STrgkX.js`); GitHub gate green (42029625893). **Android emulator robot:** the first run (42031373877) passed every check at 411 px, but at 360 px it stopped at sign-in ("no Daily essentials after 40 s"), with no reason recorded. 7edd058 makes the robot report the screen, the login form, the Log In button and any alert text, with a photo. The rerun (42032722438) passed **26/26 at both sizes** (Android 14, Chrome 113; light and dark; keyboard by real taps; composer above the keyboard). The stall did not recur, and its cause is unknown. The robot member is an existing member, so these runs show the unchanged lists |
