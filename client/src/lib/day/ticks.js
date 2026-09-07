/**
 * lib/day/ticks.js — protocol items that tick themselves from the Workout log.
 *
 * The Workout log is the source of truth for exercise, so the matching
 * protocol activities tick automatically and are read-only for the member:
 *   walk       ← any foot-based cardio (walking / running / stairs)
 *   resistance ← any strength set logged
 * The remaining items (sunlight, post-meal steps) can't be derived from
 * workout data — a walk entry can't tell us which meal it followed — so those
 * stay manually tappable. Making them read-only would leave them permanently
 * unachievable and would sink the member's compliance score.
 */
export const AUTO_TICK_IDS = ['walk', 'resistance'];
export const FOOT_CARDIO   = ['walking', 'running', 'stairs'];

export function deriveActivityTicks({ sets = [], cardio = [] }) {
  const hasSets = sets.some(st => (parseInt(st?.reps) || 0) > 0);
  const hasFootCardio = cardio.some(
    c => FOOT_CARDIO.includes(String(c?.type)) && (parseFloat(c?.duration_min) || 0) > 0
  );
  return { walk: hasFootCardio, resistance: hasSets };
}
