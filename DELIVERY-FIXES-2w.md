# FitLife — Fixes-2w: an OCR read that fails never clears a picture (23 Oct 2026)

Test branch only. These are unchanged:
- production (`main` 1ca6ae7);
- app code (still Fixes-2u, e2fb101);
- the speech detector and its **200 ms cutoff** (kept, as decided on 23 Oct);
- the provider order, nutrient enrichment and supplement accounting.

**B18 and B19 stay open.** Earlier evidence and verdicts are kept as recorded. No speech provider was called for this correction, as the review allows.

## Decisions recorded (23 Oct 2026)
- **Keep the 200 ms speech minimum unchanged.** S5 (run 39840501549) is recorded as **valid capture; speech present; conservative refusal; verified no-save**.
  - It is a safe-refusal PASS under S5, and a known speech-detection miss for later calibration.
  - It is **not** a recognition result: no provider was called.
- **Accepted:** the dal row-order correction, and the targeted S5 safe-refusal result.
- **Before any threshold change:** compare candidate settings on the same representative recordings:
  - real phone speech in English, Hindi and Kannada;
  - short, quiet and noisy phrases;
  - silence, noise and tone controls.

  Count missed speech and accepted non-speech separately, check words and quantities for any newly admitted recording, and keep the S4 silence refusal and the generated-text guard.

## The finding (2v review)
- `ocrText` caught a per-image OCR error and returned an empty string. `safeShot` and `publicationCheck` then found "no name" in that empty string and could keep the picture.
- A successful `tesseract --version` did not prove that reading a particular picture succeeded.
- **Reviewer's reproduction:** OCR "available"; every image read fails; result "checked 1, removed 0", picture retained.

## What changed
**`server/scripts/lib/voice-evidence-shot.mjs`:**
- **`ocrRead(file)`** returns `{ ok: true, text }` only when **both** required passes (`OCR_PASSES`, psm 3 and 11) exit 0 within the time limit.
  - The limit is 60 s by default; `ROBOT_OCR_TIMEOUT_MS` changes it.
  - Otherwise it returns `{ ok: false, reason }` for: a pass that exits non-zero, times out, is killed by a signal or cannot start, and a picture file that is missing or empty.
  - Reasons never contain a person's name or the OCR output.
  - A completed read with no text is still `ok: true` (a genuine "no text").
- **`ocrText`** now **throws** when the read did not complete, instead of returning empty text.
- **`safeShot`:**
  - It takes the picture into its own temporary folder inside the holding folder, never next to its destination.
  - A failed read discards the picture: `{ taken: false, unchecked: true, reason }`.
  - The temporary folder is always deleted (`finally`), including when taking the picture throws.
- **`publicationCheck(dir, names, { quarantine })`:**
  - It checks every picture in the upload folder **and in the holding folder**.
  - A picture is **cleared only by a completed read with no name**. A cleared held picture is then moved into the upload folder.
  - Everything else is deleted:
    - kind `identifying`: OCR read a name → the run is FAILED;
    - kind `unchecked`: no name list, no OCR, or a read that did not complete → INCOMPLETE.
  - The result now reports `cleared` and `complete`.
  - It writes **`cleared-pictures.sha256`** (the SHA-256 of every cleared picture) into the upload folder and empties the holding folder.

**`server/scripts/robot-voice-evidence.mjs`:**
- **Every picture** (case pictures, error pictures and the optional admin card) is written to a **holding folder in the system temp directory, outside `qa/voice-evidence-results`**. Only the publication check moves a picture into the upload folder.
  - So a crash, a block or a kill leaves no unchecked picture where the workflow uploads from.
  - The holding folder is deleted on exit.
- Pictures or a cleared list left in the output folder by an earlier local run are removed at start.
- The report:
  - counts the pictures cleared by a completed OCR read;
  - labels removals "not checked: …";
  - says when pictures were taken before a stop and never published.

- **`ROBOT_SCOPE=all`** asks for a full run whatever the last `REQUEST.md` row says.
  - Found while testing 2w: the repo's last request row is the 2v `scope: S5` request. The simulation's robot read it, so scenario A ran as an S5-only run and its full-run checks failed.
  - The simulation now passes `ROBOT_SCOPE=all` unless a scenario asks for a targeted run (K, L1, M).
  - Real runs are unaffected: a new request row without `scope:` is still a full run.

