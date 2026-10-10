/**
 * services/programDay.js — which program day is scheduled for a given date.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This logic existed twice: `client/src/utils/programDay.js` and, pasted
 * inline, in `routes/aiChat.js`. The morning nudge needs it a third time, and
 * a third copy is how the two existing ones came to disagree.
 *
 * THE BUG THE COPIES DISAGREED ON
 * -------------------------------
 * Weekday scheduling lives in the day_label text — "Push · Mon" — not in a
 * column (see the project brief). The client tested labels with BOTH word
 * boundaries; the server's `isWeekdayScheduled` had only the leading one:
 *
 *     /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i        // server, wrong
 *     /\bMon\b/i                                // client, right
 *
 * So "Monsoon Circuit" matched Mon, and "Sunrise Flow" matched Sun. The server
 * then reported the program as weekday-scheduled while the day lookup — which
 * DID use both boundaries — found nothing for today. The two disagreed with
 * each other inside the same request.
 *
 * The visible symptom: a member whose program has a day called "Monsoon
 * Circuit" is told every single day that today is a rest day, because rest-day
 * copy only shows for weekday-scheduled programs and no day ever matches.
 *
 * Both boundaries, in one place, used by everything.
 */

const WD_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The weekday abbreviation for an IST calendar date.
 *
 * `getUTCDay()` on a bare YYYY-MM-DD is the calendar weekday of that date, and
 * istDate is ALREADY the IST calendar date — so there is no second timezone
 * shift to apply here. Using getDay() instead would re-interpret the date in
 * the server's local zone and land on the wrong day either side of midnight.
 */
function weekdayFor(istDate) {
  const jsDow = new Date(String(istDate) + 'T00:00:00Z').getUTCDay();  // 0 = Sunday
  if (Number.isNaN(jsDow)) return null;
  return WD_ABBR[(jsDow + 6) % 7];                                     // 0 = Monday
}

/** Does this label name the given weekday? "Monsoon Circuit" is not a Monday. */
function labelHasWeekday(label, abbr) {
  if (!abbr) return false;
  return new RegExp('\\b' + abbr + '\\b', 'i').test(String(label || ''));
}

/**
 * Is this program scheduled by weekday at all?
 *
 * Programs with unlabelled days ("Day 1", "Day 2") are not, and must not be:
 * guessing a day would tell a member to train legs on the wrong morning, and
 * would show rest-day copy on days that are not rest days.
 */
function isWeekdayScheduled(days) {
  return (days || []).some(
    (d) => WD_ABBR.some((w) => labelHasWeekday(d && d.day_label, w))
  );
}

/**
 * The program day for a date, or null when nothing is scheduled that day.
 * @param {Array}  days     [{ day_number, day_label }]
 * @param {string} istDate  'YYYY-MM-DD' in IST
 */
function programDayForDate(days, istDate) {
  if (!days || !days.length) return null;
  const abbr = weekdayFor(istDate);
  if (!abbr) return null;
  return days.find((d) => labelHasWeekday(d && d.day_label, abbr)) || null;
}

/**
 * The shape the UI and the nudges both want.
 *
 * `scheduled` false means the program has no weekday labels, so the first day
 * is offered as "next up" rather than as "today". That mirrors
 * client/src/utils/programDay.js deliberately — the parity assertions in
 * test-coach-view.js fail if these two drift apart.
 *
 * @returns {{ scheduled: boolean, todayDay: object|null }}
 */
function deriveTodayDay(days, istDate) {
  const list = days || [];
  const scheduled = isWeekdayScheduled(list);
  const todayDay = scheduled ? programDayForDate(list, istDate) : (list[0] || null);
  return { scheduled, todayDay };
}

module.exports = {
  WD_ABBR, weekdayFor, labelHasWeekday,
  isWeekdayScheduled, programDayForDate, deriveTodayDay,
};
