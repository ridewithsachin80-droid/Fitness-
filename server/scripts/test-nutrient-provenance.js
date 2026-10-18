/**
 * scripts/test-nutrient-provenance.js — missing is not zero, every value says
 * where it came from, and the enrichment pilot is safe (Fixes-2k, 18 Oct 2026).
 *
 * Real Postgres, real routes over real HTTP:
 *   [1] storage: missing → null; the AI's values are AI estimates; a coach's
 *       typed values (an explicit 0 too) are recorded; an edit marks only what changed
 *   [2] reads: a food handed to the app carries its statuses; old rows read by the legacy rule
 *   [3] server and client agree on every status
 *   [4] enrichment rules: eligibility, protected values, units, basis, raw/cooked,
 *       reference evidence, recipe working, AI claims
 *   [5] a batch: propose (changes nothing), apply, skip what changed, roll back,
 *       refuse a rollback over a later edit; member logs untouched
 *   [6] who may do what; the inventory is read-only
 *   [7] member and coach read the same status for the same food
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { importClient } = require('./lib/client-bundle');
const { normaliseNutrients } = require('../services/nutrients');
const S = require('../services/nutrientStatus');
const E = require('../services/nutrientEnrichment');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/foods', require('../routes/foods'));
app.use('/api/nutrient-enrichment', require('../routes/nutrientEnrichment'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n))
                            : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e === undefined ? '' : e).slice(0, 320))); };

(async () => {
  const day = importClient('lib/day/index.js');
  const tag = String(Date.now()).slice(-7);
  const mk = async (name, phone, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  const admin = await mk('Admin Prov', `73${tag}1`, 'admin');
  const coach = await mk('Coach Prov', `73${tag}2`, 'monitor');
  const member = await mk('Member Prov', `73${tag}3`, 'patient');
  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u, r) => jwt.sign({ id: u, role: r, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const A = tok(admin, 'admin'), C = tok(coach, 'monitor'), M = tok(member, 'patient');
  const call = async (method, p, t, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method,
      headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const ids = [];
  const food = async (name, source, verified, per, extra = {}) => {
    const { rows: [r] } = await pool.query(
      `INSERT INTO foods (name, category, source, verified, per_100g, preparation, verified_by) VALUES ($1,'other',$2,$3,$4,$5,$6) RETURNING id`,
      [name, source, verified, JSON.stringify(per), extra.preparation || null, extra.verified_by || null]);
    ids.push(r.id); return r.id;
  };
  const row = async (id) => (await pool.query(`SELECT * FROM foods WHERE id=$1`, [id])).rows[0];

  try {
    console.log('\n[1] storage');
    {
      const n = normaliseNutrients({ calories: 120, iron: 2 });
      ck('missing nutrients are null; the core figures are numbers', n.zinc === null && n.vit_c === null && n.calories === 120 && n.protein === 0 && n.iron === 2, n);
      const ai = S.stamp(normaliseNutrients({ calories: 100, iron: 2, zinc: 0 }), 'ai', { dropZeros: true });
      ck('an AI food: its iron is an AI estimate, its "0" zinc is not kept as a value', ai._status.iron === 'ai' && ai.zinc === null && !ai._status.zinc, ai._status);
      const r = await call('POST', '/api/foods', A, { name: `Zzprov${tag} Label`, category: 'other', source: 'manual', verified: true,
        per_100g: { calories: 50, protein: 1, total_carbs: 10, fat: 0, iron: 1.2, trans_fat: 0 } });
      const f1 = r.data.id; ids.push(f1);
      const s1 = await row(f1);
      ck('typed by an admin: iron 1.2 and trans fat 0 are recorded (an explicit 0 is a real 0); untyped zinc stays null',
         r.status === 201 || r.status === 200 ? (s1.per_100g._status?.iron === 'recorded' && s1.per_100g._status?.trans_fat === 'recorded' && s1.per_100g.trans_fat === 0 && s1.per_100g.zinc === null) : false,
         [r.status, s1?.per_100g?._status, s1?.per_100g?.zinc]);
      ck('…with who and when in nutrient_meta', s1.nutrient_meta?.iron?.by === admin && s1.nutrient_meta?.iron?.status === 'recorded', s1.nutrient_meta?.iron);
      const aiRow = await food(`Zzprov${tag} Curry`, 'ai', false, S.stamp(normaliseNutrients({ calories: 150, iron: 3, calcium: 40 }), 'ai'));
      const e = await call('PUT', `/api/foods/${aiRow}`, A, { per_100g: { ...(await row(aiRow)).per_100g, calcium: 55 } });
      const s2 = await row(aiRow);
      ck('an edit marks only what it changed: calcium 55 → recorded; iron 3 stays an AI estimate', e.status === 200 && s2.per_100g._status.calcium === 'recorded' && s2.per_100g._status.iron === 'ai' && s2.per_100g.calcium === 55,
         [e.status, s2.per_100g._status]);
    }

    console.log('\n[2] reads carry statuses; old rows read by the legacy rule');
    {
      const legacyAi = await food(`Zzprov${tag} Oldai Dish`, 'ai', false, { calories: 140, protein: 4, total_carbs: 20, fat: 5, iron: 2.5, zinc: 0, vit_c: 0 });
      const legacyNin = await food(`Zzprov${tag} Oldnin Grain`, 'nin', true, { calories: 350, protein: 8, total_carbs: 75, fat: 1, iron: 0.7, vit_c: 0 });
      const byId = await call('GET', `/api/foods/${legacyAi}`, M);
      ck('an old AI-created row: iron 2.5 reads as an AI estimate; its zinc 0 and vit C 0 get no status (not known); the stored row is unchanged',
         byId.data.per_100g._status?.iron === 'ai' && !byId.data.per_100g._status?.zinc && !byId.data.per_100g._status?.vit_c && !(await row(legacyAi)).per_100g._status,
         byId.data.per_100g._status);
      const nin = await call('GET', `/api/foods/${legacyNin}`, M);
      ck('an old seeded NIN row: iron 0.7 reads as recorded; its vit C 0 is still not known', nin.data.per_100g._status?.iron === 'recorded' && !nin.data.per_100g._status?.vit_c, nin.data.per_100g._status);
      const search = await call('GET', `/api/foods/search?q=Zzprov${tag}`, M);
      const hit = (search.data || []).find(f => f.id === legacyAi);
      ck('food search carries the same statuses (so a logged copy keeps them)', hit && hit.per_100g._status?.iron === 'ai', hit?.per_100g?._status);
    }

    console.log('\n[3] server and client agree');
    {
      const cases = [
        [{ iron: 2 }, null], [{ iron: 2 }, { source: 'ai' }], [{ iron: 0 }, null], [{ iron: null }, null], [{}, null],
        [{ iron: 0, _status: { iron: 'reference' } }, null], [{ iron: 3, _status: { iron: 'recipe' } }, { source: 'ai' }], [{ iron: '2.1' }, null],
      ];
      const diff = cases.filter(([p, item]) => S.nutrientStatus(p, 'iron', { aiSourced: item?.source === 'ai' }) !== day.nutrientStatus(p, 'iron', item));
      ck(`same status on ${cases.length} cases`, diff.length === 0, diff);
    }

    console.log('\n[4] enrichment rules');
    {
      const f = { id: 1, name: 'X', source: 'ai', verified: false, per_100g: { iron: null, zinc: 0, vit_c: 5, calcium: 0, _status: { calcium: 'recorded' } }, preparation: 'raw' };
      ck('eligible: an unchecked AI-created food', E.eligibility(f).eligible === true);
      ck('protected: verified, checked by a coach, or not AI-created', !E.eligibility({ ...f, verified: true }).eligible && !E.eligibility({ ...f, verified_by: 3 }).eligible && !E.eligibility({ ...f, source: 'nin' }).eligible && !E.eligibility({ ...f, source: 'manual' }).eligible);
      ck('fillable: an empty value, and an uncertain old 0', E.fillability(f, 'iron').replaces === 'empty' && E.fillability(f, 'zinc').replaces === 'uncertain 0');
      ck('not fillable: an existing value, and a valid (recorded) 0', !E.fillability(f, 'vit_c').ok && !E.fillability(f, 'calcium').ok);
      const base = { nutrient: 'iron', basis: 'per_100g', preparation: 'raw', status: 'reference', source: { dataset: 'IFCT 2017', record_id: 'C033', name: 'Spinach' } };
      ck('units: 0.00295 g iron → 2.95 mg', E.checkProposal(f, { ...base, value: 0.00295, unit: 'g' }).value === 2.95);
      ck('units: folate 0.000142 g → 142 mcg; vitamin D 2.5 mcg → 100 IU',
         E.checkProposal(f, { ...base, nutrient: 'folate', value: 0.000142, unit: 'g' }).value === 142 && E.checkProposal(f, { ...base, nutrient: 'vit_d', value: 2.5, unit: 'mcg' }).value === 100);
      let m; try { E.checkProposal(f, { ...base, nutrient: 'vit_a', value: 300, unit: 'IU' }); } catch (e) { m = e.message; }
      ck('vitamin A in IU is refused (it depends on the form)', /cannot be converted safely/.test(m || ''), m);
      ck('per serving: 1.5 mg in a 50 g serving → 3 mg per 100 g', E.checkProposal(f, { ...base, value: 1.5, unit: 'mg', basis: 'per_serving', serving_g: 50 }).value === 3);
      const refuse = (pr, re) => { try { E.checkProposal(f, pr); return false; } catch (e) { return re.test(e.message); } };
      ck('raw/cooked must match the food (a cooked value for a raw-food record is refused)', refuse({ ...base, value: 2, unit: 'mg', preparation: 'cooked' }, /numbers are for the raw food/));
      ck('a reference needs a dataset and a record id', refuse({ ...base, value: 2, unit: 'mg', source: { dataset: 'My blog' } }, /needs a source dataset/) && refuse({ ...base, value: 2, unit: 'mg', source: { dataset: 'IFCT 2017' } }, /record id/));
      ck('an IFCT 0 is refused (the open copy cannot tell "none" from "not analysed"); a USDA SR28 0 is a value (SR28 leaves "not analysed" blank)',
         refuse({ ...base, value: 0, unit: 'mg' }, /not analysed/)
         && E.checkProposal(f, { ...base, nutrient: 'vit_b12', value: 0, unit: 'mcg', source: { dataset: 'USDA SR28', record_id: '09040', name: 'Bananas, raw' } }).value === 0);
      ck('an AI estimate cannot claim a reference dataset', refuse({ ...base, status: 'ai', value: 2, unit: 'mg' }, /cannot claim/));
      const recipe = { unit: 'mg', cooked_weight_g: 400, ingredients: [
        { name: 'Toor dal, raw', grams: 100, value_per_100g: 3.9, retention: 0.85 }, { name: 'Onion', grams: 50, value_per_100g: 0.6, retention: 0.9 }, { name: 'Water', grams: 300, value_per_100g: 0 }] };
      const want = (100 / 100 * 3.9 * 0.85 + 50 / 100 * 0.6 * 0.9) / 400 * 100;
      ck(`recipe: (100 g dal × 3.9 × 0.85 + 50 g onion × 0.6 × 0.9) over a 400 g yield = ${want.toFixed(3)} mg / 100 g`, Math.abs(E.recipePer100(recipe) - want) < 1e-9);
      ck('a recipe value matching its own working is accepted', E.checkProposal(f, { nutrient: 'iron', status: 'recipe', basis: 'per_100g', unit: 'mg', value: +want.toFixed(3), recipe, preparation: 'raw' }).status === 'recipe');
      ck('a recipe value that disagrees with its working is refused', refuse({ nutrient: 'iron', status: 'recipe', basis: 'per_100g', unit: 'mg', value: 2.5, recipe, preparation: 'raw' }, /recipe working gives/));
    }

    console.log('\n[5] a batch: propose, apply, skip, roll back');
    {
      const t1 = await food(`Zzprov${tag} Palak Sabzi`, 'ai', false, { calories: 90, protein: 3, total_carbs: 8, fat: 5, iron: null, zinc: 0, vit_c: 12, calcium: 40, _status: { vit_c: 'ai' } }, { preparation: 'cooked' });
      const t2 = await food(`Zzprov${tag} Verified Dal`, 'ai', true, { calories: 110, protein: 7, total_carbs: 18, fat: 1, iron: null });
      const t4 = await food(`Zzprov${tag} Plain Rice`, 'ai', false, { calories: 130, protein: 2.7, total_carbs: 28, fat: 0.3, iron: 0.2, zinc: 0, vit_b12: null });
      const before4 = JSON.stringify((await row(t4)).per_100g);
      // A member logged t1 before enrichment: their snapshot must never change.
      const snap = { name: 'Palak Sabzi', grams: 150, food_id: t1, source: 'db', per_100g: (await row(t1)).per_100g };
      await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [member]);
      await pool.query(`INSERT INTO daily_logs (patient_id, log_date, food_items) VALUES ($1, CURRENT_DATE - 1, $2)`, [member, JSON.stringify([snap])]);
      const before = JSON.stringify((await row(t1)).per_100g);
      const src = { dataset: 'IFCT 2017', record_id: 'C033', name: 'Spinach' };
      const proposals = [
        { food_id: t1, nutrient: 'iron', value: 1.2, unit: 'mg', basis: 'per_100g', preparation: 'cooked', status: 'recipe',
          recipe: { unit: 'mg', cooked_weight_g: 250, ingredients: [{ name: 'Spinach (IFCT C033)', grams: 200, value_per_100g: 2.95, retention: 0.5 }, { name: 'Oil', grams: 10, value_per_100g: 0 }] },
          assumptions: '200 g raw spinach cooks down to 250 g sabzi with onion and oil; iron retention 0.5' },
        { food_id: t1, nutrient: 'zinc', value: 0.46, unit: 'mg', basis: 'per_100g', preparation: 'cooked', status: 'ai', assumptions: 'no reference found; AI estimate' },
        { food_id: t1, nutrient: 'vit_c', value: 28, unit: 'mg', basis: 'per_100g', preparation: 'cooked', status: 'reference', source: src },
        { food_id: t2, nutrient: 'iron', value: 2, unit: 'mg', basis: 'per_100g', status: 'reference', source: { dataset: 'IFCT 2017', record_id: 'B029' } },
        { food_id: t1, nutrient: 'calcium', value: 99, unit: 'mg', basis: 'per_100g', preparation: 'cooked', status: 'reference', source: src },
        { food_id: t4, nutrient: 'zinc', value: 0.49, unit: 'mg', basis: 'per_100g', status: 'reference', source: { dataset: 'USDA SR28', record_id: '20445', name: 'Rice, white, long-grain, regular, unenriched, cooked without salt' } },
        { food_id: t4, nutrient: 'vit_b12', value: 0, unit: 'mcg', basis: 'per_100g', status: 'reference', source: { dataset: 'USDA SR28', record_id: '20445', name: 'Rice, white, long-grain, regular, unenriched, cooked without salt' } },
      ];
      const r = await call('POST', '/api/nutrient-enrichment/batches', A, { label: 'test pilot', proposals });
      const bid = r.data.batch?.id;
      const out = Object.fromEntries((r.data.review || []).map(x => [`${x.food_id}:${x.nutrient}`, x]));
      ck('proposed: iron fills an empty value (recipe), zinc fills an uncertain 0 (AI estimate)',
         r.status === 201 && out[`${t1}:iron`]?.outcome === 'proposed' && /empty/.test(out[`${t1}:iron`].reason) && out[`${t1}:zinc`]?.outcome === 'proposed' && /uncertain 0/.test(out[`${t1}:zinc`].reason), r.data);
      ck('skipped: vit C already has a value; the verified food is protected',
         out[`${t1}:vit_c`]?.outcome === 'skipped' && /already has a status/.test(out[`${t1}:vit_c`].reason) && out[`${t2}:iron`]?.outcome === 'skipped' && /protected/.test(out[`${t2}:iron`].reason), [out[`${t1}:vit_c`], out[`${t2}:iron`]]);
      ck('skipped: an old value with no status (calcium 40) is never written over', out[`${t1}:calcium`]?.outcome === 'skipped' && /already has a value/.test(out[`${t1}:calcium`].reason), out[`${t1}:calcium`]);
      ck('proposing changed no food', JSON.stringify((await row(t1)).per_100g) === before);
      const noConfirm = await call('POST', `/api/nutrient-enrichment/batches/${bid}/apply`, A, {});
      ck('apply without the typed confirmation is refused', noConfirm.status === 400 && /apply batch/.test(noConfirm.data.error || ''), noConfirm.data);
      const coachApply = await call('POST', `/api/nutrient-enrichment/batches/${bid}/apply`, C, { confirm: `apply batch ${bid}` });
      ck('a coach cannot apply (admin only)', coachApply.status === 403, coachApply.status);
      const ap = await call('POST', `/api/nutrient-enrichment/batches/${bid}/apply`, A, { confirm: `apply batch ${bid}` });
      const s = await row(t1);
      ck('applied: iron 1.2 (recipe), zinc 0.46 (AI estimate), each with its provenance', ap.status === 200 && ap.data.applied === 4
         && Number(s.per_100g.iron) === 1.2 && s.per_100g._status.iron === 'recipe' && Number(s.per_100g.zinc) === 0.46 && s.per_100g._status.zinc === 'ai'
         && s.nutrient_meta.iron.batch_id === bid && s.nutrient_meta.iron.recipe?.cooked_weight_g === 250 && s.nutrient_meta.iron.review_status === 'pending', [ap.data, s.per_100g._status, s.nutrient_meta?.iron]);
      ck('…and nothing else on the food moved (vit C 12 still an AI estimate, calories 90)', Number(s.per_100g.vit_c) === 12 && s.per_100g._status.vit_c === 'ai' && Number(s.per_100g.calories) === 90);
      const log = (await pool.query(`SELECT food_items FROM daily_logs WHERE patient_id=$1`, [member])).rows[0].food_items[0];
      ck('the member’s earlier log is untouched (iron still empty, zinc still 0)', log.per_100g.iron === null && log.per_100g.zinc === 0 && !log.per_100g._status?.iron, log.per_100g);
      const again = await call('POST', `/api/nutrient-enrichment/batches/${bid}/apply`, A, { confirm: `apply batch ${bid}` });
      ck('a batch applies once', again.status === 409, again.data);
      const rb = await call('POST', `/api/nutrient-enrichment/batches/${bid}/rollback`, A, {});
      const s2 = await row(t1);
      const r4 = await row(t4);
      ck('rollback restores a food exactly as it was, with no empty status map left behind (a USDA B12 0 had been applied as a real 0)', JSON.stringify(r4.per_100g) === before4 && !('_status' in r4.per_100g) && JSON.stringify(r4.nutrient_meta || {}) === '{}', [r4.per_100g, r4.nutrient_meta]);
      ck('rolled back: iron empty again, zinc back to its old 0, statuses and provenance removed', rb.status === 200 && rb.data.restored === 4
         && s2.per_100g.iron === null && Number(s2.per_100g.zinc) === 0 && !s2.per_100g._status.iron && !s2.per_100g._status.zinc && !s2.nutrient_meta.iron && s2.per_100g._status.vit_c === 'ai', [rb.data, s2.per_100g]);
      // Second batch: applied, then a coach edits one value; rollback must leave the edit.
      const r2 = await call('POST', '/api/nutrient-enrichment/batches', A, { label: 'test pilot 2', proposals: proposals.slice(0, 2) });
      const b2 = r2.data.batch.id;
      await call('POST', `/api/nutrient-enrichment/batches/${b2}/apply`, A, { confirm: `apply batch ${b2}` });
      await call('PUT', `/api/foods/${t1}`, A, { per_100g: { ...(await row(t1)).per_100g, iron: 1.6 } });
      const rb2 = await call('POST', `/api/nutrient-enrichment/batches/${b2}/rollback`, A, {});
      const s3 = await row(t1);
      ck('a value edited after the batch is left alone on rollback (iron 1.6, recorded); the other is restored',
         rb2.data.conflicts === 1 && rb2.data.restored === 1 && Number(s3.per_100g.iron) === 1.6 && s3.per_100g._status.iron === 'recorded' && Number(s3.per_100g.zinc) === 0, [rb2.data, s3.per_100g._status]);
      const many = Array.from({ length: 21 }, (_, i) => ({ food_id: 100000 + i, nutrient: 'iron', value: 1, unit: 'mg', basis: 'per_100g', status: 'ai' }));
      const big = await call('POST', '/api/nutrient-enrichment/batches', A, { label: 'too big', proposals: many });
      ck('a batch may cover at most 20 foods during the pilot', big.status === 400 && /at most 20 foods/.test(big.data.error || ''), big.data);
      // A change applied while proposed: apply skips it.
      const t3 = await food(`Zzprov${tag} Moved Food`, 'ai', false, { calories: 80, protein: 2, total_carbs: 10, fat: 3, iron: null });
      const r3 = await call('POST', '/api/nutrient-enrichment/batches', A, { label: 'moved', proposals: [{ food_id: t3, nutrient: 'iron', value: 1, unit: 'mg', basis: 'per_100g', status: 'ai' }] });
      await call('PUT', `/api/foods/${t3}`, A, { per_100g: { ...(await row(t3)).per_100g, iron: 0.9 } });
      const ap3 = await call('POST', `/api/nutrient-enrichment/batches/${r3.data.batch.id}/apply`, A, { confirm: `apply batch ${r3.data.batch.id}` });
      ck('a value someone filled after the batch was proposed is skipped, not overwritten', ap3.data.applied === 0 && ap3.data.skipped === 1 && Number((await row(t3)).per_100g.iron) === 0.9, ap3.data);
    }

    console.log('\n[6] who may do what; the inventory is read-only');
    {
      const coachInv = await call('GET', '/api/nutrient-enrichment/inventory?top=5', C);
      const memberInv = await call('GET', '/api/nutrient-enrichment/inventory', M);
      ck('a coach can read the inventory; a member cannot', coachInv.status === 200 && memberInv.status === 403, [coachInv.status, memberInv.status]);
      ck('a coach cannot propose a batch (admin only)', (await call('POST', '/api/nutrient-enrichment/batches', C, { label: 'x', proposals: [] })).status === 403);
      const before = (await pool.query(`SELECT md5(string_agg(id || ':' || per_100g::text || ':' || COALESCE(nutrient_meta::text,''), ',' ORDER BY id)) h FROM foods`)).rows[0].h;
      const inv = await call('GET', '/api/nutrient-enrichment/inventory?top=50', A);
      const after = (await pool.query(`SELECT md5(string_agg(id || ':' || per_100g::text || ':' || COALESCE(nutrient_meta::text,''), ',' ORDER BY id)) h FROM foods`)).rows[0].h;
      ck('reading the inventory changes nothing', before === after);
      const mine = inv.data.top_eligible.filter(f => f.name.includes(`Zzprov${tag}`));
      ck('the inventory lists eligible foods only (the verified and the NIN food are not in it), with missing and uncertain-0 nutrients',
         mine.length >= 2 && !mine.some(f => /Verified Dal|Oldnin/.test(f.name)) && mine.find(f => /Oldai Dish/.test(f.name))?.uncertain_zero.includes('zinc')
         && mine.find(f => /Oldai Dish/.test(f.name))?.missing.length > 0, mine.map(f => [f.name, f.uncertain_zero.slice(0, 4)]));
      ck('per-nutrient counts cover every stored micronutrient', Object.keys(inv.data.per_nutrient).length === S.MICRO_KEYS.length && typeof inv.data.eligible_total === 'number');
    }

    console.log('\n[7] member and coach read the same status');
    {
      const f = { source: 'db', per_100g: { calories: 23, iron: 2.95, vit_c: 28, zinc: 0, _status: { iron: 'reference', vit_c: 'ai' } }, grams: 100, name: 'Spinach' };
      const member = day.microStatus({ foodItems: [f], rdaOverrides: { iron: '3', vit_c: '25' } });
      const coachView = day.microStatus({ foodItems: [JSON.parse(JSON.stringify(f))], rdaOverrides: { iron: '3', vit_c: '25' } });
      ck('the same food gives the same rows to the member’s sheet and the coach’s day view (one function, one input)',
         JSON.stringify(member.rows) === JSON.stringify(coachView.rows) && member.rows.iron.status === 'met' && member.rows.vit_c.status === 'estimate' && member.rows.zinc.status === 'unknown',
         [member.rows.iron.status, member.rows.vit_c.status, member.rows.zinc.status]);
      const d = S.describe(f.per_100g, 'iron', 'mg', {}, { iron: { source: { dataset: 'IFCT 2017' } } });
      ck('the AI food answer labels a reference value with its source: "3mg (IFCT 2017)"', d === '3mg (IFCT 2017)', d);
      ck('…an AI value is "~28mg (AI estimate)" and an old 0 is "not known"', S.describe(f.per_100g, 'vit_c', 'mg') === '~28mg (AI estimate)' && S.describe(f.per_100g, 'zinc', 'mg') === 'not known');
    }
  } finally {
    await pool.query(`DELETE FROM daily_logs WHERE patient_id=$1`, [member]).catch(() => {});
    await pool.query(`DELETE FROM nutrient_enrichment_batches WHERE created_by=$1`, [admin]).catch(() => {});
    await pool.query(`DELETE FROM foods WHERE id = ANY($1) OR name LIKE $2`, [ids, `Zzprov${tag}%`]).catch(() => {});
    await pool.query(`DELETE FROM patient_profiles WHERE user_id=$1`, [member]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[admin, coach, member]]).catch(() => {});
    srv.close();
  }
  console.log(`\n${fail ? '❌' : '✅'} nutrient provenance: ${pass} passed, ${fail} failed`);
  await pool.end(); process.exit(fail ? 1 : 0);
})().catch(async e => { console.error(e); process.exit(1); });
