/**
 * services/dietPlan.js — versioned diet plans (Phase 1).
 *
 * THE RULES
 * ---------
 * 1. A plan is a VERSION. Drafts can be edited; an approved version never
 *    changes. Changing a plan means a new draft and a new approval.
 * 2. The version in force on a date is, of the approved versions that have
 *    started by then, the one approved last. The old plan stays in force
 *    until the new one's start date — revising never leaves a member with
 *    nothing.
 * 3. meal_plans rows (what the food log shows) are GENERATED from the version
 *    in force. They are filled ahead at approval and topped up on read, so a
 *    plan no longer runs out after N days.
 * 4. Flags come from stored data — a lab row, a profile condition — and each
 *    one says where it came from and when. The model does not invent flags.
 * 5. Checks are arithmetic, done here, not by the model. A food with no
 *    calorie figure is an error: such a plan cannot be approved.
 *
 * Nothing in this file calls an AI. The route does that and hands the result
 * to normaliseDraft(), so every rule here runs in tests against real Postgres
 * with no stubbing.
 */

const { normaliseNutrients } = require('./nutrients');

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FILL_AHEAD_DAYS = 30;

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** 0 = Monday … 6 = Sunday, for a YYYY-MM-DD string. Pure calendar maths on
 *  the date string, so it cannot shift with the server's timezone. */
function weekdayOf(dateStr) {
  return (new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const num = (v, lo, hi) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));
const list = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : []).map(x => str(x, maxLen)).filter(Boolean).slice(0, maxItems);

// ── Normalising ──────────────────────────────────────────────────────────────

function normaliseTargets(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const int = (v, max) => { const n = Math.round(parseFloat(v)); return Number.isFinite(n) && n > 0 && n <= max ? n : null; };
  return {
    kcal:    int(t.kcal ?? t.calories, 6000),
    protein: int(t.protein ?? t.pro, 500),
    carbs:   int(t.carbs ?? t.carb, 800),
    fat:     int(t.fat, 400),
    fiber:   int(t.fiber ?? t.fibre, 150),
  };
}

function normaliseContent(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const time = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim().padStart(5, '0') : '');
  return {
    eating_window: str(c.eating_window, 40) || null,
    timetable: (Array.isArray(c.timetable) ? c.timetable : [])
      .map(r => ({ time: time(r?.time), what: str(r?.what, 160) }))
      .filter(r => r.what).slice(0, 24),
    avoid:    list(c.avoid, 40, 60),
    cautions: list(c.cautions, 20, 240),
    // What the model says it did about each flag. Shown as the model's note,
    // never as a flag in its own right.
    adjustments: (Array.isArray(c.adjustments) ? c.adjustments : [])
      .map(a => ({ for: str(a?.for, 60), note: str(a?.note, 240) }))
      .filter(a => a.note).slice(0, 12),
  };
}

/** One prescribed item. Accepts the model's compact fields (kcal_100g …) or a
 *  per_100g object. Clamps match normaliseMealPlan in routes/aiChat.js. */
function normaliseItem(it) {
  if (!it || typeof it !== 'object') return null;
  const name  = str(it.name, 100);
  const grams = num(it.grams, 1, 2000);
  if (!name || grams === null) return null;
  const p = it.per_100g && typeof it.per_100g === 'object' ? it.per_100g : {};
  const per_100g = {
    ...normaliseNutrients(p),
    calories:    num(p.calories ?? it.kcal_100g, 0, 900) ?? 0,
    protein:     num(p.protein ?? it.protein_100g, 0, 100) ?? 0,
    total_carbs: num(p.total_carbs ?? it.carbs_100g, 0, 100) ?? 0,
    fat:         num(p.fat ?? it.fat_100g, 0, 100) ?? 0,
  };
  return { name, grams, qty_text: str(it.qty_text, 40) || `${grams} g`, per_100g };
}

/**
 * Turn a model's draft into seven days of meals.
 *
 * The model returns each meal once, with the items eaten every day and an
 * optional `rotation` — one extra item per weekday (Monday's paneer bhurji,
 * Tuesday's paneer-mushroom masala). That is how a coach writes a plan, and
 * it keeps the response small enough to come back whole.
 *
 * @returns {{title, targets, content, days: Array<Array<{meal, time, items}>>}|null}
 */
