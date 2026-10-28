# FitLife — Fixes-3g: the calibration panel restored on the test site (28 Oct 2026)

**Scope:** test branch only. Based on **06b80a7** (kit code identical to the reviewed **2052a80**). It answers the reviewer's 28 Oct finding: the signed-in test Admin page goes straight from the Voice backup test card to Overview. The **Voice calibration · round 1** panel is missing, so the wording check cannot be done.

**Unchanged:** production (`main` 1ca6ae7); the calibration kit's server code, its scripts and their hashes (kn `02dc7a808038…`, hi `21ef021a6c57…`, en `9bd51a13bb06…`); the live speech check (200 / 60 / 6), detector settings, provider order, nutrients and supplement accounting; every recording, history and wording record. **No wording confirmation was made on anyone's behalf.** Collection, invitations for collection and real-provider batches stay closed. **B18/B19, Scenario G (3u), B20 and the 61/63 simulation anomaly (3z-b) stay open.**

## The cause (established)

**The test site serves the committed `client/dist`, and `client/dist` had not been committed since Fixes-2u (e2fb101, 22 Oct).** The client source has had the panel since Fixes-2x (f450f9f, 23–24 Oct), but no build of it was ever committed, so it never reached the site.

The evidence:
- **The live bundles are the committed ones.** The admin bundle the reviewer found live (`AdminDashboard-DRVOGYZk.js`, 90,137 bytes, no "calibration") and the entry file `index-DeNUWF9y.js` are the files in git, committed in Fixes-2u, byte for byte.
- **Railway does not rebuild the client.** `railway.toml` asks for `bash build.sh`, which builds the client from source after deleting `client/dist` (`clean-build.mjs`). Had it run, the site would serve new file names; it serves the committed ones. So the test service is evidently not running `build.sh`. The Railway dashboard says Railpack, while `railway.toml` says nixpacks (an old handoff note). The build logs need a Railway login and could not be read from here.
- **My own rule caused the gap.** From Fixes-2v on I followed a rule of not committing `client/dist`, believing the deploy built it. It doesn't. The rule was wrong for this deploy, and it is withdrawn (handoff updated).
- **The robot could not see it.** Its "35 of 35 live files identical" check (`check-live-assets.mjs`) compares the site with `client/dist`, so it confirmed the site was serving the stale build faithfully.
- **No server fault was found.** The calibration API itself works. On a local production server built from this commit, the signed-in `GET /api/voice-calibration/admin` answers **200, available: true**, and the panel shows. On the live site that request was never made, because the served admin bundle has no panel to make it. No HTTP 500, migration or availability-gate fault is claimed.

## What changed

