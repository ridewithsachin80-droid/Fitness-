FitLife — reach members on WhatsApp and SMS
===========================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
ONE RENAME: server/server-package.json -> package.json (in server/)
No new packages. schema.sql adds columns and a table, and re-runs safely.

THE PROBLEM THIS FIXES
Coach messages live in the app. A member who has stopped logging does not open
the app — so "we miss your logs" is delivered precisely to the people who do
not need it, and never reaches the people who do. Push helps a little, but push
permission tends to be granted by engaged members and ignored by everyone else.

WHAT HAPPENS NOW
The coach's Remind button and the weekly summary go through a channel chain:

    push  ->  WhatsApp  ->  SMS

Cheapest first, stopping at the first success. Sending all three is both
wasteful and irritating, and paying for a WhatsApp conversation to someone who
just read the push is money for nothing.

CODE IS READY; CREDENTIALS ARE NOT
Everything works the moment you add credentials, and degrades silently and
safely without them — no errors, no crashes, each skip recorded with a reason.

  SMS — you already have MSG91 for OTP, so the account and DLT registration
  exist. You need DLT-approved template IDs for the new message types:
      MSG91_SENDER_ID     your 6-character DLT header
      MSG91_TPL_NUDGE     "Hi {#var#}, your coach is waiting on {#var#}..."
      MSG91_TPL_SUMMARY   weekly summary template
      MSG91_TPL_COACH     general coach message template
  DLT template approval usually takes a few working days.

  WHATSAPP — needs a Meta Business account, a verified business, and either
  direct Cloud API access or a BSP (Gupshup, AiSensy, Interakt and WATI are
  the common Indian ones). Then:
      WHATSAPP_TOKEN      Meta or BSP access token
      WHATSAPP_PHONE_ID   Meta phone number id
      WA_TPL_NUDGE        approved template name (default fitlife_log_reminder)
      WA_TPL_SUMMARY      default fitlife_weekly_summary
      WA_TPL_COACH        default fitlife_coach_message
  Business verification takes days to weeks. Business-initiated messages MUST
  use a pre-approved template — free text gets a number banned, not delivered.

  Optional:
      QUIET_HOURS_FROM    default 21
      QUIET_HOURS_TO      default 7

WHAT IT REFUSES TO DO
 · Send between 21:00 and 07:00 IST. Computed in IST explicitly, so it holds
   wherever Railway runs the container.
 · Send to a member who has opted out — checked before anything else, and kept
   separate from the individual channel toggles so that turning WhatsApp back
   on cannot quietly undo a withdrawal of consent.
 · Send free text on WhatsApp. Only approved templates with variables.
 · Send to an unusable number. Malformed numbers are rejected locally rather
   than spending an API call to be told so.

MEMBERS CONTROL IT
Settings gains "How we reach you" with a switch per channel and a "Stop all
messages" link. Push and WhatsApp default on; SMS defaults OFF because it costs
per message and reads as more intrusive.

EVERY ATTEMPT IS LOGGED
A message_log table records channel, template, success and reason. Needed to
answer "did she actually get it", to notice a channel failing silently, and to
show consent was honoured.

TESTS
  npm run test:messaging   27 assertions
Regression: 161 across the four affected suites, all passing.
