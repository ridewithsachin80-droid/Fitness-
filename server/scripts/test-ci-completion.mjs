// Exercise the real shell gate with synthetic completed/incomplete runner logs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const script = fs.readFileSync(new URL('./test-local.sh', import.meta.url), 'utf8');
const start = script.indexOf('  if timeout 600 node scripts/ui-tests.mjs');
const end = script.indexOf('\nfi\n', start);
if (start < 0 || end < 0) throw Error('UI gate not found');
const gate = script.slice(start, end);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-ci-completion-'));
let failures = 0;
try {
  for (const [name, log, exit, accepted] of [
    ['completed passing run', '  ✓ rendered\n✅ ui-tests: 1 passed, 0 failed\n', 0, true],
    ['early zero exit after passing checks', '  ✓ rendered\n', 0, false],
    ['failed final summary', '  ✓ rendered\n❌ ui-tests: 1 passed, 1 failed\n', 0, false],
    ['nonzero process despite success text', '  ✓ rendered\n✅ ui-tests: 1 passed, 0 failed\n', 1, false],
    ['summary without any assertions', '✅ ui-tests: 1 passed, 0 failed\n', 0, false],
  ]) {
    const logPath = path.join(dir, 'ui-tests.log');
    const inputPath = path.join(dir, 'source.log');
    fs.writeFileSync(inputPath, log);
    const result = spawnSync('bash', [], { input: `timeout() { cat "$FIXTURE_INPUT"; return ${exit}; }\nfailed=0\ntotal_pass=0\nuilog="$FIXTURE_LOG"\n${gate}\nexit "$failed"\n`, env: { ...process.env, FIXTURE_LOG: logPath, FIXTURE_INPUT: inputPath }, encoding: 'utf8' });
    const ok = (result.status === 0) === accepted;
    console.log(`  ${ok ? '✓' : '✗'} CI gate ${accepted ? 'accepts' : 'rejects'} ${name}`);
    if (!ok) { failures++; console.error(result.stdout, result.stderr); }
  }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
process.exitCode = failures ? 1 : 0;
