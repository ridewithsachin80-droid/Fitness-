/**
 * scripts/test-plate-photo.js — Phase 3: a plate photo checked against the plan.
 *
 * Real Postgres and real routes. Two stand-ins: the vision model (axios
 * stubbed, routed on the prompt's fixed opening words) and R2 (a local HTTP
 * server that keeps objects in memory and REJECTS any request whose AWS
 * signature does not verify).
 *
 * WHAT MUST HOLD
 *   A. The signatures match the official AWS SDK's for the same inputs.
 *   B. Each planned item is marked as planned / less / more / not seen, and
 *      what is not in the plan is an extra, by fixed arithmetic.
 *   C. A meal is flagged to the coach only when its extras come to MORE than
 *      100 kcal, or a different meal was eaten instead.
 *   D. The photo is stored privately and shown only through a link that
 *      expires; a storage failure never loses the check.
 *   E. A coach sees only their own members' flagged meals, and "Seen" takes
 *      one off. Photos past their date are deleted from storage.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'stub-key';

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const http = require('http'), path = require('path');

const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
let visionAnswer = null, visionCalls = 0, lastVisionPrompt = '';
const stubbedPost = async (url, body, cfg) => {
  if (String(url).includes('generativelanguage')) {
    const text = body?.contents?.[0]?.parts?.[0]?.text || '';
    if (text.startsWith('You are checking a photo of a member')) {
      visionCalls++; lastVisionPrompt = text;
      if (visionAnswer === 'down') { const e = new Error('500'); e.response = { status: 500 }; throw e; }
      return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify(visionAnswer) }] } }] } };
    }
    return { data: { candidates: [{ content: { parts: [{ text: '{"foods":[]}' }] } }] } };
  }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const storage = require('../services/storage');
const PP = require('../services/platePhoto');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

// ── R2 stand-in: verifies every signature with the shared secret ─────────────
const R2 = { objects: new Map(), rejected: 0, down: false };
const KEYS = { id: 'AKIDTESTONLY0001', secret: 'test-secret-not-real' };
function startR2() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const u = new URL(req.url, 'http://x');
        if (R2.down) { res.writeHead(500); return res.end(); }
        let ok = false;
        if (u.searchParams.get('X-Amz-Signature')) {
          // A signed link: re-sign the same request and compare; and expiry.
          const amz = u.searchParams.get('X-Amz-Date');
          const t = Date.UTC(+amz.slice(0, 4), +amz.slice(4, 6) - 1, +amz.slice(6, 8), +amz.slice(9, 11), +amz.slice(11, 13), +amz.slice(13, 15));
          const expires = +u.searchParams.get('X-Amz-Expires');
          const again = new URL(storage.presignGet({ host: req.headers.host, path: u.pathname, protocol: 'http:', accessKeyId: KEYS.id, secret: KEYS.secret, expires, now: new Date(t) }));
          ok = again.searchParams.get('X-Amz-Signature') === u.searchParams.get('X-Amz-Signature') && Date.now() <= t + expires * 1000;
        } else {
          const amz = req.headers['x-amz-date'] || '';
          const t = Date.UTC(+amz.slice(0, 4), +amz.slice(4, 6) - 1, +amz.slice(6, 8), +amz.slice(9, 11), +amz.slice(11, 13), +amz.slice(13, 15));
          const headers = req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {};
          const again = storage.signHeaders({ method: req.method, host: req.headers.host, path: u.pathname, headers,
            payloadHash: storage.sha256hex(body), accessKeyId: KEYS.id, secret: KEYS.secret, now: new Date(t) });
          ok = again.authorization === req.headers.authorization && req.headers['x-amz-content-sha256'] === storage.sha256hex(body);
        }
        if (!ok) { R2.rejected++; res.writeHead(403); return res.end('SignatureDoesNotMatch'); }
        if (req.method === 'PUT') { R2.objects.set(u.pathname, body); res.writeHead(200); return res.end(); }
        if (req.method === 'GET') { const b = R2.objects.get(u.pathname); if (!b) { res.writeHead(404); return res.end(); } res.writeHead(200); return res.end(b); }
        if (req.method === 'DELETE') { R2.objects.delete(u.pathname); res.writeHead(204); return res.end(); }
        res.writeHead(405); res.end();
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  console.log('\n[0] signatures match the official AWS SDK');
  {
    // Produced with @aws-sdk/signature-v4 and @aws-sdk/s3-request-presigner for these exact inputs.
    const creds = { accessKeyId: 'AKIDEXAMPLE12345', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
    const now = new Date('2026-10-05T06:35:00Z');
    const host = '742fca821afd3f30f29c218d3789f863.r2.cloudflarestorage.com';
    const p = '/fitlife-test/meals/214/2026-10-05/ab12-cd34.jpg';
    const put = storage.signHeaders({ method: 'PUT', host, path: p, headers: { 'content-type': 'image/jpeg' },
      payloadHash: storage.sha256hex(Buffer.from('hello photo')), ...creds, now });
    ck('an upload signature is the one the AWS SDK makes', /Signature=6503a54fcb0220b90ce2516a43201eeb51fd852290b0f195dae802eaadc4ab51$/.test(put.authorization), put.authorization);
    ck('scoped to the R2 region "auto" and the S3 service', /Credential=AKIDEXAMPLE12345\/20261005\/auto\/s3\/aws4_request/.test(put.authorization));
    const link = new URL(storage.presignGet({ host, path: p, ...creds, expires: 300, now,
      extraQuery: { 'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD', 'x-amz-checksum-mode': 'ENABLED', 'x-id': 'GetObject' } }));
    ck('a photo link signature is the one the AWS S3 presigner makes', link.searchParams.get('X-Amz-Signature') === 'dc14fa9452cda6b3d2ffd196b862624e0645a0bfe29273359fcf7d87303975f2', link.searchParams.get('X-Amz-Signature'));
    ck('the link expires after 5 minutes', link.searchParams.get('X-Amz-Expires') === '300');
    ck('not configured without all four variables', storage.isConfigured({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c' }) === false
       && storage.isConfigured({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd' }) === true);
    ck('the endpoint comes from the account id', storage.config({ R2_ACCOUNT_ID: 'abc', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd' }).endpoint === 'https://abc.r2.cloudflarestorage.com');
  }

  console.log('\n[1] what the photo shows vs the plan (no database)');
  const meal2 = { meal: 'Meal 2', time: '16:00', items: [
    { name: 'Whey protein', grams: 30, per_100g: { calories: 400 } }, { name: 'Almonds', grams: 20, per_100g: { calories: 579 } },
    { name: 'Guava', grams: 150, per_100g: { calories: 68 } }, { name: 'Buttermilk', grams: 200, per_100g: { calories: 40 } }] };
  const PHOTO = { looks_like_meal: true,
    planned: [{ i: 0, seen: true, grams: 30 }, { i: 1, seen: true, grams: 25 }, { i: 2, seen: true, grams: 100 }, { i: 3, seen: false }],
    extras: [{ name: 'banana chips', grams: 30, kcal_100g: 520, protein_100g: 2, carbs_100g: 58, fat_100g: 32 }] };
  {
    const a = PP.analyse(meal2, PHOTO);
    const st = Object.fromEntries(a.planned.map(p => [p.name, p.status]));
    ck('30 g of 30 g: as planned', st['Whey protein'] === 'as_planned');
    ck('25 g of 20 g (125%): more', st.Almonds === 'more');
    ck('100 g of 150 g (67%): less', st.Guava === 'less');
    ck('not in the photo: not seen, keeping the planned grams to log if they had it', st.Buttermilk === 'not_seen' && a.planned[3].grams === 200);
    ck('banana chips are an extra, 156 kcal', a.extras.length === 1 && a.extras[0].kcal === 156, a.extras);
    ck('it matches the meal', a.matches === true);
    ck('a plate with none of the planned items and other food is NOT this meal', PP.analyse(meal2, { planned: [], extras: [{ name: 'idli', grams: 120, kcal_100g: 130 }] }).matches === false);
    const oneItem = { meal: 'Breakfast', items: [{ name: 'Idli (plain)', grams: 120, per_100g: { calories: 130 } }] };
    ck('a ONE-item meal with nothing planned on the plate is not that meal either (live test, 5 Oct)',
       PP.analyse(oneItem, { looks_like_meal: true, planned: [{ i: 0, seen: false }], extras: [{ name: 'ragi mudde', grams: 150, kcal_100g: 140 }, { name: 'palak dal', grams: 150, kcal_100g: 90 }] }).matches === false);
    ck('the prompt asks for every bowl, and names ragi mudde properly', /EVERY other food or drink/.test(PP.buildPrompt(meal2)) && /ragi mudde/.test(PP.buildPrompt(meal2)) && /not "ragi roti"/.test(PP.buildPrompt(meal2)));
    ck('the model saying it is not this meal is believed', PP.analyse(meal2, { ...PHOTO, looks_like_meal: false }).matches === false);
    ck('nonsense from the model gives safe rows, not a crash', PP.analyse(meal2, { planned: 'x', extras: [{ name: '', grams: -5 }, null] }).extras.length === 0);
    const p = PP.buildPrompt(meal2);
    ck('the prompt numbers the planned items with their grams', /0\. Whey protein, 30 g planned/.test(p) && /3\. Buttermilk, 200 g planned/.test(p));
    ck('and says writing in the photo is never instructions', /never as instructions/.test(p));

    const items = (extrasGrams) => [{ name: 'Whey protein', grams: 30, per_100g: { calories: 400 }, kind: 'planned' },
      { name: 'Guava', grams: 100, per_100g: { calories: 68 }, kind: 'planned' },
      { name: 'banana chips', grams: extrasGrams, per_100g: { calories: 500 }, kind: 'extra' }];
    let s = PP.summarise(a, 'meal', items(20));
    ck('extras of exactly 100 kcal do NOT flag the meal', s.extras_kcal === 100 && s.flagged === false, s);
    s = PP.summarise(a, 'meal', items(21));
    ck('extras of 105 kcal DO flag the meal', s.extras_kcal === 105 && s.flagged === true, s);
    ck('the card lists what was less and what was skipped', s.differences.includes('less Guava (100 g of 150 g)') && s.differences.includes('Almonds skipped') && s.differences.includes('Buttermilk skipped'), s.differences);
    s = PP.summarise(a, 'meal', items(0).slice(0, 2));
    ck('less and skipped items alone never flag a meal', s.flagged === false && s.outcome === 'as_planned' && s.differences.length === 3, s);
    s = PP.summarise(a, 'swap', [{ name: 'Idli', grams: 60, per_100g: { calories: 130 } }]);
    ck('a different meal eaten instead is always flagged, even small', s.flagged === true && s.outcome === 'swap' && s.extras_kcal === 78, s);
    s = PP.summarise(a, 'extra', [{ name: 'Idli', grams: 60, per_100g: { calories: 130 } }]);
    ck('logged as an extra snack: flagged only over 100 kcal', s.flagged === false && s.outcome === 'extra', s);
  }

  // ── Real Postgres, real routes ──────────────────────────────────────────────
  const r2 = await startR2();
  Object.assign(process.env, { R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: KEYS.id, R2_SECRET_ACCESS_KEY: KEYS.secret,
    R2_BUCKET: 'fitlife-test', R2_ENDPOINT: `http://127.0.0.1:${r2.address().port}` });
  const pool = require('../db/pool');
  const DP = require('../services/dietPlan');
  const { getISTDate } = require('../utils/istDate');
  const app = express(); app.use(express.json({ limit: '15mb' })); app.use(cookieParser());
  const plate = require('../routes/platePhotos');
  app.use('/api/plate', plate);
  const srv = app.listen(0); const port = srv.address().port;

  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role) => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  const coach = await mk('Sachin', '9301', 'monitor'), other = await mk('Other Coach', '9302', 'monitor');
  const admin = await mk('Admin', '9303', 'admin');
  const member = await mk('Padmini', '9304', 'patient'), member2 = await mk('Not Yours', '9305', 'patient');
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true), ($3,$4,true)`, [coach, member, other, member2]);
  await pool.query(`INSERT INTO patient_profiles (user_id, macro_kcal) VALUES ($1, 1500), ($2, 1600)`, [member, member2]);
  const today = getISTDate();
  for (const m of [member, member2]) {
    await pool.query(`INSERT INTO meal_plans (patient_id, monitor_id, plan_date, meal, items) VALUES ($1,$2,$3,'Meal 2',$4)`,
      [m, coach, today, JSON.stringify(meal2.items.map(it => ({ ...it, qty_text: `${it.grams} g` })))]);
  }
  await pool.query(`INSERT INTO daily_logs (patient_id, log_date, food_items) VALUES ($1,$2,$3)`,
    [member, today, JSON.stringify([{ name: 'Curd', grams: 200, meal: 'Meal 1', per_100g: { calories: 60 } }])]);
  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const M = tok(member, 'patient'), M2 = tok(member2, 'patient'), C = tok(coach, 'monitor'), O = tok(other, 'monitor'), A = tok(admin, 'admin');
  const call = async (method, p, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const IMG = Buffer.from('fake-jpeg-bytes-for-the-test').toString('base64');

  console.log('\n[2] the member snaps their plate');
  let photoId;
  {
    visionAnswer = PHOTO;
    ck('a coach cannot use the member check', (await call('POST', '/api/plate/check', C, { image: IMG, meal: 'Meal 2' })).status === 403);
    ck('a meal not in today\'s plan is refused, without calling the model', (await call('POST', '/api/plate/check', M, { image: IMG, meal: 'Dinner' })).status === 409 && visionCalls === 0);
    const r = await call('POST', '/api/plate/check', M, { image: IMG, mimeType: 'image/jpeg', meal: 'meal 2' });
    photoId = r.data.photo_id;
    ck('the check returns the rows for Meal 2', r.status === 200 && r.data.meal === 'Meal 2' && r.data.planned.length === 4 && r.data.extras.length === 1, r.data);
    ck('the model was given the plan\'s items, once', visionCalls === 1 && /2\. Guava, 150 g planned/.test(lastVisionPrompt));
    ck('the photo is stored privately under the member and the day', r.data.photo_saved === true && [...R2.objects.keys()].some(k => k.startsWith(`/fitlife-test/meals/${member}/${today}/`)), [...R2.objects.keys()]);
    ck('every storage request was correctly signed', R2.rejected === 0, R2.rejected);
    const link = await fetch(r.data.photo_url);
    ck('the photo link opens the photo', link.status === 200 && Buffer.from(await link.arrayBuffer()).toString() === 'fake-jpeg-bytes-for-the-test', link.status);
    const u = new URL(r.data.photo_url); u.searchParams.set('X-Amz-Expires', '99999');
    ck('a link with its expiry changed is refused', (await fetch(u.toString())).status === 403);
    ck('the bucket path without a signature is refused', (await fetch(`${process.env.R2_ENDPOINT}${new URL(r.data.photo_url).pathname}`)).status === 403);
    const row = (await pool.query(`SELECT status, flagged, delete_after > NOW() + INTERVAL '89 days' AS long FROM meal_photos WHERE id=$1`, [photoId])).rows[0];
    ck('recorded as checked, not yet flagged, kept for 90 days', row.status === 'checked' && row.flagged === false && row.long === true, row);
    ck('another member cannot confirm it', (await call('POST', `/api/plate/${photoId}/confirm`, M2, { as: 'meal', items: [] })).status === 404);
  }

  console.log('\n[3] storage or the model failing');
  {
    R2.down = true;
    const r = await call('POST', '/api/plate/check', M, { image: IMG, meal: 'Meal 2' });
    R2.down = false;
    ck('storage down: the check still works, the photo is just not kept', r.status === 200 && r.data.photo_saved === false && r.data.photo_url === null, r.data);
    visionAnswer = 'down';
    const v = await call('POST', '/api/plate/check', M, { image: IMG, meal: 'Meal 2' });
    visionAnswer = PHOTO;
    ck('the model down: a plain error that offers "log the meal as planned"', v.status === 502 && /log the meal as planned/.test(v.data.error), v.data);
  }

  console.log('\n[4] the member logs it; the coach\'s feed');
  {
    const items = [{ name: 'Whey protein', grams: 30, per_100g: { calories: 400 }, kind: 'planned' },
      { name: 'Guava', grams: 100, per_100g: { calories: 68 }, kind: 'planned' },
      { name: 'banana chips', grams: 30, per_100g: { calories: 520 }, kind: 'extra' }];
    let r = await call('POST', `/api/plate/${photoId}/confirm`, M, { as: 'meal', items });
    ck('confirming with 156 kcal of extras flags the meal', r.status === 200 && r.data.flagged === true, r.data);
    r = await call('GET', '/api/plate/off-plan', C);
    const card = r.data.items?.[0];
    ck('the coach sees one card for Padmini\'s Meal 2', r.status === 200 && r.data.items.length === 1 && card.name === 'Padmini' && card.meal === 'Meal 2', r.data);
    ck('with the extras, their calories and the differences', card.extras[0].name === 'banana chips' && card.extras_kcal === 156 && card.differences.includes('Buttermilk skipped'), card);
    ck('and the day so far against her target', card.day_kcal === 120 && card.target_kcal === 1500, [card.day_kcal, card.target_kcal]);
    ck('and a photo link that opens', card.photo_url && (await fetch(card.photo_url)).status === 200);
    ck('another coach does not see it', (await call('GET', '/api/plate/off-plan', O)).data.items.length === 0);
    ck('nor can they mark it seen', (await call('POST', `/api/plate/${photoId}/seen`, O)).status === 404);
    ck('a member cannot read the feed', (await call('GET', '/api/plate/off-plan', M)).status === 403);

    // A small extra (60 kcal) is logged quietly.
    const q = await call('POST', '/api/plate/check', M, { image: IMG, meal: 'Meal 2' });
    await call('POST', `/api/plate/${q.data.photo_id}/confirm`, M, { as: 'meal', items: [items[0], { name: 'roasted chana', grams: 15, per_100g: { calories: 400 }, kind: 'extra' }] });
    ck('a meal with 60 kcal of extras does not reach the feed', (await call('GET', '/api/plate/off-plan', C)).data.items.length === 1);
    ck('a check never confirmed does not reach the feed either', (await pool.query(`SELECT COUNT(*)::int n FROM meal_photos WHERE status='checked'`)).rows[0].n >= 1);

    r = await call('POST', `/api/plate/${photoId}/seen`, C);
    ck('"Seen" takes the card off the feed', r.status === 200 && (await call('GET', '/api/plate/off-plan', C)).data.items.length === 0);
  }

  console.log('\n[5] admin storage check, and the 90-day cleanup');
  {
    let r = await call('GET', '/api/plate/storage-check', A);
    ck('the admin storage check uploads, reads back and deletes', r.status === 200 && r.data.ok === true && r.data.bucket === 'fitlife-test', r.data);
    ck('and leaves nothing behind', ![...R2.objects.keys()].some(k => k.includes('healthcheck/')));
    ck('a coach cannot run it', (await call('GET', '/api/plate/storage-check', C)).status === 403);
    const savedKey = process.env.R2_SECRET_ACCESS_KEY; process.env.R2_SECRET_ACCESS_KEY = 'wrong';
    r = await call('GET', '/api/plate/storage-check', A);
    process.env.R2_SECRET_ACCESS_KEY = savedKey;
    ck('with a wrong key it says the upload failed, plainly', r.data.ok === false && r.data.step === 'upload' && /403/.test(r.data.error), r.data);

    const before = R2.objects.size;
    await pool.query(`UPDATE meal_photos SET delete_after = NOW() - INTERVAL '1 day' WHERE id = $1`, [photoId]);
    const n = await plate.deleteExpiredPhotos(pool);
    const row = (await pool.query(`SELECT object_key FROM meal_photos WHERE id=$1`, [photoId])).rows[0];
    ck('a photo past its date is deleted from storage and unlinked', n === 1 && R2.objects.size === before - 1 && row.object_key === null, [n, R2.objects.size, before, row]);
    ck('running it again deletes nothing more', (await plate.deleteExpiredPhotos(pool)) === 0);
    ck('photos still in date are untouched', R2.objects.size === before - 1 && R2.objects.size > 0);
  }

  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-plate-photo: ${pass} passed, ${fail} failed\n`);
  srv.close(); r2.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
