const router  = require('express').Router();
const pool    = require('../db/pool');
const bcrypt  = require('bcryptjs');
const authMW  = require('../middleware/auth');
const role    = require('../middleware/roleCheck');

// All routes require admin
router.use(authMW, role('admin'));

// ── GET /api/admin/stats ───────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [members, monitors, logs] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM users WHERE role='patient' AND active=true"),
      pool.query("SELECT COUNT(*) FROM users WHERE role IN ('monitor','admin') AND active=true"),
      pool.query("SELECT COUNT(*) FROM daily_logs WHERE log_date = CURRENT_DATE"),
    ]);
    res.json({
      members:      parseInt(members.rows[0].count),
      monitors:     parseInt(monitors.rows[0].count),
      logsToday:    parseInt(logs.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/members ─────────────────────────────────────────────────────
router.get('/members', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.phone, u.active, u.created_at,
        pp.height_cm, pp.start_weight, pp.target_weight, pp.conditions,
        (SELECT weight_kg  FROM daily_logs WHERE patient_id=u.id ORDER BY log_date DESC LIMIT 1) AS latest_weight,
        (SELECT log_date   FROM daily_logs WHERE patient_id=u.id ORDER BY log_date DESC LIMIT 1) AS last_logged,
        (SELECT compliance_pct FROM daily_logs WHERE patient_id=u.id ORDER BY log_date DESC LIMIT 1) AS last_compliance,
        (SELECT u2.name FROM monitor_patients mp JOIN users u2 ON u2.id=mp.monitor_id
         WHERE mp.patient_id=u.id AND mp.active=true LIMIT 1) AS monitor_name,
        (SELECT mp.monitor_id FROM monitor_patients mp
         WHERE mp.patient_id=u.id AND mp.active=true LIMIT 1) AS monitor_id
      FROM users u
      LEFT JOIN patient_profiles pp ON pp.user_id=u.id
      WHERE u.role='patient'
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/monitors ────────────────────────────────────────────────────
router.get('/monitors', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
        (SELECT COUNT(*) FROM monitor_patients mp WHERE mp.monitor_id=u.id AND mp.active=true) AS patient_count
      FROM users u
      WHERE u.role IN ('monitor','admin')
      ORDER BY u.role DESC, u.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/members ────────────────────────────────────────────────────
// Create a new patient/member
router.post('/members', async (req, res) => {
  const { name, phone, height_cm, start_weight, target_weight, conditions=[], monitor_id } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      `INSERT INTO users (name, phone, role) VALUES ($1,$2,'patient') RETURNING *`,
      [name, phone]
    );
    const user = userRes.rows[0];

    await client.query(
      `INSERT INTO patient_profiles (user_id, height_cm, start_weight, target_weight, conditions, water_target)
       VALUES ($1,$2,$3,$4,$5,3000)`,
      [user.id, height_cm||null, start_weight||null, target_weight||null, JSON.stringify(conditions)]
    );

    if (monitor_id) {
      await client.query(
        `INSERT INTO monitor_patients (monitor_id, patient_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [monitor_id, user.id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: user.id, name: user.name, phone: user.phone });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Phone number already registered' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── POST /api/admin/monitors ───────────────────────────────────────────────────
// Create a new monitor/trainer
router.post('/monitors', async (req, res) => {
  const { name, email, password, role: userRole = 'monitor' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password required' });
  if (!['monitor','admin'].includes(userRole)) return res.status(400).json({ error: 'role must be monitor or admin' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, role, password) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role`,
      [name, email, userRole, hash]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/assign ─────────────────────────────────────────────────────
// Assign a member to a monitor
router.post('/assign', async (req, res) => {
  const { monitor_id, patient_id } = req.body;
  if (!monitor_id || !patient_id) return res.status(400).json({ error: 'monitor_id and patient_id required' });

  try {
    // Remove any existing assignment first
    await pool.query(
      `UPDATE monitor_patients SET active=false WHERE patient_id=$1`,
      [patient_id]
    );
    await pool.query(
      `INSERT INTO monitor_patients (monitor_id, patient_id)
       VALUES ($1,$2) ON CONFLICT (monitor_id, patient_id)
       DO UPDATE SET active=true`,
      [monitor_id, patient_id]
    );
    res.json({ assigned: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/admin/members/:id ────────────────────────────────────────────────
// Full edit of a member: name, phone, PIN, profile fields
router.put('/members/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, pin, height_cm, start_weight, target_weight, conditions,
          protocol_activities, protocol_acv, protocol_supplements,
          custom_activities, custom_acv, custom_supplements } = req.body;

  if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Build user update — optionally hash new PIN
    if (pin && pin.trim()) {
      if (pin.trim().length < 4) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: 'PIN must be at least 4 digits' });
      }
      const pinHash = await bcrypt.hash(pin.trim(), 10);
      await client.query(
        `UPDATE users SET name=$1, phone=$2, password=$3 WHERE id=$4 AND role='patient'`,
        [name.trim(), phone.trim(), pinHash, id]
      );
    } else {
      await client.query(
        `UPDATE users SET name=$1, phone=$2 WHERE id=$3 AND role='patient'`,
        [name.trim(), phone.trim(), id]
      );
    }

    // Upsert patient profile
    await client.query(`
      INSERT INTO patient_profiles (user_id, height_cm, start_weight, target_weight, conditions, water_target,
        protocol_activities, protocol_acv, protocol_supplements,
        custom_activities, custom_acv, custom_supplements)
      VALUES ($1,$2,$3,$4,$5,3000,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (user_id) DO UPDATE SET
        height_cm            = EXCLUDED.height_cm,
        start_weight         = EXCLUDED.start_weight,
        target_weight        = EXCLUDED.target_weight,
        conditions           = EXCLUDED.conditions,
        protocol_activities  = EXCLUDED.protocol_activities,
        protocol_acv         = EXCLUDED.protocol_acv,
        protocol_supplements = EXCLUDED.protocol_supplements,
        custom_activities    = EXCLUDED.custom_activities,
        custom_acv           = EXCLUDED.custom_acv,
        custom_supplements   = EXCLUDED.custom_supplements,
        updated_at           = NOW()
    `, [
      id,
      height_cm     || null,
      start_weight  || null,
      target_weight || null,
      JSON.stringify(conditions || []),
      protocol_activities  ? JSON.stringify(protocol_activities)  : null,
      protocol_acv         ? JSON.stringify(protocol_acv)         : null,
      protocol_supplements ? JSON.stringify(protocol_supplements) : null,
      JSON.stringify(custom_activities  || []),
      JSON.stringify(custom_acv         || []),
      JSON.stringify(custom_supplements || []),
    ]);

    await client.query('COMMIT');

    // Return updated member
    const result = await client.query(
      `SELECT u.id, u.name, u.phone, u.active,
         pp.height_cm, pp.start_weight, pp.target_weight,
         pp.protocol_activities, pp.protocol_acv, pp.protocol_supplements,
         pp.custom_activities, pp.custom_acv, pp.custom_supplements
       FROM users u
       LEFT JOIN patient_profiles pp ON pp.user_id=u.id
       WHERE u.id=$1`,
      [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Phone number already in use' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── PATCH /api/admin/members/:id/toggle ───────────────────────────────────────
// Activate / deactivate a member
router.patch('/members/:id/toggle', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET active = NOT active WHERE id=$1 RETURNING id, name, active`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/monitors/:id/toggle ──────────────────────────────────────
router.patch('/monitors/:id/toggle', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET active = NOT active WHERE id=$1 RETURNING id, name, active`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
