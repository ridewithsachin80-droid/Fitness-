/**
 * labAnalysis.js — pairs lab results and describes what the member was doing
 * between them.
 *
 * ── The one thing this file must never do ───────────────────────────────────
 *
 * It must never say a diet change CAUSED a lab change. Between two blood tests
 * a member typically alters calories, protein, supplements, training, sleep and
 * body weight simultaneously — and season, illness, medication, hydration,
 * fasting status and even the assay used by a different lab all move markers
 * independently. With n=1 and every variable moving at once, attribution is not
 * available at any level of statistical sophistication.
 *
 * So the output is deliberately framed as "here is what changed alongside" and
 * every payload carries that caveat. A coach reading a real association can act
 * on it; a coach reading a manufactured cause will change someone's treatment
 * on the strength of a coincidence.
 *
 * ── What it does do ─────────────────────────────────────────────────────────
 *
 *   · pairs consecutive results per marker, requiring a real interval
 *     (30 days minimum — most markers cannot move meaningfully faster, and
 *     HbA1c reflects roughly 90 days of glycaemia whatever you do to it)
 *   · reports direction of travel against the reference range, so "went from
 *     high to normal" is distinguished from "rose within normal"
 *   · summarises intake, supplement adherence and training across exactly that
 *     window, from the logs
 *   · flags out-of-range values for clinical attention without interpreting
 *     them
 */

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

const MIN_INTERVAL_DAYS = 30;

/**
 * Markers whose expected direction of improvement is unambiguous, used only to
 * word the summary ("improved" vs "worsened"). Anything not listed here is
 * described neutrally as up or down, because for many markers the desirable
 * direction depends on the person.
 */
const LOWER_IS_BETTER = /^(hba1c|glucose|fasting glucose|triglyceride|ldl|total cholesterol|alt|ast|ggt|alp|crp|esr|uric acid|creatinine|insulin|homa)/i;
const HIGHER_IS_BETTER = /^(hdl|vitamin d|vit d|b12|vitamin b12|ferritin|haemoglobin|hemoglobin|hb\b)/i;

function dayMacros(items = []) {
  let kcal = 0, protein = 0, carbs = 0, fat = 0, fiber = 0;
  for (const it of items) {
    const p = it?.per_100g;
    if (!p) continue;
    const f = num(it.grams) / 100;
    kcal += num(p.calories) * f;
    protein += num(p.protein) * f;
    carbs += num(p.total_carbs) * f;
    fat += num(p.fat) * f;
    fiber += num(p.fiber) * f;
  }
  return { kcal, protein, carbs, fat, fiber };
}

