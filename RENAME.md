# Terminology: member / coach

FitLife says **member** (not patient) and **coach** (not monitor). This was done
as a UI + API rename. The database was deliberately left alone.

## What changed

| Layer | Before | After |
|---|---|---|
| UI copy | "Patients", "Patient not assigned to you" | "Members", "Member not assigned to you" |
| Client route | `/monitor/:patientId` | `/coach/:memberId` |
| Client identifiers | `patientId`, `patients`, `PatientList` | `memberId`, `members`, `MemberList` |
| API path | `/api/patients` | `/api/members` |
| Admin API | `/api/admin/monitors` | `/api/admin/coaches` |
| Admin stats key | `stats.monitors` | `stats.coaches` |

## What deliberately did NOT change

These are database values and wire contracts. Renaming them requires a migration
and a coordinated deploy, so they were left as-is:

- `users.role` still stores `'patient'` and `'monitor'`, enforced by a CHECK
  constraint in `schema.sql`. The client references these through
  `ROLE_MEMBER` / `ROLE_COACH` in `client/src/constants.js` so the intent is
  explicit rather than looking like a missed rename.
- FK columns: `patient_id`, `monitor_id` across `daily_logs`, `lab_values`,
  `monitor_notes`, `member_portions`, `macro_trials` and others, plus every
  index and UNIQUE constraint built on them.
- Table name `monitor_notes`.
- JSON field names `patient_id`, `monitor_id`, `monitor_name`.
- Socket rooms `monitor_${coachId}` and the `join_monitor_room` event.

## Legacy aliases — do not remove yet

FitLife is a PWA. After a deploy, a member whose service worker has not updated
is still running the previous bundle and will keep calling the old paths until
it refreshes. These aliases exist so that does not 404:

- `app.use('/api/patients', memberRoutes)` in `server/index.js`
- `/monitors` and `/monitors/:id/toggle` in `server/routes/admin.js`
- `stats.monitors` emitted alongside `stats.coaches`
- `/monitor` and `/monitor/:memberId` redirect routes in `client/src/App.jsx`
  (these also cover coaches' bookmarks and links pasted into old notes)

`server/scripts/test-rename-contracts.js` fails if any of these disappear.
Remove them only once analytics show no traffic on the old paths — a good rule
is two weeks after the rollout.

## Files that kept their old names

`client/src/pages/Monitor.jsx`, `client/src/pages/PatientList.jsx` and
`server/routes/patients.js` still have their original filenames, even though
the components inside are now `Coach` and `MemberList`.

This is intentional. Deployment is drag-and-drop onto GitHub, which adds files
but does not delete them — a renamed file would leave the original in place,
producing two components and a broken import. Renaming these is a separate,
explicit commit that deletes the old paths.

## If layer 3 (the DB migration) is ever done

Do it alone, in its own release, with nothing else in it:

1. `ALTER TABLE ... RENAME COLUMN patient_id TO member_id` on every table
2. Drop and recreate every index and UNIQUE constraint referencing it
3. `ALTER TABLE users DROP CONSTRAINT ...` then re-add with
   `CHECK (role IN ('member','coach','admin'))`
4. `UPDATE users SET role='member' WHERE role='patient'` (and monitor→coach)
5. Update `ROLE_MEMBER` / `ROLE_COACH` in `client/src/constants.js`
6. Update every SQL string in `server/routes/` and `server/services/`

Steps 3 and 4 must run inside one transaction, or the CHECK constraint will
reject the rows mid-update.
