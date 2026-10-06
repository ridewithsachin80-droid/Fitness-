/**
 * scripts/test-plan-pdf.js — Phase 5: the diet plan as a PDF, grocery and prep lists.
 *
 * Real Postgres and routes. The PDF is checked two ways without any PDF
 * library (none is installed on the gate): its structure (every object where
 * the cross-reference table says it is) and its text (the content streams are
 * uncompressed, so every shown string can be read back).
 *
 * WHAT MUST HOLD
 *   A. A valid PDF: header, objects at their xref offsets, trailer, %%EOF.
 *   B. It says what the member sees in the app: title, targets, every meal
 *      with times, foods, measures and kcal; timetable, avoid, cautions
 *      (lab cautions included); grocery totals for the week; prep by day.
 *   C. It never contains the coach's working notes: the brief, the lab flags,
 *      the checks or the model's adjustment notes.
 *   D. Members get their own plan in force; a coach only their own members'
 *      plans; a draft is marked DRAFT on every page.
 *   E. Text the PDF fonts cannot show (Kannada letters, emoji) never breaks it.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const DP = require('../services/dietPlan');
const P = require('../services/planPdf');
const { wrap, widthOf, clean } = require('../services/pdfDoc');
const { getISTDate } = require('../utils/istDate');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

/** Structure: header, every xref offset points at "N 0 obj", trailer, EOF. */
function pdfStructureOk(buf) {
  const s = buf.toString('latin1');
  if (!s.startsWith('%PDF-1.4') || !s.trimEnd().endsWith('%%EOF')) return 'header or EOF';
  const sx = /startxref\n(\d+)\n%%EOF/.exec(s); if (!sx) return 'no startxref';
  const xrefAt = +sx[1]; if (!s.slice(xrefAt).startsWith('xref')) return 'startxref wrong';
  const m = /xref\n0 (\d+)\n0000000000 65535 f \n/.exec(s.slice(xrefAt)); if (!m) return 'xref header';
  const n = +m[1];
  const entries = s.slice(xrefAt + m[0].length).split('\n').slice(0, n - 1);
  for (let i = 0; i < n - 1; i++) {
    const off = parseInt(entries[i], 10);
    if (!s.slice(off).startsWith(`${i + 1} 0 obj`)) return `object ${i + 1} not at ${off}`;
  }
  for (const st of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = st.index + st[0].length, len = +st[1];
    if (s.slice(start + len, start + len + 10) !== '\nendstream') return 'stream length';
  }
  return true;
}
/** Every string shown on the pages, in order. */
const pdfText = (buf) => [...buf.toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(m => m[1].replace(/\\([\\()])/g, '$1')).join('\n');
const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page /g) || []).length;

