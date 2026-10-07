# Delivery: Phase 8, part 2 — Kannada-English voice pilot — 7 Oct 2026 (rev 2)

Built on the `main` ZIP uploaded on 6 Oct 2026. This zip holds the files
changed against that upload, so it also carries Phase 8 part 1 (Progress in
four groups). Upload to `test`, wait for green, try it on
fitness-test.up.railway.app, then merge.

## Rev 2 — Download results, for coach and admin

- **"Download results"** in the voice test panel: one CSV file, one row per
  recording: member as a code (M1, M2…, the same in every download), the line
  and its meaning, whether it was an own-words line, what Gemini heard, what
  Whisper heard, both scores, length, audio type (usually iPhone / Android),
  time. No names, no audio, no links. Opens correctly in Excel (UTF-8 mark);
  a transcript starting with = + - @ is made plain text, so a spreadsheet never
  runs it. On a phone it opens the share sheet; on a computer it downloads.
- **Coaches have the panel too,** on their home screen under Needs attention,
  folded until opened (the scores show on its header). A coach invites from
  and sees results for their own members only; admin sees everyone.
- New route `GET /api/voice-pilot/results.csv`. Changed:
  `server/services/voicePilot.js`, `server/routes/voicePilot.js`,
  `client/src/components/voicepilot/VoicePilotPanel.jsx`,
  `client/src/pages/PatientList.jsx`, the two test files. 3,465 checks green.

## What it does

**Coach (admin dashboard › Kannada voice test):** invite 5 to 10 members. See
who agreed and how many lines each recorded; per line, how often each speech
engine caught the key words; open a line to play every recording with both
transcripts side by side. Remove a member (deletes their recordings).

**Invited member (a card on Today):** first a plain page: what is recorded,
that both Google Gemini and Whisper (on Groq) turn it into text, that only the
coach hears it, deleted after 90 days, nothing added to their food log, stop
any time. Then 20 lines to read and 2 in their own words; for each: Record,
Stop (15 s at most), play it back, Again or Send; "Heard: …" after sending.
"Stop and delete my recordings" deletes everything at once. Invited again
after stopping, they agree again.

**Scoring:** each line has key words with the spellings that count ("sambar"
or "sambhar", "2" or "eradu"; numbers must match whole). Score = key words
heard. Both engines are asked separately for every recording, so one failing
never loses the other's answer.

## Please check

The 20 lines are in `server/services/voicePilot.js` (`PHRASES`). They are a
first draft of how members in Karnataka say these things; correct any Kannada
there. Keep the `id`s once members have recorded.

## Privacy

- Audio in the private R2 bucket under `voice-pilot/<member>/`; played only
  through signed links that expire after 5 minutes.
- Deleted after 90 days (daily job, 03:15 IST), on withdrawal, on removal from
  the pilot, and when the member is deleted (admin delete now includes these).
- The production security policy now allows audio from the R2 host and from
  `blob:` (the member's own take), nothing else.

## Files

New (8): `server/services/voicePilot.js`, `server/routes/voicePilot.js`,
`server/scripts/test-voice-pilot.js`, `client/src/components/voicepilot/`
(`useRecorder.js`, `VoicePilotSheet.jsx`, `VoicePilotCard.jsx`,
`VoicePilotPanel.jsx`), `DELIVERY-PHASE8b.md`.

Changed (9): `server/db/schema.sql` (tables `voice_pilot_members`,
`voice_samples`), `server/index.js`, `server/routes/admin.js`,
`server/services/cronService.js`, `server/services/securityPolicy.js`,
`server/scripts/test-local.sh`, `server/scripts/ui-tests.mjs`,
`client/src/pages/Today.jsx`, `client/src/pages/AdminDashboard.jsx`.
Plus from part 1: `client/src/pages/Progress.jsx`, `DELIVERY-PHASE8a.md`.

No file renamed or deleted. Two tables added.

## Gate

- 3,451 checks green in one full run, including real Chrome.
- New: `test-voice-pilot` 39 checks (both engines stubbed separately, real
  Postgres, the R2 stand-in), screen tests 13, the audio rule in the
  real-browser security-policy check, phone-width checks for both screens.
- 7 bugs put back one at a time; each turned a test red.

## Not tested here

Real microphones and real speech engines. Try it on an Android phone and an
iPhone first, yourself, before inviting members.
