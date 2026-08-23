FitLife — one message listing everything a member is missing
============================================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change.

DEPLOY THE PREVIOUS ZIP FIRST if you have not — it carries the endpoint,
the routes and the card itself. This changes how the message is built.

WHAT CHANGED
One 💬 Message button per member instead of one per gap. The gaps are now
chips showing what is missing, and the single message names all of them:

    Harsha    [No weight] [No food]              💬 Message

    "Hi Harsha, a couple of things are still open today — your morning weight
     and your meals. Pop them in when you get a moment, or just tell the AI
     and it'll sort the rest.

     https://fitness.upscale-app.com"

GRAMMAR AGREES WITH THE COUNT
    1 gap    "your morning weight isn't logged yet today. Pop it in..."
    2 gaps   "a couple of things are still open — X and Y. Pop them in..."
    3-4      "a few things are still open — X, Y and Z. Pop them in..."
    5+       falls back to the gentle "haven't seen anything from you today"

"Your weight isn't logged, pop THEM in" is the kind of mismatch that makes a
message read as generated rather than written, so it is handled explicitly.

WHY NOT LIST EVERYTHING WHEN THERE ARE MANY
Beyond four items the list stops being a nudge and becomes an audit of
someone's failures. At that point they have not really engaged with the day at
all, so the message asks how they are instead of itemising what they missed.

STILL ONE MESSAGE PER MEMBER, NOT PER ITEM
Two or three separate WhatsApps within a minute, from a coach's personal
number, reads as pestering. That was the flaw in the previous version and it
is fixed here.

TESTS
  npm run test:gaps    31 assertions
Message phrasing verified for one, two, three and four gaps.
Regression: 128 across three suites, all passing.
