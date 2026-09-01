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

  /**
   * Checked PER ROUTE, not per file.
   *
   * This used to be `a.includes("'/monitors'")` over the whole file. There are
   * three aliased routes — GET, POST and PATCH toggle — and each writes the
   * pair in its own array, so the file contained the string several times.
   * Deleting the alias from ANY ONE of them left the others to satisfy the
   * check and the gate stayed green. A mutation run proved it: removing
   * `/monitors` from the GET route did not turn this suite red.
   *
   * That is the exact deploy this file exists to prevent. A member whose
   * service worker has not updated is still calling the old path; if the alias
   * on the route they use is gone, they get a 404 and a blank list, and it
   * looks like their data vanished.
   *
   * The rule now: any route array mentioning a /coaches path must carry the
   * matching /monitors path in the SAME array.
   */
  const arrays = [...a.matchAll(/router\.(get|post|put|patch|delete)\(\s*\[([^\]]*)\]/g)]
    .map(m => ({ method: m[1], paths: m[2] }));

  assert.ok(arrays.length >= 3,
    `expected the aliased admin routes to be declared as arrays; found ${arrays.length}`);

  const missing = [];
  for (const { method, paths } of arrays) {
    for (const [coach, legacy] of [["'/coaches'", "'/monitors'"],
                                   ["'/coaches/:id/toggle'", "'/monitors/:id/toggle'"]]) {
      if (paths.includes(coach) && !paths.includes(legacy)) {
        missing.push(`${method.toUpperCase()} ${coach} has no ${legacy} alias`);
      }
    }
  }
  assert.deepStrictEqual(missing, [],
    `stale PWA bundles would 404 on these:\n    ${missing.join('\n    ')}`);

  // And the pairs must still exist at all — an array-shaped check alone would
  // pass on a file with no aliased routes left in it.
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

/**
 * Blank out comments while preserving line numbers, so a copy check reads only
 * what a user could actually see.
 *
 * Needed because JSX comments are `{/* ... *\/}` blocks whose continuation
 * lines start with ordinary prose — a naive "does this line start with //"
 * check misses them, and then an explanatory comment about the rename trips
 * the very test that protects the rename.
 */
function stripComments(src) {
  let out = '';
  let inBlock = false;
  for (const line of src.split('\n')) {
    let l = line;
    if (inBlock) {
      const end = l.indexOf('*/');
      if (end === -1) { out += '\n'; continue; }
      l = ' '.repeat(end + 2) + l.slice(end + 2);
      inBlock = false;
    }
    // strip single-line /* ... */ and {/* ... */} first
    l = l.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ');
    const open = l.indexOf('/*');
    if (open !== -1) { inBlock = true; l = l.slice(0, open); }
    const dbl = l.indexOf('//');
    if (dbl !== -1 && !/https?:$/.test(l.slice(0, dbl))) l = l.slice(0, dbl);
    out += l + '\n';
  }
  return out;
}

console.log('\nUI must not show clinical terminology');

test('no user-visible "Patient" or "Monitor" copy remains in the client', () => {
  const ALLOW = /patient_id|patient_count|patient_profiles|monitor_id|monitor_name|monitor_notes|monitor_created|monitor_assigned|monitor_toggled|join_monitor_room|monitor_room|monitor_\$\{|'patient'|"patient"|'monitor'|"monitor"|pages\/Monitor|pages\/PatientList|\/monitor|LegacyMonitorRedirect|ROLE_MEMBER|ROLE_COACH/;
  // Comments are not user-visible, and this assertion is about COPY. Flagging
  // them forced developers to reword explanations of the very rename this file
  // exists to protect — which is how you end up with no explanation at all.
  const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);
  const bad = [];
  for (const f of walk(path.join(ROOT, 'client/src'))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (isComment(line)) return;
      if (/[Pp]atient|[Mm]onitor/.test(line) && !ALLOW.test(line)) {
        bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
      }
    });
  }
  assert.deepStrictEqual(bad, [], `clinical wording left in UI code:\n    ${bad.join('\n    ')}`);
});

test('raw users.role is never rendered to the user', () => {
  // The grep above searches for the WORDS. It passed for months while
  // Settings.jsx rendered `{ label: 'Role', value: user?.role }` — which puts
  // the literal string "patient" on a member's own Account card at runtime.
  // A value-based leak has no matching word in the source, so it needs its
  // own check: role must go through a display map before it reaches JSX.
  const bad = [];
  for (const f of walk(path.join(ROOT, 'client/src'))) {
    // client/src/app.js is 2,000 lines of an unrelated hostel-management app
    // left in the tree. Nothing imports it and Vite never bundles it, so its
    // markup cannot reach a user. Scheduled to be stubbed out; until then it
    // would be the only entry in this list forever.
    if (path.basename(f) === 'app.js') continue;
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      // Passing the role to a component that filters on it is fine
      // (`<BottomNav role={user?.role} />`) — only RENDERING it is the bug.
      if (/\brole=\{/.test(line)) return;
      // `value: user?.role` / `{user.role}` / `>{u.role}<` — rendered as-is.
      if (/(value:\s*\w+\??\.role\b)|(\{\s*\w+\??\.role\s*\})/.test(line)) {
        bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
      }
    });
  }
  assert.deepStrictEqual(bad, [],
    `raw role value rendered to the user:\n    ${bad.join('\n    ')}`);
});

test('no other clinical or CRM wording in user-visible copy', () => {
  // "patient" and "monitor" are covered above. The rename also has to hold for
  // synonyms that crept in independently — AdminReminders shipped "until client
  // taps OK", which no grep for "patient" would ever have found.
  //
  // Comments and import paths (api/client) are not user-visible, so they are
  // excluded rather than forcing awkward rewording of internal notes.
  const WORDS = /\b(client|patient|subject|caseload)\b/i;
  const bad = [];
  for (const f of walk(path.join(ROOT, 'client/src'))) {
    if (path.basename(f) === 'app.js') continue;
    stripComments(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
      if (/from '[^']*client'|api\/client|apiClient/.test(line)) return;  // import path
      if (/patient_id|patient_profiles|patient_count|'patient'|"patient"/.test(line)) return; // frozen DB values
      // No "is it in quotes?" filter: the leak this test exists to catch was
      // bare JSX text — `min until client taps OK.` — which has no quote and
      // no angle bracket on its own line. After comment stripping, any of
      // these words left in client source is worth a look.
      if (WORDS.test(line)) {
        bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
      }
    });
  }
  assert.deepStrictEqual(bad, [],
    `clinical/CRM wording in user-visible copy:\n    ${bad.join('\n    ')}`);
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
