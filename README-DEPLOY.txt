FitLife — WhatsApp from the Needs Attention list
================================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. schema.sql adds one column, re-runs safely.

SUPERSEDES the previous personal-WhatsApp zip — this contains that plus the
new entry points. Deploy this one.

WHERE THE BUTTON NOW IS

  1. Admin -> Overview -> Needs Attention
     A 💬 button beside every member's Remind button.

  2. Admin -> Members -> the ⋮ menu on a member card
     "💬 Message on WhatsApp".

  3. A member's page, beside Add Note   (already shipped)

WHY THIS LIST ESPECIALLY
Your Needs Attention list currently reads: Harsha never logged, Vishwas never
logged, Asha 86 days, Sachin 57 days, Suresh 53 days, Bujju 44 days. A push
notification to someone 86 days silent is delivered to an app they stopped
opening two months ago. The Remind button is the right tool for a member who
missed yesterday; it cannot reach these eight.

WhatsApp can, because it arrives in a conversation they already read.

BOTH BUTTONS REMAIN
  💬  opens your own WhatsApp with the text ready, nothing sent until you tap
      send there
  ✨  the existing in-app push and flagged coach message, logged in Audit

The footnote under the list now says which does what, because two similar
buttons with different behaviour is worse than one.

THE COMPOSE SHEET IS THE SAME EVERYWHERE
Three presets, editable text, and a "keep a copy in their notes" checkbox. A
note saved this way is stored already-read, so the member does not receive the
message twice — once on WhatsApp and again as an unread card in the app.

NOT ADDED, DELIBERATELY
There is no "WhatsApp everyone" to match "Remind everyone". It would open eight
browser tabs at once, most of which the browser would block, and the ones that
survived would send eight identical messages from a personal number — which is
exactly what makes personal messaging worth doing and exactly what would ruin
it. Tap them one at a time; with eight members that is a minute of work.

TESTS
Entry points and state ordering verified. Regression: 124 assertions across
three suites, all passing.
