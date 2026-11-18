import { defaultMealSlot } from '../lib/day';

export const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const stable = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const same = (a, b) => stable(a) === stable(b);
export const OVERLAP_MESSAGE = 'This review overlaps newer changes. Nothing was undone. Edit those entries manually or undo the newer review first.';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const present = (value, key) => ({ exists: own(value, key), value: copy(value?.[key]) });
const valueEqual = (field, a, b) => ['weight', 'water'].includes(field)
  ? (a == null || a === '' ? '' : String(Number(a))) === (b == null || b === '' ? '' : String(Number(b)))
  : same(a, b);
// Server responses can add provenance metadata. The values the member can edit
// are the overlap boundary; new or corrected nutrition must never be removed.
const foodValue = food => food == null ? null : Object.fromEntries(
  ['id', 'name', 'grams', 'meal', 'food_id', 'per_100g', 'label'].map(k => [k,
    k === 'grams' || k === 'food_id' ? Number(food[k]) || null : k === 'id' ? String(food[k])
      : k === 'per_100g' && food[k] ? Object.fromEntries(Object.entries(food[k]).map(([name, value]) => [name, value == null ? null : Number.isFinite(Number(value)) ? Number(value) : value]))
      : k === 'label' ? !!food[k] : food[k] ?? null]));

/** Build a reversible, card-owned patch. No unrelated field or item is copied
 * back during Undo. IDs are allocated once and reused through save retries. */
export function createDailyChange(parsed, current, { id, mealSlots = [], mealPlans = [] } = {}) {
  const after = copy(current), scalars = [], maps = [], foods = [];
  const setScalar = (field, value) => {
    if (valueEqual(field, current[field], value)) return;
    scalars.push({ field, before: copy(current[field]), after: copy(value) }); after[field] = value;
  };
  if (parsed.notesOn && parsed.notes?.trim()) setScalar('notes', [current.notes, parsed.notes.trim()].filter(Boolean).join('\n').slice(0, 4000));
  if (parsed.weightOn && parsed.weight_kg != null) setScalar('weight', String(parsed.weight_kg));
  if (parsed.waterOn && parsed.water_ml_add) setScalar('water', Math.min(10000, (Number(current.water) || 0) + Number(parsed.water_ml_add)));
  const setKey = (field, key, value) => {
    if (same(current[field]?.[key], value)) return;
    maps.push({ field, key, before: present(current[field], key), after: { exists: true, value: copy(value) } });
    after[field] = { ...after[field], [key]: value };
  };
  for (const field of ['activities', 'acv', 'supplements']) for (const item of parsed[field] || []) if (item.on) setKey(field, item.id, true);
  if (parsed.sleepOn && parsed.sleep) for (const key of ['bedtime', 'waketime']) if (parsed.sleep[key]) setKey('sleep', key, parsed.sleep[key]);
  const list = copy(current.food || []);
  for (const correction of (parsed.corrections || []).filter(c => c.on)) {
    const index = list.map(f => String(f.name).toLowerCase()).lastIndexOf(String(correction.name).toLowerCase());
    if (index < 0) continue;
    const before = copy(list[index]);
    list[index] = { ...list[index], ...(correction.grams ? { grams: correction.grams } : {}), ...(correction.meal ? { meal: correction.meal } : {}) };
    const existing = foods.find(f => String(f.id) === String(before.id));
    if (existing) existing.after = copy(list[index]);
    else if (!same(foodValue(before), foodValue(list[index]))) foods.push({ id: before.id, before, after: copy(list[index]) });
  }
  (parsed.foods || []).filter(f => f.on).forEach((food, i) => {
    const item = { id: `${id}-food-${i}`, name: food.name, grams: food.grams,
      meal: food.meal && mealSlots.includes(food.meal) ? food.meal : defaultMealSlot({ mealSlots, mealPlans, food: current.food || [] }),
      food_id: food.food_id || null, per_100g: copy(food.per_100g) || null, source: food.source || null,
      ...(food.qty_text ? { qty_text: food.qty_text } : {}), ...(food.label ? { label: true } : {}) };
    list.push(item); foods.push({ id: item.id, before: null, after: copy(item) });
  });
  if (foods.length) after.food = list;
  return { scalars, maps, foods, after, needed: !!(scalars.length || maps.length || foods.length) };
}

