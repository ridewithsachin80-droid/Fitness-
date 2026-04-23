const router = require('express').Router();
const pool = require('../db/pool');
const authMW = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');

// ── Compliance calculator ────────────────────────────────────────────────────
// Total possible: 6 activities + 3 ACV + 7 supplements = 16
const TOTAL_CHECKABLE = 16;

function calcCompliance(activities = {}, acv = {}, supplements = {}) {
  const actDone  = Object.values(activities).filter(Boolean).length;
  const acvDone  = Object.values(acv).filter(Boolean).length;
  const suppDone = Object.values(supplements).filter(Boolean).length;
  return Math.round(((actDone + acvDone + suppDone) / TOTAL_CHECKABLE) * 100);
}

// ── GET /api/logs/:date ──────────────────────────────────────────────────────
// Returns the log for the given YYYY-MM-DD date.
// Patients: always their own log.
// Monitors/admins: pass ?patientId=X to view a specific patient.
router.get('/:date', authMW, async (req, res) => {
  try {
    const { date } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const patientId =
      req.user.role === 'patient'
        ? req.user.id
        : req.query.patientId;

    if (!patientId) {
      return res.status(400).json({ error: 'patientId query param required for monitors' });
    }

    const result = await pool.query(
      'SELECT * FROM daily_logs WHERE patient_id = $1 AND log_date = $2',
      [patientId, date]
    );

    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('GET /logs/:date error:', err);
    res.status(500).json({ error: 'Failed to fetch log' });
  }
});

// ── POST /api/logs/:date ─────────────────────────────────────────────────────
// Upsert (insert or update) the daily log for a patient.
// Only the patient themselves can save their own log.
router.post('/:date', authMW, roleCheck('patient'), async (req, res) => {
  try {
    const { date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    // Block future dates
    const today = new Date().toISOString().split('T')[0];
    if (date > today) {
      return res.status(400).json({ error: 'Cannot log future dates' });
    }

    const {
      weight_kg,
      activities   = {},
      acv          = {},
      food_items   = [],
      water_ml     = 0,
      supplements  = {},
      sleep        = {},
      notes        = '',
    } = req.body;

    const compliance_pct = calcCompliance(activities, acv, supplements);
    const patientId = req.user.id;

    const result = await pool.query(
      `INSERT INTO daily_logs
         (patient_id, log_date, weight_kg, activities, acv,
          food_items, water_ml, supplements, sleep, notes,
          compliance_pct, saved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (patient_id, log_date) DO UPDATE SET
         weight_kg      = EXCLUDED.weight_kg,
         activities     = EXCLUDED.activities,
         acv            = EXCLUDED.acv,
         food_items     = EXCLUDED.food_items,
         water_ml       = EXCLUDED.water_ml,
         supplements    = EXCLUDED.supplements,
         sleep          = EXCLUDED.sleep,
         notes          = EXCLUDED.notes,
         compliance_pct = EXCLUDED.compliance_pct,
         saved_at       = NOW()
       RETURNING *`,
      [
        patientId,
        date,
        weight_kg || null,
        JSON.stringify(activities),
        JSON.stringify(acv),
        JSON.stringify(food_items),
        water_ml,
        JSON.stringify(supplements),
        JSON.stringify(sleep),
        notes,
        compliance_pct,
      ]
    );

    const saved = result.rows[0];

    // Real-time: notify the monitor watching this patient
    req.io
      .to(`monitor_${patientId}`)
      .emit('log_updated', {
        patientId,
        date,
        compliance: compliance_pct,
        weight_kg: saved.weight_kg,
      });

    res.json(saved);
  } catch (err) {
    console.error('POST /logs/:date error:', err);
    res.status(500).json({ error: 'Failed to save log' });
  }
});

// ── GET /api/logs/range/:from/:to ─────────────────────────────────────────────
// Returns logs between two YYYY-MM-DD dates (inclusive), ordered newest first.
// Used for the weight chart and monitor history view.
router.get('/range/:from/:to', authMW, async (req, res) => {
  try {
    const { from, to } = req.params;

    const patientId =
      req.user.role === 'patient'
        ? req.user.id
        : req.query.patientId;

    if (!patientId) {
      return res.status(400).json({ error: 'patientId query param required for monitors' });
    }

    const result = await pool.query(
      `SELECT * FROM daily_logs
       WHERE patient_id = $1 AND log_date BETWEEN $2 AND $3
       ORDER BY log_date DESC`,
      [patientId, from, to]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('GET /logs/range error:', err);
    res.status(500).json({ error: 'Failed to fetch log range' });
  }
});

module.exports = router;
