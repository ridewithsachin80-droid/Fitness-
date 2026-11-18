# Phase 2 — voice language and draft recovery

Baseline: `d7a2826b0ffc62cae8ea58c0a475b49331f6db24` on `test`.
GitHub run 57 passed all 71 registered suites and 4,174 assertions, including
the database and browser suites. This baseline result does not certify the
subsequent Phase 2 changes.

## Member experience

- Keep Today minimal: Speak, Snap and Type remain the direct entry points.
- English, Hindi and Kannada share one speech preference. Changing it affects
  the next recording; it does not interrupt an active take.
- Failed AI text and photo requests retain a request-specific Retry action.
  Text can be corrected at the failed request without overwriting a newer draft.
- A failed voice transcription can retry the same recording while the capture
  session remains open. Discarding or closing capture releases the recording.
- Every successful interpretation still becomes an editable review. Food
  quantities, household measures, macros and meal slots remain editable before
  saving. No retry saves a food, workout or health measurement by itself.
- Keep all existing tools, coach/admin routes, weight, manual entry, presets,
  portion memory, source labels, workout tools, offline queue and account guards.
- Use the existing light/dark visual system. Put recovery controls where the
  failure happened, without adding Home cards or navigation tabs.

## Reliability requirements

1. Retry is tied to the original account, session and log date.
2. Closing or resetting a session invalidates late transcription responses.
3. Repeated taps do not send duplicate analysis requests or create duplicate reviews.
4. A failed request never erases text typed while it was in progress.
5. Raw retry audio and photos stay in memory. They are not put in local storage,
   analytics, the offline log queue or voice-pilot research storage.
6. Voice-pilot consent and research recording remain separate from ordinary logs.
7. Member-facing errors explain the next action without provider or API-key details.
8. Permission denial, unsupported capture and a lost connection leave typing available.

## Verification and delivery

Run new component/hook/route regression fixtures plus every available existing
suite after the build. Check new controls at narrow phone widths, enlarged text,
and both themes. Record baseline CI, local results and deployed acceptance in
separate columns in the Excel workbook.

Physical microphone/camera behavior and Kannada transcription quality require
test-account device acceptance. Synthetic recognition and provider fixtures do
not establish language accuracy or deployment success.

Deliver changed files only, in repository folder structure. The target remains
`https://fitness-test.up.railway.app/`. Require a new green GitHub gate before
deploying this revision. Live member/coach tests remain separate from anonymous
health and asset checks.