function normaliseDraft(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const time = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim().padStart(5, '0') : null);
  const head = () => ({
    title:   str(raw.title, 120) || 'Diet plan',
    targets: normaliseTargets(raw.targets),
    content: normaliseContent(raw),
  });

  // A model asked to "change this plan" sometimes answers in seven explicit
  // days instead of meals + rotation. Accept that too.
  if (!Array.isArray(raw.meals) && Array.isArray(raw.days) && raw.days.length === 7) {
    const days = raw.days.map(d => (Array.isArray(d) ? d : (Array.isArray(d?.meals) ? d.meals : []))
      .slice(0, 6)
      .map(m => ({ meal: str(m?.meal, 40), time: time(m?.time),
                   items: (Array.isArray(m?.items) ? m.items : []).slice(0, 15).map(normaliseItem).filter(Boolean) }))
      .filter(m => m.meal && m.items.length));
    return days.some(d => d.length) ? { ...head(), days } : null;
  }
  if (!Array.isArray(raw.meals)) return null;

  const meals = raw.meals.slice(0, 6).map(m => {
    const meal = str(m?.meal, 40);
    if (!meal) return null;
    const fixed = (Array.isArray(m.items) ? m.items : []).slice(0, 15).map(normaliseItem).filter(Boolean);
    const rot = m.rotation && typeof m.rotation === 'object' ? m.rotation : {};
    // One rotating item per weekday, or a list of them.
    const rotation = WEEKDAYS.map(w => (Array.isArray(rot[w]) ? rot[w] : [rot[w]]).map(normaliseItem).filter(Boolean));
    return { meal, time: time(m.time), fixed, rotation };
  }).filter(Boolean);

  const days = WEEKDAYS.map((_, w) => meals
    .map(m => ({ meal: m.meal, time: m.time, items: [...m.rotation[w], ...m.fixed] }))
    .filter(m => m.items.length));

  if (!days.some(d => d.length)) return null;
  return { ...head(), days };
}

/**
 * The reverse of normaliseDraft: seven days back into meals + rotation, the
 * shape the draft prompt asks the model to return. Items on all seven days go
 * in "items"; the rest go in "rotation" for their weekday. Sending the current
 * draft in the SAME shape the model must answer in keeps it from echoing the
 * input shape back.
 */
function toMealsShape(days) {
  const order = [];
  (days || []).forEach(d => d.forEach(m => { if (!order.includes(m.meal)) order.push(m.meal); }));
  const brief = (it) => ({ name: it.name, grams: Number(it.grams) });
  return order.map(meal => {
    const perDay = WEEKDAYS.map((_, w) => (days[w] || []).find(m => m.meal === meal));
    const key = (it) => `${String(it.name).toLowerCase()}|${Number(it.grams)}`;
    const everyDay = (perDay[0]?.items || []).filter(it => perDay.every(m => m && m.items.some(x => key(x) === key(it))));
    const fixed = new Set(everyDay.map(key));
    const rotation = {};
    WEEKDAYS.forEach((wd, w) => {
      const extra = (perDay[w]?.items || []).filter(it => !fixed.has(key(it))).map(brief);
      if (extra.length) rotation[wd] = extra.length === 1 ? extra[0] : extra;
    });
    return { meal, time: perDay.find(Boolean)?.time || null, items: everyDay.map(brief),
             ...(Object.keys(rotation).length ? { rotation } : {}) };
  });
}

// ── Flags: from stored data only ─────────────────────────────────────────────

/**
 * @param {Array} labRows   lab_values rows, any order
 * @param {Array} conditions patient_profiles.conditions
 * @param {string} today    YYYY-MM-DD
 */