export function dailyMatches(current, change, side = 'after') {
  if (change.canonicalConflict && side === 'after') return false;
  return change.scalars.every(row => valueEqual(row.field, current[row.field], row[side]))
    && change.maps.every(row => same(present(current[row.field], row.key), row[side]))
    && change.foods.every(row => {
      const matches = (current.food || []).filter(f => String(f.id) === String(row.id));
      return row[side] == null ? matches.length === 0 : matches.length === 1 && same(foodValue(matches[0]), foodValue(row[side]));
    });
}

export function reverseDailyChange(current, change) {
  if (!dailyMatches(current, change)) return { ok: false, message: OVERLAP_MESSAGE };
  const patch = {};
  for (const row of change.scalars) patch[row.field] = copy(row.before);
  for (const row of change.maps) {
    const map = patch[row.field] || copy(current[row.field] || {});
    if (row.before.exists) map[row.key] = copy(row.before.value); else delete map[row.key];
    patch[row.field] = map;
  }
  if (change.foods.length) {
    const affected = new Map(change.foods.map(row => [String(row.id), row]));
    patch.food = (current.food || []).flatMap(food => {
      const row = affected.get(String(food.id));
      return row ? row.before == null ? [] : [copy(row.before)] : [food];
    });
  }
  return { ok: true, patch };
}

/** Only the touched postimages move to server canonical values. A concurrent
 * local edit is never accepted as our own postimage. */
export function canonicalDailyChange(change, saved) {
  // Numeric representation and discarded display metadata may normalize, but
  // a server merge is not permission to claim another writer's values.
  if (!dailyMatches(saved, change)) { change.canonicalConflict = true; return false; }
  for (const row of change.scalars) row.after = copy(saved[row.field]);
  for (const row of change.maps) row.after = present(saved[row.field], row.key);
  for (const row of change.foods) row.after = copy((saved.food || []).find(f => String(f.id) === String(row.id)));
  return true;
}

export function normalizedWorkout(data = {}, date) {
  const session = data.session || data;
  return { date, duration_min: Number(session.duration_min) || null, notes: session.notes || null,
    exercises: (data.exercises || []).map(ex => {
      const sets = (ex.sets || []).filter(set => Number.parseInt(set.reps, 10) > 0)
        .map(set => ({ reps: Number.parseInt(set.reps, 10), weight_kg: Number.parseFloat(set.weight_kg) || 0 }));
      return { exercise_id: Number(ex.exercise_id), sets, ...(!sets.length ? { fromProgram: ex.fromProgram === true } : {}) };
    }).sort((a, b) => a.exercise_id - b.exercise_id),
    cardio: (data.cardio || []).filter(c => Number(c.duration_min) > 0).map(c => ({
      type: c.type, duration_min: Math.min(600, Number(c.duration_min)), speed_kmh: c.speed_kmh == null ? null : Math.min(60, Math.max(0, Number(c.speed_kmh) || 0)),
      distance_km: c.distance_km == null ? null : Math.min(500, Math.max(0, Number(c.distance_km) || 0)), note: c.note ? String(c.note).slice(0, 120) : null,
    })) };
}

export const definitiveWriteFailure = error => Number(error?.response?.status) >= 400 && Number(error.response.status) < 500 && error.response.status !== 408;
export const destinationNeeded = parsed => ({ workout: (parsed.workouts || []).some(w => w.on), body: !!(parsed.bodyMetricsOn && parsed.bodyMetrics?.length) });
