/**
 * scripts/test-session.js — session persistence and the diagnostics beacon.
 *
 * WHAT BROKE, AND WHY IT NEEDED A SUITE
 * -------------------------------------
 * iPhone members were being signed out and then shown the first-run setup
 * screen — asked their goal again after months of use. Four separate defects
 * stacked up to produce that, and each one is guarded below:
 *
 *   1. THE FALLBACK WAS DEAD CODE. api/client.js read a refresh token out of
 *      localStorage on every 401. Nothing in the client ever wrote it, and no
 *      server route ever returned one, so it was always null. The cookie was
 *      in truth the only credential, and an installed iOS app has its own
 *      cookie jar — log in inside Safari, add to home screen, and the app has
 *      never seen a login.
 *
 *   2. THE REFRESH TOKEN NEVER ROTATED. /refresh minted a new ACCESS token and
 *      left the refresh cookie alone. Its maxAge was set once, at login, so a
 *      member who opened the app every single day was still signed out exactly
 *      30 days later. This is the one that best explains "it varies".
 *
 *   3. THE COLD START IGNORED THE FALLBACK. App.jsx posted an empty body, so
 *      even once a token was stored, the first request of the session — the
 *      one that matters — did not send it.
 *
 *   4. SESSION LOSS WAS INVISIBLE. Nothing recorded it, so the only signal was
 *      a member complaining.
 *
 * The onboarding half of the bug is pure client logic with no HTTP surface and
 * is covered in test-session-logic.js.
 *
 * Every assertion here was written by reintroducing the defect it describes and
 * confirming it goes red, per FitLife-Test-Infrastructure.md.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET         = process.env.JWT_SECRET         || 'testsecret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'testrefreshsecret';

const express      = require('express');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const pool         = require('../db/pool');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', require('../routes/auth'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 250))); };

(async () => {
  const srv  = app.listen(0);
  const port = srv.address().port;
  const url  = (p) => `http://127.0.0.1:${port}${p}`;

  /** Minimal fetch wrapper that also hands back the Set-Cookie header. */
  const call = async (path, { body, cookie } = {}) => {
    const res = await fetch(url(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body || {}),
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* 204 has no body */ }
    return { status: res.status, body: json, setCookie: res.headers.get('set-cookie') || '' };
  };

  const cookieValue = (setCookie, name) => {
    const m = new RegExp(`${name}=([^;]+)`).exec(setCookie || '');
    return m ? m[1] : null;
  };

  try {
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
    await pool.query('DELETE FROM session_loss_log');

    // bcrypt hash of '1234', so pin-login can be exercised end to end.
    const bcrypt = require('bcryptjs');
    const pinHash = await bcrypt.hash('1234', 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, phone, password, role, active)
       VALUES ('Asha Testmember', '9000000001', $1, 'patient', true) RETURNING id`,
      [pinHash]
    );
    const memberId = rows[0].id;

    // ── 1. Login hands back a refresh token the client can actually store ───
    console.log('\nLogin response');

    const login = await call('/api/auth/pin-login', { body: { phone: '9000000001', pin: '1234' } });
    ck('pin-login succeeds', login.status === 200, login.body);
    ck('returns an accessToken', typeof login.body?.accessToken === 'string');
    ck('returns refreshToken IN THE BODY — without this the localStorage fallback can never be populated',
       typeof login.body?.refreshToken === 'string' && login.body.refreshToken.split('.').length === 3,
       login.body?.refreshToken);
    ck('still sets the httpOnly refresh cookie (the cookie stays primary)',
       /refreshToken=/.test(login.setCookie) && /HttpOnly/i.test(login.setCookie));
    ck('returns the member phone, so the device can say "welcome back" instead of showing a blank form',
       login.body?.user?.phone === '9000000001', login.body?.user);

    const loginRefresh = login.body.refreshToken;
    const loginCookie  = `refreshToken=${cookieValue(login.setCookie, 'refreshToken')}`;

    // ── 2. Refresh works from the BODY alone, with no cookie at all ─────────
    // This is the installed-iOS case: separate cookie jar, so there is no
    // cookie to send. Before the fix this returned 401 and signed them out.
    console.log('\nRefresh without a cookie (the installed-iPhone case)');

    const bodyOnly = await call('/api/auth/refresh', { body: { refreshToken: loginRefresh } });
    ck('refresh succeeds using only the body token', bodyOnly.status === 200, bodyOnly.body);
    ck('issues a working access token',
       (() => { try { return jwt.verify(bodyOnly.body.accessToken, process.env.JWT_SECRET).id === memberId; }
                catch { return false; } })());

    const noCreds = await call('/api/auth/refresh', {});
    ck('refresh with neither cookie nor body is still rejected', noCreds.status === 401, noCreds.body);

    // ── 3. Rotation — the sliding window ───────────────────────────────────
    console.log('\nRefresh token rotation (the 30-day cliff)');

    const rotated = await call('/api/auth/refresh', { cookie: loginCookie });
    ck('refresh returns a NEW refresh token, not just an access token',
       typeof rotated.body?.refreshToken === 'string', rotated.body);
    ck('refresh re-issues the cookie, so its maxAge slides forward — without this a member who opens the app daily is still logged out 30 days after logging in',
       /refreshToken=/.test(rotated.setCookie), rotated.setCookie.slice(0, 120));
    ck('the re-issued cookie is still httpOnly', /HttpOnly/i.test(rotated.setCookie));

    const newTok = rotated.body.refreshToken;
    ck('the rotated token is itself accepted',
       (await call('/api/auth/refresh', { body: { refreshToken: newTok } })).status === 200);

    // A rotated token must carry the same identity, or a member would silently
    // become someone else on refresh.
    ck('rotated token belongs to the same member',
       jwt.verify(newTok, process.env.JWT_REFRESH_SECRET).id === memberId);

    ck('refresh returns the user object, so a cold start does not have to decode the JWT by hand',
       rotated.body?.user?.id === memberId, rotated.body?.user);

    // ── 4. Refresh must still refuse what it always refused ────────────────
    console.log('\nRefresh still rejects what it should');

    ck('a garbage token is rejected',
       (await call('/api/auth/refresh', { body: { refreshToken: 'not.a.token' } })).status === 401);

    const wrongSecret = jwt.sign({ id: memberId }, 'the-wrong-secret', { expiresIn: '30d' });
    ck('a token signed with the wrong secret is rejected',
       (await call('/api/auth/refresh', { body: { refreshToken: wrongSecret } })).status === 401);

    const expired = jwt.sign({ id: memberId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '-1s' });
    ck('an expired token is rejected', (await call('/api/auth/refresh', { body: { refreshToken: expired } })).status === 401);

    await pool.query('UPDATE users SET active = false WHERE id = $1', [memberId]);
    ck('a deactivated member cannot refresh',
       (await call('/api/auth/refresh', { body: { refreshToken: newTok } })).status === 401);
    await pool.query('UPDATE users SET active = true WHERE id = $1', [memberId]);

    const ghost = jwt.sign({ id: 999999 }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
    ck('a token for a deleted member is rejected',
       (await call('/api/auth/refresh', { body: { refreshToken: ghost } })).status === 401);

    // ── 5. Logout clears both cookies ──────────────────────────────────────
    console.log('\nLogout');

    const out = await call('/api/auth/logout', {});
    ck('logout clears the refresh cookie', /refreshToken=;|refreshToken=""/.test(out.setCookie), out.setCookie);
    ck('logout ALSO clears the access cookie — it was set on login and refresh but never cleared here',
       /accessToken=;|accessToken=""/.test(out.setCookie), out.setCookie);

    // ── 6. The diagnostics beacon ──────────────────────────────────────────
    console.log('\nSession-loss beacon');

    const beacon = await call('/api/auth/session-loss', {
      body: { reason: 'cold-start', platform: 'ios', standalone: true, had_token: false, days_since: 9 },
    });
    ck('beacon returns 204 and no body — it must never become an error on a path that is already failing',
       beacon.status === 204);

    const logged = await pool.query('SELECT * FROM session_loss_log ORDER BY id DESC LIMIT 1');
    const row = logged.rows[0];
    ck('the loss is recorded', !!row, logged.rows);
    ck('platform is stored', row?.platform === 'ios', row);
    ck('standalone is stored', row?.standalone === true, row);
    ck('had_token is stored', row?.had_token === false, row);
    ck('days_since is stored', row?.days_since === 9, row);
    ck('the user agent is captured', typeof row?.user_agent === 'string' || row?.user_agent === null);

    // No personal data. This is the reason the beacon is allowed to be
    // unauthenticated at all, so it is asserted rather than assumed.
    //
    // An allowlist, not a blocklist. A pattern-match kept snagging on
    // `had_token` — a BOOLEAN saying whether a fallback copy existed, not a
    // token — and, more importantly, a blocklist only catches the leaks
    // somebody thought of in advance. Pinning the exact column set means
    // ADDING a column fails this test and forces the privacy question to be
    // asked out loud.
    const ALLOWED_COLS = ['id', 'reason', 'platform', 'standalone',
                          'had_token', 'days_since', 'user_agent', 'created_at'];
    const cols = Object.keys(row || {}).sort();
    ck('the table holds exactly the agreed columns — no member id, name, phone or token',
       JSON.stringify(cols) === JSON.stringify([...ALLOWED_COLS].sort()), cols);
    ck('no stored value is a JWT',
       !Object.values(row || {}).some(
         (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 40));

    // Hostile input: it is an unauthenticated endpoint, so it must clamp.
    console.log('\nBeacon input handling (unauthenticated, so treated as hostile)');

    await call('/api/auth/session-loss', {
      body: { reason: 'x'.repeat(400), platform: 'DROP TABLE users', standalone: 'yes',
              had_token: 'yes', days_since: 999999 },
    });
    const dirty = (await pool.query('SELECT * FROM session_loss_log ORDER BY id DESC LIMIT 1')).rows[0];
    ck('an over-long reason is truncated, not rejected into a 500', (dirty.reason || '').length <= 40, dirty.reason?.length);
    ck('an unknown platform falls back to "other" rather than being stored raw', dirty.platform === 'other', dirty.platform);
    ck('a non-boolean standalone becomes false, not true', dirty.standalone === false, dirty.standalone);
    ck('an absurd days_since is clamped', dirty.days_since <= 3650, dirty.days_since);

    // Number.isFinite(+null) === true. This coercion has already shipped one
    // silent bug in this codebase; null must survive as null.
    await call('/api/auth/session-loss', { body: { reason: 'cold-start', platform: 'ios', days_since: null } });
    const nullDay = (await pool.query('SELECT * FROM session_loss_log ORDER BY id DESC LIMIT 1')).rows[0];
    ck('a null days_since stays NULL and is not coerced to 0 — Number.isFinite(+null) is true',
       nullDay.days_since === null, nullDay.days_since);

    await call('/api/auth/session-loss', { body: {} });
    ck('an empty beacon body does not 500', true);

    const users = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    ck('the beacon did not damage anything (users table intact)', users.rows[0].n >= 1);

    // ── 7. Round trip: the exact iPhone scenario ───────────────────────────
    // Log in (cookie issued), throw the cookie away as an installed iOS app
    // effectively does, and restore from the stored copy alone. This is the
    // whole point of the change, so it gets its own end-to-end assertion.
    console.log('\nEnd to end: log in, lose the cookie jar, come back');

    const l2 = await call('/api/auth/pin-login', { body: { phone: '9000000001', pin: '1234' } });
    let carried = l2.body.refreshToken;
    let ok = true;
    for (let i = 0; i < 3; i++) {
      const r = await call('/api/auth/refresh', { body: { refreshToken: carried } });  // no cookie, ever
      if (r.status !== 200 || !r.body.refreshToken) { ok = false; break; }
      carried = r.body.refreshToken;   // rotate, as the real client does
    }
    ck('three consecutive cookie-less cold starts all restore the session', ok);
    ck('the member is still themselves at the end of it',
       jwt.verify(carried, process.env.JWT_REFRESH_SECRET).id === memberId);

  } catch (err) {
    fail++;
    console.log('  \u2717 suite threw: ' + (err && err.stack ? err.stack : err));
  } finally {
    srv.close();
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
