import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBuiltCss } from './lib/built-css.mjs';

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-built-css-'));
function check(label, fn) { fn(); console.log(`  ✓ ${label}`); }
try {
  check('Missing client build fails with a build instruction', () =>
    assert.throws(() => readBuiltCss(dist), /Missing built index.html.*Run the client build/));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'assets/a-obsolete.css'), 'body { width: 9999px; }');
  fs.writeFileSync(path.join(dist, 'assets/z-current.css'), 'body { width: 100%; }');
  fs.writeFileSync(path.join(dist, 'assets/b-theme.css'), 'body { background: black; }');
  fs.writeFileSync(path.join(dist, 'index.html'), `<link rel="preload" href="/assets/a-obsolete.css">
    <link href="https://fonts.googleapis.com/fonts.css" rel="stylesheet">
    <link href="/assets/z-current.css?v=1" rel="stylesheet" crossorigin>
    <link rel="stylesheet" href="./assets/b-theme.css">`);
  check('Only linked app CSS loads, in HTML order, ignoring obsolete bundles and external fonts', () =>
    assert.equal(readBuiltCss(dist), 'body { width: 100%; }\nbody { background: black; }'));
  fs.unlinkSync(path.join(dist, 'assets/z-current.css'));
  check('A missing linked bundle fails instead of falling back to obsolete CSS', () =>
    assert.throws(() => readBuiltCss(dist), /Missing linked stylesheet.*z-current.css/));
  fs.writeFileSync(path.join(dist, 'index.html'), '<link rel="preload" href="/assets/a-obsolete.css">');
  check('HTML without a stylesheet fails instead of testing an unstyled page', () =>
    assert.throws(() => readBuiltCss(dist), /No local stylesheet linked/));
} finally {
  fs.rmSync(dist, { recursive: true, force: true });
}
