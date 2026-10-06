/**
 * services/weeklyBrief.js — Phase 7: the member's weekly check-in, and the
 * coach's AI brief for each member's week.
 *
 * The brief is for the COACH, never the member. It is written from facts this
 * file computes (the same week maths as the member's weekly report), plus the
 * member's check-in answers. The model is told to use only those numbers and
 * to say "not logged" where one is missing; if the model is down, a plain
 * template brief is stored instead, so the coach always has one.
 */
const pool = require('../db/pool');
const { weekWindow, aggregateWeek } = require('./weeklyReport');

const QUESTIONS = [
  { key: 'energy',   label: 'Energy',              low: 'Drained',  high: 'Great' },
  { key: 'hunger',   label: 'Hunger',              low: 'Starving', high: 'Never hungry' },
  { key: 'sleep',    label: 'Sleep',               low: 'Poor',     high: 'Deep' },
  { key: 'stress',   label: 'Stress',              low: 'Calm',     high: 'Very high' },
  { key: 'plan',     label: 'Sticking to the plan', low: 'Struggled', high: 'Easy' },
];

/** The Sunday that ends the week a check-in on `date` is about: that day if Sunday, else the Sunday before. */
function weekEndFor(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
/** The last week that has fully ended: the Sunday before today (yesterday on a Monday). */
function lastWeekEnd(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() || 7));
  return d.toISOString().slice(0, 10);
}
/** A check-in is open on Sunday and Monday (IST) only. */
function checkinOpen(date) {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 1;
}

/** Answers kept: each question a whole 1..5, nothing else. */
function normaliseAnswers(raw) {
  const out = {};
  for (const q of QUESTIONS) {
    const n = Number(raw?.[q.key]);
    if (Number.isInteger(n) && n >= 1 && n <= 5) out[q.key] = n;
  }
  return out;
}

/**
 * Everything the brief may say, for one member's Mon..Sun week ending weekEnd.
 * Numbers only; no opinions.
 */
