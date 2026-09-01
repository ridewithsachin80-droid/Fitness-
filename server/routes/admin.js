const router  = require('express').Router();
const pool    = require('../db/pool');
const { hasContent, IST_TODAY } = require('../db/logPredicates');
const bcrypt  = require('bcryptjs');
const authMW  = require('../middleware/auth');
const role    = require('../middleware/roleCheck');

// All routes require admin
router.use(authMW, role('admin'));

// ── Audit helper ──────────────────────────────────────────────────────────────
// Call after any write so admins can see who changed what and when.
async function audit(actor, action, targetId, targetName, detail) {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_name, actor_role, action, target_id, target_name, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [actor?.id || null, actor?.name || 'System', actor?.role || 'admin',
       action, targetId || null, targetName || null, detail || null]
    );
  } catch (e) {
    console.error('audit write failed:', e.message); // non-fatal
  }
}

// ── GET /api/admin/stats ───────────────────────────────────────────────────────
// ── GET /api/admin/health ────────────────────────────────────────────────────
// Which integrations are actually configured. Reports booleans only — never a
// key, never a fragment of one — so it is safe to read over a shared screen.
//
// Exists because several features fail SILENTLY without their keys: push just
// logs a warning and carries on, so a coach sees members ignoring reminders
// that were never sent.
router.get('/health', authMW, role('admin'), async (req, res) => {
  const set = v => !!(v && String(v).trim() && !/^your-/i.test(String(v)));

  const checks = {
    database: { ok: false, detail: 'not reachable' },
    push: {
      ok: set(process.env.VAPID_EMAIL) && set(process.env.VAPID_PUBLIC_KEY) && set(process.env.VAPID_PRIVATE_KEY),
      detail: 'Coach reminders, weekly summaries and all in-app notifications',
      missing: ['VAPID_EMAIL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].filter(k => !set(process.env[k])),
    },
    ai_text: {
      ok: set(process.env.GROQ_API_KEY) || set(process.env.GEMINI_API_KEY),
      detail: 'AI chat logging',
      missing: (set(process.env.GROQ_API_KEY) || set(process.env.GEMINI_API_KEY)) ? [] : ['GROQ_API_KEY or GEMINI_API_KEY'],
    },
    ai_vision: {
      ok: set(process.env.GEMINI_API_KEY),
      detail: 'Photo food logging and lab report reading',
      missing: set(process.env.GEMINI_API_KEY) ? [] : ['GEMINI_API_KEY'],
    },
    sms: {
      ok: set(process.env.MSG91_API_KEY) && set(process.env.MSG91_SENDER_ID),
      detail: 'Automated SMS to members (optional — personal WhatsApp needs nothing)',
      missing: ['MSG91_API_KEY', 'MSG91_SENDER_ID'].filter(k => !set(process.env[k])),
    },
    whatsapp_business: {
      ok: set(process.env.WHATSAPP_TOKEN) && set(process.env.WHATSAPP_PHONE_ID),
      detail: 'Automated WhatsApp (optional — personal WhatsApp needs nothing)',
      missing: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID'].filter(k => !set(process.env[k])),
    },
  };

  try {
    const { rows } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM users WHERE role='patient' AND active=true)::int AS members,
              (SELECT COUNT(*) FROM foods)::int                                     AS foods,
              (SELECT COUNT(*) FROM foods WHERE verified = false)::int              AS unverified_foods,
              (SELECT COUNT(*) FROM daily_logs)::int                                AS logs`);
    checks.database = { ok: true, detail: 'connected', ...rows[0] };
  } catch (err) {
    checks.database.detail = err.message.slice(0, 120);
  }

  const critical = ['database', 'push', 'ai_text'];
  res.json({
    ok: critical.every(k => checks[k].ok),
    checks,
    checked_at: new Date().toISOString(),
  });
});

router.get('/stats', async (req, res) => {
  try {
    const [members, monitors, logs] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM users WHERE role='patient' AND active=true"),
      pool.query("SELECT COUNT(*) FROM users WHERE role IN ('monitor','admin') AND active=true"),
      // Counts members who logged SOMETHING today, not rows that merely exist.
      // The first autosave creates an empty row as soon as the app opens, so
      // counting rows reported "4 logged today" while those same four members
      // showed "—" in the compliance list below it.
      pool.query(`SELECT COUNT(*) FROM daily_logs
                   WHERE log_date = ${IST_TODAY} AND ${hasContent()}`),
    ]);
    res.json({
      members:      parseInt(members.rows[0].count),
      coaches:      parseInt(monitors.rows[0].count),
      monitors:     parseInt(monitors.rows[0].count), // legacy key — stale PWA bundles read this
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
          (SELECT COUNT(*) FROM daily_logs
             WHERE log_date = ${IST_TODAY} AND ${hasContent()})               AS logged_today,
          (SELECT COUNT(*) FROM daily_logs
             WHERE log_date = ${IST_TODAY} AND compliance_pct >= 75)          AS good_compliance_today
      `),
      // Today's detail per member
      pool.query(`
        SELECT u.id, u.name, u.phone,
          dl.compliance_pct, dl.weight_kg, dl.log_date,
          (SELECT u2.name FROM monitor_patients mp
            JOIN users u2 ON u2.id = mp.monitor_id
            WHERE mp.patient_id = u.id AND mp.active = true LIMIT 1) AS monitor_name
        FROM users u
        LEFT JOIN daily_logs dl ON dl.patient_id = u.id AND dl.log_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
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
        HAVING MAX(dl.log_date) < (NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day'
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
        (u.password IS NOT NULL AND u.password != '') AS has_pin,
        (SELECT weight_kg  FROM daily_logs WHERE patient_id=u.id ORDER BY log_date DESC LIMIT 1) AS latest_weight,
        (SELECT log_date   FROM daily_logs WHERE patient_id=u.id ORDER BY log_date DESC LIMIT 1) AS last_logged,
        (SELECT compliance_pct FROM daily_logs WHERE patient_id=u.id ORDER BY log_date DESC LIMIT 1) AS last_compliance,
        (SELECT u2.name FROM monitor_patients mp JOIN users u2 ON u2.id=mp.monitor_id
         WHERE mp.patient_id=u.id AND mp.active=true LIMIT 1) AS monitor_name,
        (SELECT mp.monitor_id FROM monitor_patients mp
         WHERE mp.patient_id=u.id AND mp.active=true LIMIT 1) AS monitor_id,
        -- Same two fields the coach list carries. Sachin works from /admin, not
        -- /coach, so a member message surfaced only on the coach page is a
        -- message he never sees.
        (SELECT COUNT(*)::int FROM monitor_notes mn
          WHERE mn.patient_id=u.id AND mn.from_member=true AND mn.coach_read_at IS NULL)
          AS unread_messages,
        -- Unread only — see the note on the same pair in routes/patients.js.
        (SELECT mn.note FROM monitor_notes mn
          WHERE mn.patient_id=u.id AND mn.from_member=true AND mn.coach_read_at IS NULL
          ORDER BY mn.id DESC LIMIT 1) AS latest_message,
        (SELECT mn.created_at FROM monitor_notes mn
          WHERE mn.patient_id=u.id AND mn.from_member=true AND mn.coach_read_at IS NULL
          ORDER BY mn.id DESC LIMIT 1) AS latest_message_at
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
router.get(['/coaches', '/monitors'], async (req, res) => {
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
    audit(req.user, 'member_created', user.id, user.name,
      `Created member ${user.name} (${phone})${monitor_id ? ' and assigned to coach' : ''}`);
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
router.post(['/coaches', '/monitors'], async (req, res) => {
  const { name, email, password, role: userRole = 'monitor' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password required' });
  if (!['monitor','admin'].includes(userRole)) return res.status(400).json({ error: 'role must be coach or admin' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (name, email, role, password) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role`,
      [name, email, userRole, hash]
    );
    audit(req.user, 'coach_created', result.rows[0].id, name,
      `Created ${userRole} account for ${name} (${email})`);
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
    // Audit: look up names for readable log entry
    const names = await pool.query(
      `SELECT id, name FROM users WHERE id = ANY($1)`,
      [[monitor_id, patient_id]]
    );
    const nameMap = Object.fromEntries(names.rows.map(r => [r.id, r.name]));
    audit(req.user, 'coach_assigned', patient_id, nameMap[patient_id],
      `Assigned ${nameMap[patient_id] || patient_id} to monitor ${nameMap[monitor_id] || monitor_id}`);
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
          gender, dob,
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
        meal_plan, rda_overrides, gender, dob)
      VALUES ($1,$2,$3,$4,$5,3000,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
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
        gender               = EXCLUDED.gender,
        dob                  = EXCLUDED.dob,
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
      // Sex + DOB feed the member's TDEE calculation on their Profile page
      ['male', 'female'].includes(String(gender || '').toLowerCase())
        ? String(gender).toLowerCase() : null,
      dob || null,
    ]);

    await client.query('COMMIT');

    // Return updated member
    const result = await client.query(
      `SELECT u.id, u.name, u.phone, u.active,
         pp.height_cm, pp.gender, pp.dob, pp.start_weight, pp.target_weight,
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
    const updated = result.rows[0];
    audit(req.user, 'member_updated', updated.id, updated.name,
      `Updated profile/protocol for member ${updated.name}`);
    res.json(updated);
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
// ── DELETE /api/admin/members/:id ────────────────────────────────────────────
// Remove a member and everything attached to them.
//
// This is the most destructive thing in the app. Every table that references
// users(id) does so ON DELETE CASCADE, so one statement takes the member's
// daily logs, lab values, workout sessions, notes, portions and trials with
// them. There is no undo and no backup step in this deploy model.
//
// Two guards, and neither is a dialog:
//   · admin only — router.use(role('admin')) at the top of this file already
//     enforces that, so a coach cannot reach it at all
//   · the caller must send the member's EXACT name back. A tap cannot satisfy
//     that, which is the point: "Disable" is the reversible action for a
//     mis-tap, and this one has to be typed.
//
// Disabling is almost always what someone actually wants. That stays one tap
// away in the same menu.
router.delete('/members/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid member id' });
  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM users WHERE id = $1 AND role = 'patient'`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = rows[0];

    const typed = String(req.body?.confirm_name ?? '').trim();
    if (typed !== String(member.name).trim()) {
      return res.status(400).json({
        error: 'Type the member\'s name exactly to confirm deletion',
        expected_name: member.name,
      });
    }

    // Audit BEFORE the delete. Afterwards the row is gone and the entry would
    // have to carry a name reconstructed from the request, which is the one
    // place it could be wrong.
    audit(req.user, 'member_deleted', member.id, member.name,
      `Deleted member ${member.name} and all their data`);

    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    res.json({ deleted: member.id, name: member.name });
  } catch (err) {
    console.error('DELETE /admin/members/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/members/:id/toggle', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET active = NOT active WHERE id=$1 RETURNING id, name, active`,
      [req.params.id]
    );
    const u = result.rows[0];
    audit(req.user, 'member_toggled', u.id, u.name,
      `${u.active ? 'Activated' : 'Deactivated'} member ${u.name}`);
    res.json(u);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/monitors/:id/toggle ──────────────────────────────────────
router.patch(['/coaches/:id/toggle', '/monitors/:id/toggle'], async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET active = NOT active WHERE id=$1 RETURNING id, name, active`,
      [req.params.id]
    );
    const u = result.rows[0];
    audit(req.user, 'coach_toggled', u.id, u.name,
      `${u.active ? 'Activated' : 'Deactivated'} monitor ${u.name}`);
    res.json(u);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/members/:id/pin ──────────────────────────────────────────
// Admin: reset a member's login PIN directly from the admin dashboard.
router.patch('/members/:id/pin', async (req, res) => {
  const { pin } = req.body;
  if (!pin || String(pin).trim().length < 4) {
    return res.status(400).json({ error: 'PIN must be at least 4 characters' });
  }
  try {
    const hash = await bcrypt.hash(String(pin).trim(), 10);
    const result = await pool.query(
      `UPDATE users SET password=$1 WHERE id=$2 AND role='patient' RETURNING id, name`,
      [hash, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Member not found' });
    audit(req.user, 'pin_reset', result.rows[0].id, result.rows[0].name,
      `Reset login PIN for member ${result.rows[0].name}`);
    res.json({ message: 'PIN reset', user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/push ──────────────────────────────────────────────────────
// Sprint 11: Admin sends a manual push notification.
// patient_id optional — omit to broadcast to ALL active patients.
router.post('/push', async (req, res) => {
  const pushService = require('../services/pushService');
  const { patient_id, title, body } = req.body;

  if (!title?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'title and body are required' });
  }

  try {
    let recipients;
    if (patient_id) {
      recipients = [{ id: patient_id }];
    } else {
      const result = await pool.query(
        `SELECT id FROM users WHERE role = 'patient' AND active = true`
      );
      recipients = result.rows;
    }

    let sent = 0, failed = 0;
    for (const r of recipients) {
      try {
        await pushService.sendToUser(r.id, title.trim(), body.trim(), 'admin');
        sent++;
      } catch { failed++; }
    }

    res.json({ message: 'Push sent', sent, failed, total: recipients.length });
  } catch (err) {
    console.error('POST /admin/push error:', err.message);
    res.status(500).json({ error: 'Failed to send push notifications' });
  }
});

// ── GET /api/admin/audit ──────────────────────────────────────────────────────
// Sprint 13: Returns the last 100 audit log entries, newest first.
// Used by the new Audit tab in AdminDashboard.
router.get('/audit', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 100, 200);
    const offset = parseInt(req.query.offset) || 0;
    const result = await pool.query(
      `SELECT id, actor_name, actor_role, action, target_name, detail, created_at
       FROM audit_log
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /admin/audit error:', err.message);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// ── AI EVAL SET (Sprint L1) ──────────────────────────────────────────────────
// Browse the corrections the app has collected, and mark one "not a real
// error". Dismissal matters: a member who types 250g because they genuinely
// ate more is not a parsing mistake, and scoring a prompt against it would
// punish the model for being right. Left in the set, those rows quietly make
// every replay run look worse than it is.

// GET /api/admin/eval-samples?limit=&source=&field=&include_dismissed=
router.get('/eval-samples', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const where  = [];
    const params = [];
    if (req.query.include_dismissed !== '1') where.push('s.dismissed = false');
    if (req.query.source) { params.push(String(req.query.source)); where.push(`s.source = $${params.length}`); }
    if (req.query.field)  { params.push(String(req.query.field));  where.push(`s.field  = $${params.length}`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT s.id, s.patient_id, s.source, s.message, s.ai_output, s.corrected,
              s.field, s.dismissed, s.created_at, u.name AS member_name
         FROM ai_parse_samples s
         LEFT JOIN users u ON u.id = s.patient_id
         ${clause}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // Counts are computed over the WHOLE set, not the page, so "12 samples"
    // does not silently mean "12 on this screen".
    const { rows: tot } = await pool.query(
      `SELECT
         COUNT(*)::int                                          AS total,
         COUNT(*) FILTER (WHERE dismissed = false)::int          AS active,
         COUNT(*) FILTER (WHERE dismissed = false
                            AND source <> 'photo')::int          AS replayable
       FROM ai_parse_samples`
    );

    res.json({ samples: rows, counts: tot[0] || { total: 0, active: 0, replayable: 0 } });
  } catch (err) {
    console.error('GET /admin/eval-samples error:', err.message);
    res.status(500).json({ error: 'Failed to fetch eval samples' });
  }
});

// PATCH /api/admin/eval-samples/:id/dismiss   body: { dismissed: true|false }
// Reversible on purpose — dismissing is a judgement call, and a one-way button
// on a judgement call means people stop pressing it.
router.patch('/eval-samples/:id/dismiss', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
    const dismissed = req.body?.dismissed !== false;
    const { rows } = await pool.query(
      `UPDATE ai_parse_samples SET dismissed = $2 WHERE id = $1
       RETURNING id, dismissed`,
      [id, dismissed]
    );
    if (!rows.length) return res.status(404).json({ error: 'Sample not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /admin/eval-samples/:id/dismiss error:', err.message);
    res.status(500).json({ error: 'Failed to update sample' });
  }
});

module.exports = router;
