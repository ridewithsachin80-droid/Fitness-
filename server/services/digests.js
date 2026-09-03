/**
 * digests.js — the two daily proactive messages, built from real logged data.
 *
 *   Morning nudge  (member, 06:30 IST): "Yesterday 1,780 kcal · 78.4 kg.
 *                                        Today's Push · Mon. Weight when you're up."
 *   Evening recap  (member, 20:30 IST): "1,450 of 1,800 kcal, water 2.1 of 3L…"
 *   Morning digest (coach,  08:00 IST): who logged yesterday, who has gone quiet.
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

function buildDigestBody({ total, loggedYesterday, silent, milestones = [] }) {
  const lines = [`${loggedYesterday} of ${total} members logged yesterday.`];
  // Milestones lead: a congratulations is time-sensitive in a way that a
  // compliance count never is. Named so the coach can act in one message.
  if (milestones.length) {
    const m = milestones.slice(0, 3).map(x => `${x.name} — ${x.text}`).join('; ');
    lines.push(`🎉 ${m}${milestones.length > 3 ? ` +${milestones.length - 3} more` : ''}. Say "celebrate <name>" to send a note.`);
  }
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

/**
 * Was a message of this type ATTEMPTED today, successful or not?
 *
 * `alreadySentToday` filters on failed=false, so a send that errored does not
 * block a later retry. That is right for the evening recap, where a transient
 * push failure is worth retrying.
 *
 * It is wrong for the morning nudge. A member with no push subscription at all
 * — never granted permission, or on iOS Safari without installing — fails
 * EVERY time, so the "retry" can never succeed and each attempt writes another
 * row. Worse, a send that threw after the notification had already been
 * delivered would send a second one.
 *
 * The morning nudge's whole design is one message per member per day. That has
 * to mean one ATTEMPT, not one success.
 */
async function alreadyAttemptedToday(userId, type, istDate) {
  const { rows } = await pool.query(
    `SELECT 1 FROM notifications_log
     WHERE user_id=$1 AND type=$2
       AND (sent_at AT TIME ZONE 'Asia/Kolkata')::date = $3::date
     LIMIT 1`, [userId, type, istDate]);
  return rows.length > 0;
}

async function logSent(userId, type, title, body, ok) {
  await pool.query(
    `INSERT INTO notifications_log (user_id, type, title, body, failed)
     VALUES ($1,$2,$3,$4,$5)`, [userId, type, title, body.slice(0, 1000), !ok]).catch(() => {});
}


// ── Morning nudge ────────────────────────────────────────────────────────────

/**
 * The one daily prompt to log, at 06:30 IST.
 *
 * Sachin's first plan was five scheduled reminders a day — weight, activity,
 * and one per meal. One replaced them, deliberately: five push notifications
 * a day is how members mute the app, and a muted app also loses the evening
 * recap and the coach's messages. One message that carries real numbers is
 * worth more than five that say "don't forget".
 *
 * Unlike the gap nudges this is NOT conditional on having failed to log —
 * at 06:30 nobody has logged anything yet. It earns its place by being
 * specific instead: what yesterday actually came to, and what today is.
 *
 * @param {object} yesterday  { kcal, weightKg, logged }  — real numbers, or logged:false
 * @param {object|null} todayDay  program day for today, when the program is weekday-scheduled
 * @param {boolean} scheduled     whether the program is weekday-scheduled at all
 */
function buildMorningBody({ yesterday, todayDay, scheduled, weighedToday }) {
  const parts = [];

  // Yesterday first: it is the only part that is genuinely theirs.
  if (yesterday && yesterday.logged) {
    const bits = [];
    if (yesterday.kcal > 0)          bits.push(`${yesterday.kcal.toLocaleString('en-IN')} kcal`);
    if (yesterday.weightKg != null)  bits.push(`${yesterday.weightKg} kg`);
    if (bits.length) parts.push(`Yesterday: ${bits.join(' · ')}`);
  }

  // Today's training. Only when the program actually schedules by weekday —
  // guessing would tell someone to train legs on the wrong morning.
  if (scheduled) {
    parts.push(todayDay && todayDay.day_label
      ? `Today: ${todayDay.day_label}`
      : `Today: rest day`);
  }

  // The ask. Dropped entirely if they have somehow already weighed in, so the
  // message never tells a member to do something they have just done.
  if (!weighedToday) parts.push(`Weigh-in when you're up`);

  // Sections join with a full stop, NOT ' · '. Day labels already contain a
  // middot ("Push · Mon"), so a middot separator produced
  // "1,780 kcal · 78.4 kg · Today: Push · Mon · Weigh-in" — four dots of equal
  // weight and no way to see where one fact ends and the next begins.
  return parts.join('. ') + (parts.length ? '.' : '');
}

