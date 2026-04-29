const cron = require('node-cron');
// ── IST date helper ─────────────────────────────────────────────────────────
function getISTDate() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
}


const pool = require('../db/pool');
const pushService = require('./pushService');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getAllPatientIds() {
  const result = await pool.query(
    "SELECT id FROM users WHERE role = 'patient' AND active = true"
  );
  return result.rows.map((r) => r.id);
}

/** Returns patient IDs who have NOT logged anything today */
async function getPatientsNotLoggedToday() {
  const todayStr = getISTDate();
  const result = await pool.query(
    `SELECT id FROM users
     WHERE role = 'patient' AND active = true
       AND id NOT IN (
         SELECT patient_id FROM daily_logs WHERE log_date = $1
       )`,
    [todayStr]
  );
  return result.rows.map((r) => r.id);
}

/**
 * Returns active patients with their water_target from patient_profiles.
 * Only patients who haven't yet reached their target today are returned.
 */
async function getPatientsNeedingWaterNudge() {
  const todayStr = getISTDate();
  const result = await pool.query(
    `SELECT u.id,
            COALESCE(pp.water_target, 3000) AS water_target,
            COALESCE(dl.water_ml, 0)        AS water_ml
     FROM users u
     LEFT JOIN patient_profiles pp ON pp.user_id = u.id
     LEFT JOIN daily_logs dl ON dl.patient_id = u.id AND dl.log_date = $1
     WHERE u.role = 'patient' AND u.active = true`,
    [todayStr]
  );
  // Only nudge if they're below the halfway point of their personal target
  return result.rows.filter(r => r.water_ml < r.water_target / 2);
}

// ── Cron jobs ────────────────────────────────────────────────────────────────
// All times are IST (Asia/Kolkata).

function start() {
  // 6:25 AM — Morning weight reminder (skip if already logged today)
  cron.schedule('25 6 * * *', async () => {
    const ids = await getPatientsNotLoggedToday();
    for (const id of ids) {
      await pushService.sendToUser(
        id,
        'Good Morning! Step on the scale',
        'Log your weight after washroom — before food or water.',
        'weight'
      );
    }
  }, { timezone: 'Asia/Kolkata' });

  // 9:40 AM — ACV before Meal 1 (skip if already logged today)
  cron.schedule('40 9 * * *', async () => {
    const ids = await getPatientsNotLoggedToday();
    for (const id of ids) {
      await pushService.sendToUser(
        id,
        'ACV Time — Meal 1',
        '1 tbsp in 200ml warm water through a straw. 15 min before breakfast.',
        'acv'
      );
    }
  }, { timezone: 'Asia/Kolkata' });

  // 1:15 PM — ACV before Meal 2 (skip if already logged today)
  cron.schedule('15 13 * * *', async () => {
    const ids = await getPatientsNotLoggedToday();
    for (const id of ids) {
      await pushService.sendToUser(id, 'ACV Time — Meal 2', 'Take ACV now — 15 min before lunch.', 'acv');
    }
  }, { timezone: 'Asia/Kolkata' });

  // 5:15 PM — ACV before Meal 3 (skip if already logged today)
  cron.schedule('15 17 * * *', async () => {
    const ids = await getPatientsNotLoggedToday();
    for (const id of ids) {
      await pushService.sendToUser(id, 'ACV Time — Meal 3', 'Last ACV of the day — 15 min before dinner.', 'acv');
    }
  }, { timezone: 'Asia/Kolkata' });

  // 2:00 PM — Water check: nudge only if below half of personal target
  cron.schedule('0 14 * * *', async () => {
    const patients = await getPatientsNeedingWaterNudge();
    for (const p of patients) {
      const targetL = (p.water_target / 1000).toFixed(1);
      const soFarL  = (p.water_ml   / 1000).toFixed(1);
      await pushService.sendToUser(
        p.id,
        'Drink Water!',
        `Only ${soFarL}L so far. Your target is ${targetL}L — keep sipping!`,
        'water'
      );
    }
  }, { timezone: 'Asia/Kolkata' });

  // 8:00 PM — Alert monitor if patient hasn't logged today
  cron.schedule('0 20 * * *', async () => {
    const todayStr = getISTDate();
    const result = await pool.query(
      `SELECT u.id, u.name, mp.monitor_id
       FROM users u
       JOIN monitor_patients mp ON mp.patient_id = u.id
       WHERE u.role = 'patient'
         AND u.active = true
         AND mp.active = true
         AND u.id NOT IN (
           SELECT patient_id FROM daily_logs WHERE log_date = $1
         )`,
      [todayStr]
    );

    for (const patient of result.rows) {
      await pushService.sendToUser(
        patient.monitor_id,
        `${patient.name} hasn't logged today`,
        'No daily log received. You may want to check in.',
        'no_log'
      );
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('⏰ Cron jobs registered (IST timezone)');
}

module.exports = { start };
