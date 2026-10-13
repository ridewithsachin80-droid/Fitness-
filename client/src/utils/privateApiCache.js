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
  const bytes = new TextEncoder().encode(authorization);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const scope = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const url = new URL(request.url);
  url.searchParams.set('__fitlife_session', scope);
  return url.href;
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
