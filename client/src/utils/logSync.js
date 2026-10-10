/**
 * utils/logSync.js — how the day on this phone and the day on the server stay
 * the same day. Pure functions only (no store, no network), so the test suite
 * imports the real thing instead of a copy.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Three ways a member's edit was being lost, all found in the Oct 2026 audit:
 *
 * 1. THE STALE APP. The app loads the day once and keeps it. If the day then
 *    changed somewhere else — the coach corrected the weight, lunch was logged
 *    by voice — the next save from this phone sent its old copy of everything
 *    and replaced the row. `base` below is the fix's other half: the app tells
 *    the server what the day looked like when it loaded it, so the server can
 *    tell "the member changed this" from "the member never touched this" and
 *    keep the newer value for the second kind (server: services/dayMerge.js).
 *
 * 2. THE ANSWER THAT ARRIVES LATE. A save takes a second or two on a slow
 *    connection. The save's answer used to REPLACE the day on screen — so a
 *    tick made while it was in flight vanished, and the next autosave then
 *    saved the day without it. resolveSave() only adopts the server's copy
 *    when nothing has changed here since the save was sent.
 *
 * 3. THE ANSWER FOR ANOTHER DAY. Switch to yesterday while a save for today is
 *    in flight and today's answer landed in yesterday's screen. resolveSave()
 *    drops an answer for a date that is no longer the one on screen.
 */

/** What an empty day looks like to the server — the base for a day never saved. */
export const EMPTY_BASE = Object.freeze({
  weight_kg: null, water_ml: 0, activities: {}, acv: {}, supplements: {}, sleep: {}, notes: '', food: {}, food_macros: {},
});

const foodSig = (i) => `${Number(i?.grams) || 0}|${i?.meal || ''}`;
// The numbers a member can edit on an item (10 Oct 2026): kcal, protein, carbs, fat per 100 g.
export const macroSig = (i) => { const p = i?.per_100g || {};
  return [p.calories, p.protein, p.net_carbs ?? p.total_carbs, p.fat].map(v => Number(v) || 0).join(':'); };

/** The server's row, reduced to what a later save needs to send back as its base. */
export function baseOf(row) {
  const items = Array.isArray(row?.food_items) ? row.food_items : [];
  return {
    weight_kg:   row?.weight_kg ?? null,
    water_ml:    row?.water_ml ?? 0,
    activities:  row?.activities ?? {},
    acv:         row?.acv ?? {},
    supplements: row?.supplements ?? {},
    sleep:       row?.sleep ?? {},
    notes:       row?.notes ?? '',
    // id → "grams|meal", so the server can tell an item the member edited here
    // from one that only changed on the server.
    food: Object.fromEntries(items.filter(i => i && i.id).map(i => [String(i.id), foodSig(i)])),
    // id → "kcal:protein:carbs:fat", so a macro edit made here survives a
    // save that has to merge with newer changes from the chat or another phone.
    food_macros: Object.fromEntries(items.filter(i => i && i.id).map(i => [String(i.id), macroSig(i)])),
  };
}

/** Map server response fields → client log shape */
export function mapServerLog(row) {
  const items = Array.isArray(row?.food_items) ? row.food_items : [];
  return {
    weight:      row.weight_kg ? String(row.weight_kg) : '',
    activities:  row.activities  ?? {},
    acv:         row.acv         ?? {},
    food:        items,
    water:       row.water_ml    ?? 0,
    supplements: row.supplements ?? {},
    sleep:       row.sleep       ?? { bedtime: '', waketime: '', quality: 0 },
    notes:       row.notes       ?? '',
    savedAt:     row.saved_at    ?? null,
    // The food ids in the day as loaded. An offline copy sends them back, so
    // the server can tell "deleted offline" from "added elsewhere".
    baseFoodIds: items.map(i => i?.id).filter(Boolean),
    base:        baseOf(row),
  };
}

