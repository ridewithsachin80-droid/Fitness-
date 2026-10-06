/**
 * services/dayMerge.js — an offline day replayed after newer edits.
 *
 * A member logs on a phone with no signal. The day sits in the offline queue.
 * Meanwhile the same day is changed elsewhere: the AI chat, voice, another
 * phone. When the queued copy finally reaches the server it used to replace the
 * whole day, wiping those newer edits.
 *
 * Sachin's rule (5 Oct 2026): merge the food, keep the newer value for the rest.
 *
 *   FOOD     both lists, matched by item id. An item the member deleted while
 *            offline stays deleted (it was in the day they loaded and is not in
 *            what they sent). An item added elsewhere stays. An item added
 *            offline is added. Where both sides have the same item, the newer
 *            (server) copy wins.
 *   OTHERS   weight, water, ticks, sleep and notes: the newer server value is
 *            kept, and the fields where the offline copy differed are reported
 *            so the app can tell the member.
 *
 * Pure. Only ever used for OFFLINE REPLAYS: an ordinary save is the member's
 * latest edit and is written as sent. (Merging those would drop a fast second
 * edit made while the first save was still in flight.)
 */

const SCALARS = ['weight_kg', 'activities', 'acv', 'water_ml', 'supplements', 'sleep', 'notes'];
const LABELS  = { weight_kg: 'weight', activities: 'activities', acv: 'ACV', water_ml: 'water',
                  supplements: 'supplements', sleep: 'sleep', notes: 'notes' };

const canon = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))) return Number(v);
  if (typeof v === 'object') {
    // Ticks: {walk:false} and {} mean the same thing.
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== false && v[k] !== '' && v[k] != null && v[k] !== 0) out[k] = v[k];
    return JSON.stringify(out) === '{}' ? null : JSON.stringify(out);
  }
  return String(v);
};

/**
 * Has the stored day been written since the offline copy was made?
 * @param {object|null} stored    the row now in the database (or null)
 * @param {string|null} baseSavedAt  saved_at of the day the phone had loaded
 */
function isStale(stored, baseSavedAt) {
  if (!stored) return false;                    // nothing to clash with
  if (!baseSavedAt) return true;                // the phone had no copy; one exists now
  const s = new Date(stored.saved_at).getTime(), b = new Date(baseSavedAt).getTime();
  if (!Number.isFinite(b)) return true;
  return s > b;
}

const sameFood = (a, b) => String(a.name).toLowerCase() === String(b.name).toLowerCase()
  && Number(a.grams) === Number(b.grams) && String(a.meal || '') === String(b.meal || '');

/**
 * @param {object} stored      the database row
 * @param {object} incoming    the offline copy, in POST /logs shape
 * @param {Array|null} baseFoodIds ids of the food items in the day the phone loaded
 * @returns {{ food_items: Array, kept_server: string[], added: number, removed: number }}
 */
function mergeOfflineDay(stored, incoming, baseFoodIds) {
  const S = Array.isArray(stored?.food_items) ? stored.food_items : [];
  const I = Array.isArray(incoming?.food_items) ? incoming.food_items : [];
  const base = new Set((Array.isArray(baseFoodIds) ? baseFoodIds : []).filter(Boolean).map(String));
  const incomingIds = new Set(I.map(i => i?.id).filter(Boolean).map(String));
  const deleted = new Set([...base].filter(id => !incomingIds.has(id)));

  const kept = S.filter(it => !(it?.id && deleted.has(String(it.id))));
  const storedIds = new Set(S.map(i => i?.id).filter(Boolean).map(String));
  const added = I.filter(it => it && (it.id ? !storedIds.has(String(it.id)) : !kept.some(k => sameFood(k, it))))
    // An item with an id that was in the base and is not on the server was
    // deleted ELSEWHERE after the phone loaded the day: it stays deleted.
    .filter(it => !(it.id && base.has(String(it.id))));

  const kept_server = SCALARS.filter(f => canon(stored?.[f]) !== canon(incoming?.[f])).map(f => LABELS[f]);
  return { food_items: [...kept, ...added].slice(0, 200), kept_server, added: added.length, removed: S.length - kept.length };
}

