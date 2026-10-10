/**
 * scripts/test-progress-photos.js — Phase 4: weekly progress photos.
 *
 * Real Postgres and routes; R2 is a local stand-in that rejects any badly
 * signed request (scripts/lib/r2-standin.js). The AI transport is replaced by
 * a trap: these are body photos and must never reach a model.
 *
 * WHAT MUST HOLD (Sachin, 5 Oct 2026: member and coach see them; deleted after 12 months)
 *   A. A photo belongs to the week's Sunday; front, side and back; a retake
 *      replaces that pose and its old file is deleted.
 *   B. The member, their own coach and admin can see them; another member and
 *      another coach cannot.
 *   C. Photos are stored only in private storage and shown only through links
 *      that expire; nothing about them is ever sent to an AI model.
 *   D. A member can delete a photo; after 12 months they are deleted for them.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const path = require('path');
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
let aiCalls = 0;
const trap = async (url, body, cfg) => {
  if (/generativelanguage|groq|anthropic|openai/.test(String(url))) { aiCalls++; throw new Error('AI must not be called'); }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? trap : t[k]) });

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const storage = require('../services/storage');
const { startR2 } = require('./lib/r2-standin');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

(async () => {
  const KEYS = { id: 'AKIDTESTONLY0002', secret: 'progress-test-secret' };
  const R2 = await startR2(storage, KEYS);
  Object.assign(process.env, { R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: KEYS.id, R2_SECRET_ACCESS_KEY: KEYS.secret, R2_BUCKET: 'fitlife-test', R2_ENDPOINT: R2.endpoint });
  const pool = require('../db/pool');
  const routes = require('../routes/progressPhotos');
  const { getISTDate } = require('../utils/istDate');

  console.log('\n[0] which week a photo belongs to (no database)');
  ck('Sunday 4 Oct is its own week', routes.weekOf('2026-10-04') === '2026-10-04');
  ck('Monday 5 Oct and Saturday 10 Oct belong to Sunday 4 Oct', routes.weekOf('2026-10-05') === '2026-10-04' && routes.weekOf('2026-10-10') === '2026-10-04');
  ck('Sunday 11 Oct starts a new week', routes.weekOf('2026-10-11') === '2026-10-11');
  ck('across a month end', routes.weekOf('2026-11-03') === '2026-11-01');

  const app = express(); app.use(express.json({ limit: '15mb' })); app.use(cookieParser());
  app.use('/api/progress-photos', routes);
  const srv = app.listen(0); const port = srv.address().port;
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role) => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  const coach = await mk('Sachin', '9401', 'monitor'), other = await mk('Other Coach', '9402', 'monitor'), admin = await mk('Admin', '9403', 'admin');
  const member = await mk('Padmini', '9404', 'patient'), member2 = await mk('Someone Else', '9405', 'patient');
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true), ($3,$4,true)`, [coach, member, other, member2]);
  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const M = tok(member, 'patient'), M2 = tok(member2, 'patient'), C = tok(coach, 'monitor'), O = tok(other, 'monitor'), A = tok(admin, 'admin');
  const call = async (method, p, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const img = (s) => Buffer.from(s).toString('base64');
  const week = routes.weekOf(getISTDate());

  console.log('\n[1] the member takes this week\'s photos');
  let frontId;
  {
    ck('a pose other than front, side or back is refused', (await call('POST', '/api/progress-photos', M, { pose: 'selfie', image: img('x') })).status === 400);
    ck('a coach cannot upload a member\'s photo', (await call('POST', '/api/progress-photos', C, { pose: 'front', image: img('x') })).status === 403);
    for (const pose of ['front', 'side', 'back']) {
      const r = await call('POST', '/api/progress-photos', M, { pose, image: img(`${pose}-v1`), mimeType: 'image/jpeg' });
      if (pose === 'front') frontId = r.data.id;
      ck(`${pose}: saved to this week (${week})`, r.status === 200 && r.data.week === week && r.data.pose === pose && !!r.data.url, r.data);
    }
    const keys = [...R2.objects.keys()];
    ck('three files, private, under the member and the week', keys.length === 3 && keys.every(k => k.startsWith(`/fitlife-test/progress/${member}/${week}/`)), keys);
    ck('every storage request was correctly signed', R2.rejected === 0);
    const row = (await pool.query(`SELECT delete_after > NOW() + INTERVAL '364 days' AS long, delete_after < NOW() + INTERVAL '366 days' AS short FROM progress_photos WHERE id=$1`, [frontId])).rows[0];
    ck('each is set to be deleted after 12 months', row.long && row.short, row);
    ck('the database holds no photo, only where it is', (await pool.query(`SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_name='progress_photos' AND data_type IN ('bytea','text') AND column_name NOT IN ('object_key')`)).rows[0].n === 0);

    const before = R2.objects.size;
    const r = await call('POST', '/api/progress-photos', M, { pose: 'front', image: img('front-v2') });
    await new Promise(res => setTimeout(res, 100));
    ck('a retake replaces that pose: same row, new file, old file deleted', r.data.id === frontId && R2.objects.size === before && [...R2.objects.values()].some(b => b.toString() === 'front-v2') && ![...R2.objects.values()].some(b => b.toString() === 'front-v1'));
  }

  console.log('\n[2] who can see them');
  {
    const me = await call('GET', '/api/progress-photos/me', M);
    const w = me.data.weeks?.[0];
    ck('the member sees this week with all three poses', me.status === 200 && me.data.weeks.length === 1 && w.week === week && ['front', 'side', 'back'].every(p => w.photos[p]?.url), me.data);
    const link = await fetch(w.photos.side.url);
    ck('the link opens the photo', link.status === 200 && Buffer.from(await link.arrayBuffer()).toString() === 'side-v1');
    ck('the link expires after 5 minutes', new URL(w.photos.side.url).searchParams.get('X-Amz-Expires') === '300');
    const u = new URL(w.photos.side.url); u.searchParams.set('X-Amz-Expires', '999999');
    ck('a link with its expiry stretched is refused', (await fetch(u.toString())).status === 403);
    ck('the file without a signed link is refused', (await fetch(`${R2.endpoint}${new URL(w.photos.side.url).pathname}`)).status === 403);
    const c = await call('GET', `/api/progress-photos/member/${member}`, C);
    ck('their coach sees the same three photos', c.status === 200 && Object.keys(c.data.weeks[0].photos).sort().join() === 'back,front,side');
    ck('admin can see them', (await call('GET', `/api/progress-photos/member/${member}`, A)).status === 200);
    ck('another coach cannot', (await call('GET', `/api/progress-photos/member/${member}`, O)).status === 403);
    ck('another member cannot (no coach route for members)', (await call('GET', `/api/progress-photos/member/${member}`, M2)).status === 403);
    ck('another member\'s own list is empty', (await call('GET', '/api/progress-photos/me', M2)).data.weeks.length === 0);
    ck('another member cannot delete them', (await call('DELETE', `/api/progress-photos/${frontId}`, M2)).status === 404);
  }

  console.log('\n[3] storage down, deleting, and 12 months');
  {
    R2.down = true;
    let r = await call('POST', '/api/progress-photos', M, { pose: 'back', image: img('back-v2') });
    ck('storage down: a plain error, and the existing photo is kept', r.status === 502 && (await pool.query(`SELECT COUNT(*)::int n FROM progress_photos WHERE patient_id=$1`, [member])).rows[0].n === 3, r.data);
    r = await call('DELETE', `/api/progress-photos/${frontId}`, M);
    ck('storage down: delete refuses rather than leave the file behind', r.status === 502 && (await pool.query(`SELECT 1 FROM progress_photos WHERE id=$1`, [frontId])).rows.length === 1);
    R2.down = false;
    const before = R2.objects.size;
    r = await call('DELETE', `/api/progress-photos/${frontId}`, M);
    ck('the member deletes a photo: file and record both gone', r.status === 200 && R2.objects.size === before - 1 && (await pool.query(`SELECT 1 FROM progress_photos WHERE id=$1`, [frontId])).rows.length === 0);

    await pool.query(`UPDATE progress_photos SET delete_after = NOW() - INTERVAL '1 day' WHERE patient_id=$1 AND pose='side'`, [member]);
    const n = await routes.deleteExpiredProgressPhotos(pool);
    ck('past 12 months: deleted from storage and the database', n === 1 && R2.objects.size === before - 2 && (await pool.query(`SELECT COUNT(*)::int n FROM progress_photos WHERE patient_id=$1`, [member])).rows[0].n === 1);
    ck('running it again deletes nothing more', (await routes.deleteExpiredProgressPhotos(pool)) === 0);
    delete process.env.R2_BUCKET;
    r = await call('POST', '/api/progress-photos', M, { pose: 'side', image: img('x') });
    process.env.R2_BUCKET = 'fitlife-test';
    ck('storage not set up: says so plainly', r.status === 503 && /not set up/.test(r.data.error));
  }

  ck('no AI model was called at any point', aiCalls === 0, aiCalls);
  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-progress-photos: ${pass} passed, ${fail} failed\n`);
  srv.close(); R2.server.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
