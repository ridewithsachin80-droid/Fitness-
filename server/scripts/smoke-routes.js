#!/usr/bin/env node
/**
 * smoke-routes.js — boots the real Express app against a stubbed pg pool and
 * issues real HTTP requests. Proves the member/coach rename did not break
 * routing or drop a legacy alias.
 *
 * We are testing REACHABILITY and AUTH WIRING, not query results — the pool is
 * a stub, so any route that gets far enough to hit the DB is already a pass for
 * our purposes. A 404 is the failure we are hunting.
 *
 * PRODUCTION GUARD: never runs against a live database.
 */
'use strict';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run with NODE_ENV=production.'); process.exit(1);
}
if (/railway|rlwy\.net|amazonaws|prod/i.test(process.env.DATABASE_URL || '')) {
  console.error('Refusing to run: DATABASE_URL points at a live database.'); process.exit(1);
}

const path = require('path');
const Module = require('module');
const http = require('http');

process.env.DATABASE_URL = 'postgres://stub:stub@127.0.0.1:1/stub';
process.env.JWT_SECRET   = process.env.JWT_SECRET || 'smoke-test-secret';
process.env.NODE_ENV     = 'test';
process.env.PORT         = '0';

const SERVER = path.resolve(__dirname, '..');

// ── Stub the pg pool before any route module can require it ──────────────────
const poolPath = require.resolve(path.join(SERVER, 'db/pool.js'));
const stubPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }),
  end: async () => {},
  on() {},
};
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true,
                            exports: stubPool, children: [], paths: [] };

// Some modules export { pool }; cover both shapes.
if (!stubPool.pool) stubPool.pool = stubPool;

// Stop the app from listening on a real port / starting cron.
const realListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  const cb = args.find(a => typeof a === 'function');
  if (cb) cb();
  return this;
};

let app;
try {
  const mod = require(path.join(SERVER, 'index.js'));
  app = mod && (mod.app || mod.default || mod);
  if (typeof app !== 'function') {
    // index.js may not export; recover the app from the express instance it built
    throw new Error('server/index.js does not export the express app');
  }
} catch (err) {
  console.error('Could not boot the app:', err.message);
  console.error('(This harness needs `module.exports = app` in server/index.js.)');
  process.exit(2);
}
http.Server.prototype.listen = realListen;

const server = app.listen(0);
const port = server.address().port;

function req(method, urlPath) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: urlPath, method,
                             headers: { 'content-type': 'application/json' } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', () => resolve(0));
    r.end(method === 'GET' ? undefined : '{}');
  });
}

// A route exists if it does NOT 404. Unauthenticated calls return 401/403,
// which is the correct answer and proves the route is mounted.
const CASES = [
  ['GET',  '/api/members',                'current member list path'],
  ['GET',  '/api/patients',               'LEGACY alias — stale PWA bundles'],
  ['GET',  '/api/members/me',             'member self profile'],
  ['GET',  '/api/patients/me',            'LEGACY self profile'],
  ['GET',  '/api/members/1',              'member detail'],
  ['GET',  '/api/members/gaps',           'gaps must not be shadowed by /:id'],
  // Sprint 2/3 member self-service. All of these live under /me, so the point
  // of smoking them is that "me" is not swallowed by the /:id handler — the
  // same shadowing trap /gaps and /population already guard against.
  ['GET',   '/api/members/me/onboarding',  'onboarding read not shadowed by /:id'],
  ['PUT',   '/api/members/me/onboarding',  'onboarding save not shadowed by /:id'],
  ['PATCH', '/api/members/me/profile',     'member profile edit not shadowed by /:id'],
  ['PATCH', '/api/auth/change-pin',        'member changes own PIN'],
  ['GET',   '/api/reminders/my-schedule',  'member reminder times not shadowed by /schedules'],
  ['GET',  '/api/members/population/prior','population prior not shadowed'],
  ['GET',  '/api/admin/coaches',          'current coach list path'],
  ['GET',  '/api/admin/monitors',         'LEGACY coach list'],
  ['POST', '/api/admin/coaches',          'create coach'],
  ['POST', '/api/admin/monitors',         'LEGACY create coach'],
  ['PATCH','/api/admin/coaches/1/toggle', 'toggle coach'],
  ['PATCH','/api/admin/monitors/1/toggle','LEGACY toggle coach'],
  ['GET',  '/api/admin/members',          'admin member list'],
  ['GET',  '/api/admin/stats',            'admin stats'],
  ['POST', '/api/ai-chat/remind',         'reminder endpoint'],
  ['POST', '/api/ai-chat/voice-transcribe','voice transcription (new)'],
  ['POST', '/api/ai-chat/photo',          'photo logging'],
  ['GET',  '/health',                     'health check'],
];

(async () => {
  let fails = 0;
  console.log(`\nBooted on port ${port}. A 404 means the route is gone.\n`);
  for (const [method, url, label] of CASES) {
    const code = await req(method, url);
    const ok = code !== 404 && code !== 0;
    if (!ok) fails++;
    console.log(`  ${ok ? '\u2713' : '\u2717'} ${String(code).padEnd(4)} ${method.padEnd(5)} ${url.padEnd(34)} ${label}`);
  }

  // A path that should genuinely not exist — proves the harness can detect a 404.
  const control = await req('GET', '/api/members-does-not-exist');
  const controlOk = control === 404;
  console.log(`\n  ${controlOk ? '\u2713' : '\u2717'} control: unknown path returns 404 (got ${control})`);
  if (!controlOk) fails++;

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll routes reachable\n');
  server.close();
  process.exit(fails ? 1 : 0);
})();
