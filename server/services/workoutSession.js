// A sheet can contain a selected exercise before the member completes a set.
// Keep its identity separately from completed sets so reopening the sheet does
// not erase the selection or count a blank row as training volume.
function prepareWorkoutExercises(exercises) {
  if (!Array.isArray(exercises)) return [];
  return exercises.flatMap(exercise => {
    const exerciseId = Number(exercise?.exercise_id);
    if (!Number.isSafeInteger(exerciseId) || exerciseId <= 0 || exerciseId > 2147483647 || !Array.isArray(exercise?.sets)) return [];
    const sets = exercise.sets.flatMap(set => {
      const reps = parseInt(set?.reps, 10);
      if (!Number.isFinite(reps) || reps <= 0) return [];
      return [{ reps, weight_kg: parseFloat(set?.weight_kg) || 0 }];
    });
    return [{ exercise_id: exerciseId, sets, fromProgram: exercise.fromProgram === true }];
  });
}

// At most 40 not-started exercises are kept, once each (as on 10 Oct): a
// program day has well under 20, and the list is stored on every save.
const MAX_PENDING = 40;
function pendingWorkoutExercises(exercises) {
  const seen = new Set();
  return exercises.filter(exercise => exercise.sets.length === 0)
    .filter(({ exercise_id }) => !seen.has(exercise_id) && seen.add(exercise_id))
    .slice(0, MAX_PENDING)
    .map(({ exercise_id, fromProgram }) => ({ exercise_id, fromProgram }));
}

module.exports = { prepareWorkoutExercises, pendingWorkoutExercises };
