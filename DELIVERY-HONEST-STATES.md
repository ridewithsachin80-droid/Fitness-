# Delivery: four fixes from the outside review — 7 Oct 2026

Built on the live `main` branch as it stood at 13:18 on 7 Oct 2026 (after
Phase 8c and the dead-file clean-up). The zip holds only what changed since.

Upload to `test`, wait for green, try it on fitness-test.up.railway.app, then merge.

These are findings 1, 2, 4 and 5 of
`FitLife-Member-Experience-AI-Review-and-Sprint-Brief.md`. Each was checked
against the code before anything was changed.

## 1. Connected devices says what cannot connect

**What was wrong.** The page offered "Android Health Connect — Tap to sync
Samsung, Garmin, Fitbit data". Nothing can answer that tap. Health Connect is
an Android feature with no web version, and the Android wrapper cannot pass it
to the page. The tap replied "Use Chrome on Android 14+", which no browser
can satisfy.

**Now.**
- A plain note: "Android Health Connect is not supported yet. FitLife cannot
  read Health Connect, so HART PRO, Garmin, Samsung and Ultrahuman cannot sync
  here for now. You can still log your sleep and workouts yourself on Today."
- Those four devices, and Apple Watch, are marked "Not supported yet". Opening
  one shows the reason and no Connect button.
- Fitbit, WHOOP and Polar are unchanged: they connect by account login.
- If a real Android bridge is ever added, the same page shows the sync banner
  and Connect buttons again with no further change.

**Also removed from this page** (not in the review, found while fixing it):
- "Sync Settings": four switches (background sync, heart-rate alerts and so
  on) that only flipped on the screen and did nothing.
- A hidden "Scanning… Pairing… Connected!" dialog that faked a connection on
  a timer. No screen opened it, but it should not exist.
- Apple Watch's two "workarounds": a CSV upload the app does not have, and
  Health Connect.

## 2. Each member has their own sleep times

**What was wrong.** Every member saw "10:00 PM → 6:30 AM" with "8 h" beside
it. The times were fixed in the code, and they are eight and a half hours
apart, not eight.

**Now.**
- On a member's page, **Training tab → Sleep target → Change**: set a bedtime
  and wake time. The card shows what they add up to before you save.
- The member's Plan and sleep sheet show those times, with the hours worked
  out from them.
