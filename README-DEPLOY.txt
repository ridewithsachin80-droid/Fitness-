FitLife — Today's gaps, with a message ready for each
=====================================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
ONE RENAME: server/server-package.json -> package.json (in server/)
No new packages. schema.sql re-runs safely.

SUPERSEDES all earlier WhatsApp zips. Deploy this one only.

WHAT IT DOES
A new "📋 Today's gaps" card sits at the top of the Admin overview. It lists
who hasn't logged what, and each gap is a button that opens WhatsApp already
talking about that specific thing:

    Harsha          💬 No food    💬 No weight
    Asha            💬 Nothing logged
    Daya            💬 Low water  💬 No activity

Nine gap types: nothing logged, food, weight, dinner, water, activity, ACV,
supplements, sleep. Each has its own message.

TIMING IS THE WHOLE POINT
"No water logged" at 9am is not a gap, it is a morning. Flagging it teaches a
coach the list is noise and they stop reading it, which is worse than no list.
So every check has an hour before which it does not apply:

    11:00  morning weight
    14:00  nothing logged at all
    15:00  no food
    18:00  water under half target
    19:00  no activity ticked
    20:00  ACV, supplements
    21:00  dinner, sleep times

All computed in IST regardless of where Railway runs the container.

ONE MESSAGE, NOT SIX
A member who has logged nothing has one problem, not six. Sending them
separate messages about water, ACV, supplements, activity and food would be
five messages saying the same thing, from a coach's personal number — which is
how a helpful nudge becomes harassment.

So "nothing logged" suppresses every other gap for that member, and anyone
else shows at most two. The full list is still counted ("+3 more") so nothing
is hidden from the coach.

NOTHING SENDS AUTOMATICALLY
The list is a prompt for the coach. They know which member is travelling,
unwell, or simply doesn't need chasing. Every message opens in their own
WhatsApp, editable, and is only sent when they tap send there.

TWO BUGS FOUND WHILE TESTING
· The query selected a column called meal_slots. The actual column is
  meal_plan, so the endpoint returned 500 for every coach. Caught because the
  test called the real endpoint rather than only the function behind it.
· My own test asserted that an empty log at 16:00 shows "no food" and "no
  weight". It correctly shows "nothing logged" instead — the blocking gap
  suppressing the others, which is exactly the restraint described above.

TESTS
  npm run test:gaps    30 assertions, most of them about NOT flagging
Regression: 231 across five suites, all passing.
