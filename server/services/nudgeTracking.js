/**
 * nudgeTracking.js — did the nudge work? (Sprint L2)
 *
 * The gap detector decides who needs chasing and writes the message. Until now
 * that was the end of it: nobody recorded whether the member logged afterwards,
 * so every threshold in gapDetector.js — 3 days dormant, water flagged after
 * 6pm, dinner after 9pm — is a reasonable guess that has never been checked
 * against whether anybody actually responded.
 *
 * Three pieces:
 *   recordNudge()          one row per message sent, tagged with its leading gap
 *   reconcileResponses()   nightly: did they log in the 48h after it?
 *   effectiveness()        response rate by gap type, hour and channel
 *
 * ── WHAT "RESPONDED" MEANS, EXACTLY ─────────────────────────────────────────
 * The member saved a daily log strictly after the message went out and within
 * 48 hours. That is all it means. It is not proof the nudge caused anything —
 * they may have been about to log anyway, and a member who reads the message
 * and goes for a walk without logging counts as no response. It is a
 * correlation with a clear definition, and the UI says so rather than calling
 * it "effectiveness" and leaving people to assume causation.
 *
 * ── THE RULE THAT MATTERS ───────────────────────────────────────────────────
 * Below MIN_BUCKET sends, report "not enough data yet" rather than a
 * percentage. Two responses out of three is not 67%. This app already refuses
 * to claim thin effects in the adaptive engine and the learning model; a nudge
 * dashboard showing confident percentages off five data points would undo that
 * credibility everywhere else. The threshold lives here, in one place, and the
 * API returns the verdict rather than a number the client has to know how to
 * distrust.
 */

const pool = require('../db/pool');

/** Below this many sends in a bucket, we do not quote a rate. */
const MIN_BUCKET = 20;

/** How long after a message a log still counts as a response. */
const RESPONSE_WINDOW_HOURS = 48;

const NUDGE_TYPE = 'coach_nudge';

/**
 * A user id, or null.
 *
 * `Number.isFinite(+null)` is TRUE, because null coerces to 0. Used as a guard
 * that reads correctly, it lets a missing id through as user 0 — which here
 * meant an admin's dashboard silently scoped itself to `sent_by = 0` and
 * reported that nobody had ever sent a nudge. One helper, so the mistake cannot
 * be made again in the next place an id is checked.
 */
