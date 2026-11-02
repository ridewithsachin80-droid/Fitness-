/**
 * scripts/test-build-and-deploy-checks.mjs — Fixes-3h (2 Nov 2026), after the 3g review.
 *   [1] compareBuild (used by check-built-client.mjs) on real throwaway git repositories: a valid build passes; a stale entry,
 *       a missing or corrupted admin file, another missing chunk, a stale stylesheet referenced by stale HTML and a stale
 *       service worker each FAIL (3g compared only file names and passed four of these); older files kept as extras pass;
 *   [2] waitForCommit (used by check-live-calibration-panel.mjs): the wanted commit arriving passes; a different commit that
 *       never changes, or a site that never answers, FAILS with the expected and actual commit (3g carried on silently).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareBuild } from './lib/built-client.mjs';
import { waitForCommit } from './lib/deploy-wait.mjs';

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-build-check-'));
const write = (dir, files) => { for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); } };
// A small "fresh build": HTML → entry → admin chunk and another chunk, a stylesheet and a service worker.
const FRESH = {
  'index.html': '<script type="module" src="/assets/index-NEW1.js"></script><link rel="stylesheet" href="/assets/index-CSS2.css">',
  'assets/index-NEW1.js': 'import("./AdminDashboard-ADM3.js");import("./Plan-PLN4.js");',
  'assets/AdminDashboard-ADM3.js': 'data-testid="vc-panel" data-testid="vc-words" Voice calibration · round 1 /voice-calibration/admin',
  'assets/Plan-PLN4.js': 'export const plan = 1;',
  'assets/index-CSS2.css': '.a{color:#315D47}',
  'sw.js': 'precache(["/assets/index-NEW1.js","/assets/index-CSS2.css"])',
};
let n = 0;
const repo = (staged) => {
  const root = path.join(TMP, `repo${++n}`); fs.mkdirSync(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  write(path.join(root, 'client/dist'), staged);
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
};
const freshDir = path.join(TMP, 'fresh'); write(freshDir, FRESH);
const run = (staged) => compareBuild({ freshDir, root: repo(staged) });
const okOf = (r) => r.total > 0 && r.missing.length === 0 && r.different.length === 0;

try {
  console.log('\n[1] the committed build must contain every fresh file with identical bytes');
  let r = run(FRESH);
  ck(`positive control: the valid build → all ${r.total} files identical, passes`, okOf(r) && r.total === 6, r);
  r = run({ ...FRESH, 'assets/index-OLD0.js': 'old entry', 'assets/AdminDashboard-OLD9.js': 'old admin' });
  ck('older builds\' files kept in git as extras → still passes (the deploy only adds and overwrites)', okOf(r) && r.extras === 2, r);
  const stale = { ...FRESH, 'index.html': FRESH['index.html'].replace('index-NEW1', 'index-OLD0') }; delete stale['assets/index-NEW1.js'];
  r = run(stale);
  ck('a stale entry (old index.html, new entry file absent) → FAILS', !okOf(r) && r.different.includes('index.html') && r.missing.includes('assets/index-NEW1.js'), r);
  const noAdmin = { ...FRESH }; delete noAdmin['assets/AdminDashboard-ADM3.js'];
  r = run(noAdmin);
  ck('matching names but the admin file ABSENT from git → FAILS (3g: passed)', !okOf(r) && r.missing.includes('assets/AdminDashboard-ADM3.js'), r);
  r = run({ ...FRESH, 'assets/AdminDashboard-ADM3.js': 'stale admin without the panel' });
  ck('matching names but the admin file\'s contents CORRUPTED / stale → FAILS (3g: passed)', !okOf(r) && r.different.includes('assets/AdminDashboard-ADM3.js'), r);
  const noChunk = { ...FRESH }; delete noChunk['assets/Plan-PLN4.js'];
  r = run(noChunk);
  ck('another required chunk absent → FAILS (3g: passed)', !okOf(r) && r.missing.includes('assets/Plan-PLN4.js'), r);
  const staleCss = { ...FRESH, 'index.html': FRESH['index.html'].replace('index-CSS2', 'index-CSS0'), 'assets/index-CSS0.css': '.a{color:gold}' }; delete staleCss['assets/index-CSS2.css'];
  r = run(staleCss);
  ck('the HTML still references the OLD stylesheet (new stylesheet absent) → FAILS (3g: passed)', !okOf(r) && r.different.includes('index.html') && r.missing.includes('assets/index-CSS2.css'), r);
  r = run({ ...FRESH, 'sw.js': 'precache(["/assets/index-OLD0.js"])' });
  ck('a stale service worker → FAILS', !okOf(r) && r.different.includes('sw.js'), r);

  console.log('\n[2] the live check waits for this commit, and fails if it never arrives');
  const seq = (...xs) => { let i = 0; return async () => { const x = xs[Math.min(i++, xs.length - 1)]; if (x instanceof Error) throw x; return x; }; };
  const fast = { tries: 4, delayMs: 0, sleep: async () => {} };
  let w = await waitForCommit({ fetchCommit: seq('06b80a7aaaa', 'c5985f8bbbb'), want: 'c5985f8e6b538de0', ...fast });
  ck('positive control: the wanted commit arrives on the second look → passes, live commit reported', w.ok && w.live === 'c5985f8bbbb' && w.reason === 'match', w);
  w = await waitForCommit({ fetchCommit: seq('06b80a7aaaa'), want: 'c5985f8e6b538de0', ...fast });
  ck('a DIFFERENT commit stays live → FAILS, "mismatch", with the actual commit (3g: carried on and could pass)', !w.ok && /^mismatch/.test(w.reason) && w.live === '06b80a7aaaa', w);
  w = await waitForCommit({ fetchCommit: seq(new Error('connect ECONNREFUSED')), want: 'c5985f8e6b538de0', ...fast });
  ck('the site never answers → FAILS, "unavailable", with the error', !w.ok && /^unavailable/.test(w.reason) && /ECONNREFUSED/.test(w.reason) && w.live === null, w);
  w = await waitForCommit({ fetchCommit: seq(null), want: 'c5985f8e6b538de0', ...fast });
  ck('the site answers without a commit → FAILS, "unavailable"', !w.ok && /^unavailable/.test(w.reason), w);
  w = await waitForCommit({ fetchCommit: seq('anything'), want: '', ...fast });
  ck('no commit requested (a local run) → not required, says so', w.ok && w.required === false, w);
} catch (e) { ck('the suite ran to the end', false, e.stack); }
finally { fs.rmSync(TMP, { recursive: true, force: true }); }
console.log(`\nBuild and deploy checks (Fixes-3h): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
