/**
 * routes/voiceCalibration.js — Fixes-2x: the voice calibration kit (B18/B19). TEST SERVER ONLY:
 * every route answers 404 elsewhere, with no database read (services/voiceFallbackTest.available).
 *
 *   Volunteer (member):
 *     GET    /api/voice-calibration/me            invited?, consented?, their planned slots (no transcripts shown)
 *     POST   /api/voice-calibration/consent       { phone_type, browser, installed_app }
 *     POST   /api/voice-calibration/take          { slot, audio, mimeType, duration_ms, retake_reason?, retake_note? }
 *     POST   /api/voice-calibration/withdraw      delete every take now
 *   Administrator:
 *     GET    /api/voice-calibration/admin             volunteers, quotas, wording checks, Part C plan and tries
 *     POST   /api/voice-calibration/admin/invite      { member_id, group: 'kn'|'hi'|'en', profile_note? }
 *     DELETE /api/voice-calibration/admin/participant/:id   remove a volunteer and delete their takes
 *     POST   /api/voice-calibration/admin/wording     { lang, confirmed_by, note? }   a fluent speaker's check of the exact lines
 *     POST   /api/voice-calibration/admin/wording/revoke  { lang }
 *     GET    /api/voice-calibration/admin/takes       every take (history), with a player link
 *     POST   /api/voice-calibration/admin/label       { take_id, heard?: 'speech'|'no_speech'|'uncertain'|null, spoken_as_script?, reference_text?, reference_items? }
 *     POST   /api/voice-calibration/admin/preview-eval    rule 3: newly admitted takes' two legs through the logging parser (evaluation mode; deduplicated)
 *     POST   /api/voice-calibration/admin/remeasure   measure stored audio again; must equal what was stored
 *     POST   /api/voice-calibration/admin/partc/arm   { trial, account_id }   one try at a time; the day's baseline is kept
 *     POST   /api/voice-calibration/admin/partc/readback   what changed on the test account's day since arming
 *     POST   /api/voice-calibration/admin/partc/restore    put the day back to the baseline and compare the whole day
 *     POST   /api/voice-calibration/admin/partc/finish     stop recording; verify the Voice backup switch is off
 *   The armed test account (controlled mode / on-device reports):
 *     GET    /api/voice-calibration/partc/me
 *     POST   /api/voice-calibration/partc/device-event { text, lang }
 *     PUT    /api/voice-calibration/admin/partc/:trial { items: [{label, ok}], applied, day_correct, notes }
 *     GET    /api/voice-calibration/admin/export.xlsx  the workbook: codes only, no names, no audio
 *
 * Recordings: private storage (voice-calibration/<volunteer>/<slot>-<id>), signed links that expire,
 * deleted after 90 days, on withdrawal, or when an administrator removes the volunteer.
 */
const express   = require('express');
const crypto    = require('crypto');
const router    = express.Router();
const pool      = require('../db/pool');
const authMW    = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const storage   = require('../services/storage');
const C         = require('../services/voiceCalibration');
const SP        = require('../services/speechPresence');
const X         = require('../services/xlsxLite');

// Off the test server nothing here exists (and nothing is read).
router.use((req, res, next) => (C.available() ? next() : res.status(404).json({ error: 'Not available on this server.' })));
router.use(authMW);
const admin = roleCheck('admin');
const member = roleCheck('patient');
const fail = (res, err) => { console.error('voice calibration:', err.message); res.status(500).json({ error: 'Something went wrong.' }); };
const link = (k) => { if (!k) return null; try { return storage.photoUrl(k, { expires: 300 }); } catch (_) { return null; } };
const PHONES = ['android_budget', 'android_mid', 'iphone'];
const BROWSERS = ['chrome', 'safari', 'samsung', 'other'];
const RETAKE_REASONS = ['cut_off', 'wrong_line', 'interrupted', 'other'];
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const { getISTDate } = require('../utils/istDate');
const HEARD = ['speech', 'no_speech', 'uncertain'];

async function wordingOk(lang, db = pool) {
  if (!lang) return true;   // the no-speech controls have no wording
  const { rows: [w] } = await db.query(`SELECT script_sha256 FROM voice_calibration_wording WHERE lang=$1`, [lang]);
  return !!w && w.script_sha256 === C.scriptSha(lang);
}
async function deleteTakes(participantId) {
  const { rows } = await pool.query(`SELECT id, object_key FROM voice_calibration_takes WHERE participant_id=$1`, [participantId]);
  for (const r of rows) {
    if (r.object_key) await storage.deleteObject(r.object_key);   // throws: the caller reports it; rows stay
    await pool.query(`DELETE FROM voice_calibration_takes WHERE id=$1`, [r.id]);
  }
  return rows.length;
}
const activeOf = async (patientId) => (await pool.query(`SELECT * FROM voice_calibration_participants WHERE patient_id=$1 AND withdrawn_at IS NULL`, [patientId])).rows[0];