function toId(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Record that a coach sent a gap nudge.
 * @param {object} a
 * @param {number} a.memberId
 * @param {number} a.coachId
 * @param {string} a.gapKey    the LEADING gap — why the coach opened the message
 * @param {string} a.channel   'whatsapp' | 'sms'
 * @param {string} [a.body]
 * @returns {Promise<number|null>} the row id, or null if it could not be stored
 */
async function recordNudge({ memberId, coachId, gapKey, channel, body = '' }) {
  const key = String(gapKey || '').trim().slice(0, 30);
  const ch  = ['whatsapp', 'sms'].includes(channel) ? channel : null;
  const mid = toId(memberId);
  if (!mid || !key || !ch) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO notifications_log (user_id, type, title, body, gap_key, channel, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [mid, NUDGE_TYPE, 'Coach nudge', String(body || '').slice(0, 2000),
       key, ch, toId(coachId)]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    // A failure to record must never stop a coach messaging a member.
    console.error('recordNudge failed:', err.message);
    return null;
  }
}

/**
 * Nightly: mark the nudges that were followed by a log.
 *
 * Only touches rows where responded_at IS NULL, so it is idempotent and a
 * second run in the same night changes nothing. Only looks at the last 48h,
 * because past that the window has closed and the answer will not change.
 *
 * @returns {Promise<{checked:number, matched:number}>}
 */
async function reconcileResponses() {
  try {
    const { rows: [before] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM notifications_log
        WHERE gap_key IS NOT NULL AND responded_at IS NULL
          AND sent_at > NOW() - INTERVAL '${RESPONSE_WINDOW_HOURS} hours'`);

    const { rows } = await pool.query(
      `UPDATE notifications_log n
          SET responded_at = sub.saved_at
         FROM (
           SELECT nl.id, MIN(dl.saved_at) AS saved_at
             FROM notifications_log nl
             JOIN daily_logs dl
               ON dl.patient_id = nl.user_id
              AND dl.saved_at > nl.sent_at
              AND dl.saved_at <= nl.sent_at + INTERVAL '${RESPONSE_WINDOW_HOURS} hours'
            WHERE nl.gap_key IS NOT NULL
              AND nl.responded_at IS NULL
              AND nl.sent_at > NOW() - INTERVAL '${RESPONSE_WINDOW_HOURS} hours'
            GROUP BY nl.id
         ) sub
        WHERE n.id = sub.id
    RETURNING n.id`);

    return { checked: before?.n || 0, matched: rows.length };
  } catch (err) {
    console.error('reconcileResponses failed:', err.message);
    return { checked: 0, matched: 0 };
  }
}

/**
 * Turn raw counts into something safe to put on a screen.
 * Never returns a rate below MIN_BUCKET — the caller cannot accidentally
 * render one, because there is no number there to render.
 */
function summarise(label, sent, responded) {
  const enough = sent >= MIN_BUCKET;
  return {
    label,
    sent,
    responded,
    enough_data: enough,
    // null, not 0 — a missing rate and a zero rate are different claims, and
    // the whole point of this sprint is not to confuse them.
    rate_pct: enough ? Math.round((responded / sent) * 100) : null,
    note: enough ? null : `only ${sent} sent so far — need ${MIN_BUCKET} to say anything`,
  };
}

/**
 * Response rates broken down three ways.
 * @param {object} opts
 * @param {number} [opts.coachId]  restrict to one coach's own sends
 * @param {number} [opts.days=90]
 */
async function effectiveness({ coachId = null, days = 90 } = {}) {
  const params = [days];
  let scope = '';
  const cid = toId(coachId);
  if (cid) {
    params.push(cid);
    scope = ` AND sent_by = $${params.length}`;
  }

  const base = `FROM notifications_log
                 WHERE gap_key IS NOT NULL
                   AND sent_at > NOW() - ($1 || ' days')::interval${scope}`;

  const [byGap, byHour, byChannel, totals] = await Promise.all([
    pool.query(
      `SELECT gap_key AS bucket, COUNT(*)::int AS sent,
              COUNT(responded_at)::int AS responded
       ${base} GROUP BY gap_key ORDER BY sent DESC`, params),
    pool.query(
      // Bucketed in IST, because "the 6pm water nudge" is a statement about
      // the member's evening, not about UTC.
      `SELECT EXTRACT(HOUR FROM sent_at AT TIME ZONE 'Asia/Kolkata')::int AS bucket,
              COUNT(*)::int AS sent, COUNT(responded_at)::int AS responded
       ${base} GROUP BY 1 ORDER BY 1`, params),
    pool.query(
      `SELECT channel AS bucket, COUNT(*)::int AS sent,
              COUNT(responded_at)::int AS responded
       ${base} GROUP BY channel ORDER BY sent DESC`, params),
    pool.query(
      `SELECT COUNT(*)::int AS sent, COUNT(responded_at)::int AS responded ${base}`, params),
  ]);

  const map = (rows, fmt = String) =>
    rows.map(r => summarise(fmt(r.bucket), r.sent, r.responded));

  return {
    window_days: days,
    min_bucket: MIN_BUCKET,
    response_window_hours: RESPONSE_WINDOW_HOURS,
    overall: summarise('all nudges', totals.rows[0].sent, totals.rows[0].responded),
    by_gap:     map(byGap.rows),
    by_hour:    map(byHour.rows, h => `${h}:00`),
    by_channel: map(byChannel.rows, c => c || 'unknown'),
  };
}

module.exports = {
  recordNudge, toId, reconcileResponses, effectiveness, summarise,
  MIN_BUCKET, RESPONSE_WINDOW_HOURS, NUDGE_TYPE,
};
