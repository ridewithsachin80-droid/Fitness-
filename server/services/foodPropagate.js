/**
 * services/foodPropagate.js — push a corrected food out to logs already saved.
 *
 * WHY THIS IS NEEDED AT ALL
 * -------------------------
 * A logged food carries a SNAPSHOT of its nutrition, copied at the moment it
 * was logged. That is deliberate and correct: a member's history should not
 * silently rewrite itself every time the food table is edited, and a log has to
 * survive its food being deleted.
 *
 * But it means fixing a wrong food only fixes it going forward. Masala Dosa was
 * stored at 140 kcal/100g with 3g of fat — a dosa nobody put on a tawa. Correct
 * the row and every future log is right, while every dosa fourteen members have
 * already logged stays a third too light, and their weekly reports and adaptive
 * calorie estimates keep being computed from it.
 *
 * So propagation is opt-in and explicit. The coach corrects a food and is told
 * how many entries, across how many members, would move if they push it back
 * through history.
 *
 * ── MATCHED BY food_id, NEVER BY NAME ───────────────────────────────────────
 * Only entries that recorded WHICH food they were get updated. Matching on the
 * name string would catch a member's hand-typed "masala dosa" from a
 * restaurant, which is a genuinely different dish from the one being corrected,
 * and there would be no way to tell afterwards.
 */

const pool = require('../db/pool');

/**
 * How many logged entries reference this food, and for how many members.
 * Read-only — this is what the coach is shown BEFORE they decide.
 */
