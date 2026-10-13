// No database required. The HTTP/database round trip is covered separately in
// test-known-fixes; these exercise the production normalizer with member input.
const assert = require('node:assert/strict');
const { prepareWorkoutExercises, pendingWorkoutExercises } = require('../services/workoutSession');
const { importClient } = require('./lib/client-bundle');
const { completedWorkoutExercises, applyProgramDay } = importClient('utils/workoutSession.js');
let passed = 0;
function check(name, test) {
  test(); passed++; console.log(`  ✓ ${name}`);
}

check('selected program exercise without sets remains selected', () => {
  const selected = prepareWorkoutExercises([{ exercise_id: 12, sets: [], fromProgram: true }]);
  assert.deepEqual(pendingWorkoutExercises(selected), [{ exercise_id: 12, fromProgram: true }]);
});
check('a blank set does not become a completed set or erase its exercise', () => {
  const selected = prepareWorkoutExercises([{ exercise_id: 12, sets: [{ reps: '', weight_kg: '' }], fromProgram: true }]);
  assert.equal(selected[0].sets.length, 0);
  assert.equal(pendingWorkoutExercises(selected).length, 1);
});
check('a manually selected exercise stays manual after saving', () => {
  assert.deepEqual(pendingWorkoutExercises(prepareWorkoutExercises([{ exercise_id: 12, sets: [] }])),
    [{ exercise_id: 12, fromProgram: false }]);
});
check('completed sets retain their reps and decimal weight', () => {
  assert.deepEqual(prepareWorkoutExercises([{ exercise_id: '12', sets: [{ reps: '8', weight_kg: '42.5' }] }])[0].sets,
    [{ reps: 8, weight_kg: 42.5 }]);
});
check('a completed exercise is not added again as an unfinished exercise', () => {
  assert.deepEqual(pendingWorkoutExercises(prepareWorkoutExercises([{ exercise_id: 12, sets: [{ reps: 8, weight_kg: 40 }] }])), []);
});
check('mixed complete and incomplete rows keep only actual training data', () => {
  const prepared = prepareWorkoutExercises([{ exercise_id: 12, sets: [{ reps: '' }, { reps: 8, weight_kg: 40 }, { reps: 0 }, { reps: -2 }, null] }]);
  assert.deepEqual(prepared[0].sets, [{ reps: 8, weight_kg: 40 }]);
  assert.equal(pendingWorkoutExercises(prepared).length, 0);
});
check('zero-weight bodyweight sets remain valid', () => {
  assert.deepEqual(prepareWorkoutExercises([{ exercise_id: 12, sets: [{ reps: 10, weight_kg: '' }] }])[0].sets,
    [{ reps: 10, weight_kg: 0 }]);
});
check('removing an unfinished exercise produces an empty replacement list', () => {
  assert.deepEqual(pendingWorkoutExercises(prepareWorkoutExercises([])), []);
});
check('program and manual unfinished selections coexist', () => {
  const prepared = prepareWorkoutExercises([
    { exercise_id: 12, sets: [], fromProgram: true },
    { exercise_id: 13, sets: [], fromProgram: false },
    { exercise_id: 14, sets: [{ reps: 5, weight_kg: 20 }] },
  ]);
  assert.equal(prepared.length, 3);
  assert.deepEqual(pendingWorkoutExercises(prepared), [{ exercise_id: 12, fromProgram: true }, { exercise_id: 13, fromProgram: false }]);
});
check('incomplete selections store identity only, never client-supplied exercise names', () => {
  assert.deepEqual(pendingWorkoutExercises(prepareWorkoutExercises([{ exercise_id: 12, exercise_name: 'Untrusted name', sets: [], fromProgram: true }])),
    [{ exercise_id: 12, fromProgram: true }]);
});
check('malformed entries cannot create phantom pending exercises', () => {
  assert.deepEqual(prepareWorkoutExercises([null, {}, { exercise_id: -1, sets: [] }, { exercise_id: 1.5, sets: [] }, { exercise_id: 2147483648, sets: [] }, { exercise_id: 'no', sets: [] }, { exercise_id: 12, sets: null }]), []);
});
check('malformed top-level input is safely empty', () => {
  assert.deepEqual(prepareWorkoutExercises(null), []);
  assert.deepEqual(prepareWorkoutExercises({ exercise_id: 12 }), []);
});
check('program metadata is a boolean, not truthy text', () => {
  assert.equal(prepareWorkoutExercises([{ exercise_id: 12, sets: [], fromProgram: 'false' }])[0].fromProgram, false);
});
check('reopened unfinished exercises do not count as logged training', () => {
  assert.equal(completedWorkoutExercises([{ exercise_id: 12, sets: [], fromProgram: true }]).length, 0);
});
check('only exercises with completed sets count in a mixed session', () => {
  const exercises = [{ exercise_id: 12, sets: [], fromProgram: true }, { exercise_id: 13, sets: [{ reps: 8, weight_kg: 0 }] }];
  assert.deepEqual(completedWorkoutExercises(exercises).map(ex => ex.exercise_id), [13]);
});
check('blank and invalid reps do not mark training complete', () => {
  assert.equal(completedWorkoutExercises([{ sets: [{ reps: '' }, { reps: 0 }, { reps: -1 }, { reps: 'invalid' }] }]).length, 0);
});
check('reopened unfinished program exercises are replaced on a day switch', () => {
  const pending = pendingWorkoutExercises(prepareWorkoutExercises([{ exercise_id: 12, sets: [], fromProgram: true }]))
    .map(ex => ({ ...ex, sets: [] }));
  assert.deepEqual(applyProgramDay(pending, { exercises: [{ exercise_id: 13, exercise_name: 'Squat' }] }).map(ex => ex.exercise_id), [13]);
});
console.log(`\nWORKOUT SESSION LOGIC: ${passed} passed, 0 failed`);
