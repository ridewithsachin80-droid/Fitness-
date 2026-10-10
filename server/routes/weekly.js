/**
 * routes/weekly.js — Phase 7.
 *
 *   GET  /api/weekly/checkin            member: this week's check-in (open Sun/Mon) and questions
 *   POST /api/weekly/checkin            member: { answers: {energy..plan: 1-5}, note }
 *   GET  /api/weekly/brief/:memberId    coach: the latest brief (made now if the week has none)
 *   POST /api/weekly/brief/:memberId    coach: make it again (after a late check-in)
 */
const express   = require('express');
const router    = express.Router();
const pool      = require('../db/pool');
const authMW    = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const { getISTDate } = require('../utils/istDate');
const W = require('../services/weeklyBrief');

router.use(authMW);
const fail = (res, err) => { console.error('weekly:', err.message); res.status(500).json({ error: 'Something went wrong.' }); };

router.get('/checkin', roleCheck('patient'), async (req, res) => {
  try {
    const today = getISTDate(), weekEnd = W.weekEndFor(today);
    const { rows: [ci] } = await pool.query(`SELECT answers, note, created_at FROM weekly_checkins WHERE patient_id=$1 AND week_end=$2::date`, [req.user.id, weekEnd]);
    res.json({ open: W.checkinOpen(today), week_end: weekEnd, questions: W.QUESTIONS, checkin: ci || null });
  } catch (err) { fail(res, err); }
});

router.post('/checkin', roleCheck('patient'), async (req, res) => {
  try {
    const today = getISTDate();
    if (!W.checkinOpen(today)) return res.status(409).json({ error: 'The weekly check-in opens on Sunday.' });
    const answers = W.normaliseAnswers(req.body?.answers);
    if (Object.keys(answers).length < W.QUESTIONS.length) return res.status(400).json({ error: 'Answer all five, from 1 to 5.' });
    const note = String(req.body?.note || '').trim().slice(0, 600) || null;
    const weekEnd = W.weekEndFor(today);
    await pool.query(
      `INSERT INTO weekly_checkins (patient_id, week_end, answers, note) VALUES ($1,$2,$3,$4)
       ON CONFLICT (patient_id, week_end) DO UPDATE SET answers=EXCLUDED.answers, note=EXCLUDED.note, created_at=NOW()`,
      [req.user.id, weekEnd, JSON.stringify(answers), note]);
    res.json({ ok: true, week_end: weekEnd });
  } catch (err) { fail(res, err); }
});

async function canAccess(user, memberId) {
  if (user.role === 'admin') return true;
  const { rows } = await pool.query(`SELECT 1 FROM monitor_patients WHERE monitor_id=$1 AND patient_id=$2 AND active=true`, [user.id, memberId]);
  return rows.length > 0;
}
const briefView = (b) => b && ({ week_end: b.week_end instanceof Date ? b.week_end.toISOString().slice(0, 10) : String(b.week_end).slice(0, 10),
  text: b.text, source: b.source, facts: b.facts, created_at: b.created_at });

router.get('/brief/:memberId', roleCheck('monitor', 'admin'), async (req, res) => {
  try {
    const memberId = parseInt(req.params.memberId);
    if (!Number.isInteger(memberId) || !(await canAccess(req.user, memberId))) return res.status(403).json({ error: 'Member not assigned to you.' });
    // The last week that has fully ended (on a Sunday, the week before).
    const weekEnd = W.lastWeekEnd(getISTDate());
    let { rows: [b] } = await pool.query(`SELECT * FROM coach_briefs WHERE patient_id=$1 AND week_end=$2::date`, [memberId, weekEnd]);
    // Made now if missing, or again if the member checked in after it was written.
    const { rows: [ci] } = await pool.query(`SELECT created_at FROM weekly_checkins WHERE patient_id=$1 AND week_end=$2::date`, [memberId, weekEnd]);
    if (!b || (ci && new Date(ci.created_at) > new Date(b.created_at))) b = await W.makeBrief(pool, memberId, weekEnd);
    res.json({ brief: briefView(b), questions: W.QUESTIONS });
  } catch (err) { fail(res, err); }
});

router.post('/brief/:memberId', roleCheck('monitor', 'admin'), async (req, res) => {
  try {
    const memberId = parseInt(req.params.memberId);
    if (!Number.isInteger(memberId) || !(await canAccess(req.user, memberId))) return res.status(403).json({ error: 'Member not assigned to you.' });
    const b = await W.makeBrief(pool, memberId, W.lastWeekEnd(getISTDate()));
    res.json({ brief: briefView(b), questions: W.QUESTIONS });
  } catch (err) { fail(res, err); }
});

module.exports = router;
