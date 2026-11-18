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
 *     POST   /api/voice-pilot/results/rerun    { setting: 'kn'|'en'|'auto', sample_ids? } Whisper again on stored recordings, kept BESIDE the original (Fixes-2m); sample_ids limits it to those (Fixes-2t); empty answers are asked again and every attempt kept (Fixes-2u)
 *     GET    /api/voice-pilot/results.xlsx     the same file as an Excel workbook: no text-encoding step to go wrong (Fixes-2m)
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
const X         = require('../services/xlsxLite');

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

// Fixes-2m: what the coach needs to read a transcript: which script it is in,
// Kannada script spelled out in English letters, the meaning checks, and what
// Whisper was asked for and used.
const latinOf = (t) => (t && V.scriptOf(t) === 'kannada' ? V.kannadaToLatin(t) : null);
const describe = (r) => ({
  gemini_script: V.scriptOf(r.gemini_text), whisper_script: V.scriptOf(r.whisper_text),
  gemini_latin: latinOf(r.gemini_text), whisper_latin: latinOf(r.whisper_text),
  gemini_checks: V.meaningChecks(r.phrase_id, r.gemini_text), whisper_checks: V.meaningChecks(r.phrase_id, r.whisper_text),
  whisper_setting: r.whisper_text == null ? null : (r.whisper_setting || 'auto'), whisper_language: r.whisper_language || null,
  // Fixes-2u: an answer with no words is shown as an empty answer, apart from "no answer" (an error).
  gemini_empty: r.gemini_text != null && !V.nonBlank(r.gemini_text), whisper_empty: r.whisper_text != null && !V.nonBlank(r.whisper_text),
});
async function rerunsFor(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const { rows } = await pool.query(`SELECT * FROM voice_sample_reruns WHERE sample_id = ANY($1::int[]) ORDER BY setting, engine`, [ids]);
  for (const r of rows) { if (!out.has(r.sample_id)) out.set(r.sample_id, []); out.get(r.sample_id).push(r); }
  return out;
}
// Fixes-2u: every attempt (oldest first), so a later answer never hides an earlier empty one.
async function attemptsFor(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const { rows } = await pool.query(`SELECT * FROM voice_sample_rerun_attempts WHERE sample_id = ANY($1::int[]) ORDER BY attempted_at, id`, [ids]);
  for (const r of rows) { const k = `${r.sample_id}|${r.engine}|${r.setting}`; if (!out.has(k)) out.set(k, []); out.get(k).push(r); }
  return out;
}
const rerunProblem = (x) => (x.text == null ? (x.error || 'no answer') : !V.nonBlank(x.text) ? 'empty answer' : null);

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
      `SELECT s.id, s.patient_id, u.name, s.phrase_id, s.object_key, s.duration_ms, s.gemini_text, s.whisper_text, s.gemini_score, s.whisper_score, s.gemini_error, s.whisper_error,
              s.whisper_setting, s.whisper_language, s.created_at
         FROM voice_samples s JOIN users u ON u.id = s.patient_id
        WHERE 1=1 ${m.sql.replace('$1', `$${m.args.length}`)} ORDER BY s.phrase_id, u.name`, m.args);
    const reruns = await rerunsFor(rows.map(r => r.id));
    const attempts = await attemptsFor(rows.map(r => r.id));
    res.json({ ...V.summarise(rows), checks: V.checksSummary(rows), samples: rows.map(r => ({ id: r.id, member_id: r.patient_id, name: r.name, phrase_id: r.phrase_id,
      duration_ms: r.duration_ms, gemini: r.gemini_text, whisper: r.whisper_text, gemini_score: r.gemini_score, whisper_score: r.whisper_score,
      gemini_problem: r.gemini_text == null ? (r.gemini_error || 'no answer') : null, whisper_problem: r.whisper_text == null ? (r.whisper_error || 'no answer') : null,
      ...describe(r), reruns: (reruns.get(r.id) || []).map(x => ({ engine: x.engine, setting: x.setting, text: x.text, language: x.language, score: x.score,
        problem: rerunProblem(x), empty: x.text != null && !V.nonBlank(x.text), script: V.scriptOf(x.text), latin: latinOf(x.text), checks: V.meaningChecks(r.phrase_id, x.text), at: x.created_at,
        attempts: (attempts.get(`${r.id}|${x.engine}|${x.setting}`) || []).map(a => ({ outcome: a.outcome, source: a.source, text: a.text, language: a.language, score: a.score, error: a.error,
          config: a.config, segments: a.segments, at: a.attempted_at })) })),
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
          if (engine === 'whisper') await pool.query(`UPDATE voice_samples SET whisper_setting=$1, whisper_language=$2 WHERE id=$3`, [t.setting || null, t.language || null, r.id]);
        } else {
          problems.push(`${engine === 'gemini' ? 'Gemini' : 'Whisper'}: ${t.error || 'no answer'}`);
          await pool.query(`UPDATE voice_samples SET ${engine}_error=$1 WHERE id=$2`, [t.error || null, r.id]);
        }
      }
    }
    res.json({ ok: true, asked, fixed, still: asked - fixed, more: rows.length > batch.length, problems: [...new Set(problems)].slice(0, 3) });
  } catch (err) { fail(res, err); }
});