async function weekFacts(db, memberId, weekEnd) {
  const win = weekWindow(weekEnd);
  const [{ rows: logs }, { rows: sessions }, { rows: [prof] }, { rows: [ci] }, { rows: [photos] }, { rows: [offPlan] }, { rows: [swaps] }, { rows: [user] }] = await Promise.all([
    db.query(`SELECT log_date, weight_kg, food_items FROM daily_logs WHERE patient_id=$1 AND log_date >= $2::date AND log_date <= $3::date ORDER BY log_date`, [memberId, win.prevStart, win.end]),
    db.query(`SELECT ws.session_date, ws.cardio, (SELECT COUNT(*) FROM session_sets st WHERE st.session_id = ws.id) AS set_count
                FROM workout_sessions ws WHERE ws.patient_id=$1 AND ws.session_date >= $2::date AND ws.session_date <= $3::date`, [memberId, win.prevStart, win.end]),
    db.query(`SELECT macro_kcal, macro_pro, target_weight FROM patient_profiles WHERE user_id=$1`, [memberId]),
    db.query(`SELECT answers, note FROM weekly_checkins WHERE patient_id=$1 AND week_end=$2::date`, [memberId, weekEnd]),
    db.query(`SELECT COUNT(DISTINCT pose)::int AS n FROM progress_photos WHERE patient_id=$1 AND week_date = ($2::date)`, [memberId, weekEnd]).catch(() => ({ rows: [{ n: 0 }] })),
    db.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(extras_kcal),0)::int AS kcal FROM meal_photos WHERE patient_id=$1 AND flagged=true AND status='logged' AND log_date >= $2::date AND log_date <= $3::date`, [memberId, win.start, win.end]).catch(() => ({ rows: [{ n: 0, kcal: 0 }] })),
    db.query(`SELECT COUNT(*)::int AS n FROM plan_swaps WHERE patient_id=$1 AND status='requested'`, [memberId]).catch(() => ({ rows: [{ n: 0 }] })),
    db.query(`SELECT name FROM users WHERE id=$1`, [memberId]),
  ]);
  const w = aggregateWeek({ logs, sessions, win });
  return {
    name: user?.name || '', week_start: win.start, week_end: win.end,
    days_logged: w.daysLogged, prev_days_logged: w.prevDaysLogged,
    avg_kcal: w.avgKcal, prev_avg_kcal: w.prevAvgKcal, target_kcal: prof?.macro_kcal != null ? Number(prof.macro_kcal) : null,
    avg_protein: w.avgPro, target_protein: prof?.macro_pro != null ? Number(prof.macro_pro) : null,
    weight_latest: w.latestWeight, weight_change: w.weekDelta, weigh_ins: w.weighInCount, target_weight: prof?.target_weight != null ? Number(prof.target_weight) : null,
    workout_days: w.workoutDays, prev_workout_days: w.prevWorkoutDays, cardio_sessions: w.cardioCount,
    progress_photos: photos?.n || 0, off_plan_meals: offPlan?.n || 0, off_plan_extra_kcal: offPlan?.kcal || 0,
    swap_requests_waiting: swaps?.n || 0,
    checkin: ci ? { answers: ci.answers || {}, note: ci.note || null } : null,
  };
}

function buildBriefPrompt(f) {
  return `You are writing a short WEEKLY BRIEF for a fitness coach in India about one member.
The coach reads it; the member never sees it. Use ONLY the facts below. If a fact is null,
say it was not logged. Never invent a number, never round a number differently, no medical
advice or diagnosis. Plain English, no headings, no emoji.

Write:
1. Two or three sentences on how the week went, leading with the most important thing.
2. "Try:" and up to three short actions for the coach (a message to send, a target to check,
   a question to ask). Base each on a fact above, especially the check-in answers and note.
At most 110 words in all.

FACTS (Mon ${f.week_start} to Sun ${f.week_end}; check-in answers are 1 to 5):
${JSON.stringify(f)}`;
}

/** Brief with no AI: the facts in sentences. Used when the model is down. */
function templateBrief(f) {
  const n = (v, unit = '') => (v == null ? 'not logged' : `${v}${unit}`);
  const parts = [`Logged ${f.days_logged} of 7 days (last week ${f.prev_days_logged}).`,
    `Average ${n(f.avg_kcal, ' kcal')}${f.target_kcal ? ` against ${f.target_kcal}` : ''}; protein ${n(f.avg_protein, ' g')}.`,
    `Weight ${n(f.weight_latest, ' kg')}${f.weight_change != null ? ` (${f.weight_change > 0 ? '+' : ''}${f.weight_change} kg)` : ''}.`,
    `${f.workout_days} workout days.`];
  if (f.off_plan_meals) parts.push(`${f.off_plan_meals} off-plan meals (+${f.off_plan_extra_kcal} kcal).`);
  if (f.checkin) {
    const a = f.checkin.answers || {};
    parts.push(`Check-in: ${QUESTIONS.filter(q => a[q.key]).map(q => `${q.label.toLowerCase()} ${a[q.key]}/5`).join(', ') || 'no scores'}.${f.checkin.note ? ` Note: "${f.checkin.note}"` : ''}`);
  } else parts.push('No check-in this week.');
  return parts.join(' ');
}

/**
 * Make (or remake) the brief for one member's week. Stores and returns it.
 * ai: async (prompt) => text   (injectable; defaults to the app's callAI)
 */
async function makeBrief(db, memberId, weekEnd, { ai } = {}) {
  const facts = await weekFacts(db, memberId, weekEnd);
  let text = null, source = 'ai';
  try {
    const call = ai || (async (p) => (await require('../routes/aiChat').callAI(p, { maxTokens: 600, timeout: 30000 })).text);
    text = String(await call(buildBriefPrompt(facts)) || '').trim().slice(0, 1500);
  } catch (_) { text = null; }
  if (!text) { text = templateBrief(facts); source = 'template'; }
  const { rows: [row] } = await db.query(
    `INSERT INTO coach_briefs (patient_id, week_end, facts, text, source) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (patient_id, week_end) DO UPDATE SET facts=EXCLUDED.facts, text=EXCLUDED.text, source=EXCLUDED.source, created_at=NOW()
     RETURNING id, week_end, facts, text, source, created_at`,
    [memberId, weekEnd, JSON.stringify(facts), text, source]);
  return row;
}

/** Monday 07:00 IST: a brief for every active member for the week that ended yesterday. */
async function makeAllBriefs(db, today, opts = {}) {
  const weekEnd = lastWeekEnd(today);
  const { rows } = await db.query(
    `SELECT u.id FROM users u WHERE u.role='patient' AND u.active = true
       AND NOT EXISTS (SELECT 1 FROM coach_briefs b WHERE b.patient_id=u.id AND b.week_end=$1::date)`, [weekEnd]);
  let made = 0;
  for (const r of rows) { try { await makeBrief(db, r.id, weekEnd, opts); made++; } catch (e) { console.error('brief failed', r.id, e.message); } }
  return made;
}

module.exports = { QUESTIONS, weekEndFor, lastWeekEnd, checkinOpen, normaliseAnswers, weekFacts, buildBriefPrompt, templateBrief, makeBrief, makeAllBriefs };
