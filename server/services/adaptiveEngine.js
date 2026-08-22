/**
 * adaptiveEngine.js — learns a member's actual metabolism from their own data.
 *
 * ── What this does, and what it deliberately does not ───────────────────────
 *
 * DOES: derive a member's real maintenance calories from the relationship
 * between what they ate and how their weight actually moved. Mifflin-St Jeor
 * is a population average; individuals sit ±15% either side of it, which is
 * 300 kcal on a 2,000 kcal day. Every logged day narrows that error. This is
 * the same principle behind adaptive-TDEE tools, and it is statistically
 * sound given enough days.
 *
 * DOES: report micronutrient gaps over a window, which is plain arithmetic on
 * logged food, and suggest targets from body weight and goal.
 *
 * DOES NOT: claim to know which macro split "suits" a member. That is where
 * this class of feature is usually oversold. Observational self-logged data
 * cannot separate a macro effect from adherence, sodium, glycogen, sleep,
 * menstrual cycle or logging accuracy — the confounds are larger than the
 * effect. What it does instead is report observed patterns with their sample
 * size and let the coach judge.
 *
 * DOES NOT: change anyone's protocol. It proposes; the coach approves. That
 * is both the safer design and the right one for a coached product.
 *
 * ── The core inference ──────────────────────────────────────────────────────
 *
 *   observed maintenance = mean daily intake − (weight slope × 7700)
 *
 * A member eating 1,800 kcal and losing 0.3 kg/week is running a deficit of
 * 0.3 × 7700 / 7 = 330 kcal/day, so their true maintenance is ~2,130.
 *
 * The hard part is the slope. Daily weight swings ±1 kg on water alone, which
 * dwarfs a week's real fat change, so the raw series is useless. We smooth
 * with a 7-day moving average and fit least squares to the smoothed series,
 * then report R² so the caller knows whether the trend is real or noise.
 */

const KCAL_PER_KG = 7700;          // energy in a kilogram of body mass
const MIN_DAYS_WEIGHT = 14;        // below this, weight noise swamps the trend
const MIN_DAYS_FOOD = 10;

// Per-day RDA reference for the gap report. Adult values; the coach can
// override per member via rda_overrides, which the client already supports.
const RDA = {
  protein: null,                    // handled from body weight, not a flat RDA
  fiber: 30, calcium: 1000, iron: 18, magnesium: 400, potassium: 3500,
  zinc: 11, vit_a: 900, vit_b12: 2.4, vit_c: 75, vit_d: 800, vit_e: 15,
  folate: 400, omega3_ala: 1600,
};

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

/** Nutrition for one day's food_items, using the per_100g carried on each. */
function dayNutrition(foodItems = []) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const micros = {};
  for (const it of foodItems) {
    const p = it?.per_100g;
    if (!p) continue;
    const f = (num(it.grams) || 0) / 100;
    t.kcal    += num(p.calories) * f;
    t.protein += num(p.protein) * f;
    t.carbs   += num(p.total_carbs) * f;
    t.fat     += num(p.fat) * f;
    for (const k of Object.keys(RDA)) {
      if (k === 'protein') continue;
      micros[k] = (micros[k] || 0) + num(p[k]) * f;
    }
  }
  return { ...t, micros };
}

/** Centred moving average; window must be odd. Ends use what's available. */
function smooth(series, window = 7) {
  const half = Math.floor(window / 2);
  return series.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(series.length - 1, i + half);
    let sum = 0, n = 0;
    for (let j = lo; j <= hi; j++) { sum += series[j]; n++; }
    return sum / n;
  });
}

/** Least-squares slope per x-unit, with R² so noise can be told from trend. */
function regress(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, r2: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return { slope: 0, r2: 0 };
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, r2 };
}

/**
 * @param logs  daily_logs rows ascending by date, each { log_date, weight_kg, food_items }
 * @param opts  { bmr, heightCm, gender, age, goalWeight, workoutKcalByDate }
 */
