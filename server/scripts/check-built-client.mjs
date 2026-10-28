/**
 * scripts/check-built-client.mjs — Fixes-3g (28 Oct 2026). Is the client that the test site serves the build of this source?
 *
 * Railway serves the COMMITTED client/dist (on 28 Oct the live admin bundle was byte-identical to the one committed in Fixes-2u,
 * and lacked the calibration panel that the source had had since Fixes-2x). The live-file check (check-live-assets.mjs) only
 * compares the site with client/dist, so a stale client/dist passed it. This check builds the client from source into a
 * temporary folder (the build is reproducible: content-hashed file names) and requires:
 *   [1] the fresh build's admin bundle contains the Voice calibration panel and its Wording check;
 *   [2] the committed client/dist (the git index, i.e. what the next commit or this checkout holds) is that same build: the same
 *       entry file, and the same admin bundle, present in git. If not, build the client and commit client/dist.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLIENT = path.join(ROOT, 'client');
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-built-client-'));
const entryOf = (html) => (html.match(/<script[^>]+src="\/assets\/(index-[A-Za-z0-9_-]+\.js)"/) || [])[1] || null;
const adminOf = (js) => (js.match(/AdminDashboard-[A-Za-z0-9_-]+\.js/) || [])[0] || null;
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
try {
  const vite = path.join(CLIENT, 'node_modules/.bin/vite');
  const bin = fs.existsSync(vite) ? vite : path.join(ROOT, 'node_modules/.bin/vite');
  execFileSync(bin, ['build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'warn'], { cwd: CLIENT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production' } });
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const entry = entryOf(html);
  const admin = entry && adminOf(fs.readFileSync(path.join(OUT, 'assets', entry), 'utf8'));
  const adminJs = admin ? fs.readFileSync(path.join(OUT, 'assets', admin), 'utf8') : '';
  console.log(`\n[1] the fresh build of this source (entry ${entry}, admin ${admin})`);
  ck('its admin bundle contains the Voice calibration panel, its Wording check, its error/Retry state and its API path',
    ['vc-panel', 'vc-words', 'vc-panel-error', 'vc-panel-retry', 'Voice calibration · round 1', '/voice-calibration/admin'].every(m => adminJs.includes(m)), { entry, admin });

  console.log('\n[2] the committed client/dist is that build (Railway serves the committed one)');
  let committedHtml = null;
  try { committedHtml = git('show', ':client/dist/index.html'); } catch (e) { committedHtml = null; }
  const cEntry = committedHtml && entryOf(committedHtml);
  let cAdmin = null;
  try { cAdmin = cEntry && adminOf(git('show', `:client/dist/assets/${cEntry}`)); } catch { cAdmin = null; }
  ck(`client/dist in git loads the same entry file as a fresh build (committed ${cEntry || 'none'}, fresh ${entry}): if this fails, build the client and commit client/dist`,
    !!cEntry && cEntry === entry, { committed: cEntry, fresh: entry });
  ck(`…and the same admin bundle, present in git (committed ${cAdmin || 'none'}, fresh ${admin})`, !!cAdmin && cAdmin === admin, { committed: cAdmin, fresh: admin });
} catch (e) { ck('the check ran to the end', false, String(e.stderr || e.stack || e).slice(0, 600)); }
finally { fs.rmSync(OUT, { recursive: true, force: true }); }
console.log(`\nBuilt client (Fixes-3g): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
