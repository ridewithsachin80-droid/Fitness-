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

module.exports = { mergeOfflineDay, isStale, SCALARS };
