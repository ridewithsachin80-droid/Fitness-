const router = require('express').Router();
const pool = require('../db/pool');
const authMW = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const bcrypt = require('bcryptjs');

// Lightweight audit helper — logs monitor/admin actions on patient records
async function audit(actor, action, targetId, targetName, detail) {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_name, actor_role, action, target_id, target_name, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [actor?.id||null, actor?.name||'System', actor?.role||'monitor',
       action, targetId||null, targetName||null, detail||null]
    );
  } catch (e) { /* non-fatal */ }
}

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
         (u.password IS NOT NULL AND u.password != '') AS has_pin,
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

// ── GET /api/patients/me ────────────────────────────────────────────────────────
// Patient fetches their own profile + labs for the Progress page.
// ── GET /api/patients/:id ──────────────────────────────────────────────────────
// Monitor/admin: full patient detail — profile + last 30 logs + all lab values.
// All three queries run in parallel for speed.
// ── GET /api/patients/me ──────────────────────────────────────────────────────
// Patient-facing: own full profile + lab values for Progress page.
// MUST be registered BEFORE /:id to prevent "me" being treated as an id.
router.get('/me', authMW, roleCheck('patient'), async (req, res) => {
  try {
    const [profileResult, labsResult, notesResult] = await Promise.all([
      pool.query(
        `SELECT
           u.id, u.name, u.phone, u.created_at,
           pp.dob, pp.height_cm, pp.start_weight, pp.target_weight,
           pp.conditions, pp.diet_notes, pp.water_target,
           pp.fasting_start, pp.fasting_end, pp.fasting_label, pp.fasting_note,
           pp.macro_kcal, pp.macro_pro, pp.macro_carb, pp.macro_fat, pp.macro_phase,
           (SELECT u2.name FROM monitor_patients mp
            JOIN users u2 ON u2.id = mp.monitor_id
            WHERE mp.patient_id = u.id AND mp.active = true LIMIT 1) AS monitor_name,
           (SELECT COUNT(*) FROM daily_logs WHERE patient_id = u.id) AS total_logs,
           (SELECT weight_kg FROM daily_logs WHERE patient_id = u.id ORDER BY log_date DESC LIMIT 1) AS current_weight,
           (SELECT AVG(compliance_pct) FROM daily_logs
            WHERE patient_id = u.id AND log_date >= NOW() - INTERVAL '30 days') AS avg_compliance_30
         FROM users u
         JOIN patient_profiles pp ON pp.user_id = u.id
         WHERE u.id = $1`,
        [req.user.id]
      ),
      // Bug fix: also return labs so Progress.jsx lab highlights work
      pool.query(
        `SELECT * FROM lab_values WHERE patient_id = $1 ORDER BY test_date DESC`,
        [req.user.id]
      ),
      // Coach notes visible to member — flagged notes first, then newest
      pool.query(
        `SELECT mn.id, mn.note_date, mn.note, mn.flagged,
                u.name AS monitor_name
         FROM monitor_notes mn
         JOIN users u ON u.id = mn.monitor_id
         WHERE mn.patient_id = $1
         ORDER BY mn.flagged DESC, mn.note_date DESC, mn.created_at DESC
         LIMIT 20`,
        [req.user.id]
      ),
    ]);

    if (!profileResult.rows.length) return res.status(404).json({ error: 'Profile not found' });

    const p = profileResult.rows[0];
    res.json({
      id:              p.id,
      name:            p.name,
      phone:           p.phone,
      member_since:    p.created_at,
      dob:             p.dob,
      height_cm:       p.height_cm,
      start_weight:    p.start_weight,
      target_weight:   p.target_weight,
      current_weight:  p.current_weight,
      conditions:      p.conditions || [],
      diet_notes:      p.diet_notes || null,
      water_target:    p.water_target || 3000,
      monitor_name:    p.monitor_name || null,
      total_logs:      parseInt(p.total_logs) || 0,
      avg_compliance:  p.avg_compliance_30 ? Math.round(parseFloat(p.avg_compliance_30)) : null,
      labs:            labsResult.rows,
      coach_notes:     notesResult.rows,
      fasting: p.fasting_start ? {
        start: p.fasting_start,
        end:   p.fasting_end,
        label: p.fasting_label,
        note:  p.fasting_note,
      } : null,
      macros: p.macro_kcal ? {
        kcal:  p.macro_kcal,
        pro:   p.macro_pro,
        carb:  p.macro_carb,
        fat:   p.macro_fat,
        phase: p.macro_phase,
      } : null,
    });
  } catch (err) {
    console.error('GET /patients/me error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

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

    const [profileResult, logsResult, labsResult, notesResult, pinResult] = await Promise.all([
      pool.query(
        `SELECT u.id, u.name, u.phone, u.email, u.created_at,
                pp.*
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
      // Sprint 9: fetch all clinical notes for this patient, newest first
      pool.query(
        `SELECT mn.*, u.name AS monitor_name
         FROM monitor_notes mn
         JOIN users u ON u.id = mn.monitor_id
         WHERE mn.patient_id = $1
         ORDER BY mn.note_date DESC, mn.created_at DESC`,
        [id]
      ),
      // Sprint 9: check if member has a PIN set
      pool.query(
        `SELECT (password IS NOT NULL AND password != '') AS has_pin FROM users WHERE id = $1`,
        [id]
      ),
    ]);

    if (!profileResult.rows.length) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json({
      profile: { ...profileResult.rows[0], has_pin: pinResult.rows[0]?.has_pin ?? false },
      logs:    logsResult.rows,
      labs:    labsResult.rows,
      notes:   notesResult.rows,
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

// ── GET /api/patients/me ──────────────────────────────────────────────────────
// Sprint 10: Patient-facing — returns the logged-in member's own full profile.
// ── PATCH /api/patients/:id/pin ───────────────────────────────────────────────
// Monitor/admin: set or reset a member's login PIN.
router.patch('/:id/pin', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  const { pin } = req.body;
  if (!pin || String(pin).trim().length < 4) {
    return res.status(400).json({ error: 'PIN must be at least 4 characters' });
  }
  try {
    const hash = await bcrypt.hash(String(pin).trim(), 10);
    const result = await pool.query(
      `UPDATE users SET password = $1 WHERE id = $2 AND role = 'patient' RETURNING id, name, phone`,
      [hash, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Patient not found' });
    audit(req.user, 'pin_set', result.rows[0].id, result.rows[0].name,
      `Set login PIN for member ${result.rows[0].name}`);
    res.json({ message: 'PIN updated', user: result.rows[0] });
  } catch (err) {
    console.error('PATCH /patients/:id/pin error:', err.message);
    res.status(500).json({ error: 'Failed to update PIN' });
  }
});

// ── PATCH /api/patients/:id/weight ───────────────────────────────────────────
// Sprint 11: Monitor/admin can log or correct a member's weight for any date.
// Creates the daily_log row if it doesn't exist yet (upsert on weight only).
router.patch('/:id/weight', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  const { date, weight_kg } = req.body;
  const patientId = req.params.id;

  if (!date || !weight_kg) {
    return res.status(400).json({ error: 'date and weight_kg are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const w = parseFloat(weight_kg);
  if (isNaN(w) || w < 20 || w > 400) {
    return res.status(400).json({ error: 'weight_kg must be a realistic value (20–400)' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO daily_logs (patient_id, log_date, weight_kg)
       VALUES ($1, $2, $3)
       ON CONFLICT (patient_id, log_date)
       DO UPDATE SET weight_kg = EXCLUDED.weight_kg
       RETURNING id, log_date, weight_kg`,
      [patientId, date, w]
    );
    // Look up patient name for audit
    const nameQ = await pool.query('SELECT name FROM users WHERE id=$1', [patientId]);
    audit(req.user, 'weight_logged', parseInt(patientId), nameQ.rows[0]?.name,
      `Logged ${w}kg for ${nameQ.rows[0]?.name || patientId} on ${date}`);
    res.json({ message: 'Weight updated', log: result.rows[0] });
  } catch (err) {
    console.error('PATCH /patients/:id/weight error:', err.message);
    res.status(500).json({ error: 'Failed to update weight' });
  }
});

module.exports = router;
