FitLife — app link included in every message
============================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. schema.sql adds one column, re-runs safely.

SUPERSEDES both earlier WhatsApp zips. Deploy this one only.

WHAT CHANGED
Every message now ends with the app link on its own line, which WhatsApp turns
into a tappable preview:

    Hi Harsha, haven't seen your logs for a few days. Everything alright?
    Open FitLife and just tell the AI what you ate — it fills the rest in.

    https://fitness.upscale-app.com

The link sits on its own line rather than inline, so it reads as a call to
action instead of interrupting the sentence.

DEEP LINKS WHERE THEY HELP
  nudge, weight, check-in  ->  /            the Today page, ready to log
  weekly summary           ->  /progress    the charts being discussed
  lab update               ->  /profile     where their plan and labs sit
All three routes exist and are member-only, so the link lands on the right
screen straight after login.

THE DOMAIN IS NOT HARD-CODED
It is read from wherever the coach is running the app, so the link is always
correct — production, a staging deploy, or localhost — and cannot drift out of
date if the domain ever changes. The production domain is only used as a
fallback if that is somehow unavailable.

VERIFIED
The URL survives encoding into a wa.me link: colons and slashes escape to
%3A%2F%2F, newlines to %0A, and the message decodes back byte-for-byte. That
matters because a mis-encoded URL either truncates the message or arrives as
plain text nobody can tap.

TESTS
Regression: 97 assertions across two suites, all passing.
