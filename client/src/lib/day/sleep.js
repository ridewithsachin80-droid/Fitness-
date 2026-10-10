/**
 * lib/day/sleep.js — bedtime/wake-time arithmetic.
 *
 * The "if it went past midnight add 24h" duration calculation was inlined
 * twice in DailyLog.jsx (hero tile and sleep panel). One copy now.
 */
import { clock } from './planMeals';

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

// ── The sleep TARGET (what the plan asks for), as opposed to a night logged ──
//
// This was a constant in two files — { bed: '10:00 PM', wake: '6:30 AM',
// hours: 8 } — so every member saw the same times, and the label was wrong
// for its own times: 10:00 PM to 6:30 AM is eight and a half hours, not eight.
// The times now come from the member's profile (sleep_bed / sleep_wake, set by
// the coach) and the duration is always worked out from them.

/** The house default, used until a coach sets a member's own times. 24-hour "HH:MM". */
export const DEFAULT_SLEEP_TARGET = { bed: '22:00', wake: '06:30' };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = (t) => { const v = String(t || '').slice(0, 5); return HHMM.test(v) ? v : null; };

/** 480 → "8 h", 510 → "8.5 h", 500 → "8 h 20 min". */
export function formatHours(mins) {
  if (mins == null) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (m === 0)  return `${h} h`;
  if (m === 30) return `${h}.5 h`;
  return `${h} h ${m} min`;
}

/**
 * A member's sleep target from their profile row or the day's protocol object
 * (both carry sleep_bed / sleep_wake). Falls back to the house default when
 * either time is missing or unreadable — never half of each.
 */
export function sleepTarget(profile) {
  const bed = clean(profile?.sleep_bed), wake = clean(profile?.sleep_wake);
  const own = !!(bed && wake);
  const t = own ? { bed, wake } : DEFAULT_SLEEP_TARGET;
  const minutes = sleepMinutes(t.bed, t.wake);
  return {
    bed: t.bed, wake: t.wake,
    bedLabel: clock(t.bed), wakeLabel: clock(t.wake),
    minutes, hoursLabel: formatHours(minutes),
    isDefault: !own,
  };
}
