FitLife — the member page message now knows what they missed
============================================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change.

THE BUG YOU FOUND
Opening 💬 Message from Subramanya's page produced:

    "Hi Subramanya, haven't seen your logs for a few days."

He had logged that morning. The gaps list passes the detected state in, but
the member page had nothing to pass, so the sheet fell back to a generic
nudge — one that happened to be false.

That is worse than unhelpful. A member who catches the app being wrong about
them trusts everything else in it a little less, including the numbers.

THE FIX
The sheet now fetches that member's actual state when no text is supplied. A
new per-member endpoint answers even when there is nothing outstanding, which
the list endpoint deliberately does not — it only returns members WITH gaps.

Subramanya at 15:17, weight and food logged:
    "Hi Subramanya, all up to date on your side — nice work.
     Just checking in: how are you finding things this week?"

The same member at 19:00, once water and activity are due:
    "Hi Subramanya, a couple of things are still open today — your water and
     today's activity. Pop them in when you get a moment..."

Asha, 86 days silent:
    "Hi Asha, haven't seen a log from you in a while. Everything alright?"

Every entry point now writes from the same detection: the gaps list, the
member page, the alerts list and the member menu.

WHILE IT LOADS
The box shows "Checking what they haven't logged…" and the send buttons are
disabled, so nobody fires a half-written message.

TESTS
  npm run test:gaps    52 assertions, six of them on the new endpoint
Regression: 253 across five suites, all passing.
