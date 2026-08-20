FitLife — AI-first, premium pass
================================

Extract, drag the "client" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change. No API calls added.

FILES (4)
client/src/utils/dailyRead.js   NEW - the daily read generator
client/src/pages/DailyLog.jsx   read wired in, serif numerals, streak context
client/src/components/UI.jsx    breathing orb
client/src/index.css            orb animation

1 · TODAY'S READ
One coaching sentence at the top of the hero, written from the member's own
numbers. Examples it produces:

  "Fresh day. Start with your morning weight - it takes ten seconds."
  "You're 1,014 under and 88% through the protocol. 2 ACV doses and sleep
   times still to go."
  "259 kcal burned and 750 kg lifted. Log your meals so I can show the full
   picture."
  "Everything logged, and 9 days straight - your best run this month."

This is the change that makes the app feel AI-first: intelligence arrives
unprompted instead of waiting behind a button.

It is TEMPLATE-BASED, not AI-generated. Three reasons: it renders instantly
with no network call, it costs nothing on every page view, and it can never
say anything unexpected about someone's health. The AI budget is better spent
in the chat, where variety actually matters.

Seventeen branches, ordered by what matters most at that moment - time of day,
what is missing, energy balance, what is still open. It returns nothing at all
when there is nothing worth saying; silence beats filler.

Tone: honest, never guilt-tripping. "Nothing logged today" is useful.
Nothing in it shames a missed day.

2 · SERIF NUMERALS
Hero tile values now use Fraunces, which was already in the app for headings.
Numbers in a serif read editorial rather than dashboard. The labels stay on
Outfit, so this remains a deliberate accent and not a typeface swap.

3 · BREATHING ORB
A 3.2-second pulse on the AI orb. Long enough to read as "alive and listening"
rather than "demanding attention" - anything faster becomes a notification
badge and stops feeling premium. It honours prefers-reduced-motion, since a
permanent ambient pulse is exactly what people turn that setting on for.

4 · STREAK IN CONTEXT
The badge now reads "6 days · best this month" rather than "6-day streak". The
window widened from 14 to 30 days so the current run can be compared against
the best one in it. A raw number means little; being told it is your best does.
