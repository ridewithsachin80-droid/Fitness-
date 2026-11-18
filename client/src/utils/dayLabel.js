/**
 * utils/dayLabel.js — Fixes-3l (UX review findings 8b and 14), 18 Nov 2026.
 *
 * A short, plain name for a calendar day, as a member says it: "today", "yesterday", "4 Nov"
 * (with the year only when it is not this year: "28 Dec 2025"). Days are IST calendar keys (YYYY-MM-DD),
 * compared as keys, never through the device's own time zone.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days from `fromKey` to `toKey` (both YYYY-MM-DD), or null when either is not a day key. */
export function daysBetween(fromKey, toKey) {
  const a = KEY.exec(String(fromKey || '')), b = KEY.exec(String(toKey || ''));
  if (!a || !b) return null;
  const ms = (m) => Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Math.round((ms(b) - ms(a)) / 86400000);
}

/** "today" | "yesterday" | "4 Nov" | "28 Dec 2025"; '' when `dayKey` is not a day key. */
export function dayLabel(dayKey, todayKey) {
  const m = KEY.exec(String(dayKey || ''));
  if (!m) return '';
  const diff = daysBetween(dayKey, todayKey);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  const label = `${+m[3]} ${MONTHS[+m[2] - 1]}`;
  const t = KEY.exec(String(todayKey || ''));
  return t && t[1] !== m[1] ? `${label} ${m[1]}` : label;
}

/**
 * Fixes-3l (UX finding 14): how to say the span a figure covers. A window of `days` days starting `fromKey` whose data
 * begins `firstKey`: "over 30 days" when the data starts within a day of the window, otherwise "since 30 Oct", so six
 * days of data are never called thirty.
 */
export function spanLabel(fromKey, firstKey, todayKey, days) {
  const gap = daysBetween(fromKey, firstKey);
  if (gap == null || gap <= 1) return `over ${days} ${Number(days) === 1 ? 'day' : 'days'}`;
  const day = dayLabel(firstKey, todayKey);
  return day === 'today' ? 'today' : `since ${day}`;   // QA review of 3l: never 'since today'
}