function buildFlags(labRows, conditions, today) {
  const latest = new Map();
  for (const r of labRows || []) {
    const key = String(r.test_name || '').toLowerCase();
    const d = String(r.test_date).slice(0, 10);
    if (!key) continue;
    if (!latest.has(key) || d > latest.get(key).date) latest.set(key, { ...r, date: d });
  }
  const flags = [];
  for (const r of latest.values()) {
    if (r.status !== 'high' && r.status !== 'low') continue;
    const ageDays = Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${r.date}T00:00:00Z`)) / 86400000);
    flags.push({
      kind: 'lab', test: r.test_name, status: r.status,
      value: Number(r.value), unit: r.unit || '',
      source: 'Lab result', date: r.date, stale: ageDays > 180,
      text: `${r.test_name} is ${r.status}: ${Number(r.value)}${r.unit ? ' ' + r.unit : ''}`,
    });
  }
  flags.sort((a, b) => a.test.localeCompare(b.test));
  for (const c of Array.isArray(conditions) ? conditions : []) {
    const label = str(c, 60).replace(/_/g, ' ');
    if (label) flags.push({ kind: 'condition', source: 'Member profile', date: null, text: `Condition on file: ${label}` });
  }
  return flags;
}

// ── Checks: arithmetic, not opinion ──────────────────────────────────────────

const itemKcal = (it) => (Number(it.grams) || 0) * (Number(it.per_100g?.calories) || 0) / 100;

function runChecks({ targets, content, days }) {
  const out = [];
  const t = targets || {};

  const empty = (days || []).map((d, w) => (d && d.some(m => m.items.length) ? null : WEEKDAY_NAMES[w])).filter(Boolean);
  if (!days || days.length !== 7 || empty.length === 7) {
    out.push({ level: 'error', code: 'no_meals', text: 'The plan has no meals.' });
    return out;
  }
  if (empty.length) {
    out.push({ level: 'error', code: 'empty_day', text: `No meals on ${empty.join(', ')}.` });
  }

  if (!t.kcal) {
    out.push({ level: 'warn', code: 'no_targets', text: 'No daily calorie target is set.' });
  } else if (t.protein && t.carbs && t.fat) {
    const calc = 4 * t.protein + 4 * t.carbs + 9 * t.fat;
    if (Math.abs(calc - t.kcal) / t.kcal > 0.10) {
      out.push({ level: 'warn', code: 'macro_mismatch',
        text: `Protein, carbs and fat add up to ${calc} kcal, but the calorie target is ${t.kcal}.` });
    }
  }

  const unknown = new Set();
  days.forEach(d => d.forEach(m => m.items.forEach(it => { if (!(Number(it.per_100g?.calories) > 0)) unknown.add(it.name); })));
  if (unknown.size) {
    // An ERROR, not a warning. As a warning it was ticked through, and a plan
    // went live where most foods counted as 0 kcal: the member saw "~0 kcal"
    // meals and the day "added up" to 764 of 1,800.
    out.push({ level: 'error', code: 'no_nutrition',
      text: `No calorie figure for: ${[...unknown].slice(0, 8).join(', ')}${unknown.size > 8 ? '…' : ''}. Look them up or remove them before approving.` });
  }

  if (t.kcal) {
    const off = [];
    days.forEach((d, w) => {
      if (!d.length) return;
      const total = Math.round(d.reduce((a, m) => a + m.items.reduce((b, it) => b + itemKcal(it), 0), 0));
      if (Math.abs(total - t.kcal) / t.kcal > 0.15) off.push(`${WEEKDAY_NAMES[w].slice(0, 3)} ${total}`);
    });
    if (off.length) {
      out.push({ level: 'warn', code: 'day_total',
        text: `Meals do not add up to the ${t.kcal} kcal target (more than 15% off): ${off.join(', ')} kcal.` });
    }
  }

  // An item the plan itself says to avoid. Whole-word match, so "ghee" in the
  // avoid list does not trip on an unrelated word that merely contains it.
  const hits = new Set();
  for (const term of content?.avoid || []) {
    const word = String(term).toLowerCase().trim();
    if (word.length < 3) continue;
    const re = new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
    days.forEach(d => d.forEach(m => m.items.forEach(it => { if (re.test(it.name)) hits.add(`${it.name} (${m.meal}) vs avoid "${term}"`); })));
  }
  if (hits.size) {
    out.push({ level: 'warn', code: 'avoid_conflict',
      text: `On the avoid list but in a meal: ${[...hits].slice(0, 6).join('; ')}.` });
  }
  return out;
}

const hasErrors   = (checks) => (checks || []).some(c => c.level === 'error');
const hasWarnings = (checks) => (checks || []).some(c => c.level === 'warn');

// ── Differences between two versions ─────────────────────────────────────────

function diffPlans(prev, next) {
  if (!prev) return null;
  const out = { targets: [], added: [], removed: [], changed: [], avoid: { added: [], removed: [] }, cautions: { added: [], removed: [] } };
  for (const k of ['kcal', 'protein', 'carbs', 'fat', 'fiber']) {
    const a = prev.targets?.[k] ?? null, b = next.targets?.[k] ?? null;
    if (a !== b) out.targets.push({ key: k, from: a, to: b });
  }
  const index = (plan) => {
    const m = new Map();
    (plan.days || []).forEach((d, w) => d.forEach(meal => meal.items.forEach(it => {
      m.set(`${w}|${meal.meal.toLowerCase()}|${it.name.toLowerCase()}`, { w, meal: meal.meal, name: it.name, grams: Number(it.grams) });
    })));
    return m;
  };
  const A = index(prev), B = index(next);
  // The same change on several weekdays is one line, not seven.
  const bucket = (arr, key, w, base) => {
    let row = arr.find(r => r.key === key);
    if (!row) { row = { key, ...base, weekdays: [] }; arr.push(row); }
    row.weekdays.push(w);
  };
  for (const [k, b] of B) {
    const a = A.get(k);
    if (!a) bucket(out.added, `${b.meal}|${b.name}|${b.grams}`, b.w, { meal: b.meal, name: b.name, grams: b.grams });
    else if (a.grams !== b.grams) bucket(out.changed, `${b.meal}|${b.name}|${a.grams}|${b.grams}`, b.w, { meal: b.meal, name: b.name, from: a.grams, to: b.grams });
  }
  for (const [k, a] of A) {
    if (!B.has(k)) bucket(out.removed, `${a.meal}|${a.name}`, a.w, { meal: a.meal, name: a.name, grams: a.grams });
  }
  for (const arr of [out.added, out.removed, out.changed]) arr.forEach(r => { delete r.key; });
  for (const f of ['avoid', 'cautions']) {
    const a = new Set((prev.content?.[f] || []).map(x => x.toLowerCase()));
    const b = new Set((next.content?.[f] || []).map(x => x.toLowerCase()));
    out[f].added   = (next.content?.[f] || []).filter(x => !a.has(x.toLowerCase()));
    out[f].removed = (prev.content?.[f] || []).filter(x => !b.has(x.toLowerCase()));
  }
  out.same = !out.targets.length && !out.added.length && !out.removed.length && !out.changed.length
    && !out.avoid.added.length && !out.avoid.removed.length && !out.cautions.added.length && !out.cautions.removed.length;
  return out;
}

// ── Database ─────────────────────────────────────────────────────────────────

function groupDays(itemRows) {
  const days = WEEKDAYS.map(() => []);
  for (const r of itemRows) {
    const day = days[r.weekday];
    let meal = day.find(m => m.meal === r.meal);
    if (!meal) { meal = { meal: r.meal, time: r.meal_time || null, items: [] }; day.push(meal); }
    meal.items.push({ id: r.id, name: r.name, grams: Number(r.grams), qty_text: r.qty_text, per_100g: r.per_100g || {} });
  }
  return days;
}

const PLAN_COLS = `id, patient_id, monitor_id, version, status, source, title, brief, targets, content,
  flags, checks, effective_from::text AS effective_from, targets_applied, approved_at, approved_by, created_at, updated_at`;

async function loadPlan(db, id) {
  const { rows: [plan] } = await db.query(`SELECT ${PLAN_COLS} FROM diet_plans WHERE id = $1`, [id]);
  if (!plan) return null;
  const { rows } = await db.query(
    `SELECT id, weekday, meal, meal_time, name, grams, qty_text, per_100g
       FROM diet_plan_items WHERE plan_id = $1
      ORDER BY weekday, meal_order, position, id`, [id]);
  return { ...plan, days: groupDays(rows) };
}

/**
 * The approved version in force for a member on a date, or null.
 *
 * Of the versions that have started by that date, the one approved LAST wins:
 * the coach's most recent decision stands. So a plan scheduled for next week
 * takes over next week — unless the coach approves something else after it.
 */
async function planInForce(db, memberId, date) {
  const { rows: [row] } = await db.query(
    `SELECT id FROM diet_plans
      WHERE patient_id = $1 AND status = 'approved' AND effective_from <= $2::date
      ORDER BY approved_at DESC, version DESC LIMIT 1`, [memberId, date]);
  return row ? loadPlan(db, row.id) : null;
}

async function insertItems(client, planId, days) {
  for (let w = 0; w < 7; w++) {
    const day = days[w] || [];
    for (let mi = 0; mi < day.length; mi++) {
      const m = day[mi];
      for (let i = 0; i < m.items.length; i++) {
        const it = m.items[i];
        await client.query(
          `INSERT INTO diet_plan_items (plan_id, weekday, meal, meal_time, meal_order, position, name, grams, qty_text, per_100g)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [planId, w, m.meal, m.time || null, mi, i, it.name, it.grams, it.qty_text || null, JSON.stringify(it.per_100g || {})]);
      }
    }
  }
}

