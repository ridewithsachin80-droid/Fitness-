import api from './client';

// ── Auth ──────────────────────────────────────────────────────────────────────
export const sendOTP         = (phone)          => api.post('/auth/send-otp',   { phone });
export const verifyOTP       = (phone, otp)     => api.post('/auth/verify-otp', { phone, otp });
export const loginMonitor    = (email, password)=> api.post('/auth/login',      { email, password });
export const refreshToken    = ()               => api.post('/auth/refresh');
export const logout          = ()               => api.post('/auth/logout');
// Sprint 8: monitor/admin change own password
export const changePassword  = (currentPassword, newPassword) =>
  api.patch('/auth/change-password', { currentPassword, newPassword });

// ── Daily logs ────────────────────────────────────────────────────────────────
export const getLog          = (date)           => api.get(`/logs/${date}`);
export const saveLog         = (date, log)      => api.post(`/logs/${date}`, log);
export const getLogRange     = (from, to, patientId) =>
  api.get(`/logs/range/${from}/${to}`, { params: patientId ? { patientId } : {} });

// ── Patients (monitor/admin only) ─────────────────────────────────────────────
export const getPatients     = ()               => api.get('/patients');
export const getPatient      = (id)             => api.get(`/patients/${id}`);
export const createPatient   = (data)           => api.post('/patients', data);
export const updateProfile   = (id, data)       => api.patch(`/patients/${id}/profile`, data);
export const addLabValue     = (id, data)       => api.post(`/patients/${id}/labs`, data);
export const addNote         = (id, data)       => api.post(`/patients/${id}/notes`, data);
// Sprint 8: set or reset a member's login PIN (from monitor page)
export const setMemberPin    = (id, pin)        => api.patch(`/patients/${id}/pin`, { pin });

// ── Admin ─────────────────────────────────────────────────────────────────────
// Sprint 9: admin can reset PIN directly from the dashboard
export const adminResetPin   = (id, pin)        => api.patch(`/admin/members/${id}/pin`, { pin });

// ── Push notifications ────────────────────────────────────────────────────────
export const subscribePush   = (sub)            => api.post('/notifications/subscribe',   sub);
export const unsubscribePush = (endpoint)       => api.delete('/notifications/unsubscribe', { data: { endpoint } });
export const getSubscriptions= ()               => api.get('/notifications/subscriptions');
export const getNotifLog     = ()               => api.get('/notifications/log');
