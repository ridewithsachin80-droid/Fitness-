/**
 * utils/istDate.js — today's calendar date in India, as 'YYYY-MM-DD'.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This function was written three separate times: `getISTDate` in
 * routes/aiChat.js, an identical `getISTDate` in routes/logs.js, and
 * `getISTDateStr` in services/cronService.js using a different technique.
 *
 * Adding a fourth for routes/patients.js is what prompted extracting it —
 * and the reason the route needed it at all was a crash: `getISTDate()` was
 * called there as if it were global, because it looks global when every other
 * file that uses it defines its own copy at the top. The endpoint returned 500
 * and the coach's Morning messages card showed "Couldn't load today's
 * messages" with nothing to say why.
 *
 * The three existing copies happen to agree, so nothing was broken by having
 * them. But the whole point of an IST date helper is that every part of the
 * app agrees on which day it is — if one copy ever drifted, foods would log to
 * one date and the weigh-in to another, and the coach view would quietly
 * disagree with the member's own screen. That is not a bug anyone would spot
 * quickly.
 *
 * NOTE ON TECHNIQUE
 * -----------------
 * Adding 5.5 hours to the UTC timestamp and taking the date portion is
 * correct for India specifically, because IST is a fixed +05:30 with no
 * daylight saving. Intl with an explicit timeZone is the more honest
 * expression of the same thing and does not depend on that fact holding, so
 * it is what is used here.
 *
 * 'en-CA' is not decoration: it is the locale that formats as YYYY-MM-DD,
 * which is what Postgres DATE columns want. 'en-GB' would give DD/MM/YYYY and
 * 'en-US' MM/DD/YYYY, and both would be accepted by a query and then silently
 * interpreted as a different day.
 */

/** @returns {string} e.g. '2026-09-03' */
function getISTDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

module.exports = { getISTDate };
