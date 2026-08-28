/**
 * milestones.js — progress facts and milestone detection for members.
 *
 * Exists so the coach's AI can write a congratulations message from REAL
 * numbers ("from 94 to 84.9, that's 9.1 kg") instead of inventing them. The
 * detection is a pure function over a member's stats so it can be tested
 * exhaustively; only loadCoachMemberStats touches the database.
 *
 * Deliberately conservative: a milestone fires on the weigh-in that CROSSES a
 * threshold, not on every weigh-in that happens to sit past it. Congratulating
 * someone for "dropping below 85" every single morning would make the whole
 * feature feel automated and cheapen the real moment.
 */
const pool = require('../db/pool');

const istToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * @param {object} s
 *   start_weight, latest_weight, prev_weight, lowest_before (lowest weight
 *   EXCLUDING the latest), target_weight, streak, days_logged_14
 * @returns {string[]} human-readable milestone facts, most significant first
 */
function detectMilestones(s = {}) {
  const start  = num(s.start_weight);
  const latest = num(s.latest_weight);
  const prev   = num(s.prev_weight);
  const lowest = num(s.lowest_before);
  const target = num(s.target_weight);
  const streak = num(s.streak) || 0;
  const out = [];
  if (latest === null) return out;

  const r1 = (n) => Math.round(n * 10) / 10;

  // Goal reached — the biggest one, so it leads.
  if (target !== null && latest <= target && (prev === null || prev > target)) {
    out.push(`reached the goal weight of ${r1(target)} kg`);
  }

  // Crossed below a round 5 kg band (85, 80, 75 …) on this weigh-in.
  if (prev !== null) {
    const band = Math.floor(prev / 5) * 5;
    if (latest < band && prev >= band) out.push(`dropped below ${band} kg for the first time`);
  }

  // Crossed a 5 kg-lost threshold on this weigh-in.
  if (start !== null) {
    const lostNow  = start - latest;
    const lostPrev = prev === null ? 0 : start - prev;
    const stepNow  = Math.floor(lostNow / 5) * 5;
    if (stepNow >= 5 && Math.floor(lostPrev / 5) * 5 < stepNow) {
      out.push(`${stepNow} kg down from the starting ${r1(start)} kg`);
    }
  }

  // New lowest ever — only when it beats every previous weigh-in.
  if (lowest !== null && latest < lowest) {
    out.push(`a new lowest weight (previous best ${r1(lowest)} kg)`);
  }

  // Logging consistency milestones.
  if ([7, 14, 30, 60, 100].includes(streak)) {
    out.push(`${streak} days logged in a row`);
  }

  return out;
}

/** One compact line per member for the coach prompt. */
function statsLine(s) {
  const r1 = (n) => (n === null || n === undefined ? null : Math.round(Number(n) * 10) / 10);
  const bits = [];
  const latest = r1(s.latest_weight), start = r1(s.start_weight), target = r1(s.target_weight);
  if (latest !== null) {
    bits.push(`now ${latest} kg`);
    if (start !== null) {
      const d = Math.round((start - latest) * 10) / 10;
      bits.push(d > 0 ? `down ${d} from ${start}` : d < 0 ? `up ${Math.abs(d)} from ${start}` : `same as start ${start}`);
    }
    if (target !== null) bits.push(`goal ${target}`);
  } else {
    bits.push('no weigh-in yet');
  }
  bits.push(`logged ${s.days_logged_14 || 0}/14 days`);
  if (s.streak) bits.push(`${s.streak}-day streak`);
  const ms = detectMilestones(s);
  if (ms.length) bits.push(`MILESTONE: ${ms.join('; ')}`);
  return bits.join(', ');
}

/**
 * Progress stats for every member a coach manages, in one round trip.
 * patient_profiles keys on user_id (not patient_id) — a real bug once.
 */
async function loadCoachMemberStats(coachUser) {
  const today = istToday();
  const isAdmin = coachUser.role === 'admin';
  const params = isAdmin ? [today] : [today, coachUser.id];
  const scope = isAdmin
    ? `SELECT id, name FROM users WHERE role='patient' AND active=true`
    : `SELECT u.id, u.name FROM users u
       JOIN monitor_patients mp ON mp.patient_id = u.id AND mp.active = true
       WHERE mp.monitor_id = $2 AND u.role='patient' AND u.active=true`;

  const { rows } = await pool.query(
    `WITH mem AS (${scope})
     SELECT mem.id, mem.name,
            pp.start_weight, pp.target_weight,
            lw.weight_kg  AS latest_weight,
            lw.log_date   AS latest_date,
            pw.weight_kg  AS prev_weight,
            lo.lowest_before,
            COALESCE(d14.n, 0) AS days_logged_14
     FROM mem
     LEFT JOIN patient_profiles pp ON pp.user_id = mem.id
     LEFT JOIN LATERAL (
       SELECT weight_kg, log_date FROM daily_logs
       WHERE patient_id = mem.id AND weight_kg IS NOT NULL
       ORDER BY log_date DESC LIMIT 1
     ) lw ON true
     LEFT JOIN LATERAL (
       SELECT weight_kg FROM daily_logs
       WHERE patient_id = mem.id AND weight_kg IS NOT NULL
         AND log_date < lw.log_date
       ORDER BY log_date DESC LIMIT 1
     ) pw ON true
     LEFT JOIN LATERAL (
       SELECT MIN(weight_kg) AS lowest_before FROM daily_logs
       WHERE patient_id = mem.id AND weight_kg IS NOT NULL
         AND log_date < lw.log_date
     ) lo ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS n FROM daily_logs
       WHERE patient_id = mem.id
         AND log_date > ($1::date - 14)
         AND (weight_kg IS NOT NULL OR jsonb_array_length(COALESCE(food_items, '[]'::jsonb)) > 0)
     ) d14 ON true
     ORDER BY mem.name`, params);

  return rows.map(r => ({ ...r, milestones: detectMilestones(r) }));
}

module.exports = { detectMilestones, statsLine, loadCoachMemberStats, istToday };
