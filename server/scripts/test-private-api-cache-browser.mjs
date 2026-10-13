/** Runs the real service worker with synthetic accounts on an ephemeral local origin. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { browserExecutable } from './lib/browser-executable.mjs';

const source = fileURLToPath(new URL('../../client/src/', import.meta.url));
const bundle = async (contents, defines = {}) => (await build({
  stdin: { contents, resolveDir: source }, bundle: true, write: false, format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', ...defines }, logLevel: 'silent',
})).outputFiles[0].text;
const worker = await bundle("import './sw.js';", { 'self.__WB_MANIFEST': '[]' });
const helpers = await bundle("import {clearPrivateApiCaches} from './utils/privateApiCache.js'; window.clearPrivateApiCaches=clearPrivateApiCaches;");
let mode = 'online', pass = 0, releaseHeld;
let requestHeld;
const held = new Promise(resolve => { requestHeld = resolve; });
const check = (name, value) => { assert.ok(value, name); pass++; console.log('  ✓ ' + name); };
async function within(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10000); })]); }
  finally { clearTimeout(timer); }
}
const server = http.createServer((req, res) => {
  if (req.url === '/sw.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(worker); return; }
  if (req.url === '/helpers.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(helpers); return; }
  if (req.url.startsWith('/api/')) {
    if (mode === 'offline') { req.socket.destroy(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = mode === 'unauthorized' ? 401 : mode === 'failure' ? 500 : 200;
    const respond = () => res.end(JSON.stringify({ owner: req.headers.authorization || 'anonymous', url: req.url, method: req.method }));
    if (req.url === '/api/logs/held') { releaseHeld = respond; requestHeld(); }
    else respond();
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>Private cache test</title><script src="/helpers.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: await browserExecutable(chromium), args: chromium.args, headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await within(page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  }), 'Service worker activation');
  const get = (token, url = '/api/logs/2026-10-13', method = 'GET') => page.evaluate(async ({ token, url, method }) => {
    try {
      const response = await fetch(url, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      return { status: response.status, body: await response.json() };
    } catch { return { networkError: true }; }
  }, { token, url, method });
  const waitForCache = count => page.waitForFunction(async expected => {
    const cache = await caches.open('fitlife-private-api-v2');
    return (await cache.keys()).length >= expected;
  }, {}, count);
  const cacheKeys = () => page.evaluate(async () => (await (await caches.open('fitlife-private-api-v2')).keys()).map(r => r.url));

  check('the real worker controls the test page', await page.evaluate(() => !!navigator.serviceWorker.controller));
  check('member A receives their own network response', (await get('member-a')).body?.owner === 'Bearer member-a');
  await waitForCache(1);
  mode = 'offline';
  check('member A can read their cached day offline', (await get('member-a')).body?.owner === 'Bearer member-a');
  check('member B cannot read member A day offline', (await get('member-b')).networkError);
  check('an anonymous request cannot read member A day offline', (await get(null)).networkError);
  check('a rotated token cannot reuse the previous session cache', (await get('member-a-rotated')).networkError);
  mode = 'online';
  check('member B receives their own network response', (await get('member-b')).body?.owner === 'Bearer member-b');
  await waitForCache(2);
  mode = 'offline';
  check('member B cached day remains separate from member A', (await get('member-b')).body?.owner === 'Bearer member-b');
  mode = 'unauthorized';
  check('HTTP 401 is returned instead of stale authenticated data', (await get('member-a')).status === 401);
  mode = 'failure';
  check('HTTP 500 remains a visible failure rather than a false success', (await get('member-a', '/api/logs/failure')).status === 500);
  mode = 'offline';
  check('failed responses do not become offline data', (await get('member-a', '/api/logs/failure')).networkError);
  mode = 'online';
  await get('member-a', '/api/auth/session');
  await get('member-a', '/api/logs/write', 'POST');
  const keys = await cacheKeys();
  check('authentication endpoints are absent from runtime cache', !keys.some(k => k.includes('/api/auth/')));
  check('POST requests are absent from runtime cache', !keys.some(k => k.includes('/api/logs/write')));
  check('cache URLs contain no raw access tokens', keys.every(k => !k.includes('member-a') && !k.includes('member-b') && !k.includes('Bearer')));
  await page.evaluate(async () => {
    await caches.open('api-cache'); await caches.open('api-logs-cache');
    await caches.open('fitlife-test-app-shell');
    await window.clearPrivateApiCaches();
  });
  const names = await page.evaluate(() => caches.keys());
  check('logout clears private and legacy response caches', !names.some(n => ['api-cache', 'api-logs-cache', 'fitlife-private-api-v2'].includes(n)));
  check('logout retains the app shell cache', names.includes('fitlife-test-app-shell'));
  mode = 'offline';
  check('cleared member data cannot be reopened offline after logout', (await get('member-a')).networkError);
  mode = 'online';
  await page.evaluate(() => { window.heldResponse = fetch('/api/logs/held', { headers: { Authorization: 'Bearer member-a' } }).then(r => r.json()); });
  await within(held, 'In-flight request');
  await page.evaluate(() => window.clearPrivateApiCaches());
  releaseHeld();
  await page.evaluate(() => window.heldResponse);
  // Cache writes finish independently of the response consumed by the page.
  await page.waitForFunction(async () => {
    const cache = await caches.open('fitlife-private-api-v2');
    return (await cache.keys()).some(r => r.url.includes('/api/logs/held'));
  }, { timeout: 1500 }).catch(() => {});
  check('a response already in flight cannot recreate private data after logout', !(await cacheKeys()).some(k => k.includes('/api/logs/held')));
  console.log(`Private API cache browser: ${pass} passed, 0 failed`);
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
