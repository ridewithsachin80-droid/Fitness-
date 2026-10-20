/**
 * routes/voiceFallbackTest.js — Fixes-2p (B18): the test-only voice fallback
 * switch. Administrators only. See services/voiceFallbackTest.js.
 *
 *   GET    /api/voice-fallback-test             { available, account, runs }
 *   PUT    /api/voice-fallback-test             { user_id } name the one test account (24 hours)
 *   DELETE /api/voice-fallback-test             turn it off now
 *   DELETE /api/voice-fallback-test/runs        clear the recorded tries
 *   GET    /api/voice-fallback-test/runs.xlsx   the recorded tries, with Whisper's raw numbers
 */
const express   = require('express');
const router    = express.Router();
const pool      = require('../db/pool');
const authMW    = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const T         = require('../services/voiceFallbackTest');
const X         = require('../services/xlsxLite');

router.use(authMW, roleCheck('admin'));
const fail = (res, err) => { console.error('voice fallback test:', err.message); res.status(500).json({ error: 'Something went wrong.' }); };
const OFF = 'This switch only works on the test server, so members on the live app are never affected.';

async function runs(limit = 50) {
  const { rows } = await pool.query(
    `SELECT r.id, r.created_at, u.name, r.lang_hint, r.language_sent, r.whisper_text, r.whisper_language,
            r.segments, r.accepted, r.reason, r.transcript, r.error
       FROM voice_fallback_test_runs r LEFT JOIN users u ON u.id = r.user_id
      ORDER BY r.created_at DESC, r.id DESC LIMIT $1`, [limit]);
  return rows;
}

router.get('/', async (req, res) => {
  try {
    if (!T.available()) return res.json({ available: false, message: OFF, account: null, runs: [] });
    const c = await T.current();
    res.json({ available: true, hours: T.HOURS,
      account: c ? { user_id: c.user_id, name: c.name, role: c.role, set_at: c.set_at, ends_at: c.ends_at } : null,
      runs: await runs() });
  } catch (e) { fail(res, e); }
});

router.put('/', async (req, res) => {
  if (!T.available()) return res.status(409).json({ error: OFF });
  const id = Number(req.body?.user_id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose an account.' });
  try {
    const { rows } = await pool.query(`SELECT id, name, active FROM users WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'That account was not found.' });
    if (rows[0].active === false) return res.status(400).json({ error: 'That account is switched off.' });
    // One account at a time: naming another replaces it, and restarts the 24 hours.
    await pool.query(
      `INSERT INTO voice_fallback_test_account (id, user_id, set_by, set_at) VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, set_by = EXCLUDED.set_by, set_at = NOW()`, [id, req.user.id]);
    const c = await T.current();
    res.json({ ok: true, account: { user_id: c.user_id, name: c.name, role: c.role, set_at: c.set_at, ends_at: c.ends_at } });
  } catch (e) { fail(res, e); }
});

router.delete('/', async (req, res) => {
  try { await pool.query(`DELETE FROM voice_fallback_test_account WHERE id = 1`); res.json({ ok: true }); }
  catch (e) { fail(res, e); }
});

router.delete('/runs', async (req, res) => {
  try { const r = await pool.query(`DELETE FROM voice_fallback_test_runs`); res.json({ ok: true, deleted: r.rowCount }); }
  catch (e) { fail(res, e); }
});

router.get('/runs.xlsx', async (req, res) => {
  try {
    const list = await runs(500);
    const head = ['run', 'time_utc', 'account', 'voice_language_chosen', 'language_sent_to_whisper', 'whisper_text_raw', 'whisper_language_reported', 'decision', 'reason_refused', 'transcript_passed_on', 'error', 'sections'];
    const rows = list.map(r => [r.id, new Date(r.created_at).toISOString(), r.name, r.lang_hint, r.language_sent || 'not set',
      r.whisper_text, r.whisper_language, r.accepted == null ? 'no answer' : r.accepted ? 'accepted' : 'refused', r.reason, r.transcript, r.error,
      (r.segments || []).length]);
    const segHead = ['run', 'section', 'start_s', 'end_s', 'text', 'avg_logprob', 'no_speech_prob', 'compression_ratio'];
    const segRows = list.flatMap(r => (r.segments || []).map((s, i) => [r.id, i + 1, s.start, s.end, s.text, s.avg_logprob, s.no_speech_prob, s.compression_ratio]));
    const buf = X.workbook([{ name: 'Tries', rows: [head, ...rows] }, { name: 'Sections', rows: [segHead, ...segRows] }]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="FitLife-Voice-Fallback-Test.xlsx"');
    res.send(buf);
  } catch (e) { fail(res, e); }
});

module.exports = router;
