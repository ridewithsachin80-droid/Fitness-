const cron        = require('node-cron');
const pool        = require('../db/pool');
const pushService = require('./pushService');

// ── IST helpers ──────────────────────────────────────────────────────────────
function getISTDate() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
}

function getISTTime() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().substr(11, 5); // "HH:MM"
}

function getISTDateTime() {
  const now = new Date();
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
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

  // Every minute: check if any custom reminder is scheduled for this time
  cron.schedule('* * * * *', async () => {
    try {
      const timeStr = getISTTime(); // "HH:MM"
      const schedules = await getSchedulesForTime(timeStr);

      for (const s of schedules) {
        const scheduledFor = new Date(); // now in UTC = the scheduled moment
        const ackId = await createAckRecord(s.uid, s.type, scheduledFor);
        if (ackId) {
          await sendReminder(s.uid, s.type, 0, ackId);
          console.log(`📢 Reminder sent: ${s.type} → patient ${s.uid} at ${timeStr} IST`);
        }
      }
    } catch (err) {
      console.error('Reminder scheduler error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Every minute: check for unacknowledged reminders needing retry
  cron.schedule('* * * * *', async () => {
    try {
      const pending = await getPendingRetries();
      for (const r of pending) {
        await sendReminder(r.patient_id, r.type, r.retry_count, r.id);
        console.log(`🔁 Retry ${r.retry_count + 1} for ${r.type} → patient ${r.patient_id}`);
      }
    } catch (err) {
      console.error('Retry scheduler error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // Daily at midnight IST: clean up old ack records (older than 7 days)
  cron.schedule('0 0 * * *', async () => {
    await pool.query(
      `DELETE FROM reminder_acks WHERE scheduled_for < NOW() - INTERVAL '7 days'`
    );
    console.log('🧹 Cleaned old reminder acks');
  }, { timezone: 'Asia/Kolkata' });

  // All reminders are now fully dynamic — configured by admin via reminder_schedules table

  console.log('⏰ Cron jobs registered (IST timezone)');
}

module.exports = { start };
