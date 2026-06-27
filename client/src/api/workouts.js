import api from './client';

export const searchExercises   = (q, muscleGroup) =>
  api.get('/workouts/exercises', { params: { q, muscle_group: muscleGroup } });
export const addCustomExercise = (data) => api.post('/workouts/exercises', data);
export const getWorkout        = (date) => api.get('/workouts', { params: { date } });
export const saveWorkout       = (data) => api.post('/workouts', data);
export const getExerciseHistory = (exerciseId, limit) =>
  api.get(`/workouts/history/${exerciseId}`, { params: { limit } });
export const getLoggedExercises = () => api.get('/workouts/logged-exercises');
