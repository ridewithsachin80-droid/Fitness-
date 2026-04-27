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

// ── GET /api/admin/overview ────────────────────────────────────────────────────
// Sprint 7: Full admin overview — today's activity, 7-day compliance,
// member alerts, weight progress totals.
router.get('/overview', async (req, res) => {
  try {
    const [statsRes, todayRes, alertsRes, complianceRes, weightRes] = await Promise.all([
      // Total counts
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE role='patient' AND active=true)  AS total_members,
          (SELECT COUNT(*) FROM daily_logs WHERE log_date = CURRENT_DATE)    AS logged_today,
          (SELECT COUNT(*) FROM daily_logs WHERE log_date = CURRENT_DATE
            AND compliance_pct >= 75)                                        AS good_compliance_today
      `),
      // Today's detail per member
      pool.query(`
        SELECT u.id, u.name, u.phone,
          dl.compliance_pct, dl.weight_kg, dl.log_date,
          (SELECT u2.name FROM monitor_patients mp
            JOIN users u2 ON u2.id = mp.monitor_id
            WHERE mp.patient_id = u.id AND mp.active = true LIMIT 1) AS monitor_name
        FROM users u
        LEFT JOIN daily_logs dl ON dl.patient_id = u.id AND dl.log_date = CURRENT_DATE
        WHERE u.role = 'patient' AND u.active = true
        ORDER BY COALESCE(dl.compliance_pct, -1) ASC
      `),
      // Members who haven't logged in 2+ days
      pool.query(`
        SELECT u.id, u.name,
          MAX(dl.log_date) AS last_logged,
          CURRENT_DATE - MAX(dl.log_date) AS days_since
        FROM users u
        LEFT JOIN daily_logs dl ON dl.patient_id = u.id
        WHERE u.role = 'patient' AND u.active = true
        GROUP BY u.id, u.name
        HAVING MAX(dl.log_date) < CURRENT_DATE - INTERVAL '1 day'
          OR MAX(dl.log_date) IS NULL
        ORDER BY days_since DESC NULLS FIRST
      `),
      // 7-day avg compliance per member
      pool.query(`
        SELECT u.id, u.name,
          ROUND(AVG(dl.compliance_pct)) AS avg_7d,
          COUNT(dl.id) AS days_logged
        FROM users u
        LEFT JOIN daily_logs dl ON dl.patient_id = u.id
          AND dl.log_date >= CURRENT_DATE - INTERVAL '6 days'
        WHERE u.role = 'patient' AND u.active = true
        GROUP BY u.id, u.name
        ORDER BY avg_7d ASC NULLS FIRST
      `),
      // Weight progress (start vs latest per member)
      pool.query(`
        SELECT u.id, u.name,
          pp.start_weight, pp.target_weight,
          (SELECT weight_kg FROM daily_logs WHERE patient_id = u.id
            AND weight_kg IS NOT NULL ORDER BY log_date DESC LIMIT 1) AS current_weight
        FROM users u
        JOIN patient_profiles pp ON pp.user_id = u.id
        WHERE u.role = 'patient' AND u.active = true
          AND pp.start_weight IS NOT NULL
      `),
    ]);

    const stats       = statsRes.rows[0];
    const today       = todayRes.rows;
    const alerts      = alertsRes.rows;
    const compliance7 = complianceRes.rows;
    const weights     = weightRes.rows;

    // Total weight lost across all members
    const totalLost = weights.reduce((sum, m) => {
      if (m.start_weight && m.current_weight) {
        const lost = parseFloat(m.start_weight) - parseFloat(m.current_weight);
        return sum + (lost > 0 ? lost : 0);
      }
      return sum;
    }, 0);

    // 7-day overall average
    const avg7 = compliance7.length
      ? Math.round(compliance7.reduce((s, m) => s + (parseFloat(m.avg_7d) || 0), 0) / compliance7.length)
      : 0;

    res.json({
      stats: {
        total_members:          parseInt(stats.total_members),
        logged_today:           parseInt(stats.logged_today),
        good_compliance_today:  parseInt(stats.good_compliance_today),
        avg_compliance_7d:      avg7,
        total_weight_lost_kg:   +totalLost.toFixed(1),
      },
      today_detail:  today,
      alerts,
      compliance_7d: compliance7,
      weights,
    });
  } catch (err) {
    console.error('GET /admin/overview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/members ─────────────────────────────────────────────────────
// NOTE: Only selects basic profile columns (height, weight, conditions) in the
// list view. Protocol / fasting / macro data is fetched via GET /admin/members/:id
// when the admin opens a member for editing — this avoids 500s if schema migrations
// haven't run yet.
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
    console.error('GET /admin/members error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/members/:id ────────────────────────────────────────────────
// Returns full profile for a single member — used by EditMemberModal on open.
// Uses SELECT * so it works regardless of which schema migration has run.
router.get('/members/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.phone, u.email, u.active, u.created_at,
        pp.*
      FROM users u
      LEFT JOIN patient_profiles pp ON pp.user_id = u.id
      WHERE u.id = $1 AND u.role = 'patient'
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /admin/members/:id error:', err.message);
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
          custom_activities, custom_acv, custom_supplements,
          item_overrides,
          fasting_start, fasting_end, fasting_note, fasting_label,
          macro_kcal, macro_pro, macro_carb, macro_fat, macro_phase,
          meal_plan, rda_overrides } = req.body;

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
        custom_activities, custom_acv, custom_supplements, item_overrides,
        fasting_start, fasting_end, fasting_note, fasting_label,
        macro_kcal, macro_pro, macro_carb, macro_fat, macro_phase,
        meal_plan, rda_overrides)
      VALUES ($1,$2,$3,$4,$5,3000,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
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
        item_overrides       = EXCLUDED.item_overrides,
        fasting_start        = EXCLUDED.fasting_start,
        fasting_end          = EXCLUDED.fasting_end,
        fasting_note         = EXCLUDED.fasting_note,
        fasting_label        = EXCLUDED.fasting_label,
        macro_kcal           = EXCLUDED.macro_kcal,
        macro_pro            = EXCLUDED.macro_pro,
        macro_carb           = EXCLUDED.macro_carb,
        macro_fat            = EXCLUDED.macro_fat,
        macro_phase          = EXCLUDED.macro_phase,
        meal_plan            = EXCLUDED.meal_plan,
        rda_overrides        = EXCLUDED.rda_overrides,
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
      JSON.stringify(item_overrides     || {}),
      fasting_start || null,
      fasting_end   || null,
      fasting_note  || null,
      fasting_label || null,
      macro_kcal  ? parseInt(macro_kcal)  : null,
      macro_pro   ? parseInt(macro_pro)   : null,
      macro_carb  ? parseInt(macro_carb)  : null,
      macro_fat   ? parseInt(macro_fat)   : null,
      macro_phase || null,
      meal_plan   ? JSON.stringify(meal_plan) : null,
      rda_overrides && Object.keys(rda_overrides).length > 0
        ? JSON.stringify(rda_overrides) : '{}',
    ]);

    await client.query('COMMIT');

    // Return updated member
    const result = await client.query(
      `SELECT u.id, u.name, u.phone, u.active,
         pp.height_cm, pp.start_weight, pp.target_weight,
         pp.protocol_activities, pp.protocol_acv, pp.protocol_supplements,
         pp.custom_activities, pp.custom_acv, pp.custom_supplements,
         pp.item_overrides,
         pp.fasting_start, pp.fasting_end, pp.fasting_note, pp.fasting_label,
         pp.macro_kcal, pp.macro_pro, pp.macro_carb, pp.macro_fat, pp.macro_phase
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
