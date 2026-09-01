/**
 * utils/coachView.js — the derivations behind the coach's member screen.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Both of these lived inside `Monitor.jsx` — one as an IIFE in the component
 * body, one as an inline block halfway down the JSX. Neither could be imported,
 * so `server/scripts/test-coach-view.js` reimplemented them under comments
 * saying "mirrors the grouping in Monitor.jsx". A copy is correct on the day it
 * is written and cannot fail on the day the original changes: the suite would
 * have gone on reporting these as covered while the shipped screen drifted.
 *
 * That already happened once in this codebase — three assertions ran against a
 * pasted copy of `computeDayTotals` for months. Moving the logic here means
 * Monitor.jsx and the test call the same function, so editing one turns the
 * other red.
 *
 * Nothing here touches React. Pure input to output, which is the whole point.
 */

export const UNSORTED_MEAL = 'Unsorted';

/**
 * Which meal slot a food item belongs to.
 *
 * Slot names are member-configurable and the AI logger can persist meal = null,
 * so anything without a usable slot is swept into 'Unsorted' rather than
 * dropped. Hardcoding 'Meal 1/2/3' once silently discarded every item that did
 * not match, leaving the coach with a day total and no rows under it.
 */
export function slotOf(item) {
  const s = item?.meal == null ? '' : String(item.meal).trim();
  return s || UNSORTED_MEAL;
}

/** Meal slots arrive as strings or as { name }. Normalise and drop the empties. */
export function mealSlotNames(raw = []) {
  return (raw || [])
    .map(s => (typeof s === 'string' ? s : s && s.name))
    .filter(Boolean);
}

/**
 * Group a day's food into meal sections, in the order the coach should read them.
 *
 * The member's own protocol order first, then any slot they used that is not in
 * the protocol, then 'Unsorted' last — it is the exception and belongs at the
 * bottom. Slots with nothing in them never appear.
 *
 * @param {Array}  foodItems
 * @param {Array}  protocolSlots  strings or { name } objects
 * @returns {Array<{ meal: string, items: Array }>}
 */
export function groupByMeal(foodItems = [], protocolSlots = []) {
  const items = foodItems || [];
  const slots = mealSlotNames(protocolSlots);

  const present = [];
  items.forEach(f => {
    const s = slotOf(f);
    if (!present.includes(s)) present.push(s);
  });

  const ordered = [
    ...slots.filter(s => present.includes(s)),
    ...present.filter(s => !slots.includes(s) && s !== UNSORTED_MEAL),
    ...(present.includes(UNSORTED_MEAL) ? [UNSORTED_MEAL] : []),
  ];

  return ordered.map(meal => ({ meal, items: items.filter(f => slotOf(f) === meal) }));
}

/**
 * Body composition: lab rows grouped by marker, with a trend where there is one.
 *
 * Two rows from the SAME panel on the SAME date are one reading, not two, so
 * the series is deduped per date (last write wins). Without that a single DEXA
 * panel stored as duplicate rows drew a flat line that looked like a real
 * measured trend. A marker only becomes trendable at 2+ distinct dates.
 *
 * @returns {{ markers: Array, scanDates: string[], latestDate: string|null, trendable: Array }}
 */
export function deriveBodyComp(labs = []) {
  const rows = labs || [];
  const byTest = new Map();

  rows.forEach(l => {
    const date = String(l?.test_date || '').slice(0, 10);
    if (!date) return;
    const value = parseFloat(l.value);
    if (!Number.isFinite(value)) return;
    if (!byTest.has(l.test_name)) byTest.set(l.test_name, new Map());
    byTest.get(l.test_name).set(date, value);
  });

  const scanDates = [...new Set(
    rows.map(l => String(l?.test_date || '').slice(0, 10)).filter(Boolean)
  )].sort();

  const markers = [...byTest.entries()].map(([name, dateMap]) => {
    const series = [...dateMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, value }));
    const latest = series[series.length - 1];
    const prev   = series.length > 1 ? series[series.length - 2] : null;
    return {
      name,
      series,
      latest: latest ? latest.value : null,
      change: prev ? +(latest.value - prev.value).toFixed(2) : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    markers,
    scanDates,
    latestDate: scanDates[scanDates.length - 1] || null,
    trendable: markers.filter(m => m.series.length >= 2),
  };
}
