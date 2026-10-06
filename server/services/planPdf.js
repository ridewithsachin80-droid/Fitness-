/**
 * services/planPdf.js — Phase 5: the diet plan as a PDF, and the week's
 * grocery and prep lists.
 *
 * Built from the member's view of the plan (DP.memberView: no brief, flags,
 * checks or model notes), so the PDF says exactly what the member sees in the
 * app. Page 1: targets, meals with times and grams, the timetable, what to
 * avoid, cautions. Page 2: the grocery list for the week and the prep list.
 */
const { PdfDoc, A4, MARGIN } = require('./pdfDoc');
const DP = require('./dietPlan');

const GOLD = '#B8962E', INK = '#121316', MID = '#5B606B';
const kcalOf = (it) => Math.round((Number(it.grams) || 0) * (Number(it.per_100g?.calories) || 0) / 100);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '');
const clock = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return ''; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`; };
const amount = (g) => (g >= 1000 ? `${(Math.round(g / 100) / 10).toLocaleString('en-IN')} kg` : `${Math.round(g)} g`);

/**
 * Everything the week's meals need, added up across all seven days.
 * Amounts are AS EATEN (the plan's grams), merged by food name.
 * @returns {Array<{ name, grams, days }>} alphabetical
 */
function groceryList(days) {
  const map = new Map();
  (days || []).forEach((day, w) => (day || []).forEach(m => (m.items || []).forEach(it => {
    const key = String(it.name || '').trim().toLowerCase();
    if (!key) return;
    const row = map.get(key) || { name: String(it.name).trim(), grams: 0, days: new Set() };
    row.grams += Number(it.grams) || 0; row.days.add(w);
    map.set(key, row);
  })));
  return [...map.values()].map(r => ({ name: r.name, grams: Math.round(r.grams), days: r.days.size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The week as "every day" items and per-weekday changes, per meal, keeping
 * each item whole (grams, household measure, nutrition). DP.toMealsShape is
 * the model-facing version and keeps only names and grams.
 * @returns {Array<{ meal, time, items: [], rotation: { mon: [item], ... } }>}
 */
function weekShape(days) {
  const live = (days || []).map((d, w) => ((d || []).length ? w : -1)).filter(w => w >= 0);
  const order = [];
  live.forEach(w => days[w].forEach(m => { if (!order.includes(m.meal)) order.push(m.meal); }));
  const sig = (it) => `${String(it.name).toLowerCase()}|${Number(it.grams)}`;
  return order.map(meal => {
    const perDay = live.map(w => ({ w, m: days[w].find(x => x.meal === meal) }));
    const withMeal = perDay.filter(x => x.m);
    const first = withMeal[0]?.m;
    const everyday = (first?.items || []).filter(it => withMeal.length === live.length && withMeal.every(x => x.m.items.some(y => sig(y) === sig(it))));
    const evSig = new Set(everyday.map(sig));
    const rotation = {};
    withMeal.forEach(({ w, m }) => {
      const own = m.items.filter(it => !evSig.has(sig(it)));
      if (own.length) rotation[DP.WEEKDAYS[w]] = own;
    });
    return { meal, time: first?.time || null, items: everyday, rotation };
  });
}

/**
 * What to cook, day by day: the dishes that change by weekday, and the
 * everyday items once.
 */
function prepList(days) {
  const meals = weekShape(days);
  const everyday = [];
  const byDay = DP.WEEKDAYS.map(() => []);
  for (const m of meals) {
    for (const it of m.items || []) everyday.push(`${it.name} (${m.meal})`);
    Object.entries(m.rotation || {}).forEach(([wd, list]) => {
      const w = DP.WEEKDAYS.indexOf(wd);
      if (w >= 0) for (const it of list) byDay[w].push(`${it.name}, ${Number(it.grams)} g (${m.meal})`);
    });
  }
  return { everyday, byDay };
}

/**
 * @param {object} plan     DP.memberView(plan)
 * @param {object} opts     { memberName, coachName, draft: boolean }
 * @returns {Buffer} the PDF
 */
function planPdf(plan, { memberName = '', coachName = '', draft = false } = {}) {
  const d = new PdfDoc({ footer: `FitLife diet plan for ${memberName || 'you'} - version ${plan.version}${draft ? ' (DRAFT, not approved)' : ''} - dietary guidance from your coach, not medical treatment` });
  const W = A4.w - 2 * MARGIN;

  // ── Header ────────────────────────────────────────────────────────────────
  d.rect(MARGIN, d.y - 3, 28, 3, '#D4AF37');
  d.text(MARGIN, d.y - 16, 'FITLIFE  DIET PLAN', { size: 8.5, font: 'bold', color: GOLD });
  d.space(24);
  d.para(plan.title || 'Diet plan', { size: 20, font: 'serif', color: INK, gap: 2, lead: 1.2 });
  const sub = [memberName && `For ${memberName}`, coachName && `from coach ${coachName}`,
    `version ${plan.version}`, plan.effective_from && `from ${niceDate(plan.effective_from)}`].filter(Boolean).join(' - ');
  d.para(sub, { size: 9.5, color: MID, gap: 8 });
  if (draft) d.para('DRAFT - not approved yet. Do not follow until your coach approves it.', { size: 10, font: 'bold', color: '#B42318', gap: 8 });

  // Targets as four boxes.
  const t = plan.targets || {};
  const boxes = [['kcal a day', t.kcal], ['protein', t.protein != null ? `${t.protein} g` : null], ['carbs', t.carbs != null ? `${t.carbs} g` : null], ['fat', t.fat != null ? `${t.fat} g` : null]];
  const bw = (W - 3 * 8) / 4;
  d.ensure(52);
  boxes.forEach(([label, v], i) => {
    const x = MARGIN + i * (bw + 8);
    d.rect(x, d.y - 46, bw, 46, '#F6F4EE');
    d.text(x + 10, d.y - 24, v != null ? String(Number(v) === Number(v) && typeof v === 'number' ? v.toLocaleString('en-IN') : v) : '-', { size: 16, font: 'serif', color: INK });
    d.text(x + 10, d.y - 38, label, { size: 8.5, color: MID });
  });
  d.space(56);
  if (plan.content?.eating_window) d.para(`Eating window: ${plan.content.eating_window}. Water, black coffee or plain tea outside it.`, { size: 9.5, color: MID, gap: 6 });

  // ── Meals ─────────────────────────────────────────────────────────────────
  d.heading('Your meals');
  const meals = weekShape(plan.days || []);
  const cols = [{ width: W * 0.58 }, { width: W * 0.24 }, { width: W * 0.18, align: 'right' }];
  const qty = (it) => (it.qty_text && it.qty_text !== `${Number(it.grams)} g` ? `${it.qty_text} (${Number(it.grams)} g)` : `${Number(it.grams)} g`);
  for (const m of meals) {
    const time = m.time;
    d.ensure(40);
    d.para(`${time ? `${clock(time)}  ` : ''}${m.meal}`, { size: 11.5, font: 'bold', color: INK, gap: 2 });
    const rows = (m.items || []).map(it => [it.name, qty(it), `${kcalOf(it)} kcal`]);
    if (rows.length) d.table(rows, cols);
    const rot = Object.entries(m.rotation || {});
    if (rot.length) {
      d.para(rows.length ? 'Plus, by day:' : 'By day:', { size: 9, font: 'bold', color: MID, gap: 1 });
      d.table(rot.flatMap(([wd, list]) => list.map(it => [`${wd[0].toUpperCase()}${wd.slice(1)}: ${it.name}`, qty(it), `${kcalOf(it)} kcal`])), cols, { size: 9 });
    }
  }

  // ── Timetable, avoid, cautions ────────────────────────────────────────────
  const tt = plan.content?.timetable || [];
  if (tt.length) {
    d.heading('Your day');
    d.table(tt.map(r => [clock(r.time) || '-', r.what]), [{ width: W * 0.18, bold: true }, { width: W * 0.82 }], { zebra: false });
  }
  if ((plan.content?.avoid || []).length) {
    d.heading('Avoid');
    d.para(plan.content.avoid.join(', '), { size: 10 });
  }
  const cautions = [...(plan.content?.lab_cautions || []), ...(plan.content?.cautions || [])];
  if (cautions.length) {
    d.heading('Keep in mind');
    for (const c of cautions) d.para(`- ${c}`, { size: 9.5, gap: 2 });
    d.para('This plan is dietary guidance from your coach. It does not replace your doctor or any medicine you have been prescribed.', { size: 8.5, color: MID, gap: 2 });
  }

  // ── Page 2: grocery and prep ──────────────────────────────────────────────
  d.newPage();
  d.rect(MARGIN, d.y - 3, 28, 3, '#D4AF37');
  d.text(MARGIN, d.y - 16, 'FITLIFE  SHOPPING AND PREP', { size: 8.5, font: 'bold', color: GOLD });
  d.space(24);
  d.para('Grocery list for the week', { size: 18, font: 'serif', gap: 2, lead: 1.2 });
  d.para('Amounts are for seven days, as eaten (cooked weight). Raw rice and dal weigh roughly a third to half of their cooked weight; buy a little extra.', { size: 9, color: MID, gap: 6 });
  const g = groceryList(plan.days);
  d.table(g.map(r => [`[  ]  ${r.name}`, amount(r.grams), r.days === 7 ? 'every day' : `${r.days} ${r.days === 1 ? 'day' : 'days'}`]),
    [{ width: W * 0.6 }, { width: W * 0.2, align: 'right', bold: true }, { width: W * 0.2, align: 'right', color: MID }]);

  const p = prepList(plan.days);
  d.heading('Prep list');
  if (p.everyday.length) {
    d.para('Every day:', { size: 10, font: 'bold', gap: 1 });
    d.para(p.everyday.join('; '), { size: 9.5, gap: 6 });
  }
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const rows = p.byDay.map((list, w) => list.length ? [names[w], list.join('; ')] : null).filter(Boolean);
  if (rows.length) d.table(rows, [{ width: W * 0.2, bold: true }, { width: W * 0.8 }]);
  else d.para('Nothing changes by day: the same meals every day.', { size: 9.5, color: MID });

  return d.toBuffer();
}

const safeName = (s) => String(s || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'member';

module.exports = { planPdf, groceryList, prepList, weekShape, safeName, amount };
