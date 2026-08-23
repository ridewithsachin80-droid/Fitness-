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

// Enforces that a monitor may only act on patients actually assigned to
// them via monitor_patients — admins bypass this entirely. This is the same
// check GET /:id already did correctly; it was missing from five other
// routes below (profile, labs, notes, pin, weight), meaning any monitor
// account could previously read/modify any OTHER monitor's patients just by
// knowing/guessing a numeric id — including resetting their login PIN.
async function requirePatientAccess(req, res, next) {
  if (req.user.role === 'admin') return next();
  try {
    const linkCheck = await pool.query(
      `SELECT 1 FROM monitor_patients WHERE monitor_id = $1 AND patient_id = $2 AND active = true`,
      [req.user.id, req.params.id]
    );
    if (!linkCheck.rows.length) {
      return res.status(403).json({ error: 'Patient not assigned to you' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify patient access' });
  }
}

// ── GET /api/patients ─────────────────────────────────────────────────────────
// Monitor/admin: list all assigned patients with summary stats.
// Returns: name, phone, start/target weight, latest weight, last logged date, compliance.
router.get('/', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  try {
    let result;

    if (req.user.role === 'admin') {
      // Admins see ALL active patients across all monitors
      result = await pool.query(
        `SELECT
           u.id,
           u.name,
           u.phone,
           pp.height_cm,
           pp.start_weight,
           pp.target_weight,
           pp.conditions,
           (u.password IS NOT NULL AND u.password != '') AS has_pin,
           (SELECT weight_kg      FROM daily_logs WHERE patient_id = u.id ORDER BY log_date DESC LIMIT 1) AS latest_weight,
           (SELECT log_date       FROM daily_logs WHERE patient_id = u.id ORDER BY log_date DESC LIMIT 1) AS last_logged,
           (SELECT compliance_pct FROM daily_logs WHERE patient_id = u.id ORDER BY log_date DESC LIMIT 1) AS last_compliance,
           (SELECT MAX(session_date) FROM workout_sessions WHERE patient_id = u.id) AS last_workout,
           (SELECT u2.name FROM monitor_patients mp2
            JOIN users u2 ON u2.id = mp2.monitor_id
            WHERE mp2.patient_id = u.id AND mp2.active = true LIMIT 1) AS monitor_name
         FROM users u
         LEFT JOIN patient_profiles pp ON pp.user_id = u.id
         WHERE u.role = 'patient' AND u.active = true
         ORDER BY u.name`
      );
    } else {
      // Monitors see only their assigned patients
      result = await pool.query(
        `SELECT
           u.id,
           u.name,
           u.phone,
           pp.height_cm,
           pp.start_weight,
           pp.target_weight,
           pp.conditions,
           (u.password IS NOT NULL AND u.password != '') AS has_pin,
           (SELECT weight_kg      FROM daily_logs WHERE patient_id = u.id ORDER BY log_date DESC LIMIT 1) AS latest_weight,
           (SELECT log_date       FROM daily_logs WHERE patient_id = u.id ORDER BY log_date DESC LIMIT 1) AS last_logged,
           (SELECT compliance_pct FROM daily_logs WHERE patient_id = u.id ORDER BY log_date DESC LIMIT 1) AS last_compliance,
           (SELECT MAX(session_date) FROM workout_sessions WHERE patient_id = u.id) AS last_workout
         FROM users u
         JOIN monitor_patients mp ON mp.patient_id = u.id
         LEFT JOIN patient_profiles pp ON pp.user_id = u.id
         WHERE mp.monitor_id = $1
           AND mp.active = true
           AND u.active  = true
         ORDER BY u.name`,
        [req.user.id]
      );
    }

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
    const [profileResult, labsResult, todayLogResult, workoutResult, notesResult] = await Promise.all([
      pool.query(
        `SELECT
           u.id, u.name, u.phone, u.created_at,
           pp.dob, pp.gender, pp.height_cm, pp.start_weight, pp.target_weight,
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
      // Today's log — powers the TDEE energy-balance card (calories in vs out)
      pool.query(
        `SELECT log_date, weight_kg, food_items, activities, compliance_pct
         FROM daily_logs
         WHERE patient_id = $1
         ORDER BY log_date DESC
         LIMIT 1`,
        [req.user.id]
      ),
      // Today's workout session — sets (for volume-based strength calories)
      // and cardio entries (MET × time). Duration alone was a poor proxy: it
      // counts rest between sets and can't distinguish 3 sets from 20.
      pool.query(
        `SELECT ws.session_date, ws.duration_min, ws.cardio,
                COALESCE(
                  (SELECT json_agg(json_build_object('reps', ss.reps, 'weight_kg', ss.weight_kg))
                   FROM session_sets ss WHERE ss.session_id = ws.id),
                  '[]'::json
                ) AS sets
         FROM workout_sessions ws
         WHERE ws.patient_id = $1
         ORDER BY ws.session_date DESC
         LIMIT 1`,
        [req.user.id]
      ),
      // Coach notes visible to member — flagged notes first, then newest
      pool.query(
        `SELECT mn.id, mn.note_date, mn.note, mn.flagged,
                mn.read_at, u.name AS monitor_name
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
      gender:          p.gender || null,
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
      // Today's energy in/out — the Profile page turns this into a TDEE
      // surplus/deficit figure. Sent raw so the client owns the maths.
      today_energy: (() => {
        const log = todayLogResult.rows[0] || null;
        const ws  = workoutResult.rows[0] || null;
        const istToday = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
          .toISOString().split('T')[0];
        const logDate = log?.log_date
          ? new Date(log.log_date).toISOString().split('T')[0] : null;
        const wsDate = ws?.session_date
          ? new Date(ws.session_date).toISOString().split('T')[0] : null;
        return {
          date:          istToday,
          is_today:      logDate === istToday,
          food_items:    logDate === istToday && Array.isArray(log.food_items) ? log.food_items : [],
          activities:    logDate === istToday && log.activities ? log.activities : {},
          weight_kg:     log?.weight_kg ? parseFloat(log.weight_kg) : null,
          workout_min:   wsDate === istToday ? (ws.duration_min || 0) : 0,
          // Raw sets + cardio so the client can apply the shared calorie model
          workout_sets:  wsDate === istToday && Array.isArray(ws.sets) ? ws.sets : [],
          cardio:        wsDate === istToday && Array.isArray(ws.cardio) ? ws.cardio : [],
        };
      })(),
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

// Declared BEFORE '/:id' — Express matches in order, and '/:id' would
// otherwise capture 'population' as a member id.
// What the clinic as a whole has learned
router.get('/population/prior', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  try { res.json(await populationPrior()); }
  catch (err) {
    console.error('GET /patients/population/prior error:', err);
    res.status(500).json({ error: 'Could not compute the prior' });
  }
});

// Declared before '/:id' — Express matches in order and would otherwise
// read 'me' as a member id and reject the member on role.
// ── GET /api/patients/gaps ───────────────────────────────────────────────────
// What each assigned member has not logged yet today, ranked, so a coach can
// see at a glance who is worth a message and about what.
//
// Declared before '/:id' so "gaps" is not read as a member id.
const { detectGaps, nextCheck } = require('../services/gapDetector');

router.get('/gaps', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const { rows: members } = await pool.query(
      isAdmin
        ? `SELECT u.id, u.name, u.phone FROM users u
           WHERE u.role = 'patient' AND u.active = true ORDER BY u.name`
        : `SELECT u.id, u.name, u.phone FROM users u
           JOIN monitor_patients mp ON mp.patient_id = u.id
           WHERE mp.monitor_id = $1 AND mp.active = true AND u.active = true
           ORDER BY u.name`,
      isAdmin ? [] : [req.user.id]
    );
    if (!members.length) return res.json({ members: [], generated_at: new Date().toISOString() });

    const ids = members.map(m => m.id);
    const [logsRes, profRes, lastRes] = await Promise.all([
      pool.query(
        `SELECT * FROM daily_logs
         WHERE patient_id = ANY($1) AND log_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`,
        [ids]),
      pool.query(
        `SELECT user_id, water_target, protocol_activities, protocol_acv,
                protocol_supplements, meal_plan
         FROM patient_profiles WHERE user_id = ANY($1)`, [ids]),
      // How long since each member logged anything at all — a member silent
      // for weeks needs a different message from one who missed water today.
      pool.query(
        `SELECT patient_id,
                ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - MAX(log_date)) AS days_since
         FROM daily_logs WHERE patient_id = ANY($1)
         GROUP BY patient_id`, [ids]),
    ]);

    const logByMember  = new Map(logsRes.rows.map(l => [l.patient_id, l]));
    const profByMember = new Map(profRes.rows.map(p => [p.user_id, p]));
    const lastByMember = new Map(lastRes.rows.map(r => [r.patient_id, parseInt(r.days_since)]));

    let clear = 0;
    const out = members.map(m => {
      const p = profByMember.get(m.id) || {};
      // A member who has never logged at all reads as maximally dormant
      const days = lastByMember.has(m.id) ? lastByMember.get(m.id) : 9999;
      return detectGaps(m, logByMember.get(m.id) || null, {
        water_target: p.water_target,
        activities:   p.protocol_activities,
        acv:          p.protocol_acv,
        supplements:  p.protocol_supplements,
        meal_slots:   p.meal_plan,
      }, { daysSince: days });
    }).filter(r => {
      if (!r.gaps.length) clear++;
      return r.gaps.length;
    });

    // Most urgent first, so the coach works down the list
    const rank = { blocking: 0, high: 1, medium: 2, low: 3 };
    out.sort((a, b) => rank[a.gaps[0].severity] - rank[b.gaps[0].severity]
                    || a.name.localeCompare(b.name));

    res.json({
      members: out,
      // Members with nothing outstanding YET. Reported so an absence from the
      // list is explainable rather than looking like a bug.
      clear,
      next_check: nextCheck(),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /patients/gaps error:', err);
    res.status(500).json({ error: 'Could not work out today\'s gaps' });
  }
});

// ── POST /api/patients/me/notes/reply ────────────────────────────────────────
// A member answering their coach. Declared before '/:id' routes.
router.post('/me/notes/reply', authMW, roleCheck('patient'), async (req, res) => {
  const { note, reply_to = null } = req.body || {};
  if (!note || !String(note).trim()) {
    return res.status(400).json({ error: 'A message is required' });
  }

  try {
    // Route the reply to whoever wrote the note being answered, falling back
    // to the member's assigned coach. A reply that lands on nobody is worse
    // than no reply feature at all.
    // Validate reply_to against THIS member's own notes and discard it
    // otherwise. Two reasons, both real:
    //
    //   · an unknown id violates the foreign key and 500s the request
    //   · an id belonging to someone else would thread this member's reply
    //     onto a stranger's note — the row lands in the right patient's
    //     thread, but reply_to points into another member's conversation
    let monitorId = null;
    let threadId = null;
    if (reply_to) {
      const { rows } = await pool.query(
        `SELECT id, monitor_id FROM monitor_notes WHERE id = $1 AND patient_id = $2`,
        [parseInt(reply_to) || 0, req.user.id]);
      if (rows.length) {
        threadId  = rows[0].id;
        monitorId = rows[0].monitor_id;
      }
    }
    if (!monitorId) {
      const { rows } = await pool.query(
        `SELECT monitor_id FROM monitor_patients
         WHERE patient_id = $1 AND active = true
         ORDER BY id LIMIT 1`, [req.user.id]);
      monitorId = rows[0]?.monitor_id ?? null;
    }
    if (!monitorId) {
      return res.status(400).json({ error: 'You do not have a coach assigned yet' });
    }

    const { rows } = await pool.query(
      `INSERT INTO monitor_notes
         (monitor_id, patient_id, note_date, note, flagged, from_member, reply_to, read_at)
       VALUES ($1, $2, (NOW() AT TIME ZONE 'Asia/Kolkata')::date, $3, false, true, $4, NOW())
       RETURNING *`,
      [monitorId, req.user.id, String(note).trim().slice(0, 2000), threadId]);

    // Mark the note being answered as read — replying is reading
    if (threadId) {
      await pool.query(
        `UPDATE monitor_notes SET read_at = COALESCE(read_at, NOW())
         WHERE id = $1 AND patient_id = $2`, [threadId, req.user.id]);
    }

    // Tell the coach. Their own app is where they will see it.
    try {
      const push = require('../services/pushService');
      const { rows: [u] } = await pool.query(`SELECT name FROM users WHERE id = $1`, [req.user.id]);
      await push.sendToUser(monitorId, `${u?.name || 'A member'} replied`,
        String(note).trim().slice(0, 120), 'member-reply');
    } catch { /* a missing push subscription must not fail the reply */ }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /patients/me/notes/reply error:', err);
    res.status(500).json({ error: 'Could not send your reply' });
  }
});

// ── GET /api/patients/me/notes ───────────────────────────────────────────────
// The member's own thread with their coach, both directions.
router.get('/me/notes', authMW, roleCheck('patient'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.note, n.note_date, n.flagged, n.from_member, n.reply_to,
              n.read_at, n.created_at, u.name AS author
       FROM monitor_notes n
       LEFT JOIN users u ON u.id = CASE WHEN n.from_member THEN n.patient_id ELSE n.monitor_id END
       WHERE n.patient_id = $1
       ORDER BY n.note_date DESC, n.id DESC
       LIMIT 100`, [req.user.id]);
    res.json({ notes: rows });
  } catch (err) {
    console.error('GET /patients/me/notes error:', err);
    res.status(500).json({ error: 'Could not load your messages' });
  }
});

// ── GET /api/patients/:id/gaps ───────────────────────────────────────────────
// One member's state, so a message composed from their page is written from
// what they actually haven't logged rather than a generic nudge. Unlike the
// list endpoint this always answers, including "nothing outstanding".
router.get('/:id/gaps', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
  try {
    const id = req.params.id;
    const [userRes, logRes, profRes, lastRes] = await Promise.all([
      pool.query(`SELECT id, name, phone FROM users WHERE id = $1`, [id]),
      pool.query(
        `SELECT * FROM daily_logs
         WHERE patient_id = $1 AND log_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`, [id]),
      pool.query(
        `SELECT water_target, protocol_activities, protocol_acv,
                protocol_supplements, meal_plan
         FROM patient_profiles WHERE user_id = $1`, [id]),
      pool.query(
        `SELECT ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - MAX(log_date)) AS days_since
         FROM daily_logs WHERE patient_id = $1`, [id]),
    ]);

    if (!userRes.rows.length) return res.status(404).json({ error: 'Member not found' });

    const p = profRes.rows[0] || {};
    const raw = lastRes.rows[0]?.days_since;
    const days = raw == null ? 9999 : parseInt(raw);

    res.json({
      ...detectGaps(userRes.rows[0], logRes.rows[0] || null, {
        water_target: p.water_target,
        activities:   p.protocol_activities,
        acv:          p.protocol_acv,
        supplements:  p.protocol_supplements,
        meal_slots:   p.meal_plan,
      }, { daysSince: days }),
      next_check: nextCheck(),
    });
  } catch (err) {
    console.error('GET /patients/:id/gaps error:', err);
    res.status(500).json({ error: 'Could not work out their gaps' });
  }
});

// ── Notification preferences ─────────────────────────────────────────────────
// Members control which channels reach them. Opting out is kept separate from
// the individual toggles: switching a channel off is a preference, opting out
// is a withdrawal of consent and must not be undone by toggling something else.
router.get('/me/notifications', authMW, roleCheck('patient'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT notify_push, notify_whatsapp, notify_sms, notify_opted_out
       FROM patient_profiles WHERE user_id = $1`, [req.user.id]);
    const p = rows[0] || {};
    res.json({
      push:     p.notify_push     !== false,
      whatsapp: p.notify_whatsapp !== false,
      sms:      p.notify_sms      === true,
      opted_out: p.notify_opted_out === true,
    });
  } catch (err) {
    console.error('GET /patients/me/notifications error:', err);
    res.status(500).json({ error: 'Could not load your preferences' });
  }
});

router.put('/me/notifications', authMW, roleCheck('patient'), async (req, res) => {
  const { push, whatsapp, sms, opted_out } = req.body || {};
  const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
  try {
    const { rows } = await pool.query(
      `UPDATE patient_profiles SET
         notify_push      = COALESCE($2, notify_push),
         notify_whatsapp  = COALESCE($3, notify_whatsapp),
         notify_sms       = COALESCE($4, notify_sms),
         notify_opted_out = COALESCE($5, notify_opted_out)
       WHERE user_id = $1
       RETURNING notify_push, notify_whatsapp, notify_sms, notify_opted_out`,
      [req.user.id,
       typeof push === 'boolean' ? push : null,
       typeof whatsapp === 'boolean' ? whatsapp : null,
       typeof sms === 'boolean' ? sms : null,
       typeof opted_out === 'boolean' ? opted_out : null]);
    const p = rows[0] || {};
    res.json({
      push: p.notify_push, whatsapp: p.notify_whatsapp,
      sms: p.notify_sms, opted_out: p.notify_opted_out,
    });
  } catch (err) {
    console.error('PUT /patients/me/notifications error:', err);
    res.status(500).json({ error: 'Could not save your preferences' });
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
router.patch('/:id/profile', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
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
// Declared BEFORE '/:id/labs' — Express matches in declaration order, and
// the parameterised route would otherwise capture 'me' as a member id and
// reject the member for not being a coach.
// Members can now enter their own results. Their own medical data, so they may
// both add and read it; `entered_role` records who typed it, because a coach
// transcribing a PDF and a member typing from a phone deserve different trust.
router.post('/me/labs', authMW, roleCheck('patient'), async (req, res) => {
  const { test_date, results, lab_name, notes } = req.body || {};
  if (!test_date || !Array.isArray(results) || !results.length) {
    return res.status(400).json({ error: 'test_date and a results array are required' });
  }
  if (new Date(test_date) > new Date()) {
    return res.status(400).json({ error: 'Test date cannot be in the future' });
  }

  const clean = results
    .filter(r => r && r.test_name && r.value !== undefined && r.value !== '')
    .slice(0, 60)
    .map(r => ({
      test_name: String(r.test_name).trim().slice(0, 100),
      value: parseFloat(r.value),
      unit: r.unit ? String(r.unit).trim().slice(0, 30) : null,
      // Postgres NUMERIC accepts NaN as a legitimate value, so parseFloat('-')
      // or parseFloat('< 100') stores a real NaN that then renders as
      // "ref NaN–100". Only finite numbers get through.
      ref_min: finiteOrNull(r.ref_min),
      ref_max: finiteOrNull(r.ref_max),
    }))
    .filter(r => Number.isFinite(r.value));

  if (!clean.length) return res.status(400).json({ error: 'No usable results — each needs a name and a numeric value' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = [];
    for (const r of clean) {
      const { rows } = await client.query(
        `INSERT INTO lab_values
           (patient_id, test_date, test_name, value, unit, ref_min, ref_max, status,
            entered_by, entered_role, lab_name, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'patient',$10,$11)
         RETURNING *`,
        [req.user.id, test_date, r.test_name, r.value, r.unit, r.ref_min, r.ref_max,
         classify(r.value, r.ref_min, r.ref_max), req.user.id,
         lab_name ? String(lab_name).slice(0, 120) : null,
         notes ? String(notes).slice(0, 500) : null]);
      saved.push(rows[0]);
    }
    await client.query('COMMIT');

    const abnormal = saved.filter(r => r.status !== 'normal');
    res.status(201).json({
      saved: saved.length,
      results: saved,
      // Stated plainly rather than interpreted. The app must not tell someone
      // what an out-of-range marker means about their health.
      notice: abnormal.length
        ? `${abnormal.length} result${abnormal.length > 1 ? 's are' : ' is'} outside the reference range. Your coach can see these — discuss anything abnormal with the doctor who ordered the test.`
        : null,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /patients/me/labs error:', err);
    res.status(500).json({ error: 'Could not save the results' });
  } finally { client.release(); }
});

router.get('/me/labs', authMW, roleCheck('patient'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM lab_values WHERE patient_id = $1
       ORDER BY test_date DESC, test_name ASC`, [req.user.id]);
    res.json({ labs: rows });
  } catch (err) {
    console.error('GET /patients/me/labs error:', err);
    res.status(500).json({ error: 'Could not load your results' });
  }
});

router.post('/:id/labs', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
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
router.post('/:id/notes', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
  try {
    const { note_date, note, flagged = false, delivered_via = null } = req.body;

    if (!note_date || !note) {
      return res.status(400).json({ error: 'note_date and note are required' });
    }

    const via = ['whatsapp', 'sms'].includes(delivered_via) ? delivered_via : null;

    // A note the coach already sent over WhatsApp is stored as read. The member
    // has the message; showing it again as an unread "action needed" card would
    // deliver it twice and make the coach look like they are nagging.
    const result = await pool.query(
      `INSERT INTO monitor_notes (monitor_id, patient_id, note_date, note, flagged,
                                  delivered_via, read_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 IS NULL THEN NULL ELSE NOW() END)
       RETURNING *`,
      [req.user.id, req.params.id, note_date, note, flagged, via]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /patients/:id/notes error:', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// ── Lab results ──────────────────────────────────────────────────────────────
const { analyseLabs } = require('../services/labAnalysis');

/** Only a finite number survives; anything else becomes null. */
function finiteOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function classify(value, refMin, refMax) {
  if (refMin == null || refMax == null) return 'normal';
  const v = parseFloat(value);
  if (v < parseFloat(refMin)) return 'low';
  if (v > parseFloat(refMax)) return 'high';
  return 'normal';
}

async function labContext(patientId) {
  const [labs, logs, sess] = await Promise.all([
    pool.query(`SELECT * FROM lab_values WHERE patient_id=$1 ORDER BY test_date ASC`, [patientId]),
    pool.query(`SELECT log_date, weight_kg, food_items, supplements
                FROM daily_logs WHERE patient_id=$1 ORDER BY log_date ASC`, [patientId]),
    pool.query(`SELECT session_date, cardio FROM workout_sessions WHERE patient_id=$1`, [patientId]),
  ]);
  return analyseLabs(labs.rows, logs.rows, sess.rows);
}

// Member: the same analysis of their own results
router.get('/me/lab-analysis', authMW, roleCheck('patient'), async (req, res) => {
  try { res.json(await labContext(req.user.id)); }
  catch (err) {
    console.error('GET /patients/me/lab-analysis error:', err);
    res.status(500).json({ error: 'Could not analyse your results' });
  }
});

// Coach: the full interval analysis
router.get('/:id/lab-analysis', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
  try { res.json(await labContext(req.params.id)); }
  catch (err) {
    console.error('GET /patients/:id/lab-analysis error:', err);
    res.status(500).json({ error: 'Could not analyse the results' });
  }
});

// ── Lab insight (coach only) ─────────────────────────────────────────────────
// Nutritional guidance from a lab panel. A deterministic rule layer runs first
// and can suppress the AI entirely; see services/labInsight.js for where the
// line between nutrition and diagnosis is drawn and why.
const { triage: triageLabs, buildPrompt: buildLabPrompt, screenClinical, macroTargets } = require('../services/labInsight');
const axios = require('axios');

router.post('/:id/lab-insight', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
  try {
    const [labsRes, profRes, wRes] = await Promise.all([
      pool.query(`SELECT * FROM lab_values WHERE patient_id = $1 ORDER BY test_date DESC`, [req.params.id]),
      pool.query(`SELECT u.name, pp.macro_kcal, pp.macro_pro, pp.conditions,
                         pp.height_cm, pp.dob, pp.gender, pp.start_weight, pp.target_weight
                  FROM users u LEFT JOIN patient_profiles pp ON pp.user_id = u.id
                  WHERE u.id = $1`, [req.params.id]),
      pool.query(`SELECT weight_kg FROM daily_logs
                  WHERE patient_id = $1 AND weight_kg IS NOT NULL
                  ORDER BY log_date DESC LIMIT 1`, [req.params.id]),
    ]);

    if (!labsRes.rows.length) {
      return res.status(400).json({ error: 'No lab results on file for this member' });
    }

    const t = triageLabs(labsRes.rows);
    const p = profRes.rows[0] || {};

    // Urgent findings short-circuit everything. Diet advice alongside "this
    // needs a doctor promptly" dilutes the only message that matters.
    if (!t.safe_to_advise) {
      return res.json({
        generated: false,
        urgent: t.urgent,
        summary: `${t.urgent.length} result${t.urgent.length > 1 ? 's' : ''} on this panel ` +
                 `should be reviewed by a doctor before any dietary plan is built around it.`,
        note: 'Nutritional guidance is withheld while these are outstanding. Once a doctor has reviewed them, generate again.',
      });
    }

    if (!t.actionable.length) {
      return res.json({
        generated: false,
        urgent: [],
        other: t.other,
        summary: t.other.length
          ? 'Nothing on this panel has a clear dietary lever. The out-of-range markers below are worth raising with their doctor.'
          : 'Everything on this panel sits within its reference range.',
      });
    }

    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'AI is not configured on this server' });
    }

    const prompt = buildLabPrompt(t, {
      name: p.name || 'the member',
      diet: Array.isArray(p.conditions) && p.conditions.length ? p.conditions.join(', ') : 'not recorded',
      kcal: p.macro_kcal, protein: p.macro_pro,
    });

    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_DOC_MODEL || 'gemini-2.5-flash'}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }],
        // A panel with six actionable markers produces three paragraphs each
        // plus meal ideas. 4000 tokens truncated it mid-object, which arrives
        // as unparseable JSON — the same fault that broke the PDF reader.
        generationConfig: { temperature: 0.2, maxOutputTokens: 12000, responseMimeType: 'application/json' } },
      { headers: { 'content-type': 'application/json' }, timeout: 60000 }
    );

    const cand = data.candidates?.[0];
    const finish = cand?.finishReason;
    const text = cand?.content?.parts?.map(x => x.text).join('') || '';

    if (!text.trim()) {
      console.warn('lab-insight: empty response, finishReason=', finish);
      return res.status(502).json({
        error: finish === 'SAFETY'
          ? 'The AI declined to analyse this panel. Review it manually with the member\'s doctor.'
          : 'The analysis came back empty — please try again.' });
    }

    let parsed;
    try {
      const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      try { parsed = JSON.parse(cleaned); }
      catch {
        const first = cleaned.indexOf('{'), last = cleaned.lastIndexOf('}');
        if (first === -1 || last <= first) throw new Error('no object found');
        parsed = JSON.parse(cleaned.slice(first, last + 1));
      }
    } catch (e) {
      const opens = (text.match(/{/g) || []).length, closes = (text.match(/}/g) || []).length;
      console.warn('lab-insight: parse failed |', finish, '| opens', opens, 'closes', closes,
                   '| starts:', text.slice(0, 120));
      return res.status(502).json({
        error: opens > closes
          ? 'This panel has too many markers to analyse in one pass — try again, or remove older results.'
          : 'Could not generate the analysis — please try again.' });
    }

    // Enforcement, not trust — but checking CLAIMS rather than vocabulary.
    // The first version matched bare words and rejected its own careful
    // phrasing: "this is not a diagnosis" and "the doctor should decide the
    // dose" were both blocked, which is precisely backwards.
    const screen = screenClinical(JSON.stringify(parsed));
    if (!screen.ok) {
      console.warn('lab-insight: rejected —', screen.matches.slice(0, 3).join('; '));
      return res.status(502).json({
        error: 'The analysis made a clinical claim it should not have, so it was discarded. Generating again usually produces a clean result.',
        rejected_for: screen.matches.slice(0, 3),
      });
    }

    // Macro targets are computed here, not by the model. Dividing calories
    // into grams is arithmetic, and a language model doing arithmetic produces
    // plausible-looking errors that nobody catches.
    let macros = null;
    const bw = parseFloat(wRes.rows[0]?.weight_kg) || parseFloat(p.start_weight) || null;
    if (bw && p.height_cm && p.dob) {
      const age = Math.floor((Date.now() - new Date(p.dob)) / (1000 * 60 * 60 * 24 * 365.25));
      const base = 10 * bw + 6.25 * parseFloat(p.height_cm) - 5 * age;
      const g = String(p.gender || '').toLowerCase();
      const bmr = Math.round(g === 'male' ? base + 5 : g === 'female' ? base - 161 : base - 78);
      const goal = p.target_weight && bw > parseFloat(p.target_weight) ? 'loss'
                 : p.target_weight && bw < parseFloat(p.target_weight) ? 'gain' : 'maintain';
      macros = macroTargets({
        weightKg: bw,
        maintenanceKcal: Math.round(bmr * 1.35),   // light activity baseline
        goal,
        actionable: t.actionable,
      });
    }

    res.json({
      generated: true,
      urgent: [],
      other: t.other,
      macro_targets: macros,
      markers_addressed: t.actionable.map(a => a.test_name),
      ...parsed,
      caveat: 'Nutritional guidance only. It does not interpret why a marker is abnormal, ' +
              'and it is not a substitute for the doctor who ordered the test.',
    });
  } catch (err) {
    console.error('POST /patients/:id/lab-insight error:', err.response?.status, err.message);
    res.status(502).json({ error: 'Could not generate the analysis — please try again' });
  }
});

// ── Cross-member learning ────────────────────────────────────────────────────
// Every member with enough data tells us something about the population the
// clinic actually serves. Mifflin-St Jeor was fitted on a Western sample in
// 1990; whether it runs high or low for these members is an empirical question
// this answers, and the answer improves every time someone reaches enough data.
//
// New members inherit that correction as their starting estimate, so they get
// a clinic-calibrated prediction from day one instead of a textbook one.
const { learn } = require('../services/learningModel');
const { analyse: analyseAdaptive } = require('../services/adaptiveEngine');

let PRIOR_CACHE = { at: 0, value: null };

async function populationPrior() {
  // Recomputed at most hourly — it moves slowly and the query touches everyone
  if (PRIOR_CACHE.value && Date.now() - PRIOR_CACHE.at < 3600_000) return PRIOR_CACHE.value;

  const { rows: members } = await pool.query(
    `SELECT u.id, pp.dob, pp.gender, pp.height_cm, pp.start_weight
     FROM users u JOIN patient_profiles pp ON pp.user_id = u.id
     WHERE u.role = 'patient' AND u.active = true
       AND pp.height_cm IS NOT NULL AND pp.dob IS NOT NULL`);

  const ratios = [];
  for (const m of members) {
    const { rows: logs } = await pool.query(
      `SELECT log_date, weight_kg, food_items FROM daily_logs
       WHERE patient_id = $1 AND log_date >= CURRENT_DATE - 90
       ORDER BY log_date ASC`, [m.id]);
    if (logs.length < 14) continue;

    const age = Math.floor((Date.now() - new Date(m.dob)) / (1000 * 60 * 60 * 24 * 365.25));
    const w = logs.filter(l => l.weight_kg).slice(-1)[0]?.weight_kg || m.start_weight;
    if (!w) continue;
    const base = 10 * parseFloat(w) + 6.25 * parseFloat(m.height_cm) - 5 * age;
    const g = String(m.gender || '').toLowerCase();
    const bmr = Math.round(g === 'male' ? base + 5 : g === 'female' ? base - 161 : base - 78);

    const a = analyseAdaptive(logs, { bmr });
    // Only members whose own estimate is trustworthy contribute to the prior
    if (a.observed_tdee && ['high', 'moderate'].includes(a.confidence) && a.predicted_tdee) {
      ratios.push(a.observed_tdee / a.predicted_tdee);
    }
  }

  let value;
  if (ratios.length < 3) {
    value = { factor: 1, n: ratios.length, basis: 'not enough calibrated members yet — using the textbook formula unadjusted' };
  } else {
    // Median, not mean: one badly under-logging member should not drag the
    // clinic-wide correction with them.
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    value = {
      factor: +median.toFixed(3),
      n: ratios.length,
      basis: `median of ${ratios.length} members whose own metabolism is well measured`,
    };
  }
  PRIOR_CACHE = { at: Date.now(), value };
  return value;
}

// The continuous model — what all of this member's natural variation implies
router.get('/:id/model', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
  try {
    const { rows: logs } = await pool.query(
      `SELECT log_date, weight_kg, food_items FROM daily_logs
       WHERE patient_id = $1 AND log_date >= CURRENT_DATE - $2::int
       ORDER BY log_date ASC`, [req.params.id, parseInt(req.query.days) || 180]);

    const { rows: sess } = await pool.query(
      `SELECT ws.session_date, ws.cardio,
              COALESCE(SUM(ss.reps * ss.weight_kg), 0) AS volume
       FROM workout_sessions ws
       LEFT JOIN session_sets ss ON ss.session_id = ws.id
       WHERE ws.patient_id = $1 AND ws.session_date >= CURRENT_DATE - $2::int
       GROUP BY ws.id, ws.session_date, ws.cardio`,
      [req.params.id, parseInt(req.query.days) || 180]);

    const { rows: prof } = await pool.query(
      `SELECT start_weight FROM patient_profiles WHERE user_id = $1`, [req.params.id]);

    // Rough per-day exercise calories: volume-based strength plus cardio minutes
    const byDate = {};
    for (const s of sess) {
      const d = String(s.session_date).slice(0, 10);
      const cardioMin = (Array.isArray(s.cardio) ? s.cardio : [])
        .reduce((t, c) => t + (parseFloat(c?.duration_min) || 0), 0);
      byDate[d] = Math.round(parseFloat(s.volume) * 0.08) + Math.round(cardioMin * 5);
    }

    const latest = logs.filter(l => l.weight_kg).slice(-1)[0]?.weight_kg || prof[0]?.start_weight;
    res.json(learn(logs, { bodyWeightKg: latest ? parseFloat(latest) : null, workoutKcalByDate: byDate }));
  } catch (err) {
    console.error('GET /patients/:id/model error:', err);
    res.status(500).json({ error: 'Could not build the model' });
  }
});

// ── Macro Lab (coach only) ───────────────────────────────────────────────────
// Adherence patterns and controlled macro trials. Deliberately has no member
// -facing route: a member told mid-trial how they're doing changes their
// behaviour, which destroys the measurement. They see only their targets.
const { adherence, compareArms } = require('../services/macroLab');

async function logsFor(patientId, days = 180) {
  const { rows } = await pool.query(
    `SELECT log_date, weight_kg, food_items
     FROM daily_logs
     WHERE patient_id = $1 AND log_date >= CURRENT_DATE - $2::int
     ORDER BY log_date ASC`, [patientId, days]);
  return rows;
}

// What split does this member actually sustain? No trial required.
router.get('/:id/adherence', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
  try {
    const { rows: prof } = await pool.query(
      `SELECT macro_kcal FROM patient_profiles WHERE user_id = $1`, [req.params.id]);
    const logs = await logsFor(req.params.id, parseInt(req.query.days) || 90);
    res.json(adherence(logs, { kcalTarget: prof[0]?.macro_kcal || null }));
  } catch (err) {
    console.error('GET /patients/:id/adherence error:', err);
    res.status(500).json({ error: 'Could not analyse adherence' });
  }
});

// Current or most recent trial, with the comparison if there is enough data
router.get('/:id/trial', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM macro_trials WHERE patient_id = $1
       ORDER BY created_at DESC LIMIT 1`, [req.params.id]);
    if (!rows.length) return res.json({ trial: null });

    const trial = rows[0];
    const logs = await logsFor(req.params.id, 240);
    const comparison = trial.b_started_on ? compareArms(logs, trial) : null;

    // Day counters so the coach knows when an arm is ready to switch
    const daysSince = d => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null;
    res.json({
      trial,
      days_in_arm: trial.current_arm === 'A'
        ? daysSince(trial.a_started_on) : daysSince(trial.b_started_on),
      comparison,
    });
  } catch (err) {
    console.error('GET /patients/:id/trial error:', err);
    res.status(500).json({ error: 'Could not load the trial' });
  }
});

// Start a trial. Applies arm A's macros to the protocol immediately.
router.post('/:id/trial', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
  const { arm_a, arm_b, arm_days = 28, washout_days = 10 } = req.body || {};
  const valid = a => a && [a.kcal, a.protein_g, a.carbs_g, a.fat_g].every(v => Number.isFinite(parseFloat(v)));
  if (!valid(arm_a) || !valid(arm_b)) {
    return res.status(400).json({ error: 'Both arms need kcal, protein_g, carbs_g and fat_g' });
  }
  // The comparison is only interpretable if these are held constant, so refuse
  // to start a trial that could never produce an attributable answer.
  if (Math.abs(arm_a.kcal - arm_b.kcal) > Math.max(100, arm_a.kcal * 0.06)) {
    return res.status(400).json({ error: 'Both arms must use the same calorie target — otherwise any difference is from calories, not the split' });
  }
  if (Math.abs(arm_a.protein_g - arm_b.protein_g) > 20) {
    return res.status(400).json({ error: 'Both arms must use the same protein target' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE macro_trials SET status='abandoned'
       WHERE patient_id = $1 AND status='running'`, [req.params.id]);
    const { rows } = await client.query(
      `INSERT INTO macro_trials
         (patient_id, coach_id, arm_a, arm_b, arm_days, washout_days, current_arm, a_started_on)
       VALUES ($1,$2,$3,$4,$5,$6,'A',CURRENT_DATE) RETURNING *`,
      [req.params.id, req.user.id, JSON.stringify(arm_a), JSON.stringify(arm_b),
       parseInt(arm_days), parseInt(washout_days)]);

    await client.query(
      `UPDATE patient_profiles
       SET macro_kcal=$1, macro_pro=$2, macro_carb=$3, macro_fat=$4, updated_at=NOW()
       WHERE user_id=$5`,
      [arm_a.kcal, arm_a.protein_g, arm_a.carbs_g, arm_a.fat_g, req.params.id]);
    await client.query('COMMIT');
    res.json({ trial: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /patients/:id/trial error:', err);
    res.status(500).json({ error: 'Could not start the trial' });
  } finally { client.release(); }
});

// Switch to arm B, or finish. Applying arm B's macros is part of switching.
router.post('/:id/trial/advance', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM macro_trials WHERE patient_id=$1 AND status='running'
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No running trial' }); }
    const trial = rows[0];

    if (trial.current_arm === 'A') {
      const b = trial.arm_b;
      await client.query(
        `UPDATE macro_trials SET current_arm='B', b_started_on=CURRENT_DATE WHERE id=$1`, [trial.id]);
      await client.query(
        `UPDATE patient_profiles
         SET macro_kcal=$1, macro_pro=$2, macro_carb=$3, macro_fat=$4, updated_at=NOW()
         WHERE user_id=$5`,
        [b.kcal, b.protein_g, b.carbs_g, b.fat_g, req.params.id]);
      await client.query('COMMIT');
      return res.json({ moved_to: 'B' });
    }

    const logs = await logsFor(req.params.id, 240);
    const result = compareArms(logs, trial);
    await client.query(
      `UPDATE macro_trials SET status='completed', completed_on=CURRENT_DATE, result=$2 WHERE id=$1`,
      [trial.id, JSON.stringify(result)]);
    await client.query('COMMIT');
    res.json({ completed: true, result });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /patients/:id/trial/advance error:', err);
    res.status(500).json({ error: 'Could not advance the trial' });
  } finally { client.release(); }
});

// ── Adaptive metabolic analysis ──────────────────────────────────────────────
// Derives a member's real maintenance calories from how their weight actually
// responded to what they ate, rather than trusting a population formula. See
// services/adaptiveEngine.js for the reasoning and its limits.
const { analyse } = require('../services/adaptiveEngine');

async function buildAdaptive(patientId, days = 60) {
  const [profileRes, logsRes] = await Promise.all([
    pool.query(
      `SELECT u.name, pp.dob, pp.gender, pp.height_cm, pp.start_weight, pp.target_weight
       FROM users u LEFT JOIN patient_profiles pp ON pp.user_id = u.id
       WHERE u.id = $1`, [patientId]),
    pool.query(
      `SELECT log_date, weight_kg, food_items
       FROM daily_logs
       WHERE patient_id = $1 AND log_date >= CURRENT_DATE - $2::int
       ORDER BY log_date ASC`, [patientId, days]),
  ]);

  const p = profileRes.rows[0] || {};
  let bmr = null;
  if (p.height_cm && p.dob) {
    const age = Math.floor((Date.now() - new Date(p.dob)) / (1000 * 60 * 60 * 24 * 365.25));
    const w = logsRes.rows.filter(r => r.weight_kg).slice(-1)[0]?.weight_kg
              || p.start_weight;
    if (w) {
      const base = 10 * parseFloat(w) + 6.25 * parseFloat(p.height_cm) - 5 * age;
      const g = String(p.gender || '').toLowerCase();
      bmr = Math.round(g === 'male' ? base + 5 : g === 'female' ? base - 161 : base - 78);
    }
  }

  const result = analyse(logsRes.rows, { bmr, goalWeight: p.target_weight });

  // Before a member has enough of their own history, fall back on what the
  // clinic's other members have shown about how well the formula fits them.
  if (!result.observed_tdee && result.predicted_tdee) {
    try {
      const prior = await populationPrior();
      if (prior.factor !== 1) {
        result.clinic_adjusted_tdee = Math.round(result.predicted_tdee * prior.factor);
        result.prior = prior;
      }
    } catch { /* the prior is a nicety, never a requirement */ }
  }

  return { name: p.name || 'Member', ...result };
}

// Member's own view
router.get('/me/adaptive', authMW, roleCheck('patient'), async (req, res) => {
  try {
    res.json(await buildAdaptive(req.user.id, parseInt(req.query.days) || 60));
  } catch (err) {
    console.error('GET /patients/me/adaptive error:', err);
    res.status(500).json({ error: 'Could not build the analysis' });
  }
});

// Coach's view of a member
router.get('/:id/adaptive', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
  try {
    res.json(await buildAdaptive(req.params.id, parseInt(req.query.days) || 60));
  } catch (err) {
    console.error('GET /patients/:id/adaptive error:', err);
    res.status(500).json({ error: 'Could not build the analysis' });
  }
});

// ── GET /api/patients/:id/weekly-summary ─────────────────────────────────────
// One week of a member's progress, condensed. Feeds the coach's one-tap
// "send weekly summary" action so they don't have to assemble it by hand.
router.get('/:id/weekly-summary', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
  const id = req.params.id;
  try {
    const [logsRes, workoutRes, profileRes] = await Promise.all([
      pool.query(
        `SELECT log_date, weight_kg, compliance_pct, food_items
         FROM daily_logs
         WHERE patient_id = $1 AND log_date >= CURRENT_DATE - 6
         ORDER BY log_date ASC`, [id]),
      pool.query(
        `SELECT ws.session_date, ws.cardio,
                COALESCE(SUM(ss.reps * ss.weight_kg), 0) AS volume_kg,
                COUNT(ss.id) AS set_count
         FROM workout_sessions ws
         LEFT JOIN session_sets ss ON ss.session_id = ws.id
         WHERE ws.patient_id = $1 AND ws.session_date >= CURRENT_DATE - 6
         GROUP BY ws.id, ws.session_date, ws.cardio`, [id]),
      pool.query(
        `SELECT u.name, pp.start_weight, pp.target_weight
         FROM users u JOIN patient_profiles pp ON pp.user_id = u.id
         WHERE u.id = $1`, [id]),
    ]);

    const logs = logsRes.rows;
    const weights = logs.filter(l => l.weight_kg != null).map(l => parseFloat(l.weight_kg));
    const compliances = logs.filter(l => l.compliance_pct != null).map(l => parseFloat(l.compliance_pct));
    const cardioMin = workoutRes.rows.reduce((s, w) => {
      const c = Array.isArray(w.cardio) ? w.cardio : [];
      return s + c.reduce((t, x) => t + (parseFloat(x?.duration_min) || 0), 0);
    }, 0);

    const p = profileRes.rows[0] || {};
    const first = weights[0], last = weights[weights.length - 1];

    res.json({
      name:            p.name || 'Member',
      days_logged:     logs.length,
      avg_compliance:  compliances.length
                        ? Math.round(compliances.reduce((a, b) => a + b, 0) / compliances.length) : null,
      weight_start:    first ?? null,
      weight_latest:   last ?? null,
      weight_change:   (first != null && last != null) ? +(last - first).toFixed(1) : null,
      target_weight:   p.target_weight ? parseFloat(p.target_weight) : null,
      total_volume_kg: Math.round(workoutRes.rows.reduce((s, w) => s + (parseFloat(w.volume_kg) || 0), 0)),
      total_sets:      workoutRes.rows.reduce((s, w) => s + (parseInt(w.set_count) || 0), 0),
      training_days:   workoutRes.rows.length,
      cardio_min:      Math.round(cardioMin),
      food_days:       logs.filter(l => Array.isArray(l.food_items) && l.food_items.length).length,
    });
  } catch (err) {
    console.error('GET /patients/:id/weekly-summary error:', err);
    res.status(500).json({ error: 'Failed to build weekly summary' });
  }
});

// ── POST /api/patients/me/notes/read ─────────────────────────────────────────
// Member marks coach message(s) as read. Once read, a note disappears from the
// Today page and lives on in the notification bell's message history.
// Body: { ids: [1,2,3] }  — omit ids to mark ALL of the member's notes read.
router.post('/me/notes/read', authMW, async (req, res) => {
  if (req.user.role !== 'patient') {
    return res.status(403).json({ error: 'Members only' });
  }
  const { ids } = req.body || {};
  try {
    let result;
    if (Array.isArray(ids) && ids.length) {
      const clean = ids.map(n => parseInt(n)).filter(Number.isFinite).slice(0, 100);
      if (!clean.length) return res.json({ updated: 0 });
      result = await pool.query(
        `UPDATE monitor_notes SET read_at = NOW()
         WHERE patient_id = $1 AND read_at IS NULL AND id = ANY($2::int[])
         RETURNING id`,
        [req.user.id, clean]
      );
    } else {
      result = await pool.query(
        `UPDATE monitor_notes SET read_at = NOW()
         WHERE patient_id = $1 AND read_at IS NULL
         RETURNING id`,
        [req.user.id]
      );
    }
    res.json({ updated: result.rowCount, ids: result.rows.map(r => r.id) });
  } catch (err) {
    console.error('POST /patients/me/notes/read error:', err);
    res.status(500).json({ error: 'Failed to mark messages read' });
  }
});

// ── PATCH /api/patients/:id/pin ───────────────────────────────────────────────
// Monitor/admin: set or reset a member's login PIN.
router.patch('/:id/pin', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
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
router.patch('/:id/weight', authMW, roleCheck('monitor', 'admin'), requirePatientAccess, async (req, res) => {
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
