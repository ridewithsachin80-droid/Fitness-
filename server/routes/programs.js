/**
 * server/routes/programs.js
 *
 * Resistance Training — Phase 2 (coach-assigned programs).
 *
 * A program is a named, multi-day exercise plan ("Push/Pull/Legs"). Two kinds:
 *   - Template  (patient_id IS NULL) — reusable, shared across all monitors,
 *     not yet assigned to anyone.
 *   - Assigned  (patient_id set)     — belongs to one patient. At most one
 *     ACTIVE assigned program per patient (enforced by a DB constraint, see
 *     schema.sql) — there's never ambiguity about "the current program."
 *
 * Assigning a template CLONES it into a new patient-specific program rather
 * than mutating the template in place — otherwise assigning "Push/Pull/Legs"
 * to one patient would silently change it for every other patient who might
 * get it assigned later.
 *
 * Routes:
 *   GET    /api/programs/templates        → list shared templates
 *   GET    /api/programs/active           → the calling patient's (or
 *                                            ?patient_id=, for monitors) active program
 *   GET    /api/programs/:id              → one program with its exercises by day
 *   POST   /api/programs                  → create a template or patient-specific program
 *   PUT    /api/programs/:id              → rename + replace its exercises
 *   POST   /api/programs/:id/assign       → clone a template onto a patient, activating it
 *   DELETE /api/programs/:id              → deactivate (soft delete)
 */

const router = require('express').Router();
const pool   = require('../db/pool');
const authMW = require('../middleware/auth');

router.use(authMW);

// Same authorization pattern as workouts.js / logs.js — a monitor may only
// act on patients actually assigned to them.
async function resolvePatientId(req, res, { required = true } = {}) {
  if (req.user.role === 'patient') return req.user.id;

  const patientId = req.query.patient_id || req.body?.patient_id;
  if (!patientId) {
    if (!required) return null;
    res.status(400).json({ error: 'patient_id is required for monitor/admin requests' });
    return undefined; // distinct from null=template-target; undefined signals "already responded"
  }

  if (req.user.role === 'monitor') {
    const linkCheck = await pool.query(
      `SELECT 1 FROM monitor_patients WHERE monitor_id = $1 AND patient_id = $2 AND active = true`,
      [req.user.id, patientId]
    );
    if (!linkCheck.rows.length) {
      res.status(403).json({ error: 'Patient not assigned to you' });
      return undefined;
    }
  }
  return parseInt(patientId);
}

// Loads a program's exercises grouped by day, with exercise names joined in.
async function loadProgramDays(programId) {
  const { rows } = await pool.query(
    `SELECT pe.id, pe.exercise_id, e.name AS exercise_name, e.muscle_group,
            pe.day_number, pe.day_label, pe.order_index,
            pe.target_sets, pe.target_reps_min, pe.target_reps_max
     FROM program_exercises pe
     JOIN exercises e ON e.id = pe.exercise_id
     WHERE pe.program_id = $1
     ORDER BY pe.day_number, pe.order_index`,
    [programId]
  );

  const byDay = new Map();
  for (const row of rows) {
    if (!byDay.has(row.day_number)) {
      byDay.set(row.day_number, { day_number: row.day_number, day_label: row.day_label || `Day ${row.day_number}`, exercises: [] });
    }
    byDay.get(row.day_number).exercises.push({
      id: row.id, exercise_id: row.exercise_id, exercise_name: row.exercise_name, muscle_group: row.muscle_group,
      target_sets: row.target_sets, target_reps_min: row.target_reps_min, target_reps_max: row.target_reps_max,
    });
  }
  return [...byDay.values()].sort((a, b) => a.day_number - b.day_number);
}