| # | Asked for | Done |
|---|---|---|
| 1 | Restore the panel: rebuild and deploy the correct client | **The client is built from this source and committed.** New entry `index-Cl5aKNS5.js`, new admin bundle `AdminDashboard-l7iiToQy.js` (the admin bundle contains the panel), 16 new files, `index.html` and `sw.js` overwritten. Nothing is deleted (older builds' files stay, as the add-only deploy requires). The build is reproducible: two builds, and a build into another folder, give the same file names. **Client changes going live with it** (all reviewed in 2x–2z, none visible to ordinary members): the admin calibration panel; the member's Voice test card and sheet (shown only to invited volunteers; none are invited); the composer's calibration-try label and upload mode (only while a try is armed for that account) |
| 2 | Verify the signed-in calibration request | Locally (production build, test-server mode, real database): **HTTP 200, `available: true`**. On the live site it is verified by the new robot check after this deploy (row 4) |
| 3 | A clear loading / error state with Retry instead of silently hiding | `VoiceCalibrationPanel.jsx`: **on the test site** it shows "Loading…" while waiting. If the request fails it says why, "Couldn't load the calibration panel: the server answered HTTP 500 / no answer from the server / this server says … not available here (HTTP 404). Nothing was changed.", with a **Retry** button. If the server reports calibration off, it says so. **Elsewhere (production)** nothing is shown, as before, with no loading flash. Screens checked at 360 and 390 px, dark and light |
| 4 | A production-build regression check and a signed-in live smoke check | **`check-built-client.mjs` (gate):** builds the client from source into a temporary folder and requires (a) its admin bundle to contain the panel, its Wording check and its error/Retry state, and (b) the **committed `client/dist`** to be that same build (same entry file, same admin bundle, in git). A stale `client/dist` now fails the gate. **`check-live-calibration-panel.mjs` (robot workflow, after each test deploy, read-only):** (A) signed out, the served admin bundle contains the panel; (B) signed in as the robot admin (existing repository secrets), `GET /api/voice-calibration/admin` answers 200 with `available: true`, the panel and its **Wording check** are visible, and the three languages' statuses and script hashes are read off the screen into the robot report (codes only). Every non-GET calibration request is blocked, so it cannot confirm, invite or change anything |
| 5 | Evidence | Below, and in the robot report on the pushed commit |

## Counterexamples and positive controls
- **The built-client check on the stale commit:** fails, "committed `index-DeNUWF9y.js`, fresh `index-Cl5aKNS5.js`" and "committed `AdminDashboard-DRVOGYZk.js`, fresh `AdminDashboard-l7iiToQy.js`" (the live discrepancy, exactly). With the new build staged, it passes 3/3.
- **The live check against the old app** (a local production server serving the old `index.html`): fails. The served admin bundle `AdminDashboard-DRVOGYZk.js` lacks `vc-panel`, `vc-words`, the title and the API path; no calibration request; "nothing (no panel, no error card)". Against the new build it passes 6/6: HTTP 200, `available: true`, panel shown, Wording check shown, kn / hi / en "not confirmed, locked" with hashes `02dc7a808038` / `21ef021a6c57` / `9bd51a13bb06` ("as reviewed"), nothing but GET sent.
- **`test-calibration-panel.mjs` (gate, NEW):** the real panel in jsdom, given the **real route's** answer from the test database: 13/13. Run against the old panel it fails the three failure cases ("never nothing": HTTP 500, no answer, HTTP 404 all showed nothing) and has no Retry.

## Files
**NEW:**
- `server/scripts/test-calibration-panel.mjs` (gate)
- `server/scripts/check-built-client.mjs` (gate)
- `server/scripts/check-live-calibration-panel.mjs` (robot workflow)
- `DELIVERY-FIXES-3g.md`
- `client/dist/assets/`: 16 new build files (listed in the changed-files zip)

**Changed:**
- `client/src/components/voicecalibration/VoiceCalibrationPanel.jsx` (loading / error / Retry on the test site)
- `client/src/utils/calibrationMode.js` (`onTestSite` exported; no behaviour change)
- `client/dist/index.html`, `client/dist/sw.js` (the new build)
- `.github/workflows/phone-robot.yml` (the live panel check step, with the admin secrets; its result added to the robot report)
- `server/scripts/test-local.sh` (the two new gate checks)

## Changes to existing tests
**None.** No existing test or assertion changed.

## Results
| Check | Result |
|---|---|
| `test-calibration-panel.mjs` (new) | **13/13** |
| `check-built-client.mjs` (new) | **3/3** with the new build (fails 1/3 on the stale commit) |
| Live check, local production server | **6/6** on the new build (fails on the old app) |
| Full local gate | **all suites pass, 6,971 assertions** (3f: 6,955; + 13 panel + 3 built client) |
| Browser screens | the panel, its Wording check, the error card and the loading card at 360 and 390 px, dark and light: readable, accent and contrast as the rest of the panel (stamped SIMULATED, local server) |
| End-to-end voice simulation A–M, with the new client build served | **63/63** (05:22–05:51 UTC, 28 Oct) |
| Live site after the push | **Verified by the robot workflow, signed in as admin, read-only (28 Oct 14:42 UTC):** server and app 7eecd1c (entry `index-Cl5aKNS5.js`, admin `AdminDashboard-l7iiToQy.js`, 119,368 bytes); `GET /api/voice-calibration/admin` **HTTP 200, available: true**; **the panel is shown, with its Wording check (0/3 confirmed)**: Kannada, Hindi and English all *not confirmed, locked*, hashes `02dc7a808038` / `21ef021a6c57` / `9bd51a13bb06` (as reviewed); nothing but GET sent. Railway deployed 14:33:40–14:36:30 UTC; phone robot 51/51 clean, 35 of 35 live files identical; GitHub gate green 14:45:31 UTC |

## For Sachin
1. **After this deploy:** open Admin on the test site; **Voice calibration · round 1** is under the Voice backup test card. If it says it couldn't load, it now says why: send me a screenshot.
2. **Then the wording check** as in `claude/FitLife-Wording-Confirmation-Status-2026-10-27.md`.
3. **Railway (please check when convenient):** the test service's build settings, which builder and build command it uses. `railway.toml` asks for `bash build.sh` (builds the client from source), but the site serves the committed build, so the service is evidently not running it. Until that is settled, **every client change must be delivered with its built `client/dist`**. The new gate check enforces this, so it cannot silently go stale again. The same applies when this reaches `main`.
