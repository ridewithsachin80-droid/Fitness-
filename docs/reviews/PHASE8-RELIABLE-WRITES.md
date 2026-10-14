# Phase 8: reliable AI workout and measurement saves

Workout sessions now carry a revision. AI Save and Undo send the revision
observed during their last comparison. The server serializes all writers for
the member/date, checks the revision, and replaces the session and sets within
one transaction. A stale request returns 409 without changing the workout.
Legacy manual clients remain compatible and advance the revision on each save.

AI lab reports and body scans now send a stable random submission ID. The
member lab endpoint stores a response receipt in the same transaction as the
results. Concurrent/repeated requests with the same member, ID and normalized
payload return the original results. Reusing an ID with different results
returns 409. A rolled-back report leaves no completed receipt.

Members can retry an uncertain lab/body save without appending those results
again. The report stays locked while uncertain. Existing unconfirmed reviews
without a submission ID remain blocked rather than inventing a fresh ID for a
possibly completed legacy write. Account/date guards remain in place.

## Boundaries

- Deduplication applies to retries of one review, not separate uploads or new
  reviews. Identical values can legitimately occur in separate measurements.
- A page refresh discards the existing in-memory AI review. No health-content
  draft is newly persisted to browser storage by this change.
- Workout manual clients retain their current full-replacement semantics;
  AI stale writes and Undo now receive server-side conflict protection.
- This is not a single transaction across daily logs, workouts and labs.
  Per-destination receipts continue to describe partial outcomes accurately.

## Verification

- `test-reliable-writes`: disposable PostgreSQL and real HTTP routes, concurrent
  workout winners, stale Undo, legacy writes, rollback, member isolation,
  concurrent report replays, payload conflicts and retry after rollback.
- `test-ai-save-receipts`: real mounted React, provider loss after commit,
  stable body/report submission IDs, explicit retries and workout conflicts.
- Full regression and post-deployment browser observations are recorded in
  the regression workbook; simulated database faults are not injected into
  the deployed shared test environment.

Remaining: physical Android/iPhone acceptance, offline cold-start/reconnect,
remaining staff-modal accessibility, reminder refinement and monitored pilot.
