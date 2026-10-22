# FitLife — Fixes-2v: the run-2 review's three corrections (22 Oct 2026)

Test branch only. Production (`main` 1ca6ae7) is unchanged, as are the provider order, nutrient enrichment and supplement accounting.
**B18 and B19 stay open.** The S1/S3/S4 results the reviewer accepted, and both runs' recorded verdicts (run 1 FAILED, run 2 COMPLETE), are kept as recorded.
**App code is unchanged in 2v;** only the evidence robot, its tests and the voice workflow changed.

## Containment (done first, 22 Oct 16:28 UTC)
- **The public run-2 artifact `voice-evidence` (id 12423046961, run 39763450007) was deleted.** GitHub then listed 0 artifacts for that run and for run 39560221828 (run 1).
- **The only other voice-evidence artifact** (run 39441527819, 20 Oct, 313 bytes) is the "logins missing, nothing tested" report written before any sign-in. It holds no names and is left as is.
- **The reviewer holds the downloaded original privately.** The builder could not download it; GitHub serves artifact files from storage the builder's workspace cannot reach.

## Finding 1 — the admin screenshot showed member names (P1)
**Cause, reproduced:**
- The 2u robot replaced names in the page once, the moment the voice-test card appeared. It then checked the page text, not the picture.
- The card's invite list comes from a second request (`/api/voice-pilot/members`) and was drawn after that replacement, so the real names were in the picture.
- The new browser test rebuilds exactly this (the member list held back 3 s): the 2u method lets the names into the picture, and OCR reads them.

**Now** (`server/scripts/lib/voice-evidence-shot.mjs`, NEW):
- **The admin card picture is left out of the public evidence by default.** The B19 data is in the report and the workbook. `ROBOT_ADMIN_SHOT=1` asks for it.
- **When it is asked for, the robot:**
  1. waits until the network is quiet and the card has stopped changing;
  2. masks every name area (invite list, opened recording rows, the member picker) with a style rule that survives re-renders;
  3. keeps a watcher re-replacing names on every page change;
  4. takes the picture, then **reads the finished picture with OCR** (tesseract). Any name, or any 4+ letter word of a name, discards it.
  - No name list or no OCR → no picture. Reasons never contain a name.
- **A final publication check reads every file before the artifact is uploaded:**
  - every picture by OCR; removed if it holds a name, or if it cannot be checked;
  - the workbook; removed if it holds a name;
  - report and results; redacted for whole names and first/last names.
- **A picture removed for holding a name makes the run FAILED** (a removal is not a pass). One left out because it could not be checked makes it INCOMPLETE.
- **The voice workflow now installs `tesseract-ocr`.**

## Finding 2 — S5's capture could be satisfied by the background alone (P2)
- **The reviewer's counterexample, reproduced:** the exact background (`anoisesrc=color=pink:amplitude=0.5:duration=12:seed=7`), with no voice, matched the noisy S5 source at r = 0.998 and was called valid.
- **The new voice check (`voiceComponentCheck`):**
  - The robot now keeps S5's voice and noise as separate tracks.
  - It compares the upload with the source only where the **voice** dominates: time-frequency points where the voice alone is at least 6 dB above the noise alone.
  - The upload must carry the voice's extra energy there: score ≥ 0.7, where ≈ 1 means the voice is there and ≈ 0 means only the noise.
- **Results:**

| Sound captured | Voice check | Capture |
|---|---|---|
| The reviewer's counterexample (background alone) | 0.00 | INVALID |
| The background after Opus compression | about 0.2 | INVALID |
| The real mix after Opus | about 1.04 | valid |

- **The 0.12 recipe of runs 1 and 2 is too buried for any recording to prove its voice:** only 156 voice-dominated points, against 500 needed. Every capture of it is now INVALID ("not verifiable").
  - So **S5's intended noisy-speech input in runs 1 and 2 is unverified.** Its observed refusal and verified no-save stand.
- **S5 recipe v2:** voice 0.45 under the same noise (about 1,380 voice-dominated points). A recording of it can be verified.
  - At this level the server's speech check still just refuses (180 ms voiced, 200 needed), which S5 allows. That is a B18 observation, not changed here.
- **A targeted run repeats only S5** (`scope: S5` in the request line), as the review allows. The Kannada re-run and the real recordings are not repeated.

## Finding 3 — the dal portion rule depended on row order (P2)
- **The reviewer's reproduction:** expect "1 katori dal"; preview "1 bowl dal" at 200 g; saved portions "bowl dal = 200 g" and "katori dal = 150 g".
  - Before: PASS in one row order, FAIL in the other.
  - Now: **FAIL in both orders** (the two learned sizes conflict).
- **How amounts are resolved now:**
  - The spoken container (katori) and the shown one (bowl) are resolved separately from **all** matching rows.
  - The alias holds only when the two applicable amounts are equal: the member's own, or the 150 g default where none is learned.
- **Results:**

| Situation | Result |
|---|---|
| Two different learned sizes | FAIL |
| A learned bowl with no learned katori | UNVERIFIED (a bowl does not define their katori) |
| Two different values for the same container | UNVERIFIED |
| Equal learned sizes | PASS at that size |

- **Run 2's S3 is not affected:** the account had no saved portions, and the preview kept "katori".

## Changed tests (and why)
**`test-voice-evidence-robot.mjs`:**
- **[10] "the member's own bowl dal = 200 g → PASS"** is now **UNVERIFIED**. The review asked for this: a learned bowl alone no longer defines a katori.
- **[10] "the noisy S5 sound captured as played → valid"** is now **INVALID ("cannot be verified")** when no voice/noise tracks are given. The loudness pattern alone cannot show the voice (finding 2).

**`test-voice-evidence-sim.mjs`:**
- **Scenario A, S5:** valid only by the voice check; refused or previewed (S5 recipe v2), never saved.
- **Scenario A, admin picture:** now left out by default, and every picture passed the OCR publication check.
- **The seeded names** "Pilot Member", "Other Tester" and "Sim Admin" became realistic names. Their common words ("member", "other") appear in ordinary app text, so the stricter name-word check would rightly refuse every picture.

No other existing assertion was changed or removed.

## NEW files
- `server/scripts/lib/voice-evidence-shot.mjs`
- `server/scripts/test-voice-evidence-shot.mjs` (on demand: browser + OCR)
- `DELIVERY-FIXES-2v.md`

Changed: `.github/workflows/voice-evidence-robot.yml` (adds `tesseract-ocr`).