// ── A save from an app that is ONLINE but out of date ────────────────────────
//
// The audit reproduced this: the app is opened at 8am and left open. At 1pm the
// coach corrects the weight, or lunch is logged by voice or on another phone.
// At 3pm the member ticks "walk" in the still-open app, and its save — the
// whole day as it looked at 8am, plus one tick — replaced the row. The coach's
// weight and the lunch were gone, with nothing shown to anyone.
//
// The app now sends what the day looked like when it loaded it (base_fields).
// That makes a three-way merge possible, which the offline rule above could
// not do:
//
//   · a field the member CHANGED since loading  → the member's value (it is
//     their newest edit)
//   · a field the member did NOT touch          → whatever the server has now
//   · ticks and sleep are merged per item, so a tick here and a tick by voice
//     in the same group both survive
//   · water is additive: +250 here and +250 by voice is +500, not +250
//   · food is merged by item id, as offline; an item whose grams or meal the
//     member edited here keeps their edit, and keeps the server's nutrition
//
// Only used when the stored day is newer than the one the app loaded AND the
// app sent base_fields. An older app bundle sends none and is written as sent,
// exactly as before. Offline replays keep Sachin's rule (mergeOfflineDay).
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const leaf  = (v) => (v === false || v == null || v === '' || v === 0) ? null : canon(v);
const foodSig = (it) => `${Number(it?.grams) || 0}|${it?.meal || ''}`;
const WATER_MAX = 20000;

/**
 * @param {object} stored       the database row as it is now
 * @param {object} incoming     the day the app sent, POST /logs shape (already validated)
 * @param {Array|null} baseFoodIds  ids of the food items in the day the app had loaded
 * @param {object} base         base_fields: the scalar fields as the app had loaded them
 * @returns {{ doc: object, kept_server: string[], food_added: number, food_removed: number }}
 */
function mergeLiveDay(stored, incoming, baseFoodIds, base) {
  const B = isObj(base) ? base : {};
  const doc = {};
  const kept_server = [];

  for (const f of ['weight_kg', 'notes']) {
    const changed = canon(incoming?.[f]) !== canon(B[f]);
    doc[f] = changed ? incoming?.[f] : stored?.[f];
    if (!changed && canon(stored?.[f]) !== canon(incoming?.[f])) kept_server.push(LABELS[f]);
  }

  const wS = Number(stored?.water_ml) || 0, wI = Number(incoming?.water_ml) || 0, wB = Number(B.water_ml) || 0;
  doc.water_ml = wI === wB ? wS : Math.min(WATER_MAX, Math.max(0, wS + (wI - wB)));
  if (wI === wB && wS !== wI) kept_server.push(LABELS.water_ml);

  for (const f of ['activities', 'acv', 'supplements', 'sleep']) {
    const S = isObj(stored?.[f]) ? stored[f] : {}, I = isObj(incoming?.[f]) ? incoming[f] : {}, Bf = isObj(B[f]) ? B[f] : {};
    const out = { ...S };
    let tookServer = false;
    for (const k of new Set([...Object.keys(Bf), ...Object.keys(I)])) {
      if (leaf(I[k]) !== leaf(Bf[k])) { if (k in I) out[k] = I[k]; else delete out[k]; }
      else if (leaf(S[k]) !== leaf(I[k])) tookServer = true;
    }
    for (const k of Object.keys(S)) if (!(k in I) && !(k in Bf) && leaf(S[k]) !== null) tookServer = true;
    doc[f] = out;
    if (tookServer) kept_server.push(LABELS[f]);
  }

  const Sf = Array.isArray(stored?.food_items) ? stored.food_items : [];
  const If = Array.isArray(incoming?.food_items) ? incoming.food_items : [];
  const baseIds = new Set((Array.isArray(baseFoodIds) ? baseFoodIds : []).filter(Boolean).map(String));
  const baseSig = isObj(B.food) ? B.food : {};
  const mine = new Map(If.filter(i => i && i.id).map(i => [String(i.id), i]));
  const deleted = new Set([...baseIds].filter(id => !mine.has(id)));
  const kept = [];
  let removed = 0;
  for (const it of Sf) {
    const id = it && it.id ? String(it.id) : null;
    if (id && deleted.has(id)) { removed++; continue; }
    const m = id ? mine.get(id) : null;
    if (m && baseSig[id] != null && foodSig(m) !== String(baseSig[id])) kept.push({ ...it, grams: m.grams, meal: m.meal });
    else kept.push(it);
  }
  const storedIds = new Set(Sf.map(i => i?.id).filter(Boolean).map(String));
  const added = If.filter(it => it && (it.id ? !storedIds.has(String(it.id)) : !kept.some(k => sameFood(k, it))))
    .filter(it => !(it.id && baseIds.has(String(it.id))));
  doc.food_items = [...kept, ...added].slice(0, 300);

  return { doc, kept_server, food_added: added.length, food_removed: removed };
}

module.exports = { mergeOfflineDay, mergeLiveDay, isStale, SCALARS };
