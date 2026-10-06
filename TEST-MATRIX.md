# TEST MATRIX — FitLife audit, 6 Oct 2026

Status: PASS / FAIL / BLOCKED / NOT TESTED.
Evidence: `audit[X]` = block X of `server/scripts/test-audit.js` (real server, real Postgres). Suite names are files in `server/scripts/`. "probe" = one-off run during the audit, now covered by the cited block. (mock) = AI or storage stubbed. (static) = code reading only.
"Before" is the result on the uploaded code where it differed.

| Role | Feature | Scenario | Expected result | Actual result | Status | Evidence |
|---|---|---|---|---|---|---|
| Member | PIN login | Correct PIN | Tokens issued | As expected | PASS | audit[K], test-session |
| Member | PIN login | Paused account | 403, told to contact coach | As expected | PASS | test-session |
| Any | Login rate limit | 11 wrong passwords from one address; then another address | First address limited; second not | As expected. Before: one shared bucket (static) | PASS | audit[M] |
| Member | Session | Refresh with a token issued before this deploy | Still works | As expected | PASS | audit[K] |
| Member | Change PIN | Change on phone A while signed in on phone B | A stays in, B signed out | As expected. Before: B stayed in | PASS | audit[K] |
| Coach | Reset member PIN | Reset while member is signed in | Member signed out everywhere | As expected. Before: stayed in | PASS | audit[K] |
| Admin | Reset member PIN | Same, from admin | Signed out everywhere | As expected | PASS | audit[K] |
| Coach | Change password | Change while signed in elsewhere | This session kept, others ended | As expected | PASS | audit[K] |
| Member | Sign out | Profile → Sign out → reopen | PIN asked | Fixed by code change; server clears both cookies | PASS (server) / NOT TESTED (browser) | audit[O] (static) |
| Anonymous | All member/coach/admin routes | ~75 routes with no token | 401 | 401 on all except `/foods/ai-test` before the fix | PASS | probe, audit[C] |
| Member | Other member's data | Pass another member's id in query/params | Own data only or 403 | As expected | PASS | probe |
| Coach | Other coach's member | ~70 member-scoped routes with an unassigned member id | 403/404 | As expected, except two reminder routes before the fix | PASS | probe, audit[J] |
| Coach | Reminder devices/schedules | List another coach's member | 403 / not listed | As expected. Before: listed | PASS | audit[J] |
| Anonymous | Live updates | Connect a socket, ask for a coach's room | Receives nothing | As expected. Before: received weight | PASS | audit[B] |
| Coach | Live updates | Another coach asks for this coach's room | Receives nothing | As expected | PASS | audit[B] |
| Coach | Live updates | Own member saves | Update arrives, no join needed | As expected | PASS | audit[B] |
| Coach | Live updates | Phone on previous app bundle (cookie only) | Update arrives | As expected | PASS | audit[B] |
| Coach | Live updates | Reconnect after a network drop, in a browser | Updates resume | Server joins on connect; browser not exercised | NOT TESTED | (static) |
| Anonymous | AI diagnostic | `GET /foods/ai-test` | 401, no AI call | As expected. Before: 200 with key prefixes | PASS | audit[C] (mock) |
| Member | Daily log | Save weight, food, water, ticks, sleep, notes; reload | Saved and returned | As expected | PASS | test-journey, audit[D] |
| Member | Daily log | Future date / impossible date / year 0001 | 400 | As expected. Before: year 0001 accepted | PASS | audit[E] |
| Member | Daily log | `food_items` as text, ticks as text, 400 items | 400, nothing stored | As expected. Before: stored, admin 500 | PASS | audit[E] |
| Admin | Dashboard | Overview and stats with a malformed row already stored | 200 | As expected. Before: 500 | PASS | audit[E] |
| Member | Daily log | App out of date; coach corrected weight meanwhile; member ticks an item | Weight kept, tick saved | As expected. Before: weight lost | PASS | audit[D] |
| Member | Daily log | Same, with food added elsewhere, an item deleted, an item edited, water added both sides | All merged correctly | As expected. Before: other-side food lost | PASS | audit[D] |
| Member | Daily log | Up-to-date app saves | Written exactly as sent | As expected | PASS | audit[D] |
| Member | Daily log | Phone on previous bundle saves | Written as sent (old behaviour) | As expected | PASS | audit[D] |
| Member | Offline queue | Offline copy replayed after newer edits | Food merged, server keeps the rest | As expected (unchanged rule) | PASS | audit[D], test-day-merge, test-offline-queue |
| Member | Daily log | Tick made while a save is in flight | Tick kept | As expected on the real client logic | PASS (logic) / NOT TESTED (browser) | audit[N] |
| Member | Daily log | Save answer arrives after switching day | Does not land in the other day | As expected on the real client logic | PASS (logic) | audit[N] |
| Member | Voice log | Same sentence twice at once / retried within 45 s | Logged once, same reply | As expected. Before: logged twice | PASS | audit[I] (mock) |
| Member | Voice log | Two different sentences at once | Both kept | As expected. Before: one lost | PASS | audit[I] (mock) |
| Member | Voice log | Same sentence two minutes later | Logged again | As expected | PASS | audit[I] (mock) |
| Member | AI chat | Parse a food message, corrections, questions | Structured result, no duplicates | As expected | PASS | test-aichat, test-member-questions, test-member-apply (mock) |
| Member | AI chat | Real provider timeout / malformed output | Usable recovery | — | BLOCKED | no credentials |
| Member | Message coach | Reply sent twice at once | One message | As expected. Before: two | PASS | audit[H] |
| Coach | Notes | Save a note | 201, unread for member | As expected. Before: 500 every time | PASS | audit[A] |
| Coach | Notes | Save a copy of a WhatsApp message | 201, already read | As expected. Before: 500 | PASS | audit[A] |
| Coach | Notes | Double tap | One note | As expected | PASS | audit[H] |
| Coach | Labs | Same value twice at once; then a different value | One row; then a second row | As expected. Before: two rows | PASS | audit[H] |
| Coach | Weight correction | Log weight for a member | Saved, survives member's later save | As expected | PASS | audit[D] |
| Coach | Programs, diet plans, swaps, plate feed, weekly brief, triage, gaps, nudges | Happy path as assigned coach | 2xx, no 5xx | As expected | PASS | probe (154 calls), test-diet-*, test-swaps, test-weekly, test-coach-* |
| Coach | Diet plan draft | Real AI generates a plan | Valid plan | — | BLOCKED | no credentials; stubbed in test-diet-studio |
| Member | Plate photo | Check and confirm against plan | Logged, extras flagged | As expected | PASS | test-plate-photo (mock) |
| Member | Progress photos | Upload, replace, delete, coach view | Private, per member | As expected | PASS | test-progress-photos (mock storage) |
| Any | Photos | Real R2 upload/delete/signed link | Works | — | BLOCKED | no credentials |
| Admin | Enable/disable | Double tap Disable | Stays disabled | As expected. Before: re-enabled | PASS | audit[F] |
| Admin | Enable/disable | Members route with the admin's or a coach's id | Refused | As expected. Before: admin disabled | PASS | audit[F] |
| Admin | Enable/disable | Disable own account | 400 | As expected | PASS | audit[F] |
| Admin | Enable/disable | Unknown id | 404 | As expected. Before: 500 | PASS | audit[F] |
| Admin | Assign coach | Two assigns at once | One active coach | As expected. Before: two | PASS | audit[G] |
| Admin | Create member | Same phone twice at once | One created, one 409 | As expected | PASS | probe |
| Admin | Delete member | Member has photos; storage down / not configured | Nothing deleted, reason given | As expected | PASS | audit[L] (mock storage) |
| Admin | Delete member | Storage up | Photos removed, then member | As expected. Before: photos left behind | PASS | audit[L] (mock storage) |
| Admin | Delete member | Wrong typed name | 400 | As expected | PASS | audit[L] |
| All | Client build | `npm run build` | Succeeds | Succeeds | PASS | build log |
| All | Lint | Undefined identifiers | None | None | PASS | lint-undef |
| All | UI suite | jsdom mount + real Chrome layout at 320/360/390 px | All pass | PASS | PASS | ui-tests |
| All | Schema | `schema.sql` on an empty database | Loads | 39 tables | PASS | gate |
| All | Dependencies | `npm audit --omit=dev` | No known advisories | 0 (server was 9) | PASS | npm audit |
| Member | PWA | Install, update, offline, reconnect on a real phone | Works | — | NOT TESTED | needs devices |
| Member | Trackers | OAuth connect and sync | Works | — | NOT TESTED | needs provider accounts |
| Any | Messaging | WhatsApp Business / SMS / push delivery | Delivered | — | BLOCKED | no credentials; must not send |
| Any | Performance | Large roster, long history | Acceptable | — | NOT TESTED | — |
| Any | AI safety | Prompt injection through member text | No unauthorised action | — | NOT TESTED | aiChat.js internals not reviewed |
