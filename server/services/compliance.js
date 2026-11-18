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
function calcCompliance(activities = {}, acv = {}, supplements = {}, protocolTotal = null, inForce = null) {
  // Fixes-3k: inForce (from inForceFor) limits the ticks counted to items in force, so a tick of an item a new-rule
  // member does not have (an old app, a stale copy) cannot raise the score above what they really did. Without it,
  // every tick counts, as before.
  const doneIn = (obj, set) => Object.entries(obj || {}).filter(([k, v]) => v && (!set || set.has(k))).length;
  const actDone  = doneIn(activities,  inForce?.activities);
  const acvDone  = doneIn(acv,         inForce?.acv);
  const suppDone = doneIn(supplements, inForce?.supplements);
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
 * Mirrors computeProtocolTotal in client/src/utils/logSync.js. With no coach
 * selection: 6 / 3 / 7 for existing members; 6 / 0 / 0 for members created
 * from Fixes-3k on (protocol_default_none) — the same numbers as the client.
 *
 * @param {object} profile a patient_profiles row
 * @returns {number|null} null when nothing is known, so calcCompliance falls
 *                        back to its own floor rather than trusting a zero
 */
function protocolTotalFor(profile) {
  if (!profile) return null;
  if (profile.protocol_default_none === true) {
    // Fixes-3k, a member created from 3k on: the items in force, exactly as the app's resolveProtocolItems lists them.
    // A coach list counts as it is; no list = activities: the 6 built-in plus the coach's own; ACV and supplements:
    // only the coach's own items.
    const customLen = (v) => (Array.isArray(v) ? v.length : 0);
    const count = (list, custom, builtIn) => (Array.isArray(list) ? list.length : builtIn + customLen(custom));
    const total = count(profile.protocol_activities, profile.custom_activities, 6)
                + count(profile.protocol_acv, profile.custom_acv, 0)
                + count(profile.protocol_supplements, profile.custom_supplements, 0);
    return total > 0 ? total : null;
  }
  // Existing members: exactly as before 3k (Sachin's decision: their scores do not change).
  const len = (v, dflt) => (Array.isArray(v) ? v.length : dflt);
  const acts  = len(profile.protocol_activities,  len(profile.custom_activities, 6));
  const acvs  = len(profile.protocol_acv,         len(profile.custom_acv, 3));
  const supps = len(profile.protocol_supplements, len(profile.custom_supplements, 7));
  const total = acts + acvs + supps;
  return total > 0 ? total : null;
}

/**
 * Fixes-3k: which tick ids count for a member created from 3k on (protocol_default_none), per group: a Set, or null
 * for "every tick counts". A coach list → its ids. No list → activities: every tick (all built-in); ACV and supplements:
 * only the coach's own items. Existing members → null (every tick counts, exactly as before 3k).
 */
function inForceFor(profile) {
  if (profile?.protocol_default_none !== true) return null;
  const ownIds = (v) => new Set((Array.isArray(v) ? v : []).map(i => i && i.id).filter(Boolean));
  const pick = (list, custom, noneByDefault) => (Array.isArray(list) ? new Set(list) : noneByDefault ? ownIds(custom) : null);
  return {
    activities:  pick(profile.protocol_activities,  profile.custom_activities,  false),
    acv:         pick(profile.protocol_acv,         profile.custom_acv,         true),
    supplements: pick(profile.protocol_supplements, profile.custom_supplements, true),
  };
}

module.exports = { calcCompliance, protocolTotalFor, inForceFor };
