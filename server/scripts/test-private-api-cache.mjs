import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { privateCacheKey, isPrivateApiRequest, clearPrivateApiCaches, PRIVATE_API_CACHE, CLEAR_PRIVATE_API_CACHES } from '../../client/src/utils/privateApiCache.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
let passed = 0;
function check(name, value) { assert.ok(value, name); passed++; console.log('  ✓ ' + name); }
const request = token => new Request('https://example.test/api/logs/2026-10-12', { headers: token ? { authorization: 'Bearer ' + token } : {} });
const a = request('member-a'), b = request('member-b');
const ka = await privateCacheKey({ request: a }), kb = await privateCacheKey({ request: b });
check('two sessions cannot share a private cache key', ka !== kb);
check('the same session can reopen its cached day', ka === await privateCacheKey({ request: a }));
check('access tokens are never embedded in cache URLs', !ka.includes('member-a') && !ka.includes('Bearer'));
check('the original network URL is never modified', a.url === 'https://example.test/api/logs/2026-10-12');
check('a rotated token receives a fresh partition', ka !== await privateCacheKey({ request: request('member-a-rotated') }));
check('authenticated GETs can retain offline reads', isPrivateApiRequest({ request: a, url: new URL(a.url) }));
check('anonymous requests cannot fall back to a member cache', !isPrivateApiRequest({ request: request(), url: new URL(a.url) }));
check('authentication responses are never cached', !isPrivateApiRequest({ request: a, url: new URL('https://example.test/api/auth/session') }));
await assert.rejects(() => privateCacheKey({ request: request() }));
check('missing identity is rejected when constructing a key', true);
const deleted = [];
await clearPrivateApiCaches({ keys: async () => ['api-cache', 'api-logs-cache', PRIVATE_API_CACHE, 'workbox-precache-v2'], delete: async key => deleted.push(key) });
check('sign-out clears both legacy caches and the private cache', deleted.length === 3 && deleted.includes(PRIVATE_API_CACHE));
check('sign-out keeps the offline app shell available', !deleted.includes('workbox-precache-v2'));
const previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
try {
  let notified = false, deletedAfterNotify = false, acknowledgementSent = false;
  const storage = { keys: async () => [PRIVATE_API_CACHE], delete: async () => { deletedAfterNotify = notified && acknowledgementSent; } };
  Object.defineProperty(globalThis, 'caches', { value: storage, configurable: true });
  const setController = controller => Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: { controller } }, configurable: true });
  setController({ postMessage(message, ports) {
    notified = message.type === CLEAR_PRIVATE_API_CACHES;
    acknowledgementSent = true;
    ports[0].postMessage({ cleared: true });
  } });
  await clearPrivateApiCaches();
  check('logout asks the worker to invalidate outstanding writes before page cleanup', deletedAfterNotify);
  let deletedOnFailure = false;
  storage.delete = async () => { deletedOnFailure = true; };
  setController({ postMessage() { throw new Error('worker stopped'); } });
  await clearPrivateApiCaches();
  check('a stopped worker cannot prevent page-side private cache cleanup', deletedOnFailure);
  deletedOnFailure = false;
  setController({ postMessage() {} });
  await clearPrivateApiCaches();
  check('an older worker without the clear message has a bounded cleanup fallback', deletedOnFailure);
} finally {
  if (previousCaches) Object.defineProperty(globalThis, 'caches', previousCaches); else delete globalThis.caches;
  if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator;
}
console.log(`Private API cache: ${passed} passed`);