/**
 * The three template variables for the WhatsApp morning nudge.
 *
 *     Good morning {{1}}. {{2}} Today: {{3}}. Log your weigh-in when you're up.
 *
 * A business-initiated WhatsApp message must match a template Meta approved in
 * advance — free text outside a service window gets the number BANNED, not
 * merely rejected. That is why the push copy and this cannot share a builder:
 * the push version drops whole clauses when they do not apply, and
 * **Meta rejects an empty parameter**. Every slot here always has content.
 *
 * @returns {[string, string, string]}
 */
function buildMorningParams({ name, yesterday, todayDay, scheduled }) {
  const who = firstNameOr(name, 'there');

  let yLine;
  if (yesterday && yesterday.logged) {
    const bits = [];
    if (yesterday.kcal > 0)         bits.push(`${yesterday.kcal.toLocaleString('en-IN')} kcal`);
    if (yesterday.weightKg != null) bits.push(`${yesterday.weightKg} kg`);
    yLine = bits.length ? `Yesterday: ${bits.join(', ')}.` : 'Nothing logged yesterday.';
  } else {
    yLine = 'Nothing logged yesterday.';
  }

  // Never empty, and never claims a rest day for a program that is not
  // weekday-scheduled — see services/programDay.js for why that matters.
  let tLine;
  if (scheduled) tLine = todayDay && todayDay.day_label ? todayDay.day_label : 'rest day';
  else           tLine = 'your usual plan';

  return [who, yLine, tLine];
}

/** firstName(), but never returns '' — an empty template slot is rejected. */
function firstNameOr(name, fallback) {
  const { firstName } = require('./personName');
  const f = firstName(name, '');
  return f && f.trim() ? f.trim() : fallback;
}

/**
 * Composes today's morning message for a set of members WITHOUT sending it.
 *
 * The coach screen uses this to hand Sachin a ready-to-send WhatsApp message
 * per member while the Meta template is still awaiting approval. It runs the
 * same query and the same builders the 06:30 cron does, so the manual message
 * and the automatic one can never say different things — the alternative was
 * a second copy of this logic in a route, which is how the weekday matching
 * came to have three implementations and two answers.
 *
 * @param {string} istDate
 * @param {number[]} memberIds
 * @returns {Promise<Array<{id, name, phone, message, already_sent, opted_out}>>}
 */
