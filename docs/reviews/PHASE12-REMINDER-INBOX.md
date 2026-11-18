# Phase 12 — reliable reminder inbox

## Member experience

The existing notification bell opens a shared, scrollable Sheet with Messages and Reminders. It retains coach notes, action flags, dates, titles, reminder bodies and the existing unread badge. The Sheet provides a close control, Escape handling, background isolation and focus restoration. Long reminder text wraps at narrow widths; no additional home-screen cards are introduced.

Opening the inbox no longer marks unseen reminders read. An explicit **Mark all reminders as read** action uses the existing authenticated endpoint. The badge clears only after success; failure keeps the count and provides an error. The action marks all current unread reminders, not just the 50 displayed by the history endpoint. Viewing coach notes retains its existing read-state semantics.

The two reads settle independently. Each tab shows its own refresh error and retry; already loaded data remains visible during a refresh failure. Empty copy appears only after a successful response, never during initial loading or after a failed empty refresh. Concurrent refresh/mark actions are guarded while pending.

## Verification

The actual NotificationBell component is exercised in the existing Chromium modal regression suite, using synthetic API fixtures. Both themes at 320px with enlarged text cover: content preservation, no automatic mark-read write, long-history scrolling, failure and successful retry, badge state, modal focus/scroll restoration, errors for both data sources and confirmed empty responses. Existing full local and isolated-database CI regression remain required.

## Limits

No outgoing notification, coach message or WhatsApp message is sent by this change or its tests. Push scheduling, device permissions and account preferences are unchanged. Authenticated post-deployment interaction and physical Android/iPhone acceptance remain separate requirements; public asset/health checks do not establish them.
