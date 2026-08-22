/**
 * learningModel.js — continuous multivariate learning from a member's history.
 *
 * The trial framework answers one deliberately-designed question. This does
 * something different: it reads ALL the natural variation a member has already
 * produced — weeks where calories were high and protein low, weeks the other
 * way, weeks with heavy training — and estimates the partial effect of each
 * variable while holding the others still.
 *
 * That is what multiple regression is for, and it is the honest way to use
 * observational data: not "calories were low and they lost weight, therefore
 * low calories work", but "holding protein and training constant, each 100
 * kcal changed weekly weight change by X, ± this much".
 *
 * ── Why weekly, not daily ───────────────────────────────────────────────────
 * Daily weight is dominated by water. Aggregating to weekly means removes most
 * of it and gives one clean observation per week, which is also the timescale
 * on which intake actually acts. The cost is sample size: ten weeks gives ten
 * rows, so the model stays deliberately small — three predictors at most, or
 * it would fit noise perfectly and tell us nothing.
 *
 * ── What it will and will not claim ─────────────────────────────────────────
 * Every coefficient is reported with a standard error and a t-statistic, and
 * anything with |t| < 2 is labelled "not distinguishable from zero". In
 * practice the calorie coefficient becomes significant fairly quickly and the
 * protein one usually does not — which is the truthful outcome, not a failure.
 * Saying so is the entire point.
 */

const KCAL_PER_KG = 7700;
const MIN_WEEKS = 8;

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function dayMacros(items = []) {
  let kcal = 0, protein = 0, carbs = 0, fat = 0;
  for (const it of items) {
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

// ── small matrix helpers (k is 2–4, so clarity beats cleverness) ────────────
function transpose(M) { return M[0].map((_, j) => M.map(r => r[j])); }
function matmul(A, B) {
  const Bt = transpose(B);
  return A.map(r => Bt.map(c => r.reduce((s, v, i) => s + v * c[i], 0)));
}
function matvec(A, v) { return A.map(r => r.reduce((s, x, i) => s + x * v[i], 0)); }

/** Gauss-Jordan inverse. Returns null when the matrix is singular — which
 *  happens when two predictors are collinear, and must be reported rather
 *  than papered over. */
function inverse(M) {
  const n = M.length;
  const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-10) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let j = 0; j < 2 * n; j++) A[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j];
    }
  }
  return A.map(r => r.slice(n));
}

/**
 * Ordinary least squares with standard errors.
 * @param X rows of predictors (WITHOUT the intercept column)
 * @param y outcome
 */
function ols(X, y, names) {
  const n = X.length;
  const k = X[0].length + 1;                 // + intercept
  if (n <= k + 1) return { ok: false, reason: `only ${n} observations for ${k} parameters` };

  const Xi = X.map(r => [1, ...r]);
  const XtX = matmul(transpose(Xi), Xi);
  const inv = inverse(XtX);
  if (!inv) return { ok: false, reason: 'predictors are collinear — cannot separate their effects' };

  const beta = matvec(inv, matvec(transpose(Xi), y));
  const fitted = Xi.map(r => r.reduce((s, v, i) => s + v * beta[i], 0));
  const resid = y.map((v, i) => v - fitted[i]);
  const rss = resid.reduce((s, r) => s + r * r, 0);
  const my = mean(y);
  const tss = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const df = n - k;
  const sigma2 = rss / df;

  const coefs = beta.map((b, i) => {
    const se = Math.sqrt(Math.max(0, sigma2 * inv[i][i]));
    const t = se > 0 ? b / se : 0;
    return {
      name: i === 0 ? 'intercept' : names[i - 1],
      estimate: b,
      se,
      t: +t.toFixed(2),
      // |t| > 2 is roughly p < 0.05 at these sample sizes. Stated as a rule of
      // thumb rather than a precise p-value, because with 10 observations a
      // precise p-value would imply more rigour than the data supports.
      significant: Math.abs(t) > 2,
    };
  });

  return {
    ok: true, n, df,
    r2: tss > 0 ? +(1 - rss / tss).toFixed(3) : 0,
    adj_r2: tss > 0 ? +(1 - (rss / df) / (tss / (n - 1))).toFixed(3) : 0,
    coefficients: coefs,
    residual_sd: +Math.sqrt(sigma2).toFixed(3),
  };
}

