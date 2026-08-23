FitLife — why a member is missing from the gaps list
====================================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change.

SUBRAMANYA WAS NOT A BUG, BUT IT LOOKED LIKE ONE
He is absent from the list because at 15:17 he had already logged his weight
and his food — everything the app checks for by mid-afternoon. Water is not
checked until 6pm, activity until 7pm, supplements until 8pm.

I traced it against the real thresholds to confirm:

    weight + food logged      15:00  nothing flagged yet
                              18:00  water
                              19:00  water, activity
                              20:00  water, activity, ACV, supplements

So he would have appeared on his own an hour later. But the compliance list
below showed him at 0%, and an empty entry beside a 0% row reads as broken —
which is a real problem even when the logic is right.

WHAT I ADDED
The card now says why the list is short:

    "3 other members have logged everything due so far.
     Next check at 6pm — water well under target."

And when nobody needs chasing at all:

    "Everyone has logged what's due so far. Nothing to chase.
     Next check at 6pm — water well under target."

WHY NOT JUST FLAG EVERYTHING EARLIER
Because that is the failure mode this design exists to avoid. Flagging water at
9am, or supplements at lunchtime, trains a coach that the list is noise and
they stop reading it — at which point it is worse than having no list. The
thresholds stay; the reasoning is now visible instead of implicit.

TESTS
  npm run test:gaps    46 assertions, including Subramanya's exact scenario
                       traced hour by hour from 15:00 to 20:00
Regression: 180 across four suites, all passing.
