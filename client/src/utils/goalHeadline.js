/**
 * utils/goalHeadline.js — Fixes-3j (UX review finding 1, 5 Nov 2026).
 * The Profile's goal sentence. "goal reached" is said only when a KNOWN current weight is at or past the target:
 * an unknown weight (no weight logged yet) never reads as "nothing left to lose".
 */
export function goalHeadline({ goalId, goalLabel, startWeight, targetWeight, currentWeight }) {
  if (!goalId) return null;
  const s = startWeight != null && startWeight !== '' ? Number(startWeight) : null;
  const t = targetWeight != null && targetWeight !== '' ? Number(targetWeight) : null;
  const c = currentWeight != null && currentWeight !== '' ? Number(currentWeight) : null;
  if (goalId === 'lose' && s && t) {
    const total = +(s - t).toFixed(1);
    if (c == null || !Number.isFinite(c)) return `Lose ${total} kg`;
    const toGo = +(c - t).toFixed(1);
    return toGo > 0 ? `Lose ${total} kg · ${toGo} kg to go` : `Lose ${total} kg · goal reached`;
  }
  if (goalId === 'gain' && s && t) {
    const total = +(t - s).toFixed(1);
    if (c == null || !Number.isFinite(c)) return `Gain ${total} kg`;
    const left = +(t - c).toFixed(1);
    return left > 0 ? `Gain ${total} kg · ${left} kg to go` : `Gain ${total} kg`;
  }
  return goalLabel || null;
}