async function composeMorningMessages(istDate, memberIds) {
  const { preferences } = require('./messaging');
  const { deriveTodayDay } = require('./programDay');
  if (!memberIds || !memberIds.length) return [];

  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.phone,
            y.food_items      AS y_food,
            y.weight_kg       AS y_weight,
            (y.patient_id IS NOT NULL) AS y_logged,
            (t.weight_kg IS NOT NULL)  AS weighed_today,
            wp.id             AS program_id
     FROM users u
     LEFT JOIN daily_logs y ON y.patient_id = u.id AND y.log_date = ($1::date - 1)
     LEFT JOIN daily_logs t ON t.patient_id = u.id AND t.log_date = $1::date
     LEFT JOIN workout_programs wp ON wp.patient_id = u.id AND wp.active = true
     WHERE u.id = ANY($2::int[]) AND u.role = 'patient' AND u.active = true
     ORDER BY u.name`, [istDate, memberIds]);

  const out = [];
  for (const m of rows) {
    let scheduled = false, todayDay = null;
    if (m.program_id) {
      const { rows: dayRows } = await pool.query(
        `SELECT DISTINCT day_number, day_label
         FROM program_exercises WHERE program_id = $1 ORDER BY day_number`, [m.program_id]);
      ({ scheduled, todayDay } = deriveTodayDay(dayRows, istDate));
    }

    const totals = computeDayTotals(m.y_food);
    const yesterday = {
      logged:   m.y_logged === true,
      kcal:     totals.cal,
      weightKg: m.y_weight != null ? Number(m.y_weight) : null,
    };

    // The manual send goes from Sachin's own WhatsApp, not the Business API,
    // so it is NOT bound by template rules. It can therefore use the fuller
    // push copy — which drops clauses that do not apply — rather than the
    // always-filled template slots.
    const body = buildMorningBody({
      yesterday, todayDay, scheduled, weighedToday: m.weighed_today === true,
    });

    const prefs = await preferences(m.id);
    out.push({
      id: m.id,
      name: m.name,
      phone: m.phone,
      first_name: firstNameOr(m.name, 'there'),
      message: body ? `Good morning, ${firstNameOr(m.name, 'there')}. ${body}` : '',
      already_sent: await alreadyAttemptedToday(m.id, 'morning_nudge', istDate),
      opted_out: prefs.optedOut === true,

      // The raw pieces, so a caller that needs to SEND rather than display —
      // the coach AI chat — can build the WhatsApp template parameters from
      // the same facts instead of trying to parse them back out of the
      // finished sentence.
      body,
      yesterday,
      todayDay,
      scheduled,
    });
  }
  return out;
}

/**
 * Sends the morning nudge to every active member.
 *
 * Deduped per member per IST day in notifications_log, like every other
 * proactive message here. Opt-outs and channel preferences are honoured
 * through messaging.preferences() — a member who turned notifications off
 * gets nothing, and that is checked BEFORE anything is composed.
 */
async function sendMorningNudges(istDate) {
  const { preferences, sendWhatsApp } = require('./messaging');
  const push = require('./pushService');
  const { deriveTodayDay } = require('./programDay');

  // Yesterday's numbers, today's weigh-in state, and the member's active
  // program in one pass. LEFT JOINs throughout: a member with no log
  // yesterday and no program must still appear, and still get a message.
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.phone,
            y.food_items      AS y_food,
            y.weight_kg       AS y_weight,
            (y.patient_id IS NOT NULL) AS y_logged,
            (t.weight_kg IS NOT NULL)  AS weighed_today,
            wp.id             AS program_id
     FROM users u
     LEFT JOIN daily_logs y ON y.patient_id = u.id AND y.log_date = ($1::date - 1)
     LEFT JOIN daily_logs t ON t.patient_id = u.id AND t.log_date = $1::date
     LEFT JOIN workout_programs wp ON wp.patient_id = u.id AND wp.active = true
     WHERE u.role = 'patient' AND u.active = true`, [istDate]);

  let sent = 0;
  for (const m of rows) {
    if (await alreadyAttemptedToday(m.id, 'morning_nudge', istDate)) continue;
    const prefs = await preferences(m.id);
    // Opt-out is absolute. But a member with push disabled is no longer
    // skipped outright — WhatsApp is now the primary channel, and requiring
    // push here would have silently excluded exactly the members this change
    // is meant to reach (iPhone users who never installed to the home screen).
    if (prefs.optedOut) continue;
    if (!prefs.push && !prefs.whatsapp) continue;

    // Program days, only for members who have a program at all.
    let scheduled = false, todayDay = null;
    if (m.program_id) {
      const { rows: dayRows } = await pool.query(
        `SELECT DISTINCT day_number, day_label
         FROM program_exercises WHERE program_id = $1
         ORDER BY day_number`, [m.program_id]);
      ({ scheduled, todayDay } = deriveTodayDay(dayRows, istDate));
    }

    const totals = computeDayTotals(m.y_food);
    const yesterdayFacts = {
      logged:   m.y_logged === true,
      kcal:     totals.cal,
      weightKg: m.y_weight != null ? Number(m.y_weight) : null,
    };
    const body = buildMorningBody({
      yesterday: yesterdayFacts, todayDay, scheduled,
      weighedToday: m.weighed_today === true,
    });

    // Nothing worth saying — no yesterday, no program, already weighed in.
    // Silence beats "Good morning" on its own.
    if (!body) continue;

    const title = `Good morning, ${firstNameOr(m.name, 'there')}`;

    // WhatsApp first, push as the fallback.
    //
    // Deliberately NOT messaging.notify(): that chain tries push FIRST and
    // stops at the first success, which is the opposite order for this
    // message. It also refuses to send during quiet hours (default 21:00-07:00
    // IST) — and 06:30 is inside that window, so routing this through notify()
    // would silently send nothing at all, every day, with no error.
    //
    // Quiet hours exist to stop unscheduled nudges landing at a bad moment.
    // This one IS the schedule, chosen deliberately, so it is exempt.
    let ok = false, channel = null;

    const wa = await sendWhatsApp(m.phone, 'morning',
      buildMorningParams({ name: m.name, yesterday: yesterdayFacts, todayDay, scheduled }));
    if (wa.ok) { ok = true; channel = 'whatsapp'; }

    // Falls through whenever WhatsApp is not configured yet (before Meta
    // approval lands) or a single send fails. Members keep getting the message
    // either way, and the switch to WhatsApp needs no code change — only the
    // WHATSAPP_TOKEN / WHATSAPP_PHONE_ID env vars.
    if (!ok && prefs.push) {
      try { await push.sendToUser(m.id, title, body, 'morning_nudge'); ok = true; channel = 'push'; }
      catch { /* logged as failed below */ }
    }

    await logSent(m.id, 'morning_nudge', title, body, ok);
    if (ok) sent++;
    void channel;
  }
  return sent;
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

    let milestones = [];
    try {
      const { loadCoachMemberStats } = require('./milestones');
      milestones = (await loadCoachMemberStats({ id: c.id, role: 'monitor' }))
        .filter(s => s.milestones.length)
        .map(s => ({ name: s.name, text: s.milestones[0] }));
    } catch (e) { console.error('digest milestones unavailable:', e.message); }

    const body = buildDigestBody({
      total: members.length,
      loggedYesterday: members.filter(m => m.logged_yesterday).length,
      silent,
      milestones,
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
                   buildMorningBody, buildMorningParams, sendMorningNudges, alreadyAttemptedToday,
                   composeMorningMessages, logSent,
                   sendEveningRecaps, sendCoachDigests, alreadySentToday };
