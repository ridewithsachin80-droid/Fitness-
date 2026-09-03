const cron        = require('node-cron');
const pool        = require('../db/pool');
const pushService = require('./pushService');

// ── IST helpers ──────────────────────────────────────────────────────────────
function getISTDateStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function getISTTime() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().substr(11, 5); // "HH:MM"
}


// ── Reminder config per type ─────────────────────────────────────────────────
const REMINDER_CONFIG = {
  water: {
    title: '💧 Drink Water!',
    body:  (retryCount) => retryCount === 0
      ? 'Time to hydrate — drink a glass of water now!'
      : `⏰ Reminder: You haven\'t logged your water yet. Tap OK when done!`,
  },
  activity: {
    title: '🏃 Move Your Body!',
    body:  (retryCount) => retryCount === 0
      ? 'Time for your physical activity — even a 10 min walk counts!'
      : `⏰ Reminder: Activity reminder — tap OK when you\'re done!`,
  },
  weight: {
    title: '⚖️ Log Your Weight',
    body:  (retryCount) => retryCount === 0
      ? 'Step on the scale after washroom — before food or water!'
      : `⏰ Reminder: Log your morning weight — tap OK when done!`,
  },
  acv: {
    title: '🍎 ACV Time!',
    body:  (retryCount) => retryCount === 0
      ? '1 tbsp in 200ml warm water through a straw — 15 min before your meal.'
      : `⏰ Reminder: Take your ACV now — tap OK when done!`,
  },
};

// ── getSchedulesForTime ──────────────────────────────────────────────────────
// Returns {patientId, type, maxRetries, retryIntervalMin} for reminders
// scheduled at the given HH:MM IST time
async function getSchedulesForTime(timeStr) {
  const result = await pool.query(
    `SELECT rs.patient_id, rs.type, rs.max_retries, rs.retry_interval_min,
            u.id AS uid
     FROM reminder_schedules rs
     CROSS JOIN LATERAL (
       SELECT id FROM users
       WHERE role = 'patient' AND active = true
         AND (rs.patient_id IS NULL OR rs.patient_id = id)
     ) u
     WHERE rs.active = true
       AND $1 = ANY(rs.times)`,
    [timeStr]
  );
  return result.rows;
}

