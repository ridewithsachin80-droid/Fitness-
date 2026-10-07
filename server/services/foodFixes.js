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
 *
 * 7 OCT 2026: THE SAME MISTAKE, ELSEWHERE IN THE TABLE
 * ---------------------------------------------------
 * An audit ran everyday words through the real lookup (enrichFromDB). These
 * found a DRY or RAW row, two to three times what the food carries as eaten:
 *
 *   chana, kabuli chana 360   urad dal 347     chana dal 372    whole moong 347
 *   lobia 323                 pasta 348        noodles 364      rice noodles 364
 *   idiyappam 350 (the dry rice vermicelli row is named "Idiyappam")
 *   red rice 350              corn -> Cornflakes 357
 *
 * Fixed the same three ways: a cooked row that wins the lookup, clearer
 * everyday names on the dry rows, and aliases (including the Kannada names the
 * one-time alias migration put on the raw rows: kadale, uddina bele, hesaru).
 *
 * Where the figures come from:
 *   - whole pulses, pasta and noodles: standard published values for the food
 *     boiled in water, no salt or fat (chickpeas 164, mung beans 105, black
 *     gram 105, cowpeas 116, pasta 158, egg noodles 138, rice noodles 108).
 *   - chana dal: this table's own raw row, thinned by the same amount the
 *     table's toor dal is between raw (335) and cooked (116). An estimate.
 *   - idiyappam: this table's Rice Flour row at the water content of a steamed
 *     string hopper (about 62% water, 140 kcal). An estimate.
 *   - red rice: the brown cooked figures (both are unpolished rice, boiled).
 *
 * LEFT ALONE, on purpose: oats, soya chunks, ragi, jowar, bajra, the millets,
 * rava, sabudana, barley and the flours. People weigh these dry, or log the
 * dish made from them (ragi mudde, jolada rotti, upma), not the grain.
 */

const RAW_EVERYDAY = [
  // [full name of the raw row, everyday name it should carry]
  ['Rice, Raw (Brown)',      'Brown Rice (raw)'],
  ['Rice, Raw (White)',      'White Rice (raw)'],
  ['Rice, Raw (Parboiled)',  'Boiled Rice (raw)'],
  // 7 Oct 2026: these dry rows carried the name of the dish.
  ['Rice, Raw (Red)',               'Red Rice (raw)'],
  ['Rajma (Kidney Beans, Raw)',     'Rajma (raw)'],
  ['Rice Flakes (Poha)',            'Poha (dry flakes)'],
  ['Rice Vermicelli (Idiyappam)',   'Rice Vermicelli (dry)'],
  ['Pasta (Whole Wheat, Dry)',      'Pasta (dry)'],
  ['Noodles (Rice, Dry)',           'Rice Noodles (dry)'],
];

