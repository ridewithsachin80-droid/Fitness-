/**
 * services/scaleParse.js — turning a smart-scale screenshot into safe numbers.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * This lived inline in `POST /ai-chat/photo`, so `test-coach-view.js` had a
 * copy of it under a comment saying "mirrors the scale-screenshot validation".
 * The copy had already drifted: it excluded a metric named exactly "Weight",
 * while the shipped code also excludes "Weight (kg)", "Body Weight kgs" and the
 * other spellings a scale app actually prints. So the suite was asserting
 * narrower behaviour than the code it claimed to cover, and tightening the real
 * regex back to the copy's version would not have turned anything red.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 * The main weight belongs in daily_logs. It must not ALSO be written into lab
 * history, or the member's body-composition chart grows a second weight series
 * that disagrees with their weigh-in. Everything else on the scale screen is a
 * body metric.
 *
 * `isWeightName` is deliberately exported: the client has the same predicate in
 * client/src/utils/labRouting.js — it cannot import this file across the wire —
 * and the test suite asserts the two agree. That is what stops them drifting.
 */

/**
 * The names a scale app uses for the main weight tile.
 * Both boundaries anchored: "Weight Trend" is not the weight reading.
 */
const WEIGHT_NAME_RE = /^(body )?weight( ?\(?kgs?\)?)?$/i;

/** Is this the main weight, rather than a body-composition metric? */
function isWeightName(name) {
  return WEIGHT_NAME_RE.test(String(name || '').trim());
}

/**
 * Validate what the vision model returned for a scale screenshot.
 *
 * @param   {object} parsed  raw model output
 * @returns {{ weight_kg: number|null, body_metrics: Array<{name,value,unit}> }}
 */
function cleanScalePayload(parsed = {}) {
  // Same plausibility gate as the text parser: 20–300 kg. A misread decimal
  // point turns 84.3 into 843, and an unguarded number goes straight onto the
  // member's weight chart.
  let weight_kg = parseFloat(parsed.weight_kg);
  if (!Number.isFinite(weight_kg) || weight_kg < 20 || weight_kg > 300) weight_kg = null;

  const body_metrics = (Array.isArray(parsed.body_metrics) ? parsed.body_metrics : [])
    .filter(m => m && m.name && Number.isFinite(parseFloat(m.value)))
    .slice(0, 40)
    .map(m => ({
      name:  String(m.name).trim().slice(0, 80),
      value: parseFloat(m.value),
      unit:  m.unit ? String(m.unit).trim().slice(0, 20) : null,
    }))
    // The main weight belongs in daily_logs, not duplicated into lab history.
    .filter(m => !isWeightName(m.name));

  return { weight_kg, body_metrics };
}

module.exports = { cleanScalePayload, isWeightName, WEIGHT_NAME_RE };
