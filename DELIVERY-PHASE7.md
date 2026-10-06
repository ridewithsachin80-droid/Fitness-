# Delivery: Phase 7 (weekly check-in and the coach's AI weekly brief) — 6 Oct 2026 (rev 2)

Cumulative from the `main` ZIP of 3 Oct 2026: carries every earlier file too
(Phases 1.3–6), unchanged since those deliveries. Upload to `test`, wait for
green, try it on fitness-test.up.railway.app, then merge.

## Rev 2 — diet plan PDF fixes (from Ragavendra's PDF, 6 Oct)

- **Grams were added twice** when the household measure already gave them
  ("1 idli (50 g) (50 g)", "200 g, with 1 teaspoon olive oil + lemon (200 g)").
  Grams are now added only when the measure has no weight in it ("1 scoop (30 g)").
- **Notes in the measure were cut at 40 characters** ("A different soppu each day -
  you"). Now kept up to 160: `diet_plan_items.qty_text` widened to VARCHAR(160)
  (safe on every boot, no table rewrite) and the coach-chat import no longer cuts
  at 40. Plans already saved stay cut: revise or re-import them to restore the
  full note.
- Changed: `server/services/planPdf.js`, `server/services/dietPlan.js`,
  `server/routes/aiChat.js`, `server/db/schema.sql`, `server/scripts/test-plan-pdf.js`.
  3,284 checks green.

## Member: weekly check-in

- A "Weekly check-in" card on Today on **Sunday and Monday**, until it is done.
  No notification (one message a day).
- Five taps, 1 to 5, each end in words: energy, hunger, sleep, stress,
  sticking to the plan; and an optional note for the coach.
- It belongs to the week ending that Sunday (a Monday answer is about the
  week that ended yesterday). Answering again that week replaces it.

## Coach: the week brief (member page › Today tab)

- For the member's **last full week** (Mon–Sun): two or three sentences on how
  it went, then "Try:" up to three actions for you. Written by the AI from
  numbers this app computes, shown under it: days logged, average kcal against
  target, weight change, workout days; plus progress photos, off-plan meals,
  swap requests waiting, and the check-in answers and note (a worrying answer
  marked).
- The AI is told to use only those facts, say "not logged" where one is
  missing, and give no medical advice. If the AI is down, a plain brief from
  the same numbers is stored, marked as such.
- Made for every member on **Monday at 07:00 IST**; made on the spot if you
  open a member with none; made again by itself if the member checks in after
  it was written; "Refresh" to make it again by hand.
- **Coach-only.** The member never sees it.

## Files

New (7): `server/services/weeklyBrief.js`, `server/routes/weekly.js`,
`server/scripts/test-weekly.js`, `client/src/components/checkin/CheckinSheet.jsx`,
`client/src/components/checkin/CheckinCard.jsx` (new folder `components/checkin/`),
`client/src/components/coach/WeeklyBrief.jsx`, `DELIVERY-PHASE7.md`.

Changed (7): `server/db/schema.sql` (tables `weekly_checkins`, `coach_briefs`),
`server/index.js`, `server/services/cronService.js` (Monday 07:00 job),
`server/scripts/test-local.sh`, `server/scripts/ui-tests.mjs`,
`client/src/pages/Today.jsx`, `client/src/pages/Monitor.jsx`.

No file renamed or deleted. Two tables added.

## Gate

- 3,279 checks green in one full run, including real Chrome at 320/360/390 px.
- New: `test-weekly` 27 checks (with "today" pinned so every week rule is
  exact), screen tests 11, phone-width checks for the sheet and the brief.
- Bugs put back one at a time: the brief covering an unfinished week, no brief
  when the AI is down, a late check-in not reflected, the check-in open every
  day, the AI not told to use only the facts; each turned a test red. (Letting
  members call the brief route is also blocked by the per-member access check.)
