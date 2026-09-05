/**
 * services/compliance.js — the daily protocol compliance percentage.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `calcCompliance` lived inline in routes/logs.js, where the PWA was the only
 * caller. Voice logging adds a second writer of daily_logs — and two
 * definitions of "how compliant was today" would mean the same day scoring
 * differently depending on whether the member typed it or spoke it, with the
 * coach's dashboard reading whichever landed last.
 *
 * Sprint V0 moves the whole apply path server-side. This is the first thing
 * it needs, and it is a straight extraction: the behaviour is unchanged and
 * routes/logs.js now imports it rather than defining its own.
 */

/**
 * Everything the member has ticked, over everything they were assigned.
 *
 * @param {object} activities   e.g. { walk: true, sun: false }
 * @param {object} acv
 * @param {object} supplements
 * @param {number|null} protocolTotal  how many items are ASSIGNED to them
 * @returns {number} 0-100
 */
function calcCompliance(activities = {}, acv = {}, supplements = {}, protocolTotal = null) {
  const actDone  = Object.values(activities  || {}).filter(Boolean).length;
  const acvDone  = Object.values(acv         || {}).filter(Boolean).length;
  const suppDone = Object.values(supplements || {}).filter(Boolean).length;
  const done     = actDone + acvDone + suppDone;

  // The assigned total is the only reliable denominator, because the payload
  // only carries items the member has interacted with.
  //
  // Fallback: derive from the keys present. This is a FLOOR, not a truth — a
  // payload of { walk: true } alone would otherwise score 100%. Clamping to
  // the default protocol size (6 activities + 3 ACV + 7 supplements = 16)
  // stops a partial payload inflating the number.
  const DEFAULT_PROTOCOL_TOTAL = 16;
  const keyTotal = Object.keys(activities || {}).length
                 + Object.keys(acv || {}).length
                 + Object.keys(supplements || {}).length;
  const total = protocolTotal && protocolTotal > 0
    ? protocolTotal
    : Math.max(keyTotal, DEFAULT_PROTOCOL_TOTAL);

  if (!total) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

/**
 * How many protocol items this member is actually assigned.
 *
 * Mirrors computeProtocolTotal in client/src/store/logStore.js. The defaults
 * (6 / 3 / 7 = 16) are the stock protocol, used when a member has no custom
 * list — the same numbers the client falls back to.
 *
 * @param {object} profile a patient_profiles row
 * @returns {number|null} null when nothing is known, so calcCompliance falls
 *                        back to its own floor rather than trusting a zero
 */
function protocolTotalFor(profile) {
  if (!profile) return null;
  const len = (v, dflt) => (Array.isArray(v) ? v.length : dflt);
  const acts  = len(profile.protocol_activities,  len(profile.custom_activities, 6));
  const acvs  = len(profile.protocol_acv,         len(profile.custom_acv, 3));
  const supps = len(profile.protocol_supplements, len(profile.custom_supplements, 7));
  const total = acts + acvs + supps;
  return total > 0 ? total : null;
}

module.exports = { calcCompliance, protocolTotalFor };