/** Serialise version numbering per member: two requests at once must not both
 *  read the same MAX(version). Held until the transaction ends. */
const lockMember = (client, memberId) =>
  client.query('SELECT pg_advisory_xact_lock($1, $2)', [74101, memberId]);

async function nextVersion(client, memberId) {
  await lockMember(client, memberId);
  const { rows: [r] } = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM diet_plans WHERE patient_id = $1`, [memberId]);
  return r.v;
}

/**
 * Save a draft, replacing any draft the member already has. Must run inside
 * the caller's transaction.
 */
async function saveDraft(client, { memberId, coachId, source, title, brief, targets, content, flags, days }) {
  // Lock, drop the old draft, THEN number: a replaced draft gives its version
  // number back, so approved versions count 1, 2, 3 without gaps from drafts.
  await lockMember(client, memberId);
  await client.query(`DELETE FROM diet_plans WHERE patient_id = $1 AND status = 'draft'`, [memberId]);
  const version = await nextVersion(client, memberId);
  const checks = runChecks({ targets, content, days });
  const { rows: [row] } = await client.query(
    `INSERT INTO diet_plans (patient_id, monitor_id, version, status, source, title, brief, targets, content, flags, checks)
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [memberId, coachId, version, source, title || 'Diet plan', brief || null,
     JSON.stringify(targets || {}), JSON.stringify(content || {}), JSON.stringify(flags || []), JSON.stringify(checks)]);
  await insertItems(client, row.id, days);
  return row.id;
}

