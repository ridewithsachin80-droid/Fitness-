const cron = require('node-cron');
const pool = require('../db/pool');
const pushService = require('./pushService');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getAllPatientIds() {
  const result = await pool.query(
    "SELECT id FROM users WHERE role = 'patient' AND active = true"
  );
  return result.rows.map((r) => r.id);
}

// ── Cron jobs ────────────────────────────────────────────────────────────────
// All times are IST (Asia/Kolkata).
// Full job implementations are in Sprint 5 (cronService.js — complete).
// These stubs are registered so the server starts without errors.

function start() {
  // 6:25 AM — Morning weight reminder
  cron.schedule('25 6 * * *', async () => {
    const ids = await getAllPatientIds();
    for (const id of ids) {
      await pushService.sendToUser(
        id,
        'Good Morning! Step on the scale',
        'Log your weight after washroom — before food or water.',
        'weight'
      );
    }
  }, { timezone: 'Asia/Kolkata' });

  // 9:40 AM — ACV before Meal 1
  cron.schedule('40 9 * * *', async () => {
    const ids = await getAllPatientIds();
    for (const id of ids) {
      await pushService.sendToUser(
        id,
        'ACV Time — Meal 1',
        '1 tbsp in 200ml warm water through a straw. 15 min before breakfast.',
        'acv'
      );
    }
  }, { timezone: 'Asia/Kolkata' });

  // 1:15 PM — ACV before Meal 2
  cron.schedule('15 13 * * *', async () => {
    const ids = await getAllPatientIds();
    for (const id of ids) {
      await pushService.sendToUser(id, 'ACV Time — Meal 2', 'Take ACV now — 15 min before lunch.', 'acv');
    }
  }, { timezone: 'Asia/Kolkata' });

  // 5:15 PM — ACV before Meal 3
  cron.schedule('15 17 * * *', async () => {
    const ids = await getAllPatientIds();
    for (const id of ids) {
      await pushService.sendToUser(id, 'ACV Time — Meal 3', 'Last ACV of the day — 15 min before dinner.', 'acv');
    }
  }, { timezone: 'Asia/Kolkata' });

  // 2:00 PM — Water check (only nudge if below halfway)
  cron.schedule('0 14 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
    const ids = await getAllPatientIds();
    for (const id of ids) {
      const log = await pool.query(
        'SELECT water_ml FROM daily_logs WHERE patient_id = $1 AND log_date = $2',
        [id, today]
      );
      const water = log.rows[0]?.water_ml || 0;
      if (water < 1500) {
        await pushService.sendToUser(
          id,
          'Drink Water!',
          `Only ${(water / 1000).toFixed(1)}L so far. Target is 3L — keep sipping!`,
          'water'
        );
      }
    }
  }, { timezone: 'Asia/Kolkata' });

  // 8:00 PM — Alert monitor if patient hasn't logged today
  cron.schedule('0 20 * * *', async () => {
    const today = new Date().toISOString().split('T')[0];
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
      [today]
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