// Fixes-2m: ask Whisper AGAIN about stored recordings with one setting (the
// language fixed to Kannada, to English, or left to guess), to compare with
// what it first wrote. The original result is never changed: the answer is
// kept beside it (voice_sample_reruns), with its own keyword score and meaning
// checks. Recordings that already have an answer for that setting are skipped.
// One call at a time, at most 20 a tap. Evaluation only: it changes nothing a
// member sees and chooses no engine.
// Fixes-2u: an EMPTY answer (no words) is not an answer: such a recording is
// asked again (it used to be skipped, so k01's empty result of 21 Oct could
// never be retried). Every attempt is kept in voice_sample_rerun_attempts,
// including the empty one it replaces, and the reply counts requests, provider
// responses, answers with words, empty answers and errors separately.
const RERUN_SETTINGS = ['kn', 'en', 'auto'];
router.post('/results/rerun', coachOnly, async (req, res) => {
  try {
    const setting = String(req.body?.setting || '');
    if (!RERUN_SETTINGS.includes(setting)) return res.status(400).json({ error: 'Which setting? kn, en or auto.' });
    const m = mine(req.user, 's');
    // Fixes-2t: automation may name exactly which recordings to re-run (the voice
    // evidence robot sends only the approved ones, so no other recording reaches
    // the provider or gets a re-run row). Without sample_ids, as before: all.
    const args = [...m.args]; let only = '';
    if (req.body?.sample_ids !== undefined) {
      const ids = req.body.sample_ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 20 || !ids.every(n => Number.isInteger(n) && n > 0)) return res.status(400).json({ error: 'sample_ids must list 1 to 20 recording ids.' });
      args.push([...new Set(ids)]); only = `AND s.id = ANY($${args.length}::int[])`;
    }
    const { rows } = await pool.query(
      `SELECT s.id, s.phrase_id, s.object_key, s.mime_type FROM voice_samples s
        WHERE s.object_key IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM voice_sample_reruns x WHERE x.sample_id = s.id AND x.engine = 'whisper' AND x.setting = '${setting}' AND x.text ~ '[^[:space:]]')
          ${m.sql.replace('$1', `$${m.args.length}`)} ${only}
        ORDER BY s.created_at LIMIT 21`, args);
    const batch = rows.slice(0, 20);
    let asked = 0, responses = 0, answered = 0, empty = 0, errors = 0; const problems = [];
    const promptSha = crypto.createHash('sha256').update(V.WHISPER_PROMPT).digest('hex').slice(0, 16);
    for (const r of batch) {
      let audio;
      try { const buf = await storage.getObject(r.object_key); audio = buf ? buf.toString('base64') : null; } catch (e) { audio = null; }
      if (!audio) { problems.push('The recording could not be read from storage.'); continue; }
      asked++;
      // The answer this attempt will replace is kept first (once), so no result is ever lost.
      await pool.query(
        `INSERT INTO voice_sample_rerun_attempts (sample_id, engine, setting, text, language, score, error, outcome, source, attempted_at)
         SELECT sample_id, engine, setting, text, language, score, error,
                CASE WHEN text IS NULL THEN 'error' WHEN text ~ '[^[:space:]]' THEN 'transcript' ELSE 'empty' END, 'kept_from_latest', created_at
           FROM voice_sample_reruns WHERE sample_id = $1 AND engine = 'whisper' AND setting = $2
         ON CONFLICT (sample_id, engine, setting, attempted_at) DO NOTHING`, [r.id, setting]);
      const t = await V.transcribeOne('whisper', audio, r.mime_type || 'audio/webm', { language: setting });
      const outcome = t.text == null ? 'error' : V.nonBlank(t.text) ? 'transcript' : 'empty';
      if (outcome !== 'error') responses++;
      if (outcome === 'transcript') answered++;
      else if (outcome === 'empty') { empty++; problems.push('Whisper answered with no words (an empty answer).'); }
      else { errors++; problems.push(`Whisper: ${t.error || 'no answer'}`); }
      const at = new Date();   // one time for both rows, so the latest answer and its attempt match
      const config = { path: 'pilot', model: 'whisper-large-v3', response_format: 'verbose_json', temperature: '0', language: setting === 'auto' ? null : setting,
        prompt_sha256: promptSha, audio_sha256: crypto.createHash('sha256').update(audio).digest('hex').slice(0, 16), mime: r.mime_type || 'audio/webm' };
      const score = t.text != null ? V.score(r.phrase_id, t.text) : null;
      await pool.query(
        `INSERT INTO voice_sample_rerun_attempts (sample_id, engine, setting, text, language, score, error, outcome, source, config, segments, attempted_at)
         VALUES ($1,'whisper',$2,$3,$4,$5,$6,$7,'rerun',$8,$9,$10) ON CONFLICT (sample_id, engine, setting, attempted_at) DO NOTHING`,
        [r.id, setting, t.text, t.text != null ? (t.language || null) : null, score, t.text == null ? (t.error || null) : null, outcome,
         JSON.stringify(config), t.segments ? JSON.stringify(t.segments) : null, at]);
      await pool.query(
        `INSERT INTO voice_sample_reruns (sample_id, engine, setting, text, language, score, error, created_at) VALUES ($1,'whisper',$2,$3,$4,$5,$6,$7)
         ON CONFLICT (sample_id, engine, setting) DO UPDATE SET text=EXCLUDED.text, language=EXCLUDED.language, score=EXCLUDED.score, error=EXCLUDED.error, created_at=EXCLUDED.created_at`,
        [r.id, setting, t.text, t.text != null ? (t.language || null) : null, score, t.text == null ? (t.error || null) : null, at]);
    }
    // answered = answers WITH words (an empty answer is not counted as answered).
    res.json({ ok: true, setting, asked, responses, answered, empty, errors, more: rows.length > batch.length, problems: [...new Set(problems)].slice(0, 3), sample_ids: batch.map(r => r.id) });
  } catch (err) { fail(res, err); }
});

