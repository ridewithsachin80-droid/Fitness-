/**
 * services/foodFixes.js — corrections to seeded food rows, applied on every boot.
 *
 * WHY THIS EXISTS
 * ---------------
 * Members log food AS EATEN. The NIN seed stores several grains RAW, and gave
 * those raw rows the everyday name a member types: "Brown Rice", "White Rice",
 * "Boiled Rice". So "brown rice 150 g" was costed at 362 kcal per 100 g (raw
 * grain) = 543 kcal, about three times what 150 g of cooked rice carries.
 *
 * The fix, in data:
 *   1. The raw rows keep their full names ("Rice, Raw (Brown)") but their
 *      everyday name now says "(raw)", so a plain "brown rice" no longer finds
 *      them. Someone who really weighs raw rice can still type "raw rice".
 *   2. Cooked brown and cooked parboiled rice are added, carrying the everyday
 *      names. (Cooked white rice was already there.)
 *   3. Plain "rice", "white rice", "anna" and "steamed rice" are aliases of
 *      cooked white rice.
 *
 * WHY HERE AND NOT IN schema.sql
 * ------------------------------
 * The foods seed only runs when the table is EMPTY. Inserting rows from
 * schema.sql would make a fresh table non-empty before the seed runs, and the
 * whole seed (about 700 foods) would be skipped. This runs after the seed, on
 * every boot, and every statement is safe to repeat.
 *
 * The cooked values are typical per-100 g figures for plain boiled rice with
 * no fat added; they are marked source 'manual' because they are not NIN rows.
 */

const RAW_EVERYDAY = [
  // [full name of the raw row, everyday name it should carry]
  ['Rice, Raw (Brown)',      'Brown Rice (raw)'],
  ['Rice, Raw (White)',      'White Rice (raw)'],
  ['Rice, Raw (Parboiled)',  'Boiled Rice (raw)'],
];

const n = (cal, pro, carb, fat, fiber) => ({
  calories: cal, protein: pro, total_carbs: carb, net_carbs: +(carb - fiber).toFixed(1), fat, fiber,
  sugar: 0, saturated_fat: +(fat * 0.2).toFixed(2), trans_fat: 0, cholesterol: 0,
});
const COOKED = [
  // name, name_local, aliases, per_100g, the raw seed row it stands in for
  ['Rice, Cooked (Brown)',     'Brown Rice',  ['brown rice cooked', 'cooked brown rice'], n(123, 2.7, 25.6, 1.0, 1.6), 'Rice, Raw (Brown)'],
  ['Rice, Cooked (Parboiled)', 'Boiled Rice', ['kusubalakki', 'kusubalakki anna', 'parboiled rice', 'cooked parboiled rice'], n(123, 2.9, 26.0, 0.4, 0.9), 'Rice, Raw (Parboiled)'],
];
const WHITE_COOKED = 'Rice, Cooked (White)';
const WHITE_ALIASES = ['rice', 'white rice', 'plain rice', 'steamed rice', 'anna', 'chawal', 'bhaat'];

/**
 * @param {{query: Function}} db
 * @returns {Promise<{renamed:number, added:number, aliased:number}>}
 */
async function applyFoodFixes(db) {
  let renamed = 0, added = 0, aliased = 0;
  for (const [name, local] of RAW_EVERYDAY) {
    const r = await db.query(
      `UPDATE foods SET name_local = $2::text WHERE LOWER(name) = LOWER($1::text) AND COALESCE(name_local, '') <> $2::text`, [name, local]);
    renamed += r.rowCount || 0;
  }
  for (const [name, local, aliases, per, rawName] of COOKED) {
    // Only next to the raw row it replaces. On a table the seed has not filled
    // (it failed, or has not run), adding rows here would make the table
    // non-empty, and the seed only ever runs on an EMPTY table.
    const r = await db.query(
      `INSERT INTO foods (name, name_local, category, source, verified, per_100g, name_aliases)
       SELECT $1::text, $2::text, 'grain', 'manual', true, $3::jsonb, $4::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM foods WHERE LOWER(name) = LOWER($1::text))
          AND EXISTS (SELECT 1 FROM foods WHERE LOWER(name) = LOWER($5::text))`,
      [name, local, JSON.stringify(per), JSON.stringify(aliases), rawName]);
    added += r.rowCount || 0;
  }
  // Merge, never replace: a coach may have added aliases of their own.
  const r = await db.query(
    `UPDATE foods
        SET name_aliases = (
              SELECT COALESCE(jsonb_agg(DISTINCT a), '[]'::jsonb)
                FROM jsonb_array_elements_text(COALESCE(name_aliases, '[]'::jsonb) || $2::jsonb) AS a)
      WHERE LOWER(name) = LOWER($1::text)
        AND NOT (COALESCE(name_aliases, '[]'::jsonb) @> $2::jsonb)`,
    [WHITE_COOKED, JSON.stringify(WHITE_ALIASES)]);
  aliased += r.rowCount || 0;
  return { renamed, added, aliased };
}

module.exports = { applyFoodFixes, RAW_EVERYDAY, COOKED, WHITE_ALIASES };
