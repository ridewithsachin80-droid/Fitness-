FitLife — AI orb in the bottom nav
==================================

Extract, drag the "client" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change.

FILES (3)
client/src/components/UI.jsx          AI orb added to PatientBottomNav
client/src/pages/DailyLog.jsx         removed the now-redundant side FAB
client/src/components/WorkoutLog.jsx  AI banner in the workout log (previous batch,
                                      included in case it is not deployed yet)

WHAT CHANGED
- A raised AI orb now sits in the centre of the bottom nav, between Progress
  and Profile, with a dark ring so it reads as an action rather than a fifth
  tab. The nav is fixed, so the orb never scrolls away when a hero panel
  pushes the page down - which was the problem.
- It works from every member page. The chat is mounted on Today, so from
  Progress/Profile/Settings the orb sets the open flag first and then
  navigates, meaning the chat is already open when Today mounts - no flash of
  the page before it appears.
- Removed the edge-docked side FAB from the Today page. Two AI buttons on one
  screen was clutter, and the orb is easier to reach with a thumb.

THE COACH SIDE IS UNCHANGED
Coaches keep their edge-docked FAB, since the admin dashboard uses tabs rather
than the member bottom nav. Say the word if you want the coach nav to match.
