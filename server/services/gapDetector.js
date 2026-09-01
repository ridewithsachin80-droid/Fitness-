/**
 * gapDetector.js — what a member hasn't logged yet, and whether it's worth
 * mentioning.
 *
 * ── Two things this must get right ──────────────────────────────────────────
 *
 * TIMING. "No water logged" at 9am is not a gap, it is a morning. Flagging it
 * teaches a coach that the list is noise and they stop reading it, which is
 * worse than having no list. So every check has a time of day before which it
 * simply does not apply.
 *
 * RESTRAINT. A member who has logged nothing today has one problem, not six.
 * Sending them separate messages about water, ACV, supplements, activity and
 * food would be five messages saying the same thing, from a coach's personal
 * number, which is how a helpful nudge becomes harassment. So gaps are ranked
 * and only the top one or two per member are surfaced.
 *
 * The output is a prompt for the COACH, never an automatic message. They
 * decide who is worth a nudge — a member on holiday does not need one.
 */

const IST_OFFSET_MIN = 330;

const istNow = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MIN * 60000);
const istHour = (now = new Date()) => istNow(now).getUTCHours();

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const ticked = obj => Object.values(obj || {}).filter(Boolean).length;

/**
 * Gap definitions, in priority order. The first matching gap is the one a
 * coach is shown, because it is the one that unblocks the rest: there is no
 * point asking about supplements if they have not opened the app at all.
 *
 *   after      hour (IST) before which this is not yet a gap
 *   severity   drives ordering and colour; 'blocking' means nothing else
 *              matters until this is fixed
 */
/**
 * "Never logged at all", as a number, so a member with no logs still sorts to
 * the top of a list ordered by days of silence. It is a sentinel, not a count —
 * anything rendering it has to say so in words.
 */
const NEVER_LOGGED = 9999;

const GAPS = [
  {
    key: 'dormant',
    label: 'Not logged in days',
    after: 0,                        // applies at any hour — this is not about today
    severity: 'blocking',
    test: ({ daysSince }) => daysSince != null && daysSince >= 3,
  },
  {
    key: 'nothing',
    label: 'Nothing logged today',
    after: 14,                       // give them most of the day first
    severity: 'blocking',
    test: ({ log }) => !log || (
      !log.weight_kg &&
      !(log.food_items || []).length &&
      !num(log.water_ml) &&
      ticked(log.activities) === 0 &&
      ticked(log.acv) === 0 &&
      ticked(log.supplements) === 0
    ),
  },
  {
    key: 'food',
    label: 'No food logged',
    after: 15,                       // by mid-afternoon two meals have happened
    severity: 'high',
    test: ({ log }) => !(log?.food_items || []).length,
  },
  {
    key: 'weight',
    label: 'Morning weight missing',
    after: 11,
    severity: 'medium',
    test: ({ log }) => !log?.weight_kg,
  },
  {
    key: 'dinner',
    label: 'Dinner not logged',
    after: 21,
    severity: 'medium',
    test: ({ log, protocol }) => {
      const items = log?.food_items || [];
      if (!items.length) return false;                   // covered by 'food'
      const slots = protocol?.meal_slots || ['Meal 1', 'Meal 2', 'Meal 3'];
      const last = slots[slots.length - 1];
      return !items.some(i => String(i.meal || '').toLowerCase() === String(last).toLowerCase());
    },
  },
  {
    key: 'water',
    label: 'Water well under target',
    after: 18,
    severity: 'medium',
    test: ({ log, protocol }) => {
      const target = num(protocol?.water_target) || 3000;
      return num(log?.water_ml) < target * 0.5;
    },
  },
  {
    key: 'activity',
    label: 'No activity ticked',
    after: 19,
    severity: 'medium',
    test: ({ log, protocol }) =>
      (protocol?.activities?.length ?? 6) > 0 && ticked(log?.activities) === 0,
  },
  {
    key: 'acv',
    label: 'ACV doses missed',
    after: 20,
    severity: 'low',
    test: ({ log, protocol }) => {
      const total = protocol?.acv?.length ?? 3;
      return total > 0 && ticked(log?.acv) < total;
    },
  },
  {
    key: 'supplements',
    label: 'Supplements not ticked',
    after: 20,
    severity: 'low',
    test: ({ log, protocol }) => {
      const total = protocol?.supplements?.length ?? 7;
      return total > 0 && ticked(log?.supplements) === 0;
    },
  },
  {
    key: 'sleep',
    label: 'Sleep times missing',
    after: 21,
    severity: 'low',
    test: ({ log }) => !(log?.sleep?.bedtime && log?.sleep?.waketime),
  },
];

const SEVERITY_RANK = { blocking: 0, high: 1, medium: 2, low: 3 };

/**
 * @param member   { id, name, phone }
 * @param log      today's daily_logs row, or null
 * @param protocol { water_target, activities[], acv[], supplements[], meal_slots[] }
 * @param opts.now for testing
 * @param opts.max how many gaps to surface (default 2)
 */
function detectGaps(member, log, protocol = {}, opts = {}) {
  const daysSince = opts.daysSince ?? null;
  const hour = istHour(opts.now || new Date());
  const max = opts.max ?? 2;

  const found = GAPS
    .filter(g => hour >= g.after)
    .filter(g => {
      try { return g.test({ log, protocol, daysSince }); }
      catch { return false; }          // a malformed log must not break the list
    })
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  // A blocking gap means nothing else is worth saying — they have not opened
  // the app. Listing ACV on top would be noise.
  //
  // Otherwise ALL gaps are returned, because they now go into one message
  // rather than one message each. The cap only applies to how many are shown
  // as chips in the coach's list, not to what the message covers.
  const gaps = found[0]?.severity === 'blocking' ? [found[0]] : found;

  return {
    member_id: member.id,
    name: member.name,
    phone: member.phone,
    hour,
    days_since_log: daysSince,
    gaps: gaps.map(g => ({
      key: g.key,
      // A dormant member's label carries the actual number, which is the thing
      // a coach reacts to — but a member who has NEVER logged has no number,
      // and the sentinel used for "maximally dormant" was being printed
      // straight to the screen as "9999 days no log". A count nobody could
      // have earned reads as a bug and makes the whole card look unreliable.
      label: g.key === 'dormant'
        ? (daysSince >= NEVER_LOGGED ? 'Never logged' : `${daysSince} days no log`)
        : g.label,
      severity: g.severity,
    })),
    // How many to show as chips before collapsing to "+n more"
    show: Math.min(gaps.length, max),
    all_gaps: found.map(g => g.key),
  };
}

/**
 * The next check that will start applying, so a coach can see why a member is
 * absent from the list rather than assuming it is broken.
 *
 * A member who has logged weight and food by 3pm has nothing outstanding —
 * water is not checked until 6pm and supplements not until 8pm. Without this,
 * an empty-looking list next to a 0% compliance row reads as a bug.
 */
function nextCheck(now = new Date()) {
  const h = istHour(now);
  const upcoming = GAPS
    .filter(g => g.after > h)
    .sort((a, b) => a.after - b.after);
  if (!upcoming.length) return null;

  const hour = upcoming[0].after;
  const names = upcoming
    .filter(g => g.after === hour)
    .map(g => g.label.toLowerCase());

  return {
    hour,
    label: `${hour > 12 ? hour - 12 : hour}${hour >= 12 ? 'pm' : 'am'}`,
    covers: names,
  };
}

module.exports = { detectGaps, istHour, nextCheck, GAPS, NEVER_LOGGED };