// ── weekly panel ─────────────────────────────────────────────────────────────
/**
 * One row per ISO week: mean daily intake, mean protein per kg, training
 * calories, and the weight change across that week measured from smoothed
 * endpoints.
 */
function weeklyPanel(logs, workoutKcalByDate = {}) {
  const byWeek = new Map();
  const weekKey = d => {
    const dt = new Date(d);
    const day = (dt.getUTCDay() + 6) % 7;             // Monday = 0
    dt.setUTCDate(dt.getUTCDate() - day);
    return dt.toISOString().slice(0, 10);
  };

  for (const l of logs) {
    const k = weekKey(l.log_date);
    if (!byWeek.has(k)) byWeek.set(k, { week: k, weights: [], days: [], training: 0 });
    const w = byWeek.get(k);
    if (num(l.weight_kg) > 0) w.weights.push({ date: l.log_date, kg: num(l.weight_kg) });
    if (Array.isArray(l.food_items) && l.food_items.length) {
      const m = dayMacros(l.food_items);
      if (m.kcal > 400) w.days.push(m);
    }
    w.training += num(workoutKcalByDate[String(l.log_date).slice(0, 10)]);
  }

  const weeks = [...byWeek.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map(w => ({
      week: w.week,
      weight_mean: w.weights.length ? mean(w.weights.map(x => x.kg)) : null,
      weight_days: w.weights.length,
      food_days: w.days.length,
      mean_kcal: w.days.length ? mean(w.days.map(d => d.kcal)) : null,
      mean_protein: w.days.length ? mean(w.days.map(d => d.protein)) : null,
      mean_carbs: w.days.length ? mean(w.days.map(d => d.carbs)) : null,
      mean_fat: w.days.length ? mean(w.days.map(d => d.fat)) : null,
      training_kcal: Math.round(w.training / 7),
    }));

  // Week-over-week change, using weekly means as the smoother
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i].weight_mean != null && weeks[i - 1].weight_mean != null) {
      weeks[i].weight_change = +(weeks[i].weight_mean - weeks[i - 1].weight_mean).toFixed(3);
    }
  }
  return weeks;
}

/**
 * Fit the model and translate it into things a coach can act on.
 *
 * Model:  weekly weight change ~ intake + protein per kg + training
 * All predictors are centred so the intercept is interpretable, and reported
 * per meaningful unit (100 kcal, 0.5 g/kg) rather than per raw unit.
 */
