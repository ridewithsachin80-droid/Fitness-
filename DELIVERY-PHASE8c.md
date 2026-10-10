# Delivery: Phase 8c — Coach AI in the bottom bar, and the open small items — 7 Oct 2026

Built on the `main` ZIP uploaded on 7 Oct 2026 (`Fitness--main_5.zip`). This
zip is cumulative against that upload: it carries the review fixes of earlier
today (`FitLife-Review-Fixes.zip`) plus everything below. Upload this one;
there is no need to upload the review-fixes zip first.

Upload to `test`, wait for green, try it on fitness-test.up.railway.app, then merge.

## 1. Coach AI is the centre button of the bottom bar

- Coach: Members · (Coach AI) · Settings. Admin: Members · Admin · (Coach AI) ·
  Settings. The gold button is centred in both, 56 px, like the member app's.
- The floating gold tab on the right edge is gone from every screen. It used
  to cover Refresh, Draft the plan and members' weights.
- The admin dashboard now has the same bottom bar as every other coach screen.
  It had none before, only the floating tab.
- From Settings (where there is no chat) the button goes to the coach home
  with the chat already open.

## 2. Diet Plan Studio

- **PDF of a draft.** A draft now has "PDF of this draft (marked DRAFT)". The
  server stamps DRAFT on every page.
- **No carb or fat target.** A draft with either one missing (usually a plan
  read from a PDF that named only calories and protein) now says so: the carb
  check cannot run and the member sees "—". It shows the
  member's own targets, and one tap fills the missing ones ("Use 80 g carbs,
  87 g fat"). Nothing is filled in silently: with a carb target, the carb check can
  start blocking approval. A plan already in force says the same and points to
  Revise this plan.

## 3. Member chat: "Log as planned"

When a member asks about the plan ("what's today's meal plan?", "what do I eat
next?", "aaj kya khana hai") the answer now carries a button for the next
unlogged meal, "Log Breakfast as planned". It opens the same sheet as the Next
up card. The meal is worked out when the button is drawn, so it is never stale,
and it disappears once every planned meal is logged.

## 4. Voice test: "Try the unanswered recordings again"

Asks an engine again for stored recordings it gave no answer for, one at a
time, at most 20 a tap. Members do not record again. Only the engine that
failed is asked; the other's answer is left alone. Use it for the two Gemini
no-answers from the first run: if it fails again the panel now says why.

## 5. Raw vs cooked foods (audit of the food table)

Everyday words were run through the app's real lookup. These found a DRY or
RAW row, two to three times what the food carries as eaten:

| Member types | Was (kcal per 100 g) | Now |
|---|---|---|
| chana, kadale, chickpeas, kabuli chana | 360 (dry gram) | 164 |
| urad dal, uddina bele | 347 | 105 |
| chana dal, kadale bele | 372 | 129 * |
| whole moong, hesaru, green gram | 347 | 105 |
| lobia, alasande | 323 | 116 |
| pasta, spaghetti | 348 (dry) | 158 |
| noodles | 364 (dry rice noodles) | 138 |
| rice noodles | 364 | 108 |
| idiyappam, shavige | 350 (dry vermicelli) | 140 * |
| red rice | 350 (raw) | 123 |
| corn | 357 (it found Cornflakes) | 86 (sweet corn) |

`*` = an estimate worked out from this table's own rows (see the note at the
top of `server/services/foodFixes.js`). The others are standard published
values for the food boiled in water, with no salt or fat.

- The dry rows are all still there under their full names; their everyday
  names now say "(raw)" or "(dry)" so a search list cannot mistake them.
- Left alone on purpose: oats, soya chunks, ragi, jowar, bajra, millets, rava,
  sabudana and the flours. People weigh these dry, or log the dish.
- Runs on every boot, safe to repeat. **Food already logged is not changed**:
  each log keeps the values it was saved with. Only new entries get the new
  figures.

## Database

Nothing new in this part (the two `voice_samples` columns came with the review
fixes). 11 food rows are added and 6 everyday names changed, by the boot-time
food fix.

## Files

**New (4):**
- `client/src/store/coachAIStore.js` (the chat's open/closed flag, shared by the bar)
- `client/src/components/chat/LogPlannedButton.jsx` (the chat's "Log as planned" button)
- `DELIVERY-PHASE8c.md`, `DELIVERY-REVIEW-7OCT.md`

**Changed in this part (18):**
- `client/src/components/UI.jsx`, `CoachAIChat.jsx`, `AIChatLog.jsx`
- `client/src/components/coach/DietPlanStudio.jsx`
- `client/src/components/voicepilot/VoicePilotPanel.jsx`
- `client/src/lib/day/planMeals.js`
- `client/src/pages/AdminDashboard.jsx`, `Monitor.jsx`, `PatientList.jsx`, `Today.jsx`
- `server/routes/dietPlans.js`, `voicePilot.js`
- `server/services/foodFixes.js`, `voicePilot.js`
- `server/scripts/test-diet-studio.js`, `test-food-cooked.js`,
  `test-voice-pilot.js`, `ui-tests.mjs`

Plus the files of the review fixes (listed in `DELIVERY-REVIEW-7OCT.md`).
In all, 39 files against the 7 Oct upload: 4 new, 35 changed. No file renamed
or deleted.

## Gate

- 3,599 checks green in one full run (3,514 after the review fixes, 3,465 on
  the upload), including real Chrome at 320 to 390 px.
- New in this part: 85 checks. Screen tests 34, voice "try again" 9, the
  Studio's member targets 2, the food audit 40.
- 28 bugs put back one at a time; a test turned red for each. Two were missed
  at first, and the two checks were made stricter until they caught them.
- One gate rule tripped during the work: the chat screen file has a line limit,
  so the new button lives in its own file.
- Looked at in real Chrome: the bottom bar for coach and admin (360 and 320
  px), the Studio's target note (360 and 320 px), the chat button.

## Not tested here

- A real phone: the bottom bar is measured in desktop Chrome at phone widths.
- Real speech engines: "try again" is tested with stand-ins.
- Whether the chat's plan answer reads well: the button is tested, the AI's
  wording is not.
