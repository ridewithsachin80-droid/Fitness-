/**
 * server/routes/workouts.js
 *
 * Resistance Training — Phase 1 (freeform logging).
 *
 * Routes:
 *   GET  /api/workouts/exercises          → search/list the exercise library
 *   POST /api/workouts/exercises          → add a custom exercise
 *   GET  /api/workouts?date=YYYY-MM-DD    → get a patient's session (+ sets) for one day
 *   POST /api/workouts                    → save/replace a day's session + sets
 *   GET  /api/workouts/history/:exerciseId → past sets for one exercise (for "last time" context, Phase 3 charts)
 *
 * Auth: authenticated users only. Patients act on their own data implicitly
 * (no patient_id in the request body) — monitors/admins can pass ?patient_id=
 * to view/edit on a patient's behalf, matching the pattern used in logs.js.
 */

const router = require('express').Router();
const pool   = require('../db/pool');
const authMW = require('../middleware/auth');

router.use(authMW);

// Resolve which patient's data this request is for, with the same
// authorization check used everywhere else in this codebase (logs.js,
// patients.js): a monitor may only act on patients actually assigned to
// them. Returns null (and has already sent the response) on failure —
// callers must check for that and return immediately.
async function resolvePatientId(req, res) {
  if (req.user.role === 'patient') return req.user.id;

  const patientId = req.query.patient_id || req.body?.patient_id;
  if (!patientId) {
    res.status(400).json({ error: 'patient_id is required for monitor/admin requests' });
    return null;
  }

  if (req.user.role === 'monitor') {
    const linkCheck = await pool.query(
      `SELECT 1 FROM monitor_patients WHERE monitor_id = $1 AND patient_id = $2 AND active = true`,
      [req.user.id, patientId]
    );
    if (!linkCheck.rows.length) {
      res.status(403).json({ error: 'Patient not assigned to you' });
      return null;
    }
  }
  // Admins fall through with no restriction, matching logs.js/patients.js.
  return parseInt(patientId);
}

