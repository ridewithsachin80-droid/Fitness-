# FitLife — Fixes-2h.1: the test deploy failed, and why the checks missed it (18 Oct 2026)

Test branch only. Production is unchanged.

## What happened
- Railway's build of commit **7a900e0** (robot check R11d) **failed** with `vite: not found`. Sachin found it on the Railway dashboard.
- The test site kept running the previous deploy, **42c26f9** (Fixes-2h). Members saw no change, and no data was affected.
- **I wrongly reported 7a900e0 as live.** The robot passed because 7a900e0 changed only the robot script, so the app bundle (`index-DZZ3VMjX.js`) was the same in both commits. My checks compared the bundle, which can't tell an old server from a new one when the bundle is unchanged.

## Root cause, reproduced
- The build ran with `NODE_ENV=production`. With that set, npm leaves out devDependencies: the root `npm ci` installed 92 packages, exactly the lockfile's 93 non-dev entries, and vite (a devDependency) was not among them.
- `build.sh` then ran the client's `npm install`, which also left vite out, and piped it through `tail` without `pipefail`. Nothing stopped the build until the first visible error: `vite: not found`.
- **Reproduced locally** on a clean copy of 7a900e0 with `NODE_ENV=production`: same 92 packages, no vite, same error.
- Why earlier deploys built: they evidently ran without `NODE_ENV=production`. I can't see their build logs. Railway → Variables is worth a look, but the fix below works either way.

## Fix
- **`build.sh`:**
  - `set -o pipefail`, so a failed install stops the build where it fails;
  - the client install is `npm install --include=dev`, so the build tools are installed even under `NODE_ENV=production`;
  - the server install still uses `--omit=dev`.
- **Proven:** `NODE_ENV=production bash build.sh` on that clean copy now finishes ("Build finished successfully"). The bundle it builds is `index-DZZ3VMjX.js`, byte-identical to the committed and live one (SHA-256 `bc208765…`).

## The checks can now see a failed deploy
- **`/health`** returns `commit`: the revision the server runs (`RAILWAY_GIT_COMMIT_SHA`, which Railway sets for GitHub deploys).
- **The robot** (`--wait-for-deploy`) now waits for that commit as well as the app bundle:
  - commit matches → it tests, and the report says `server <sha>`;
  - commit never matches (failed or stuck deploy) → the run **fails red**: "The test site is still running X, not Y: the deploy failed or is stuck (check Railway). Nothing was tested." That message is also the published report;
  - the site doesn't report a commit → a yellow warning says the server deploy could not be checked; it never passes silently.
- **Proven locally**, with a preview reporting commit `aaaaaaa`:
  - pushed commit `bbbbbbb` → waited, then exit 1 with that message;
  - pushed commit `aaaaaaa` → "test site server is running aaaaaaa", then the run went ahead.

## Follow-up 2h.2: a bug in my own check
- On the first live run after 2h.1, the robot reported "server commit not reported" and passed. That run did **not** confirm the deploy.
- **Cause:** the app bundle already matched, so the robot started at once and read `/health` while Railway was still deploying. The old server has no `commit` field, and my code treated "field missing" like "site doesn't report commits".
- **Fix:**
  - no `commit` field (an older server) → keep waiting, then fail red on timeout;
  - `commit: null` (new server, Railway gave no commit) → warning;
  - matching commit → pass.
- **Proven locally:** a proxy answering `/health` like the old server → the run waits, then exits 1 with "still running an older server … deploy failed or is stuck". The matching commit → it runs.

## Files
- **NEW:** `DELIVERY-FIXES-2h1.md`
- **Changed:**
  - `build.sh`
  - `server/index.js` (`/health`)
  - `server/scripts/robot-phone-run.mjs`
- Nothing renamed or deleted. No app (client) change, so the live app bundle stays `index-DZZ3VMjX.js`.