function learn(logs, { bodyWeightKg = null, workoutKcalByDate = {} } = {}) {
  const weeks = weeklyPanel(logs, workoutKcalByDate);

  // Usable weeks need intake, a weight change, and enough logged days that the
  // mean is not one meal standing in for seven.
  const usable = weeks.filter(w =>
    w.weight_change != null && w.mean_kcal != null && w.food_days >= 4 && w.weight_days >= 3);

  if (usable.length < MIN_WEEKS) {
    return {
      ok: false,
      weeks_total: weeks.length,
      weeks_usable: usable.length,
      reason: `${usable.length} of ${MIN_WEEKS} usable weeks — a week counts when it has 4+ days of food and 3+ weigh-ins`,
    };
  }

  const bw = bodyWeightKg || mean(usable.map(w => w.weight_mean).filter(Boolean)) || 75;

  const kcal = usable.map(w => w.mean_kcal);
  const proPerKg = usable.map(w => w.mean_protein / bw);
  const train = usable.map(w => w.training_kcal);
  const y = usable.map(w => w.weight_change);

  // Centre the predictors so the intercept means "at this member's own average"
  const mk = mean(kcal), mp = mean(proPerKg), mt = mean(train);

  // Only include a predictor that actually varies. A member whose protein never
  // moves gives a column of zeros after centring, which makes the matrix
  // singular — and no amount of statistics can extract an effect that was
  // never varied.
  const sdOf = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
  const useProtein = sdOf(proPerKg) > 0.08;      // ~0.1 g/kg of spread
  const useTraining = sdOf(train) > 25;

  const names = ['kcal'];
  const cols = [kcal.map(v => v - mk)];
  if (useProtein) { names.push('protein_per_kg'); cols.push(proPerKg.map(v => v - mp)); }
  if (useTraining) { names.push('training_kcal'); cols.push(train.map(v => v - mt)); }

  const X = usable.map((_, i) => cols.map(c => c[i]));
  const fit = ols(X, y, names);
  if (!fit.ok) return { ok: false, weeks_usable: usable.length, reason: fit.reason };

  const by = n => fit.coefficients.find(c => c.name === n);
  const kc = by('kcal');
  const pc = by('protein_per_kg');
  const tc = by('training_kcal');
  const intercept = fit.coefficients[0];

  // Maintenance is the intake at which predicted weekly change is zero.
  // From  change = b0 + b1·(kcal − mk)  =>  kcal at change 0 = mk − b0/b1
  let maintenance = null;
  if (kc.estimate !== 0) {
    const m = mk - intercept.estimate / kc.estimate;
    if (m > 800 && m < 6000) maintenance = Math.round(m);
  }

  // Implied energy density of the member's weight change. Textbook is 7700
  // kcal/kg; a wildly different figure usually means systematic under-logging
  // rather than unusual physiology, and is worth flagging as such.
  const impliedKcalPerKg = kc.estimate !== 0 ? Math.round(7 / kc.estimate) : null;

  const findings = [];

  findings.push(kc.significant
    ? { variable: 'Calories', direction: kc.estimate < 0 ? 'lower intake → weight falls' : 'higher intake → weight rises',
        per_unit: `${Math.abs(kc.estimate * 100).toFixed(3)} kg/week per 100 kcal`,
        confidence: 'established', t: kc.t }
    : { variable: 'Calories', direction: 'no clear effect yet',
        per_unit: `${Math.abs(kc.estimate * 100).toFixed(3)} kg/week per 100 kcal, ± too much to trust`,
        confidence: 'unproven', t: kc.t });

  if (pc) {
    findings.push(pc.significant
      ? { variable: 'Protein', direction: pc.estimate < 0 ? 'more protein → faster loss at the same calories' : 'more protein → slower loss at the same calories',
          per_unit: `${Math.abs(pc.estimate * 0.5).toFixed(3)} kg/week per 0.5 g/kg`,
          confidence: 'established', t: pc.t }
      : { variable: 'Protein', direction: 'not distinguishable from zero',
          per_unit: 'effect too small relative to the noise in this data',
          confidence: 'unproven', t: pc.t });
  } else {
    findings.push({ variable: 'Protein', direction: 'never varied enough to measure',
                    per_unit: 'hold calories steady and vary protein to test this',
                    confidence: 'untested', t: null });
  }

  if (tc) {
    findings.push(tc.significant
      ? { variable: 'Training', direction: tc.estimate < 0 ? 'more training → faster loss' : 'more training → slower loss',
          per_unit: `${Math.abs(tc.estimate * 100).toFixed(3)} kg/week per 100 kcal burned`,
          confidence: 'established', t: tc.t }
      : { variable: 'Training', direction: 'not distinguishable from zero',
          per_unit: 'effect too small relative to the noise in this data',
          confidence: 'unproven', t: tc.t });
  }

  return {
    ok: true,
    weeks_usable: usable.length,
    weeks_total: weeks.length,
    body_weight_kg: +bw.toFixed(1),
    model: {
      r2: fit.r2, adj_r2: fit.adj_r2, residual_sd: fit.residual_sd,
      predictors: names,
      coefficients: fit.coefficients.map(c => ({
        ...c, estimate: +c.estimate.toFixed(6), se: +c.se.toFixed(6),
      })),
    },
    ranges: {
      kcal: [Math.round(Math.min(...kcal)), Math.round(Math.max(...kcal))],
      protein_g: [Math.round(Math.min(...usable.map(w => w.mean_protein))),
                  Math.round(Math.max(...usable.map(w => w.mean_protein)))],
    },
    maintenance_kcal: maintenance,
    implied_kcal_per_kg: impliedKcalPerKg,
    findings,
    weekly_panel: usable.map(w => ({
      week: w.week, kcal: Math.round(w.mean_kcal),
      protein: Math.round(w.mean_protein), change: w.weight_change,
    })),
  };
}

module.exports = { learn, weeklyPanel, ols, inverse, MIN_WEEKS, KCAL_PER_KG };
