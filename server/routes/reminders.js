const router  = require('express').Router();
const pool    = require('../db/pool');
const authMW  = require('../middleware/auth');

router.use(authMW);

// ── GET /api/reminders/schedules ─────────────────────────────────────────────
// Admin: get all reminder schedules (global + per-patient)
router.get('/schedules', async (req, res) => {
  if (!['admin', 'monitor'].includes(req.user.role))
    return res.status(403).json({ error: 'Forbidden' });

  try {
    const result = await pool.query(
      `SELECT rs.*, u.name AS patient_name
       FROM reminder_schedules rs
       LEFT JOIN users u ON u.id = rs.patient_id
       ORDER BY rs.patient_id NULLS FIRST, rs.type`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /reminders/schedules error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/reminders/schedules ────────────────────────────────────────────
// Admin: create or update a reminder schedule
// Body: { patient_id (optional), type, times, max_retries, retry_interval_min }
router.post('/schedules', async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });

  const { patient_id, type, times, max_retries = 3, retry_interval_min = 5 } = req.body;

  if (!type || !times?.length)
    return res.status(400).json({ error: 'type and times required' });

  if (!['water', 'activity', 'weight', 'acv'].includes(type))
    return res.status(400).json({ error: 'type must be water, activity, weight or acv' });

  try {
    const result = await pool.query(
      `INSERT INTO reminder_schedules
         (patient_id, type, times, max_retries, retry_interval_min, active, created_by)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       ON CONFLICT (patient_id, type) DO UPDATE SET
         times              = EXCLUDED.times,
         max_retries        = EXCLUDED.max_retries,
         retry_interval_min = EXCLUDED.retry_interval_min,
         active             = true,
         updated_at         = NOW()
       RETURNING *`,
      [patient_id || null, type, times, max_retries, retry_interval_min, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/reminders/schedules/:id ──────────────────────────────────────
router.delete('/schedules/:id', async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });

  await pool.query('UPDATE reminder_schedules SET active = false WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
});

// ── POST /api/reminders/ack ───────────────────────────────────────────────────
// Client taps OK → acknowledge the reminder, stop retries
router.post('/ack', async (req, res) => {
  const { ack_id } = req.body;
  if (!ack_id) return res.status(400).json({ error: 'ack_id required' });

  try {
    await pool.query(
      `UPDATE reminder_acks SET acked = true, acked_at = NOW()
       WHERE id = $1 AND patient_id = $2`,
      [ack_id, req.user.id]
    );
    res.json({ acked: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/reminders/test ──────────────────────────────────────────────────
// Admin: send a test reminder to a patient immediately
router.post('/test', async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });

  const { patient_id, type } = req.body;
  if (!patient_id || !type) return res.status(400).json({ error: 'patient_id and type required' });

  try {
    const pushService = require('../services/pushService');
    await pushService.sendToUser(
      patient_id,
      { water: '💧 Drink Water!', activity: '🏃 Move Your Body!', weight: '⚖️ Log Your Weight', acv: '🍎 ACV Time!' }[type] || '🔔 Reminder',
      `This is a test ${type} reminder — tap OK to acknowledge!`,
      type,
      { ackId: null, requiresAck: true, isTest: true }
    );
    res.json({ sent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