/** Re-save a draft's editable parts and re-run the checks. Draft only. */
async function updateDraft(client, planId, { title, targets, content, days, effective_from }) {
  const { rows: [cur] } = await client.query(
    `SELECT id FROM diet_plans WHERE id = $1 AND status = 'draft' FOR UPDATE`, [planId]);
  if (!cur) { const e = new Error('Only a draft can be edited.'); e.status = 409; throw e; }
  const plan = await loadPlan(client, planId);
  const next = {
    title:   title ?? plan.title,
    targets: targets ? normaliseTargets(targets) : plan.targets,
    content: content ? normaliseContent({ ...plan.content, ...content }) : plan.content,
    days:    days ?? plan.days,
  };
  const checks = runChecks(next);
  await client.query(
    `UPDATE diet_plans SET title=$2, targets=$3, content=$4, checks=$5,
            effective_from = COALESCE($6::date, effective_from), updated_at = NOW()
      WHERE id = $1`,
    [planId, str(next.title, 120) || 'Diet plan', JSON.stringify(next.targets), JSON.stringify(next.content),
     JSON.stringify(checks), isDate(effective_from) ? effective_from : null]);
  if (days) {
    await client.query(`DELETE FROM diet_plan_items WHERE plan_id = $1`, [planId]);
    await insertItems(client, planId, days);
  }
}