/** Compute total assignable checkable items from the member's protocol */
export function computeProtocolTotal(protocol) {
  if (!protocol) return null;
  const acts  = protocol.activities  ? protocol.activities.length
              : protocol.custom_activities?.length ?? 6;
  const acvs  = protocol.acv         ? protocol.acv.length
              : protocol.custom_acv?.length ?? 3;
  const supps = protocol.supplements ? protocol.supplements.length
              : protocol.custom_supplements?.length ?? 7;
  return acts + acvs + supps;
}

/** Map client log shape → server request body */
export function mapToServer(log, protocol) {
  return {
    weight_kg:      log.weight ? parseFloat(log.weight) : null,
    activities:     log.activities,
    acv:            log.acv,
    // Explicitly preserve food_id and per_100g so Coach can display nutrition
    // for foods added via the API search (Sprint 1+). Legacy items without
    // per_100g fall back to getNutrition() in Coach.
    food_items:     (log.food || []).map(item => ({
      id:       item.id,
      name:     item.name,
      grams:    item.grams,
      meal:     item.meal,
      food_id:  item.food_id  || null,
      per_100g: item.per_100g || null,
      // The member typed these numbers from their own pack (10 Oct 2026); the
      // coach's day view marks the item so they know where the numbers came from.
      ...(item.label ? { label: true } : {}),
    })),
    water_ml:       log.water,
    // What this phone last saw of the day: when it was saved, which food was in
    // it, and what every other field was. The server uses these only if the
    // day has changed since (services/dayMerge.js).
    base_saved_at:  log.savedAt ?? null,
    base_food_ids:  log.baseFoodIds ?? null,
    base_fields:    log.base ?? EMPTY_BASE,
    supplements:    log.supplements,
    sleep:          log.sleep,
    notes:          log.notes,
    // Send protocol total so server computes compliance against the right denominator
    protocol_total: computeProtocolTotal(protocol),
  };
}

const newer = (a, b) => {
  if (!b) return true;
  if (!a) return false;
  return new Date(a).getTime() >= new Date(b).getTime();
};

/**
 * What the store should change when a save's answer arrives. Pure.
 *
 * @param {object} p
 * @param {object} p.now       the store as it is at this moment ({ date, log, saving })
 * @param {string} p.sentDate  the date the save was for
 * @param {object} p.sentLog   the exact log object that was sent (identity matters)
 * @param {boolean} p.isLatest no newer save has been started since this one
 * @param {object} p.result    { queued: true } or { queued: false, data: <server row> }
 * @returns {object|null} a patch for the store, or null to change nothing
 */
export function resolveSave({ now, sentDate, sentLog, isLatest, result }) {
  // (3) The member has moved to another day. This answer is not about what is
  //     on screen; only stop the spinner if nothing newer owns it.
  if (now.date !== sentDate) return isLatest ? { saving: false } : null;

  const untouched = now.log === sentLog;

  if (result.queued) {
    // Held on this device only. `saved` still goes true — the member's edit IS
    // safe — but only if what was queued is still what is on screen.
    if (untouched && isLatest) return { saving: false, saved: true, queued: true, dirty: false };
    return isLatest ? { saving: false } : null;
  }

  const server = mapServerLog(result.data);
  if (untouched && isLatest) {
    return { saving: false, saved: true, queued: false, dirty: false, log: server };
  }

  // (2) The member edited while this save was in flight (or a newer save is
  //     already on its way). Keep what they see. Only move the BASE forward, so
  //     the next save is measured against what the server now has — and never
  //     backwards, if answers arrive out of order.
  const patch = isLatest ? { saving: false } : {};
  if (newer(server.savedAt, now.log.savedAt)) {
    patch.log = { ...now.log, savedAt: server.savedAt, baseFoodIds: server.baseFoodIds, base: server.base };
  }
  return Object.keys(patch).length ? patch : null;
}

/** May a background refresh replace the day on screen right now? */
export function canRefresh(state, pendingAutosave = false) {
  return !state.dirty && !state.saving && !state.loading && !pendingAutosave;
}
