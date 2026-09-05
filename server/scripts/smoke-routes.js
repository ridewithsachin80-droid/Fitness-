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
  ['GET',  '/api/members/morning-nudges',  'morning-nudges must not be shadowed by /:id'],
  ['GET',  '/api/members/1/morning-message', 'per-member morning message route exists'],
  // Voice logging. Mounted OUTSIDE /api/ai-chat because that router applies
  // authMW to everything in it, and this one uses a write-only token instead.
  ["POST", "/api/quick-log",         "voice logging endpoint is mounted"],
  ["GET",  "/api/quick-log/status",  "voice logging status is mounted"],
  // If this 404s, every Android member gets a browser URL bar overnight.
  ["GET",  "/.well-known/assetlinks.json", "digital asset links are served"],
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

  // ── The status code proves less than it looks like it does ─────────────────
  //
  // The loop above calls each route unauthenticated and accepts anything that
  // is not a 404. That is a weaker check than it reads as, in two ways:
  //
  //   1. `/foods/:id` matches "presets" as an id, so deleting `/foods/presets`
  //      returns the same 401 and the case above still passes.
  //   2. Worse — `routes/foods.js` and `routes/reminders.js` both call
  //      `router.use(authMW)` at the top. Router-level middleware runs BEFORE
  //      route matching, so an unauthenticated request to any path under those
  //      routers gets a 401 whether or not the route exists at all. For those
  //      two routers the 404 check can never fail.
  //
  // Both were verified by deleting the handler and watching this suite stay
  // green. So the literal routes are asserted against the registered Express
  // stack — method AND path — rather than inferred from a status code.
  //
  // Express 5 does not expose a mount path on the layer, so each router is
  // identified by a fingerprint route that only it declares.
  function layersFor(fingerprint) {
    const stack = (app._router || app.router)?.stack || [];
    for (const layer of stack) {
      if (!layer.handle?.stack) continue;
      const routes = layer.handle.stack.filter(l => l.route).map(l => ({
        path:    l.route.path,
        methods: Object.keys(l.route.methods || {}),
      }));
      if (routes.some(r => (Array.isArray(r.path) ? r.path : [r.path]).includes(fingerprint))) return routes;
    }
    return null;
  }
  const declares = (routes, method, p) => routes.some(r =>
    (Array.isArray(r.path) ? r.path : [r.path]).includes(p) && r.methods.includes(method));

  // [router fingerprint, method, path that must be registered]
  const REGISTERED = [
    ['/lookup',          'get',    '/presets'],
    ['/lookup',          'post',   '/presets'],
    ['/lookup',          'delete', '/presets/:id'],
    ['/lookup',          'get',    '/yesterday'],
    ['/my-notifications','get',    '/my-schedule'],
    ['/gaps',            'get',    '/me/today'],
    ['/gaps',            'get',    '/me/onboarding'],
    ['/gaps',            'put',    '/me/onboarding'],
    ['/gaps',            'patch',  '/me/profile'],
  ];
  for (const [fp, method, routePath] of REGISTERED) {
    const routes = layersFor(fp);
    const ok = !!routes && declares(routes, method, routePath);
    if (!ok) fails++;
    console.log(`  ${ok ? '\u2713' : '\u2717'} ${(method.toUpperCase() + ' ' + routePath).padEnd(30)} ` +
      (!routes ? `router not found (fingerprint ${fp})` : ok ? 'registered' : 'NOT REGISTERED — the 401 above came from middleware, not a route'));
  }

  // ── Ordering: literal paths must beat their parameterised sibling ──────────
  //
  // Registration alone is not enough: a literal declared after `/:id` never
  // runs, because Express matches in declaration order.
  const ORDER = [
    ['foods',   '/lookup',           '/presets',       '/:id'],
    ['foods',   '/lookup',           '/yesterday',     '/:id'],
    ['members', '/gaps',             '/me/today',      '/:id'],
    ['members', '/gaps',             '/me/onboarding', '/:id'],
    ['members', '/gaps',             '/me/profile',    '/:id'],
  ];

  for (const [name, fingerprint, literal, param] of ORDER) {
    const routes = layersFor(fingerprint);
    if (!routes) {
      console.log(`  \u2717 could not find the ${name} router (looked for ${fingerprint})`);
      fails++; continue;
    }
    const paths = routes.map(r => r.path);
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
