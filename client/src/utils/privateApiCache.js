/** Private API responses must never share a URL-only cache across accounts. */
export const PRIVATE_API_CACHE = 'fitlife-private-api-v2';
export const LEGACY_API_CACHES = ['api-cache', 'api-logs-cache'];
export const CLEAR_PRIVATE_API_CACHES = 'CLEAR_PRIVATE_API_CACHES';

export function isPrivateApiRequest({ url, request }) {
  return url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')
    && request.method === 'GET' && !!request.headers.get('authorization');
}

export async function privateCacheKey({ request }) {
  const authorization = request.headers.get('authorization');
  if (!authorization) throw new Error('Private cache requires an authenticated request');
  // A fresh token gets a fresh cache partition. Never put the token in a URL.
  const hex = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    b => b.toString(16).padStart(2, '0')).join('');
  const scope = await hex(authorization);
  // The partition is prefixed by who it belongs to (from the token's payload,
  // never verified here — it only groups this browser's own entries), so a
  // member's older sign-ins can be pruned without touching anyone else's.
  const member = memberOf(authorization);
  const prefix = (member == null ? scope : await hex('fitlife-member:' + member)).slice(0, 16);
  const url = new URL(request.url);
  url.searchParams.set('__fitlife_session', prefix + '.' + scope);
  return url.href;
}

function memberOf(authorization) {
  try {
    const part = String(authorization).replace(/^Bearer\s+/i, '').split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return json && (json.id ?? json.sub) != null ? String(json.id ?? json.sub) : null;
  } catch { return null; }
}

export async function clearPrivateApiCaches(storage = globalThis.caches) {
  if (!storage) return;
  // The worker may still be fetching an old member's response. Tell it to
  // invalidate those writes before deleting caches on the page. An older
  // worker might not know this message, so keep a bounded fallback.
  const controller = storage === globalThis.caches && globalThis.navigator?.serviceWorker?.controller;
  if (controller && globalThis.MessageChannel) await new Promise(resolve => {
    const channel = new MessageChannel();
    const done = () => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(); };
    const timer = setTimeout(done, 1000);
    channel.port1.onmessage = done;
    try { controller.postMessage({ type: CLEAR_PRIVATE_API_CACHES }, [channel.port2]); }
    catch { done(); }
  });
  const names = await storage.keys();
  await Promise.all(names.filter(name => name === PRIVATE_API_CACHE || LEGACY_API_CACHES.includes(name))
    .map(name => storage.delete(name)));
}

// The access token rotates every ~15 minutes and each token is its own cache
// partition, so without pruning every GET was stored again every 15 minutes
// until logout (16 Oct 2026). Keep one copy per URL per member — the newest
// sign-in's —
// and at most PRIVATE_CACHE_MAX entries overall.
export const PRIVATE_CACHE_MAX = 150;
export async function prunePrivateCache(cache, request, max = PRIVATE_CACHE_MAX) {
  const strip = href => { const u = new URL(href); u.searchParams.delete('__fitlife_session'); return u.href; };
  const owner = href => (new URL(href).searchParams.get('__fitlife_session') || '').split('.')[0];
  const keep = typeof request === 'string' ? request : request.url;
  const same = strip(keep), who = owner(keep);
  const keys = await cache.keys();
  // Only the SAME member's older sign-ins for this URL; other members' entries stay.
  await Promise.all(keys.filter(k => k.url !== keep && strip(k.url) === same && owner(k.url) === who).map(k => cache.delete(k)));
  const left = await cache.keys();
  if (left.length > max) await Promise.all(left.slice(0, left.length - max).map(k => cache.delete(k)));
}
