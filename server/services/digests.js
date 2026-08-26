/**
 * digests.js — the two daily proactive messages, built from real logged data.
 *
 *   Evening recap (member, 20:30 IST): "1,450 of 1,800 kcal, water 2.1 of 3L…"
 *   Morning digest (coach, 08:00 IST): who logged yesterday, who has gone quiet.
 *
 * Design rules learned the hard way in this codebase:
 *   - Messages must reflect the member's actual state, never generic nudges.
 *   - One per person per day, enforced against notifications_log — the same
 *     dedupe failure that produced four identical coach notes must not recur.
 *   - Recaps only go to members who logged SOMETHING today; total silence is
 *     the gap-nudge system's job, and two overlapping nudges read as spam.
 *   - Respect the opt-out in patient_profiles via messaging.preferences().
 */
const pool = require('../db/pool');

// Mirrors client calcN: per_100g × grams/100. Rows without nutrition data are
// counted, not silently priced at zero.
function computeDayTotals(foodItems) {
  let cal = 0, pro = 0, carb = 0, fat = 0, unknown = 0;
  for (const f of (Array.isArray(foodItems) ? foodItems : [])) {
    const g = parseFloat(f.grams);
    const n = f.per_100g;
    if (!Number.isFinite(g) || !n || !(parseFloat(n.calories) > 0)) { unknown++; continue; }
    const k = g / 100;
    cal  += (parseFloat(n.calories)    || 0) * k;
    pro  += (parseFloat(n.protein)     || 0) * k;
    carb += (parseFloat(n.total_carbs) || 0) * k;
    fat  += (parseFloat(n.fat)         || 0) * k;
  }
  return { cal: Math.round(cal), pro: +pro.toFixed(1), carb: +carb.toFixed(1),
           fat: +fat.toFixed(1), unknown };
}

// ── Message builders — pure, so the tests can pin the wording ────────────────

function buildRecapBody({ totals, kcalTarget, waterMl, waterTarget, weightLogged }) {
  const parts = [];
  if (kcalTarget) {
    const left = kcalTarget - totals.cal;
    parts.push(left > 0
      ? `${totals.cal} of ${kcalTarget} kcal — room for ~${left} more`
      : `${totals.cal} kcal, ${Math.abs(left)} over your ${kcalTarget} target`);
  } else {
    parts.push(`${totals.cal} kcal so far`);
  }
  const waterL = (ml) => (ml / 1000).toFixed(1).replace(/\.0$/, '');
  if (waterTarget) {
    parts.push(waterMl >= waterTarget
      ? `water done ✓`
      : `water ${waterL(waterMl)} of ${waterL(waterTarget)}L`);
  }
  if (!weightLogged) parts.push(`weigh-in still open`);
  return parts.join(' · ');
}

function buildDigestBody({ total, loggedYesterday, silent }) {
  const lines = [`${loggedYesterday} of ${total} members logged yesterday.`];
  if (silent.length) {
    const names = silent.slice(0, 5).map(s => `${s.name} (${s.days}d)`).join(', ');
    lines.push(`Quiet 3+ days: ${names}${silent.length > 5 ? ` +${silent.length - 5} more` : ''}.`);
  } else {
    lines.push('Nobody has gone quiet. Good day to push progress.');
  }
  return lines.join(' ');
}

// ── Dedupe: one message of a given type per user per IST day ─────────────────
async function alreadySentToday(userId, type, istDate) {
  const { rows } = await pool.query(
    `SELECT 1 FROM notifications_log
     WHERE user_id=$1 AND type=$2 AND failed=false
       AND (sent_at AT TIME ZONE 'Asia/Kolkata')::date = $3::date
     LIMIT 1`, [userId, type, istDate]);
  return rows.length > 0;
}

async function logSent(userId, type, title, body, ok) {
  await pool.query(
    `INSERT INTO notifications_log (user_id, type, title, body, failed)
     VALUES ($1,$2,$3,$4,$5)`, [userId, type, title, body.slice(0, 1000), !ok]).catch(() => {});
}

// ── Evening recap ────────────────────────────────────────────────────────────
async function sendEveningRecaps(istDate) {
  const { preferences, } = require('./messaging');
  const push = require('./pushService');

  // Members who logged something today, with their targets in one query.
  const { rows } = await pool.query(
    `SELECT u.id, u.name, dl.food_items, dl.water_ml, dl.weight_kg,
            pp.macro_kcal, pp.water_target
     FROM users u
     JOIN daily_logs dl ON dl.patient_id = u.id AND dl.log_date = $1::date
     LEFT JOIN patient_profiles pp ON pp.user_id = u.id
     WHERE u.role = 'patient' AND u.active = true`, [istDate]);

  let sent = 0;
  for (const m of rows) {
    const totals = computeDayTotals(m.food_items);
    const hasAnything = totals.cal > 0 || (m.water_ml || 0) > 0 || m.weight_kg != null;
    if (!hasAnything) continue;                                   // silence → gap system's job
    if (await alreadySentToday(m.id, 'evening_recap', istDate)) continue;
    const prefs = await preferences(m.id);
    if (prefs.optedOut || !prefs.push) continue;

    const body = buildRecapBody({
      totals,
      kcalTarget:   m.macro_kcal || null,
      waterMl:      m.water_ml || 0,
      waterTarget:  m.water_target || null,
      weightLogged: m.weight_kg != null,
    });
    const title = 'Today so far';
    let ok = true;
    try { await push.sendToUser(m.id, title, body, 'evening_recap'); }
    catch { ok = false; }
    await logSent(m.id, 'evening_recap', title, body, ok);
    if (ok) sent++;
  }
  return sent;
}

// ── Coach morning digest ─────────────────────────────────────────────────────
async function sendCoachDigests(istDate) {
  const push = require('./pushService');

  const { rows: coaches } = await pool.query(
    `SELECT id, name FROM users WHERE role IN ('monitor') AND active = true`);

  let sent = 0;
  for (const c of coaches) {
    if (await alreadySentToday(c.id, 'coach_digest', istDate)) continue;

    // Members with last-log recency, one query per coach.
    const { rows: members } = await pool.query(
      `SELECT u.id, u.name,
              MAX(dl.log_date) AS last_log,
              BOOL_OR(dl.log_date = ($1::date - 1)) AS logged_yesterday
       FROM monitor_patients mp
       JOIN users u ON u.id = mp.patient_id AND u.active = true
       LEFT JOIN daily_logs dl ON dl.patient_id = u.id
       WHERE mp.monitor_id = $2
       GROUP BY u.id, u.name`, [istDate, c.id]);

    if (!members.length) continue;

    const silent = members
      .map(m => ({
        name: m.name,
        days: m.last_log
          ? Math.floor((new Date(istDate) - new Date(m.last_log)) / 86400000)
          : 999,
      }))
      .filter(m => m.days >= 3)
      .sort((a, b) => b.days - a.days)
      .map(m => ({ ...m, days: m.days > 60 ? '60+' : m.days }));

    const body = buildDigestBody({
      total: members.length,
      loggedYesterday: members.filter(m => m.logged_yesterday).length,
      silent,
    });
    const title = 'Morning digest';
    let ok = true;
    try { await push.sendToUser(c.id, title, body, 'coach_digest'); }
    catch { ok = false; }
    await logSent(c.id, 'coach_digest', title, body, ok);
    if (ok) sent++;
  }
  return sent;
}

module.exports = { computeDayTotals, buildRecapBody, buildDigestBody,
                   sendEveningRecaps, sendCoachDigests, alreadySentToday };
