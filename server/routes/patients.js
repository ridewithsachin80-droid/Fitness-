const router = require('express').Router();
const pool = require('../db/pool');
const authMW = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const bcrypt = require('bcryptjs');

// ── GET /api/patients ─────────────────────────────────────────────────────────
// Monitor/admin: list all assigned patients with summary stats.
// Returns: name, phone, start/target weight, latest weight, last logged date, compliance.
router.get('/', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.phone,
         pp.height_cm,
         pp.start_weight,
         pp.target_weight,
         pp.conditions,
         (SELECT weight_kg  FROM daily_logs WHERE patient_id = u.id ORDER BY log_date DESC LIMIT 1) AS latest_weight,
         (SELECT log_date   FROM daily_logs WHERE patient_id = u.id ORDER BY log_date DESC LIMIT 1) AS last_logged,
         (SELECT compliance_pct FROM daily_logs WHERE patient_id = u.id ORDER BY log_date DESC LIMIT 1) AS last_compliance
       FROM users u
       JOIN monitor_patients mp ON mp.patient_id = u.id
       JOIN patient_profiles pp ON pp.user_id   = u.id
       WHERE mp.monitor_id = $1
         AND mp.active = true
         AND u.active   = true
       ORDER BY u.name`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('GET /patients error:', err);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// ── GET /api/patients/:id ──────────────────────────────────────────────────────
// Monitor/admin: full patient detail — profile + last 30 logs + all lab values.
// All three queries run in parallel for speed.
router.get('/:id', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Verify this patient is assigned to the requesting monitor
    const linkCheck = await pool.query(
      `SELECT 1 FROM monitor_patients
       WHERE monitor_id = $1 AND patient_id = $2 AND active = true`,
      [req.user.id, id]
    );

    // Admins can see any patient; monitors only see their assigned patients
    if (!linkCheck.rows.length && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Patient not assigned to you' });
    }

    const [profileResult, logsResult, labsResult] = await Promise.all([
      pool.query(
        `SELECT u.id, u.name, u.phone, u.email, u.created_at,
                pp.dob, pp.height_cm, pp.start_weight, pp.target_weight,
                pp.conditions, pp.diet_notes, pp.water_target
         FROM users u
         JOIN patient_profiles pp ON pp.user_id = u.id
         WHERE u.id = $1`,
        [id]
      ),
      pool.query(
        `SELECT * FROM daily_logs
         WHERE patient_id = $1
         ORDER BY log_date DESC
         LIMIT 30`,
        [id]
      ),
      pool.query(
        `SELECT * FROM lab_values
         WHERE patient_id = $1
         ORDER BY test_date DESC`,
        [id]
      ),
    ]);

    if (!profileResult.rows.length) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json({
      profile: profileResult.rows[0],
      logs:    logsResult.rows,
      labs:    labsResult.rows,
    });
  } catch (err) {
    console.error('GET /patients/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch patient details' });
  }
});

// ── POST /api/patients ─────────────────────────────────────────────────────────
// Admin only: create a new patient user, their profile, and optionally link a monitor.
// Uses a transaction so partial failures roll back cleanly.
router.post('/', authMW, roleCheck('admin'), async (req, res) => {
  const {
    name,
    phone,
    height_cm,
    start_weight,
    target_weight,
    conditions = [],
    diet_notes = '',
    water_target = 3000,
    monitorId,
  } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create the user row
    const userResult = await client.query(
      `INSERT INTO users (name, phone, role)
       VALUES ($1, $2, 'patient')
       RETURNING *`,
      [name, phone]
    );
    const newUser = userResult.rows[0];

    // Create patient profile
    await client.query(
      `INSERT INTO patient_profiles
         (user_id, height_cm, start_weight, target_weight, conditions, diet_notes, water_target)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newUser.id,
        height_cm    || null,
        start_weight || null,
        target_weight|| null,
        JSON.stringify(conditions),
        diet_notes,
        water_target,
      ]
    );

    // Optionally link to a monitor
    if (monitorId) {
      await client.query(
        `INSERT INTO monitor_patients (monitor_id, patient_id)
         VALUES ($1, $2)`,
        [monitorId, newUser.id]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      id:    newUser.id,
      name:  newUser.name,
      phone: newUser.phone,
      role:  newUser.role,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A patient with this phone number already exists' });
    }
    console.error('POST /patients error:', err);
    res.status(500).json({ error: 'Failed to create patient' });
  } finally {
    client.release();
  }
});

// ── PATCH /api/patients/:id/profile ───────────────────────────────────────────
// Monitor/admin: update patient profile fields.
router.patch('/:id/profile', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  try {
    const allowed = ['height_cm', 'start_weight', 'target_weight', 'conditions', 'diet_notes', 'water_target'];
    const updates = [];
    const values  = [];
    let idx = 1;

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        values.push(
          field === 'conditions' ? JSON.stringify(req.body[field]) : req.body[field]
        );
      }
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE patient_profiles
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE user_id = $${idx}
       RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('PATCH /patients/:id/profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── POST /api/patients/:id/labs ────────────────────────────────────────────────
// Monitor/admin: add a lab test result for a patient.
// Automatically computes status (low/normal/high) from reference ranges.
router.post('/:id/labs', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  try {
    const { test_date, test_name, value, unit, ref_min, ref_max } = req.body;

    if (!test_date || !test_name || value === undefined) {
      return res.status(400).json({ error: 'test_date, test_name, and value are required' });
    }

    let status = 'normal';
    if (ref_min !== undefined && ref_max !== undefined) {
      if (parseFloat(value) < parseFloat(ref_min))       status = 'low';
      else if (parseFloat(value) > parseFloat(ref_max))  status = 'high';
    }

    const result = await pool.query(
      `INSERT INTO lab_values
         (patient_id, test_date, test_name, value, unit, ref_min, ref_max, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.params.id, test_date, test_name, value, unit, ref_min, ref_max, status]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /patients/:id/labs error:', err);
    res.status(500).json({ error: 'Failed to add lab value' });
  }
});

// ── POST /api/patients/:id/notes ───────────────────────────────────────────────
// Monitor: add a clinical note for a patient.
router.post('/:id/notes', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  try {
    const { note_date, note, flagged = false } = req.body;

    if (!note_date || !note) {
      return res.status(400).json({ error: 'note_date and note are required' });
    }

    const result = await pool.query(
      `INSERT INTO monitor_notes (monitor_id, patient_id, note_date, note, flagged)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, req.params.id, note_date, note, flagged]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /patients/:id/notes error:', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

module.exports = router;
