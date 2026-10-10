/**
 * scripts/test-portion-memory.js — per-member portion learning.
 *
 * "1 katori" is not a fixed weight; it depends on whose kitchen it came from.
 * Portion estimation is the biggest error source in the logging chain, so
 * these assertions cover the loop: correct once, remembered, reused.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const app = express(); app.use(express.json()); app.use(cookieParser());
app.use('/api/ai-chat', require('../routes/aiChat'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 180))); };

// mirrors portionPhrase() in routes/aiChat.js
const UNIT_WORDS = /\b(katori|bowl|cup|glass|plate|piece|pieces|slice|slices|scoop|scoops|tbsp|tablespoon|tsp|teaspoon|handful|packet|bottle|roti|chapati|idli|dosa|egg|eggs)\b/i;
function portionPhrase(qtyText, foodName) {
  const unit = String(qtyText || '').match(UNIT_WORDS)?.[1]?.toLowerCase();
  if (!unit) return null;
  const food = String(foodName || '').toLowerCase().replace(/\s*\(.*$/, '').trim();
  if (!food) return null;
  return `${unit.replace(/(pieces|slices|scoops|eggs)$/, m => m.slice(0, -1))} ${food}`.slice(0, 80);
}

(async () => {
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const { rows: [m1] } = await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ('A','3001','x','patient',true) RETURNING id`);
  const { rows: [m2] } = await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ('B','3002','x','patient',true) RETURNING id`);
  const tok = u => jwt.sign({ id: u, role: 'patient', name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, path, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };

  console.log('\n[1] phrase extraction');
  ck('"2 katori" + Dal -> katori dal', portionPhrase('2 katori', 'Dal') === 'katori dal', portionPhrase('2 katori', 'Dal'));
  ck('"1 glass" + Milk -> glass milk', portionPhrase('1 glass', 'Milk') === 'glass milk');
  ck('plural collapses: "3 pieces" -> piece', portionPhrase('3 pieces', 'Chapati') === 'piece chapati', portionPhrase('3 pieces', 'Chapati'));
  ck('bracketed food name trimmed', portionPhrase('1 bowl', 'Dal (Toor, Cooked)') === 'bowl dal', portionPhrase('1 bowl', 'Dal (Toor, Cooked)'));
  ck('no unit -> no phrase', portionPhrase('200g', 'Rice') === null);

  console.log('\n[2] a correction is remembered');
  let r = await call('POST', '/api/ai-chat/portions', tok(m1.id),
    { corrections: [{ phrase: 'katori dal', grams: 200 }] });
  ck('recorded', r.status === 200 && r.data.learned === 1, r.data);
  r = await call('GET', '/api/ai-chat/portions', tok(m1.id));
  ck('reads back at 200g', r.data.portions[0].grams === 200, r.data.portions);

  console.log('\n[3] repeat corrections average, they do not overwrite');
  await call('POST', '/api/ai-chat/portions', tok(m1.id), { corrections: [{ phrase: 'katori dal', grams: 220 }] });
  r = await call('GET', '/api/ai-chat/portions', tok(m1.id));
  ck('200 then 220 -> 210 (mean, not last)', r.data.portions[0].grams === 210, r.data.portions[0]);
  ck('sample count rising', r.data.portions[0].samples === 2, r.data.portions[0]);

  console.log('\n[4] one mistyped value cannot wreck the memory');
  for (const g of [205, 195, 210, 200]) {
    await call('POST', '/api/ai-chat/portions', tok(m1.id), { corrections: [{ phrase: 'katori dal', grams: g }] });
  }
  const before = (await call('GET', '/api/ai-chat/portions', tok(m1.id))).data.portions[0].grams;
  await call('POST', '/api/ai-chat/portions', tok(m1.id), { corrections: [{ phrase: 'katori dal', grams: 2000 }] });
  const after = (await call('GET', '/api/ai-chat/portions', tok(m1.id))).data.portions[0].grams;
  ck(`a 2000g typo moves the average only ~${Math.round(after - before)}g, not to 2000`,
     after < before + 350, { before, after });

  console.log('\n[5] members do not share portions');
  r = await call('GET', '/api/ai-chat/portions', tok(m2.id));
  ck("member B's memory is empty", r.data.portions.length === 0, r.data.portions);
  await call('POST', '/api/ai-chat/portions', tok(m2.id), { corrections: [{ phrase: 'katori dal', grams: 120 }] });
  const a = (await call('GET', '/api/ai-chat/portions', tok(m1.id))).data.portions[0].grams;
  const b = (await call('GET', '/api/ai-chat/portions', tok(m2.id))).data.portions[0].grams;
  ck('same phrase, different weights per member', a !== b && b === 120, { a, b });

  console.log('\n[6] rubbish is refused');
  await call('POST', '/api/ai-chat/portions', tok(m2.id), {
    corrections: [{ phrase: '', grams: 100 }, { phrase: 'x', grams: -5 },
                  { phrase: 'y', grams: 99999 }, { phrase: 'z', grams: 'abc' }] });
  r = await call('GET', '/api/ai-chat/portions', tok(m2.id));
  ck('only the one valid phrase stored', r.data.portions.length === 1, r.data.portions);
  r = await call('POST', '/api/ai-chat/portions', tok(m2.id), { corrections: [] });
  ck('empty payload rejected', r.status === 400, r.status);

  srv.close();
  console.log(`\n\u2550\u2550\u2550 PORTION MEMORY: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