// ── createAckRecord ──────────────────────────────────────────────────────────
async function createAckRecord(patientId, type, scheduledFor) {
  const result = await pool.query(
    `INSERT INTO reminder_acks (patient_id, type, scheduled_for, sent_at, retry_count, acked)
     VALUES ($1, $2, $3, NOW(), 0, false)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [patientId, type, scheduledFor]
  );
  return result.rows[0]?.id;
}

// ── getPendingRetries ────────────────────────────────────────────────────────
// Find unacknowledged reminders that need a retry now
async function getPendingRetries() {
  const result = await pool.query(
    `SELECT ra.id, ra.patient_id, ra.type, ra.scheduled_for,
            ra.retry_count, ra.sent_at,
            COALESCE(rs.max_retries, 3) AS max_retries,
            COALESCE(rs.retry_interval_min, 5) AS retry_interval_min
     FROM reminder_acks ra
     LEFT JOIN reminder_schedules rs
       ON rs.type = ra.type
      AND (rs.patient_id = ra.patient_id OR rs.patient_id IS NULL)
     WHERE ra.acked = false
       AND ra.retry_count < COALESCE(rs.max_retries, 3)
       AND ra.sent_at < NOW() - (COALESCE(rs.retry_interval_min, 5) || ' minutes')::INTERVAL
     ORDER BY ra.sent_at ASC`
  );
  return result.rows;
}

// ── sendReminder ─────────────────────────────────────────────────────────────
async function sendReminder(patientId, type, retryCount, ackId) {
  const config = REMINDER_CONFIG[type];
  if (!config) return;

  await pushService.sendToUser(
    patientId,
    config.title,
    config.body(retryCount),
    type,
    { ackId, requiresAck: true }   // extra data so client knows to show OK button
  );

  if (ackId) {
    await pool.query(
      `UPDATE reminder_acks SET retry_count = retry_count + 1, sent_at = NOW()
       WHERE id = $1`,
      [ackId]
    );
  }
}

// ── Cron jobs ────────────────────────────────────────────────────────────────
function start() {

  // Every minute: send scheduled reminders + process retries (merged into one job)
  cron.schedule('* * * * *', async () => {
    try {
      const timeStr = getISTTime();

      // 1. Send new reminders scheduled for this minute
      const schedules = await getSchedulesForTime(timeStr);
      for (const s of schedules) {
        const ackId = await createAckRecord(s.uid, s.type, new Date());
        if (ackId) {
          await sendReminder(s.uid, s.type, 0, ackId);
          console.log(`📢 Reminder: ${s.type} → member ${s.uid} at ${timeStr} IST`);
        }
      }

      // 2. Retry unacknowledged reminders
      const pending = await getPendingRetries();
      for (const r of pending) {
        await sendReminder(r.patient_id, r.type, r.retry_count, r.id);
        console.log(`🔁 Retry ${r.retry_count + 1}/${r.max_retries} for ${r.type} → patient ${r.patient_id}`);
      }
    } catch (err) {
      console.error('Cron error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // 06:30 IST: the one daily prompt to log. Carries yesterday's real numbers
  // and today's program day, so it is worth reading rather than being a
  // generic "don't forget". Deduped per member per day in notifications_log.
  //
  // This replaced a plan for FIVE scheduled reminders a day (weight, activity,
  // and one per meal). Five is how members mute the app — and a muted app also
  // loses the evening recap and the coach's messages.
  cron.schedule('30 6 * * *', async () => {
    try {
      const { sendMorningNudges } = require('./digests');
      const n = await sendMorningNudges(getISTDateStr());
      if (n) console.log(`\u2600\ufe0f  Morning nudge sent to ${n} member(s)`);
    } catch (err) { console.error('Morning nudge error:', err.message); }
  }, { timezone: 'Asia/Kolkata' });

  // 20:30 IST: evening recap for members who logged today — real numbers,
  // never a generic nudge. Deduped per member per day in notifications_log.
  cron.schedule('30 20 * * *', async () => {
    try {
      const { sendEveningRecaps } = require('./digests');
      const n = await sendEveningRecaps(getISTDateStr());
      if (n) console.log(`🌙 Evening recap sent to ${n} member(s)`);
    } catch (err) { console.error('Evening recap error:', err.message); }
  }, { timezone: 'Asia/Kolkata' });

  // 08:00 IST: coach morning digest — who logged yesterday, who has gone quiet.
  cron.schedule('0 8 * * *', async () => {
    try {
      const { sendCoachDigests } = require('./digests');
      const n = await sendCoachDigests(getISTDateStr());
      if (n) console.log(`☀️ Morning digest sent to ${n} coach(es)`);
    } catch (err) { console.error('Coach digest error:', err.message); }
  }, { timezone: 'Asia/Kolkata' });

  // Sunday 18:00 IST: weekly progress reports — the premium ritual. Deduped
  // per member per week inside the service; empty weeks produce nothing.
  cron.schedule('0 18 * * 0', async () => {
    try {
      const { sendWeeklyReports } = require('./weeklyReport');
      const n = await sendWeeklyReports(getISTDateStr());
      if (n) console.log(`📊 Weekly reports sent to ${n} member(s)`);
    } catch (err) { console.error('Weekly report error:', err.message); }
  }, { timezone: 'Asia/Kolkata' });

  // 00:10 IST: did yesterday's nudges land? Marks each gap nudge from the last
  // 48h as responded if the member saved a log after it. Runs before the
  // cleanup below so it never races it.
  cron.schedule('10 0 * * *', async () => {
    try {
      const { reconcileResponses } = require('./nudgeTracking');
      const { checked, matched } = await reconcileResponses();
      if (checked) console.log(`📨 Nudges: ${matched} of ${checked} open ones were followed by a log`);
    } catch (err) { console.error('Nudge reconciliation error:', err.message); }
  }, { timezone: 'Asia/Kolkata' });

  // Daily at midnight IST: clean up old records
  cron.schedule('0 0 * * *', async () => {
    try {
      // Delete old reminder acks (older than 7 days)
      const r1 = await pool.query(
        `DELETE FROM reminder_acks WHERE scheduled_for < NOW() - INTERVAL '7 days'`
      );
      // Delete old notification logs — prevents unbounded growth.
      //
      // Coach nudges are exempt for 180 days. The effectiveness dashboard needs
      // 20 sends in a bucket before it will quote a rate, and on a roster this
      // size a 30-day window would delete the evidence faster than it
      // accumulates — the dashboard would sit on "not enough data yet" forever
      // while the rows quietly aged out behind it. Nudges are a handful a day,
      // not the push volume this sweep was written for, so the longer retention
      // costs nothing.
      const r2 = await pool.query(
        `DELETE FROM notifications_log
          WHERE (gap_key IS NULL     AND sent_at < NOW() - INTERVAL '30 days')
             OR (gap_key IS NOT NULL AND sent_at < NOW() - INTERVAL '180 days')`
      );
      console.log(`🧹 Cleanup: ${r1.rowCount} acks, ${r2.rowCount} notif logs deleted`);
    } catch (err) {
      console.error('Cleanup error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // All reminders are now fully dynamic — configured by admin via reminder_schedules table

  console.log('⏰ Cron jobs registered (IST timezone)');
}

module.exports = { start };
