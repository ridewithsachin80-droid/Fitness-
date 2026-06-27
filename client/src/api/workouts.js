import api from './client';

export const searchExercises   = (q, muscleGroup) =>
  api.get('/workouts/exercises', { params: { q, muscle_group: muscleGroup } });
export const addCustomExercise = (data) => api.post('/workouts/exercises', data);
export const getWorkout        = (date, patientId) => api.get('/workouts', { params: { date, patient_id: patientId } });
export const saveWorkout       = (data) => api.post('/workouts', data);
export const getExerciseHistory = (exerciseId, limit) =>
  api.get(`/workouts/history/${exerciseId}`, { params: { limit } });
export const getLoggedExercises = () => api.get('/workouts/logged-exercises');
