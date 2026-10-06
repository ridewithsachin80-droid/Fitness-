# Delivery: Phase 4 (weekly progress photos) — 5 Oct 2026

Cumulative from the `main` ZIP of 3 Oct 2026: it carries every earlier file
too (Phases 1.3–3 rev 5), unchanged since those deliveries. Upload to `test`,
wait for green, try it on fitness-test.up.railway.app, then merge.

## What it does

- **Today, Sundays only:** a "Progress photos" card until this week's three
  photos (front, side, back) are in. No notification (one message a day).
- **This week's sheet:** a tile per pose with a dotted outline of how to
  stand; Add, Retake (replaces that pose for the week), Delete. Camera or
  gallery, the member's choice. Photos taken on Monday to Saturday count for
  that week's Sunday.
- **Progress page:** first week against the latest, side by side, one pose at
  a time; any two weeks can be chosen.
- **Coach, member page › Labs tab:** the same compare, read-only.

## Privacy (Sachin, 5 Oct: member and coach see them; deleted after 12 months)

- Stored only in the private R2 bucket, under `progress/<member>/<week>/`.
  The database holds only where each file is.
- Shown only through signed links that stop working after 5 minutes.
- Visible to the member, their assigned coach, and admin. Another coach or
  member gets "not assigned" / nothing.
- Never sent to any AI model. The test suite fails if any AI call is made.
- Deleted automatically 12 months after they were taken (daily job, 03:15
  IST), file first and then the record. A member's Delete works the same way,
  and refuses rather than leave a file behind if storage is down.

## Files

New (8):

| Path | |
|---|---|
| `server/routes/progressPhotos.js` | **NEW** `/api/progress-photos/*` |
| `server/scripts/test-progress-photos.js` | **NEW** |
| `server/scripts/lib/r2-standin.js` | **NEW** test stand-in for R2 |
| `client/src/components/progress/ProgressPhotoSheet.jsx` | **NEW** |
| `client/src/components/progress/ProgressPhotoCard.jsx` | **NEW** |
| `client/src/components/progress/ProgressPhotos.jsx` | **NEW** |
| `client/src/components/progress/PoseGuide.jsx` | **NEW** |
| `DELIVERY-PHASE4.md` | **NEW** (this file) |

Changed (8): `server/db/schema.sql` (new table `progress_photos`),
`server/index.js`, `server/services/cronService.js`, `server/scripts/test-local.sh`,
`server/scripts/ui-tests.mjs`, `client/src/pages/Today.jsx`,
`client/src/pages/Progress.jsx`, `client/src/pages/Monitor.jsx`.

No file renamed or deleted. One table added.

## Gate

- 3,130 checks green in one full run: all suites on real Postgres, screen tests
  in jsdom and real Chrome at 320/360/390 px, client build, lint.
- New: `test-progress-photos` 32 checks, screen tests 17, phone-width checks
  for the sheet and the compare.
- 6 privacy and retention bugs put back one at a time; each turned a test red.

## Not done / to check on a phone

- The outline is shown on the tile, not inside the camera: the phone's own
  camera opens, and the app cannot draw on it.
- Real R2 and real phones: test on the Test site from an Android phone and an
  iPhone (camera, gallery, portrait photos from both).
- If a member's account is deleted, their rows go with it but the files stay
  in R2 until cleaned by hand. Worth a small admin job later.
