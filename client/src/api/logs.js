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
export const deleteNote      = (id, noteId)     => api.delete(`/members/${id}/notes/${noteId}`);
export const markMessagesRead = (id)            => api.post(`/members/${id}/messages/read`);
export const setMemberPin    = (id, pin)        => api.patch(`/members/${id}/pin`, { pin });
export const getMyProfile    = ()               => api.get('/members/me');
// Sprint 2: first-run setup now lives on the account, not in localStorage, so
// a second device (or a cleared cache) doesn't make the member start over.
export const getMyOnboarding = ()               => api.get('/members/me/onboarding');
export const saveMyOnboarding = (data)          => api.put('/members/me/onboarding', data);

// Sprint 3: member self-service. Until now a member could not change their own
// PIN or correct their own height — every one of those was a WhatsApp round
// trip to the coach.
export const updateMyProfile = (data)           => api.patch('/members/me/profile', data);
export const changeMyPin     = (currentPin, newPin) =>
  api.patch('/auth/change-pin', { currentPin, newPin });
export const getMyReminderSchedule = ()         => api.get('/reminders/my-schedule');

// Sprint 5 — repeat logging. A member eating the same breakfast every day was
// picking each item, confirming grams and tapping Add, every morning.
export const getMealPresets   = ()      => api.get('/foods/presets');
export const saveMealPreset   = (data)  => api.post('/foods/presets', data);
export const deleteMealPreset = (id)    => api.delete(`/foods/presets/${id}`);
export const getYesterdayFood = (meal)  =>
  api.get('/foods/yesterday', { params: meal ? { meal } : {} });

// Sprint 5 — one request for the dashboard's cold open instead of six.
export const getMyToday = ()            => api.get('/members/me/today');
// Sprint 11: coach logs/corrects a member's weight for a specific date
export const logWeightForMember = (id, date, weight_kg) =>
  api.patch(`/members/${id}/weight`, { date, weight_kg });

// ── Admin ─────────────────────────────────────────────────────────────────────
export const adminResetPin   = (id, pin)        => api.patch(`/admin/members/${id}/pin`, { pin });
// Destructive and irreversible — the server refuses unless confirm_name matches
// the member's name exactly, so this cannot be triggered by a mis-tap.
export const adminDeleteMember = (id, confirmName) =>
  api.delete(`/admin/members/${id}`, { data: { confirm_name: confirmName } });
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
