import api from './client';

// ── Auth ──────────────────────────────────────────────────────────────────────
export const sendOTP         = (phone)          => api.post('/auth/send-otp',   { phone });
export const verifyOTP       = (phone, otp)     => api.post('/auth/verify-otp', { phone, otp });
export const loginCoach    = (email, password)=> api.post('/auth/login',      { email, password });
export const refreshToken    = ()               => api.post('/auth/refresh');
export const logout          = ()               => api.post('/auth/logout');
// Sprint 8: coach/admin change own password
export const changePassword  = (currentPassword, newPassword) =>
  api.patch('/auth/change-password', { currentPassword, newPassword });

// ── Daily logs ────────────────────────────────────────────────────────────────
export const getLog          = (date)           => api.get(`/logs/${date}`);
export const saveLog         = (date, log)      => api.post(`/logs/${date}`, log);
export const getLogRange     = (from, to, memberId) =>
  api.get(`/logs/range/${from}/${to}`, { params: memberId ? { memberId } : {} });
// Sprint 12: member's most-used foods for quick-add
export const getRecentFoods  = ()               => api.get('/logs/recent-foods');

// ── AI Food Identification ────────────────────────────────────────────────────
export const aiFoodIdentify  = (name)           => api.post('/foods/ai-identify', { name });
export const aiFoodConfirm   = (food)           => api.post('/foods/ai-confirm',  { food });

// ── Members (coach/admin only) ─────────────────────────────────────────────
export const getMembers     = ()               => api.get('/members');
export const getMember      = (id)             => api.get(`/members/${id}`);
export const createMember   = (data)           => api.post('/members', data);
export const updateProfile   = (id, data)       => api.patch(`/members/${id}/profile`, data);
export const addLabValue     = (id, data)       => api.post(`/members/${id}/labs`, data);
export const addNote         = (id, data)       => api.post(`/members/${id}/notes`, data);
export const setMemberPin    = (id, pin)        => api.patch(`/members/${id}/pin`, { pin });
export const getMyProfile    = ()               => api.get('/members/me');
// Sprint 11: coach logs/corrects a member's weight for a specific date
export const logWeightForMember = (id, date, weight_kg) =>
  api.patch(`/members/${id}/weight`, { date, weight_kg });

// ── Admin ─────────────────────────────────────────────────────────────────────
export const adminResetPin   = (id, pin)        => api.patch(`/admin/members/${id}/pin`, { pin });
export const adminSendPush   = (data)           => api.post('/admin/push', data);
// Sprint 13: audit log
export const getAuditLog     = (limit = 100)    => api.get(`/admin/audit?limit=${limit}`);

// ── Push notifications ────────────────────────────────────────────────────────
export const subscribePush   = (sub)            => api.post('/notifications/subscribe',   sub);
export const unsubscribePush = (endpoint)       => api.delete('/notifications/unsubscribe', { data: { endpoint } });
export const getMyNotifications  = ()           => api.get('/reminders/my-notifications');
export const markNotificationsRead = ()         => api.post('/reminders/my-notifications/mark-read');
export const getSubscriptions= ()               => api.get('/notifications/subscriptions');
export const getNotifLog     = ()               => api.get('/notifications/log');
