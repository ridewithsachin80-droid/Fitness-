/**
 * scripts/test-push-vapid.js — VAPID key rotation must not silently kill push.
 *
 * THE FAILURE THIS PREVENTS
 * ------------------------
 * A PushSubscription is bound to the applicationServerKey it was created with.
 * Two things combined to make rotating the VAPID key an invisible, total
 * outage:
 *
 *   1. usePush.js called getSubscription() and reused whatever came back,
 *      never checking which key it belonged to. So after a rotation every
 *      existing member kept an undeliverable subscription forever.
 *
 *   2. pushService deactivated subscriptions on 410 and 404 only. A wrong-key
 *      send returns 403, which fell into the generic error branch: log
 *      failed=true, try again tomorrow, forever. Nothing surfaced to the
 *      member, the coach, or anyone reading the logs.
 *
 * Together: rotate the key, and push stops for everyone with no error anybody
 * would notice. The notification log would show sends going out every morning.
 *
 * This suite is pure — no database, no network.
 */
const { importClient } = require('./lib/client-bundle');
const fs   = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 200))); };

// The client module reads import.meta.env at load; give it something to read.
global.Notification = { permission: 'default' };

const { keyMatches } = importClient('hooks/usePush.js');

const bytes = (...n) => new Uint8Array(n);
/** A PushSubscription exposes the DECODED key as an ArrayBuffer. */
const subWith = (arr) => ({ options: { applicationServerKey: arr ? arr.buffer : null } });

console.log('\nVAPID key comparison (client)');

ck('an identical key matches',
   keyMatches(subWith(bytes(1, 2, 3, 4)), bytes(1, 2, 3, 4)) === true);

ck('a DIFFERENT key does not match — this is the rotation case that used to go unnoticed',
   keyMatches(subWith(bytes(1, 2, 3, 4)), bytes(9, 9, 9, 9)) === false);

ck('a key differing only in its last byte does not match',
   keyMatches(subWith(bytes(1, 2, 3, 4)), bytes(1, 2, 3, 5)) === false);

ck('a shorter key does not match', keyMatches(subWith(bytes(1, 2, 3)), bytes(1, 2, 3, 4)) === false);
ck('a longer key does not match',  keyMatches(subWith(bytes(1, 2, 3, 4, 5)), bytes(1, 2, 3, 4)) === false);

// Older browsers do not expose `options`. Churning a working subscription on
// every app open would be worse than assuming it is fine.
ck('a subscription with no options is left alone rather than churned',
   keyMatches({}, bytes(1, 2, 3)) === true);
ck('a null applicationServerKey is left alone', keyMatches(subWith(null), bytes(1, 2, 3)) === true);
ck('a null subscription does not throw', keyMatches(null, bytes(1, 2, 3)) === true);

console.log('\n403 handling (server)');

// Read as source: exercising it would need a live push endpoint, and the
// assertion that matters is which status codes reach the deactivate branch.
const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'pushService.js'), 'utf8');

ck('403 deactivates the subscription — a wrong-key send never recovers, so retrying it daily forever hides a total outage',
   /statusCode === 403/.test(src) &&
   /err\.statusCode === 410 \|\| err\.statusCode === 404 \|\| err\.statusCode === 403/.test(src));

ck('410 still deactivates', /err\.statusCode === 410/.test(src));
ck('404 still deactivates', /err\.statusCode === 404/.test(src));

ck('a 403 logs loudly, because it usually means EVERY subscription is dead at once',
   /VAPID key mismatch/.test(src));

ck('other errors are still retried rather than deactivated — a transient network failure must not kill a good subscription',
   /failed\) VALUES \(\$1,\$2,\$3,\$4,true\)/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
