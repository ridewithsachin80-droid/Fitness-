# Voice evidence robot — run requests

Changing this file on the `test` branch starts `.github/workflows/voice-evidence-robot.yml`,
which calls the REAL speech providers on fitness-test (never production). One line per run.

| Date (IST) | Why | Requested by |
|---|---|---|
| 20 Oct 2026 | First real-provider evidence for B19 (Kannada re-run of the two 19 Oct recordings) and B18 (everyday Whisper fallback), as the 2o–2q reviews asked. | Sachin, via the builder |
| 21 Oct 2026 | First controlled real-provider run after the accepted 2t corrections (reviewer, 21 Oct): Kannada re-run of the 2 approved 19 Oct recordings (B19) and the everyday Whisper fallback S1–S5 (B18). Preflight must confirm the live commit, account isolation and the tries list user_id before any change. | Sachin, via the builder |
