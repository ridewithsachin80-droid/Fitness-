// scripts/lib/built-client.mjs — Fixes-3h (2 Nov 2026). Is the committed client build exactly a fresh build of the source?
//
// Compares EVERY file of a fresh build with the same path in the git index (what this checkout or the next commit holds),
// by git blob hash (SHA-1 of the bytes, as git stores them). Older builds' files may remain in git as extras (the deploy only
// adds and overwrites); a fresh file that is missing, or present with other contents, fails. Used by check-built-client.mjs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
});

/** path (relative to prefix) → blob hash, for every file under prefix in the git index of repo `root`. */
export function stagedBlobs(root, prefix) {
  const out = execFileSync('git', ['ls-files', '-s', '-z', '--', prefix], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  const map = new Map();
  for (const rec of out.split('\0').filter(Boolean)) {
    const [meta, file] = rec.split('\t');
    map.set(file.slice(prefix.length + 1), meta.split(' ')[1]);
  }
  return map;
}
/** path (relative to dir) → blob hash, for every file in a fresh build folder. */
export function freshBlobs(dir, root) {
  const files = walk(dir).sort();
  const hashes = execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: root, input: files.map(f => path.join(dir, f)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 << 20 }).trim().split('\n');
  return new Map(files.map((f, i) => [f, hashes[i]]));
}
/** { total, same, missing:[paths], different:[paths], extras } comparing a fresh build folder with the git index. */
export function compareBuild({ freshDir, root, prefix = 'client/dist' }) {
  const fresh = freshBlobs(freshDir, root), staged = stagedBlobs(root, prefix);
  const missing = [], different = [];
  for (const [f, h] of fresh) { if (!staged.has(f)) missing.push(f); else if (staged.get(f) !== h) different.push(f); }
  return { total: fresh.size, same: fresh.size - missing.length - different.length, missing, different, extras: [...staged.keys()].filter(f => !fresh.has(f)).length };
}
