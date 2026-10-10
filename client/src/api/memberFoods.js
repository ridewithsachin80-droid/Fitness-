import api from './client';

// A member's own food labels (10 Oct 2026) — server/routes/memberFoods.js.
export const getMyLabels      = ()              => api.get('/member-foods');
export const saveMyLabel      = (label)         => api.put('/member-foods', label);
export const forgetMyLabel    = (name)          => api.delete('/member-foods', { params: { name } });
export const getMemberLabels  = (memberId)      => api.get(`/member-foods/member/${memberId}`);
