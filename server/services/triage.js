/**
 * services/triage.js — "Who needs me today", composed from what already exists.
 *
 * The coach home used to show a roster: names, a compliance number, last logged.
 * The coach had to work out from those what to DO. Triage turns the same
 * signals into one line per member and one suggested action:
 *
 *   Daya   · No food log + sleep down 1.4 h + missed workout   → Check in
 *   Vishwas· Weight up 1.2 kg over 2 weeks                    → Review meals
 *   Asha   · 21-day streak, protein 6/7                       → Praise
 *
 * Signals come from detectGaps (today's gaps, same rules as the gaps route)
 * plus three trends that need history: weight over two weeks, last night's
 * sleep against the 7-day average, and the week's log strip. Pure functions;
 * the route only fetches rows and calls composeMember().
 */
const { detectGaps, NEVER_LOGGED } = require('./gapDetector');

const DAY = 86400000;

/** A Date whose IST hour is `hour` — detectGaps takes an instant, not an hour. */
function nowAtIstHour(hour) {
  if (hour == null) return new Date();
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 3600000);
  istNow.setUTCHours(hour, 0, 0, 0);
  return new Date(istNow.getTime() - 5.5 * 3600000);
}

function sleepMinutes(sleep) {
  if (!sleep || !sleep.bedtime || !sleep.waketime) return null;
  const toMin = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + (m || 0); };
  let mins = toMin(sleep.waketime) - toMin(sleep.bedtime);
  if (mins <= 0) mins += 1440;
  return mins;
}

/**
 * @param {object} member   { id, name, phone }
 * @param {object} ctx
 * @param {Array}  ctx.logs       this member's daily_logs for the last 14 days, any order
 * @param {object} ctx.protocol   patient_profiles row (water_target, protocol_* , meal_plan)
 * @param {number} ctx.daysSince  days since any log (NEVER_LOGGED when none)
 * @param {object} ctx.todayDay   program day scheduled today ({ day_label }) or null
 * @param {boolean} ctx.workoutLoggedToday
 * @param {number} ctx.streak     consecutive logged days ending today/yesterday
 * @param {number} ctx.unread     unread member messages
 * @param {string} ctx.todayStr   'YYYY-MM-DD' in IST
 * @param {number} ctx.hour       IST hour (for the gap detector's time gates)
 */
