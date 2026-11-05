# Android emulator robot: requests

Changing this file on the **test** branch starts `.github/workflows/android-emulator-robot.yml`: a real Android 14 emulator
on GitHub's machine opens the TEST site as the robot member (read-only) in light and dark, at about 411 and 360 px wide.
Add one line per request (date and why). Results: the run's summary, and the artifacts (screenshots, recordings), kept 7 days.

- 2026-11-05: first run, asked by Sachin ("create android emulator to check in phone").
- 2026-11-05: second run after fixing touch taps and the first-tab timing.
- 2026-11-05: third run: real Android taps (keyboard), Chrome restarted for dark mode, more detail when a step fails.
- 2026-11-05: fourth run: the page position for real taps is measured with one calibration tap.
- 2026-11-05: fifth run: screen kept awake and unlocked; focus and power logged.
- 2026-11-05: sixth run: use Chrome's own tab, bring it to the front, check the address on screen.
- 2026-11-05: seventh run: log what Android's UI dump shows on the screen.
- 2026-11-05: seventh run, corrected: the previous commit (1fe4ac4) carried only this file; the diagnostic is in this one.
- 2026-11-05: eighth run: close Android/Chrome pop-ups (launcher not responding, Chrome notifications prompt) before taps and screenshots.
- 2026-11-05: ninth run: the pop-up closer presses only Android/Chrome native dialog buttons (never the web page's).
- 2026-11-05: tenth run: page position from Android's screen dump; no blind tap while a sheet is open.
- 2026-11-05: eleventh run: no Chrome restart for dark; the page's dark theme is set inside Chrome when Android's does not reach it (reported).
- 2026-11-05: twelfth run: real Android taps for the Type button and the tabs too.
- 2026-11-05: thirteenth run: diagnose why the AI composer does not open after a page reload.
