const router = require('express').Router();
const pool = require('../db/pool');
const authMW = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');

// ── IST date helper ──────────────────────────────────────────────────────────
// Railway runs in UTC. India is UTC+5:30. Always use IST for business-date
// comparisons so members aren't rejected for "future date" between midnight
// and 5:30 AM IST.
// Was a local copy; now the shared one in utils/istDate.js.
const { getISTDate } = require('../utils/istDate');



// ── Compliance calculator ────────────────────────────────────────────────────
// Uses protocol_total when provided by the client (protocol-aware denominator).
// Falls back to counting only the keys that are present in the log objects,
// which reflects whatever the client sent — correct for custom protocols.
// Never hardcodes 16; uses the actual number of assigned items.
// calcCompliance moved to services/compliance.js. Voice logging writes
// daily_logs too, and two definitions of "how compliant was today" would mean
// the same day scoring differently depending on whether the member typed it or
// spoke it — with the coach's dashboard showing whichever landed last.
const { calcCompliance } = require('../services/compliance');
const { withMemberLock } = require('../db/locks');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A date that exists on the calendar. The regex alone let 2026-13-45 through
 *  to Postgres, which answered with an error and the route with a 500. */
function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ── GET /api/logs/recent-foods ────────────────────────────────────────────────
// Sprint 12: Returns the top 8 most-used foods from the member's last 30 logs.
// Used by FoodLog.jsx to show "Recently used" quick-add shortcuts.
router.get('/recent-foods', authMW, roleCheck('patient'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT food_items
       FROM daily_logs
       WHERE patient_id = $1 AND food_items IS NOT NULL
       ORDER BY log_date DESC
       LIMIT 30`,
      [req.user.id]
    );

    // Aggregate: count each food_id/name across all recent logs
    const freq = {};
    for (const row of result.rows) {
      const items = Array.isArray(row.food_items) ? row.food_items : [];
      for (const item of items) {
        const key = item.food_id ? `id:${item.food_id}` : `name:${item.name}`;
        if (!freq[key]) {
          freq[key] = {
            food_id:  item.food_id  || null,
            name:     item.name     || item.food_name,
            per_100g: item.per_100g || null,
            count:    0,
            last_g:   item.grams,
          };
        }
        freq[key].count++;
        freq[key].last_g = item.grams; // update to most recent gram amount
      }
    }

    const top8 = Object.values(freq)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map(({ food_id, name, per_100g, count, last_g }) => ({
        food_id, name, per_100g, count, last_g,
      }));

    res.json(top8);
  } catch (err) {
    console.error('GET /logs/recent-foods error:', err.message);
    res.status(500).json({ error: 'Failed to fetch recent foods' });
  }
});


// ── GET /api/logs/range/:from/:to ─────────────────────────────────────────────
// Returns logs between two YYYY-MM-DD dates (inclusive), ordered newest first.
// Used for the weight chart and monitor history view.
router.get('/range/:from/:to', authMW, async (req, res) => {
  try {
    const { from, to } = req.params;

    // Validate date format
    if (!isRealDate(from) || !isRealDate(to)) {
      return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
    }

    let patientId;
    if (req.user.role === 'patient') {
      // Patients can only read their own logs — ignore any patientId param
      patientId = req.user.id;
    } else {
      // Monitors and admins must supply patientId
      patientId = req.query.patientId;
      if (!patientId) {
        return res.status(400).json({ error: 'patientId query param required' });
      }
      // Monitors can only access their assigned patients
      if (req.user.role === 'monitor') {
        const linkCheck = await pool.query(
          `SELECT 1 FROM monitor_patients
           WHERE monitor_id = $1 AND patient_id = $2 AND active = true`,
          [req.user.id, patientId]
        );
        if (!linkCheck.rows.length) {
          return res.status(403).json({ error: 'Member not assigned to you' });
        }
      }
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



// ── GET /api/logs/:date ──────────────────────────────────────────────────────
// Returns the log for the given YYYY-MM-DD date.
// Patients: always their own log.
// Monitors/admins: pass ?patientId=X to view a specific patient.
router.get('/:date', authMW, async (req, res) => {
  try {
    const { date } = req.params;

    // Validate date format
    if (!isRealDate(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    let patientId;
    if (req.user.role === 'patient') {
      // Patients can only read their own logs — ignore any patientId param
      patientId = req.user.id;
    } else {
      patientId = req.query.patientId;
      if (!patientId) {
        return res.status(400).json({ error: 'patientId query param required (DB param name — see RENAME.md)' });
      }
      // Monitors can only access their assigned patients — admins bypass.
      // (Same check the /range/:from/:to route above already does correctly;
      // this route was missing it entirely.)
      if (req.user.role === 'monitor') {
        const linkCheck = await pool.query(
          `SELECT 1 FROM monitor_patients
           WHERE monitor_id = $1 AND patient_id = $2 AND active = true`,
          [req.user.id, patientId]
        );
        if (!linkCheck.rows.length) {
          return res.status(403).json({ error: 'Member not assigned to you' });
        }
      }
    }

    const [logResult, profileResult] = await Promise.all([
      pool.query('SELECT * FROM daily_logs WHERE patient_id = $1 AND log_date = $2', [patientId, date]),
      // SELECT * so this works on both Sprint 1 schema (no fasting/macro columns)
      // and Sprint 2 schema. Missing columns just come back as undefined → handled
      // safely below with || null checks.
      pool.query('SELECT * FROM patient_profiles WHERE user_id = $1', [patientId]),
    ]);

    const log     = logResult.rows[0] || null;
    const profile = profileResult.rows[0] || {};

    // Build protocol — Sprint 1 items + Sprint 2 fasting/macros
    const protocol = {
      activities:         profile.protocol_activities  || null,
      acv:                profile.protocol_acv         || null,
      supplements:        profile.protocol_supplements || null,
      custom_activities:  profile.custom_activities    || [],
      custom_acv:         profile.custom_acv           || [],
      custom_supplements: profile.custom_supplements   || [],
      item_overrides:     profile.item_overrides       || {},
      // Sprint 2: null = not set = not shown to member
      fasting: profile.fasting_start ? {
        start: profile.fasting_start,
        end:   profile.fasting_end,
        note:  profile.fasting_note  || null,
        label: profile.fasting_label || null,
      } : null,
      macros: profile.macro_kcal ? {
        kcal:  profile.macro_kcal,
        pro:   profile.macro_pro,
        carb:  profile.macro_carb,
        fat:   profile.macro_fat,
        phase: profile.macro_phase || null,
      } : null,
      // Sprint 3: meal plan (null = not set)
      meal_plan: profile.meal_plan || null,
      // Sprint 5: per-member RDA overrides (null = use defaults)
      rda_overrides: profile.rda_overrides || {},
      // For calorie burn calculation (Sprint 4)
      start_weight:  profile.start_weight  || null,
      // Sprint 15: per-member water target (ml) — set by monitor in patient profile
      water_target:  profile.water_target  || 3000,
      // The member's own sleep target, "HH:MM" 24-hour. null = the house
      // default (the client's lib/day/sleep.js decides what that is).
      sleep_bed:     profile.sleep_bed     || null,
      sleep_wake:    profile.sleep_wake    || null,
    };

    res.json(log ? { ...log, protocol } : { protocol });
  } catch (err) {
    console.error('GET /logs/:date error:', err);
    res.status(500).json({ error: 'Failed to fetch log' });
  }
});

// ── POST /api/logs/:date ─────────────────────────────────────────────────────
// Upsert (insert or update) the daily log for a patient.
// Only the patient themselves can save their own log.
//
// Three things changed here after the audit, all reproduced against a real
// database before being fixed:
//
//   1. THE BODY IS VALIDATED. food_items sent as text instead of a list was
//      stored as-is, and from then on the admin overview returned 500 for
//      everyone. Shapes are now checked and a bad day is refused with a 400.
//
//   2. ONE WRITER AT A TIME. The read-then-write below runs under the
//      per-member lock (db/locks.js), so it cannot interleave with voice
//      logging or a second save.
//
//   3. A SAVE FROM AN OUT-OF-DATE APP NO LONGER ERASES NEWER DATA. See
//      mergeLiveDay in services/dayMerge.js for the rule and the reason.
const DAY_FLOOR = '2020-01-01';   // nothing real is older than the product

function dayShapeError(b) {
  if (b.food_items !== undefined && b.food_items !== null) {
    if (!Array.isArray(b.food_items)) return 'food_items must be a list';
    if (b.food_items.length > 300) return 'That is too many food items for one day';
    if (b.food_items.some(i => !isObj(i))) return 'Each food item must be an object';
  }
  for (const f of ['activities', 'acv', 'supplements', 'sleep']) {
    if (b[f] !== undefined && b[f] !== null && !isObj(b[f])) return `${f} must be an object`;
  }
  if (b.notes !== undefined && b.notes !== null && typeof b.notes !== 'string') return 'notes must be text';
  if (typeof b.notes === 'string' && b.notes.length > 4000) return 'Notes can be 4,000 characters at most';
  return null;
}

router.post('/:date', authMW, roleCheck('patient'), async (req, res) => {
  try {
    const { date } = req.params;

    if (!isRealDate(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    // Block future dates
    const today = getISTDate();  // IST date — avoids rejecting logs saved between midnight-5:30 AM IST
    if (date > today) {
      return res.status(400).json({ error: 'Cannot log future dates' });
    }
    if (date < DAY_FLOOR) {
      return res.status(400).json({ error: 'That date is too far back' });
    }

    const body = isObj(req.body) ? req.body : {};
    const shapeError = dayShapeError(body);
    if (shapeError) return res.status(400).json({ error: shapeError });

    // null and undefined both mean "empty". JSON.stringify(null) is the JSON
    // value null, which is not SQL NULL and breaks jsonb_each() later.
    const objOr = (v) => (isObj(v) ? v : {});
    // protocol_total: sent by client = number of assigned checkable items for this patient.
    // Allows server-side compliance to match the patient's actual custom protocol.
    const { protocol_total } = body;
    // Clamp water — it reached the DB unvalidated, so a negative or absurd
    // value would corrupt the hydration bar and the coach's view of the day.
    const safeWater = Math.min(20000, Math.max(0, parseInt(body.water_ml) || 0));

    // Clamp weight to the same range the client warns on, so a fat-fingered
    // entry can't poison weight trends and BMR/TDEE calculations.
    const parsedWeight = parseFloat(body.weight_kg);
    const safeWeight = Number.isFinite(parsedWeight) && parsedWeight >= 20 && parsedWeight <= 400
      ? parsedWeight
      : null;

    const incoming = {
      weight_kg:   safeWeight,
      activities:  objOr(body.activities),
      acv:         objOr(body.acv),
      food_items:  Array.isArray(body.food_items) ? body.food_items : [],
      water_ml:    safeWater,
      supplements: objOr(body.supplements),
      sleep:       objOr(body.sleep),
      notes:       typeof body.notes === 'string' ? body.notes : '',
    };
    const patientId = req.user.id;
    const { mergeOfflineDay, mergeLiveDay, isStale } = require('../services/dayMerge');

    const out = await withMemberLock(patientId, async (db) => {
      const { rows: [stored] } = await db.query(
        `SELECT * FROM daily_logs WHERE patient_id = $1 AND log_date = $2 FOR UPDATE`, [patientId, date]);
      const stale = isStale(stored, body.base_saved_at);

      // ── An offline copy arriving after newer edits (services/dayMerge.js) ──
      // Only replays from the offline queue say offline_replay. If the day was
      // written since the phone loaded it, merge food and keep the rest, rather
      // than let a stale copy wipe what was logged meanwhile.
      if (body.offline_replay === true && stale) {
        const m = mergeOfflineDay(stored, { ...body, ...incoming }, body.base_food_ids);
        const { rows: [saved] } = await db.query(
          `UPDATE daily_logs SET food_items = $3, saved_at = NOW()
            WHERE patient_id = $1 AND log_date = $2 RETURNING *`,
          [patientId, date, JSON.stringify(m.food_items)]);
        return { saved, extra: { merged: true, kept_server: m.kept_server, food_added: m.added, food_removed: m.removed } };
      }

      // ── An online save from an app that is behind the server ──────────────
      let doc = incoming, extra = {};
      if (stale && isObj(body.base_fields)) {
        const m = mergeLiveDay(stored, incoming, body.base_food_ids, body.base_fields);
        doc = { ...incoming, ...m.doc, notes: typeof m.doc.notes === 'string' ? m.doc.notes : '' };
        extra = { merged_live: true, kept_server: m.kept_server, food_added: m.food_added, food_removed: m.food_removed };
      }

      const compliance_pct = calcCompliance(doc.activities, doc.acv, doc.supplements, protocol_total || null);
      const { rows: [saved] } = await db.query(
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
          doc.weight_kg,
          JSON.stringify(doc.activities),
          JSON.stringify(doc.acv),
          JSON.stringify(doc.food_items),
          doc.water_ml,
          JSON.stringify(doc.supplements),
          JSON.stringify(doc.sleep),
          doc.notes,
          compliance_pct,
        ]
      );
      return { saved, extra };
    });

    // Real-time: notify all monitors watching this patient. AFTER the lock is
    // released — nothing below may hold a connection while asking for another.
    // NOTE: server emits to monitor_${monitorId} (the monitor's own ID),
    // NOT monitor_${patientId} — monitors join rooms keyed by their own userId.
    try {
      const monitorRows = await pool.query(
        `SELECT monitor_id FROM monitor_patients WHERE patient_id = $1 AND active = true`,
        [patientId]
      );
      const payload = { patientId, date, compliance: out.saved.compliance_pct, weight_kg: out.saved.weight_kg };
      for (const row of monitorRows.rows) {
        req.io?.to(`monitor_${row.monitor_id}`).emit('log_updated', payload);
      }
    } catch (e) {
      // The day is saved. A failed live update must not turn that into an error
      // the member is shown (and would retry).
      console.error('log_updated notify failed:', e.message);
    }

    res.json({ ...out.saved, ...out.extra });
  } catch (err) {
    console.error('POST /logs/:date error:', err);
    res.status(500).json({ error: 'Failed to save log' });
  }
});

module.exports = router;