// ── GET /api/workouts/exercises ──────────────────────────────────────────────
// Search the exercise library by name, optionally filtered by muscle group.
// Shared globally across all users — see the note on POST /exercises below
// for why this isn't scoped per-creator.
router.get('/exercises', async (req, res) => {
  const q = (req.query.q || '').trim();
  const muscleGroup = req.query.muscle_group;

  try {
    const conditions = ['1=1'];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }
    if (muscleGroup) {
      params.push(muscleGroup);
      conditions.push(`muscle_group = $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT id, name, muscle_group, equipment, created_by
       FROM exercises
       WHERE ${conditions.join(' AND ')}
       ORDER BY name ASC
       LIMIT 50`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /workouts/exercises error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/workouts/exercises ─────────────────────────────────────────────
// Add a custom exercise not in the built-in library (e.g. a machine specific
// to the user's gym). created_by is kept purely as audit metadata (who
// added it) — NOT used to scope visibility. Exercise names aren't sensitive,
// and per-creator scoping caused two real bugs: a monitor adding one on a
// patient's behalf made it invisible to that patient afterward, and two
// different people adding the same name would silently collide on the
// global UNIQUE(name) constraint and steal each other's row. Sharing the
// library globally sidesteps both.
router.post('/exercises', async (req, res) => {
  const { name, muscle_group, equipment } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Exercise name is required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO exercises (name, muscle_group, equipment, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, muscle_group, equipment, created_by`,
      [name.trim(), muscle_group || null, equipment || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /workouts/exercises error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/workouts ────────────────────────────────────────────────────────
// Returns the session (+ its sets, grouped by exercise) for one date.
// Returns { session: null, exercises: [] } if nothing logged that day.
router.get('/', async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date query param is required' });

  const patientId = await resolvePatientId(req, res);
  if (patientId === null) return; // resolvePatientId already sent the error response

  try {
    const sessionRes = await pool.query(
      `SELECT id, session_date, duration_min, notes
       FROM workout_sessions
       WHERE patient_id = $1 AND session_date = $2
       ORDER BY id DESC LIMIT 1`,
      [patientId, date]
    );
    const session = sessionRes.rows[0];
    if (!session) return res.json({ session: null, exercises: [] });

    const setsRes = await pool.query(
      `SELECT s.id, s.exercise_id, e.name AS exercise_name, e.muscle_group,
              s.set_number, s.reps, s.weight_kg
       FROM session_sets s
       JOIN exercises e ON e.id = s.exercise_id
       WHERE s.session_id = $1
       ORDER BY s.exercise_id, s.set_number`,
      [session.id]
    );

    // Group flat set rows into [{ exercise_id, exercise_name, sets: [...] }]
    const byExercise = new Map();
    for (const row of setsRes.rows) {
      if (!byExercise.has(row.exercise_id)) {
        byExercise.set(row.exercise_id, {
          exercise_id: row.exercise_id,
          exercise_name: row.exercise_name,
          muscle_group: row.muscle_group,
          sets: [],
        });
      }
      byExercise.get(row.exercise_id).sets.push({
        set_number: row.set_number, reps: row.reps, weight_kg: parseFloat(row.weight_kg),
      });
    }

    res.json({ session, exercises: [...byExercise.values()] });
  } catch (err) {
    console.error('GET /workouts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/workouts ───────────────────────────────────────────────────────
// Save (or fully replace) a day's session. Body:
// { date, duration_min?, notes?, exercises: [{ exercise_id, sets: [{reps, weight_kg}] }] }
// Replacing rather than diffing keeps this simple and matches how the rest of
// the app's daily log already works (full save on each change, auto-saved).
router.post('/', async (req, res) => {
  const { date, duration_min, notes, exercises = [] } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const patientId = await resolvePatientId(req, res);
  if (patientId === null) return; // resolvePatientId already sent the error response
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Atomic upsert — relies on the UNIQUE(patient_id, session_date)
    // constraint, so two concurrent saves for the same day (e.g. a network
    // retry firing twice) can't create duplicate session rows the way a
    // separate SELECT-then-INSERT-or-UPDATE could.
    const upserted = await client.query(
      `INSERT INTO workout_sessions (patient_id, session_date, duration_min, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (patient_id, session_date)
       DO UPDATE SET duration_min = EXCLUDED.duration_min, notes = EXCLUDED.notes
       RETURNING id`,
      [patientId, date, duration_min || null, notes || null]
    );
    const sessionId = upserted.rows[0].id;

    // Replace all sets for this session — simplest correct approach for a
    // freeform logger with no per-set IDs round-tripping from the client.
    await client.query(`DELETE FROM session_sets WHERE session_id = $1`, [sessionId]);

    for (const ex of exercises) {
      if (!ex.exercise_id || !Array.isArray(ex.sets)) continue;
      let setNumber = 1;
      for (const set of ex.sets) {
        const reps = parseInt(set.reps);
        const weight = parseFloat(set.weight_kg) || 0;
        if (!reps || reps <= 0) continue; // skip incomplete rows
        await client.query(
          `INSERT INTO session_sets (session_id, exercise_id, set_number, reps, weight_kg)
           VALUES ($1, $2, $3, $4, $5)`,
          [sessionId, ex.exercise_id, setNumber, reps, weight]
        );
        setNumber++;
      }
    }

    await client.query('COMMIT');
    res.json({ saved: true, session_id: sessionId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /workouts error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── GET /api/workouts/history/:exerciseId ────────────────────────────────────
// Past sets for one exercise, oldest-to-newest — feeds Phase 3's trend
// charts and PR detection directly (chronological order is what both need).
// Limits by SESSION COUNT, not row count — the old row-based limit could
// truncate a session's sets partway through, corrupting that session's
// volume/best-set calculation. Fetching whole sessions avoids that entirely.
router.get('/history/:exerciseId', async (req, res) => {
  const patientId = await resolvePatientId(req, res);
  if (patientId === null) return; // resolvePatientId already sent the error response
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit) || 20));

  try {
    const { rows } = await pool.query(
      `SELECT ws.session_date, s.set_number, s.reps, s.weight_kg
       FROM session_sets s
       JOIN workout_sessions ws ON ws.id = s.session_id
       WHERE ws.patient_id = $1
         AND s.exercise_id = $2
         AND ws.session_date IN (
           SELECT DISTINCT ws2.session_date
           FROM session_sets s2
           JOIN workout_sessions ws2 ON ws2.id = s2.session_id
           WHERE ws2.patient_id = $1 AND s2.exercise_id = $2
           ORDER BY ws2.session_date DESC
           LIMIT $3
         )
       ORDER BY ws.session_date ASC, s.set_number ASC`,
      [patientId, req.params.exerciseId, limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /workouts/history error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/workouts/logged-exercises ───────────────────────────────────────
// Distinct exercises this patient has actually logged at least one set for —
// feeds the Progress page's exercise picker. Only showing exercises with
// real history (not the full ~45-exercise library) keeps that dropdown
// relevant instead of mostly-empty options.
router.get('/logged-exercises', async (req, res) => {
  const patientId = await resolvePatientId(req, res);
  if (patientId === null) return;

  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.name, e.muscle_group, MAX(ws.session_date) AS last_logged
       FROM session_sets s
       JOIN exercises e ON e.id = s.exercise_id
       JOIN workout_sessions ws ON ws.id = s.session_id
       WHERE ws.patient_id = $1
       GROUP BY e.id, e.name, e.muscle_group
       ORDER BY last_logged DESC`,
      [patientId]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /workouts/logged-exercises error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/workouts/muscle-coverage ────────────────────────────────────────
// "Which muscles worked, which are left to do" — one shared dataset feeding
// three lenses at once: session count this week, total sets (volume) this
// week, and days since last worked (to flag genuinely stale groups, not just
// today's gaps). Tracks 6 major groups; full_body exercises (Burpees,
// Kettlebell Swing, etc.) count toward ALL of them, since that's mechanically
// accurate — they're not isolated to one area.
//
// `today` must be passed by the client (its own IST-correct date string,
// same convention used everywhere else in this app) rather than relying on
// the server's own clock, which runs in UTC and would be a few hours off
// near midnight IST.
const MUSCLE_GROUPS = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core'];
const LOOKBACK_DAYS = 60; // generous window so "last worked" can detect genuinely stale groups, not just this week's gaps

router.get('/muscle-coverage', async (req, res) => {
  const patientId = await resolvePatientId(req, res);
  if (patientId === null) return;

  const today = req.query.today;
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return res.status(400).json({ error: 'today (YYYY-MM-DD) is required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT e.muscle_group, ws.session_date, COUNT(*) AS set_count
       FROM session_sets s
       JOIN exercises e ON e.id = s.exercise_id
       JOIN workout_sessions ws ON ws.id = s.session_id
       WHERE ws.patient_id = $1
         AND ws.session_date >= $2::date - INTERVAL '${LOOKBACK_DAYS} days'
         AND ws.session_date <= $2::date
       GROUP BY e.muscle_group, ws.session_date`,
      [patientId, today]
    );

    // Expand full_body rows to count toward every tracked group, then collapse
    // everything into per-group { date -> setCount } maps for aggregation.
    const byGroup = Object.fromEntries(MUSCLE_GROUPS.map(g => [g, new Map()]));
    for (const row of rows) {
      const setCount = parseInt(row.set_count) || 0;
      const targets = row.muscle_group === 'full_body' ? MUSCLE_GROUPS : [row.muscle_group];
      for (const g of targets) {
        if (!byGroup[g]) continue; // unrecognised/legacy muscle_group value — skip rather than crash
        const map = byGroup[g];
        map.set(row.session_date, (map.get(row.session_date) || 0) + setCount);
      }
    }

    const todayDate = new Date(today + 'T00:00:00');
    const sevenDaysAgo = new Date(todayDate); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const groups = {};
    for (const g of MUSCLE_GROUPS) {
      const map = byGroup[g];
      const dates = [...map.keys()];
      const within7d = dates.filter(d => new Date(d + 'T00:00:00') >= sevenDaysAgo);

      let lastWorked = null, daysSince = null;
      if (dates.length > 0) {
        lastWorked = dates.sort().at(-1); // ISO date strings sort correctly lexicographically
        daysSince = Math.round((todayDate - new Date(lastWorked + 'T00:00:00')) / 86400000);
      }

      groups[g] = {
        sessions7d: within7d.length,
        sets7d: within7d.reduce((sum, d) => sum + map.get(d), 0),
        lastWorked,
        daysSince, // null = never logged within the lookback window at all
      };
    }

    res.json({ groups, lookbackDays: LOOKBACK_DAYS });
  } catch (err) {
    console.error('GET /workouts/muscle-coverage error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
