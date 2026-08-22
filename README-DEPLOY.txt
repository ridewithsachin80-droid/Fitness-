FitLife — lab analysis, fixed
=============================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
ONE RENAME: server/server-package.json -> package.json (in server/)
No new packages. schema.sql adds a data-cleanup migration and re-runs safely.

SUPERSEDES the previous lab-insight zip. Deploy this one.

TWO BUGS, BOTH VISIBLE IN YOUR SCREENSHOT

1. THE 502 — same fault as the PDF reader, and I should have caught it
   maxOutputTokens was 4000. Harsha's panel has six actionable markers, each
   getting three paragraphs plus meal ideas. The response was cut off mid
   object, and half a JSON object is unparseable. Raised to 12000, timeout to
   60s, with the same tolerant extraction the PDF reader now uses.

   The error also now tells you which failure it was: a truncated response
   says "too many markers to analyse in one pass", an empty one says so, and
   a safety refusal says that instead of a generic retry message. Failures log
   the finish reason and brace counts, so Railway logs will name the cause.

2. "ref NaN-100.00" ON LDL CHOLESTEROL
   Postgres NUMERIC accepts NaN as a legitimate value. A report printing a
   bound as "< 100" or "-" went through parseFloat, produced NaN, and was
   stored without complaint - then rendered as "ref NaN-100.00".

   Fixed in three places, because one was not enough:
     · on write - only finite numbers reach the column now
     · in the database - a migration clears bounds already stored as NaN and
       recomputes the affected status values
     · on display - a non-finite bound is treated as absent, so LDL now reads
       "ref < 100.00" rather than showing a broken lower bound

   Verified end to end: a row stored with a NaN bound is cleaned by the
   migration, keeps its real upper bound, and keeps its "high" status.

TESTS
  npm run test:insight    48 assertions, now including the NaN storage path
Regression: 259 across seven suites, all passing.
