/**
 * lib/day/sleep.js — bedtime/wake-time arithmetic.
 *
 * The "if it went past midnight add 24h" duration calculation was inlined
 * twice in DailyLog.jsx (hero tile and sleep panel). One copy now.
 */

/** "22:30" → 1350. Tolerates "22:30:00" and empty values. */
export function timeToMin(t) {
  if (!t) return 0;
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Minutes slept between bedtime and wake time, crossing midnight if needed.
 *  Returns null when either is missing. A bedtime equal to the wake time is
 *  read as a full 24h (mins <= 0 → +24h), matching the original page. */
export function sleepMinutes(bedtime, waketime) {
  if (!bedtime || !waketime) return null;
  let mins = timeToMin(waketime) - timeToMin(bedtime);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}

/** 430 → "7h 10m". */
export function formatSleep(mins) {
  if (mins == null) return '';
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Tone band used by the sleep panel: 'great' 7–9h, 'short' under 6h, else 'ok'. */
export function sleepTone(mins) {
  if (mins == null) return null;
  const hrs = mins / 60;
  if (hrs >= 7 && hrs <= 9) return 'great';
  if (hrs < 6) return 'short';
  return 'ok';
}
