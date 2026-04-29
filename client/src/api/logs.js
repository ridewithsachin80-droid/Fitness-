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
// Sprint 12: member's most-used foods for quick-add
export const getRecentFoods  = ()               => api.get('/logs/recent-foods');

// ── Patients (monitor/admin only) ─────────────────────────────────────────────
export const getPatients     = ()               => api.get('/patients');
export const getPatient      = (id)             => api.get(`/patients/${id}`);
export const createPatient   = (data)           => api.post('/patients', data);
export const updateProfile   = (id, data)       => api.patch(`/patients/${id}/profile`, data);
export const addLabValue     = (id, data)       => api.post(`/patients/${id}/labs`, data);
export const addNote         = (id, data)       => api.post(`/patients/${id}/notes`, data);
export const setMemberPin    = (id, pin)        => api.patch(`/patients/${id}/pin`, { pin });
export const getMyProfile    = ()               => api.get('/patients/me');
// Sprint 11: monitor logs/corrects a member's weight for a specific date
export const logWeightForPatient = (id, date, weight_kg) =>
  api.patch(`/patients/${id}/weight`, { date, weight_kg });

// ── Admin ─────────────────────────────────────────────────────────────────────
export const adminResetPin   = (id, pin)        => api.patch(`/admin/members/${id}/pin`, { pin });
export const adminSendPush   = (data)           => api.post('/admin/push', data);
// Sprint 13: audit log
export const getAuditLog     = (limit = 100)    => api.get(`/admin/audit?limit=${limit}`);

// ── Push notifications ────────────────────────────────────────────────────────
export const subscribePush   = (sub)            => api.post('/notifications/subscribe',   sub);
export const unsubscribePush = (endpoint)       => api.delete('/notifications/unsubscribe', { data: { endpoint } });
export const getSubscriptions= ()               => api.get('/notifications/subscriptions');
export const getNotifLog     = ()               => api.get('/notifications/log');