const exportQuery = (m) => pool.query(
  `SELECT s.id, s.patient_id, s.phrase_id, s.duration_ms, s.mime_type, s.gemini_text, s.whisper_text, s.gemini_score, s.whisper_score, s.gemini_error, s.whisper_error,
          s.whisper_setting, s.whisper_language, s.created_at
     FROM voice_samples s WHERE 1=1 ${m.sql.replace('$1', `$${m.args.length}`)}`, m.args);

// Fixes-2m: the results as an Excel workbook. Text is stored as UTF-8 inside the
// file, so Kannada and Tamil cannot be misread the way the 19 Oct CSV was.
// Sheet 2 lists the re-runs (same member codes), beside the originals.
router.get('/results.xlsx', coachOnly, async (req, res) => {
  try {
    const { rows } = await exportQuery(mine(req.user, 's'));
    const ids = [...new Set(rows.map(r => r.patient_id))].sort((a, b) => a - b);
    const code = new Map(ids.map((id, i) => [id, `M${i + 1}`]));
    const reruns = await rerunsFor(rows.map(r => r.id));
    const re = [['member', 'line_id', 'engine', 'setting', 'heard', 'keyword_score', 'rule_checks', 'script', 'language_used', 'problem', 'asked_at']];
    const pctOf = (x) => (x.text == null ? 'no answer' : !V.nonBlank(x.text) ? '0% (empty answer)' : Math.round((Number(x.score) || 0) * 100) + '%');
    for (const r of rows) for (const x of reruns.get(r.id) || []) {
      re.push([code.get(r.patient_id), r.phrase_id, x.engine, x.setting, x.text, pctOf(x),
        V.checksText(V.meaningChecks(r.phrase_id, x.text)), x.text == null ? '' : (V.SCRIPT_LABEL[V.scriptOf(x.text)] || ''), x.language || '', rerunProblem(x) || '',
        new Date(x.created_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC']);
    }
    // Fixes-2u: sheet 3, every attempt (an earlier empty answer stays visible after a later one).
    const attempts = await attemptsFor(rows.map(r => r.id));
    const at = [['member', 'line_id', 'engine', 'setting', 'outcome', 'heard', 'keyword_score', 'language_used', 'problem', 'recorded_as', 'model', 'language_sent', 'prompt_sha256', 'audio_sha256', 'attempted_at']];
    for (const r of rows) for (const list of [...attempts.entries()].filter(([k]) => k.startsWith(`${r.id}|`)).map(([, v]) => v)) for (const a of list) {
      at.push([code.get(r.patient_id), r.phrase_id, a.engine, a.setting, a.outcome, a.text, pctOf(a), a.language || '', rerunProblem(a) || '',
        a.source === 'kept_from_latest' ? 'earlier answer kept' : 'attempt', a.config?.model || '', a.config ? (a.config.language || 'not set') : '', a.config?.prompt_sha256 || '', a.config?.audio_sha256 || '',
        new Date(a.attempted_at).toISOString().slice(0, 19).replace('T', ' ') + ' UTC']);
    }
    const day = new Date().toISOString().slice(0, 10);
    const buf = X.workbook([{ name: 'Recordings', rows: [V.HEAD, ...V.resultRows(rows)] }, { name: 'Re-runs', rows: re }, { name: 'Re-run attempts', rows: at }]);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="FitLife-Voice-Pilot-${day}.xlsx"` });
    res.send(buf);
  } catch (err) { fail(res, err); }
});

// One file to send on: every recording, members as codes, no names, no audio.
router.get('/results.csv', coachOnly, async (req, res) => {
  try {
    const m = mine(req.user, 's');
    const { rows } = await exportQuery(m);
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
      `INSERT INTO voice_samples (patient_id, phrase_id, object_key, mime_type, duration_ms, gemini_text, whisper_text, gemini_score, whisper_score, gemini_error, whisper_error, whisper_setting, whisper_language)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (patient_id, phrase_id) DO UPDATE SET object_key=EXCLUDED.object_key, mime_type=EXCLUDED.mime_type, duration_ms=EXCLUDED.duration_ms,
         gemini_text=EXCLUDED.gemini_text, whisper_text=EXCLUDED.whisper_text, gemini_score=EXCLUDED.gemini_score, whisper_score=EXCLUDED.whisper_score,
         gemini_error=EXCLUDED.gemini_error, whisper_error=EXCLUDED.whisper_error, whisper_setting=EXCLUDED.whisper_setting, whisper_language=EXCLUDED.whisper_language,
         created_at=NOW(), delete_after=NOW() + INTERVAL '90 days'
       RETURNING id`,
      [req.user.id, phrase.id, key, mt, Math.min(60000, Math.max(0, parseInt(req.body?.duration_ms) || 0)) || null,
       t.gemini, t.whisper, t.gemini == null ? null : V.score(phrase.id, t.gemini), t.whisper == null ? null : V.score(phrase.id, t.whisper),
       t.gemini == null ? (t.errors?.gemini || null) : null, t.whisper == null ? (t.errors?.whisper || null) : null,
       t.whisper_setting || null, t.whisper == null ? null : (t.whisper_language || null)]);
    // A new recording of the line: the re-runs were about the old audio, so they go.
    if (old?.object_key && old.object_key !== key) {
      await pool.query(`DELETE FROM voice_sample_reruns WHERE sample_id IN (SELECT id FROM voice_samples WHERE patient_id=$1 AND phrase_id=$2)`, [req.user.id, phrase.id]);
      // Fixes-2u: the attempt history was about the old audio too.
      await pool.query(`DELETE FROM voice_sample_rerun_attempts WHERE sample_id IN (SELECT id FROM voice_samples WHERE patient_id=$1 AND phrase_id=$2)`, [req.user.id, phrase.id]);
    }
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
