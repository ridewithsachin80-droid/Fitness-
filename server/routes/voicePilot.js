/**
 * routes/voicePilot.js — Phase 8: the Kannada-English voice pilot.
 *
 *   Coach (their members) / admin:
 *     GET    /api/voice-pilot/members          who is invited, consented, how many recorded
 *     POST   /api/voice-pilot/invite           { member_id }
 *     DELETE /api/voice-pilot/invite/:id       stop the invitation and delete their recordings
 *     GET    /api/voice-pilot/results          per phrase, each engine's hit rate; every sample with both transcripts
 *     GET    /api/voice-pilot/results.csv      the same as one file to send on: members as codes, no names, no audio
 *     POST   /api/voice-pilot/results/retry    ask an engine again for the stored recordings it did not answer
 *   Member:
 *     GET    /api/voice-pilot/me               invited?, consented?, phrases and what is recorded
 *     POST   /api/voice-pilot/consent
 *     POST   /api/voice-pilot/sample           { phrase_id, audio, mimeType, duration_ms }
 *     POST   /api/voice-pilot/withdraw         delete every recording now
 *
 * Recordings: private R2 (voice-pilot/<member>/<phrase>-<id>), shown through
 * signed links that expire, deleted after 90 days or on withdrawal. They are
 * only for testing the speech engines: nothing is logged from them.
 */
const express   = require('express');
const crypto    = require('crypto');
const router    = express.Router();
const pool      = require('../db/pool');
const authMW    = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const storage   = require('../services/storage');
const V         = require('../services/voicePilot');

router.use(authMW);
const coachOnly = roleCheck('monitor', 'admin');
const fail = (res, err) => { console.error('voice pilot:', err.message); res.status(500).json({ error: 'Something went wrong.' }); };
const link = (k) => { if (!k) return null; try { return storage.photoUrl(k, { expires: 300 }); } catch (_) { return null; } };
const mine = (user, alias = 'p') => (user.role === 'admin' ? { sql: '', args: [] }
  : { sql: `AND ${alias}.patient_id IN (SELECT patient_id FROM monitor_patients WHERE monitor_id=$1 AND active=true)`, args: [user.id] });

async function canAccess(user, memberId) {
  if (user.role === 'admin') return true;
  const { rows } = await pool.query(`SELECT 1 FROM monitor_patients WHERE monitor_id=$1 AND patient_id=$2 AND active=true`, [user.id, memberId]);
  return rows.length > 0;
}
async function deleteAll(memberId) {
  const { rows } = await pool.query(`SELECT id, object_key FROM voice_samples WHERE patient_id=$1`, [memberId]);
  for (const r of rows) {
    if (r.object_key) await storage.deleteObject(r.object_key);   // throws: the caller reports it, rows stay
    await pool.query(`DELETE FROM voice_samples WHERE id=$1`, [r.id]);
  }
  return rows.length;
}

// ── Coach / admin ────────────────────────────────────────────────────────────
router.get('/members', coachOnly, async (req, res) => {
  try {
    const m = mine(req.user);
    const { rows } = await pool.query(
      `SELECT p.patient_id, u.name, u.active, p.invited_at, p.consented_at, p.withdrawn_at,
              (SELECT COUNT(*)::int FROM voice_samples s WHERE s.patient_id = p.patient_id) AS recorded
         FROM voice_pilot_members p JOIN users u ON u.id = p.patient_id
        WHERE 1=1 ${m.sql.replace('$1', `$${m.args.length}`)} ORDER BY u.name`, m.args);
    res.json({ members: rows, phrases: V.PHRASES.length });
  } catch (err) { fail(res, err); }
});

