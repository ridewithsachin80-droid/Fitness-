/**
 * macroLab.js — adherence patterns and macro trial comparison. Coach-facing.
 *
 * Two separate tools that answer different questions:
 *
 *   adherence()  — which macro split does this member actually sustain?
 *                  Behavioural, measurable from logs already collected, no
 *                  trial needed. Often the more actionable of the two: a split
 *                  someone sticks to beats a theoretically better one they
 *                  abandon after ten days.
 *
 *   compareArms() — did the split make a measurable difference to fat loss?
 *                  Requires a controlled trial, and will frequently answer
 *                  "cannot tell". That is the correct answer more often than
 *                  the industry admits, and reporting it honestly is the
 *                  point of this file.
 *
 * ── Why the comparison is built the way it is ───────────────────────────────
 *
 * GLYCOGEN WASHOUT. Cutting carbohydrate sheds 1–2 kg of glycogen and its
 * bound water within a week. On a weight chart that is indistinguishable from
 * rapid fat loss, and a naive comparison would credit it to the diet. Each
 * arm therefore discards its first `washout_days` before any maths runs.
 *
 * NOISE FLOOR. A difference between arms means nothing until it is compared
 * with how much this member's weight moves anyway. We compute the standard
 * deviation of their week-to-week changes and refuse to call a winner unless
 * the gap clears it. With ±1 kg weekly variation, only differences above
 * roughly 0.3 kg/week are detectable at all — so most trials will land on
 * "no detectable difference", which is a real and useful result.
 *
 * CONTROL CHECK. The comparison is only meaningful if calories and protein
 * really were held constant. We verify that from the logged intake, not from
 * the prescribed targets, and downgrade the verdict when they drifted.
 */

const KCAL_PER_KG = 7700;
const MIN_ARM_DAYS = 12;           // usable days after washout

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

function dayMacros(foodItems = []) {
  let kcal = 0, protein = 0, carbs = 0, fat = 0;
  for (const it of foodItems) {
    const p = it?.per_100g;
    if (!p) continue;
    const f = num(it.grams) / 100;
    kcal += num(p.calories) * f;
    protein += num(p.protein) * f;
    carbs += num(p.total_carbs) * f;
    fat += num(p.fat) * f;
  }
  return { kcal, protein, carbs, fat };
}

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

function smooth(series, window = 7) {
  const half = Math.floor(window / 2);
  return series.map((_, i) => {
    const lo = Math.max(0, i - half), hi = Math.min(series.length - 1, i + half);
    let s = 0, n = 0;
    for (let j = lo; j <= hi; j++) { s += series[j]; n++; }
    return s / n;
  });
}

