FitLife — Sprint 1 complete
===========================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
ONE RENAME: server/server-package.json -> package.json (in server/)
No new packages. schema.sql re-runs safely.

═══ THE BIG ONE: schema.sql was building databases with missing columns ═══

Found while running the full suite against a database created from empty.

ALTER TABLE workout_sessions ADD COLUMN cardio sat at line 217. CREATE TABLE
workout_sessions sat at line 473. On a fresh database the ALTER ran 256 lines
before the table existed — and Postgres reported NOTHING, because "ADD COLUMN
IF NOT EXISTS" against a missing table quietly does nothing.

So schema.sql claimed success while the cardio column was simply absent, and
every workout save failed at runtime with "column cardio does not exist".

Six columns were affected: workout cardio, monitor_notes from_member /
reply_to / delivered_via, lab_values entered_role, and the notification
preference flags.

Your production database is fine — those columns were added by earlier runs
when the tables already existed. This only bit a from-scratch build. But it
would have bitten hard on any new environment: a staging deploy, a restored
backup, or a second Railway instance.

All migrations now sit in one block at the end of the file, after every
CREATE TABLE, with a note explaining why. There is a check verifying no ALTER
precedes its own table.

═══ SPRINT 1 ITEMS ═══

1 · OFFLINE LOGGING — the queue existed but had a hole
   My roadmap audit said there was no offline queue. That was wrong; it lives
   in hooks/useOfflineQueue.js, not the service worker, and it is wired up.

   The real flaw was its guard: if (navigator.onLine) post; else queue.
   navigator.onLine only reports whether an interface is up. It says true on
   hotel WiFi before the captive portal, on one bar with nothing getting
   through, and while the server is down — and in each case the POST threw and
   the log was LOST, because the queue was in the branch that never ran.

   A gym basement with one bar is exactly that case.

   Now: the request is attempted first, and a network error, timeout or 5xx
   queues it. A 4xx does not — a rejected payload stays rejected however often
   it is resent, and queueing it would retry forever while hiding a real bug.
   401 and 403 also pass through, because the member needs to log in again,
   not have their entry silently parked.

   Sync now also polls every 60 seconds. The 'online' event only fires when
   the interface changes state, so a flaky connection that starts working
   again never triggers it.

2 · FOOD REVIEW QUEUE
   Admin -> Foods -> "Needs review". Unverified AI foods ordered by how many
   members actually eat them, with the member and log counts shown, and a
   one-tap Verify. Verifying the food forty members eat is worth far more than
   the one logged once.

3 · MEMBER REPLIES
   A Reply button on every coach message. Replies thread to the note they
   answer, route to the coach who wrote it, mark the original read, and push a
   notification to the coach.

   A security bug was caught in testing: a member could set reply_to to a note
   belonging to a DIFFERENT member, threading their reply into a stranger's
   conversation. reply_to is now validated against that member's own notes and
   discarded otherwise. The same fix removes a 500 when replying to a note id
   that does not exist.

4 · CONFIGURATION HEALTH
   GET /api/admin/health reports which integrations are configured — push,
   AI text, AI vision, SMS, WhatsApp — and names the missing variables. This
   is how you confirm VAPID is set. Booleans and variable NAMES only, never a
   key or any fragment of one; there is a test asserting no long token-like
   string appears in the response.

═══ TESTS ═══
  npm run test:sprint1    36 assertions
FULL SUITE: 499 assertions across 17 suites, all passing on a database built
from empty. Nutrition validator 0 errors. Lint clean. Build clean.
