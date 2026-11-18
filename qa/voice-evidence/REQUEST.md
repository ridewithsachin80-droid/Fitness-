# Voice evidence robot — run requests

Changing this file on the `test` branch starts `.github/workflows/voice-evidence-robot.yml`,
which calls the REAL speech providers on fitness-test (never production). One line per run.

| Date (IST) | Why | Requested by |
|---|---|---|
| 20 Oct 2026 | First real-provider evidence for B19 (Kannada re-run of the two 19 Oct recordings) and B18 (everyday Whisper fallback), as the 2o–2q reviews asked. | Sachin, via the builder |
| 21 Oct 2026 | First controlled real-provider run after the accepted 2t corrections (reviewer, 21 Oct): Kannada re-run of the 2 approved 19 Oct recordings (B19) and the everyday Whisper fallback S1–S5 (B18). Preflight must confirm the live commit, account isolation and the tries list user_id before any change. | Sachin, via the builder |
| 22 Oct 2026 | Controlled real-provider retest after Fixes-2u (reviewer, 21 Oct): the same 2 approved recordings (B19 re-run; an empty answer is asked again) and S1–S5 (B18). Requested after 9357b46 was confirmed live with speech_check true. | Sachin, via the builder |
| 22 Oct 2026 | Targeted S5 retest after Fixes-2v (run-2 review: S5 voice unverified). scope: S5 | Sachin, via the builder |
| 23 Oct 2026 | Targeted S5 retest, sent again: the 22 Oct request did not run (the voice workflow file was invalid; fixed). scope: S5 | Sachin, via the builder |
