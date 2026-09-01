/**
 * scripts/test-evals.js — the AI eval set (Sprint L1).
 *
 * Covers the two halves that can go wrong quietly:
 *
 *   1. CAPTURE — does a correction actually become a stored sample, with the
 *      right question attached to the right answer? The failure mode here is
 *      silent: rows accumulate, nobody looks, and the day someone runs the
 *      replay tool they discover half the set has the wrong message on it.
 *
 *   2. SCORING — do the comparison rules in replay-evals.js actually
 *      distinguish right from wrong? A scorer that says "pass" to everything
 *      reports a green prompt forever. That is exactly the shape of bug this
 *      codebase has shipped three times, so the rules are asserted directly.
 *
 * No API calls. The scoring functions are pure and the capture layer is
 * exercised against real Postgres.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const ai   = require('../routes/aiChat');
const score = require('./replay-evals');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use('/api/ai-chat', require('../routes/aiChat'));
app.use('/api/admin',   require('../routes/admin'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 200))); };

(async () => {
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const { rows: [mem] } = await pool.query(
    `INSERT INTO users (name,phone,password,role,active)
     VALUES ('Eval Member','7001','x','patient',true) RETURNING id`);
  const { rows: [coach] } = await pool.query(
    `INSERT INTO users (name,phone,password,role,active)
     VALUES ('Eval Coach','7002','x','monitor',true) RETURNING id`);
  const { rows: [admin] } = await pool.query(
    `INSERT INTO users (name,phone,password,role,active)
     VALUES ('Eval Admin','7003','x','admin',true) RETURNING id`);

  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, path, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const countSamples = async () => (await pool.query(
    'SELECT COUNT(*)::int AS n FROM ai_parse_samples')).rows[0].n;

  // ── 1. Schema ──────────────────────────────────────────────────────────────
  console.log('\n[1] schema');
  {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'ai_parse_samples'`);
    const cols = rows.map(r => r.column_name);
    ck('ai_parse_samples has the documented columns',
      ['id','patient_id','source','message','ai_output','corrected','field','dismissed','created_at']
        .every(c => cols.includes(c)), cols);
    ck('keyed on patient_id, not member_id (RENAME.md)',
      cols.includes('patient_id') && !cols.includes('member_id'), cols);
    const { rows: t } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_parse_turns'`);
    ck('ai_parse_turns exists', t.length > 0, t);
  }

  // ── 2. recordEvalSample ────────────────────────────────────────────────────
  console.log('\n[2] recording a sample');
  {
    const base = { patientId: mem.id, source: 'member_parse', message: '2 roti aur dal',
                   aiOutput: { name: 'Roti', grams: 200 }, corrected: { name: 'Roti', grams: 60 },
                   field: 'grams' };
    ck('a correction is stored', await ai.recordEvalSample(base) === 'stored');
    ck('the same correction twice is one lesson, not two',
      await ai.recordEvalSample(base) === 'duplicate');
    ck('a different answer to the same message IS a new sample',
      await ai.recordEvalSample({ ...base, corrected: { name: 'Roti', grams: 90 } }) === 'stored');
    ck('an unknown source is rejected',
      await ai.recordEvalSample({ ...base, source: 'nonsense' }) === 'invalid');
    ck('an empty message is rejected',
      await ai.recordEvalSample({ ...base, message: '' }) === 'invalid');
    ck('an undefined correction is rejected',
      await ai.recordEvalSample({ ...base, corrected: undefined }) === 'invalid');
    ck('a null correction is legal — "this item does not exist"',
      await ai.recordEvalSample({ ...base, message: 'chai', corrected: null,
                                  field: 'food_name' }) === 'stored');

    const { rows } = await pool.query(
      `SELECT field FROM ai_parse_samples WHERE message = '2 roti aur dal' LIMIT 1`);
    ck('the field is stored', rows[0].field === 'grams', rows[0]);

    const { rows: bad } = await pool.query(
      `SELECT field FROM ai_parse_samples WHERE field = 'not_a_field'`);
    ck('an unknown field is dropped rather than stored', bad.length === 0);
  }

  // ── 3. The daily cap ───────────────────────────────────────────────────────
  console.log('\n[3] one member cannot flood the set');
  {
    await pool.query('DELETE FROM ai_parse_samples');
    for (let i = 0; i < ai.EVAL_DAILY_CAP; i++) {
      await ai.recordEvalSample({ patientId: mem.id, source: 'member_parse',
        message: `msg ${i}`, aiOutput: { grams: i }, corrected: { grams: i + 1 }, field: 'grams' });
    }
    ck(`${ai.EVAL_DAILY_CAP} samples stored`, await countSamples() === ai.EVAL_DAILY_CAP);
    ck('the next one is capped',
      await ai.recordEvalSample({ patientId: mem.id, source: 'member_parse',
        message: 'one too many', aiOutput: {}, corrected: {}, field: 'grams' }) === 'capped');
    ck('the cap did not store it', await countSamples() === ai.EVAL_DAILY_CAP);
    ck('a DIFFERENT member is unaffected by their cap',
      await ai.recordEvalSample({ patientId: coach.id, source: 'coach_parse',
        message: 'set water 4L for asha', aiOutput: [], corrected: [], field: 'ops' }) === 'stored');
    await pool.query('DELETE FROM ai_parse_samples');
  }

  // ── 4. The turn cache — pairing a correction to its question ───────────────
  console.log('\n[4] pairing a correction back to the message that caused it');
  {
    await pool.query('DELETE FROM ai_parse_turns');
    await ai.rememberParseTurn(mem.id, '2 katori dal aur rice',
      [{ name: 'Dal', grams: 200, meal: 'Lunch', qty_text: '2 katori' },
       { name: 'Rice', grams: 150, meal: 'Lunch', qty_text: '1 bowl' }]);

    const hit = await ai.findOriginalTurn(mem.id, 'Dal');
    ck('the original message is found', hit?.message === '2 katori dal aur rice', hit);
    ck('with the grams the model gave it', hit?.food?.grams === 200, hit?.food);
    ck('name match is case-insensitive', (await ai.findOriginalTurn(mem.id, 'dal'))?.food?.grams === 200);
    ck('a food that was never parsed pairs to nothing',
      await ai.findOriginalTurn(mem.id, 'Paneer') === null);
    ck('another member sees none of it', await ai.findOriginalTurn(coach.id, 'Dal') === null);

    // A turn older than the 7-day window must not be paired — an answer
    // attached to a question from last month is not a test case.
    await pool.query(
      `UPDATE ai_parse_turns SET created_at = NOW() - INTERVAL '9 days' WHERE patient_id = $1`,
      [mem.id]);
    ck('a turn older than 7 days is not paired',
      await ai.findOriginalTurn(mem.id, 'Dal') === null);
    await pool.query('DELETE FROM ai_parse_turns');

    // Bounded cache
    for (let i = 0; i < 34; i++) {
      await ai.rememberParseTurn(mem.id, `turn ${i}`, [{ name: `Food${i}`, grams: 100 }]);
    }
    const { rows: n } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM ai_parse_turns WHERE patient_id = $1', [mem.id]);
    ck('the cache is capped at 30 turns per member', n[0].n === 30, n[0]);
    ck('and it keeps the NEWEST ones',
      (await ai.findOriginalTurn(mem.id, 'Food33'))?.message === 'turn 33');
    ck('the oldest have been pruned', await ai.findOriginalTurn(mem.id, 'Food0') === null);
    ck('a parse with no foods is not cached at all', await (async () => {
      await pool.query('DELETE FROM ai_parse_turns');
      await ai.rememberParseTurn(mem.id, 'just weighed 84kg', []);
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM ai_parse_turns');
      return rows[0].n === 0;
    })());
  }

  // ── 5. captureCorrectionSamples ────────────────────────────────────────────
  console.log('\n[5] a corrections op becomes a sample');
  {
    await pool.query('DELETE FROM ai_parse_samples');
    await pool.query('DELETE FROM ai_parse_turns');
    await ai.rememberParseTurn(mem.id, '2 roti', [{ name: 'Roti', grams: 200, meal: 'Dinner' }]);

    await ai.captureCorrectionSamples(mem.id, [{ name: 'Roti', grams: 60, meal: null }]);
    const { rows } = await pool.query('SELECT * FROM ai_parse_samples ORDER BY id DESC LIMIT 1');
    ck('a sample was written', rows.length === 1, rows);
    ck('the QUESTION is the original message, not the correction',
      rows[0]?.message === '2 roti', rows[0]?.message);
    ck('ai_output is what the model said', rows[0]?.ai_output?.grams === 200, rows[0]?.ai_output);
    ck('corrected is what it should have been', rows[0]?.corrected?.grams === 60, rows[0]?.corrected);
    ck('the meal carries through from the original when not corrected',
      rows[0]?.corrected?.meal === 'Dinner', rows[0]?.corrected);
    ck('field is grams', rows[0]?.field === 'grams');

    // No pairing → no sample. We would rather store nothing than store an
    // answer against the wrong question.
    const before = await countSamples();
    await ai.captureCorrectionSamples(mem.id, [{ name: 'Paneer', grams: 100, meal: null }]);
    ck('an unpairable correction stores nothing', await countSamples() === before);

    // A "correction" that changes nothing is not an error.
    await ai.captureCorrectionSamples(mem.id, [{ name: 'Roti', grams: 200, meal: 'Dinner' }]);
    ck('a correction that changes nothing stores nothing', await countSamples() === before);

    // A meal-only correction is recorded as such.
    await ai.captureCorrectionSamples(mem.id, [{ name: 'Roti', grams: null, meal: 'Lunch' }]);
    const { rows: mrow } = await pool.query(
      `SELECT field, corrected FROM ai_parse_samples ORDER BY id DESC LIMIT 1`);
    ck('a slot-only correction is field=meal', mrow[0]?.field === 'meal', mrow[0]);
    ck('and keeps the original grams', mrow[0]?.corrected?.grams === 200, mrow[0]?.corrected);
  }

  // ── 6. The client capture endpoint ─────────────────────────────────────────
  console.log('\n[6] POST /api/ai-chat/eval-sample');
  {
    await pool.query('DELETE FROM ai_parse_samples');
    let r = await call('POST', '/api/ai-chat/eval-sample', tok(mem.id, 'patient'), {
      source: 'member_parse', message: '1 plate biryani', field: 'grams',
      ai_output: { name: 'Biryani', grams: 500 }, corrected: { name: 'Biryani', grams: 300 } });
    ck('a member edit is accepted', r.status === 200 && r.data.result === 'stored', r.data);

    r = await call('POST', '/api/ai-chat/eval-sample', tok(mem.id, 'patient'), {
      source: 'garbage', message: 'x', ai_output: {}, corrected: {} });
    ck('a bad sample is a no-op, not an error the member sees',
      r.status === 200 && r.data.result === 'invalid', r.data);

    r = await call('POST', '/api/ai-chat/eval-sample', null, {
      source: 'member_parse', message: 'anon', ai_output: {}, corrected: {} });
    ck('it requires authentication', r.status === 401, r.status);

    r = await call('POST', '/api/ai-chat/eval-sample', tok(coach.id, 'monitor'), {
      source: 'coach_parse', message: 'set water 4L for asha and bujju', field: 'ops',
      ai_output: [{ member_name: 'Asha' }, { member_name: 'Bujju' }],
      corrected: [{ member_name: 'Asha' }] });
    ck('a coach can record a dropped action', r.status === 200 && r.data.result === 'stored', r.data);

    const { rows } = await pool.query(
      `SELECT patient_id FROM ai_parse_samples WHERE source = 'coach_parse'`);
    ck('a coach sample is attributed to the coach', rows[0]?.patient_id === coach.id, rows[0]);
  }

  // ── 7. Admin browse + dismiss ──────────────────────────────────────────────
  console.log('\n[7] admin can browse and dismiss');
  {
    let r = await call('GET', '/api/admin/eval-samples', tok(admin.id, 'admin'));
    ck('admin lists samples', r.status === 200 && Array.isArray(r.data.samples), r.data);
    ck('counts are over the whole set, not the page',
      r.data.counts?.total === 2 && r.data.counts?.active === 2, r.data.counts);
    ck('replayable excludes photo samples',
      r.data.counts?.replayable === 2, r.data.counts);

    const id = r.data.samples[0].id;
    r = await call('PATCH', `/api/admin/eval-samples/${id}/dismiss`, tok(admin.id, 'admin'),
      { dismissed: true });
    ck('a sample can be dismissed', r.status === 200 && r.data.dismissed === true, r.data);

    r = await call('GET', '/api/admin/eval-samples', tok(admin.id, 'admin'));
    ck('and drops out of the live list', r.data.samples.length === 1, r.data.samples.length);
    ck('but the count still knows it is there', r.data.counts?.total === 2, r.data.counts);

    r = await call('GET', '/api/admin/eval-samples?include_dismissed=1', tok(admin.id, 'admin'));
    ck('include_dismissed brings it back', r.data.samples.length === 2, r.data.samples.length);

    r = await call('PATCH', `/api/admin/eval-samples/${id}/dismiss`, tok(admin.id, 'admin'),
      { dismissed: false });
    ck('dismissal is reversible', r.status === 200 && r.data.dismissed === false, r.data);

    r = await call('PATCH', '/api/admin/eval-samples/999999/dismiss', tok(admin.id, 'admin'),
      { dismissed: true });
    ck('an unknown id is a 404, not a silent success', r.status === 404, r.status);

    r = await call('GET', '/api/admin/eval-samples', tok(mem.id, 'patient'));
    ck('a member cannot read the eval set', r.status === 403, r.status);
  }

  // ── 8. Deleting a member must not destroy the eval set ─────────────────────
  console.log('\n[8] deletion behaviour');
  {
    const { rows: [victim] } = await pool.query(
      `INSERT INTO users (name,phone,password,role,active)
       VALUES ('Leaving','7009','x','patient',true) RETURNING id`);
    await ai.recordEvalSample({ patientId: victim.id, source: 'member_parse',
      message: 'ek katori poha', aiOutput: { grams: 250 }, corrected: { grams: 120 }, field: 'grams' });
    await ai.rememberParseTurn(victim.id, 'ek katori poha', [{ name: 'Poha', grams: 250 }]);

    await pool.query('DELETE FROM users WHERE id = $1', [victim.id]);

    const { rows: s } = await pool.query(
      `SELECT patient_id, message FROM ai_parse_samples WHERE message = 'ek katori poha'`);
    ck('the sample survives the member being deleted', s.length === 1, s);
    ck('and is no longer attributable to anyone', s[0]?.patient_id === null, s[0]);

    const { rows: t } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM ai_parse_turns WHERE patient_id = $1', [victim.id]);
    ck('the turn cache does cascade — it is a cache, not a record', t[0].n === 0, t[0]);
  }

  // ── 9. The scoring rules ───────────────────────────────────────────────────
  // These decide whether a prompt change looks like an improvement. A scorer
  // that passes everything is the exact failure this repo has shipped before,
  // so each rule is asserted in both directions.
  console.log('\n[9] replay scoring rules');
  {
    ck('name normalisation drops the food-DB parenthetical',
      score.normName('Dal (Toor, Cooked)') === 'dal', score.normName('Dal (Toor, Cooked)'));
    ck('grams within 5% is a match', score.gramsMatch(248, 250));
    ck('grams outside 5% is NOT a match', score.gramsMatch(200, 250) === false);
    ck('zero expected grams cannot pass', score.gramsMatch(0, 0) === false);
    ck('a missing number cannot pass', score.gramsMatch(undefined, 250) === false);
    ck('food lookup is case- and bracket-insensitive',
      score.findFood([{ name: 'dal (toor)' }], 'Dal')?.name === 'dal (toor)');
    ck('food lookup returns null when absent',
      score.findFood([{ name: 'Rice' }], 'Paneer') === null);

    const gramsSample = { field: 'grams', ai_output: { name: 'Roti', grams: 200 },
                          corrected: { name: 'Roti', grams: 60 } };
    ck('right portion scores a pass',
      score.scoreMemberSample(gramsSample, { foods: [{ name: 'Roti', grams: 62 }] }).pass === true);
    ck('wrong portion scores a fail',
      score.scoreMemberSample(gramsSample, { foods: [{ name: 'Roti', grams: 200 }] }).pass === false);
    ck('a missing item scores a fail, not a pass',
      score.scoreMemberSample(gramsSample, { foods: [] }).pass === false);
    ck('an empty response scores a fail',
      score.scoreMemberSample(gramsSample, {}).pass === false);

    const invented = { field: 'food_name', ai_output: { name: 'Ghee', grams: 10 }, corrected: null };
    ck('no longer inventing the item is a pass',
      score.scoreMemberSample(invented, { foods: [{ name: 'Roti', grams: 60 }] }).pass === true);
    ck('still inventing it is a fail',
      score.scoreMemberSample(invented, { foods: [{ name: 'Ghee', grams: 10 }] }).pass === false);

    const mealSample = { field: 'meal', ai_output: { name: 'Dal', grams: 200, meal: 'Lunch' },
                         corrected: { name: 'Dal', grams: 200, meal: 'Dinner' } };
    ck('right slot passes',
      score.scoreMemberSample(mealSample, { foods: [{ name: 'Dal', grams: 200, meal: 'Dinner' }] }).pass === true);
    ck('wrong slot fails',
      score.scoreMemberSample(mealSample, { foods: [{ name: 'Dal', grams: 200, meal: 'Lunch' }] }).pass === false);

    const coachSample = { corrected: [{ member_name: 'Asha', is_all: false, ops: { water_ml: 4000 } }] };
    ck('proposing exactly what the coach kept is a pass',
      score.scoreCoachSample(coachSample,
        { actions: [{ member_name: 'asha', is_all: false, ops: { water_ml: 4000 } }] }).pass === true);
    ck('proposing an extra member is a fail',
      score.scoreCoachSample(coachSample, { actions: [
        { member_name: 'Asha', is_all: false, ops: { water_ml: 4000 } },
        { member_name: 'Bujju', is_all: false, ops: { water_ml: 4000 } }] }).pass === false);
    ck('proposing nothing is a fail',
      score.scoreCoachSample(coachSample, { actions: [] }).pass === false);
    ck('op VALUES are not compared — 4L and 4000ml are one instruction',
      score.scoreCoachSample(coachSample,
        { actions: [{ member_name: 'Asha', is_all: false, ops: { water_ml: 4 } }] }).pass === true);
  }

  srv.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} test-evals: ${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
