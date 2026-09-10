/**
 * lib/day/recovery.js — one shape for every tracker (Sprint 11c).
 *
 * Providers store different metric trees (Fitbit: heart_rate.resting,
 * sleep.total_minutes; Whoop: recovery.hrv_rmssd_milli, recovery.score,
 * sleep.minutes; Garmin: activity.steps, sleep.score …). GET /trackers/data
 * merges them per day but keeps each provider's names. This flattens a day
 * into the six numbers the app cares about, null when a provider does not
 * report them, and NEVER guesses.
 *
 * The recovery section renders only when at least one of these is present
 * for today or yesterday. No tracker → no section. The hero never depends on
 * this.
 */
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
const first = (...vals) => { for (const v of vals) { const n = num(v); if (n != null) return n; } return null; };

/** Flatten one merged day from /trackers/data. */
export function normaliseTrackerDay(day = {}) {
  const hr = day.heart_rate || {};
  const rec = day.recovery || {};
  const sl = day.sleep || {};
  const act = day.activity || {};
  return {
    date: day.date ? String(day.date).slice(0, 10) : null,
    restingHr:    first(hr.resting, hr.resting_heart_rate, rec.resting_heart_rate, day.resting_hr),
    hrv:          first(rec.hrv_rmssd_milli, rec.hrv, hr.hrv, day.hrv),
    recovery:     first(rec.score, rec.recovery_score, day.readiness, day.recovery_score),
    sleepMinutes: first(sl.total_minutes, sl.minutes, sl.duration_min, sl.duration_minutes != null ? sl.duration_minutes : null,
                        sl.hours != null ? Number(sl.hours) * 60 : null),
    sleepScore:   first(sl.score, sl.efficiency),
    steps:        first(act.steps, day.steps),
    providers:    Array.isArray(day.sources) ? [...new Set(day.sources.map(s => s.provider).filter(Boolean))] : [],
  };
}

const hasAny = (d) => ['restingHr', 'hrv', 'recovery', 'sleepMinutes', 'sleepScore', 'steps'].some(k => d[k] != null);

/**
 * From up to 7 merged days: today's (or yesterday's) numbers, the week's
 * averages of the days before it, and ONE insight sentence.
 * Returns null when nothing usable is there — the card then does not render.
 */
export function recoverySummary(days = [], { today }) {
  const norm = days.map(normaliseTrackerDay).filter(d => d.date && hasAny(d)).sort((a, b) => b.date.localeCompare(a.date));
  if (!norm.length) return null;
  const latest = norm[0];
  // Only today's or yesterday's data counts as "now". Older is stale.
  const yesterday = new Date(today + 'T12:00:00Z'); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  if (latest.date !== today && latest.date !== yStr) return null;

  const prior = norm.slice(1);
  const avg = (k) => { const xs = prior.map(d => d[k]).filter(v => v != null); return xs.length >= 2 ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const avgs = { restingHr: avg('restingHr'), hrv: avg('hrv'), sleepMinutes: avg('sleepMinutes'), steps: avg('steps'), recovery: avg('recovery') };

  // One insight, in priority order. Each needs both a value and a baseline.
  let insight = null;
  const fmtH = (m) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;
  if (latest.recovery != null && latest.recovery < 34) insight = `Recovery is low (${Math.round(latest.recovery)}). A lighter day and an early night will do more than a hard session.`;
  else if (latest.restingHr != null && avgs.restingHr != null && latest.restingHr - avgs.restingHr >= 4) insight = `Resting heart rate is ${Math.round(latest.restingHr - avgs.restingHr)} above your week's average — that is often a poor night or the start of a cold. Go easy.`;
  else if (latest.hrv != null && avgs.hrv != null && latest.hrv < avgs.hrv * 0.8) insight = `HRV is well below your usual — your body is still recovering from something. Keep today gentle.`;
  else if (latest.sleepMinutes != null && latest.sleepMinutes < 360) insight = `${fmtH(latest.sleepMinutes)} of sleep is under six hours. Protect tonight's.`;
  else if (latest.sleepMinutes != null && avgs.sleepMinutes != null && latest.sleepMinutes >= avgs.sleepMinutes + 45) insight = `${fmtH(latest.sleepMinutes)} — a better night than your average. Good day to train hard.`;
  else if (latest.recovery != null && latest.recovery >= 67) insight = `Recovery is high (${Math.round(latest.recovery)}). Green light for a hard session.`;
  else if (latest.steps != null && avgs.steps != null && latest.steps < avgs.steps * 0.5 && latest.date === today) insight = `Only ${latest.steps.toLocaleString('en-IN')} steps so far — a walk after your next meal closes most of the gap.`;
  else if (latest.restingHr != null && avgs.restingHr != null && avgs.restingHr - latest.restingHr >= 3) insight = `Resting heart rate is ${Math.round(avgs.restingHr - latest.restingHr)} below your week's average — fitness is doing its job.`;

  return { latest, avgs, insight, isToday: latest.date === today, providers: latest.providers };
}