function analyse(logs = [], opts = {}) {
  const rows = [...logs].sort((a, b) => new Date(a.log_date) - new Date(b.log_date));

  const dayIndex = d => Math.round(new Date(d).getTime() / 86400000);
  const base = rows.length ? dayIndex(rows[0].log_date) : 0;

  // ── weight trend ─────────────────────────────────────────────────────────
  const wRows = rows.filter(r => num(r.weight_kg) > 0);
  const weightDays = wRows.length;
  let slopePerDay = 0, r2 = 0, latestWeight = null, smoothedLatest = null;

  if (weightDays >= 2) {
    const xs = wRows.map(r => dayIndex(r.log_date) - base);
    const raw = wRows.map(r => num(r.weight_kg));
    const sm = smooth(raw, 7);
    ({ slope: slopePerDay, r2 } = regress(xs, sm));
    latestWeight = raw[raw.length - 1];
    smoothedLatest = +sm[sm.length - 1].toFixed(2);
  }

  // ── intake ───────────────────────────────────────────────────────────────
  const fRows = rows.filter(r => Array.isArray(r.food_items) && r.food_items.length);
  const perDay = fRows.map(r => ({ date: r.log_date, ...dayNutrition(r.food_items) }));
  const foodDays = perDay.length;
  const meanKcal = foodDays ? perDay.reduce((s, d) => s + d.kcal, 0) / foodDays : 0;
  const meanPro  = foodDays ? perDay.reduce((s, d) => s + d.protein, 0) / foodDays : 0;
  const meanCarb = foodDays ? perDay.reduce((s, d) => s + d.carbs, 0) / foodDays : 0;
  const meanFat  = foodDays ? perDay.reduce((s, d) => s + d.fat, 0) / foodDays : 0;

  // ── observed maintenance ─────────────────────────────────────────────────
  // Only meaningful when both series are long enough AND food logging covers
  // most of the weight window — a member who logs weight daily but food twice
  // a week gives a mean intake that is not their real intake.
  const spanDays = weightDays >= 2
    ? (dayIndex(wRows[wRows.length - 1].log_date) - dayIndex(wRows[0].log_date)) + 1
    : 0;
  const foodCoverage = spanDays ? foodDays / spanDays : 0;

  const enoughData = weightDays >= MIN_DAYS_WEIGHT
                  && foodDays >= MIN_DAYS_FOOD
                  && foodCoverage >= 0.6;

  let observedTDEE = null, confidence = 'insufficient', reason = null;

  if (!enoughData) {
    reason = weightDays < MIN_DAYS_WEIGHT
      ? `${weightDays} of ${MIN_DAYS_WEIGHT} days of weight logged`
      : foodDays < MIN_DAYS_FOOD
        ? `${foodDays} of ${MIN_DAYS_FOOD} days of food logged`
        : `food logged on only ${Math.round(foodCoverage * 100)}% of days`;
  } else {
    observedTDEE = Math.round(meanKcal - slopePerDay * KCAL_PER_KG);

    // Confidence is driven by how much data there is and how cleanly the
    // weight trend fits. A flat-but-noisy series is not a confident maintenance
    // reading, and saying so is more useful than a false number.
    if (weightDays >= 28 && foodCoverage >= 0.8 && r2 >= 0.5)      confidence = 'high';
    else if (weightDays >= 21 && foodCoverage >= 0.7 && r2 >= 0.3) confidence = 'moderate';
    else                                                           confidence = 'low';

    // Guard against absurd outputs from sparse or mis-logged data
    if (observedTDEE < 800 || observedTDEE > 6000) {
      observedTDEE = null;
      confidence = 'insufficient';
      reason = 'the numbers imply an implausible metabolism — likely under-logged food';
    }
  }

  // ── predicted, for comparison ────────────────────────────────────────────
  const predictedTDEE = opts.bmr ? Math.round(opts.bmr * 1.2) : null;
  const deltaPct = (observedTDEE && predictedTDEE)
    ? Math.round(((observedTDEE - predictedTDEE) / predictedTDEE) * 100) : null;

  // ── micronutrient gaps ───────────────────────────────────────────────────
  const microAvg = {};
  for (const k of Object.keys(RDA)) {
    if (k === 'protein') continue;
    microAvg[k] = foodDays
      ? perDay.reduce((s, d) => s + (d.micros[k] || 0), 0) / foodDays : 0;
  }
  const gaps = Object.entries(RDA)
    .filter(([k, rda]) => k !== 'protein' && rda)
    .map(([k, rda]) => ({ nutrient: k, avg: +microAvg[k].toFixed(1), rda, pct: Math.round((microAvg[k] / rda) * 100) }))
    .filter(g => g.pct < 70)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 6);

  // ── targets ──────────────────────────────────────────────────────────────
  const bw = smoothedLatest || latestWeight || null;
  let targets = null;

  if (observedTDEE && bw) {
    const goal = num(opts.goalWeight) || null;
    const losing = goal ? bw > goal : true;
    // 0.5% of body weight per week is the standard sustainable rate; faster
    // costs lean mass, slower loses adherence.
    const weeklyRate = losing ? -Math.min(0.0075 * bw, 0.9) : Math.min(0.0035 * bw, 0.4);
    const dailyAdjust = Math.round((weeklyRate * KCAL_PER_KG) / 7);
    const kcal = Math.max(1200, Math.round((observedTDEE + dailyAdjust) / 10) * 10);

    // Protein high in a deficit to protect lean mass; fat floored for hormonal
    // function; carbohydrate takes the remainder as training fuel.
    const proteinG = Math.round(Math.min(2.2, losing ? 2.0 : 1.6) * bw);
    const fatG     = Math.round(0.9 * bw);
    const carbG    = Math.max(50, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));

    targets = {
      kcal, protein_g: proteinG, fat_g: fatG, carbs_g: carbG,
      weekly_change_kg: +weeklyRate.toFixed(2),
      basis: `observed maintenance ${observedTDEE} kcal`,
    };
  }

  return {
    window_days: spanDays,
    weight_days: weightDays,
    food_days: foodDays,
    food_coverage_pct: Math.round(foodCoverage * 100),
    latest_weight: latestWeight,
    smoothed_weight: smoothedLatest,
    weekly_change_kg: weightDays >= 2 ? +(slopePerDay * 7).toFixed(2) : null,
    trend_fit_r2: +r2.toFixed(2),
    mean_intake: Math.round(meanKcal),
    mean_macros: { protein: Math.round(meanPro), carbs: Math.round(meanCarb), fat: Math.round(meanFat) },
    predicted_tdee: predictedTDEE,
    observed_tdee: observedTDEE,
    tdee_delta_pct: deltaPct,
    confidence,
    reason,
    micro_gaps: gaps,
    targets,
  };
}

module.exports = { analyse, dayNutrition, smooth, regress, KCAL_PER_KG, RDA };