- Until you set them, a member keeps 10:00 PM → 6:30 AM, now labelled 8.5 h.
- A target under 4 or over 12 hours is refused, with the hours named ("That is
  3 hours of sleep… check AM and PM").
- "Go back to the standard times" clears a member's own times.

**Decisions I made — tell me if you want them changed:**
- The standard times stay 10:00 PM → 6:30 AM and the label becomes 8.5 h. If
  you meant 8 hours, tell me which time to move.
- Only the coach (or an admin) sets the times. The member cannot change them.
- It is a card on the member page, not a Coach AI command.

**Database:** two new columns on `patient_profiles`, `sleep_bed` and
`sleep_wake`. Added automatically on the next start; nothing to do by hand.

## 4. Nutrient gaps are no longer invented by blanks in the food table

**What was wrong.** When the food table has no figure for a nutrient, it
stores 0. "Consistently under target" read every 0 as "ate none". I loaded
the app's own 573-food table and counted how many foods have a figure:

| Nutrient | Foods with a figure |
|---|---|
| Zinc | 29 |
| Folate | 35 |
| Vitamin D | 37 |
| Vitamin E | 54 |
| Vitamin A | 63 |
| Calcium | 521 |

So nearly every member was told they were low in zinc, folate and vitamin E
whatever they ate. And because the list shows only the six lowest, those
pushed real gaps such as fibre and iron off it.

**Now.**
- A gap is shown only when at least 70% of the calories logged came from food
  that has a figure for that nutrient.
- When part of the food has no figure, that part is assumed to be about as
  rich as the rest, not empty.
- A zero is treated as a real zero only for fibre, B12, vitamin C and vitamin
  D, and only on a food that carries mineral figures. Oil, ghee and sugar are
  counted as genuinely having no minerals.
- Nothing is claimed from fewer than 5 logged days.
- The coach sees one extra line: "Cannot be judged from the food logged: …".
  Members do not see that line.
- The caption now says the figures are from food only and supplements are not
  counted.

**Decisions I made — these are judgment calls about nutrition, and yours to
overrule:** the 70% bar, the 5-day minimum, and which four nutrients may be a
real zero. Each is one line at the top of `server/services/adaptiveEngine.js`.

## 5. Recovery no longer tells anyone to train hard

- "Good day to train hard" is now "Today's plan should feel easier."
- "Green light for a hard session" is now "You are ready for today's plan —
  no need to add to it."
- A comparison with "your week's average" now needs at least three earlier
  days, not two.
- Unchanged: warnings (low recovery, raised resting heart rate, low HRV, under
  six hours of sleep) still come before any good news, and data older than
  yesterday is still ignored.

## Found, not built

- **Today's "n of N targets met" has the same blank-as-zero problem.** It
  counts about 30 nutrients, and the food table has almost no figures for
  many of them, so those can never be "met". Fixing it changes the Today
  screen, so I left it for you to decide.
- **Vitamin D will show as low for nearly everyone.** That is true of food
  (most vitamin D comes from sunlight) but not useful. Say if you want it
  left out of the list.
- **The food table itself is thin** on zinc, folate, vitamins A and E and
  omega-3. The coach's new "cannot be judged" line shows this per member.

## Files

**New (3)**
- `client/src/components/coach/SleepTargetCard.jsx`
- `server/scripts/test-sleep-target.js`
- `DELIVERY-HONEST-STATES.md`

**Changed (16)**
- `client/src/pages/DeviceConnect.jsx`
- `client/src/hooks/useHealthConnect.js`
- `client/src/pages/Plan.jsx`
- `client/src/pages/Monitor.jsx`
- `client/src/components/sheets/SleepSheet.jsx`
- `client/src/components/MetabolicInsight.jsx`
- `client/src/lib/day/sleep.js`
- `client/src/lib/day/recovery.js`
- `server/db/schema.sql`
- `server/routes/patients.js`
- `server/routes/logs.js`
- `server/services/adaptiveEngine.js`
- `server/scripts/test-local.sh`
- `server/scripts/test-day-lib.js`
- `server/scripts/test-adaptive.js`
- `server/scripts/ui-tests.mjs`

## Tested

The full gate is green: **3,721 checks** (3,599 before this delivery). That is the
client build, every server suite against a real local Postgres built from
`schema.sql`, the lint for undefined names, and the UI suite in jsdom and in
headless Chrome at 320, 360 and 390 px. The new checks are 37 in the new
`test-sleep-target.js`, 21 in `test-adaptive.js`, 17 in `test-day-lib.js` and
47 in `ui-tests.mjs`.

I put 47 bugs back one at a time (for example: every 0 counted as "ate none"
again, a 13-hour target accepted, the member's own times ignored on the Plan,
a Connect button on Garmin). All 47 turned a test red.

I looked at every changed screen at 320 and 360 px in headless Chrome.

## Not tested here

- A real phone. Layout was measured in desktop Chrome at phone widths.
- A real tracker. Recovery wording was tested with made-up readings.
- Your production food table. I measured the table the app seeds itself
  with; foods added since (by the AI or by hand) are not in my count.

## Check after deploy

1. As a member: Profile → Connected devices. The note at the top, and no
   Connect button on Garmin.
2. As coach: a member → Training → Sleep target → Change. Set 11:00 PM and
   5:00 AM, save, then open that member's Plan.
3. As coach: a member → Nutrition → Metabolic Insight. Zinc and vitamin E
   should be under "Cannot be judged", not "under target".