const n = (cal, pro, carb, fat, fiber) => ({
  calories: cal, protein: pro, total_carbs: carb, net_carbs: +(carb - fiber).toFixed(1), fat, fiber,
  sugar: 0, saturated_fat: +(fat * 0.2).toFixed(2), trans_fat: 0, cholesterol: 0,
});
const COOKED = [
  // name, name_local, aliases, per_100g, the raw seed row it stands in for
  ['Rice, Cooked (Brown)',     'Brown Rice',  ['brown rice cooked', 'cooked brown rice'], n(123, 2.7, 25.6, 1.0, 1.6), 'Rice, Raw (Brown)'],
  ['Rice, Cooked (Parboiled)', 'Boiled Rice', ['kusubalakki', 'kusubalakki anna', 'parboiled rice', 'cooked parboiled rice'], n(123, 2.9, 26.0, 0.4, 0.9), 'Rice, Raw (Parboiled)'],
  // 7 Oct 2026 (see the note at the top for where each figure comes from).
  ['Rice, Cooked (Red)',          'Red Rice',             ['red rice', 'cooked red rice', 'kempu akki anna', 'matta rice'], n(123, 2.7, 25.6, 1.0, 1.6), 'Rice, Raw (Red)'],
  ['Chana (Cooked)',              'Cooked Chana',         ['boiled chana', 'chickpeas', 'boiled chickpeas', 'kala chana', 'channa', 'kadale', 'kadale kalu'], n(164, 8.9, 27.4, 2.6, 7.6), 'Chana (Bengal Gram, Whole)'],
  ['Kabuli Chana (Cooked)',       'Cooked Kabuli Chana',  ['kabuli channa', 'white chana', 'boiled kabuli chana'], n(164, 8.9, 27.4, 2.6, 7.6), 'Kabuli Chana (White Chickpea)'],
  ['Urad Dal (Cooked)',           'Cooked Urad Dal',      ['cooked urad dal', 'uddina bele', 'black gram dal'], n(105, 7.5, 18.3, 0.6, 6.4), 'Urad Dal (Split Black Lentil)'],
  ['Chana Dal (Cooked)',          'Cooked Chana Dal',     ['cooked chana dal', 'kadale bele', 'bengal gram dal'], n(129, 7.2, 20.7, 1.9, 0.6), 'Chana Dal (Split Chickpea)'],
  ['Whole Moong (Cooked)',        'Cooked Whole Moong',   ['green gram', 'green moong', 'boiled moong', 'hesaru', 'hesaru kalu', 'whole green gram'], n(105, 7.0, 19.2, 0.4, 7.6), 'Moong Dal (Whole Green)'],
  ['Lobia (Cooked)',              'Cooked Lobia',         ['black eyed peas', 'cowpeas', 'alasande', 'alasande kalu', 'karamani'], n(116, 7.7, 20.8, 0.5, 6.5), 'Lobia (Black-Eyed Peas)'],
  ['Pasta (Cooked)',              'Cooked Pasta',         ['boiled pasta', 'spaghetti', 'macaroni', 'penne'], n(158, 5.8, 30.9, 0.9, 1.8), 'Pasta (Refined, Dry)'],
  ['Noodles (Cooked)',            'Cooked Noodles',       ['boiled noodles', 'plain noodles'], n(138, 4.5, 25.2, 2.1, 1.2), 'Noodles (Rice, Dry)'],
  ['Rice Noodles (Cooked)',       'Cooked Rice Noodles',  ['cooked rice noodles', 'boiled rice noodles'], n(108, 1.8, 24.0, 0.2, 1.0), 'Noodles (Rice, Dry)'],
  ['Idiyappam (Cooked, Steamed)', 'Idiyappam',            ['string hoppers', 'nool puttu', 'ottu shavige', 'shavige'], n(140, 2.3, 30.4, 0.5, 0.9), 'Rice Vermicelli (Idiyappam)'],
];
const WHITE_COOKED = 'Rice, Cooked (White)';
const WHITE_ALIASES = ['rice', 'white rice', 'plain rice', 'steamed rice', 'anna', 'chawal', 'bhaat'];
// Aliases merged onto rows the seed already has. "corn" used to find
// Cornflakes (357), the only name starting with it; a member means the cob.
const MORE_ALIASES = [
  ['Sweet Corn (Fresh)', ['corn', 'boiled corn', 'corn kernels']],
];

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
  for (const [name, aliases] of MORE_ALIASES) {
    const m = await db.query(
      `UPDATE foods
          SET name_aliases = (
                SELECT COALESCE(jsonb_agg(DISTINCT a), '[]'::jsonb)
                  FROM jsonb_array_elements_text(COALESCE(name_aliases, '[]'::jsonb) || $2::jsonb) AS a)
        WHERE LOWER(name) = LOWER($1::text)
          AND NOT (COALESCE(name_aliases, '[]'::jsonb) @> $2::jsonb)`,
      [name, JSON.stringify(aliases)]);
    aliased += m.rowCount || 0;
  }
  return { renamed, added, aliased };
}

module.exports = { applyFoodFixes, RAW_EVERYDAY, COOKED, WHITE_ALIASES, MORE_ALIASES };
