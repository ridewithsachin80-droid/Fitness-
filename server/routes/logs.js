const router = require('express').Router();
const pool = require('../db/pool');
const authMW = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');

// ── IST date helper ──────────────────────────────────────────────────────────
// Railway runs in UTC. India is UTC+5:30. Always use IST for business-date
// comparisons so members aren't rejected for "future date" between midnight
// and 5:30 AM IST.
function getISTDate() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
}



// ── Compliance calculator ────────────────────────────────────────────────────
// Total possible: 6 activities + 3 ACV + 7 supplements = 16
const TOTAL_CHECKABLE = 16;

function calcCompliance(activities = {}, acv = {}, supplements = {}) {
  const actDone  = Object.values(activities).filter(Boolean).length;
  const acvDone  = Object.values(acv).filter(Boolean).length;
  const suppDone = Object.values(supplements).filter(Boolean).length;
  return Math.round(((actDone + acvDone + suppDone) / TOTAL_CHECKABLE) * 100);
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
      start_weight: profile.start_weight || null,
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
router.post('/:date', authMW, roleCheck('patient'), async (req, res) => {
  try {
    const { date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    // Block future dates
    const today = getISTDate();  // IST date — avoids rejecting logs saved between midnight-5:30 AM IST
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
