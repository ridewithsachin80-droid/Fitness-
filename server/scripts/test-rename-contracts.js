#!/usr/bin/env node
/**
 * test-rename-contracts.js — guards the member/coach terminology rename.
 *
 * The rename is UI + API only. The database still stores role='patient' and
 * role='monitor', and every FK column is still patient_id / monitor_id. This
 * suite fails loudly if someone "finishes" the rename in a place that would
 * need a migration, or drops a legacy alias that stale PWA clients still call.
 *
 * Static analysis over the source tree — no DB, no network.
 *
 * PRODUCTION GUARD: refuses to run against a live database URL.
 */
'use strict';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run tests with NODE_ENV=production.');
  process.exit(1);
}
if (/railway|rlwy\.net|amazonaws|prod/i.test(process.env.DATABASE_URL || '')) {
  console.error('Refusing to run: DATABASE_URL points at a live database.');
  process.exit(1);
}

const fs   = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  \u2713', name); }
  catch (err) { console.error('  \u2717', name, '\n   ', err.message); process.exitCode = 1; }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

console.log('\nDB values must NOT be renamed');

test("users.role still accepts 'patient' and 'monitor'", () => {
  const schema = read('server/db/schema.sql');
  assert.ok(/role\s+VARCHAR\(20\)\s+NOT NULL CHECK \(role IN \('patient', 'monitor', 'admin'\)\)/.test(schema),
    'the role CHECK constraint changed — that needs a migration, not a rename');
});

test('client role constants map to the real DB values', () => {
  const c = read('client/src/constants.js');
  assert.ok(/ROLE_MEMBER\s*=\s*'patient'/.test(c), "ROLE_MEMBER must stay 'patient'");
  assert.ok(/ROLE_COACH\s*=\s*'monitor'/.test(c),  "ROLE_COACH must stay 'monitor'");
});

test('no client file invents a role value the DB would reject', () => {
  const bad = [];
  for (const f of walk(path.join(ROOT, 'client/src'))) {
    const s = fs.readFileSync(f, 'utf8');
    if (/role\s*===\s*'(member|coach)'/.test(s) || /roles=\{\[\s*'(member|coach)'/.test(s)) {
      bad.push(path.relative(ROOT, f));
    }
  }
  assert.deepStrictEqual(bad, [], `these compare role against a value the DB never stores: ${bad.join(', ')}`);
});

console.log('\nLegacy aliases must stay until rollout settles');

test('/api/patients is still mounted alongside /api/members', () => {
  const idx = read('server/index.js');
  assert.ok(idx.includes("app.use('/api/members'"),  '/api/members must be mounted');
  assert.ok(idx.includes("app.use('/api/patients'"), '/api/patients alias removed — stale PWA clients will 404');
});

test('/admin/monitors endpoints still answer alongside /admin/coaches', () => {
  const a = read('server/routes/admin.js');
  for (const p of ["'/coaches'", "'/monitors'", "'/coaches/:id/toggle'", "'/monitors/:id/toggle'"]) {
    assert.ok(a.includes(p), `missing admin route path ${p}`);
  }
});

test('admin stats emits both coaches and monitors keys', () => {
  const a = read('server/routes/admin.js');
  assert.ok(/coaches:\s*parseInt/.test(a),  'new bundles read stats.coaches');
  assert.ok(/monitors:\s*parseInt/.test(a), 'stale bundles read stats.monitors');
});

test('old /monitor/:id links still redirect', () => {
  const app = read('client/src/App.jsx');
  assert.ok(app.includes('path="/monitor/:memberId"'), 'bookmarked coach links would 404');
  assert.ok(app.includes('path="/coach/:memberId"'),   '/coach route missing');
});

console.log('\nUI must not show clinical terminology');

test('no user-visible "Patient" or "Monitor" copy remains in the client', () => {
  const ALLOW = /patient_id|patient_count|patient_profiles|monitor_id|monitor_name|monitor_notes|monitor_created|monitor_assigned|monitor_toggled|join_monitor_room|monitor_room|monitor_\$\{|'patient'|"patient"|'monitor'|"monitor"|pages\/Monitor|pages\/PatientList|\/monitor|LegacyMonitorRedirect|ROLE_MEMBER|ROLE_COACH/;
  const bad = [];
  for (const f of walk(path.join(ROOT, 'client/src'))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/[Pp]atient|[Mm]onitor/.test(line) && !ALLOW.test(line)) {
        bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
      }
    });
  }
  assert.deepStrictEqual(bad, [], `clinical wording left in UI code:\n    ${bad.join('\n    ')}`);
});

test('audit log UI maps every action name the server actually emits', () => {
  const admin  = read('client/src/pages/AdminDashboard.jsx');
  const mapped = new Set((admin.match(/^\s{2,}([a-z_]+):\s*\{ icon:/gm) || [])
    .map(l => l.trim().split(':')[0]));

  const emitted = new Set();
  for (const f of walk(path.join(ROOT, 'server/routes'))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:Audit|audit)\w*\([^)]*?'((?:member|monitor|coach|pin|weight)_[a-z_]+)'/g)) {
      emitted.add(m[1]);
    }
  }
  const unmapped = [...emitted].filter(a => !mapped.has(a));
  assert.deepStrictEqual(unmapped, [],
    `server emits these audit actions but the UI has no icon for them, so they ` +
    `render with the generic fallback: ${unmapped.join(', ')}`);
});

test('audit map still handles pre-rename monitor_* history rows', () => {
  const admin = read('client/src/pages/AdminDashboard.jsx');
  for (const k of ['monitor_created', 'monitor_assigned', 'monitor_toggled']) {
    assert.ok(admin.includes(`${k}:`),
      `${k} missing — rows written before the rename would lose their icon`);
  }
});

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}\n`);