// ── Volunteer ────────────────────────────────────────────────────────────────
router.get('/me', member, async (req, res) => {
  try {
    const p = await activeOf(req.user.id);
    if (!p) return res.json({ available: true, invited: false });
    const { rows } = await pool.query(`SELECT slot_code, COUNT(*)::int AS takes FROM voice_calibration_takes WHERE participant_id=$1 GROUP BY slot_code`, [p.id]);
    const taken = new Map(rows.map(r => [r.slot_code, r.takes]));
    const ok = {}; for (const l of ['kn', 'hi', 'en']) ok[l] = await wordingOk(l);
    res.json({ available: true, invited: true, consented: !!p.consented_at && p.consent_version === C.CONSENT_VERSION, group: p.grp,
      phone_type: p.phone_type, browser: p.browser, installed_app: p.installed_app, phones: PHONES, browsers: BROWSERS, retake_reasons: RETAKE_REASONS,
      slots: C.slotPlan(p.grp).map(s => { const i = C.slotInfo(s.slot, p.grp);
        return { slot: s.slot, kind: s.kind, place: s.place, lang: s.lang, say: i.say, means: i.means, locked: s.lang ? !ok[s.lang] : false, takes: taken.get(s.slot) || 0 }; }) });
  } catch (err) { fail(res, err); }
});

