# Delivery: fixes from the Android screenshot review — 7 Oct 2026

Built on the `main` ZIP uploaded on 7 Oct 2026 (`Fitness--main_5.zip`). This
zip holds only the files changed against that upload. Upload to `test`, wait
for green, try it on fitness-test.up.railway.app, then merge.

Source: 63 screenshots from Sachin's Android phone (28 member, 35 coach/admin).

## Fixed first

1. **"Hi Mrs.,"** — coach Message, Push and Add note, the swaps panel, the
   member's own Progress title and the remembered name on Login took the first
   word of the name. All now use the app's one name rule (`utils/personName`):
   Mrs. Padmini is Padmini, T V Sharada is Sharada.
2. **Raw `’` shown as text** — 7 places: Plan › Week, Plan › Nutrition
   (no targets), and five lines in the welcome screens new members see first.
   A test now reads every screen with a parser, so it cannot come back.
3. **See-through chat bar on Today** — the bar now has a near-solid background
   (`.glass-solid`); its blur was getting nothing to blur on Android.
4. **Voice test score** — a recording an engine did not answer is now a miss.
   The first run read "Gemini 80% · Whisper 69%"; counted honestly it is
   Gemini 57% (answered 5 of 7) · Whisper 69%. Also: one retry when an engine
   is busy (429, 5xx, timeout); the reason for a no-answer is stored (never
   the key) and shown in the panel and the downloaded file (two new columns,
   `gemini_problem`, `whisper_problem`).

## Wrong or confusing

5. Macro Lab: "No meaningful difference…" printed once.
6. Settings › Push Notifications: opening the card registers the phone
   (members' phones registered on Today; coach and admin phones never did). If
   it cannot, it says "Allowed, but this phone is not registered" with Try again.
7. Voice test: switched-off accounts are not offered for invite and cannot be
   invited; one already listed reads "account off".
8. "30-day compliance": Progress averaged the last 30 *logs*; it now uses the
   30 calendar days its grid shows, and Profile uses the same 30 days (India
   time). The two screens give one figure.
9. Streak: 1–2 days reads "Good start" / "keep your 2-day streak going".
10. Nutrition chart: Protein, Carbs and Fat have three checked, distinct
    colours (carbs and fat were both yellow); dark pop-ups; no white focus box.
    Retitled "Nutrition Trend · Your last N logged days" (it was never 7 days).
11. Print Report: readable at phone width.
12. Today › Eat: "0 of 3 meals logged" instead of "3 meal plans pending".

## Polish

- 13 missing section icons added (14 titles showed a dash).
- Lab values: "Muscle Mass %" not "Muscle Mass % %"; 1716 not 1716.00.
- Profile: "Connected devices" listed once.
- Coach list: "No weight" on its own line, clear of the % pill.
- Training summary: no "Volume per session" block when nothing was lifted.
- Voice panel: member rows aligned; a tie highlights neither engine.
- Settings for coach/admin: no age group, avatar or meal slot cards.

**Not changed:** the floating gold Coach AI button. It is 44 px wide and placed
at the edge on purpose; any floating button covers something. The real fix is
to move it into the bottom bar as a centre button, like the member app.

## Database

Two columns added (safe on every boot): `voice_samples.gemini_error`,
`voice_samples.whisper_error`. Nothing renamed or removed.

## Files

New (1): `DELIVERY-REVIEW-7OCT.md`.

Changed (26):
- `client/src/index.css`
- `client/src/components/AIChatLog.jsx`, `MacroLab.jsx`, `Onboarding.jsx`,
  `TrainingSummary.jsx`, `UI.jsx`
- `client/src/components/coach/MemberActionSheet.jsx`, `SwapsPanel.jsx`
- `client/src/components/today/TodaysPlan.jsx`
- `client/src/components/voicepilot/VoicePilotPanel.jsx`
- `client/src/pages/Login.jsx`, `Monitor.jsx`, `PatientList.jsx`, `Plan.jsx`,
  `Profile.jsx`, `Progress.jsx`, `Settings.jsx`
- `client/src/utils/coachCard.js`, `personalMessage.js`
- `server/db/schema.sql`
- `server/routes/patients.js`, `voicePilot.js`
- `server/services/voicePilot.js`
- `server/scripts/test-journey.js`, `test-voice-pilot.js`, `ui-tests.mjs`

## Gate

- 3,514 checks green in one full run (3,465 before), including real Chrome.
- New checks: 49. Voice test 15, the Profile 30-day window on real Postgres 3,
  screen tests 31.
- 28 bugs put back one at a time; a test turned red for each.
- Looked at in real Chrome at 360 px: Progress (Body, Nutrition with its
  pop-up, Reports), the voice panel, Settings.

## Not tested here

- A real phone. The chat bar fix is checked in desktop Chrome with the built
  stylesheet, not on the Android phone that showed the problem.
- Push registration succeeding on a coach's phone (the test covers the
  "could not register" path only).
- Real speech engines: the retry and the stored reason are tested with
  stand-ins.
