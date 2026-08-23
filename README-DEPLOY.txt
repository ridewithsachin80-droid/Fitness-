FitLife — one list, one message, nothing to choose
==================================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change.

DEPLOY THE "todays-gaps" ZIP FIRST if you have not — it carries the endpoint
and the card. This simplifies both.

YOU WERE RIGHT ABOUT THE DUPLICATION
Today's gaps and Needs Attention were two lists doing overlapping jobs. Asha
appeared in both, with a 💬 button in each. And the compose sheet then asked
you to pick "Not logging / No weight / Check in" — a category the app had
already worked out.

THREE THINGS REMOVED

1. NEEDS ATTENTION'S PER-MEMBER LIST IS GONE
   Members who have not logged in days now appear in the same gaps list, with
   the day count as their reason:

       Asha              [86 days no log]        💬 Message
       Harsha            [Nothing logged]        💬 Message
       Vishwas           [No food]               💬 Message
       Daya              [No weight] [No food]   💬 Message

   One list, ordered most urgent first.

2. THE PRESET CHIPS ARE GONE
   The message text is already written from what the member actually has not
   logged. Asking a coach to pick a category first was work the app had
   already done. The text is still fully editable — that has not changed.

3. THE DUPLICATE 💬 BUTTONS ARE GONE
   One button per member, in one place.

WHAT WAS KEPT
"Send an in-app reminder to all N" survives as a single button, because bulk
in-app push is the one action the gaps card deliberately does not automate.
Its caption now says plainly that for members who have stopped opening the app,
💬 is the better tool.

THE MESSAGE ADAPTS TO HOW LONG THEY HAVE BEEN GONE
    4 days      "haven't seen a log from you for 4 days. Everything alright?"
    86 days     "haven't seen a log from you in a while. Everything alright?"
    never       "we haven't seen you in FitLife for a long while. No pressure
                 at all — but if you'd like to pick things back up, I'm here."

An itemised chase after a month of silence reads as an invoice rather than
concern, so a dormant member never gets a checklist of today's missing items.

TESTS
  npm run test:gaps    37 assertions
Regression: 264 across six suites, all passing.
