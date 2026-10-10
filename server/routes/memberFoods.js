/**
 * routes/memberFoods.js — a member's own labels for foods (10 Oct 2026).
 *
 *   GET    /api/member-foods                 member: their labels
 *   PUT    /api/member-foods                 member: save one { name, per_100g: { protein, carbs, fat, ... }, food_id? }
 *   DELETE /api/member-foods?name=Oats       member: stop using their label for a food
 *   GET    /api/member-foods/member/:id      coach: a member's labels (assigned coach or admin)
 *
 * Calories are never taken from the request: services/memberFoods.js works
 * them out from the macros (4/4/9). The shared foods table is never written.
 */
const express   = require('express');
const router    = express.Router();
const authMW    = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const MF        = require('../services/memberFoods');

router.use(authMW);
const memberOnly = roleCheck('patient');
const coachOnly  = roleCheck('monitor', 'admin');
const fail = (res, e, msg = 'Something went wrong.') => {
  if (!e.status || e.status >= 500) console.error('member-foods:', e.message);
  res.status(e.status || 500).json({ error: e.status ? e.message : msg });
};

router.get('/', memberOnly, async (req, res) => {
  try { res.json(await MF.labelsFor(req.user.id)); }
  catch (e) { fail(res, e, "Couldn't load your labels."); }
});

router.put('/', memberOnly, async (req, res) => {
  try { res.json(await MF.saveLabel(req.user.id, req.body || {})); }
  catch (e) { fail(res, e, "Couldn't save your label."); }
});

router.delete('/', memberOnly, async (req, res) => {
  try {
    const name = String(req.query.name || req.body?.name || '');
    if (!name.trim()) return res.status(400).json({ error: 'Which food?' });
    res.json({ removed: await MF.forgetLabel(req.user.id, name) });
  } catch (e) { fail(res, e, "Couldn't remove that label."); }
});

router.get('/member/:id', coachOnly, async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);
    if (!Number.isInteger(memberId)) return res.status(400).json({ error: 'Bad member.' });
    if (!(await require('./dietPlans').canAccess(req.user, memberId))) return res.status(403).json({ error: 'Member not assigned to you.' });
    res.json(await MF.labelsFor(memberId));
  } catch (e) { fail(res, e, "Couldn't load this member's labels."); }
});

module.exports = router;