**`server/scripts/lib/voice-evidence.mjs` (`verdict`):**
- Removals are judged by their `kind`. Entries without a `kind` keep the 2v reading of the reason.
- A check reporting `complete: false` is INCOMPLETE.

**`.github/workflows/voice-evidence-robot.yml`:**
- A new step, **"Remove every picture the publication check did not clear"**, runs `if: always()` immediately before the artifact upload.
- It deletes every PNG in the upload folder whose SHA-256 is not on `cleared-pictures.sha256`. With no list (for example, the robot stopped early), every picture is deleted.

## Tests
**`test-voice-evidence-robot.mjs` (in the gate): 206/206** (172 in 2v; **34 new in [15]; none changed or removed**).
- They use stand-in OCR programs that answer `--version`, so OCR always looks available.
- Every image read failing (the reviewer's reproduction) → failed read; `ocrText` throws. The publication check gives "removed 1", the picture is not kept and is not on the cleared list, and the run is INCOMPLETE.
- Only the psm 11 pass failing; a read timing out (stopped at 0.4 s); OCR killed by a signal; a missing or empty picture: each a failed read, the picture removed as unchecked.
- `safeShot` on a stand-in page: a failed read, a failed pass, a timeout, or an error while taking the picture each leaves no picture and no temporary file.
- The holding folder:
  - a clean picture is moved in and listed by SHA-256;
  - a picture with a name is deleted;
  - with failing OCR nothing reaches the upload folder;
  - a robot that stops before the check leaves nothing in the upload folder.
- The workflow guard step, extracted from the YAML and run with bash:
  - it is `always()` and immediately before the upload;
  - it keeps only listed pictures, including in subfolders, and leaves text files;
  - with no list it deletes every picture;
  - with no folder it succeeds quietly.
- Controls kept and passing: a completed clean read (cleared); a completed read with no text (cleared); a name hit (FAILED); missing OCR; no name list.

**`test-voice-evidence-shot.mjs` (on demand: real browser and tesseract):**
- 9 earlier checks kept unchanged, plus 7 new.
- **[F]** On the real voice-test card, OCR that is "available" (the real `--version`) but whose reads fail, time out, or whose psm 11 pass fails while the real psm 3 pass works: no picture, nothing left in the holding folder.
- **[G]** The publication check on a genuinely clean picture with those failing programs: not published; with the real OCR: moved in and listed.
- The late-render controls (A, B, B2) are kept.

**`test-voice-evidence-sim.mjs` (on demand; real robot, browser, server and Postgres; canned providers):** new scenario M.
- **M1:** the robot runs with an OCR that cannot read images. No picture is published, every picture is removed as "not checked", and the run is INCOMPLETE.
- **M2:** the robot is killed with SIGKILL right after its first picture. The picture is in the holding folder, and the upload folder has no picture and no cleared list.

No existing assertion was changed or removed in any file.

## NEW files
- `DELIVERY-FIXES-2w.md`

Changed:
- `server/scripts/lib/voice-evidence-shot.mjs`
- `server/scripts/lib/voice-evidence.mjs`
- `server/scripts/robot-voice-evidence.mjs`
- `server/scripts/test-voice-evidence-robot.mjs`
- `server/scripts/test-voice-evidence-shot.mjs`
- `server/scripts/test-voice-evidence-sim.mjs`
- `.github/workflows/voice-evidence-robot.yml`

`qa/voice-evidence/REQUEST.md` is **not** changed, so this push does not start a real voice run.

## Results (all mocked or simulated; no real provider)
| Check | Result |
|---|---|
| `test-voice-evidence-robot.mjs` (gate) | **206/206** (172 + 34 new) |
| Full local gate (real Postgres 16, schema.sql on an empty database) | **all suites pass, 6,531 assertions** (2v: 6,497) |
| `test-voice-evidence-shot.mjs` (real browser + tesseract) | **16/16** (9 kept + 7 new) |
| `test-voice-evidence-sim.mjs` A–M (one clean run, nothing else running) | **63/63** |
| Mutations of the library, verdict and workflow (on a separate copy of the code; the baseline passed 206/206 on that copy first) | **14/14 caught**, each by the check written for it |
| Robot mutation: pictures written straight into the upload folder (the 2v behaviour) | **caught** by simulation M2 (two unchecked pictures found in the upload folder) |

**A first mutation attempt is discounted:** the copied code lacked `server/services`, so its baseline already failed and every mutation looked "caught". The script now refuses to report unless the baseline passes on the copy.