/** Write one date's prescribed meals from a plan. */
async function writeDay(client, plan, date, { overwrite }) {
  const day = plan.days[weekdayOf(date)] || [];
  for (const m of day) {
    const items = m.items.map(it => ({
      name: it.name, grams: it.grams, qty_text: it.qty_text || `${it.grams} g`, per_100g: it.per_100g || {},
      plan_item_id: it.id, plan_id: plan.id, plan_version: plan.version,
    }));
    // clock_timestamp(), not NOW(): the readers order a day's meals by
    // created_at, and NOW() is identical for every row of one transaction.
    await client.query(
      `INSERT INTO meal_plans (patient_id, monitor_id, plan_date, meal, items, created_at)
       VALUES ($1,$2,$3,$4,$5, clock_timestamp())
       ON CONFLICT (patient_id, plan_date, meal) DO ${overwrite
         ? 'UPDATE SET items = EXCLUDED.items, monitor_id = EXCLUDED.monitor_id, created_at = EXCLUDED.created_at'
         : 'NOTHING'}`,
      [plan.patient_id, plan.monitor_id, date, m.meal, JSON.stringify(items)]);
  }
}

/** Replace every prescribed day from `from` onward with this plan's meals. */
async function fillAhead(client, plan, from, days = FILL_AHEAD_DAYS) {
  await client.query(`DELETE FROM meal_plans WHERE patient_id = $1 AND plan_date >= $2::date`, [plan.patient_id, from]);
  for (let d = 0; d < days; d++) await writeDay(client, plan, addDays(from, d), { overwrite: true });
}

async function applyTargets(client, plan) {
  const t = plan.targets || {};
  if (t.kcal || t.protein || t.carbs || t.fat) {
    await client.query(
      `INSERT INTO patient_profiles (user_id, macro_kcal, macro_pro, macro_carb, macro_fat)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         macro_kcal = COALESCE(EXCLUDED.macro_kcal, patient_profiles.macro_kcal),
         macro_pro  = COALESCE(EXCLUDED.macro_pro,  patient_profiles.macro_pro),
         macro_carb = COALESCE(EXCLUDED.macro_carb, patient_profiles.macro_carb),
         macro_fat  = COALESCE(EXCLUDED.macro_fat,  patient_profiles.macro_fat),
         updated_at = NOW()`,
      [plan.patient_id, t.kcal || null, t.protein || null, t.carbs || null, t.fat || null]);
  }
  await client.query(`UPDATE diet_plans SET targets_applied = true WHERE id = $1`, [plan.id]);
}

/**
 * Approve a draft. Inside the caller's transaction.
 *
 * The status flip is the lock: `WHERE status = 'draft'` means that of two
 * approvals arriving together exactly one updates a row, and the other is
 * told the draft is gone.
 */
async function approveDraft(client, planId, { coachId, effectiveFrom, today, acknowledgeWarnings }) {
  const plan = await loadPlan(client, planId);
  if (!plan) { const e = new Error('Plan not found.'); e.status = 404; throw e; }
  const checks = runChecks(plan);
  if (hasErrors(checks)) { const e = new Error(checks.find(c => c.level === 'error').text); e.status = 422; e.checks = checks; throw e; }
  if (hasWarnings(checks) && !acknowledgeWarnings) {
    const e = new Error('This plan has warnings. Review them and confirm to approve.'); e.status = 422; e.checks = checks; e.needsAck = true; throw e;
  }
  // Never back-date: a start in the past would rewrite days already lived.
  const from = isDate(effectiveFrom) && effectiveFrom > today ? effectiveFrom : today;

  const { rows: [done] } = await client.query(
    `UPDATE diet_plans
        SET status = 'approved', approved_at = NOW(), approved_by = $2,
            effective_from = $3::date, checks = $4, updated_at = NOW()
      WHERE id = $1 AND status = 'draft' RETURNING id`,
    [planId, coachId, from, JSON.stringify(checks)]);
  if (!done) { const e = new Error('This draft was already approved or discarded.'); e.status = 409; throw e; }

  const approved = await loadPlan(client, planId);
  await fillAhead(client, approved, from);
  if (from <= today) await applyTargets(client, approved);
  return approved;
}

/**
 * Make sure a date has its prescribed meals, generated from the plan in force.
 * Called when a member opens a day, so a plan never "runs out". Does nothing
 * when the date already has any prescribed meal — a coach's one-off change to
 * a day is never overwritten.
 */
