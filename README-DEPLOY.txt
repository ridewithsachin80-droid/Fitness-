FitLife — message members from your own WhatsApp
================================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. schema.sql adds one column, re-runs safely.

WORKS TODAY. No Meta verification, no DLT templates, no cost.

WHAT IT DOES
A "💬 Message" button now sits beside Add Note on a member's page. It opens a
sheet with the text ready, you edit it, and it opens YOUR WhatsApp with the
message pre-filled to that member. You tap send.

Three presets — Not logging, No weight, Check in — plus the weekly summary
when one is available. All editable, because that is the point.

WHY THIS RATHER THAN THE BUSINESS API
The Business API sends from a business number using a template Meta approved
weeks earlier. Right at a few hundred members; wrong at a few dozen. A
templated nudge to someone who knows Sachin personally reads like a bank
notification and makes the product feel less personal than it actually is.

This arrives in the conversation the member already has with their coach,
which is where they will actually reply. The cost is one tap of coach time per
member and no delivery receipt. At your size that is the better trade.

The Business API plumbing from the previous batch stays in place, inert until
you add credentials. Use this now, switch that on when the member count makes
personal messaging impractical.

A DUPLICATE-DELIVERY BUG FIXED ALONG THE WAY
Saving a copy of the message as a coach note would have delivered it twice:
once on WhatsApp and again as an unread "action needed" card in the app,
making the coach look like they were nagging. Notes sent externally now carry
delivered_via and are stored already-read, so they appear in the member's
history without a second notification. Verified directly against the database.

DETAILS
· Numbers are normalised to the 91XXXXXXXXXX form wa.me needs — 10-digit,
  +91-prefixed, 0-prefixed and spaced formats all work; malformed ones disable
  the buttons with a reason rather than opening an empty chat.
· Ampersands are escaped. A raw & in a wa.me link silently truncates the
  message at that point, which is the failure nobody notices until a member
  gets half a sentence.
· The sms: scheme differs on iOS (&body=) from everywhere else (?body=).
  Both handled — getting it wrong opens an empty compose window.
· wa.me opens the app on a phone and WhatsApp Web on a desktop, so it works
  wherever the coach is.
· "Keep a copy in their notes" is on by default, so a conversation that
  happens in WhatsApp is not invisible to whoever picks the member up next.

TESTS
Link generation and encoding verified, including the ampersand case.
Regression: 201 assertions across four suites, all passing.
