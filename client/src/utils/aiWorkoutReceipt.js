import { copy, normalizedWorkout } from './aiSaveReceipt';

/** Resolve once, then retain the complete replacement body for safe retries.
 * The save hook attaches the last observed server revision so replacement
 * and Undo cannot overwrite a concurrent save after the comparison. */
export async function prepareWorkoutChange(api, rows, date, check) {
  const { data } = await api.get('/workouts', { params: { date } }); check();
  const before = normalizedWorkout(data || {}, date), after = copy(before);
  const structured = rows.filter(w => w.sets?.length);
  const cardio = rows.filter(w => !w.sets?.length && w.cardio_type);
  const freeform = rows.filter(w => !w.sets?.length && !w.cardio_type);
  for (const row of structured) {
    let id;
    const { data: found } = await api.get('/workouts/exercises', { params: { q: row.name } }); check();
    id = (found || []).find(ex => ex.name.toLowerCase() === row.name.toLowerCase())?.id;
    if (!id) { const { data: created } = await api.post('/workouts/exercises', { name: row.name }); check(); id = created?.id; }
    if (!id) throw new Error('Exercise could not be resolved');
    const sets = row.sets.map(set => ({ reps: set.reps, weight_kg: set.weight_kg }));
    const existing = after.exercises.find(ex => Number(ex.exercise_id) === Number(id));
    if (existing) existing.sets.push(...sets); else after.exercises.push({ exercise_id: id, sets });
  }
  for (const row of cardio) {
    const item = { type: row.cardio_type, duration_min: Number(row.duration_min) || 0, speed_kmh: row.speed_kmh ?? null, distance_km: row.distance_km ?? null };
    if (item.duration_min > 0 && !after.cardio.some(c => c.type === item.type && Number(c.duration_min) === item.duration_min)) after.cardio.push(item);
  }
  if (after.cardio.length > 20) throw Object.assign(new Error('The workout already has the maximum number of cardio entries. Review it manually.'), { code: 'WORKOUT_CONFLICT' });
  const addedMinutes = freeform.reduce((n, row) => n + (Number(row.duration_min) || 0), 0);
  if (addedMinutes > 0) {
    if ((before.duration_min || 0) + addedMinutes > 480) throw Object.assign(new Error('The workout duration needs manual review.'), { code: 'WORKOUT_CONFLICT' });
    after.duration_min = (before.duration_min || 0) + addedMinutes;
  }
  const lines = freeform.map(row => `✨ ${row.name}${row.qty_text ? ` — ${row.qty_text}` : ''}${row.calories_burned ? ` (~${row.calories_burned} kcal)` : ''}`);
  if (lines.length) {
    const combined = [before.notes, ...lines].filter(Boolean).join('\n');
    if (combined.length > 2000) throw Object.assign(new Error('The workout notes are full. Review the new activity manually.'), { code: 'WORKOUT_CONFLICT' });
    after.notes = combined;
  }
  return { before, after: normalizedWorkout(after, date), hadSession: !!data?.session };
}
