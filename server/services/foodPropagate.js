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
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int                        AS entries,
            COUNT(DISTINCT dl.patient_id)::int   AS members,
            MIN(dl.log_date)::text               AS earliest
       FROM daily_logs dl,
            LATERAL jsonb_array_elements(COALESCE(dl.food_items, '[]'::jsonb)) it
      WHERE (it->>'food_id')::int = $1`,
    [foodId]
  );
  return rows[0] || { entries: 0, members: 0, earliest: null };
}

/**
 * Rewrite the nutrition snapshot on every logged entry for this food.
 *
 * Grams are never touched — only what 100g of the food contains. How much the
 * member ate is their observation; what it contained is ours to correct.
 *
 * @returns {Promise<{ entries:number, members:number, logs:number }>}
 */
async function propagateFoodNutrition(foodId, per100g) {
  const impact = await propagationImpact(foodId);
  if (!impact.entries) return { ...impact, logs: 0 };

  const { rows } = await pool.query(
    `UPDATE daily_logs dl
        SET food_items = sub.items
       FROM (
         SELECT dl2.id,
                jsonb_agg(
                  CASE WHEN (it->>'food_id')::int = $1
                       THEN jsonb_set(it, '{per_100g}', $2::jsonb)
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
    [foodId, JSON.stringify(per100g), JSON.stringify([{ food_id: foodId }])]
  );

  return { entries: impact.entries, members: impact.members, logs: rows.length };
}

module.exports = { propagationImpact, propagateFoodNutrition };