router.post('/consent', member, async (req, res) => {
  try {
    const { phone_type, browser } = req.body || {};
    if (!PHONES.includes(phone_type)) return res.status(400).json({ error: 'Which phone are you using?' });
    if (!BROWSERS.includes(browser)) return res.status(400).json({ error: 'Which browser are you using?' });
    const { rowCount } = await pool.query(`UPDATE voice_calibration_participants SET consented_at = NOW(), consent_version = $2, phone_type = $3, browser = $4, installed_app = $5
      WHERE patient_id=$1 AND withdrawn_at IS NULL`, [req.user.id, C.CONSENT_VERSION, phone_type, browser, req.body?.installed_app === true]);
    if (!rowCount) return res.status(404).json({ error: 'You are not part of the voice calibration.' });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

router.post('/take', member, async (req, res) => {
  try {
    const p = await activeOf(req.user.id);
    if (!p) return res.status(404).json({ error: 'You are not part of the voice calibration.' });
    if (!p.consented_at || p.consent_version !== C.CONSENT_VERSION) return res.status(409).json({ error: 'Please read and agree first.' });
    const info = C.slotInfo(String(req.body?.slot || ''), p.grp);
    if (!info) return res.status(400).json({ error: 'That is not one of your lines.' });
    if (!(await wordingOk(info.lang))) return res.status(409).json({ error: 'This line is waiting for its wording check. Your coach will tell you when it is ready.', locked: true });
    const audio = req.body?.audio;
    if (!audio || typeof audio !== 'string') return res.status(400).json({ error: 'No recording.' });
    if (audio.length > 3_000_000) return res.status(413).json({ error: 'That recording is too long. Keep it under 20 seconds.' });
    const { rows: [prev] } = await pool.query(`SELECT COUNT(*)::int AS n FROM voice_calibration_takes WHERE participant_id=$1 AND slot_code=$2`, [p.id, info.slot]);
    const reason = req.body?.retake_reason ? String(req.body.retake_reason) : null;
    if (prev.n > 0 && !RETAKE_REASONS.includes(reason)) return res.status(409).json({ error: 'This line is already recorded. Say why you are recording it again.', needs_reason: true, reasons: RETAKE_REASONS });
    const mt = /^audio\/[a-z0-9.+-]+(;.*)?$/i.test(String(req.body?.mimeType || '')) ? String(req.body.mimeType).split(';')[0] : 'audio/webm';
    if (!storage.isConfigured()) return res.status(503).json({ error: 'Recording storage is not set up yet.' });
    const buf = Buffer.from(audio, 'base64');
    const key = `voice-calibration/${p.id}/${info.slot}-${crypto.randomUUID()}.${mt.includes('mp4') ? 'm4a' : mt.includes('ogg') ? 'ogg' : 'webm'}`;
    try { await storage.putObject(key, buf, mt); }
    catch (e) { return res.status(502).json({ error: "Couldn't save that recording just now. Try again." }); }
    // The live speech check exactly as it runs on everyday voice notes (measured, never refused here),
    // then both engines exactly as everyday logging asks them.
    const speech = await SP.check(audio);
    const t = await C.transcribeTake(audio, mt, info.lang_hint);
    const f = speech.features || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT id FROM voice_calibration_participants WHERE id=$1 FOR UPDATE`, [p.id]);   // one take number at a time
      const { rows: [mx] } = await client.query(`SELECT COALESCE(MAX(take_no), 0)::int AS n FROM voice_calibration_takes WHERE participant_id=$1 AND slot_code=$2`, [p.id, info.slot]);
      await client.query(`UPDATE voice_calibration_takes SET superseded_at = NOW() WHERE participant_id=$1 AND slot_code=$2 AND superseded_at IS NULL`, [p.id, info.slot]);
      const { rows: [row] } = await client.query(
        `INSERT INTO voice_calibration_takes (participant_id, slot_code, take_no, object_key, mime_type, duration_ms, audio_sha256, phone_type, browser, installed_app, retake_reason, retake_note,
           speech_status, detector_version, voiced_frames, longest_run_frames, f0_spread_raw, f0_count, hop_ms, frames, voiced_ms, longest_run_ms, peak_db_raw, background_db_raw, speech_error,
           gemini_text, gemini_error, gemini_generated, gemini_provenance, whisper_text, whisper_error, whisper_review, whisper_segments, whisper_provenance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34) RETURNING id, take_no`,
        [p.id, info.slot, mx.n + 1, key, mt, Math.min(60000, Math.max(0, parseInt(req.body?.duration_ms) || 0)) || null, sha256(buf), p.phone_type, p.browser, p.installed_app,
         prev.n > 0 ? reason : null, prev.n > 0 && req.body?.retake_note ? String(req.body.retake_note).slice(0, 200) : null,
         speech.status, speech.version || null, f.voiced_frames ?? null, f.longest_run_frames ?? null, f.f0_spread_raw ?? null, f.f0_count ?? null, f.hop_ms ?? null, f.frames ?? null,
         speech.voiced_ms ?? null, speech.longest_run_ms ?? null, f.peak_db_raw ?? null, f.background_db_raw ?? null, speech.error ? String(speech.error).slice(0, 200) : null,
         t.gemini.text, t.gemini.text == null ? (t.gemini.error || 'no answer') : null, t.gemini.text == null ? null : !!t.gemini.generated_text, JSON.stringify(t.gemini.provenance),
         t.whisper.text, t.whisper.text == null ? (t.whisper.error || 'no answer') : null, t.whisper.review ? JSON.stringify(t.whisper.review) : null,
         t.whisper.segments ? JSON.stringify(t.whisper.segments) : null, JSON.stringify(t.whisper.provenance)]);
      await client.query('COMMIT');
      // No transcript is shown to the volunteer: a retake is for a recording problem, not for a wrong answer.
      res.json({ ok: true, slot: info.slot, take_no: row.take_no });
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  } catch (err) { fail(res, err); }
});

router.post('/withdraw', member, async (req, res) => {
  try {
    const p = await activeOf(req.user.id);
    if (!p) return res.status(404).json({ error: 'You are not part of the voice calibration.' });
    try { await deleteTakes(p.id); } catch (e) { return res.status(502).json({ error: "Couldn't delete your recordings just now. Try again." }); }
    await pool.query(`UPDATE voice_calibration_participants SET withdrawn_at = NOW() WHERE id=$1`, [p.id]);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// ── The armed test account: the app asks whether a try is armed (controlled mode), and reports on-device dictation ──
router.get('/partc/me', async (req, res) => {
  try {
    const a = await C.armedFor(req.user);
    if (!a) return res.json({ armed: null });
    const t = C.trialInfo(a.trial_no) || {};
    res.json({ armed: { trial: a.trial_no, route: a.route, path: t.path, say: t.say, force_upload: a.route === 'controlled' } });
  } catch (err) { fail(res, err); }
});
router.post('/partc/device-event', async (req, res) => {
  try {
    const a = await C.armedFor(req.user);
    if (!a) return res.status(409).json({ error: 'No try is armed for this account.' });
    await C.recordDeviceDictation(a, { text: req.body?.text, lang: req.body?.lang });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// ── Administrator ────────────────────────────────────────────────────────────
router.get('/admin', admin, async (req, res) => {
  try {
    const { rows: participants } = await pool.query(
      `SELECT p.*, u.name, (SELECT COUNT(DISTINCT slot_code)::int FROM voice_calibration_takes t WHERE t.participant_id = p.id) AS slots_recorded,
              (SELECT COUNT(*)::int FROM voice_calibration_takes t WHERE t.participant_id = p.id) AS takes
         FROM voice_calibration_participants p JOIN users u ON u.id = p.patient_id WHERE p.withdrawn_at IS NULL ORDER BY p.id`);
    const { rows: wording } = await pool.query(`SELECT lang, script_sha256, confirmed_by, note, confirmed_at FROM voice_calibration_wording`);
    const { rows: partc } = await pool.query(`SELECT * FROM voice_calibration_partc ORDER BY trial_no`);
    const { rows: [armed] } = await pool.query(`SELECT a.trial_no, a.route, a.user_id, a.armed_at, a.armed_at + INTERVAL '${C.ARM_MINUTES} minutes' AS ends_at, (a.armed_at > NOW() - INTERVAL '${C.ARM_MINUTES} minutes') AS recording, u.name
      FROM voice_calibration_partc_armed a JOIN users u ON u.id = a.user_id WHERE a.id=1`);
    const used = Object.fromEntries(Object.keys(C.GROUPS).map(g => [g, participants.filter(p => p.grp === g).length]));
    res.json({ available: true, planned_total: C.PLANNED_TOTAL, planned_per_group: C.PLANNED_PER_GROUP, max: C.MAX_PARTICIPANTS, groups: C.GROUPS, used,
      grid: C.GRID, live: SP.LIVE_LIMITS,
      participants: participants.map(p => ({ id: p.id, code: p.code, name: p.name, group: p.grp, profile_note: p.profile_note, consented: !!p.consented_at && p.consent_version === C.CONSENT_VERSION,
        phone_type: p.phone_type, browser: p.browser, installed_app: p.installed_app, slots_planned: C.PLANNED_PER_GROUP[p.grp], slots_recorded: p.slots_recorded, takes: p.takes })),
      wording: ['kn', 'hi', 'en'].map(lang => { const w = wording.find(x => x.lang === lang);
        return { lang, name: C.LANG_NAME[lang], lines: C.linesFor(lang), sha: C.scriptSha(lang), confirmed: w && w.script_sha256 === C.scriptSha(lang) ? { by: w.confirmed_by, note: w.note, at: w.confirmed_at } : null, void: !!w && w.script_sha256 !== C.scriptSha(lang) }; }),
      partc: { plan: C.PARTC_PLAN, natural: C.NATURAL_PLAN, rows: partc, armed: armed || null, arm_minutes: C.ARM_MINUTES } });
  } catch (err) { fail(res, err); }
});

router.post('/admin/invite', admin, async (req, res) => {
  try {
    const memberId = parseInt(req.body?.member_id), group = String(req.body?.group || '');
    if (!Number.isInteger(memberId)) return res.status(400).json({ error: 'Which member?' });
    if (!C.GROUPS[group]) return res.status(400).json({ error: 'Which group: Kannada, Hindi or English speaker?' });
    const { rows: [u] } = await pool.query(`SELECT role, active FROM users WHERE id=$1`, [memberId]);
    if (u?.role !== 'patient') return res.status(400).json({ error: 'Only members can be invited.' });
    if (u.active === false) return res.status(400).json({ error: 'That account is switched off.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`LOCK TABLE voice_calibration_participants IN SHARE ROW EXCLUSIVE MODE`);   // quotas checked one invite at a time
      const { rows: act } = await client.query(`SELECT patient_id, grp FROM voice_calibration_participants WHERE withdrawn_at IS NULL`);
      if (act.some(a => a.patient_id === memberId)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Already a volunteer.' }); }
      if (act.length >= C.MAX_PARTICIPANTS) { await client.query('ROLLBACK'); return res.status(409).json({ error: `The round has its ${C.MAX_PARTICIPANTS} volunteers.` }); }
      if (act.filter(a => a.grp === group).length >= C.GROUPS[group].quota) { await client.query('ROLLBACK'); return res.status(409).json({ error: `The round already has ${C.GROUPS[group].quota} ${C.GROUPS[group].name}${C.GROUPS[group].quota > 1 ? 's' : ''}.` }); }
      const { rows: [mx] } = await client.query(`SELECT COALESCE(MAX(SUBSTRING(code FROM 2)::int), 0)::int AS n FROM voice_calibration_participants`);
      const code = `P${mx.n + 1}`;
      await client.query(`INSERT INTO voice_calibration_participants (patient_id, code, grp, profile_note, invited_by) VALUES ($1,$2,$3,$4,$5)`,
        [memberId, code, group, req.body?.profile_note ? String(req.body.profile_note).slice(0, 40) : null, req.user.id]);
      await client.query('COMMIT');
      res.json({ ok: true, code });
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  } catch (err) { fail(res, err); }
});

router.delete('/admin/participant/:id', admin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows: [p] } = await pool.query(`SELECT id FROM voice_calibration_participants WHERE id=$1 AND withdrawn_at IS NULL`, [id]);
    if (!p) return res.status(404).json({ error: 'No such volunteer.' });
    try { await deleteTakes(id); } catch (e) { return res.status(502).json({ error: "Couldn't delete the recordings just now. Try again." }); }
    await pool.query(`UPDATE voice_calibration_participants SET withdrawn_at = NOW() WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

router.post('/admin/wording', admin, async (req, res) => {
  try {
    const lang = String(req.body?.lang || ''), by = String(req.body?.confirmed_by || '').trim();
    if (!C.LANG_NAME[lang]) return res.status(400).json({ error: 'Which language?' });
    if (by.length < 2) return res.status(400).json({ error: 'Who checked the lines? (a fluent speaker)' });
    const entry = { at: new Date().toISOString(), action: 'confirmed', by: by.slice(0, 80), note: req.body?.note ? String(req.body.note).slice(0, 200) : null, sha: C.scriptSha(lang), recorded_by: req.user.id };
    await pool.query(`INSERT INTO voice_calibration_wording (lang, script_sha256, confirmed_by, note, recorded_by, confirmed_at, history) VALUES ($1,$2,$3,$4,$5,NOW(), jsonb_build_array($6::jsonb))
      ON CONFLICT (lang) DO UPDATE SET script_sha256=EXCLUDED.script_sha256, confirmed_by=EXCLUDED.confirmed_by, note=EXCLUDED.note, recorded_by=EXCLUDED.recorded_by, confirmed_at=NOW(),
        history = voice_calibration_wording.history || $6::jsonb`, [lang, entry.sha, entry.by, entry.note, req.user.id, JSON.stringify(entry)]);
    res.json({ ok: true, sha: entry.sha });
  } catch (err) { fail(res, err); }
});
router.post('/admin/wording/revoke', admin, async (req, res) => {
  try {
    const lang = String(req.body?.lang || '');
    if (!C.LANG_NAME[lang]) return res.status(400).json({ error: 'Which language?' });
    const entry = { at: new Date().toISOString(), action: 'revoked', recorded_by: req.user.id };
    // The row stays for its history; a hash that matches nothing locks the lines again.
    await pool.query(`UPDATE voice_calibration_wording SET script_sha256 = $2, history = history || $3::jsonb WHERE lang=$1`, [lang, '0'.repeat(64), JSON.stringify(entry)]);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

router.get('/admin/takes', admin, async (req, res) => {
  try {
    const args = []; let where = '';
    if (req.query.participant) { args.push(parseInt(req.query.participant)); where = `WHERE t.participant_id = $1`; }
    const { rows } = await pool.query(`SELECT t.*, p.code, p.grp FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id = t.participant_id ${where} ORDER BY p.id, t.slot_code, t.take_no`, args);
    res.json({ takes: rows.map(t => { const info = C.slotInfo(t.slot_code, t.grp) || {};
      return { id: t.id, code: t.code, slot: t.slot_code, take_no: t.take_no, current: !t.superseded_at, retake_reason: t.retake_reason, retake_note: t.retake_note, kind: info.kind, place: info.place, lang: info.lang,
        say: info.say, intended: info.label, heard: t.heard, spoken_as_script: t.spoken_as_script, reference_text: t.reference_text, reference_items: t.reference_items,
        items: (info.items || []).map(i => ({ label: i.label, n: i.n ?? null })), speech_status: t.speech_status, voiced_ms: t.voiced_ms, live_decision: C.decision(t, SP.LIVE_LIMITS),
        gemini: t.gemini_text, whisper: t.whisper_text, gemini_model: t.gemini_provenance?.model_used || null, whisper_review: t.whisper_review, audio_url: link(t.object_key), at: t.created_at }; }) });
  } catch (err) { fail(res, err); }
});

router.post('/admin/label', admin, async (req, res) => {
  try {
    const id = parseInt(req.body?.take_id), b = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Which take?' });
    const set = [], args = [id]; const entry = { at: new Date().toISOString(), by: req.user.id };
    if ('heard' in b) { if (b.heard !== null && !HEARD.includes(b.heard)) return res.status(400).json({ error: 'Heard: speech, no_speech, uncertain or clear.' }); args.push(b.heard); set.push(`heard = $${args.length}`); entry.heard = b.heard; }
    if ('spoken_as_script' in b) { if (![true, false, null].includes(b.spoken_as_script)) return res.status(400).json({ error: 'Said as written: yes, no or clear.' }); args.push(b.spoken_as_script); set.push(`spoken_as_script = $${args.length}`); entry.spoken_as_script = b.spoken_as_script; }
    if ('reference_text' in b) { const v = b.reference_text == null ? null : String(b.reference_text).slice(0, 500); args.push(v); set.push(`reference_text = $${args.length}`); entry.reference_text = v; }
    if ('reference_items' in b) {
      const v = b.reference_items == null ? null : Array.isArray(b.reference_items) ? b.reference_items.filter(r => r && typeof r.label === 'string' && Number.isFinite(Number(r.n))).slice(0, 10).map(r => ({ label: r.label.slice(0, 60), n: Number(r.n) })) : undefined;
      if (v === undefined) return res.status(400).json({ error: 'Corrected numbers: a list of { label, n }.' });
      args.push(v == null ? null : JSON.stringify(v)); set.push(`reference_items = $${args.length}`); entry.reference_items = v;
    }
    if (!set.length) return res.status(400).json({ error: 'Nothing to change.' });
    args.push(JSON.stringify(entry));
    const { rowCount } = await pool.query(`UPDATE voice_calibration_takes SET ${set.join(', ')}, label_history = label_history || $${args.length}::jsonb WHERE id=$1`, args);
    if (!rowCount) return res.status(404).json({ error: 'No such take.' });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// Part A rule 3: each newly admitted take (live refuses, some candidate accepts) through the everyday voice
// route's own verdict and then the logging parser's preview, for BOTH legs. Evaluation mode: nothing saved,
// no coach message, no learning. One row per take and engine; at most 20 parser calls a tap.
router.post('/admin/preview-eval', admin, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT t.*, p.grp, p.patient_id FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id = t.participant_id
      WHERE t.superseded_at IS NULL AND p.withdrawn_at IS NULL ORDER BY t.id`);
    const { rows: done } = await pool.query(`SELECT take_id, engine FROM voice_calibration_preview_evals`);
    const have = new Set(done.map(d => `${d.take_id}|${d.engine}`));
    const { parseMemberMessage } = require('./aiChat');
    let calls = 0, judged = 0, more = false;
    for (const t of rows) {
      const info = C.slotInfo(t.slot_code, t.grp);
      if (!info || !info.items.length || !C.GRID.some(g => C.newlyAdmitted(t, g))) continue;
      for (const engine of ['gemini', 'whisper']) {
        if (have.has(`${t.id}|${engine}`)) continue;
        const leg = C.voiceLeg(t, engine);
        let stage = leg.stage, preview = null, judgment = null, used = 0;
        if (leg.stage === 'to parser') {
          if (calls >= 20) { more = true; continue; }
          calls++; used = 1;
          try {
            const r = await parseMemberMessage({ userId: t.patient_id, message: leg.text, context: {}, evaluation: true });
            preview = r && r.__status ? { error: r.error || `HTTP ${r.__status}` } : r;
            stage = preview?.error ? 'parser error' : 'parsed';
          } catch (e) { preview = { error: String(e.message || e).slice(0, 200) }; stage = 'parser error'; }
          judgment = C.judgePreview(C.itemsWithReference(info.items, t.reference_items), preview, info.lang);
        } else judgment = { result: leg.stage === 'voice refused' ? 'explicit refusal' : 'provider error', problems: [], items: [], note: leg.reason };
        await pool.query(`INSERT INTO voice_calibration_preview_evals (take_id, engine, stage, preview, judgment, parser_calls) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (take_id, engine) DO NOTHING`,
          [t.id, engine, stage, preview ? JSON.stringify(preview) : null, JSON.stringify(judgment), used]);
        judged++;
      }
    }
    res.json({ ok: true, judged, parser_calls: calls, more });
  } catch (err) { fail(res, err); }
});

// Measure stored audio again with the live check: the measurements must be identical to the stored ones.
router.post('/admin/remeasure', admin, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM voice_calibration_takes WHERE object_key IS NOT NULL AND (remeasure IS NULL OR $1) ORDER BY id LIMIT 21`, [req.body?.all === true]);
    const batch = rows.slice(0, 20); let same = 0, different = 0, unreadable = 0;
    for (const t of batch) {
      let audio = null;
      try { const buf = await storage.getObject(t.object_key); audio = buf ? buf.toString('base64') : null; } catch (_) { audio = null; }
      if (!audio) { unreadable++; continue; }
      const s = await SP.check(audio), f = s.features || {};
      const now = { status: s.status, version: s.version || null, voiced_frames: f.voiced_frames ?? null, longest_run_frames: f.longest_run_frames ?? null, f0_spread_raw: f.f0_spread_raw ?? null, hop_ms: f.hop_ms ?? null };
      const before = { status: t.speech_status, version: t.detector_version, voiced_frames: t.voiced_frames, longest_run_frames: t.longest_run_frames, f0_spread_raw: t.f0_spread_raw, hop_ms: t.hop_ms };
      const match = JSON.stringify(now) === JSON.stringify(before);
      match ? same++ : different++;
      await pool.query(`UPDATE voice_calibration_takes SET remeasure = $2 WHERE id=$1`, [t.id, JSON.stringify({ at: new Date().toISOString(), match, now })]);
    }
    res.json({ ok: true, checked: batch.length - unreadable, same, different, unreadable, more: rows.length > batch.length });
  } catch (err) { fail(res, err); }
});

router.post('/admin/partc/arm', admin, async (req, res) => {
  try {
    const trial = parseInt(req.body?.trial), account = parseInt(req.body?.account_id);
    const plan = C.trialInfo(trial);
    if (!plan) return res.status(400).json({ error: `Which try (1–${C.PARTC_PLAN.length}, or a natural observation ${C.NATURAL_PLAN[0].trial}–${C.NATURAL_PLAN.slice(-1)[0].trial})?` });
    const { rows: [u] } = await pool.query(`SELECT role, active FROM users WHERE id=$1`, [account]);
    if (u?.role !== 'patient' || u.active === false) return res.status(400).json({ error: 'Choose the active test member account.' });
    // One operator and one controlled account at a time: a try stays armed until Finish.
    const { rows: [busy] } = await pool.query(`SELECT trial_no FROM voice_calibration_partc_armed WHERE id=1`);
    if (busy) return res.status(409).json({ error: `Try ${busy.trial_no} is still open. Read back, restore and Finish it first.` });
    const date = getISTDate();
    const baseline = await C.dayState(pool, account, date);
    await pool.query(`INSERT INTO voice_calibration_partc_armed (id, trial_no, route, user_id, armed_by, armed_at) VALUES (1,$1,$2,$3,$4,NOW())`, [trial, plan.route, account, req.user.id]);
    await pool.query(`INSERT INTO voice_calibration_partc (trial_no, route, account_id, log_date, baseline, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
      ON CONFLICT (trial_no) DO UPDATE SET route=EXCLUDED.route, account_id=EXCLUDED.account_id, log_date=EXCLUDED.log_date, baseline=EXCLUDED.baseline, cleanup=NULL, switch_off_verified=NULL, finished_at=NULL, updated_at=NOW()`,
      [trial, plan.route, account, date, JSON.stringify(baseline)]);
    const { rows: [sw] } = await pool.query(`SELECT user_id FROM voice_fallback_test_account WHERE id=1 AND set_at > NOW() - INTERVAL '24 hours'`);
    const switchOn = !!sw && sw.user_id === account;
    res.json({ ok: true, trial, route: plan.route, path: plan.path, switch_on: switchOn,
      warning: plan.route === 'controlled' && plan.path === 'whisper' && !switchOn ? 'This try is planned for the Whisper fallback, but the Voice backup switch is not on for that account. Turn it on first.'
        : plan.route === 'controlled' && plan.path === 'gemini' && switchOn ? 'This try is planned for Gemini, but the Voice backup switch is on for that account. Turn it off first.' : null });
  } catch (err) { fail(res, err); }
});
const openTry = async () => (await pool.query(`SELECT a.trial_no, a.user_id, p.baseline, p.log_date FROM voice_calibration_partc_armed a JOIN voice_calibration_partc p ON p.trial_no = a.trial_no WHERE a.id=1`)).rows[0];
router.post('/admin/partc/readback', admin, async (req, res) => {
  try {
    const o = await openTry(); if (!o) return res.status(409).json({ error: 'No try is open.' });
    const now = await C.dayState(pool, o.user_id, o.baseline.date);
    const diff = C.dayDiff(o.baseline, now);
    await pool.query(`UPDATE voice_calibration_partc SET readbacks = readbacks || $2::jsonb, updated_at = NOW() WHERE trial_no=$1`, [o.trial_no, JSON.stringify({ at: new Date().toISOString(), diff })]);
    res.json({ ok: true, trial: o.trial_no, diff });
  } catch (err) { fail(res, err); }
});
router.post('/admin/partc/restore', admin, async (req, res) => {
  try {
    const o = await openTry(); if (!o) return res.status(409).json({ error: 'No try is open.' });
    const r = await C.restoreDay(pool, o.user_id, o.baseline);
    await pool.query(`UPDATE voice_calibration_partc SET cleanup = $2, updated_at = NOW() WHERE trial_no=$1`, [o.trial_no, JSON.stringify({ at: new Date().toISOString(), ...r })]);
    res.json({ ok: true, trial: o.trial_no, ...r });
  } catch (err) { fail(res, err); }
});
router.post('/admin/partc/finish', admin, async (req, res) => {
  try {
    const { rows: [a] } = await pool.query(`SELECT trial_no, user_id FROM voice_calibration_partc_armed WHERE id=1`);
    if (!a) return res.status(409).json({ error: 'No try is open.' });
    const { rows: [sw] } = await pool.query(`SELECT user_id FROM voice_fallback_test_account WHERE id=1 AND set_at > NOW() - INTERVAL '24 hours'`);
    const off = !(sw && sw.user_id === a.user_id);
    await pool.query(`UPDATE voice_calibration_partc SET switch_off_verified = $2, finished_at = NOW(), updated_at = NOW() WHERE trial_no=$1`, [a.trial_no, off]);
    await pool.query(`DELETE FROM voice_calibration_partc_armed WHERE id=1`);
    const { rows: [r] } = await pool.query(`SELECT cleanup FROM voice_calibration_partc WHERE trial_no=$1`, [a.trial_no]);
    res.json({ ok: true, trial: a.trial_no, switch_off_verified: off, restored: !!r?.cleanup?.ok,
      warning: !off ? 'The Voice backup switch is still ON for the test account. Turn it off on the Voice backup test card.' : !r?.cleanup?.ok ? 'The day was not restored to its baseline (or not checked). Restore it, or note why.' : null });
  } catch (err) { fail(res, err); }
});
router.put('/admin/partc/:trial', admin, async (req, res) => {
  try {
    const trial = parseInt(req.params.trial);
    const plan = C.trialInfo(trial);
    if (!plan) return res.status(400).json({ error: 'No such try.' });
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items.filter(i => (plan.items.includes(i?.label) || plan.route === 'natural') && typeof i?.label === 'string' && [true, false].includes(i?.ok)).map(i => ({ label: i.label.slice(0, 60), ok: i.ok })) : null;
    const tri = (v) => ([true, false].includes(v) ? v : null);
    const entry = { at: new Date().toISOString(), by: req.user.id, items, applied: tri(b.applied), day_correct: tri(b.day_correct), notes: b.notes ? String(b.notes).slice(0, 500) : null };
    await pool.query(`INSERT INTO voice_calibration_partc (trial_no, route, items, applied, day_correct, notes, edits, updated_at) VALUES ($1,$2,$3,$4,$5,$6, jsonb_build_array($7::jsonb), NOW())
      ON CONFLICT (trial_no) DO UPDATE SET items=EXCLUDED.items, applied=EXCLUDED.applied, day_correct=EXCLUDED.day_correct, notes=EXCLUDED.notes,
        edits = voice_calibration_partc.edits || $7::jsonb, updated_at=NOW()`,
      [trial, plan.route, items ? JSON.stringify(items) : null, entry.applied, entry.day_correct, entry.notes, JSON.stringify(entry)]);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

router.get('/admin/export.xlsx', admin, async (req, res) => {
  try {
    const { rows: participants } = await pool.query(`SELECT id, code, grp, profile_note, consented_at, consent_version, phone_type, browser, installed_app, withdrawn_at FROM voice_calibration_participants ORDER BY id`);
    const { rows: takes } = await pool.query(`SELECT * FROM voice_calibration_takes ORDER BY id`);
    const { rows: wording } = await pool.query(`SELECT * FROM voice_calibration_wording`);
    const { rows: partc } = await pool.query(`SELECT * FROM voice_calibration_partc ORDER BY trial_no`);
    const { rows: evals } = await pool.query(`SELECT * FROM voice_calibration_preview_evals ORDER BY take_id, engine`);
    const buf = X.workbook(C.workbookSheets({ participants, takes, wording, partc, evals }));
    const day = new Date().toISOString().slice(0, 10);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="FitLife-Voice-Calibration-${day}.xlsx"` });
    res.send(buf);
  } catch (err) { fail(res, err); }
});

/** Takes past their 90 days. Run daily by cronService; safe to repeat. */
async function deleteExpiredTakes(db = pool, limit = 500) {
  const { rows } = await db.query(`SELECT id, object_key FROM voice_calibration_takes WHERE delete_after < NOW() ORDER BY delete_after LIMIT $1`, [limit]);
  let n = 0;
  for (const r of rows) {
    try { if (r.object_key) await storage.deleteObject(r.object_key); await db.query(`DELETE FROM voice_calibration_takes WHERE id=$1`, [r.id]); n++; }
    catch (e) { console.error('voice calibration expiry failed:', r.id, e.message); }
  }
  return n;
}

module.exports = router;
module.exports.deleteExpiredTakes = deleteExpiredTakes;
module.exports.RETAKE_REASONS = RETAKE_REASONS;
