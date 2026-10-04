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
 * 6. (Phase 1.3) A day over the calorie target by more than the allowed
 *    margin, or over the carb target, is an error too. "Fit to target" is
 *    arithmetic done here: it scales the portions that are not compulsory.
 * 7. (Phase 1.3) Cautions for out-of-range lab results are written here from
 *    the stored flags, so a redraft cannot drop them.
 *
 * Nothing in this file calls an AI. The route does that and hands the result
 * to normaliseDraft(), so every rule here runs in tests against real Postgres
 * with no stubbing.
 */

const { normaliseNutrients } = require('./nutrients');

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FILL_AHEAD_DAYS = 30;

// Sachin's rule: "calories adjustment 5% allowed". A day may land within 5%
// of the calorie target either way; carbs may not pass the carb target by
// more than 5%. One place to change both.
const KCAL_MARGIN = 0.05;
const CARB_MARGIN = 0.05;

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
  // compulsory: the coach's brief fixed this food and its amount ("200 g curd
  // daily"). Fit to target never changes its grams.
  return { name, grams, qty_text: str(it.qty_text, 40) || `${grams} g`, per_100g,
           compulsory: it.compulsory === true };
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
  const brief = (it) => ({ name: it.name, grams: Number(it.grams), ...(it.compulsory ? { compulsory: true } : {}) });
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

// ── Lab cautions: written by the app, from the flags ─────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prettyDate = (d) => (isDate(d) ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '');

