/**
 * scripts/lint-undef.mjs — the one lint rule that matters for a drag-drop
 * deploy: no identifier used without being defined or imported (Sprint 12b).
 *
 * WHY: Vite and esbuild bundle a file that references an undefined name
 * without a word; it throws at runtime, on the phone, on the screen that uses
 * it. Every component split in Sprint 12 was guarded with this; now the gate
 * runs it on every file.
 *
 * Optional like the browser check: if ESLint is not installed it prints
 * NOT RUN and the gate carries on.   cd server && npm run lint:install
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.resolve(here, '../../client');
const bin = path.resolve(here, '../node_modules/.bin/eslint');
if (!existsSync(bin)) {
  console.log('  – eslint not installed, undefined-identifier lint NOT RUN (cd server && npm run lint:install)');
  process.exit(0);
}
const r = spawnSync(bin, ['--config', path.join(here, 'lib/eslint.undef.config.mjs'), '--no-config-lookup', 'src/**/*.{js,jsx}',
  '--ignore-pattern', 'src/sw.js',          // service-worker globals (clients) are not browser-window globals
  '--rule', '{"react-hooks/exhaustive-deps": "off"}'],
  { cwd: client, encoding: 'utf8', env: { ...process.env, NODE_PATH: path.resolve(here, '../node_modules') } });
const out = (r.stdout || '') + (r.stderr || '');
// The repo's `// eslint-disable-next-line react-hooks/…` comments name a rule
// this config does not load; that is not an undefined identifier.
const real = out.split('\n').filter(l => /no-undef|jsx-no-undef|Parsing error/.test(l) && !/react-hooks/.test(l));
if (real.length) {
  console.log(out);
  console.log(`\u2717 lint-undef: ${real.length} undefined-identifier problem(s)`);
  process.exit(1);
}
console.log('\u2713 lint-undef: every identifier in client/src is defined or imported');
