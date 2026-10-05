# Delivery: Phase 3 (plate photo vs plan) + offline merge — 5 Oct 2026 (rev 2)

Cumulative from the `main` ZIP of 3 Oct 2026: it carries every earlier file too
(Phase 1.3, Phase 2, safety/food, imports/CSP), unchanged since those were
deployed. Upload to `test`, wait for green, try it on fitness-test.up.railway.app,
then merge.

## Rev 2 — fixes from the first live test on the Test site (5 Oct)

- **Coach card showed a broken photo.** The production security policy allowed
  images only from the site itself, so the R2 link was blocked inside the card
  (opening it in its own tab worked). Images are now also allowed from
  `https://*.r2.cloudflarestorage.com` and `blob:` (the member's own preview).
  Scripts are unchanged: the site's own files only. New file
  `server/services/securityPolicy.js`; the browser check uses the same file.
- **A plate of ragi mudde, palak dal, salad and paneer was logged as
  "Breakfast with extras"** when Breakfast was idli. The "different meal" rule
  needed a meal of two or more items; it now applies to any meal. The prompt
  now asks for every bowl and names Karnataka foods (ragi mudde, not ragi roti).
- **Coach chat: attaching a file sent it at once**, and a long PDF timed out in
  the app after 35 s ("I couldn't read that file just now") while the server
  was still reading it. Now attaching shows the file above the box; type a note
  ("for Raghavendra, weekdays only") or just press send. The note goes to the
  model with the file. The app waits up to 170 s for a document, 110 s for a
  plate photo.

## Phase 3: plate photo checked against the plan (as approved on the canvas)

- **Member, Today › Next up:** "Snap your plate" opens the camera. The sheet shows
  the photo, then each planned item as planned / less / more / not in the photo
  ("did you have it?"), and anything else as an extra. Grams can be changed
  before logging. Logged through the normal food log (offline queue included).
- **Plate is a different meal:** log as an extra snack, log as this meal instead
  of the plan, or retake.
- **Coach home › Needs attention:** new "Off plan today · N" tab. A meal reaches
  it only when its extras add up to MORE than 100 kcal, or a different meal was
  eaten instead. Less or skipped items show on the card but never flag a meal.
  Message (WhatsApp draft) and Seen on each card. No push notifications.
- **Photos:** private R2 bucket, shown through links that expire after 5
  minutes, deleted after 90 days (daily job, 03:15 IST).
- **Admin dashboard:** "Photo storage · Check now" uploads, reads back and
  deletes a test file, and says which step failed if one does.
- **No new packages.** R2 requests are signed in `server/services/storage.js`;
  the signatures were checked against Amazon's official SDK and match exactly.

## Offline sync: merge food, keep the newer value for the rest

When a day logged offline reaches the server after the day changed elsewhere:
food from both sides is kept (deleted offline stays deleted); weight, water,
ticks, sleep and notes keep the newer value, and the member sees one line naming
what was not saved. Only replays from the offline queue are merged; ordinary
saves are written exactly as before. A coach entering a member's weight now
also counts as a newer edit.

## Files

New (12):

| Path | |
|---|---|
| `server/services/storage.js` | **NEW** R2 storage, signed requests |
| `server/services/platePhoto.js` | **NEW** plate rules (statuses, flagging) |
| `server/services/dayMerge.js` | **NEW** offline merge rules |
| `server/services/securityPolicy.js` | **NEW** production security policy (rev 2) |
| `server/routes/platePhotos.js` | **NEW** `/api/plate/*` |
| `server/scripts/test-plate-photo.js` | **NEW** |
| `server/scripts/test-day-merge.js` | **NEW** |
| `client/src/components/sheets/PlatePhotoSheet.jsx` | **NEW** |
| `client/src/components/coach/OffPlanFeed.jsx` | **NEW** |
| `client/src/components/admin/StorageCheck.jsx` | **NEW** |
| `client/src/utils/downscaleImage.js` | **NEW** |
| `DELIVERY-PHASE3.md` | **NEW** (this file) |

Changed (18): `client/src/components/CoachAIChat.jsx`, `server/routes/aiChat.js`, `server/db/schema.sql` (new table `meal_photos`), `server/index.js`,
`server/routes/logs.js`, `server/routes/patients.js`, `server/services/cronService.js`,
`server/scripts/test-local.sh`, `server/scripts/ui-tests.mjs`,
`client/src/components/PendingSync.jsx`, `client/src/components/coach/TriageFeed.jsx`,
`client/src/components/today/NextUp.jsx`, `client/src/hooks/useOfflineQueue.js`,
`client/src/hooks/useTodayModel.js`, `client/src/pages/AdminDashboard.jsx`,
`client/src/pages/Today.jsx`, `client/src/store/logStore.js`,
`client/src/utils/offlineQueueCore.js`.

No file renamed or deleted. One table added (`meal_photos`), nothing renamed.

## Gate

- 3,054 checks green in one full gate run: all suites on real Postgres, screen
  tests in jsdom and real Chrome at 320/360/390 px (496), client build, lint.
- New: `test-plate-photo` 57, `test-day-merge` 24, screen tests +28, phone-width
  checks for the plate sheet (with a real canvas downscale) and the coach tab.
- 12 bugs put back one at a time; each turned a test red.
- The old "Escape closes the sheet @390px" check waited a fixed 600 ms and
  failed three times on a busy machine; it now waits up to 3 s for the sheet to
  close. A sheet that never closes still fails.

## Not tested here

Real Cloudflare R2: this machine cannot reach it. The R2 stand-in in the tests
rejects any request whose signature does not verify, and the signing matches
Amazon's own code, but the first real upload is on the Test site. Use the
admin "Check now" button first.