// First rule that matches the test name AND has words for that status wins.
// Dietary points and "see your doctor" only: never a medicine, never a dose.
const LAB_ADVICE = [
  { re: /glucose|sugar|hba1c|glycated|glycosylated|\bfbs\b|\bppbs\b|\brbs\b/i,
    high: 'Keep sweets, fruit juice and maida out, and keep to the carbs in this plan. Review this result with your doctor.',
    low:  'Do not skip meals or stretch the fasting window. Tell your doctor about this result.' },
  { re: /\btsh\b|thyroid|\bft?[34]\b/i,
    any:  'Thyroid results need your doctor\'s review. Take any thyroid medicine exactly as prescribed; this plan does not replace it.' },
  { re: /b[\s-]?12|cobalamin/i,
    low:  'Food alone may not correct this. Ask your doctor about a B12 supplement.' },
  { re: /vitamin\s*d|vit\.?\s*d\b|25[\s-]?\(?oh/i,
    low:  'Food alone rarely corrects this. Ask your doctor about a vitamin D supplement, and get some morning sun.' },
  { re: /uric/i,
    high: 'Drink water through the day and go easy on organ meats, red meat and alcohol. See your doctor if a joint swells or hurts.' },
  { re: /\bldl\b|\bvldl\b|non[\s-]?hdl|triglycerid|cholesterol/i,
    high: 'Keep fried food and bakery items out and stay within the fat in this plan. Review this result with your doctor.' },
  { re: /\bhdl\b/i,
    low:  'Regular exercise and the nuts and seeds in this plan help over time. Review this result with your doctor.' },
  { re: /sgpt|sgot|\balt\b|\bast\b|\bggt\b|liver|bilirubin/i,
    high: 'Avoid alcohol and keep sugar and fried food low. Review your liver results with your doctor.' },
  { re: /creatinine|\burea\b|\bbun\b|egfr/i,
    any:  'Check with your doctor before following a high-protein plan.' },
  { re: /h[a]?emoglobin|ferritin|\biron\b/i,
    low:  'Ask your doctor whether you need an iron supplement; food alone can be slow to correct this.' },
];
const CONDITION_ADVICE = [
  { re: /fatty\s*liver|nafld|liver/i, text: 'Avoid alcohol and keep sugar and fried food low. Follow your doctor\'s advice alongside this plan.' },
  { re: /diabet|sugar|insulin/i,      text: 'Do not change any diabetes medicine on your own. Tell your doctor you have started this plan, as doses may need review.' },
  { re: /thyroid/i,                   text: 'Take any thyroid medicine exactly as prescribed; this plan does not replace it.' },
  { re: /hypertension|blood\s*pressure|\bbp\b/i, text: 'Keep salt, pickles and papad low, and check your BP as your doctor advised.' },
  { re: /kidney|renal/i,              text: 'Check with your doctor before following a high-protein plan.' },
  { re: /pregnan|lactat|breast\s*feed/i, text: 'Do not cut calories or fast without your doctor\'s agreement.' },
];

/**
 * One caution per flag, in fixed words. The model used to write these, and a
 * redraft dropped every one of them (glucose, TSH, B12, D, uric acid, LDL) in
 * favour of generic lines. Built here from the same stored flags the coach
 * sees, they are on every draft and every version whatever the model returns.
 */
function labCautions(flags) {
  const out = [];
  for (const f of Array.isArray(flags) ? flags : []) {
    if (!f || !f.text) continue;
    if (f.kind === 'lab') {
      const rule = LAB_ADVICE.find(r => r.re.test(f.test || '') && (r.any || r[f.status]));
      const advice = rule ? (rule.any || rule[f.status]) : 'Review this result with your doctor.';
      const when = prettyDate(f.date);
      out.push(`${f.text}${when ? ` (${when}${f.stale ? ', an old result: a fresh test would help' : ''})` : ''}. ${advice}`);
    } else if (f.kind === 'condition') {
      const rule = CONDITION_ADVICE.find(r => r.re.test(f.text));
      out.push(`${f.text}. ${rule ? rule.text : 'Follow your doctor\'s advice alongside this plan.'}`);
    }
  }
  return out.slice(0, 20);
}

/** Content as stored: whatever was normalised, plus the app's lab cautions. */
const withLabCautions = (content, flags) => ({ ...(content || {}), lab_cautions: labCautions(flags) });

// ── Checks: arithmetic, not opinion ──────────────────────────────────────────

const itemKcal  = (it) => (Number(it.grams) || 0) * (Number(it.per_100g?.calories) || 0) / 100;
const itemCarbs = (it) => (Number(it.grams) || 0) * (Number(it.per_100g?.total_carbs) || 0) / 100;

/** What a day's meals add up to, rounded the way the coach sees it. */
function dayTotals(day) {
  let kcal = 0, carbs = 0;
  (day || []).forEach(m => m.items.forEach(it => { kcal += itemKcal(it); carbs += itemCarbs(it); }));
  return { kcal: Math.round(kcal), carbs: Math.round(carbs) };
}
const kcalRange = (kcal) => ({ lo: Math.round(kcal * (1 - KCAL_MARGIN)), hi: Math.round(kcal * (1 + KCAL_MARGIN)) });
const carbCap   = (carbs) => Math.round(carbs * (1 + CARB_MARGIN));

const GREEN_WORD  = /(^|[^a-z])(sopp?u|sopp?ina|soppina)([^a-z]|$)/i;
const NAMED_GREEN = /palak|spinach|dantu|amaranth|sabb?a?sige|dill|menth[yi]a|methi|fenugreek|harive|nugge|drumstick|basale|malabar|pudina|mint|kothambari|coriander|honagone|chakota|agase|curry\s*lea/i;
/** "Soppu palya" with no green named, or with "kale" (not an Indian market green). */
function isVagueGreen(name) {
  const n = String(name || '');
  if (/(^|[^a-z])kale([^a-z]|$)/i.test(n) && GREEN_WORD.test(n)) return true;
  return GREEN_WORD.test(n) && !NAMED_GREEN.test(n);
}

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

  // Over the target is an ERROR (Phase 1.3). As a 15% warning it was ticked
  // through: a 1,500 kcal plan went out with a 2,206 kcal Monday. Under the
  // target stays a warning: a coach may want a light day.
  const totals = days.map(dayTotals);
  if (t.kcal) {
    const { lo, hi } = kcalRange(t.kcal);
    const over = [], under = [];
    days.forEach((d, w) => {
      if (!d.length) return;
      const label = `${WEEKDAY_NAMES[w].slice(0, 3)} ${totals[w].kcal}`;
      if (totals[w].kcal > hi) over.push(label);
      else if (totals[w].kcal < lo) under.push(label);
    });
    if (over.length) {
      out.push({ level: 'error', code: 'day_over',
        text: `Over the ${t.kcal} kcal target (allowed ${lo} to ${hi}): ${over.join(', ')} kcal. Use Fit to target, or reduce portions.` });
    }
    if (under.length) {
      out.push({ level: 'warn', code: 'day_under',
        text: `Under the ${t.kcal} kcal target (allowed ${lo} to ${hi}): ${under.join(', ')} kcal.` });
    }
  }
  if (t.carbs) {
    const cap = carbCap(t.carbs);
    const over = [];
    days.forEach((d, w) => { if (d.length && totals[w].carbs > cap) over.push(`${WEEKDAY_NAMES[w].slice(0, 3)} ${totals[w].carbs} g`); });
    if (over.length) {
      out.push({ level: 'error', code: 'carbs_over',
        text: `Carbs over the ${t.carbs} g target (limit ${cap} g): ${over.join(', ')}. Use Fit to target, or reduce the carb foods.` });
    }
  }

  // "Soppu" only means leafy greens. A model once wrote "Sopu Palya (kale)",
  // which no member in Karnataka buys. Ask for the actual green by name.
  const vague = new Set();
  days.forEach(d => d.forEach(m => m.items.forEach(it => { if (isVagueGreen(it.name)) vague.add(it.name); })));
  if (vague.size) {
    out.push({ level: 'warn', code: 'vague_green',
      text: `Name the actual green for: ${[...vague].slice(0, 6).join(', ')}. "Soppu" only means leafy greens (palak, dantu, sabsige, menthya, harive).` });
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

// ── Fit to target: arithmetic, not the model ─────────────────────────────────

// A portion is never scaled below 40% or above 250% of what the draft said:
// past that it is a different plan, and the coach should change the foods.
const FIT_MIN_SCALE = 0.4;
const FIT_MAX_SCALE = 2.5;
// Small amounts (ghee, nuts, seeds) move by the gram; the rest in 5 g steps.
const roundGrams = (g) => (g < 30 ? Math.max(1, Math.round(g)) : Math.round(g / 5) * 5);
// A food that gets 30% or more of its calories from carbs: rice, roti, fruit, dal, chikki.
const isCarbFood = (it) => {
  const k = Number(it.per_100g?.calories) || 0;
  return k > 0 && (4 * (Number(it.per_100g?.total_carbs) || 0)) / k >= 0.3;
};

/**
 * Scale `items` (in place, unrounded) so their calories come to `needKcal`,
 * keeping their carbs at or under `maxCarbs` when that is given.
 *
 * One factor for everything when carbs allow it, so the plan keeps its shape.
 * When they do not, two factors: carb foods come down further, and the rest
 * make up the calories. Each item stays inside its own limits; whatever a
 * limited item could not absorb is shared among the others on the next pass.
 */
function scaleItems(items, needKcal, maxCarbs) {
  let free = items.filter(it => itemKcal(it) > 0);
  const lim = (it) => ({ lo: Math.max(1, it._orig * FIT_MIN_SCALE), hi: Math.min(2000, it._orig * FIT_MAX_SCALE) });
  for (let pass = 0; pass < 40 && free.length; pass++) {
    const fixedK = items.filter(it => !free.includes(it)).reduce((a, it) => a + itemKcal(it), 0);
    const fixedC = items.filter(it => !free.includes(it)).reduce((a, it) => a + itemCarbs(it), 0);
    const need = needKcal - fixedK;
    const carbRoom = maxCarbs == null ? null : maxCarbs - fixedC;
    const K = free.reduce((a, it) => a + itemKcal(it), 0);
    const C = free.reduce((a, it) => a + itemCarbs(it), 0);
    if (!(K > 0)) break;

    let factor = () => need / K;
    if (carbRoom != null && (need / K) * C > carbRoom) {
      const carb = free.filter(isCarbFood), rest = free.filter(it => !isCarbFood(it));
      const Kc = carb.reduce((a, it) => a + itemKcal(it), 0), Cc = carb.reduce((a, it) => a + itemCarbs(it), 0);
      const Ko = K - Kc, Co = C - Cc;
      const det = Kc * Co - Ko * Cc;
      if (carb.length && rest.length && Math.abs(det) > 1e-6) {
        // sc*Kc + so*Ko = need   and   sc*Cc + so*Co = carbRoom
        const sc = Math.max(0, (need * Co - Ko * carbRoom) / det);
        const so = Math.max(0, (need - sc * Kc) / Ko);
        factor = (it) => (isCarbFood(it) ? sc : so);
      } else if (carb.length) {
        // Only carb foods left to move: the carb limit wins over the calories.
        const s = Math.max(0, carbRoom / C);
        factor = () => s;
      }
      // Only protein and fat foods left: shrinking them barely moves the
      // carbs and would starve the day. Calories win; the day is reported
      // as still over on carbs.
    }

    // Work out everyone's new grams first. If any item would pass its limit,
    // pin ONLY those to the limit and solve again for the rest: applying the
    // others now would use factors that assumed the pinned items could move.
    const want = free.map(it => ({ it, g: it.grams * factor(it), ...lim(it) }));
    const stuck = want.filter(x => x.g < x.lo - 1e-9 || x.g > x.hi + 1e-9);
    if (!stuck.length) { want.forEach(x => { x.it.grams = x.g; }); break; }
    stuck.forEach(x => { x.it.grams = x.g < x.lo ? x.lo : x.hi; });
    stuck.splice(0, stuck.length, ...stuck.map(x => x.it));
    free = free.filter(it => !stuck.includes(it));
  }
}

/**
 * Bring every day within the allowed calorie range, and under the carb limit,
 * by changing the grams of items that are not compulsory.
 *
 * Step 1 uses ONE pair of factors for the whole week, worked out on the
 * average day. A food eaten every day keeps the same grams every day.
 * Step 2 looks at each day still outside the range and adjusts that day's own
 * (rotating) dishes; only if that is not enough does it touch the everyday
 * items for that one day.
 *
 * Pure: returns new days and a report, saves nothing.
 *
 * @returns {{ ok, reason?, days, changes, totals, unfit }}
 */
function fitToTarget({ targets, days }) {
  const t = targets || {};
  if (!t.kcal) return { ok: false, reason: 'Set a daily calorie target first.', days, changes: [], totals: [], unfit: [] };
  const { lo, hi } = kcalRange(t.kcal);
  const cap = t.carbs ? carbCap(t.carbs) : null;

  const next = (days || []).map(d => d.map(m => ({ ...m, items: m.items.map(it => ({ ...it, grams: Number(it.grams), _orig: Number(it.grams) })) })));
  const before = next.map(dayTotals);
  const live = next.map((d, w) => (d.length ? w : -1)).filter(w => w >= 0);
  const all  = (w) => next[w].flatMap(m => m.items);
  const flex = (w) => all(w).filter(it => !it.compulsory);
  const sum  = (items, f) => items.reduce((a, it) => a + f(it), 0);

  // Items the same (meal, name, grams) on every day with meals: the everyday items.
  const sig = (m, it) => `${m.meal.toLowerCase()}|${it.name.toLowerCase()}|${it._orig}`;
  const everyday = new Set();
  if (live.length) {
    next[live[0]].forEach(m => m.items.forEach(it => {
      const k = sig(m, it);
      if (live.every(w => next[w].some(x => x.items.some(y => sig(x, y) === k)))) everyday.add(k);
    }));
  }
  const isEveryday = new Map();
  next.forEach(d => d.forEach(m => m.items.forEach(it => isEveryday.set(it, everyday.has(sig(m, it))))));

  // A day that no amount of scaling can fit is left exactly as it is, and
  // reported. Shrinking everything else to 40% around a compulsory item that
  // is itself over the target would only make a bad day worse.
  const unfit = [];
  const fittable = [];
  for (const w of live) {
    const fixed = all(w).filter(it => it.compulsory);
    const fixedK = Math.round(sum(fixed, itemKcal)), fixedC = Math.round(sum(fixed, itemCarbs));
    if (!flex(w).length) unfit.push({ weekday: w, reason: 'Every item is compulsory, so there is nothing to scale.' });
    else if (fixedK > hi) unfit.push({ weekday: w, reason: `The compulsory items alone are ${fixedK} kcal. Reduce one, or raise the target.` });
    else if (cap != null && fixedC > cap) unfit.push({ weekday: w, reason: `The compulsory items alone carry ${fixedC} g carbs. Reduce one, or raise the carb target.` });
    else fittable.push(w);
  }

  const inRange = (w) => {
    const tot = dayTotals(next[w]);
    return tot.kcal >= lo && tot.kcal <= hi && (cap == null || tot.carbs <= cap);
  };
  const roundDay = (w) => flex(w).forEach(it => { it.grams = roundGrams(it.grams); });

  // ── Step 1: the average day ────────────────────────────────────────────────
  if (fittable.length && !fittable.every(inRange)) {
    const n = fittable.length;
    // One stand-in item per real item, weighted by how many days it is eaten.
    const pseudo = [];
    fittable.forEach(w => flex(w).forEach(it => pseudo.push({ src: it, grams: it.grams / n, _orig: it._orig / n, per_100g: it.per_100g })));
    const fixedK = sum(fittable.flatMap(w => all(w).filter(it => it.compulsory)), itemKcal) / n;
    const fixedC = sum(fittable.flatMap(w => all(w).filter(it => it.compulsory)), itemCarbs) / n;
    // Two factors only, so identical items stay identical: scale the two
    // groups as wholes rather than item by item.
    const group = (pred) => pseudo.filter(p => pred(p));
    const carbG = group(isCarbFood), restG = group(p => !isCarbFood(p));
    const K = sum(pseudo, itemKcal), C = sum(pseudo, itemCarbs);
    if (K > 0) {
      const need = t.kcal - fixedK;
      let sc = need / K, so = need / K;
      if (t.carbs && sc * C > t.carbs - fixedC) {
        const Kc = sum(carbG, itemKcal), Cc = sum(carbG, itemCarbs), Ko = K - Kc, Co = C - Cc;
        const det = Kc * Co - Ko * Cc, room = t.carbs - fixedC;
        if (carbG.length && restG.length && Math.abs(det) > 1e-6) {
          sc = (need * Co - Ko * room) / det;
          so = Ko > 0 ? (need - sc * Kc) / Ko : so;
        } else { sc = so = room / C; }
      }
      const clamp = (x) => Math.min(FIT_MAX_SCALE, Math.max(FIT_MIN_SCALE, x));
      sc = clamp(sc);
      // Whatever the carb foods could not give up, the rest make up in calories.
      const Kc = sum(carbG, itemKcal), Ko = sum(restG, itemKcal);
      so = Ko > 0 ? clamp((need - Kc * sc) / Ko) : sc;
      pseudo.forEach(p => { p.src.grams = Math.min(2000, Math.max(1, p.src._orig * (isCarbFood(p) ? sc : so))); });
      fittable.forEach(roundDay);
    }
  }

  // ── Step 2: each day still outside the range ───────────────────────────────
  for (const w of fittable) {
    if (inRange(w)) continue;
    const own = flex(w).filter(it => !isEveryday.get(it));
    for (const set of [own, flex(w)]) {
      if (!set.length) continue;
      const others = all(w).filter(it => !set.includes(it));
      scaleItems(set, t.kcal - sum(others, itemKcal), t.carbs ? t.carbs - sum(others, itemCarbs) : null);
      set.forEach(it => { it.grams = roundGrams(it.grams); });
      // Rounding to 5 g can leave a day just outside. Close the gap to the
      // gram: calories first, on the item with the most calories that still
      // has room to move; then carbs, on the biggest carb food.
      const loOf = (it) => Math.max(1, it._orig * FIT_MIN_SCALE), hiOf = (it) => Math.min(2000, it._orig * FIT_MAX_SCALE);
      const room = (it, up) => (up ? it.grams + 1 <= hiOf(it) : it.grams - 1 >= loOf(it));
      const bound = (it, g) => Math.round(Math.min(hiOf(it), Math.max(loOf(it), g)));
      const kPerG = (it) => (Number(it.per_100g?.calories) || 0) / 100;
      // Grams of carbs per kcal: how "carby" a food is for the calories it brings.
      const density = (it) => (kPerG(it) > 0 ? ((Number(it.per_100g?.total_carbs) || 0) / 100) / kPerG(it) : 0);
      let tot = dayTotals(next[w]);
      if (tot.kcal < lo || tot.kcal > hi) {
        const up = tot.kcal < t.kcal;
        const pick = set.filter(it => itemKcal(it) > 0 && room(it, up) && !(up && isCarbFood(it) && cap != null))
          .sort((a, b) => itemKcal(b) - itemKcal(a))[0];
        if (pick) pick.grams = bound(pick, pick.grams + (t.kcal - tot.kcal) / kPerG(pick));
      }
      // Carbs still over: trade calories from the carbiest food that can
      // still shrink to the least carby food that can still grow. The day's
      // calories stay where they are; only the carbs come down.
      for (let i = 0; cap != null && i < 40; i++) {
        tot = dayTotals(next[w]);
        if (tot.carbs <= cap) break;
        const donor = set.filter(it => itemCarbs(it) > 0 && room(it, false)).sort((a, b) => density(b) - density(a))[0];
        const taker = donor && set.filter(it => it !== donor && itemKcal(it) > 0 && room(it, true) && density(it) < density(donor))
          .sort((a, b) => density(a) - density(b))[0];
        if (!donor || !taker) break;
        const move = Math.min(
          (tot.carbs - t.carbs) / (density(donor) - density(taker)),
          (donor.grams - loOf(donor)) * kPerG(donor),
          (hiOf(taker) - taker.grams) * kPerG(taker));
        const dg = Math.max(1, Math.round(move / kPerG(donor))), tg = Math.max(1, Math.round(move / kPerG(taker)));
        donor.grams = bound(donor, donor.grams - dg);
        taker.grams = bound(taker, taker.grams + tg);
      }
      if (inRange(w)) break;
    }
    if (!inRange(w)) {
      const tot = dayTotals(next[w]);
      const top = [...all(w)].sort((a, b) => itemCarbs(b) - itemCarbs(a)).slice(0, 2).map(it => it.name).join(' and ');
      unfit.push({ weekday: w, reason: cap != null && tot.carbs > cap
        ? `Carbs still come to ${tot.carbs} g (limit ${cap} g) with the carb foods at their smallest sensible portion. Most of it is ${top}: remove or swap one.`
        : `Still ${tot.kcal} kcal after the largest safe change to portions. Add, remove or swap a food instead.` });
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  const changes = [];
  next.forEach((d, w) => d.forEach(m => m.items.forEach(it => {
    if (it.grams === it._orig) return;
    const key = `${m.meal}|${it.name}|${it._orig}|${it.grams}`;
    let row = changes.find(c => c.key === key);
    if (!row) { row = { key, meal: m.meal, name: it.name, from: it._orig, to: it.grams, weekdays: [] }; changes.push(row); }
    row.weekdays.push(w);
    it.qty_text = `${it.grams} g`;
  })));
  changes.forEach(c => { delete c.key; });
  const totals = live.map(w => ({ weekday: w, before: before[w], after: dayTotals(next[w]), fits: inRange(w) }));
  next.forEach(d => d.forEach(m => m.items.forEach(it => { delete it._orig; })));
  return { ok: true, days: next, changes, totals, unfit, range: { lo, hi, carb_cap: cap } };
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
    meal.items.push({ id: r.id, name: r.name, grams: Number(r.grams), qty_text: r.qty_text, per_100g: r.per_100g || {}, compulsory: r.compulsory === true });
  }
  return days;
}

const PLAN_COLS = `id, patient_id, monitor_id, version, status, source, title, brief, targets, content,
  flags, checks, effective_from::text AS effective_from, targets_applied, approved_at, approved_by, created_at, updated_at`;

async function loadPlan(db, id) {
  const { rows: [plan] } = await db.query(`SELECT ${PLAN_COLS} FROM diet_plans WHERE id = $1`, [id]);
  if (!plan) return null;
  const { rows } = await db.query(
    `SELECT id, weekday, meal, meal_time, name, grams, qty_text, per_100g, compulsory
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
          `INSERT INTO diet_plan_items (plan_id, weekday, meal, meal_time, meal_order, position, name, grams, qty_text, per_100g, compulsory)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [planId, w, m.meal, m.time || null, mi, i, it.name, it.grams, it.qty_text || null, JSON.stringify(it.per_100g || {}), it.compulsory === true]);
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
     JSON.stringify(targets || {}), JSON.stringify(withLabCautions(content, flags)), JSON.stringify(flags || []), JSON.stringify(checks)]);
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
    // Rebuilt from the draft's own flags on every save: neither the model
    // nor an edit to the cautions list can take a lab caution off.
    content: withLabCautions(content ? normaliseContent({ ...plan.content, ...content }) : plan.content, plan.flags),
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
  WEEKDAYS, WEEKDAY_NAMES, FILL_AHEAD_DAYS, KCAL_MARGIN, CARB_MARGIN,
  weekdayOf, addDays, isDate,
  normaliseTargets, normaliseContent, normaliseItem, normaliseDraft, toMealsShape,
  buildFlags, labCautions, runChecks, hasErrors, hasWarnings, diffPlans,
  dayTotals, kcalRange, carbCap, isVagueGreen, fitToTarget,
  loadPlan, planInForce, saveDraft, updateDraft, approveDraft, ensureDay, recordImportedPlan,
};