// Writes a full set of program_exercises rows for a program — used by both
// create and update, replacing wholesale rather than diffing (same simple,
// safe approach used throughout this app's other "save a whole thing" routes).
async function writeProgramDays(client, programId, days) {
  await client.query(`DELETE FROM program_exercises WHERE program_id = $1`, [programId]);
  for (const day of days || []) {
    const dayNumber = parseInt(day.day_number) || 1;
    let orderIndex = 0;
    for (const ex of day.exercises || []) {
      if (!ex.exercise_id) continue;

      // Clamp to a sane minimum of 1 — `parseInt(x) || 3` alone is
      // inconsistent (silently treats 0 as "unset" but lets -1 through
      // unclamped), and a negative or zero target set/rep count is never
      // actually meaningful.
      const targetSets    = Math.max(1, parseInt(ex.target_sets) || 3);
      const targetRepsMin = Math.max(1, parseInt(ex.target_reps_min) || 8);
      const repsMaxRaw     = ex.target_reps_max ? parseInt(ex.target_reps_max) : null;
      // A max that isn't actually greater than the min is a meaningless
      // range (e.g. "10-8") — drop it rather than store something that
      // would display backwards.
      const targetRepsMax = (repsMaxRaw && repsMaxRaw > targetRepsMin) ? repsMaxRaw : null;

      await client.query(
        `INSERT INTO program_exercises
           (program_id, exercise_id, day_number, day_label, order_index, target_sets, target_reps_min, target_reps_max)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [programId, ex.exercise_id, dayNumber, day.day_label || null, orderIndex, targetSets, targetRepsMin, targetRepsMax]
      );
      orderIndex++;
    }
  }
}

// ── GET /api/programs/templates ──────────────────────────────────────────────
router.get('/templates', async (req, res) => {
  if (req.user.role === 'patient') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows } = await pool.query(
      `SELECT id, name, created_by, created_at FROM workout_programs
       WHERE patient_id IS NULL AND active = true ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /programs/templates error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/programs/active ──────────────────────────────────────────────────
router.get('/active', async (req, res) => {
  const patientId = await resolvePatientId(req, res);
  if (patientId === undefined) return;

  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM workout_programs WHERE patient_id = $1 AND active = true LIMIT 1`,
      [patientId]
    );
    const program = rows[0];
    if (!program) return res.json({ program: null, days: [] });

    const days = await loadProgramDays(program.id);
    res.json({ program, days });
  } catch (err) {
    console.error('GET /programs/active error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/programs/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, patient_id, created_by, active FROM workout_programs WHERE id = $1`,
      [req.params.id]
    );
    const program = rows[0];
    if (!program) return res.status(404).json({ error: 'Program not found' });

    if (program.patient_id) {
      if (req.user.role === 'patient' && program.patient_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (req.user.role === 'monitor') {
        const linkCheck = await pool.query(
          `SELECT 1 FROM monitor_patients WHERE monitor_id = $1 AND patient_id = $2 AND active = true`,
          [req.user.id, program.patient_id]
        );
        if (!linkCheck.rows.length) return res.status(403).json({ error: 'Forbidden' });
      }
    } else if (req.user.role === 'patient') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const days = await loadProgramDays(program.id);
    res.json({ program, days });
  } catch (err) {
    console.error('GET /programs/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/programs ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  if (req.user.role === 'patient') return res.status(403).json({ error: 'Forbidden' });

  const { name, days = [] } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Program name is required' });

  let patientId = null;
  if (req.body.patient_id) {
    patientId = await resolvePatientId(req, res);
    if (patientId === undefined) return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (patientId) {
      await client.query(
        `UPDATE workout_programs SET active = false WHERE patient_id = $1 AND active = true`,
        [patientId]
      );
    }

    const inserted = await client.query(
      `INSERT INTO workout_programs (name, patient_id, created_by, active)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [name.trim(), patientId, req.user.id]
    );
    const programId = inserted.rows[0].id;
    await writeProgramDays(client, programId, days);

    await client.query('COMMIT');
    res.status(201).json({ id: programId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /programs error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── PUT /api/programs/:id ─────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  if (req.user.role === 'patient') return res.status(403).json({ error: 'Forbidden' });

  const { name, days = [] } = req.body;
  const client = await pool.connect();
  try {
    const existing = await client.query(`SELECT patient_id FROM workout_programs WHERE id = $1`, [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Program not found' });

    const targetPatientId = existing.rows[0].patient_id;
    if (targetPatientId && req.user.role === 'monitor') {
      const linkCheck = await client.query(
        `SELECT 1 FROM monitor_patients WHERE monitor_id = $1 AND patient_id = $2 AND active = true`,
        [req.user.id, targetPatientId]
      );
      if (!linkCheck.rows.length) return res.status(403).json({ error: 'Forbidden' });
    }

    await client.query('BEGIN');
    if (name && name.trim()) {
      await client.query(`UPDATE workout_programs SET name = $1 WHERE id = $2`, [name.trim(), req.params.id]);
    }
    await writeProgramDays(client, req.params.id, days);
    await client.query('COMMIT');
    res.json({ updated: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT /programs/:id error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── POST /api/programs/:id/assign ─────────────────────────────────────────────
router.post('/:id/assign', async (req, res) => {
  if (req.user.role === 'patient') return res.status(403).json({ error: 'Forbidden' });

  const patientId = await resolvePatientId(req, res);
  if (patientId === undefined) return;

  const client = await pool.connect();
  try {
    const sourceRes = await client.query(`SELECT id, name, patient_id FROM workout_programs WHERE id = $1`, [req.params.id]);
    const source = sourceRes.rows[0];
    if (!source) return res.status(404).json({ error: 'Program not found' });
    if (source.patient_id !== null) {
      return res.status(400).json({ error: 'Can only assign templates (not a patient-specific program) — create a new program for one-off cases.' });
    }

    const days = await loadProgramDays(source.id);

    await client.query('BEGIN');
    await client.query(
      `UPDATE workout_programs SET active = false WHERE patient_id = $1 AND active = true`,
      [patientId]
    );
    const cloned = await client.query(
      `INSERT INTO workout_programs (name, patient_id, created_by, active)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [source.name, patientId, req.user.id]
    );
    const newProgramId = cloned.rows[0].id;
    await writeProgramDays(client, newProgramId, days.map(d => ({
      day_number: d.day_number, day_label: d.day_label,
      exercises: d.exercises.map(e => ({
        exercise_id: e.exercise_id, target_sets: e.target_sets,
        target_reps_min: e.target_reps_min, target_reps_max: e.target_reps_max,
      })),
    })));
    await client.query('COMMIT');
    res.status(201).json({ id: newProgramId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /programs/:id/assign error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── DELETE /api/programs/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  if (req.user.role === 'patient') return res.status(403).json({ error: 'Forbidden' });
  try {
    const existing = await pool.query(`SELECT patient_id FROM workout_programs WHERE id = $1`, [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Program not found' });

    const targetPatientId = existing.rows[0].patient_id;
    if (targetPatientId && req.user.role === 'monitor') {
      const linkCheck = await pool.query(
        `SELECT 1 FROM monitor_patients WHERE monitor_id = $1 AND patient_id = $2 AND active = true`,
        [req.user.id, targetPatientId]
      );
      if (!linkCheck.rows.length) return res.status(403).json({ error: 'Forbidden' });
    }

    await pool.query(`UPDATE workout_programs SET active = false WHERE id = $1`, [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /programs/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
