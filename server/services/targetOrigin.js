/**
 * services/targetOrigin.js — which of a member's targets the coach set, and
 * which are FitLife's standard values (Fixes-2j, 18 Oct 2026).
 *
 * Until now every member screen presented the standard values as if the coach
 * had chosen them: "Set by your coach" over a 3 L water target that is the
 * database default, a 10 PM–6:30 AM sleep target nobody set, and a daily
 * routine of every built-in item because no selection had been made.
 *
 * The rule, per target:
 *   water     coach    — the coach/admin saved it (target_set_by.water), or the
 *                        stored value differs from the 3000 ml default (only a
 *                        coach or admin can change it).
 *             standard — 3000 ml with no record of anyone choosing it. A coach
 *                        who did pick exactly 3 L before this change shows as
 *                        standard until they save it once; the coach card says so.
 *   sleep     coach when both sleep_bed and sleep_wake are set, else standard.
 *   activities / acv / supplements
 *             coach when the selection is a list (even an empty one), else
 *             standard: null means "no selection yet", which switches every
 *             built-in item on.
 *   macros    coach when any calorie or macro target is set, else none.
 *
 * The client mirrors this in client/src/lib/day/targets.js; test-target-origin
 * checks both give the same answer on the same rows.
 */
const STANDARD_WATER_ML = 3000;

function targetOrigin(p) {
  if (!p) return null;
  const setBy = (p.target_set_by && typeof p.target_set_by === 'object') ? p.target_set_by : {};
  const ml = Number(p.water_target);
  const water = setBy.water ? 'coach'
    : (Number.isFinite(ml) && ml > 0 && ml !== STANDARD_WATER_ML ? 'coach' : 'standard');
  const sleep = p.sleep_bed && p.sleep_wake ? 'coach' : 'standard';
  const group = (v) => (Array.isArray(v) ? 'coach' : 'standard');
  const macros = [p.macro_kcal, p.macro_pro, p.macro_carb, p.macro_fat].some(v => Number(v) > 0) ? 'coach' : 'none';
  return {
    water, sleep, macros,
    activities:  group(p.protocol_activities),
    acv:         group(p.protocol_acv),
    supplements: group(p.protocol_supplements),
  };
}

/** For AI prompts: say where the water target came from, so the AI never claims the coach set a default. */
function waterTargetText(p) {
  const o = targetOrigin(p) || {};
  const ml = Number(p?.water_target) > 0 ? Number(p.water_target) : STANDARD_WATER_ML;
  return o.water === 'coach' ? `${ml} ml target (set by the coach)` : `${ml} ml target (FitLife standard; the coach has not set one)`;
}

/** For AI prompts: the same for the daily routine. */
function routineText(p) {
  const o = targetOrigin(p) || {};
  const std = ['activities', 'acv', 'supplements'].filter(k => o[k] === 'standard');
  return std.length ? `standard FitLife routine for ${std.join(', ')} (the coach has not chosen these)` : 'chosen by the coach';
}

/**
 * Validates a water target sent by a coach or admin.
 *   null / ''     → { reset: true }       back to the standard 3000 ml
 *   500–8000 ml   → { ml }
 *   anything else → { error }
 */
function waterTargetFrom(v) {
  if (v === null || v === '') return { reset: true };
  const ml = Number(v);
  if (!Number.isInteger(ml) || ml < 500 || ml > 8000) return { error: 'Water target should be between 500 and 8000 ml' };
  return { ml };
}

/** SQL fragment that records who set the water target. $n is the user id. */
const markWaterSet = (n) => `target_set_by = jsonb_set(COALESCE(target_set_by, '{}'::jsonb), '{water}', jsonb_build_object('by', $${n}::int, 'at', NOW()))`;
const clearWaterSet = `target_set_by = COALESCE(target_set_by, '{}'::jsonb) - 'water'`;

module.exports = { STANDARD_WATER_ML, targetOrigin, waterTargetText, routineText, waterTargetFrom, markWaterSet, clearWaterSet };