async function propagationImpact(foodId) {
  // Entries that name this food but were never LINKED to it — food_id null.
  // They happen constantly: the food was created after the log, or enrichment
  // missed the name that day. Correcting a food could never reach them, which
  // is why editing Aloo Bhaji changed nothing for a member who had clearly
  // logged Aloo Bhaji.
  //
  // Offered as a SEPARATE choice, because matching on a name is a weaker claim
  // than matching on an id: "masala dosa" typed after a restaurant meal is a
  // different dish. The coach sees the count and decides.
  const { rows: un } = await pool.query(
    `SELECT COUNT(*)::int                      AS entries,
            COUNT(DISTINCT dl.patient_id)::int AS members
       FROM daily_logs dl,
            LATERAL jsonb_array_elements(COALESCE(dl.food_items, '[]'::jsonb)) it,
            foods f
      WHERE f.id = $1
        AND it->>'food_id' IS NULL
        AND lower(TRIM(it->>'name')) = lower(TRIM(f.name))`,
    [foodId]
  );

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int                        AS entries,
            COUNT(DISTINCT dl.patient_id)::int   AS members,
            MIN(dl.log_date)::text               AS earliest,
            -- Entries where the member never said how much. The grams on these
            -- are a model's guess, not something anyone observed, so they are
            -- the only ones a corrected serving size may safely rewrite.
            COUNT(*) FILTER (
              WHERE COALESCE(NULLIF(TRIM(it->>'qty_text'), ''), 'typical serving') = 'typical serving'
            )::int                               AS guessed
       FROM daily_logs dl,
            LATERAL jsonb_array_elements(COALESCE(dl.food_items, '[]'::jsonb)) it
      WHERE (it->>'food_id')::int = $1`,
    [foodId]
  );
  return { ...(rows[0] || { entries: 0, members: 0, earliest: null, guessed: 0 }),
           unlinked: un[0]?.entries || 0, unlinked_members: un[0]?.members || 0 };
}

/**
 * Rewrite the nutrition snapshot on every logged entry for this food.
 *
 * Grams are never touched — only what 100g of the food contains. How much the
 * member ate is their observation; what it contained is ours to correct.
 *
 * @returns {Promise<{ entries:number, members:number, logs:number }>}
 */
/**
 * @param {number} foodId
 * @param {object} per100g
 * @param {object} [opts]
 * @param {number|null} [opts.grams]  also reset the portion, but ONLY on
 *   entries where the member never said how much — see below.
 */
async function propagateFoodNutrition(foodId, per100g, opts = {}) {
  const impact = await propagationImpact(foodId);
  if (!impact.entries) return { ...impact, logs: 0, grams_fixed: 0 };

  const { rows } = await pool.query(
    `UPDATE daily_logs dl
        SET food_items = sub.items
       FROM (
         SELECT dl2.id,
                jsonb_agg(
                  CASE WHEN (it->>'food_id')::int = $1
                       THEN CASE
                         -- The portion is rewritten only where nobody stated
                         -- one. "80g" for a dosa the member logged as just
                         -- "masala dosa" is the model's guess, and a guess we
                         -- now know to be wrong is worth correcting. The moment
                         -- they typed "2 dosa" or "150g", that is theirs and
                         -- stays untouched however wrong we think it is.
                         WHEN $4::int IS NOT NULL
                          AND COALESCE(NULLIF(TRIM(it->>'qty_text'), ''), 'typical serving') = 'typical serving'
                         THEN jsonb_set(
                                jsonb_set(it, '{per_100g}', $2::jsonb),
                                '{grams}', to_jsonb($4::int))
                         ELSE jsonb_set(it, '{per_100g}', $2::jsonb)
                       END
                       ELSE it END
                  ORDER BY ord
                ) AS items
           FROM daily_logs dl2,
                LATERAL jsonb_array_elements(COALESCE(dl2.food_items, '[]'::jsonb))
                        WITH ORDINALITY AS t(it, ord)
          WHERE dl2.food_items @> $3::jsonb
          GROUP BY dl2.id
       ) sub
      WHERE dl.id = sub.id
  RETURNING dl.id`,
    [foodId, JSON.stringify(per100g), JSON.stringify([{ food_id: foodId }]),
     Number.isFinite(parseInt(opts.grams)) && parseInt(opts.grams) > 0 ? parseInt(opts.grams) : null]
  );

  return { entries: impact.entries, members: impact.members, logs: rows.length,
           grams_fixed: opts.grams ? impact.guessed : 0 };
}

/**
 * Correct entries that NAME this food but were never linked to it.
 *
 * Also writes the food_id, so they are linked from then on and every future
 * correction reaches them through the ordinary id match. The gap closes rather
 * than being worked around each time.
 *
 * Exact, case-insensitive name equality only — never a substring. "Aloo Bhaji"
 * must not sweep up "Aloo Bhaji Masala", which is a different dish with
 * different numbers.
 */
async function propagateUnlinked(foodId, per100g, grams = null) {
  const { rows } = await pool.query(
    `UPDATE daily_logs dl
        SET food_items = sub.items
       FROM (
         SELECT dl2.id,
                jsonb_agg(
                  CASE WHEN it->>'food_id' IS NULL
                        AND lower(TRIM(it->>'name')) = lower(TRIM(f.name))
                       THEN jsonb_set(
                              jsonb_set(
                                CASE WHEN $4::int IS NOT NULL
                                      AND COALESCE(NULLIF(TRIM(it->>'qty_text'), ''), 'typical serving') = 'typical serving'
                                     THEN jsonb_set(it, '{grams}', to_jsonb($4::int))
                                     ELSE it END,
                                '{per_100g}', $2::jsonb),
                              '{food_id}', to_jsonb($1::int))
                       ELSE it END
                  ORDER BY ord
                ) AS items
           FROM daily_logs dl2,
                LATERAL jsonb_array_elements(COALESCE(dl2.food_items, '[]'::jsonb))
                        WITH ORDINALITY AS t(it, ord),
                foods f
          WHERE f.id = $1
            AND dl2.food_items @> $3::jsonb
          GROUP BY dl2.id
       ) sub
      WHERE dl.id = sub.id
  RETURNING dl.id`,
    [foodId, JSON.stringify(per100g),
     JSON.stringify([{ food_id: null }]),
     Number.isFinite(parseInt(grams)) && parseInt(grams) > 0 ? parseInt(grams) : null]
  );
  // rows.length is how many daily_logs ROWS were rewritten, and a row is
  // rewritten whenever it contains ANY unlinked item — including ones this
  // food does not match. Counting rows reported 2 when a single entry changed.
  // The number the coach is shown must be entries.
  const { rows: after } = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM daily_logs dl,
            LATERAL jsonb_array_elements(COALESCE(dl.food_items, '[]'::jsonb)) it
      WHERE (it->>'food_id')::int = $1`, [foodId]);
  return { rows_touched: rows.length, entries: after[0]?.n || 0 };
}

module.exports = { propagationImpact, propagateFoodNutrition, propagateUnlinked };
