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

// A fresh connection per request, and a body only where one is meaningful.
//
// Both matter. Node 22's global agent has keepAlive ON, so requests reuse a
// socket. A DELETE that sends a body no handler reads leaves that body
// unconsumed; Express responds and destroys the socket, and the NEXT request
// on the reused connection dies with ECONNRESET.
//
// That is exactly what happened: /api/foods/yesterday reported status 0 and
// looked like a missing route, when the real cause was the DELETE case above
// it in the list. The route was fine. A harness that mis-reports the case
// following any DELETE is worse than no harness, because it sends you looking
// for a bug that isn't there.
const agent = new http.Agent({ keepAlive: false });

function req(method, urlPath) {
  return new Promise((resolve) => {
    const sendsBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
    const headers = sendsBody ? { 'content-type': 'application/json' } : {};
    const r = http.request({ host: '127.0.0.1', port, path: urlPath, method,
                             headers, agent },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', () => resolve(0));
    r.end(sendsBody ? '{}' : undefined);
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
  // Sprint 5. /presets and /yesterday must be declared before /foods/:id or
  // they get parsed as a food id, and before router.use(role('admin')) or
  // members are locked out of their own saved meals.
  ['GET',    '/api/foods/presets',         'meal presets not shadowed by /foods/:id'],
  ['POST',   '/api/foods/presets',         'save a meal preset'],
  ['DELETE', '/api/foods/presets/1',       'delete a meal preset'],
  ['GET',    '/api/foods/yesterday',       'repeat yesterday not shadowed by /foods/:id'],
  ['GET',    '/api/members/me/today',      'dashboard aggregate not shadowed by /:id'],
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

  // ── Ordering: literal paths must beat their parameterised sibling ──────────
  //
  // A 401 does NOT prove a route exists. If /foods/presets were deleted,
  // /foods/:id would match "presets" as an id and return 401 too — so the
  // check above passes either way, and the label "not shadowed by /foods/:id"
  // was claiming something it could not see. Verified by deleting the route
  // and watching the suite stay green.
  //
  // Route ORDER is the thing that actually matters, so assert it directly
  // against the registered Express stack instead of inferring it from a status
  // code that is identical in both cases.
  // Express 5 no longer exposes a mount path on the layer, so each router is
  // identified by a route only it declares.
  const ORDER = [
    ['foods',   '/lookup', '/presets',       '/:id'],
    ['foods',   '/lookup', '/yesterday',     '/:id'],
    ['members', '/gaps',   '/me/today',      '/:id'],
    ['members', '/gaps',   '/me/onboarding', '/:id'],
    ['members', '/gaps',   '/me/profile',    '/:id'],
  ];

  function routePathsFor(fingerprint) {
    const stack = (app._router || app.router)?.stack || [];
    for (const layer of stack) {
      if (!layer.handle?.stack) continue;
      const paths = layer.handle.stack.filter(l => l.route).map(l => l.route.path);
      if (paths.includes(fingerprint)) return paths;
    }
    return null;
  }

  for (const [name, fingerprint, literal, param] of ORDER) {
    const paths = routePathsFor(fingerprint);
    if (!paths) {
      console.log(`  \u2717 could not find the ${name} router (looked for ${fingerprint})`);
      fails++; continue;
    }
    const iLit = paths.findIndex(p => p === literal || (Array.isArray(p) && p.includes(literal)));
    const iPar = paths.findIndex(p => p === param);
    const ok = iLit > -1 && (iPar === -1 || iLit < iPar);
    if (!ok) fails++;
    const why = iLit === -1 ? 'route is MISSING'
              : iPar > -1 && iLit > iPar ? `declared AFTER ${param} — it is shadowed`
              : `before ${param}`;
    console.log(`  ${ok ? '\u2713' : '\u2717'} ${(name + literal).padEnd(30)} ${why}`);
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