/** Everything the member did between two dates, from their logs. */
function windowContext(logs, from, to, sessions = []) {
  const start = new Date(from), end = new Date(to);
  const inWindow = logs.filter(l => {
    const d = new Date(l.log_date);
    return d > start && d <= end;
  });

  const foodDays = inWindow.filter(l => Array.isArray(l.food_items) && l.food_items.length);
  const macros = foodDays.map(l => dayMacros(l.food_items)).filter(m => m.kcal > 400);

  const weights = inWindow.filter(l => num(l.weight_kg) > 0).map(l => num(l.weight_kg));

  // Supplement adherence: share of logged days each item was ticked
  const suppCounts = {};
  let suppDays = 0;
  for (const l of inWindow) {
    const s = l.supplements || {};
    const keys = Object.keys(s);
    if (!keys.length) continue;
    suppDays++;
    for (const k of keys) if (s[k]) suppCounts[k] = (suppCounts[k] || 0) + 1;
  }
  const supplements = Object.entries(suppCounts)
    .map(([id, n]) => ({ id, days: n, pct: suppDays ? Math.round((n / suppDays) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct);

  const sess = sessions.filter(s => {
    const d = new Date(s.session_date);
    return d > start && d <= end;
  });
  const cardioMin = sess.reduce((t, s) => {
    const c = Array.isArray(s.cardio) ? s.cardio : [];
    return t + c.reduce((x, e) => x + num(e?.duration_min), 0);
  }, 0);

  const days = Math.max(1, Math.round((end - start) / 86400000));

  return {
    days,
    logged_days: inWindow.length,
    food_days: macros.length,
    mean_kcal: macros.length ? Math.round(mean(macros.map(m => m.kcal))) : null,
    mean_protein: macros.length ? Math.round(mean(macros.map(m => m.protein))) : null,
    mean_carbs: macros.length ? Math.round(mean(macros.map(m => m.carbs))) : null,
    mean_fat: macros.length ? Math.round(mean(macros.map(m => m.fat))) : null,
    mean_fiber: macros.length ? Math.round(mean(macros.map(m => m.fiber))) : null,
    weight_start: weights.length ? +weights[0].toFixed(1) : null,
    weight_end: weights.length ? +weights[weights.length - 1].toFixed(1) : null,
    weight_change: weights.length >= 2 ? +(weights[weights.length - 1] - weights[0]).toFixed(1) : null,
    supplements: supplements.slice(0, 8),
    training_sessions: sess.length,
    cardio_minutes: Math.round(cardioMin),
    // How much of the window is actually described by logs. A window with 12
    // logged days out of 90 cannot support any statement about diet.
    coverage_pct: Math.round((inWindow.length / days) * 100),
  };
}

function direction(name, from, to) {
  const delta = to - from;
  if (Math.abs(delta) < 1e-9) return 'unchanged';
  if (LOWER_IS_BETTER.test(name)) return delta < 0 ? 'improved' : 'worsened';
  if (HIGHER_IS_BETTER.test(name)) return delta > 0 ? 'improved' : 'worsened';
  return delta > 0 ? 'rose' : 'fell';
}

function rangeState(v, min, max) {
  if (min == null || max == null) return null;
  if (v < min) return 'low';
  if (v > max) return 'high';
  return 'normal';
}

/**
 * @param labs      lab_values rows, any order
 * @param logs      daily_logs rows
 * @param sessions  workout_sessions rows
 */
function analyseLabs(labs = [], logs = [], sessions = []) {
  const byMarker = new Map();
  for (const l of labs) {
    const key = String(l.test_name || '').trim().toLowerCase();
    if (!key) continue;
    if (!byMarker.has(key)) byMarker.set(key, []);
    byMarker.get(key).push(l);
  }

  const comparisons = [];
  const singles = [];
  const flags = [];

  for (const [, rows] of byMarker) {
    rows.sort((a, b) => new Date(a.test_date) - new Date(b.test_date));
    const latest = rows[rows.length - 1];

    const state = rangeState(num(latest.value), latest.ref_min != null ? num(latest.ref_min) : null,
                                                latest.ref_max != null ? num(latest.ref_max) : null);
    if (state === 'low' || state === 'high') {
      flags.push({
        test_name: latest.test_name, value: num(latest.value), unit: latest.unit,
        state, test_date: latest.test_date,
        ref: latest.ref_min != null ? `${latest.ref_min}–${latest.ref_max}` : null,
      });
    }

    if (rows.length < 2) { singles.push({ test_name: latest.test_name, test_date: latest.test_date }); continue; }

    // Compare the two most recent that are far enough apart to mean anything
    let prev = null;
    for (let i = rows.length - 2; i >= 0; i--) {
      const gap = Math.round((new Date(latest.test_date) - new Date(rows[i].test_date)) / 86400000);
      if (gap >= MIN_INTERVAL_DAYS) { prev = rows[i]; break; }
    }
    if (!prev) {
      singles.push({ test_name: latest.test_name, test_date: latest.test_date,
                     note: `repeat was under ${MIN_INTERVAL_DAYS} days apart — too soon to read` });
      continue;
    }

    const from = num(prev.value), to = num(latest.value);
    const gapDays = Math.round((new Date(latest.test_date) - new Date(prev.test_date)) / 86400000);

    comparisons.push({
      test_name: latest.test_name,
      unit: latest.unit,
      from, to,
      change: +(to - from).toFixed(2),
      change_pct: from !== 0 ? Math.round(((to - from) / Math.abs(from)) * 100) : null,
      direction: direction(latest.test_name, from, to),
      from_state: rangeState(from, prev.ref_min != null ? num(prev.ref_min) : null,
                                   prev.ref_max != null ? num(prev.ref_max) : null),
      to_state: state,
      ref: latest.ref_min != null ? `${latest.ref_min}–${latest.ref_max}` : null,
      from_date: prev.test_date,
      to_date: latest.test_date,
      interval_days: gapDays,
      entered_role: latest.entered_role || null,
      context: windowContext(logs, prev.test_date, latest.test_date, sessions),
    });
  }

  comparisons.sort((a, b) => new Date(b.to_date) - new Date(a.to_date));

  return {
    comparisons,
    single_results: singles,
    out_of_range: flags,
    // Carried on every payload so no consumer can present this as causation.
    caveat: 'Shows what changed alongside each result, not what caused it. Between two tests diet, supplements, training, weight, sleep, medication and the testing lab itself may all differ — with one person and one interval, cause cannot be separated from coincidence.',
  };
}

module.exports = { analyseLabs, windowContext, MIN_INTERVAL_DAYS };
