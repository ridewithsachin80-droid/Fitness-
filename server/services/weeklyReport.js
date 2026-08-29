/**
 * weeklyReport.js — the Sunday-evening progress review.
 *
 * Computes a member's week from their real logs, drafts a short coach note
 * with the AI (same never-invent-numbers guardrails as celebrations), stores
 * one report per member per week, and pushes "your week is ready".
 *
 * Pure helpers (weekWindow, aggregateWeek, projectGoalDate, winOfWeek,
 * buildNotePrompt) are exported for exhaustive testing; only generateForMember
 * and sendWeeklyReports touch the database. The AI transport is an injectable
 * parameter so tests never need to stub axios.
 *
 * Honesty rule: a flat or up week produces a truthful report. The note prompt
 * forbids celebration language when the numbers don't support it — the coach's
 * credibility rides on every one of these.
 */
const pool = require('../db/pool');
const { computeDayTotals } = require('./digests');
const { regress } = require('./adaptiveEngine');
const { detectMilestones } = require('./milestones');

const IST = 'Asia/Kolkata';
const istDateStr = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(d);

// ── Week window: the 7 days ENDING on runDate (inclusive) ────────────────────
// Trailing week rather than calendar Mon–Sun so the Sunday 6pm run covers
// Mon..Sun exactly, and a manually triggered mid-week report still makes sense.
function weekWindow(runDateStr) {
  const end = new Date(runDateStr + 'T00:00:00Z');
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const prevEnd = new Date(start); prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setUTCDate(prevStart.getUTCDate() - 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), prevStart: iso(prevStart), prevEnd: iso(prevEnd) };
}

// ── Aggregate one member's week from raw rows ────────────────────────────────
// logs: daily_logs rows for [prevStart..end]; sessions: workout day rows.
function aggregateWeek({ logs = [], sessions = [], win }) {
  const inWin = (d) => String(d).slice(0, 10) >= win.start && String(d).slice(0, 10) <= win.end;
  const inPrev = (d) => String(d).slice(0, 10) >= win.prevStart && String(d).slice(0, 10) <= win.prevEnd;

  const weekLogs = logs.filter(l => inWin(l.log_date));
  const prevLogs = logs.filter(l => inPrev(l.log_date));

  const loggedDay = (l) => l.weight_kg != null || (l.food_items?.length || 0) > 0;
  const daysLogged = weekLogs.filter(loggedDay).length;

  const foodDays = weekLogs.map(l => computeDayTotals(l.food_items)).filter(t => t.cal > 0);
  const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const avgKcal = avg(foodDays.map(t => t.cal));
  const avgPro  = avg(foodDays.map(t => t.pro));

  const weighIns = weekLogs.filter(l => l.weight_kg != null)
    .sort((a, b) => String(a.log_date).localeCompare(String(b.log_date)));
  const prevWeighIns = prevLogs.filter(l => l.weight_kg != null)
    .sort((a, b) => String(a.log_date).localeCompare(String(b.log_date)));

  const latest = weighIns.length ? Number(weighIns[weighIns.length - 1].weight_kg) : null;
  const latestDate = weighIns.length ? String(weighIns[weighIns.length - 1].log_date).slice(0, 10) : null;
  // Week delta compares against last week's LAST weigh-in; falls back to this
  // week's first so a first-ever week still shows movement within it.
  const baseline = prevWeighIns.length ? Number(prevWeighIns[prevWeighIns.length - 1].weight_kg)
                 : weighIns.length > 1 ? Number(weighIns[0].weight_kg) : null;
  const weekDelta = latest !== null && baseline !== null
    ? Math.round((latest - baseline) * 10) / 10 : null;

  const workoutDays = sessions.filter(s => inWin(s.session_date)
    && (Number(s.set_count) > 0)).length;
  const cardioCount = sessions.filter(s => inWin(s.session_date))
    .reduce((a, s) => a + (Array.isArray(s.cardio) ? s.cardio.length
      : (() => { try { return JSON.parse(s.cardio || '[]').length; } catch { return 0; } })()), 0);

  return {
    daysLogged,
    avgKcal: avgKcal === null ? null : Math.round(avgKcal),
    avgPro:  avgPro  === null ? null : Math.round(avgPro),
    latestWeight: latest, latestWeightDate: latestDate,
    weekDelta, workoutDays, cardioCount,
    weighInCount: weighIns.length,
  };
}

