import api from './client';

export const getTemplates     = () => api.get('/programs/templates');
export const getActiveProgram = (patientId) => api.get('/programs/active', { params: { patient_id: patientId } });
export const getProgram       = (id) => api.get(`/programs/${id}`);
export const createProgram    = (data) => api.post('/programs', data);
export const updateProgram    = (id, data) => api.put(`/programs/${id}`, data);
export const assignProgram    = (id, patientId) => api.post(`/programs/${id}/assign`, { patient_id: patientId });
export const deleteProgram    = (id) => api.delete(`/programs/${id}`);