function regress(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, r2: 0 };
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (!sxx) return { slope: 0, r2: 0 };
  return { slope: sxy / sxx, r2: syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

/** Week-to-week weight variation — this member's personal noise floor. */
function weeklyNoise(logs) {
  const w = logs.filter(l => num(l.weight_kg) > 0)
                .map(l => ({ t: new Date(l.log_date).getTime() / 86400000, kg: num(l.weight_kg) }));
  if (w.length < 14) return null;
  const sm = smooth(w.map(x => x.kg), 7);
  const weekly = [];
  for (let i = 7; i < sm.length; i++) weekly.push(sm[i] - sm[i - 7]);
  return weekly.length >= 3 ? +sd(weekly).toFixed(2) : null;
}

// ── Adherence ────────────────────────────────────────────────────────────────
/**
 * Groups the member's own logged days by how carb-heavy they were, then asks a
 * behavioural question: on which kind of day do they log at all, and hit their
 * calorie target?
 *
 * Grouping uses ACTUAL logged intake rather than prescribed targets, so this
 * works on existing history with no trial and no target change.
 */
function adherence(logs = [], { kcalTarget = null } = {}) {
  const days = logs
    .filter(l => Array.isArray(l.food_items) && l.food_items.length)
    .map(l => {
      const m = dayMacros(l.food_items);
      const carbPct = m.kcal > 0 ? (m.carbs * 4) / m.kcal : 0;
      return { date: l.log_date, ...m, carbPct };
    })
    .filter(d => d.kcal > 400);            // ignore part-logged days

  if (days.length < 14) {
    return { enough: false, logged_days: days.length,
             reason: `${days.length} of 14 fully logged days` };
  }

  // Split by RANK, not by value. Splitting on the median value collapses when
  // intake falls into two tight clusters — every day lands on one side of it
  // and the comparison silently disappears. Ranking guarantees two halves.
  const sorted = [...days].sort((a, b) => a.carbPct - b.carbPct);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted.slice(0, mid);
  const higher = sorted.slice(sorted.length % 2 ? mid + 1 : mid);

  // Balanced halves are not enough: they must actually differ. A member who
  // eats the same ratio daily has nothing to compare, and saying so is more
  // honest than splitting noise down the middle.
  const spread = mean(higher.map(d => d.carbPct)) - mean(lower.map(d => d.carbPct));
  if (lower.length < 5 || higher.length < 5 || spread < 0.08) {
    return { enough: false, logged_days: days.length,
             reason: `their carb share barely varies (${Math.round(spread * 100)} points between halves) — nothing to compare` };
  }

  const spanDays = (arr) => {
    const ts = arr.map(d => new Date(d.date).getTime() / 86400000);
    return Math.max(1, Math.round(Math.max(...ts) - Math.min(...ts)) + 1);
  };

  const build = (arr, label) => {
    const target = kcalTarget || null;
    const withinTarget = target
      ? arr.filter(d => Math.abs(d.kcal - target) <= target * 0.1).length
      : null;
    return {
      label,
      days: arr.length,
      logging_rate: +(arr.length / spanDays(arr)).toFixed(2),  // days logged per calendar day
      mean_kcal: Math.round(mean(arr.map(d => d.kcal))),
      mean_carb_pct: Math.round(mean(arr.map(d => d.carbPct)) * 100),
      mean_protein: Math.round(mean(arr.map(d => d.protein))),
      on_target_pct: withinTarget != null ? Math.round((withinTarget / arr.length) * 100) : null,
      kcal_variability: Math.round(sd(arr.map(d => d.kcal))),
    };
  };

  const lo = build(lower, 'Lower carb');
  const hi = build(higher, 'Higher carb');

  // A verdict only when the gap is worth acting on. 15 percentage points on
  // target-hitting, or 25% more logged days, is a pattern; anything smaller is
  // day-to-day variation wearing a costume.
  let verdict = null;
  if (lo.on_target_pct != null && Math.abs(hi.on_target_pct - lo.on_target_pct) >= 15) {
    const better = hi.on_target_pct > lo.on_target_pct ? hi : lo;
    const worse  = better === hi ? lo : hi;
    verdict = `Hits the calorie target on ${better.on_target_pct}% of ${better.label.toLowerCase()} days versus ${worse.on_target_pct}% on ${worse.label.toLowerCase()} days.`;
  } else if (Math.abs(hi.logging_rate - lo.logging_rate) >= 0.25) {
    const better = hi.logging_rate > lo.logging_rate ? hi : lo;
    verdict = `Logs noticeably more consistently on ${better.label.toLowerCase()} days.`;
  }

  return {
    enough: true,
    logged_days: days.length,
    groups: [lo, hi],
    verdict,
    note: verdict
      ? 'Behavioural, not metabolic — this is about what they sustain, not what burns more fat.'
      : 'No meaningful difference in how well they sustain either split.',
  };
}

// ── Trial comparison ─────────────────────────────────────────────────────────
function armWindow(logs, from, to, washoutDays) {
  const start = new Date(from); start.setDate(start.getDate() + washoutDays);
  const rows = logs.filter(l => {
    const d = new Date(l.log_date);
    return d >= start && (!to || d <= new Date(to));
  });
  return rows;
}

function armStats(rows) {
  const w = rows.filter(l => num(l.weight_kg) > 0);
  const f = rows.filter(l => Array.isArray(l.food_items) && l.food_items.length);
  if (w.length < 2) return null;

  const xs = w.map(l => new Date(l.log_date).getTime() / 86400000);
  const base = Math.min(...xs);
  const sm = smooth(w.map(l => num(l.weight_kg)), 7);
  const { slope, r2 } = regress(xs.map(x => x - base), sm);

  const macros = f.map(l => dayMacros(l.food_items));
  return {
    weight_days: w.length,
    food_days: f.length,
    weekly_change_kg: +(slope * 7).toFixed(3),
    trend_r2: +r2.toFixed(2),
    mean_kcal: Math.round(mean(macros.map(m => m.kcal))),
    mean_protein: Math.round(mean(macros.map(m => m.protein))),
    mean_carbs: Math.round(mean(macros.map(m => m.carbs))),
    mean_fat: Math.round(mean(macros.map(m => m.fat))),
  };
}

/**
 * @returns verdict object — always includes why, never a bare winner.
 */
function compareArms(logs, trial) {
  const washout = trial.washout_days ?? 10;
  const aRows = armWindow(logs, trial.a_started_on, trial.b_started_on, washout);
  const bRows = trial.b_started_on
    ? armWindow(logs, trial.b_started_on, trial.completed_on, washout) : [];

  const a = armStats(aRows);
  const b = armStats(bRows);
  const noise = weeklyNoise(logs);

  if (!a || !b || a.weight_days < MIN_ARM_DAYS || b.weight_days < MIN_ARM_DAYS) {
    return {
      status: 'incomplete',
      arm_a: a, arm_b: b, noise_floor_kg: noise,
      headline: 'Not enough usable data yet',
      detail: `Each arm needs at least ${MIN_ARM_DAYS} days of weight after the ${washout}-day washout. ` +
              `Currently ${a?.weight_days ?? 0} and ${b?.weight_days ?? 0}.`,
    };
  }

  // Was the trial actually controlled? If calories or protein drifted between
  // arms, any weight difference cannot be attributed to the carb/fat split.
  const kcalDrift = Math.abs(a.mean_kcal - b.mean_kcal);
  const proDrift  = Math.abs(a.mean_protein - b.mean_protein);
  const controlled = kcalDrift <= Math.max(100, a.mean_kcal * 0.06) && proDrift <= 20;

  const diff = +(a.weekly_change_kg - b.weekly_change_kg).toFixed(3);
  const detectable = noise != null ? Math.abs(diff) > noise : Math.abs(diff) > 0.3;

  if (!controlled) {
    return {
      status: 'confounded',
      arm_a: a, arm_b: b, difference_kg_per_week: diff, noise_floor_kg: noise,
      headline: 'Cannot attribute the difference to the macro split',
      detail: `Intake was not held constant between arms — calories differed by ${kcalDrift} kcal ` +
              `and protein by ${proDrift}g on average. Any weight difference could be from that alone.`,
    };
  }

  if (!detectable) {
    return {
      status: 'no_difference',
      arm_a: a, arm_b: b, difference_kg_per_week: diff, noise_floor_kg: noise,
      headline: 'No detectable difference',
      detail: `Arm A ${a.weekly_change_kg} kg/week, Arm B ${b.weekly_change_kg} kg/week. ` +
              `The ${Math.abs(diff).toFixed(2)} kg gap sits inside this member's own week-to-week ` +
              `variation of ±${noise ?? '0.30'} kg, so it cannot be separated from noise.`,
      recommendation: 'Let them choose. Pick the split they sustain better.',
    };
  }

  const winner = diff < 0 ? 'A' : 'B';
  const w = winner === 'A' ? a : b;
  const l = winner === 'A' ? b : a;
  return {
    status: 'difference',
    arm_a: a, arm_b: b, difference_kg_per_week: diff, noise_floor_kg: noise,
    winner,
    headline: `Arm ${winner} performed better`,
    detail: `Arm ${winner} lost ${Math.abs(w.weekly_change_kg)} kg/week against ` +
            `${Math.abs(l.weekly_change_kg)} for the other, a gap of ${Math.abs(diff).toFixed(2)} kg/week — ` +
            `larger than their ±${noise ?? '0.30'} kg weekly variation. Calories and protein were held constant.`,
    caveat: 'One member, one trial. Worth repeating before treating it as settled.',
  };
}

module.exports = { adherence, compareArms, armStats, weeklyNoise, dayMacros, MIN_ARM_DAYS };
