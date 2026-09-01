/**
 * scripts/lib/client-bundle.js — let a Node test import the REAL client code.
 *
 * WHY
 * ---
 * `test-coach-view.js` reimplements thirteen client helpers under comments
 * saying "mirrors X". A copy cannot fail when the original changes, so those
 * assertions report an area as covered while the shipped code drifts away
 * underneath them. This file already happened once here: three assertions ran
 * against a pasted copy of `computeDayTotals` for months, and changing the real
 * function could not have turned them red.
 *
 * The obstacle was never good intentions — it was that the suites are plain
 * CommonJS and the client is ESM with JSX, so `require('../../client/src/...')`
 * simply does not work. esbuild's SYNCHRONOUS API removes that obstacle: the
 * module is transpiled to CJS in memory and required normally, so a test can
 * stay synchronous and still exercise what actually ships.
 *
 * Every bare import (`react`, `zustand`, `axios`) is resolved from the client's
 * own dependency tree, so a component that imports React still bundles. The
 * PWA virtual module has no file behind it and is shimmed.
 *
 * Available because esbuild is a server devDependency, and `build.sh` installs
 * the server with --omit=dev, so Railway never sees it.
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const ROOT       = path.resolve(__dirname, '../../..');
const CLIENT_SRC = path.join(ROOT, 'client', 'src');

/** Cache: bundling is fast but not free, and suites import the same helpers. */
const cache = new Map();

function shimDir() {
  const dir = path.join(os.tmpdir(), 'fitlife-client-shims');
  fs.mkdirSync(dir, { recursive: true });
  const pwa = path.join(dir, 'pwa-register.js');
  if (!fs.existsSync(pwa)) fs.writeFileSync(pwa, 'export function registerSW(){return()=>{}}\n');
  return { pwa };
}

/**
 * Import a module from client/src and return its exports.
 * @param {string} rel  e.g. 'components/StreakCard.jsx'
 */
function importClient(rel) {
  if (cache.has(rel)) return cache.get(rel);

  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch {
    // Loud, not silent. A suite that quietly skips because a dependency is
    // missing prints a green tick over nothing — the exact failure this repo
    // has already shipped twice.
    throw new Error(
      'esbuild is not installed, so the real client code cannot be imported.\n' +
      '  cd server && npm install\n' +
      'It is a devDependency; Railway installs the server with --omit=dev and never sees it.');
  }

  const entry = path.join(CLIENT_SRC, rel);
  if (!fs.existsSync(entry)) throw new Error(`No such client module: ${rel}`);

  const { pwa } = shimDir();

  const result = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    define: {
      'process.env.NODE_ENV': '"test"',
      'import.meta.env': JSON.stringify({
        MODE: 'test', DEV: false, PROD: false, BASE_URL: '/', VITE_VAPID_PUBLIC_KEY: '',
      }),
    },
    // esbuild's synchronous API refuses plugins, which is fine: the entry point
    // lives inside client/src, so `react` and friends resolve by the ordinary
    // walk up to the workspace node_modules exactly as Vite resolves them.
    // Only the PWA virtual module needs help — it has no file behind it.
    alias: { 'virtual:pwa-register': pwa },
    nodePaths: [path.join(ROOT, 'node_modules'), path.join(ROOT, 'client', 'node_modules')],
    logLevel: 'silent',
  });

  const code = result.outputFiles[0].text;
  const mod  = { exports: {} };
  // The bundle is self-contained CJS, so a bare Function wrapper is enough.
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);

  cache.set(rel, mod.exports);
  return mod.exports;
}

module.exports = { importClient, CLIENT_SRC, ROOT };
