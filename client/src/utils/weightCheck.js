/**
 * utils/weightCheck.js — Fixes-3j (UX review finding 7, 5 Nov 2026).
 * A weight more than 2 kg away from the day before is usually a typo or a misheard number. It is never blocked (real
 * jumps happen), but the member is asked to look again, in the weight sheet and in the AI preview.
 */
export const WEIGHT_JUMP_KG = 2;

/** The gentle note, or '' when there is nothing to say (no earlier weight, an unreadable value, or a change ≤ 2 kg). */
export function weightJumpNote(newKg, previousKg, threshold = WEIGHT_JUMP_KG) {
  const w = typeof newKg === 'string' ? parseFloat(newKg) : newKg;
  const p = typeof previousKg === 'string' ? parseFloat(previousKg) : previousKg;
  if (w == null || p == null || !Number.isFinite(w) || !Number.isFinite(p) || p <= 0) return '';
  const d = +(w - p).toFixed(1);
  if (Math.abs(d) <= threshold) return '';
  return `That's ${Math.abs(d)} kg ${d > 0 ? 'more' : 'less'} than the day before (${p}). Please check it's right — you can still save it.`;
}