// ── Projection: on current pace, when does the goal land? ────────────────────
// Linear regression over recent weigh-ins. Deliberately shy: shown only when
// there are enough points, the trend actually moves toward the goal, and the
// landing date is between a week and a year out — a wild extrapolation on the
// member's most emotional number does more harm than an absent line.
function projectGoalDate({ weights = [], target, asOf }) {
  if (target == null || weights.length < 4) return null;
  const t0 = new Date(weights[0].date + 'T00:00:00Z').getTime();
  const xs = weights.map(w => (new Date(w.date + 'T00:00:00Z').getTime() - t0) / 86400000);
  const ys = weights.map(w => Number(w.kg));
  const { slope } = regress(xs, ys);
  const latest = ys[ys.length - 1];
  if (!Number.isFinite(slope)) return null;
  const needsLoss = latest > target;
  if (needsLoss ? slope >= -0.01 : slope <= 0.01) return null;   // not trending toward goal
  const days = (target - latest) / slope;
  if (days < 7 || days > 365) return null;
  const d = new Date(asOf + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

// ── Win of the week ──────────────────────────────────────────────────────────
// Milestones crossed WITHIN the window: compare the week's last weigh-in
// against the last one before the window (same crossing rules as celebrate).
function winOfWeek({ latest, beforeWindow, lowestBefore, start, target, streak }) {
  const ms = detectMilestones({
    start_weight: start, latest_weight: latest, prev_weight: beforeWindow,
    lowest_before: lowestBefore, target_weight: target,
    streak: [7, 14, 30, 60, 100].includes(streak) ? streak : 0,
  });
  return ms.length ? ms[0] : null;
}

// ── Coach note prompt ────────────────────────────────────────────────────────
function buildNotePrompt({ name, week, targets, win }) {
  const facts = [];
  if (week.latestWeight != null) facts.push(`weight now ${week.latestWeight} kg`);
  if (week.weekDelta != null) facts.push(`${week.weekDelta > 0 ? 'up' : 'down'} ${Math.abs(week.weekDelta)} kg this week`);
  facts.push(`logged ${week.daysLogged}/7 days`);
  if (week.avgKcal != null) facts.push(`avg ${week.avgKcal} kcal${targets.kcal ? ` vs target ${targets.kcal}` : ''}`);
  if (week.avgPro != null) facts.push(`avg protein ${week.avgPro} g${targets.pro ? ` vs target ${targets.pro}` : ''}`);
  facts.push(`${week.workoutDays} workout day(s), ${week.cardioCount} cardio/walk(s)`);
  if (win) facts.push(`milestone this week: ${win}`);

  return `You are writing ONE short weekly-review note (1–2 sentences, max 220
characters) from an Indian fitness coach to their member ${name}. It appears
under "FROM COACH" on their weekly report card.

THE WEEK'S FACTS (use ONLY these — never invent a number):
${facts.map(f => `- ${f}`).join('\n')}

RULES:
- Specific beats generic: point at the ONE thing to fix or keep next week.
- If the week was flat or weight went up, be honest and steady — no fake
  cheering, no shame. Consistency of logging is always worth naming.
- Warm, direct, coach's voice. No greetings ("Hi"), no sign-off, no hashtags,
  at most one emoji, no medical claims.
Return ONLY the note text.`;
}

// ── Generate + store one member's report ─────────────────────────────────────
async function generateForMember(member, runDate, { ai } = {}) {
  const win = weekWindow(runDate);
  const [{ rows: logs }, { rows: sessions }, { rows: prof }, { rows: beforeRows }] = await Promise.all([
    pool.query(
      `SELECT log_date, weight_kg, food_items FROM daily_logs
       WHERE patient_id=$1 AND log_date >= $2::date AND log_date <= $3::date
       ORDER BY log_date`, [member.id, win.prevStart, win.end]),
    pool.query(
      `SELECT ws.session_date, ws.cardio,
              (SELECT COUNT(*) FROM session_sets st WHERE st.session_id = ws.id) AS set_count
       FROM workout_sessions ws
       WHERE ws.patient_id=$1 AND ws.session_date >= $2::date AND ws.session_date <= $3::date`,
      [member.id, win.start, win.end]),
    pool.query(
      `SELECT start_weight, target_weight, macro_kcal, macro_pro
       FROM patient_profiles WHERE user_id=$1`, [member.id]),
    pool.query(
      `SELECT weight_kg, log_date FROM daily_logs
       WHERE patient_id=$1 AND weight_kg IS NOT NULL AND log_date < $2::date
       ORDER BY log_date DESC LIMIT 1`, [member.id, win.start]),
  ]);

  const week = aggregateWeek({ logs, sessions, win });
  if (week.daysLogged === 0 && week.weighInCount === 0) return null;   // nothing to report

  const p = prof[0] || {};
  const { rows: lowRows } = await pool.query(
    `SELECT MIN(weight_kg) AS low FROM daily_logs
     WHERE patient_id=$1 AND weight_kg IS NOT NULL AND log_date < $2::date`,
    [member.id, win.start]);

  const winText = week.latestWeight == null ? null : winOfWeek({
    latest: week.latestWeight,
    beforeWindow: beforeRows[0] ? Number(beforeRows[0].weight_kg) : null,
    lowestBefore: lowRows[0]?.low != null ? Number(lowRows[0].low) : null,
    start: p.start_weight != null ? Number(p.start_weight) : null,
    target: p.target_weight != null ? Number(p.target_weight) : null,
    streak: week.daysLogged === 7 ? 7 : 0,
  });

  const { rows: recentW } = await pool.query(
    `SELECT log_date, weight_kg FROM daily_logs
     WHERE patient_id=$1 AND weight_kg IS NOT NULL AND log_date > ($2::date - 28)
       AND log_date <= $2::date
     ORDER BY log_date`, [member.id, win.end]);
  const projectedDate = projectGoalDate({
    weights: recentW.map(r => ({ date: String(r.log_date).slice(0, 10), kg: r.weight_kg })),
    target: p.target_weight != null ? Number(p.target_weight) : null,
    asOf: week.latestWeightDate || win.end,
  });

  const data = {
    weekStart: win.start, weekEnd: win.end,
    ...week,
    startWeight: p.start_weight != null ? Number(p.start_weight) : null,
    targetWeight: p.target_weight != null ? Number(p.target_weight) : null,
    totalDelta: (week.latestWeight != null && p.start_weight != null)
      ? Math.round((Number(p.start_weight) - week.latestWeight) * 10) / 10 : null,
    kcalTarget: p.macro_kcal || null,
    proTarget: p.macro_pro || null,
    win: winText,
    projectedDate,
  };

  let coachNote = null;
  try {
    const call = ai || require('../routes/aiChat').callAI;
    const { text } = await call(buildNotePrompt({
      name: member.name.split(' ')[0], week,
      targets: { kcal: p.macro_kcal, pro: p.macro_pro }, win: winText,
    }));
    coachNote = String(text || '').trim().slice(0, 300) || null;
  } catch (e) { console.error(`weekly note failed for ${member.name}:`, e.message); }

  const { rows: [saved] } = await pool.query(
    `INSERT INTO weekly_reports (patient_id, monitor_id, week_start, week_end, data, coach_note)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (patient_id, week_start)
     DO UPDATE SET data = EXCLUDED.data, coach_note = EXCLUDED.coach_note, created_at = NOW()
     RETURNING id`,
    [member.id, member.monitor_id || null, win.start, win.end, JSON.stringify(data), coachNote]);
  return { id: saved.id, data, coachNote };
}

// ── Sunday batch: every active member of every coach ─────────────────────────
async function sendWeeklyReports(runDate, { ai } = {}) {
  const push = require('./pushService');
  const { rows: members } = await pool.query(
    `SELECT u.id, u.name, mp.monitor_id FROM users u
     LEFT JOIN monitor_patients mp ON mp.patient_id = u.id AND mp.active = true
     WHERE u.role = 'patient' AND u.active = true`);

  let sent = 0;
  for (const m of members) {
    try {
      const win = weekWindow(runDate);
      const { rows: existing } = await pool.query(
        `SELECT 1 FROM weekly_reports WHERE patient_id=$1 AND week_start=$2::date
           AND created_at > NOW() - INTERVAL '2 days'`, [m.id, win.start]);
      if (existing.length) continue;                        // already generated this week
      const report = await generateForMember(m, runDate, { ai });
      if (!report) continue;                                // empty week — no report, no push
      try {
        await push.sendToUser(m.id, 'Your week with FitLife 📊',
          buildPushLine(report.data), 'weekly_report');
      } catch { /* report exists even if push fails */ }
      sent++;
    } catch (e) { console.error(`weekly report failed for ${m.name}:`, e.message); }
  }
  return sent;
}

function buildPushLine(d) {
  const bits = [];
  if (d.weekDelta != null) bits.push(`${d.weekDelta > 0 ? '▲' : '▼'} ${Math.abs(d.weekDelta)} kg this week`);
  bits.push(`${d.daysLogged}/7 days logged`);
  if (d.win) bits.push('a milestone inside 🎉');
  return bits.join(' · ') + ' — open Progress to see it.';
}

module.exports = { weekWindow, aggregateWeek, projectGoalDate, winOfWeek,
                   buildNotePrompt, buildPushLine, generateForMember, sendWeeklyReports };