function composeMember(member, ctx) {
  const { logs = [], protocol = {}, daysSince = NEVER_LOGGED, todayDay = null, workoutLoggedToday = false,
          streak = 0, unread = 0, todayStr, hour } = ctx;
  const byDate = new Map(logs.map(l => [String(l.log_date).slice(0, 10), l]));
  const today = byDate.get(todayStr) || null;

  // ── today's gaps (same rules as /members/gaps) ────────────────────────────
  const gapRes = detectGaps(member, today, {
    water_target: protocol.water_target,
    activities:   protocol.protocol_activities,
    acv:          protocol.protocol_acv,
    supplements:  protocol.protocol_supplements,
    meal_slots:   protocol.meal_plan,
  }, { daysSince, now: ctx.now || nowAtIstHour(hour) });
  const gapKeys = new Set(gapRes.gaps.map(g => g.key));

  // ── week strip: 7 dots, oldest → today ────────────────────────────────────
  const week = [];
  const t0 = new Date(todayStr + 'T12:00:00Z');
  for (let i = 6; i >= 0; i--) {
    const d = new Date(t0.getTime() - i * DAY).toISOString().slice(0, 10);
    week.push(byDate.has(d) ? 1 : 0);
  }
  const loggedDays = week.reduce((a, b) => a + b, 0);

  // ── weight over two weeks: first weigh-in in the window → latest ─────────
  const weighed = logs.filter(l => l.weight_kg != null).sort((a, b) => String(a.log_date).localeCompare(String(b.log_date)));
  const weightDelta = weighed.length >= 2
    ? +(parseFloat(weighed[weighed.length - 1].weight_kg) - parseFloat(weighed[0].weight_kg)).toFixed(1) : null;

  // ── sleep: last night vs the 7-day average of the nights before ──────────
  const nights = logs.map(l => ({ d: String(l.log_date).slice(0, 10), m: sleepMinutes(l.sleep) })).filter(n => n.m != null)
    .sort((a, b) => a.d.localeCompare(b.d));
  let sleepDrop = null;
  if (nights.length >= 4) {
    const last = nights[nights.length - 1]; const prev = nights.slice(-8, -1);
    if (prev.length >= 3) {
      const avg = prev.reduce((a, n) => a + n.m, 0) / prev.length;
      sleepDrop = +((avg - last.m) / 60).toFixed(1);
    }
  }

  // ── reasons, in the order a coach would say them ─────────────────────────
  const reasons = [];
  let priority = 'ok';
  const bump = (p) => { const r = { ok: 0, watch: 1, attention: 2, high: 3 }; if (r[p] > r[priority]) priority = p; };

  if (daysSince === NEVER_LOGGED) { reasons.push('Never logged'); bump('high'); }
  else if (daysSince >= 3)       { reasons.push(`Quiet ${daysSince} days`); bump('high'); }
  else if (gapKeys.has('nothing')) { reasons.push('Nothing logged today'); bump('attention'); }
  else {
    if (gapKeys.has('food'))  { reasons.push('No food log'); bump('attention'); }
    if (gapKeys.has('water')) { reasons.push('Water behind'); bump('watch'); }
    if (gapKeys.has('protocol')) { reasons.push('Protocol untouched'); bump('watch'); }
  }
  if (sleepDrop != null && sleepDrop >= 1) { reasons.push(`Sleep down ${sleepDrop} h`); bump('attention'); }
  if (todayDay && !workoutLoggedToday && hour >= 18) { reasons.push('Missed workout'); bump('attention'); }
  if (weightDelta != null && weightDelta >= 1) { reasons.push(`Weight up ${weightDelta} kg / 2 wk`); bump('attention'); }
  if (unread > 0) { reasons.push(`${unread} unread ${unread === 1 ? 'message' : 'messages'}`); bump('attention'); }

  // ── the good news, only when nothing is wrong ────────────────────────────
  const wins = [];
  if (priority === 'ok') {
    if (streak >= 7) wins.push(`${streak}-day streak`);
    if (weightDelta != null && weightDelta <= -0.5) wins.push(`Down ${Math.abs(weightDelta)} kg / 2 wk`);
    if (loggedDays === 7) wins.push('Logged every day this week');
  }

  // ── one action ──────────────────────────────────────────────────────────
  let action;
  if (daysSince === NEVER_LOGGED)           action = { key: 'onboard',  label: 'Help them start' };
  else if (daysSince >= 3)                  action = { key: 'nudge',    label: 'Send a nudge' };
  else if (unread > 0)                      action = { key: 'reply',    label: 'Reply' };
  else if (gapKeys.has('nothing') || gapKeys.has('food')) action = { key: 'checkin', label: 'Check in' };
  else if (weightDelta != null && weightDelta >= 1)       action = { key: 'review',  label: 'Review meals' };
  else if (sleepDrop != null && sleepDrop >= 1)           action = { key: 'checkin', label: 'Ask about sleep' };
  else if (todayDay && !workoutLoggedToday && hour >= 18) action = { key: 'nudge',   label: 'Nudge workout' };
  else if (wins.length)                     action = { key: 'praise',   label: 'Send praise' };
  else                                      action = { key: 'open',     label: 'Open' };

  return {
    id: member.id, name: member.name, phone: member.phone || null,
    priority, reasons, wins, action,
    week, logged_days: loggedDays, streak,
    days_since_log: daysSince === NEVER_LOGGED ? null : daysSince,
    last_logged: weighed.length || logs.length ? logs.map(l => String(l.log_date).slice(0, 10)).sort().pop() : null,
    latest_weight: weighed.length ? parseFloat(weighed[weighed.length - 1].weight_kg) : null,
    weight_delta_2wk: weightDelta,
    sleep_drop_h: sleepDrop,
    workout_today: todayDay ? { label: todayDay.day_label, logged: !!workoutLoggedToday } : null,
    unread,
  };
}

const PRIORITY_RANK = { high: 0, attention: 1, watch: 2, ok: 3 };

/** Sort: worst first, then by name. Summary counts for the header. */
function summarise(rows) {
  const sorted = [...rows].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.name.localeCompare(b.name));
  return {
    members: sorted,
    counts: {
      total: rows.length,
      on_track: rows.filter(r => r.priority === 'ok').length,
      watch: rows.filter(r => r.priority === 'watch').length,
      attention: rows.filter(r => r.priority === 'attention').length,
      high: rows.filter(r => r.priority === 'high').length,
    },
  };
}

module.exports = { composeMember, summarise, sleepMinutes };
