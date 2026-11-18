/**
 * lib/day/targets.js — coach-set targets versus FitLife's standard values
 * (Fixes-2j, 18 Oct 2026).
 *
 * The server says which is which (`target_origin`, from
 * server/services/targetOrigin.js). These helpers read that and, for an older
 * server or a raw profile row without it, apply the same rule:
 *   water     coach when the coach recorded it (target_set_by.water) or the
 *             value is not the 3000 ml default; otherwise standard.
 *   sleep     coach when both times are set.
 *   routine   coach when the group is a list; null = no selection yet, which
 *             switches every built-in item on.
 *   macros    coach when any calorie/macro target is set; otherwise none.
 * test-target-origin checks the two copies agree.
 */
export const STANDARD_WATER_ML = 3000;

/**
 * The profile row (/members/me/today, the coach's member page) names the
 * routine choice protocol_activities etc.; the day's protocol (/logs/:date)
 * calls it activities. Plan and the coach view were reading `activities` off
 * the row, found nothing, and showed every built-in item. One shape for both.
 */
export function protocolFromProfile(row) {
  if (!row) return row;
  const pick = (a, b) => (row[a] !== undefined ? row[a] : (row[b] !== undefined ? row[b] : null));
  return {
    ...row,
    activities:  pick('activities',  'protocol_activities'),
    acv:         pick('acv',         'protocol_acv'),
    supplements: pick('supplements', 'protocol_supplements'),
  };
}

/** 'coach' | 'standard' for water, sleep, activities, acv, supplements; 'coach' | 'none' for macros. */
export function targetOrigin(p, key) {
  if (!p) return key === 'macros' ? 'none' : 'standard';
  const told = p.target_origin?.[key];
  if (told) return told;
  if (key === 'water') {
    const ml = Number(p.water_target);
    return p.target_set_by?.water || (Number.isFinite(ml) && ml > 0 && ml !== STANDARD_WATER_ML) ? 'coach' : 'standard';
  }
  if (key === 'sleep') return p.sleep_bed && p.sleep_wake ? 'coach' : 'standard';
  if (key === 'macros') {
    const m = p.macros || {};
    return [p.macro_kcal, p.macro_pro, p.macro_carb, p.macro_fat, m.kcal, m.pro, m.carb, m.fat].some(v => Number(v) > 0) ? 'coach' : 'none';
  }
  const v = p[key] !== undefined ? p[key] : p[`protocol_${key}`];
  return Array.isArray(v) ? 'coach' : 'standard';
}

/** The water target in force, and whether it is the standard one. */
export function waterTarget(p) {
  const raw = Number(p?.water_target);
  const ml = Number.isFinite(raw) && raw > 0 ? raw : STANDARD_WATER_ML;
  return { ml, label: `${(ml / 1000).toFixed(1)} L`, isDefault: targetOrigin(p, 'water') === 'standard' };
}

/** Which daily-routine groups are still the standard set. */
export function routineOrigin(p) {
  const groups = ['activities', 'acv', 'supplements'];
  const standard = groups.filter(g => targetOrigin(p, g) === 'standard');
  return { standard, allStandard: standard.length === groups.length, anyStandard: standard.length > 0 };
}

/**
 * Plan header. "Set by <coach>" only when the coach has set something; never
 * over a page of FitLife standards.
 *   hasCoachContent: a program, meal plan or diet plan from the coach.
 */
export function planSourceLine(p, { coachName, hasCoachContent = false } = {}) {
  const keys = ['water', 'sleep', 'activities', 'acv', 'supplements'];
  const coachSet = keys.filter(k => targetOrigin(p, k) === 'coach').length + (targetOrigin(p, 'macros') === 'coach' ? 1 : 0);
  const standard = keys.filter(k => targetOrigin(p, k) === 'standard').length;
  const who = coachName ? coachName : 'your coach';
  if (!coachSet && !hasCoachContent) return `FitLife starting plan · ${who} will personalise it`;
  return standard ? `Set by ${who} · some items are FitLife standards` : `Set by ${who}`;
}

/** The small label shown beside a standard value. */
export const STANDARD_LABEL = 'FitLife standard';
