/**
 * utils/labRouting.js — does this uploaded row belong in the daily log or in lab history?
 *
 * WHY THIS MATTERS
 * ----------------
 * Members photograph their smart-scale screen and send it through the lab-report
 * button, because to them it is "my numbers" either way. The scale's main weight
 * has to land on today's weigh-in; everything else (body fat, muscle mass, BMR)
 * belongs in lab history. Get it wrong in one direction and the member's weight
 * chart grows a second, disagreeing series. Get it wrong in the other and a
 * dated blood report silently overwrites today's weight.
 *
 * ── THE DATE GUARD ──────────────────────────────────────────────────────────
 * Only a reading dated TODAY may touch the daily log. A lab report from June
 * carrying a weight keeps that weight in lab history where it belongs —
 * retro-writing today's log from an old document is the bug this guard exists
 * for.
 *
 * ── WHY THE PREDICATE IS DUPLICATED ─────────────────────────────────────────
 * `isWeightName` is the same rule as `isWeightName` in server/services/
 * scaleParse.js. The two run on opposite sides of the wire and cannot import
 * each other, so the copy is unavoidable — but it is not unguarded:
 * server/scripts/test-coach-view.js asserts the two agree on the same list of
 * names. An unavoidable copy with a parity test is a different thing from an
 * unnecessary copy with none.
 */

/** The names a scale app uses for the main weight tile. */
export const WEIGHT_NAME_RE = /^(body )?weight( ?\(?kgs?\)?)?$/i;

/** Is this the main weight, rather than a body-composition metric? */
export function isWeightName(name) {
  return WEIGHT_NAME_RE.test(String(name || '').trim());
}

/** A weight row worth writing to the daily log: right name, plausible number. */
export function isScaleWeightRow(row) {
  const v = parseFloat(row?.value);
  return isWeightName(row?.test_name) && Number.isFinite(v) && v >= 20 && v <= 300;
}

/**
 * Split an uploaded result set into the one weight row and everything else.
 *
 * @param {Array}  rows
 * @param {string} testDate  the date on the document (YYYY-MM-DD)
 * @param {string} today     today in IST (YYYY-MM-DD)
 * @returns {{ weightRow: object|null, labRows: Array }}
 */
export function routeLabRows(rows = [], testDate, today) {
  const list = rows || [];
  const weightRow = testDate === today ? (list.find(isScaleWeightRow) || null) : null;
  return {
    weightRow,
    labRows: weightRow ? list.filter(r => r !== weightRow) : list,
  };
}
