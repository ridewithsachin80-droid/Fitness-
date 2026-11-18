# FitLife — Fixes-3h: the 3g safeguards tightened (2 Nov 2026)

**Scope:** test branch only. Based on **c5985f8**. It answers the reviewer's Fixes-3g review (2 Nov). The missing-panel fix was accepted as supported by the live bundle and the signed-in report; two follow-ups in its safeguards remained, plus one verification note.

**Unchanged:** production (`main` 1ca6ae7); the calibration kit's server code, scripts and hashes (kn `02dc7a808038…`, hi `21ef021a6c57…`, en `9bd51a13bb06…`); every wording record (no confirmation made on anyone's behalf); the live speech check, detector settings, provider order, nutrients and supplement accounting. Collection, invitations for collection and real-provider batches stay closed. **B18/B19, Scenario G (3u), B20 and the 61/63 simulation anomaly (3z-b) stay open.** This is not a production release and asks for none.

| # | The review found | Fixed by | Counterexample → now (positive controls) |
|---|---|---|---|
| 1 | `check-built-client` compared only the entry and admin file **names**: a missing or corrupted admin file, a missing chunk or stale HTML/CSS passed | It now compares **every file of the fresh build** with the same path in git, by git blob hash (the exact bytes): HTML, CSS, service worker, every chunk. Older builds' files may stay in git as extras (the deploy only adds and overwrites). The comparison lives in `scripts/lib/built-client.mjs` so it can be tested directly. The build is reproducible: two builds were byte-identical in all 35 files | `test-build-and-deploy-checks.mjs` [1], on throwaway git repositories: **valid build passes; older files as extras pass**; stale entry, **admin file absent**, **admin contents corrupted**, **another chunk absent**, **HTML still on the old stylesheet**, stale service worker: **each fails** (the four the review found passing under 3g now fail). On the real repository: 35 of 35 files identical, 560 older files kept as extras |
| 2 | After a successful action (for example Confirm), a failed status refresh left the old status on screen with no notice | A refresh that fails **after** the panel has loaded now shows a notice: "Your change was accepted by the server, but the panel could not refresh (HTTP 500 / no answer from the server), so the statuses below may be out of date", with **Retry**, which only reads (GET). The Wording check header adds "· may be out of date". The successful action is never repeated and never described as "nothing was changed" | `test-calibration-panel.mjs` [4] (real panel, real route answer): **the review's sequence**: Confirm succeeds, the refresh answers 500 → the notice, the header marked, one Confirm; **Retry → Kannada shows "confirmed by R…", the notice clears, still one Confirm (one more GET only)**; no answer at all → the same notice. Positive control: Confirm with a normal refresh → confirmed, no notice. On the 3g panel the four new cases fail ("not confirmed, locked", no notice, no Retry) |
| note | The live check's wait for the deployment had no failure: it could check an older deployment and pass | The wait (`scripts/lib/deploy-wait.mjs`) is now a check: **"The deployment of this commit is live"** fails if the wanted commit never appears, with the expected and actual commit and the reason (mismatch, or unavailable) | `test-build-and-deploy-checks.mjs` [2]: the wanted commit arriving passes; **a different commit that stays live fails ("mismatch", actual commit given)**; a site that never answers, or answers without a commit, fails ("unavailable"); a local run with no commit requested says so |
| note | The wording row reports a differing hash without gating | Kept as a **status inventory** and labelled so ("a hash that differs from the reviewed one is reported, not judged"). A legitimate wording edit changes the hash; the human confirmation must refer to the current hash | — |
| note | "Railway does not rebuild the client" stated as fact | `DELIVERY-FIXES-3g.md` corrected: the stale committed build is established; that the test service does not run `build.sh` is an **inference** until the effective builder, build command and build logs are checked. The committed-build safeguard stays | — |

## Files
**NEW:**
- `server/scripts/lib/built-client.mjs`
- `server/scripts/lib/deploy-wait.mjs`
- `server/scripts/test-build-and-deploy-checks.mjs` (gate)
- `DELIVERY-FIXES-3h.md`
- `client/dist/assets/`: 15 new build files (in the changed-files zip)

**Changed:**
- `client/src/components/voicecalibration/VoiceCalibrationPanel.jsx` (refresh-failed notice, GET-only Retry)
- `client/dist/index.html`, `client/dist/sw.js` (the new build: entry `index-Cv-VEZoW.js`, admin `AdminDashboard-Cm05YZvA.js`)
- `server/scripts/check-built-client.mjs` (every file compared)
- `server/scripts/check-live-calibration-panel.mjs` (the deployment wait is a check; the wording row labelled as an inventory)
- `server/scripts/test-calibration-panel.mjs` (five new cases in a new section [4]; also a random phone number for its throwaway admin, after a leftover row from an interrupted run collided with the fixed one)
- `server/scripts/test-local.sh` (the new suite in the gate)
- `DELIVERY-FIXES-3g.md` (the Railway cause qualified)

## Changes to existing tests
- **`check-built-client.mjs`** (added in 3g): one assertion **added**, "every one of the fresh build's N files … is in git with identical bytes". The three 3g assertions are unchanged. This strengthens the check (finding 1).
- **`test-calibration-panel.mjs`** (added in 3g): the 13 earlier assertions are unchanged. Five assertions added. Its throwaway admin now gets a random phone number instead of a fixed one, which only affects setup.
- **`check-live-calibration-panel.mjs`** (robot workflow): a new first row, "The deployment of this commit is live", which can fail. The wording row's label now says it is an inventory; what it checks is unchanged.

No other test changed.

## Results
| Check | Result |
|---|---|
| `test-build-and-deploy-checks.mjs` (new) | **13/13** |
| `test-calibration-panel.mjs` | **18/18** (the 3g panel fails the 4 new refresh cases) |
| `check-built-client.mjs` | **4/4** (35 of 35 files identical) |
| Full local gate | **all suites pass, 6,990 assertions** (3g: 6,971; + 13 + 5 + 1) |
| End-to-end voice simulation | not rerun: the only app change is the admin calibration panel, which the voice robot does not use; the live phone robot runs every member screen on the new build |
| Browser screens | the refresh-failed notice at 360 and 390 px, dark and light (stamped SIMULATED, local server) |
| Live site after the push | **Verified live (robot workflow, signed-in admin, read-only, 2 Nov 05:18 UTC):** "The deployment of this commit is live": expected cf91945, live cf91945, match; served entry `index-Cv-VEZoW.js` (SHA-256 54210fc3c3f6f9c9…) and admin `AdminDashboard-Cm05YZvA.js` (SHA-256 792d187e6f16481f…, 120,031 bytes) contain the panel; `GET /api/voice-calibration/admin` HTTP 200, available: true; panel shown; Wording check **0/3 confirmed** (kn, hi, en not confirmed, locked; hashes `02dc7a808038` / `21ef021a6c57` / `9bd51a13bb06` as reviewed); nothing but GET sent. Railway deployed 05:11:07–05:12:10 UTC; phone robot 51/51 clean, 35 of 35 live files identical; GitHub gate green 05:23:00 UTC. **A real cropped phone capture is still owed:** the built-in browser on Sachin's computer is signed in as a member, and no admin session was available to this builder |
