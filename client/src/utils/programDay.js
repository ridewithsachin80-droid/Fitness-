/**
 * utils/programDay.js — which program day is today's?
 *
 * Coach-assigned programs carry the weekday in the day label ("Push · Mon").
 * A program whose labels have no weekday in them is not scheduled at all —
 * "Core Workout" assigned for today has no weekday, and showing "Rest day" on
 * the program the coach just assigned is exactly wrong. Unscheduled means
 * today's session is simply the first (usually only) day.
 *
 * ── WHY THIS IS A SHARED FILE ───────────────────────────────────────────────
 * This rule existed in FOUR places: WorkoutLog.jsx, DailyLog.jsx, the server's
 * programDayForDate() in routes/aiChat.js, and a copy inside
 * server/scripts/test-coach-view.js. They had already diverged.
 *
 * The server matched on a WORD BOUNDARY (`\bMon\b`); both client copies used
 * `.includes('Mon')`. So a day the coach labels "Monsoon Circuit" was today's
 * workout according to the member's dashboard and was NOT according to the
 * server — the member would be shown a session the coach's own view did not
 * think was due. Nothing in the gate could catch it, because the only test
 * covering this ran against a fourth copy that shared the client's bug.
 *
 * Word boundaries win: "Monsoon" is not Monday. The test suite now asserts this
 * module and the server agree, so the two cannot drift apart again silently.
 */

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Today's weekday abbreviation in IST, e.g. "Mon". */
export function istWeekday(now = new Date()) {
  return now.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' });
}

/** Does this label name the given weekday? "Monsoon Circuit" is not a Monday. */
export function labelHasWeekday(label, abbr) {
  return new RegExp('\\b' + abbr + '\\b', 'i').test(String(label || ''));
}

/** Is this program scheduled by weekday at all? */
export function isWeekdayScheduled(days = []) {
  return (days || []).some(d => WEEKDAYS.some(w => labelHasWeekday(d?.day_label, w)));
}

/**
 * @param {Array}  days      program days, each { day_number, day_label }
 * @param {string} [todayWd] weekday abbreviation; defaults to today in IST
 * @returns {{ scheduled: boolean, todayDay: object|null }}
 */
export function deriveTodayDay(days = [], todayWd = istWeekday()) {
  const list = days || [];
  const scheduled = isWeekdayScheduled(list);
  const todayDay = scheduled
    ? list.find(d => labelHasWeekday(d?.day_label, todayWd)) || null
    : list[0] || null;
  return { scheduled, todayDay };
}
