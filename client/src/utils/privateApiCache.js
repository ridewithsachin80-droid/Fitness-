/** Private API responses must never share a URL-only cache across accounts. */
export const PRIVATE_API_CACHE = 'fitlife-private-api-v2';
export const LEGACY_API_CACHES = ['api-cache', 'api-logs-cache'];

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
  const names = await storage.keys();
  await Promise.all(names.filter(name => name === PRIVATE_API_CACHE || LEGACY_API_CACHES.includes(name))
    .map(name => storage.delete(name)));
}
