/**
 * scripts/test-quick-log.js — the voice logging endpoint (sprint V0).
 *
 * WHY THESE RUN OVER HTTP
 * -----------------------
 * The apply rules are covered in test-member-apply.js by calling the service
 * directly. That is not enough here, and the morning-nudge work proved why:
 * `composeMorningMessages` passed every service-level test while the route
 * around it threw `ReferenceError: getISTDate is not defined` and returned 500
 * to every coach. A route can only be checked through a route.
 *
 * So these go through a real Express app with a real token, exercising the
 * middleware, the mount path and the response shape.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 * ------------------------------------
 * The parse itself. That needs the AI, which is stubbed per-suite elsewhere.
 * These assertions cover everything AROUND the parse: authentication, scope,
 * rate limiting, turn recording, and that a parse failure still produces a
 * sane spoken reply rather than an exception.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const express      = require('express');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const pool         = require('../db/pool');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 220))); };

(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/quick-log', require('../routes/quickLog'));

  const server = app.listen(0);
  const base   = `http://127.0.0.1:${server.address().port}`;

  const call = async (path, { method = 'POST', token, jwtTok, body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token)  headers.Authorization = `Bearer ${token}`;
    if (jwtTok) headers.Authorization = `Bearer ${jwtTok}`;
    const res = await fetch(base + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch (_) {}
    return { status: res.status, body: json };
  };

  try {
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
    const { rows } = await pool.query(
      `INSERT INTO users (name, phone, password, role, active)
       VALUES ('Voice Member','9000000501','x','patient',true) RETURNING id`);
    const memberId = rows[0].id;
    const memberJwt = jwt.sign({ id: memberId, role: 'patient', name: 'Voice Member' },
                               process.env.JWT_SECRET, { expiresIn: '1h' });

    // ── Issuing the token ─────────────────────────────────────────────────
    console.log('\nToken');
    const issued = await call('/api/quick-log/token', { jwtTok: memberJwt });
    ck('a member can set up voice logging', issued.status === 200, issued.body);
    const token = issued.body?.token;
    ck('a token is returned', typeof token === 'string' && token.length === 64, token && token.length);

    const status = await call('/api/quick-log/status', { method: 'GET', jwtTok: memberJwt });
    ck('status reports it enabled', status.body?.enabled === true, status.body);
    ck('status does NOT return the token — it is shown once and is not recoverable by design',
       !('token' in (status.body || {})), Object.keys(status.body || {}));

    // A coach must not be able to mint a member logging credential.
    const coachId = (await pool.query(
      `INSERT INTO users (name,email,password,role,active)
       VALUES ('Coach','c@x.com','x','monitor',true) RETURNING id`)).rows[0].id;
    const coachJwt = jwt.sign({ id: coachId, role: 'monitor', name: 'Coach' },
                              process.env.JWT_SECRET, { expiresIn: '1h' });
    ck('a coach cannot issue a voice token',
       (await call('/api/quick-log/token', { jwtTok: coachJwt })).status === 403);

    // ── Authentication ────────────────────────────────────────────────────
    console.log('\nAuthentication');
    ck('no token is rejected',
       (await call('/api/quick-log', { body: { text: 'two roti' } })).status === 401);
    ck('a wrong token is rejected',
       (await call('/api/quick-log', { token: 'x'.repeat(64), body: { text: 'two roti' } })).status === 401);
    ck('a short token is rejected without hitting the database',
       (await call('/api/quick-log', { token: 'abc', body: { text: 'two roti' } })).status === 401);

    const deactivated = await pool.query(`UPDATE users SET active=false WHERE id=$1`, [memberId]);
    ck('a deactivated member cannot log',
       (await call('/api/quick-log', { token, body: { text: 'two roti' } })).status === 401);
    await pool.query(`UPDATE users SET active=true WHERE id=$1`, [memberId]);

    // ── Rotation is revocation ────────────────────────────────────────────
    console.log('\nRotation and revocation');
    const second = await call('/api/quick-log/token', { jwtTok: memberJwt });
    const token2 = second.body?.token;
    ck('re-issuing gives a different token', token2 && token2 !== token);
    ck('the OLD token stops working — rotating IS how "turn off voice logging" works',
       (await call('/api/quick-log', { token, body: { text: 'x y' } })).status === 401);

    const revoked = await call('/api/quick-log/token', { method: 'DELETE', jwtTok: memberJwt });
    ck('a member can turn voice logging off', revoked.body?.revoked === true, revoked.body);
    ck('...and the token stops working immediately',
       (await call('/api/quick-log', { token: token2, body: { text: 'x y' } })).status === 401);
    ck('...and status reflects it',
       (await call('/api/quick-log/status', { method: 'GET', jwtTok: memberJwt })).body?.enabled === false);

    // Revoking voice access must NOT sign them out of the app — that is the
    // whole reason this credential is separate from the JWT.
    ck('revoking voice logging leaves the app login working',
       (await call('/api/quick-log/status', { method: 'GET', jwtTok: memberJwt })).status === 200);

    // ── Input handling ────────────────────────────────────────────────────
    console.log('\nInput handling');
    const live = (await call('/api/quick-log/token', { jwtTok: memberJwt })).body.token;

    const empty = await call('/api/quick-log', { token: live, body: { text: '' } });
    ck('an empty message is answered, not 500', empty.status === 200, empty.status);
    ck('...and says so in words a phone can read aloud',
       /did not catch/i.test(empty.body?.reply || ''), empty.body);

    const noBody = await call('/api/quick-log', { token: live, body: {} });
    ck('a missing text field does not throw', noBody.status === 200, noBody.status);

    // The AI is unreachable in this suite, so every real parse fails. That is
    // the useful case: a member must get a spoken sentence, never a stack
    // trace and never silence.
    const failed = await call('/api/quick-log', { token: live, body: { text: 'two roti and dal' } });
    ck('an AI failure still returns 200 with a spoken reply rather than an error page',
       failed.status === 200 && typeof failed.body?.reply === 'string', failed.body);
    ck('...and the reply carries no emoji, since it is read aloud',
       !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(failed.body.reply), failed.body.reply);
    ck('...and reports ok:false rather than claiming a save that did not happen',
       failed.body.ok === false, failed.body);

    // ── Every turn is recorded ────────────────────────────────────────────
    console.log('\nTurn recording');
    const turns = await pool.query(
      `SELECT * FROM quick_log_turns WHERE patient_id=$1 ORDER BY id`, [memberId]);
    ck('turns are recorded', turns.rows.length >= 1, turns.rows.length);
    ck('the member\'s own words are kept — this is the eval set for what people actually say',
       turns.rows.some(r => r.text === 'two roti and dal'), turns.rows.map(r => r.text));
    ck('a FAILED turn is recorded too — those are the ones worth reading later',
       turns.rows.some(r => r.outcome === 'error'), turns.rows.map(r => r.outcome));
    ck('the reply is stored alongside, so it can be replayed as conversation memory',
       turns.rows.every(r => typeof r.reply === 'string' && r.reply.length > 0));

    // ── Rate limiting ─────────────────────────────────────────────────────
    // A ceiling, not a security boundary: a stuck shortcut retrying in a loop
    // would otherwise fill the day's log and burn AI credits.
    console.log('\nRate limiting');
    let sawLimit = false;
    for (let i = 0; i < 35; i++) {
      const r = await call('/api/quick-log', { token: live, body: { text: `msg ${i}` } });
      if (r.status === 429) { sawLimit = true; break; }
    }
    ck('a runaway caller is stopped', sawLimit);

    // ── Scope ─────────────────────────────────────────────────────────────
    // The token can write a log and nothing else. If it leaks, the damage is a
    // wrong meal entry, not an account.
    console.log('\nToken scope');
    ck('the voice token cannot read voice-logging status (that needs a real login)',
       (await call('/api/quick-log/status', { method: 'GET', token: live })).status === 401);
    ck('the voice token cannot issue another token',
       (await call('/api/quick-log/token', { token: live })).status === 401);

    // ── The extraction itself ─────────────────────────────────────────────
    // parseMemberMessage was lifted out of the /parse route handler. Any `res`
    // left behind throws ReferenceError at RUN time, on a path nobody exercises
    // until the AI fails — which is exactly what happened: the error branch
    // still said `return res.status(statusToSend).json(...)`, so every AI
    // hiccup would have thrown for app users too, not just voice.
    //
    // A source check, because the alternative is only finding it during an
    // outage.
    console.log('\nParser extraction');
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../routes/aiChat.js'), 'utf8');
    const fnStart = src.indexOf('async function parseMemberMessage(');
    const fnEnd   = src.indexOf("router.post('/parse'", fnStart);
    const fnBody  = src.slice(fnStart, fnEnd);
    ck('parseMemberMessage references no `res` — it returns a value, it does not send one',
       !/\bres\./.test(fnBody));
    ck('...and no `req` either — it takes what it needs as arguments',
       !/\brequest\.|\breq\./.test(fnBody));
    ck('every error path returns a status marker the caller can act on',
       /__status/.test(fnBody));

    const { parseMemberMessage } = require('../routes/aiChat');
    ck('it is exported for voice logging to call', typeof parseMemberMessage === 'function');

    // With no AI configured this takes the error path — the one that used to
    // throw. It must return a value, not explode.
    const errResult = await parseMemberMessage({
      userId: memberId, message: 'two roti', context: { mealSlots: ['Lunch'] } });
    ck('the AI-failure path RETURNS rather than throwing (the bug this check exists for)',
       errResult && typeof errResult === 'object', errResult);
    ck('...carrying a status for the route to send', !!errResult.__status, errResult);

  } catch (err) {
    fail++;
    console.log('  \u2717 suite threw: ' + (err && err.stack ? err.stack : err));
  } finally {
    server.close();
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