async function ensureDay(db, memberId, date, today) {
  const { rows: [any] } = await db.query(
    `SELECT 1 FROM meal_plans WHERE patient_id = $1 AND plan_date = $2::date LIMIT 1`, [memberId, date]);
  const plan = await planInForce(db, memberId, date);
  if (!plan) return false;
  if (!any) await writeDay(db, plan, date, { overwrite: false });
  // A plan approved with a future start date takes over the targets the first
  // time its member opens a day on or after that start.
  if (!plan.targets_applied && date === today) await applyTargets(db, plan);
  return !any;
}

/**
 * A multi-day meal plan applied through /coach-apply becomes a version too,
 * so it shows in history and keeps filling days after its stretch runs out.
 * The coach's Apply on the preview IS the approval. Inside the caller's
 * transaction; the caller has already written the stretch's meal_plans rows.
 *
 * Two shapes reach here:
 *  - A whole plan read from a document (`wholePlan`). It REPLACES the plan:
 *    the new version is exactly the document's meals.
 *  - A multi-day change to some meals ("this lunch for the next 3 days").
 *    That is NOT a new plan — breakfast must survive. The new version is the
 *    plan in force with those meals swapped in.
 */
async function recordImportedPlan(client, { memberId, coachId, title, macros, meals, today, lastDate, wholePlan }) {
  const applied = meals.map(m => ({ meal: m.meal, time: null, items: m.items.map(normaliseItem).filter(Boolean) })).filter(m => m.items.length);
  if (!applied.length) return null;
  const base = wholePlan ? null : await planInForce(client, memberId, today);

  const days = WEEKDAYS.map((_, w) => {
    if (!base) return applied.map(m => ({ ...m }));
    const day = (base.days[w] || []).map(m => ({ ...m }));
    for (const m of applied) {
      const i = day.findIndex(x => x.meal.toLowerCase() === m.meal.toLowerCase());
      if (i >= 0) day[i] = { ...day[i], items: m.items };
      else day.push({ ...m });
    }
    return day;
  });
  const given   = normaliseTargets(macros || {});
  const targets = base ? Object.fromEntries(Object.entries(given).map(([k, v]) => [k, v ?? base.targets?.[k] ?? null])) : given;
  const content = base ? base.content : normaliseContent({});
  const version = await nextVersion(client, memberId);
  const { rows: [row] } = await client.query(
    `INSERT INTO diet_plans (patient_id, monitor_id, version, status, source, title, brief, targets, content, flags, checks,
                             effective_from, targets_applied, approved_at, approved_by)
     VALUES ($1,$2,$3,'approved','import',$4,$5,$6,$7,$8,$9,$10::date,true,NOW(),$2) RETURNING id`,
    [memberId, coachId, version, str(title, 120) || base?.title || 'Coach plan', base?.brief || null,
     JSON.stringify(targets), JSON.stringify(content), JSON.stringify(base?.flags || []),
     JSON.stringify(runChecks({ targets, content, days })), today]);
  await insertItems(client, row.id, days);

  // Only rows that were GENERATED from a plan version are cleared (they carry
  // plan_id). Rows a coach wrote before plans were versioned are left alone.
  const generated = `EXISTS (SELECT 1 FROM jsonb_array_elements(items) e WHERE e ? 'plan_id')`;
  // Past the stretch just written: an older version's days. They refill from
  // this version when the member opens them.
  await client.query(
    `DELETE FROM meal_plans WHERE patient_id = $1 AND plan_date > $2::date AND ${generated}`, [memberId, lastDate]);
  // Inside the stretch, a whole new plan must not sit next to the old one's
  // differently-named meals ("Meal 1" beside the new "Breakfast").
  if (wholePlan) {
    await client.query(
      `DELETE FROM meal_plans WHERE patient_id = $1 AND plan_date BETWEEN $2::date AND $3::date
          AND NOT (meal = ANY($4)) AND ${generated}`,
      [memberId, today, lastDate, applied.map(m => m.meal)]);
  }
  return row.id;
}

module.exports = {
  WEEKDAYS, WEEKDAY_NAMES, FILL_AHEAD_DAYS,
  weekdayOf, addDays, isDate,
  normaliseTargets, normaliseContent, normaliseItem, normaliseDraft, toMealsShape,
  buildFlags, runChecks, hasErrors, hasWarnings, diffPlans,
  loadPlan, planInForce, saveDraft, updateDraft, approveDraft, ensureDay, recordImportedPlan,
};
