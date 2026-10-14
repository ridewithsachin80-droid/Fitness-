# Phase 9: connection recovery

The installed app can reopen its cached public shell at known app routes,
including Progress and member/coach deep links. API, asset and unknown routes
are excluded. This does not grant offline access to an authenticated account:
a cold start still needs a successful server session refresh.

Offline launches show a clear connection message immediately. Reconnecting,
returning to the tab, or bringing the app back into view retries a failed
session/onboarding check. Event bursts are coalesced and active requests are
not restarted. Try again remains available while online. Failed refreshes do
not clear saved sign-in unless the server confirms 401/403. Late responses
cannot replace a newer session, and unmount cancels the refresh request.

No health drafts, credentials or account profiles are newly persisted. The
existing owner-aware daily-log queue, private API cache isolation, explicit
AI Save and review receipts are unchanged. Offline AI analysis is not added.

## Verification

- `test-connection-recovery`: mounted App, real auth/session/recovery code,
  synthetic network; offline start, online/focus/visibility recovery, event
  bursts, malformed refresh, expiry, sign-out, stale account and unmount.
- `test-private-api-cache-browser`: actual service worker in local Chromium,
  offline deep links and navigation exclusions alongside private cache tests.
- Full regression and deployed asset verification are recorded in Excel.
- Live authenticated testing remains blocked if the cloud browser cannot
  resume its credential session. Automated fixtures do not replace that check
  or physical Android/iPhone acceptance.

Remaining: complete Phase 8 report/body live cases and synthetic activity
cleanup, physical device acceptance, remaining staff modal accessibility,
reminder refinement and monitored pilot. Cold-start authenticated offline
editing is not claimed by this release.
