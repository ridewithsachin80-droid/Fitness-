/**
 * scripts/test-target-origin.js — coach-set targets versus FitLife standards
 * (Fixes-2j, 18 Oct 2026).
 *
 * Every profile starts with water_target 3000 (a database default), no sleep
 * times and no routine selection (null = every built-in item on). The member's
 * screens showed all of that as "Set by your coach". This suite checks, on a
 * real Postgres over real HTTP:
 *   - the new target_set_by column, empty for existing rows (nothing guessed);
 *   - the coach's water route records who set it, and "back to standard" forgets it;
 *   - the coach AI's water command records it too;
 *   - every response the member's app reads carries target_origin;
 *   - the server rule and the client rule (client/src/lib/day/targets.js) agree;
 *   - Plan's protocol mapping: a coach's routine selection is honoured.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const { importClient } = require('./lib/client-bundle');
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const server = require('../services/targetOrigin');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/patients', require('../routes/patients'));
app.use('/api/logs',     require('../routes/logs'));
app.use('/api/ai-chat',  require('../routes/aiChat'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n))
                            : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e === undefined ? '' : e).slice(0, 300))); };

(async () => {
  // The real client code, bundled the way test-day-lib loads it.
  const day = importClient('lib/day/index.js');
  const client = day;

  const mk = async (name, phone, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  const tag = String(Date.now()).slice(-7);
  const coach  = await mk('Coach Origin', `72${tag}1`, 'monitor');
  const member = await mk('Meera Origin', `72${tag}2`, 'patient');
  const old    = await mk('Old Member',   `72${tag}3`, 'patient');
  await pool.query(`INSERT INTO patient_profiles (user_id, height_cm) VALUES ($1,160)`, [member]);
  await pool.query(`INSERT INTO patient_profiles (user_id, height_cm, water_target) VALUES ($1,165,3500)`, [old]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true), ($1,$3,true)`, [coach, member, old]);

  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u, r) => jwt.sign({ id: u, role: r, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const call = async (method, p, t, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method, headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const C = tok(coach, 'monitor'), M = tok(member, 'patient');
  const patch = (body, id = member) => call('PATCH', `/api/patients/${id}/profile`, C, body);
  const row = async (id = member) => (await pool.query(`SELECT * FROM patient_profiles WHERE user_id=$1`, [id])).rows[0];
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const views = async () => {
    const log = await call('GET', `/api/logs/${today}`, M);
    const plan = await call('GET', '/api/patients/me/today', M);
    const me = await call('GET', '/api/patients/me', M);
    const coachView = await call('GET', `/api/patients/${member}`, C);
    return { log: log.data.protocol?.target_origin, plan: plan.data.profile?.target_origin, me: me.data.target_origin, coach: coachView.data.profile?.target_origin, status: [log.status, plan.status, me.status, coachView.status] };
  };

  try {
    console.log('\n[1] the column, and nothing guessed for existing rows');
    {
      const { rows } = await pool.query(`SELECT data_type, column_default FROM information_schema.columns WHERE table_name='patient_profiles' AND column_name='target_set_by'`);
      ck('patient_profiles.target_set_by is JSONB, empty by default', rows.length === 1 && rows[0].data_type === 'jsonb' && /'\{\}'/.test(rows[0].column_default || ''), rows);
      ck('a new member starts with no record, water 3000', JSON.stringify((await row()).target_set_by) === '{}' && (await row()).water_target === 3000, await row());
      const { rows: bad } = await pool.query(`SELECT count(*)::int AS n FROM patient_profiles WHERE target_set_by ? 'water' AND user_id IN ($1,$2)`, [member, old]);
      ck('no existing row is marked as coach-set by the migration', bad[0].n === 0, bad);
    }

    console.log('\n[2] before the coach sets anything: FitLife standards, everywhere the app reads');
    {
      const v = await views();
      ck('all four reads succeed', v.status.every(s => s === 200), v.status);
      const want = { water: 'standard', sleep: 'standard', macros: 'none', activities: 'standard', acv: 'standard', supplements: 'standard' };
      for (const k of ['log', 'plan', 'me', 'coach'])
        ck(`${k}: water, sleep and routine are standard; no macro targets`, JSON.stringify(v[k]) === JSON.stringify(want), v[k]);
    }

    console.log('\n[3] an existing member whose water is not the default is shown as coach-set');
    {
      ck('3500 ml with no record → coach (only a coach or admin can change it)', server.targetOrigin(await row(old)).water === 'coach', server.targetOrigin(await row(old)));
    }

    console.log('\n[4] the coach sets, keeps, and resets the water target');
    {
      const keep = await patch({ water_target: 3000 });
      const r = await row();
      ck('"Keep 3.0 L" saves 3000 and records who and when', keep.status === 200 && r.water_target === 3000 && r.target_set_by?.water?.by === coach && !!r.target_set_by?.water?.at, [keep.status, r.target_set_by]);
      ck('the response says water is now coach-set', keep.data.target_origin?.water === 'coach', keep.data.target_origin);
      const v = await views();
      ck('and every member read agrees', ['log', 'plan', 'me', 'coach'].every(k => v[k]?.water === 'coach'), v);
      const set = await patch({ water_target: 4200 });
      ck('a new value is stored and still recorded', set.status === 200 && (await row()).water_target === 4200 && (await row()).target_set_by?.water?.by === coach, await row());
      const reset = await patch({ water_target: null });
      const rr = await row();
      ck('"Go back to the FitLife standard" stores 3000 and forgets the record', reset.status === 200 && rr.water_target === 3000 && !('water' in (rr.target_set_by || {})), rr);
      ck('so it is standard again', server.targetOrigin(rr).water === 'standard' && (await views()).plan.water === 'standard');
      for (const [label, val] of [['9000 ml', 9000], ['100 ml', 100], ['text', 'lots'], ['2.5 (litres, not ml)', 2.5]]) {
        const b = await patch({ water_target: val });
        ck(`refused: ${label} → 400, nothing changed`, b.status === 400 && /500 and 8000/.test(b.data.error || '') && (await row()).water_target === 3000, [b.status, b.data.error]);
      }
      const both = await patch({ water_target: 3300, sleep_bed: '23:00', sleep_wake: '06:00' });
      ck('water and sleep in one save both land', both.status === 200 && (await row()).water_target === 3300 && (await row()).sleep_bed === '23:00', await row());
      ck('sleep with both times → coach', server.targetOrigin(await row()).sleep === 'coach');
    }

    console.log('\n[5] the coach AI\'s "water to 4.5 litres" records it too');
    {
      await patch({ water_target: null });
      const ops = { water_target: 4500, macros: null, target_weight: null, program: null, activities: null, acv: null, supplements: null, note: null, push: null, meal_plan: null };
      const r = await call('POST', '/api/ai-chat/coach-apply', C, { actions: [{ member_id: member, member_name: 'Meera Origin', resolved: true, is_all: false, ops }] });
      const s = await row();
      ck('applied: 4500 ml, recorded as set by this coach', r.status === 200 && s.water_target === 4500 && s.target_set_by?.water?.by === coach, [r.status, r.data?.error, s.water_target, s.target_set_by]);
    }

    console.log('\n[6] routine: null is "no selection yet"; any list is the coach\'s');
    {
      await pool.query(`UPDATE patient_profiles SET protocol_activities='["walk"]'::jsonb, protocol_acv='[]'::jsonb WHERE user_id=$1`, [member]);
      const o = server.targetOrigin(await row());
      ck('a chosen list → coach; an empty list → coach (they switched it all off); null → standard',
         o.activities === 'coach' && o.acv === 'coach' && o.supplements === 'standard', o);
      const plan = await call('GET', '/api/patients/me/today', M);
      const items = day.resolveProtocolItems(client.protocolFromProfile(plan.data.profile));
      ck('Plan now honours the selection: only the walk, no ACV (it listed every item before)',
         items.activeActivities.map(a => a.id).join() === 'walk' && items.activeACV.length === 0 && items.activeSupplements.length > 0,
         { act: items.activeActivities.map(a => a.id), acv: items.activeACV.length });
      const raw = day.resolveProtocolItems(plan.data.profile);
      ck('(read as-is, the raw row would still show every activity — the bug this fixes)', raw.activeActivities.length > 1, raw.activeActivities.length);
    }

    console.log('\n[7] the server rule and the client rule agree');
    {
      const rows = [
        { water_target: 3000 }, { water_target: 3000, target_set_by: { water: { by: 1 } } }, { water_target: 2500 }, { water_target: null },
        { sleep_bed: '22:00' }, { sleep_bed: '22:00', sleep_wake: '06:00' },
        { protocol_activities: null, protocol_acv: [], protocol_supplements: ['b12'] },
        { macro_pro: 90 }, { macro_kcal: 0 }, {},
      ];
      const keys = ['water', 'sleep', 'macros', 'activities', 'acv', 'supplements'];
      const diff = [];
      for (const r of rows) { const s = server.targetOrigin(r); for (const k of keys) if (s[k] !== client.targetOrigin(r, k)) diff.push({ r, k, server: s[k], client: client.targetOrigin(r, k) }); }
      ck(`same answer on ${rows.length} rows × ${keys.length} targets`, diff.length === 0, diff);
      ck('the client uses the server\'s answer when it has one', client.targetOrigin({ water_target: 3000, target_origin: { water: 'coach' } }, 'water') === 'coach');
      ck('AI text: a standard target says so; a coach target says the coach set it',
         /FitLife standard; the coach has not set one/.test(server.waterTargetText({ water_target: 3000 })) && /set by the coach/.test(server.waterTargetText({ water_target: 3500 })));
      ck('Plan header: nothing set → "FitLife starting plan"; something set → "Set by …"',
         /^FitLife starting plan/.test(client.planSourceLine({ water_target: 3000 })) && /^Set by Asha/.test(client.planSourceLine({ water_target: 3500 }, { coachName: 'Asha' })));
    }
  } finally {
    await pool.query(`DELETE FROM monitor_patients WHERE monitor_id=$1`, [coach]);
    await pool.query(`DELETE FROM patient_profiles WHERE user_id = ANY($1)`, [[member, old]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[coach, member, old]]).catch(() => {});
    srv.close();
  }
  console.log(`\n${fail ? '❌' : '✅'} target origin: ${pass} passed, ${fail} failed`);
  await pool.end(); process.exit(fail ? 1 : 0);
})().catch(async e => { console.error(e); process.exit(1); });
