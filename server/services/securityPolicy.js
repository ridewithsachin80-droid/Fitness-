/**
 * services/securityPolicy.js — the production Content Security Policy.
 *
 * helmet's defaults, with images also allowed from:
 *   blob:   the member's own plate photo, previewed straight from the phone
 *   https://*.r2.cloudflarestorage.com   plate photos in private R2 storage,
 *           shown through signed links that expire after 5 minutes
 *
 * Before this, the coach's Off plan card showed a broken image: the policy
 * allowed images only from the site itself (img-src 'self' data:). Opening
 * the same link in its own tab worked, because a page you navigate to is not
 * an "image on this page".
 *
 * Scripts are untouched: still the site's own files only. Used by index.js
 * and by the real-browser check in scripts/ui-tests.mjs, so the test runs
 * against exactly the headers production sends.
 */
const helmet = require('helmet');

const PHOTO_HOSTS = ['https://*.r2.cloudflarestorage.com'];

function cspDirectives() {
  const d = helmet.contentSecurityPolicy.getDefaultDirectives();
  d['img-src'] = [...new Set([...(d['img-src'] || ["'self'", 'data:']), 'blob:', ...PHOTO_HOSTS])];
  return d;
}

/** helmet options: the policy in production, none in development (as before). */
function helmetOptions(env = process.env) {
  return { contentSecurityPolicy: env.NODE_ENV === 'production' ? { useDefaults: false, directives: cspDirectives() } : false };
}

module.exports = { cspDirectives, helmetOptions, PHOTO_HOSTS };