router.post('/invite', coachOnly, async (req, res) => {
  try {
    const memberId = parseInt(req.body?.member_id);
    if (!Number.isInteger(memberId)) return res.status(400).json({ error: 'Which member?' });
    if (!(await canAccess(req.user, memberId))) return res.status(403).json({ error: 'Member not assigned to you.' });
    const { rows: [u] } = await pool.query(`SELECT role, active FROM users WHERE id=$1`, [memberId]);
    if (u?.role !== 'patient') return res.status(400).json({ error: 'Only members can be invited.' });
    // A switched-off account cannot sign in, so it can never record: inviting
    // it only put a second "Mrs. Padmini" in the list.
    if (u.active === false) return res.status(400).json({ error: 'That account is switched off. Switch it on first, or invite their active account.' });
    await pool.query(
      `INSERT INTO voice_pilot_members (patient_id, invited_by) VALUES ($1,$2)
       ON CONFLICT (patient_id) DO UPDATE SET withdrawn_at = NULL, invited_by = $2, invited_at = NOW(),
         -- Invited again after stopping: they read and agree again.
         consented_at = CASE WHEN voice_pilot_members.withdrawn_at IS NOT NULL THEN NULL ELSE voice_pilot_members.consented_at END`, [memberId, req.user.id]);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

router.delete('/invite/:id', coachOnly, async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);
    if (!(await canAccess(req.user, memberId))) return res.status(403).json({ error: 'Member not assigned to you.' });
    try { await deleteAll(memberId); } catch (e) { return res.status(502).json({ error: "Couldn't delete the recordings just now. Try again." }); }
    await pool.query(`DELETE FROM voice_pilot_members WHERE patient_id=$1`, [memberId]);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

router.get('/results', coachOnly, async (req, res) => {
  try {
    const m = mine(req.user, 's');
    const { rows } = await pool.query(
      `SELECT s.id, s.patient_id, u.name, s.phrase_id, s.object_key, s.duration_ms, s.gemini_text, s.whisper_text, s.gemini_score, s.whisper_score, s.gemini_error, s.whisper_error, s.created_at
         FROM voice_samples s JOIN users u ON u.id = s.patient_id
        WHERE 1=1 ${m.sql.replace('$1', `$${m.args.length}`)} ORDER BY s.phrase_id, u.name`, m.args);
    res.json({ ...V.summarise(rows), samples: rows.map(r => ({ id: r.id, member_id: r.patient_id, name: r.name, phrase_id: r.phrase_id,
      duration_ms: r.duration_ms, gemini: r.gemini_text, whisper: r.whisper_text, gemini_score: r.gemini_score, whisper_score: r.whisper_score,
      gemini_problem: r.gemini_text == null ? (r.gemini_error || 'no answer') : null, whisper_problem: r.whisper_text == null ? (r.whisper_error || 'no answer') : null,
      audio_url: link(r.object_key), at: r.created_at })) });
  } catch (err) { fail(res, err); }
});

// Ask again for recordings an engine gave no answer for. The audio is already
// stored, so the member does not have to record the line a second time: the
// first real run lost 2 of 7 Gemini answers to a passing failure. One engine
// call at a time (the likely cause is "slow down"), at most 20 a tap.
router.post('/results/retry', coachOnly, async (req, res) => {
  try {
    const m = mine(req.user, 's');
    const { rows } = await pool.query(
      `SELECT s.id, s.phrase_id, s.object_key, s.mime_type, s.gemini_text, s.whisper_text
         FROM voice_samples s
        WHERE s.object_key IS NOT NULL AND (s.gemini_text IS NULL OR s.whisper_text IS NULL)
          ${m.sql.replace('$1', `$${m.args.length}`)}
        ORDER BY s.created_at LIMIT 21`, m.args);
    const batch = rows.slice(0, 20);
    let asked = 0, fixed = 0; const problems = [];
    for (const r of batch) {
      let audio;
      try { const buf = await storage.getObject(r.object_key); audio = buf ? buf.toString('base64') : null; }
      catch (e) { audio = null; }
      if (!audio) { problems.push('The recording could not be read from storage.'); continue; }
      for (const engine of ['gemini', 'whisper']) {
        if (r[`${engine}_text`] != null) continue;
        asked++;
        const t = await V.transcribeOne(engine, audio, r.mime_type || 'audio/webm');
        if (t.text != null) {
          fixed++;
          await pool.query(`UPDATE voice_samples SET ${engine}_text=$1, ${engine}_score=$2, ${engine}_error=NULL WHERE id=$3`,
            [t.text, V.score(r.phrase_id, t.text), r.id]);
        } else {
          problems.push(`${engine === 'gemini' ? 'Gemini' : 'Whisper'}: ${t.error || 'no answer'}`);
          await pool.query(`UPDATE voice_samples SET ${engine}_error=$1 WHERE id=$2`, [t.error || null, r.id]);
        }
      }
    }
    res.json({ ok: true, asked, fixed, still: asked - fixed, more: rows.length > batch.length, problems: [...new Set(problems)].slice(0, 3) });
  } catch (err) { fail(res, err); }
});

// One file to send on: every recording, members as codes, no names, no audio.
router.get('/results.csv', coachOnly, async (req, res) => {
  try {
    const m = mine(req.user, 's');
    const { rows } = await pool.query(
      `SELECT s.patient_id, s.phrase_id, s.duration_ms, s.mime_type, s.gemini_text, s.whisper_text, s.gemini_score, s.whisper_score, s.gemini_error, s.whisper_error, s.created_at
         FROM voice_samples s WHERE 1=1 ${m.sql.replace('$1', `$${m.args.length}`)}`, m.args);
    const day = new Date().toISOString().slice(0, 10);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="FitLife-Voice-Pilot-${day}.csv"` });
    res.send(V.resultsCsv(rows));
  } catch (err) { fail(res, err); }
});

// ── Member ───────────────────────────────────────────────────────────────────
const member = roleCheck('patient');
async function pilotRow(id) { return (await pool.query(`SELECT * FROM voice_pilot_members WHERE patient_id=$1 AND withdrawn_at IS NULL`, [id])).rows[0]; }

router.get('/me', member, async (req, res) => {
  try {
    const p = await pilotRow(req.user.id);
    if (!p) return res.json({ invited: false });
    const { rows } = await pool.query(`SELECT phrase_id, gemini_text, whisper_text, created_at FROM voice_samples WHERE patient_id=$1`, [req.user.id]);
    const done = new Map(rows.map(r => [r.phrase_id, r]));
    res.json({ invited: true, consented: !!p.consented_at,
      phrases: V.PHRASES.map(x => ({ id: x.id, say: x.say, means: x.means, free: !!x.free, recorded: done.has(x.id),
        heard: done.get(x.id)?.gemini_text || done.get(x.id)?.whisper_text || null })) });
  } catch (err) { fail(res, err); }
});

router.post('/consent', member, async (req, res) => {
  try {
    const { rowCount } = await pool.query(`UPDATE voice_pilot_members SET consented_at = NOW() WHERE patient_id=$1 AND withdrawn_at IS NULL`, [req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'You are not part of the voice pilot.' });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

router.post('/sample', member, async (req, res) => {
  try {
    const p = await pilotRow(req.user.id);
    if (!p) return res.status(404).json({ error: 'You are not part of the voice pilot.' });
    if (!p.consented_at) return res.status(409).json({ error: 'Please read and agree first.' });
    const phrase = V.PHRASES.find(x => x.id === String(req.body?.phrase_id || ''));
    if (!phrase) return res.status(400).json({ error: 'Unknown phrase.' });
    const audio = req.body?.audio;
    if (!audio || typeof audio !== 'string') return res.status(400).json({ error: 'No recording.' });
    if (audio.length > 3_000_000) return res.status(413).json({ error: 'That recording is too long. Keep it under 20 seconds.' });
    const mt = /^audio\/[a-z0-9.+-]+(;.*)?$/i.test(String(req.body?.mimeType || '')) ? String(req.body.mimeType).split(';')[0] : 'audio/webm';
    if (!storage.isConfigured()) return res.status(503).json({ error: 'Recording storage is not set up yet.' });
    const key = `voice-pilot/${req.user.id}/${phrase.id}-${crypto.randomUUID()}.${mt.includes('mp4') ? 'm4a' : mt.includes('ogg') ? 'ogg' : 'webm'}`;
    try { await storage.putObject(key, Buffer.from(audio, 'base64'), mt); }
    catch (e) { return res.status(502).json({ error: "Couldn't save that recording just now. Try again." }); }
    const t = await V.transcribeBoth(audio, mt);
    const { rows: [old] } = await pool.query(`SELECT object_key FROM voice_samples WHERE patient_id=$1 AND phrase_id=$2`, [req.user.id, phrase.id]);
    await pool.query(
      `INSERT INTO voice_samples (patient_id, phrase_id, object_key, mime_type, duration_ms, gemini_text, whisper_text, gemini_score, whisper_score, gemini_error, whisper_error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (patient_id, phrase_id) DO UPDATE SET object_key=EXCLUDED.object_key, mime_type=EXCLUDED.mime_type, duration_ms=EXCLUDED.duration_ms,
         gemini_text=EXCLUDED.gemini_text, whisper_text=EXCLUDED.whisper_text, gemini_score=EXCLUDED.gemini_score, whisper_score=EXCLUDED.whisper_score,
         gemini_error=EXCLUDED.gemini_error, whisper_error=EXCLUDED.whisper_error,
         created_at=NOW(), delete_after=NOW() + INTERVAL '90 days'`,
      [req.user.id, phrase.id, key, mt, Math.min(60000, Math.max(0, parseInt(req.body?.duration_ms) || 0)) || null,
       t.gemini, t.whisper, t.gemini == null ? null : V.score(phrase.id, t.gemini), t.whisper == null ? null : V.score(phrase.id, t.whisper),
       t.gemini == null ? (t.errors?.gemini || null) : null, t.whisper == null ? (t.errors?.whisper || null) : null]);
    if (old?.object_key && old.object_key !== key) storage.deleteObject(old.object_key).catch(() => {});
    res.json({ ok: true, heard: t.gemini || t.whisper || null });
  } catch (err) { fail(res, err); }
});

router.post('/withdraw', member, async (req, res) => {
  try {
    try { await deleteAll(req.user.id); } catch (e) { return res.status(502).json({ error: "Couldn't delete your recordings just now. Try again." }); }
    await pool.query(`UPDATE voice_pilot_members SET withdrawn_at = NOW() WHERE patient_id=$1`, [req.user.id]);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

/** Recordings past their 90 days. Run daily by cronService; safe to repeat. */
async function deleteExpiredSamples(db = pool, limit = 500) {
  const { rows } = await db.query(`SELECT id, object_key FROM voice_samples WHERE delete_after < NOW() ORDER BY delete_after LIMIT $1`, [limit]);
  let n = 0;
  for (const r of rows) {
    try { if (r.object_key) await storage.deleteObject(r.object_key); await db.query(`DELETE FROM voice_samples WHERE id=$1`, [r.id]); n++; }
    catch (e) { console.error('voice sample expiry failed:', r.id, e.message); }
  }
  return n;
}

module.exports = router;
module.exports.deleteExpiredSamples = deleteExpiredSamples;
