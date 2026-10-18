#!/usr/bin/env node
// Is the test site serving exactly the app in client/dist?
// Fetches every file in client/dist from the site and compares them byte for byte
// (SHA-256). Writes qa/robot-results/live-assets.md and exits 1 on any difference.
// Usage: ROBOT_BASE_URL=https://fitness-test.up.railway.app node scripts/check-live-assets.mjs
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'client/dist');
const OUT = process.env.ROBOT_OUT || path.join(ROOT, 'qa/robot-results');
const BASE = (process.env.ROBOT_BASE_URL || 'https://fitness-test.up.railway.app').replace(/\/$/, '');
if (/fitness\.upscale-app\.com/.test(BASE)) { console.error('Refusing: this check is for the test site.'); process.exit(2); }

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

// The files this build uses: index.html, sw.js, everything sw.js precaches and
// everything index.html links to. (client/dist also keeps older builds' files,
// because deploys only add files; those are not part of this build.)
const read = rel => fs.readFileSync(path.join(DIST, rel), 'utf8');
const files = [...new Set([
  'index.html', 'sw.js',
  ...[...read('sw.js').matchAll(/"?url"?\s*:\s*"([^"]+)"/g)].map(m => m[1]),
  ...[...read('index.html').matchAll(/(?:src|href)="\/?([^"?#:]+)[^"]*"/g)].map(m => m[1]),
])].filter(rel => rel && fs.existsSync(path.join(DIST, rel))).sort();
const stamp = Date.now();
const rows = [];
for (const rel of files) {
  const local = sha(fs.readFileSync(path.join(DIST, rel)));
  let live = '', status = 0;
  try {
    const res = await fetch(`${BASE}/${rel}?livecheck=${stamp}`, { cache: 'no-store' });
    status = res.status;
    live = sha(Buffer.from(await res.arrayBuffer()));
  } catch (e) { live = `error: ${e.message}`; }
  rows.push({ rel, local, live, status, same: status === 200 && live === local });
}

const app = (fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').match(/assets\/index-[\w-]+\.js/) || [''])[0];
const appRow = rows.find(r => r.rel === app);
const bad = rows.filter(r => !r.same);
const lines = [
  `## Live files vs client/dist (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
  '',
  `Site: ${BASE} · commit ${process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : 'local'}`,
  '',
  `**${rows.length - bad.length} of ${rows.length} files identical.** App file \`${app}\`: ${appRow?.same ? 'identical' : 'DIFFERENT'} (SHA-256 ${appRow?.local.slice(0, 16)}…).`,
  '',
  '| File | Local SHA-256 | Live SHA-256 | HTTP | Same |',
  '|---|---|---|---|---|',
  ...rows.map(r => `| ${r.rel} | ${r.local.slice(0, 12)} | ${String(r.live).slice(0, 12)} | ${r.status} | ${r.same ? '✅' : '❌'} |`),
  '',
];
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'live-assets.md'), lines.join('\n'));
console.log(lines.slice(0, 5).join('\n'));
if (bad.length) {
  for (const r of bad.slice(0, 8)) console.log(`::error title=Live file differs::${r.rel} (HTTP ${r.status})`);
  process.exit(1);
}
console.log(`::notice title=Live files match::${rows.length} of ${rows.length} files identical; ${app} ${appRow.local.slice(0, 16)}`);
