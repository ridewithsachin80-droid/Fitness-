/**
 * Shared SQL fragment: does a daily_logs row actually CONTAIN anything?
 *
 * A daily_logs row is created by the first autosave, which fires as soon as a
 * member opens the app — so "a row exists for today" is not the same as "they
 * logged today". The admin header counted rows and reported "4 logged today"
 * while the same four members showed "—" in the compliance list, because those
 * rows were empty. Same data, two different meanings of the word "logged".
 *
 * Defining it once and importing it means the header stat and the member list
 * cannot drift apart again. Any new surface that asks "did they log?" should
 * use this rather than inventing a third definition.
 *
 * @param {string} alias table alias in the calling query (e.g. 'dl' or '')
 */
function hasContent(alias = '') {
  const c = alias ? `${alias}.` : '';
  return `(
    ${c}weight_kg IS NOT NULL
    OR jsonb_array_length(COALESCE(${c}food_items, '[]'::jsonb)) > 0
    OR COALESCE(${c}water_ml, 0) > 0
    OR EXISTS (SELECT 1 FROM jsonb_each(COALESCE(${c}activities,  '{}'::jsonb)) _a WHERE _a.value::text = 'true')
    OR EXISTS (SELECT 1 FROM jsonb_each(COALESCE(${c}acv,         '{}'::jsonb)) _b WHERE _b.value::text = 'true')
    OR EXISTS (SELECT 1 FROM jsonb_each(COALESCE(${c}supplements, '{}'::jsonb)) _c WHERE _c.value::text = 'true')
  )`;
}

/** Today's date in IST, as SQL. The server is IST-anchored throughout. */
const IST_TODAY = "(NOW() AT TIME ZONE 'Asia/Kolkata')::date";

module.exports = { hasContent, IST_TODAY };
