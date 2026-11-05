# Android emulator robot: requests

Changing this file on the **test** branch starts `.github/workflows/android-emulator-robot.yml`: a real Android 14 emulator
on GitHub's machine opens the TEST site as the robot member (read-only) in light and dark, at about 411 and 360 px wide.
Add one line per request (date and why). Results: the run's summary, and the artifacts (screenshots, recordings), kept 7 days.

- 2026-11-05: first run, asked by Sachin ("create android emulator to check in phone").
- 2026-11-05: second run after fixing touch taps and the first-tab timing.
- 2026-11-05: third run: real Android taps (keyboard), Chrome restarted for dark mode, more detail when a step fails.