(async () => {
  console.log('\n[0] the PDF writer (no database)');
  {
    ck('wrapped lines never run past their width', wrap('Paneer-mushroom-capsicum masala with menthya soppu and a squeeze of lemon on top '.repeat(4), 10, 200).every(l => widthOf(l, 10) <= 200));
    ck('a word longer than the line is cut, not left to overflow', wrap('Supercalifragilisticexpialidociousandthensome', 10, 60).every(l => widthOf(l, 10) <= 60));
    ck('Kannada letters and emoji are dropped; dashes and quotes become plain ones', clean('ರಾಗಿ Ragi mudde 🍛 – “soft”') === 'Ragi mudde - "soft"', clean('ರಾಗಿ Ragi mudde 🍛 – “soft”'));
  }

  // ── A plan in the database ─────────────────────────────────────────────────
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role) => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  const coach = await mk('Sachin', '9501', 'monitor'), other = await mk('Other Coach', '9502', 'monitor');
  const member = await mk('Padmini Ravi ಪದ್ಮಿನಿ', '9503', 'patient'), nobody = await mk('No Plan', '9504', 'patient');
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true), ($1,$3,true)`, [coach, member, nobody]);
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1), ($2)`, [member, nobody]);
  const today = getISTDate();
  const it = (name, grams, k, q) => ({ name, grams, qty_text: q, kcal_100g: k, protein_100g: 5, carbs_100g: 10, fat_100g: 3 });
  const draft = DP.normaliseDraft({ title: 'Low carb vegetarian', eating_window: '12:00-20:00', targets: { kcal: 1500, protein: 110, carbs: 130, fat: 78 },
    timetable: [{ time: '06:00', what: 'Wake, 500 ml warm water' }],
    meals: [
      { meal: 'Meal 1', time: '12:00', items: [it('Curd', 200, 60, '1 katori'), it('Moong dal', 100, 105)],
        rotation: { mon: it('Palak paneer', 150, 180), tue: it('Paneer bhurji', 150, 265), wed: it('Tofu stir fry', 150, 160), thu: it('Methi paneer', 150, 250),
                    fri: it('Rajma', 150, 140), sat: it('Soya chunk curry', 150, 170), sun: it('Paneer tikka', 150, 260) } },
      { meal: 'Meal 2', time: '16:00', items: [it('Whey protein', 30, 400, '1 scoop'), it('Guava 🍐', 150, 68),
        // Live PDF, 6 Oct: grams added twice, and a note cut at 40 characters.
        it('Idli', 50, 134, '1 idli (50 g)'), it('Raw vegetable bowl', 200, 25, '200 g, with 1 teaspoon olive oil + lemon'),
        it('Soppina palya', 100, 23, '100 g. A different soppu each day - you choose which: palak, dantu, sabsige or menthya')] }],
    avoid: ['sugar', 'maida'], cautions: ['See your doctor for a BP check.'],
    adjustments: [{ for: 'Glucose', note: 'SECRET-ADJUSTMENT carbs kept low' }] });
  const flags = [{ kind: 'lab', test: 'Fasting Glucose', status: 'high', text: 'Fasting Glucose is high: 132 mg/dL', source: 'Lab result', date: DP.addDays(today, -20), stale: false }];
  const inTx = async (fn) => { const c = await pool.connect(); try { await c.query('BEGIN'); const o = await fn(c); await c.query('COMMIT'); return o; } finally { c.release(); } };
  const planId = await inTx(c => DP.saveDraft(c, { memberId: member, coachId: coach, source: 'brief', title: draft.title, brief: 'SECRET-BRIEF 1500 kcal', targets: draft.targets, content: draft.content, flags, days: draft.days }));

  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use('/api/diet-plans', require('../routes/dietPlans'));
  const srv = app.listen(0); const port = srv.address().port;
  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const M = tok(member, 'patient'), N = tok(nobody, 'patient'), C = tok(coach, 'monitor'), O = tok(other, 'monitor');
  const get = async (p, t) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { headers: { Authorization: 'Bearer ' + t } });
    return { status: r.status, type: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), buf: Buffer.from(await r.arrayBuffer()) }; };

  console.log('\n[1] a draft');
  {
    ck('the member has no PDF while the plan is only a draft', (await get('/api/diet-plans/me/pdf', M)).status === 404);
    const r = await get(`/api/diet-plans/${planId}/pdf`, C);
    ck('the coach can download the draft as a PDF', r.status === 200 && r.type === 'application/pdf' && pdfStructureOk(r.buf) === true, pdfStructureOk(r.buf));
    const t = pdfText(r.buf);
    ck('it says DRAFT, not approved, and on every page footer', /DRAFT - not approved yet/.test(t) && (t.match(/\(DRAFT, not approved\)/g) || []).length === pages(r.buf), [(t.match(/\(DRAFT, not approved\)/g) || []).length, pages(r.buf)]);
    ck('another coach cannot', (await get(`/api/diet-plans/${planId}/pdf`, O)).status === 403);
    ck('a member cannot use the coach route', (await get(`/api/diet-plans/${planId}/pdf`, M)).status === 403);
  }

  console.log('\n[2] the approved plan, as the member downloads it');
  await inTx(c => DP.approveDraft(c, planId, { coachId: coach, today, effectiveFrom: today, acknowledgeWarnings: true }));
  const r = await get('/api/diet-plans/me/pdf', M);
  const t = pdfText(r.buf);
  {
    ck('a PDF, as a download named after the member and version', r.status === 200 && r.type === 'application/pdf' && /attachment; filename="FitLife-Diet-Plan-Padmini-Ravi-v1\.pdf"/.test(r.disp), [r.status, r.disp]);
    ck('a structurally valid PDF', pdfStructureOk(r.buf) === true, pdfStructureOk(r.buf));
    ck('two or three A4 pages, numbered', pages(r.buf) >= 2 && pages(r.buf) <= 3 && /Page 1 of \d/.test(t), pages(r.buf));
    ck('title, who it is for and from whom, version and start date', /Low carb vegetarian/.test(t) && /For Padmini Ravi - from coach Sachin - version 1 - from \d+ \w{3} \d{4}/.test(t), t.slice(0, 300));
    ck('the member\'s Kannada letters are dropped cleanly, not as garbage', !/[^\x09\x0A\x0D\x20-\xFF]/.test(t) && /Padmini Ravi/.test(t));
    ck('the four targets', /1,500/.test(t) && /110 g/.test(t) && /130 g/.test(t) && /78 g/.test(t));
    ck('each meal with its time', /12:00 PM Meal 1/.test(t) && /4:00 PM Meal 2/.test(t));
    ck('foods with the household measure, grams and kcal', /Curd\n1 katori \(200 g\)\n120 kcal/.test(t) && /Whey protein\n1 scoop \(30 g\)\n120 kcal/.test(t), t.slice(t.indexOf('Curd') - 5, t.indexOf('Curd') + 60));
    ck('the dishes that change by day, each with its day', /Mon: Palak paneer\n150 g\n270 kcal/.test(t) && /Sun: Paneer tikka/.test(t));
    ck('the emoji in a food name is dropped, the name kept', /\nGuava\n/.test(t));
    ck('a measure that already gives the weight is not given it twice ("1 idli (50 g)")', /\n1 idli \(50 g\)\n/.test(t) && !/\(50 g\) \(50 g\)/.test(t));
    ck('"200 g, with 1 teaspoon olive oil + lemon" gets no extra "(200 g)"', /200 g, with 1 teaspoon olive oil \+ lemon 50 kcal/.test(t.replace(/\n/g, ' ')) && !/lemon \(200 g\)/.test(t.replace(/\n/g, ' ')), t.slice(t.indexOf('Raw vegetable'), t.indexOf('Raw vegetable') + 80));
    ck('a measure with no weight still gets one ("1 scoop (30 g)")', /1 scoop \(30 g\)/.test(t));
    ck('a long note is kept whole, not cut at 40 characters', /you choose which: palak, dantu, sabsige/.test(t.replace(/\n/g, ' ')) && /or menthya/.test(t.replace(/\n/g, ' ')), t.slice(t.indexOf('Soppina'), t.indexOf('Soppina') + 160));
    const stored = (await pool.query(`SELECT qty_text FROM diet_plan_items WHERE plan_id=$1 AND name='Soppina palya' LIMIT 1`, [planId])).rows[0]?.qty_text;
    ck('and the database keeps it whole too (real Postgres column)', stored === '100 g. A different soppu each day - you choose which: palak, dantu, sabsige or menthya', stored);
    ck('the eating window, timetable and avoid list', /Eating window: 12:00-20:00/.test(t) && /6:00 AM\nWake, 500 ml warm water/.test(t) && /sugar, maida/.test(t));
    ck('the lab caution and the coach\'s caution', /Fasting Glucose is high: 132 mg\/dL/.test(t) && /BP check/.test(t));
    ck('not the coach\'s brief', !/SECRET-BRIEF/.test(t));
    ck('not the model\'s adjustment notes', !/SECRET-ADJUSTMENT/.test(t));
    ck('not the raw lab flag text on its own (only the caution built from it)', (t.match(/Fasting Glucose is high/g) || []).length === 1);
    ck('it says it is dietary guidance, not medical treatment', /not medical treatment/.test(t) && /does not replace your doctor/.test(t));
  }

  console.log('\n[3] grocery and prep lists');
  {
    ck('the PDF lists the week: curd 200 g x 7 = 1.4 kg, whey 210 g, a one-day dish 150 g', /Curd\n1\.4 kg\nevery day/.test(t) && /Whey protein\n210 g\nevery day/.test(t) && /Rajma\n150 g\n1 day/.test(t));
    ck('and the prep list by day', /Prep list/.test(t) && /Monday\nPalak paneer, 150 g \(Meal 1\)/.test(t) && /Every day:/.test(t));
    ck('it says the amounts are as eaten, and how raw rice and dal compare', /as eaten \(cooked weight\)/.test(t) && /a third to half/.test(t));
    const g = await fetch(`http://127.0.0.1:${port}/api/diet-plans/me/grocery`, { headers: { Authorization: 'Bearer ' + M } }).then(x => x.json());
    ck('the app\'s grocery list is the same: alphabetical, summed over seven days', g.items.map(i => i.name).slice(0, 3).join() === 'Curd,Guava 🍐,Idli' && g.items.find(i => i.name === 'Curd').grams === 1400 && g.items.find(i => i.name === 'Curd').days === 7, g.items.slice(0, 3));
    ck('with the prep list by weekday', g.prep.byDay.length === 7 && /Palak paneer/.test(g.prep.byDay[0][0]) && g.prep.everyday.length === 7, g.prep);
    ck('no plan: an empty list, and no PDF', (await fetch(`http://127.0.0.1:${port}/api/diet-plans/me/grocery`, { headers: { Authorization: 'Bearer ' + N } }).then(x => x.json())).items.length === 0
       && (await get('/api/diet-plans/me/pdf', N)).status === 404);
    ck('the coach\'s PDF of the approved plan is not marked DRAFT', !/DRAFT/.test(pdfText((await get(`/api/diet-plans/${planId}/pdf`, C)).buf)));
  }

  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-plan-pdf: ${pass} passed, ${fail} failed\n`);
  srv.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
