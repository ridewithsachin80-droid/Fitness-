/**
 * routes/voiceCalibration.js — Fixes-2x: the voice calibration kit (B18/B19). TEST SERVER ONLY:
 * every route answers 404 elsewhere, with no database read (services/voiceFallbackTest.available).
 *
 *   Fixes-2y (the 2x kit review): reviewer register (codes only in the export), reference-first takes (transcripts
 *   hidden until the listener's reference is frozen; each change a new version), versioned rule 3 judgments with
 *   hand verdicts and claimed (never duplicated) evaluations, Part C sessions that stay recoverable until the day is
 *   back to its baseline and the switch is off, and the phone's make, model and versions per take.
 *
 *   Volunteer (member):
 *     GET    /api/voice-calibration/me            invited?, consented?, their planned slots (no transcripts shown)
 *     POST   /api/voice-calibration/consent       { phone_type, browser, installed_app, device: { make, model, os, os_version, browser_version } }
 *     POST   /api/voice-calibration/take          { slot, audio, mimeType, duration_ms, retake_reason?, retake_note? }
 *     POST   /api/voice-calibration/withdraw      delete every take now
 *   Administrator:
 *     GET    /api/voice-calibration/admin             volunteers, quotas, wording checks, Part C plan and tries
 *     POST   /api/voice-calibration/admin/invite      { member_id, group: 'kn'|'hi'|'en', profile_note? }
 *     DELETE /api/voice-calibration/admin/participant/:id   remove a volunteer and delete their takes
 *     POST   /api/voice-calibration/admin/wording     { lang, confirmed_by, note? }   a fluent speaker's check of the exact lines
 *     POST   /api/voice-calibration/admin/wording/revoke  { lang }
 *     GET    /api/voice-calibration/admin/takes       every take (history), with a player link
 *     POST   /api/voice-calibration/admin/label       draft only, before the reference is frozen: { take_id, heard?, spoken_as_script?, reference_text?, reference_items? }
 *     POST   /api/voice-calibration/admin/reference   freeze a reference version: { take_id, listener_code, heard, spoken_as_script?, mode?, items?, text? }
 *     POST   /api/voice-calibration/admin/hand-check  Part B: { take_id, engine, verdict, note? } settles a "needs a hand check" line (current reference only)
 *     POST   /api/voice-calibration/admin/reviewers   { name, role: 'fluent speaker'|'listener'|'both', langs? } → a code (R1…); names stay here
 *     POST   /api/voice-calibration/admin/preview-eval    rule 3: newly admitted takes' two legs through the logging parser (evaluation mode;
 *                                                     one claimed judgment per take, engine, reference version and judge version; { reevaluate: true } re-runs stale ones)
 *     POST   /api/voice-calibration/admin/judgments/:id/hand  { verdict, note? } settles a "needs a hand check" preview
 *     POST   /api/voice-calibration/admin/remeasure   measure stored audio again; must equal what was stored
 *     POST   /api/voice-calibration/admin/partc/arm   { trial, account_id }   one session at a time: refused while any session is unresolved
 *     POST   /api/voice-calibration/admin/partc/readback   (the unresolved session) what changed on the test account's day since arming
 *     POST   /api/voice-calibration/admin/partc/restore    (the unresolved session) put the day back to ITS baseline and compare the whole day
 *     POST   /api/voice-calibration/admin/partc/finish     (the unresolved session) stop recording; complete only when the day equals
 *                                                     its baseline and the Voice backup switch is off; otherwise the session stays open for recovery
 *     POST   /api/voice-calibration/admin/partc/sessions/:id/(readback|restore|finish)   the same, by session
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
const RETAKE_REASONS = ['cut_off', 'wrong_line', 'interrupted', 'other', 'replacement'];   // Fixes-2z: 'replacement' only when an administrator asked
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const { getISTDate } = require('../utils/istDate');
const HEARD = ['speech', 'no_speech', 'uncertain'];
const OSES = ['android', 'ios', 'other', 'unknown'];
const ROLES = ['fluent speaker', 'listener', 'both'];
/** Fixes-2y: the phone itself (make, model, OS and browser versions). Each answer is required; "unknown" is a valid answer. */
function validDevice(d) {
  if (!d || typeof d !== 'object') return { error: "Tell us your phone's make and model (or choose \"I don't know\")." };
  const out = {};
  for (const k of ['make', 'model', 'os_version', 'browser_version']) {
    const v = String(d[k] ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40);
    if (!v) return { error: `Tell us the ${k.replace('_', ' ')} (or choose "I don't know").` };
    out[k] = v.toLowerCase() === 'unknown' || v.toLowerCase() === "i don't know" ? 'unknown' : v;
  }
  out.os = OSES.includes(d.os) ? d.os : 'unknown';
  return { device: out };
}
async function reviewer(code, roles, db = pool) {
  const { rows: [r] } = await db.query(`SELECT code, role FROM voice_calibration_reviewers WHERE code=$1`, [String(code || '')]);
  return r && (!roles || roles.includes(r.role)) ? r : null;
}

async function wordingOk(lang, db = pool) {
  if (!lang) return true;   // the no-speech controls have no wording
  const { rows: [w] } = await db.query(`SELECT script_sha256 FROM voice_calibration_wording WHERE lang=$1`, [lang]);
  return !!w && w.script_sha256 === C.scriptSha(lang);
}
/**
 * Fixes-3b: spent calls, recorded when the attempt happens, in their own committed statement (never inside a take's or judgment's
 * transaction, so a rollback cannot remove them). attemptKey makes writing the same attempt twice harmless.
 * Fixes-3c (the 3b review, finding 2): a failed write is no longer swallowed. It is retried once; if it still fails, the attempt
 * waits in `pendingSpend` (same attempt key, never a new provider call) and is written by the next calibration request
 * (`flushSpend`). A kept take or judgment always writes its own spend row in the same transaction/statement, so a saved result
 * can never lack its count. Anything still waiting is reported as UNRESOLVED in the export and keeps the screen incomplete.
 * Fixes-3d (the 3c review): the waiting list is only a same-process shortcut. What survives a restart is the attempt row written
 * BEFORE the external call (`startAttempt`, voice_calibration_attempts): a row still 'started' after its process is gone is an
 * attempt whose calls are unknown; the export reports it (with an upper bound, never an invented number) and the screen stays
 * incomplete until an administrator settles it from the provider's own records (POST /admin/attempts/settle). If the attempt
 * row cannot be written, the external call is not made.
 */
const pendingSpend = new Map();   // attemptKey → spend row not yet in the ledger (this process knows its calls)
/** Writes (or links) the spend row AND marks its attempt recorded, in one statement. */
const SPEND_UPSERT = `WITH s AS (
    INSERT INTO voice_calibration_spend (kind, attempt_key, take_id, judgment_ref, participant_code, slot_code, calls, outcome, unit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'requests')
    ON CONFLICT (attempt_key) DO UPDATE SET outcome = COALESCE(voice_calibration_spend.outcome, EXCLUDED.outcome) RETURNING attempt_key)
  UPDATE voice_calibration_attempts SET state = 'recorded', resolved_at = NOW() WHERE attempt_key IN (SELECT attempt_key FROM s) AND state = 'started'`;
const writeSpend = (r) => pool.query(SPEND_UPSERT, [r.kind, r.attemptKey, r.takeId ?? null, r.judgmentRef ?? null, r.code || null, r.slot || null, r.calls, r.outcome || null]);
/**
 * Fixes-3d: start an attempt in the database BEFORE any external call (retried once). false → do not make the call.
 * maxCalls is the most calls this attempt can make (the bound reported if its calls are never recorded).
 */
async function startAttempt({ kind, attemptKey, takeId = null, judgmentRef = null, code = null, slot = null, maxCalls }) {
  for (let i = 0; i < 2; i++) {
    try {
      await pool.query(`INSERT INTO voice_calibration_attempts (attempt_key, kind, take_id, judgment_ref, participant_code, slot_code, max_calls) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (attempt_key) DO NOTHING`,
        [attemptKey, kind, takeId, judgmentRef, code, slot, maxCalls]);
      return true;
    } catch (e) { if (i) console.error('[voice-calibration] attempt could not be started, so no provider call was made:', attemptKey, e.message); }
  }
  return false;
}
/**
 * Fixes-3e: the hook awaited just before each outbound provider request: it durably counts the request as started (so a restart
 * still knows how many had begun), then counts it in memory. If the durable write fails, it throws and the request is not made.
 */
const requestCounter = (attemptKey, start = null) => {
  // `start` (rule 3): the attempt row itself is written by the FIRST request's hook, with requests_started = 1 (retried once), so
  // it still exists before any request leaves, with no extra round trip. If it cannot be written, no request is made.
  const counter = { n: 0, startFailed: false };
  counter.onRequest = async () => {
    if (start && counter.n === 0) {
      let ok = false, last;
      for (let i = 0; i < 2 && !ok; i++) {
        try {
          await pool.query(`INSERT INTO voice_calibration_attempts (attempt_key, kind, take_id, judgment_ref, participant_code, slot_code, max_calls, requests_started) VALUES ($1,$2,$3,$4,$5,$6,$7,1)
            ON CONFLICT (attempt_key) DO UPDATE SET requests_started = voice_calibration_attempts.requests_started + 1`,
            [attemptKey, start.kind, start.takeId ?? null, start.judgmentRef ?? null, start.code ?? null, start.slot ?? null, start.maxCalls]);
          ok = true;
        } catch (e) { last = e; }
      }
      if (!ok) { counter.startFailed = true; console.error('[voice-calibration] attempt could not be started, so no provider request was made:', attemptKey, last?.message); throw last; }
    } else {
      await pool.query(`UPDATE voice_calibration_attempts SET requests_started = requests_started + 1 WHERE attempt_key=$1`, [attemptKey]);
    }
    counter.n++;
  };
  return counter;
};
/** Fixes-3d: an attempt that ended before any external call was made. */
const endAttemptNoCall = (attemptKey) => pool.query(`UPDATE voice_calibration_attempts SET state='no call', resolved_at=NOW() WHERE attempt_key=$1 AND state='started'`, [attemptKey]).catch(() => {});
/** Fixes-3d: attempts not yet settled: known to this process (calls waiting) or unknown (started, never recorded: in flight or interrupted). */
async function accountingState() {
  const { rows } = await pool.query(`SELECT attempt_key, max_calls, requests_started FROM voice_calibration_attempts WHERE state = 'started'`);
  const unknown = rows.filter(r => !pendingSpend.has(r.attempt_key));
  return { ...spendUnresolved(), unknownAttempts: unknown.length, unknownMax: unknown.reduce((n, r) => n + (Number(r.max_calls) || 0), 0),
    unknownStarted: unknown.reduce((n, r) => n + (Number(r.requests_started) || 0), 0) };
}
async function recordSpend(r) {
  if (!r.calls) return true;
  let last;
  for (let i = 0; i < 2; i++) {
    try { await writeSpend(r); pendingSpend.delete(r.attemptKey); return true; } catch (e) { last = e; }
  }
  pendingSpend.set(r.attemptKey, { ...r });
  console.error(`[voice-calibration] spend NOT yet recorded, waiting to be written: ${r.attemptKey} (${r.kind}, ${r.calls} call(s)):`, last?.message);
  return false;
}
async function flushSpend() {
  for (const r of [...pendingSpend.values()]) {
    try { await writeSpend(r); pendingSpend.delete(r.attemptKey); } catch (e) { break; }
  }
  return pendingSpend.size;
}
const spendUnresolved = () => ({ attempts: pendingSpend.size, calls: [...pendingSpend.values()].reduce((n, r) => n + (Number(r.calls) || 0), 0) });
async function markSpend(attemptKey, outcome) {
  const waiting = pendingSpend.get(attemptKey);
  if (waiting && !waiting.outcome) waiting.outcome = outcome;
  await pool.query(`UPDATE voice_calibration_spend SET outcome=$2 WHERE attempt_key=$1 AND outcome IS NULL`, [attemptKey, outcome]).catch(() => {});
}
/**
 * Fixes-3c (the 3b review, finding 3): an uploaded recording that will not be kept is deleted, and the outcome is recorded on its
 * registration row: 'deleted', or 'delete failed' (retried by the daily clean-up). If even that row cannot be updated it stays
 * 'uploading', which the clean-up also finds.
 */
async function discardUpload(key, reason) {
  let state = 'deleted';
  try { await storage.deleteObject(key); } catch (e) { state = 'delete failed'; console.error('[voice-calibration] could not delete an unkept recording yet (the daily clean-up retries it):', key, e.message); }
  await pool.query(`UPDATE voice_calibration_uploads SET state=$2, reason=$3, resolved_at=NOW() WHERE object_key=$1 AND state <> 'kept'`, [key, state, String(reason).slice(0, 200)]).catch(() => {});
  return state;
}
/** Fixes-3c: recordings registered but never kept (older than `minutes`), and failed deletions: delete them now. */
async function sweepUploads(db = pool, minutes = 60) {
  const { rows } = await db.query(`SELECT object_key FROM voice_calibration_uploads WHERE (state = 'uploading' AND created_at < NOW() - make_interval(mins => $1)) OR state = 'delete failed' ORDER BY created_at LIMIT 500`, [minutes]);
  let n = 0;
  for (const r of rows) {
    try { await storage.deleteObject(r.object_key); await db.query(`UPDATE voice_calibration_uploads SET state='deleted', reason=COALESCE(reason, 'never kept') || ' (cleaned up)', resolved_at=NOW() WHERE object_key=$1`, [r.object_key]); n++; }
    catch (e) { await db.query(`UPDATE voice_calibration_uploads SET state='delete failed' WHERE object_key=$1`, [r.object_key]).catch(() => {}); console.error('voice calibration upload clean-up failed:', r.object_key, e.message); }
  }
  return n;
}
async function deleteTakes(participantId) {
  const { rows } = await pool.query(`SELECT id, object_key FROM voice_calibration_takes WHERE participant_id=$1`, [participantId]);
  for (const r of rows) {
    if (r.object_key) await storage.deleteObject(r.object_key);   // throws: the caller reports it; rows stay
    await pool.query(`DELETE FROM voice_calibration_takes WHERE id=$1`, [r.id]);
  }
  // Fixes-3c: recordings that were never kept (refused, failed, or a failed deletion) go too; kept ones were deleted above.
  const { rows: loose } = await pool.query(`SELECT object_key FROM voice_calibration_uploads WHERE participant_id=$1 AND state IN ('uploading', 'delete failed')`, [participantId]);
  for (const u of loose) { await storage.deleteObject(u.object_key); await pool.query(`UPDATE voice_calibration_uploads SET state='deleted', reason='withdrawn', resolved_at=NOW() WHERE object_key=$1`, [u.object_key]); }
  await pool.query(`UPDATE voice_calibration_uploads SET state='deleted', resolved_at=COALESCE(resolved_at, NOW()) WHERE participant_id=$1 AND state='kept'`, [participantId]);
  return rows.length;
}
const activeOf = async (patientId) => (await pool.query(`SELECT * FROM voice_calibration_participants WHERE patient_id=$1 AND withdrawn_at IS NULL`, [patientId])).rows[0];

// ── Volunteer ────────────────────────────────────────────────────────────────
router.get('/me', member, async (req, res) => {
  try {
    const p = await activeOf(req.user.id);
    if (!p) return res.json({ available: true, invited: false });
    const { rows } = await pool.query(`SELECT slot_code, COUNT(*)::int AS takes, BOOL_OR(superseded_at IS NULL AND replacement_authorised IS NOT NULL) AS replace FROM voice_calibration_takes WHERE participant_id=$1 GROUP BY slot_code`, [p.id]);
    const taken = new Map(rows.map(r => [r.slot_code, r.takes]));
    const replace = new Set(rows.filter(r => r.replace).map(r => r.slot_code));
    const ok = {}; for (const l of ['kn', 'hi', 'en']) ok[l] = await wordingOk(l);
    res.json({ available: true, invited: true, consented: !!p.consented_at && p.consent_version === C.CONSENT_VERSION, group: p.grp,
      phone_type: p.phone_type, browser: p.browser, installed_app: p.installed_app, device: p.device || null, phones: PHONES, browsers: BROWSERS, oses: OSES, retake_reasons: RETAKE_REASONS,
      slots: C.slotPlan(p.grp).map(s => { const i = C.slotInfo(s.slot, p.grp);
        return { slot: s.slot, kind: s.kind, place: s.place, lang: s.lang, say: i.say, means: i.means, locked: s.lang ? !ok[s.lang] : false, takes: taken.get(s.slot) || 0, replacement_requested: replace.has(s.slot) }; }) });
  } catch (err) { fail(res, err); }
});

router.post('/consent', member, async (req, res) => {
  try {
    const { phone_type, browser } = req.body || {};
    if (!PHONES.includes(phone_type)) return res.status(400).json({ error: 'Which phone are you using?' });
    if (!BROWSERS.includes(browser)) return res.status(400).json({ error: 'Which browser are you using?' });
    const dv = validDevice(req.body?.device);
    if (dv.error) return res.status(400).json({ error: dv.error, needs_device: true });
    const { rowCount } = await pool.query(`UPDATE voice_calibration_participants SET consented_at = NOW(), consent_version = $2, phone_type = $3, browser = $4, installed_app = $5, device = $6
      WHERE patient_id=$1 AND withdrawn_at IS NULL`, [req.user.id, C.CONSENT_VERSION, phone_type, browser, req.body?.installed_app === true, JSON.stringify({ ...dv.device, browser })]);
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
    if (reason === 'replacement') {
      const { rows: [cur] } = await pool.query(`SELECT replacement_authorised FROM voice_calibration_takes WHERE participant_id=$1 AND slot_code=$2 AND superseded_at IS NULL`, [p.id, info.slot]);
      if (!cur?.replacement_authorised) return res.status(409).json({ error: 'Your coach has not asked for this clip to be recorded again. Choose another reason if something went wrong.' });
    }
    const mt = /^audio\/[a-z0-9.+-]+(;.*)?$/i.test(String(req.body?.mimeType || '')) ? String(req.body.mimeType).split(';')[0] : 'audio/webm';
    if (!storage.isConfigured()) return res.status(503).json({ error: 'Recording storage is not set up yet.' });
    const buf = Buffer.from(audio, 'base64');
    const key = `voice-calibration/${p.id}/${info.slot}-${crypto.randomUUID()}.${mt.includes('mp4') ? 'm4a' : mt.includes('ogg') ? 'ogg' : 'webm'}`;
    const attemptKey = `take:${crypto.randomUUID()}`;
    await flushSpend();
    // Fixes-3d: the attempt is started in the database before anything else; without it, no provider is called.
    if (!(await startAttempt({ kind: 'transcription', attemptKey, code: p.code, slot: info.slot, maxCalls: C.transcriptionMaxRequests() }))) {
      return res.status(503).json({ error: "Couldn't start the recording check just now. Try again in a minute." });
    }
    // Fixes-3c: register the recording BEFORE it exists in storage, so it can never be left behind unseen.
    try { await pool.query(`INSERT INTO voice_calibration_uploads (object_key, attempt_key, participant_id, slot_code) VALUES ($1,$2,$3,$4)`, [key, attemptKey, p.id, info.slot]); }
    catch (e) { await endAttemptNoCall(attemptKey); throw e; }
    try { await storage.putObject(key, buf, mt); }
    catch (e) { await discardUpload(key, 'upload failed'); await endAttemptNoCall(attemptKey); return res.status(502).json({ error: "Couldn't save that recording just now. Try again." }); }
    // From here until the take commits, ANY failure (the speech check, the engines, getting a database connection, the write)
    // deletes the recording and marks its calls; a refusal does the same with its own reason.
    let settled = false;
    const reqs = requestCounter(attemptKey);   // Fixes-3e: each outbound engine request, counted as it starts
    try {
      // The live speech check exactly as it runs on everyday voice notes (measured, never refused here),
      // then both engines exactly as everyday logging asks them.
      const speech = await SP.check(audio);
      const t = await C.transcribeTake(audio, mt, info.lang_hint, { onRequest: reqs.onRequest });
      // Fixes-3b: the engines have answered, so their calls are spent. Count them NOW, in a committed row of their own, before
      // and whatever becomes of the take (refused, rolled back or failed to save). The attempt key ties the later link to it.
      const calls = C.engineCalls({ gemini_provenance: t.gemini.provenance, whisper_provenance: t.whisper.provenance });
      await recordSpend({ kind: 'transcription', attemptKey, code: p.code, slot: info.slot, calls });
      const f = speech.features || {};
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT id FROM voice_calibration_participants WHERE id=$1 FOR UPDATE`, [p.id]);   // one take number at a time
        const { rows: [mx] } = await client.query(`SELECT COALESCE(MAX(take_no), 0)::int AS n FROM voice_calibration_takes WHERE participant_id=$1 AND slot_code=$2`, [p.id, info.slot]);
        const { rows: [curTake] } = await client.query(`SELECT id FROM voice_calibration_takes WHERE participant_id=$1 AND slot_code=$2 AND superseded_at IS NULL`, [p.id, info.slot]);
        await client.query(`UPDATE voice_calibration_takes SET superseded_at = NOW() WHERE participant_id=$1 AND slot_code=$2 AND superseded_at IS NULL`, [p.id, info.slot]);
        const { rows: [row] } = await client.query(
          `INSERT INTO voice_calibration_takes (participant_id, slot_code, take_no, object_key, mime_type, duration_ms, audio_sha256, phone_type, browser, installed_app, device, retake_reason, retake_note,
             speech_status, detector_version, voiced_frames, longest_run_frames, f0_spread_raw, f0_count, hop_ms, frames, voiced_ms, longest_run_ms, peak_db_raw, background_db_raw, speech_error,
             gemini_text, gemini_error, gemini_generated, gemini_provenance, whisper_text, whisper_error, whisper_review, whisper_segments, whisper_provenance)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$35,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34) RETURNING id, take_no`,
          [p.id, info.slot, mx.n + 1, key, mt, Math.min(60000, Math.max(0, parseInt(req.body?.duration_ms) || 0)) || null, sha256(buf), p.phone_type, p.browser, p.installed_app,
           prev.n > 0 ? reason : null, prev.n > 0 && req.body?.retake_note ? String(req.body.retake_note).slice(0, 200) : null,
           speech.status, speech.version || null, f.voiced_frames ?? null, f.longest_run_frames ?? null, f.f0_spread_raw ?? null, f.f0_count ?? null, f.hop_ms ?? null, f.frames ?? null,
           speech.voiced_ms ?? null, speech.longest_run_ms ?? null, f.peak_db_raw ?? null, f.background_db_raw ?? null, speech.error ? String(speech.error).slice(0, 200) : null,
           t.gemini.text, t.gemini.text == null ? (t.gemini.error || 'no answer') : null, t.gemini.text == null ? null : !!t.gemini.generated_text, JSON.stringify(t.gemini.provenance),
           t.whisper.text, t.whisper.text == null ? (t.whisper.error || 'no answer') : null, t.whisper.review ? JSON.stringify(t.whisper.review) : null,
           t.whisper.segments ? JSON.stringify(t.whisper.segments) : null, JSON.stringify(t.whisper.provenance), p.device ? JSON.stringify(p.device) : null]);
        // Fixes-3a: one grant, one replacement. The grant on the take being replaced is used by THIS take, or the replacement is refused.
        if (reason === 'replacement') {
          const { rows: [g] } = await client.query(`UPDATE voice_calibration_replacement_grants SET replacement_take_id=$2, replaced_at=NOW()
            WHERE round=$3 AND take_id=$1 AND replacement_take_id IS NULL RETURNING id`, [curTake?.id ?? -1, row.id, C.REPLACEMENT_ROUND]);
          if (!g) {
            await client.query('ROLLBACK'); settled = true;
            await discardUpload(key, 'refused: the grant was already used');
            await markSpend(attemptKey, 'refused (the grant was already used)'); await flushSpend();
            return res.status(409).json({ error: 'Your coach has not asked for this clip to be recorded again (or it was already recorded again). Choose another reason if something went wrong.' });
          }
        }
        // Fixes-3a/3b: the calls spent, linked to the kept take in the same transaction (written here if the early record failed).
        // Fixes-3d: and its attempt marked recorded, in the same statement.
        await client.query(`WITH s AS (INSERT INTO voice_calibration_spend (kind, attempt_key, take_id, participant_code, slot_code, calls, outcome, unit) VALUES ('transcription', $1, $2, $3, $4, $5, 'saved', 'requests')
          ON CONFLICT (attempt_key) DO UPDATE SET take_id = EXCLUDED.take_id, outcome = 'saved' RETURNING attempt_key)
          UPDATE voice_calibration_attempts SET state = 'recorded', resolved_at = NOW(), take_id = $2 WHERE attempt_key IN (SELECT attempt_key FROM s) AND state = 'started'`, [attemptKey, row.id, p.code, info.slot, calls]);
        await client.query(`UPDATE voice_calibration_uploads SET state='kept', ever_kept=TRUE, resolved_at=NOW() WHERE object_key=$1`, [key]);
        await client.query('COMMIT'); settled = true;
        pendingSpend.delete(attemptKey);
        // No transcript is shown to the volunteer: a retake is for a recording problem, not for a wrong answer.
        res.json({ ok: true, slot: info.slot, take_no: row.take_no });
      } catch (e) { if (!settled) await client.query('ROLLBACK').catch(() => {}); throw e; }
      finally { client.release(); }
    } catch (e) {
      if (!settled) {
        if (reqs.n === 0) await endAttemptNoCall(attemptKey);   // Fixes-3e: it failed before any engine request was made
        await discardUpload(key, `not saved: ${String(e.message || e).slice(0, 120)}`);
        await markSpend(attemptKey, 'not saved (the take could not be written)'); await flushSpend();
      }
      throw e;
    }
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
    // Fixes-2y: the app binds its mode to this session and its expiry (ms from now, so phone clocks do not matter).
    res.json({ armed: { trial: a.trial_no, route: a.route, path: t.path, say: t.say, force_upload: a.route === 'controlled', session_key: a.session_key, expires_in_ms: a.expires_in_ms } });
  } catch (err) { fail(res, err); }
});
router.post('/partc/device-event', async (req, res) => {
  try {
    const a = await C.armedFor(req.user);
    if (!a) return res.status(409).json({ error: 'No try is armed for this account.' });
    await C.recordDeviceDictation(a, { text: req.body?.text, lang: req.body?.lang, appSession: req.body?.session_key || null });
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
    const { rows: [armed] } = await pool.query(`SELECT a.trial_no, a.route, a.user_id, a.armed_at, a.session_id, a.armed_at + INTERVAL '${C.ARM_MINUTES} minutes' AS ends_at, (a.armed_at > NOW() - INTERVAL '${C.ARM_MINUTES} minutes') AS recording, u.name
      FROM voice_calibration_partc_armed a JOIN users u ON u.id = a.user_id WHERE a.id=1`);
    const { rows: reviewers } = await pool.query(`SELECT code, name, role, langs FROM voice_calibration_reviewers ORDER BY created_at, code`);
    const { rows: sessions } = await pool.query(`SELECT id, trial_no, route, armed_at, capture_stopped_at, stop_reason, resolved_at, resolution, jsonb_array_length(cleanups) AS restores FROM voice_calibration_partc_sessions ORDER BY id DESC LIMIT 60`);
    const { rows: [hc] } = await pool.query(`SELECT COUNT(*)::int AS n FROM voice_calibration_preview_judgments WHERE status='done' AND judge_version=$1 AND judgment->>'result' = 'needs a hand check' AND hand_verdict IS NULL`, [C.JUDGE_VERSION]);
    const used = Object.fromEntries(Object.keys(C.GROUPS).map(g => [g, participants.filter(p => p.grp === g).length]));
    res.json({ available: true, planned_total: C.PLANNED_TOTAL, planned_per_group: C.PLANNED_PER_GROUP, max: C.MAX_PARTICIPANTS, groups: C.GROUPS, used,
      grid: C.GRID, live: SP.LIVE_LIMITS,
      participants: participants.map(p => ({ id: p.id, code: p.code, name: p.name, group: p.grp, profile_note: p.profile_note, consented: !!p.consented_at && p.consent_version === C.CONSENT_VERSION,
        phone_type: p.phone_type, browser: p.browser, installed_app: p.installed_app, device: p.device || null, slots_planned: C.PLANNED_PER_GROUP[p.grp], slots_recorded: p.slots_recorded, takes: p.takes })),
      wording: ['kn', 'hi', 'en'].map(lang => { const w = wording.find(x => x.lang === lang);
        return { lang, name: C.LANG_NAME[lang], lines: C.linesFor(lang), sha: C.scriptSha(lang), confirmed: w && w.script_sha256 === C.scriptSha(lang) ? { by: w.confirmed_by, note: w.note, at: w.confirmed_at } : null, void: !!w && w.script_sha256 !== C.scriptSha(lang) }; }),
      reviewers, preview_hand_checks: hc.n, judge_version: C.JUDGE_VERSION, line_outcomes: C.LINE_OUTCOMES,
      vocab: { foods: [...Object.keys(C.FOOD), ...Object.keys(C.EXTRA_FOODS)], units: Object.keys(C.UNIT) },
      partc: { plan: C.PARTC_PLAN, natural: C.NATURAL_PLAN, rows: partc, armed: armed || null, arm_minutes: C.ARM_MINUTES, sessions, unresolved: sessions.filter(x => !x.resolved_at) } });
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
    const lang = String(req.body?.lang || ''), by = String(req.body?.reviewer_code || req.body?.confirmed_by || '').trim();
    if (!C.LANG_NAME[lang]) return res.status(400).json({ error: 'Which language?' });
    if (by.length < 2) return res.status(400).json({ error: 'Who checked the lines? (a fluent speaker)' });
    // Fixes-2y: a registered reviewer's CODE (R1…), never a name: the shared export carries codes only.
    if (!(await reviewer(by, ['fluent speaker', 'both']))) return res.status(400).json({ error: 'Choose the fluent speaker by their reviewer code (register them under Reviewers first). Names are not stored with the check.' });
    if (req.body?.script_sha256 && req.body.script_sha256 !== C.scriptSha(lang)) return res.status(409).json({ error: 'The lines changed since this check was prepared. Read the current lines again.', sha: C.scriptSha(lang) });
    const entry = { at: new Date().toISOString(), action: 'confirmed', by, reviewer: by, note: req.body?.note ? String(req.body.note).slice(0, 200) : null, sha: C.scriptSha(lang), recorded_by: req.user.id };
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

router.post('/admin/reviewers', admin, async (req, res) => {
  try {
    const name = String(req.body?.name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80), role = String(req.body?.role || '');
    if (name.length < 2) return res.status(400).json({ error: 'The reviewer\'s name (kept private: it never appears in the export).' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Role: fluent speaker, listener or both.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`LOCK TABLE voice_calibration_reviewers IN SHARE ROW EXCLUSIVE MODE`);
      const { rows: [mx] } = await client.query(`SELECT COALESCE(MAX(SUBSTRING(code FROM 2)::int), 0)::int AS n FROM voice_calibration_reviewers`);
      const code = `R${mx.n + 1}`;
      await client.query(`INSERT INTO voice_calibration_reviewers (code, name, role, langs, created_by) VALUES ($1,$2,$3,$4,$5)`, [code, name, role, req.body?.langs ? String(req.body.langs).slice(0, 12) : null, req.user.id]);
      await client.query('COMMIT');
      res.json({ ok: true, code });
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  } catch (err) { fail(res, err); }
});

const takeView = async (rows) => {
  const ids = rows.map(t => t.id);
  const { rows: js } = ids.length ? await pool.query(`SELECT * FROM voice_calibration_preview_judgments WHERE take_id = ANY($1::int[]) ORDER BY id`, [ids]) : { rows: [] };
  return rows.map(t => { const info = C.slotInfo(t.slot_code, t.grp) || {};
    const base = { id: t.id, code: t.code, slot: t.slot_code, take_no: t.take_no, current: !t.superseded_at, retake_reason: t.retake_reason, retake_note: t.retake_note, kind: info.kind, place: info.place, lang: info.lang,
      say: info.say, intended: info.label, heard: t.heard, spoken_as_script: t.spoken_as_script, reference_text: t.reference_text, reference_items: t.reference_items, reference_mode: t.reference_mode,
      reference_version: t.reference_version || 0, reference_frozen_at: t.reference_frozen_at, listener_code: t.listener_code, replacement_authorised: t.replacement_authorised || null,
      items: (info.items || []).map(i => ({ label: i.label, n: i.n ?? null, kind: i.kind, unit: i.unit || null, food: i.food || null })), audio_url: link(t.object_key), at: t.created_at, device: t.device || null };
    // Fixes-2y: the listener records what was heard BEFORE seeing any transcript or the detector's verdict.
    if (!t.reference_frozen_at) return { ...base, revealed: false };
    const score = (e) => { if (!info.items?.length) return null; const sc = C.takeScore(t, info, e); return { line: sc.line, auto_line: sc.auto_line, flags: sc.flags, extra: sc.extra, unexplained: sc.unexplained, ambiguous: sc.ambiguous || [], hand: sc.hand || null, provisional: sc.provisional }; };
    const truth = C.truth(t, info.label), excluded = !t.superseded_at && (truth === 'uncertain' || truth === 'protocol deviation' || C.decision(t, SP.LIVE_LIMITS) === 'not checked');
    const legs = ['gemini', 'whisper'].map(e => { const l = C.legStatus(t, e, js); return { engine: e, status: l.cls, result: l.result, judgment_id: l.j?.id || null, hand_reasons: l.j?.judgment?.hand || [], problems: l.j?.judgment?.problems || [], hand_verdict: l.j?.hand_verdict || null }; });
    return { ...base, revealed: true, excluded, speech_status: t.speech_status, voiced_ms: t.voiced_ms, live_decision: C.decision(t, SP.LIVE_LIMITS),
      gemini: t.gemini_text, whisper: t.whisper_text, gemini_model: t.gemini_provenance?.model_used || null, whisper_review: t.whisper_review,
      scores: { gemini: score('gemini'), whisper: score('whisper') }, rule3: js.some(j => j.take_id === t.id) || C.GRID.some(g => C.newlyAdmitted(t, g)) ? legs : null };
  });
};
router.get('/admin/takes', admin, async (req, res) => {
  try {
    const args = []; let where = '';
    if (req.query.participant) { args.push(parseInt(req.query.participant)); where = `WHERE t.participant_id = $1`; }
    const { rows } = await pool.query(`SELECT t.*, p.code, p.grp FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id = t.participant_id ${where} ORDER BY p.id, t.slot_code, t.take_no`, args);
    res.json({ takes: await takeView(rows) });
  } catch (err) { fail(res, err); }
});

// A draft label, before the reference is frozen (2x behaviour, kept). After freezing, a change is a new version (/admin/reference).
router.post('/admin/label', admin, async (req, res) => {
  try {
    const id = parseInt(req.body?.take_id), b = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Which take?' });
    const { rows: [cur] } = await pool.query(`SELECT reference_frozen_at FROM voice_calibration_takes WHERE id=$1`, [id]);
    if (!cur) return res.status(404).json({ error: 'No such take.' });
    if (cur.reference_frozen_at) return res.status(409).json({ error: 'This take\'s reference is frozen. Save a new version instead (the earlier one is kept).', frozen: true });
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
    const { rowCount } = await pool.query(`UPDATE voice_calibration_takes SET ${set.join(', ')}, label_history = label_history || $${args.length}::jsonb WHERE id=$1 AND reference_frozen_at IS NULL`, args);
    if (!rowCount) return res.status(409).json({ error: 'This take\'s reference was frozen meanwhile.', frozen: true });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// Fixes-2y: freeze a reference version. Everything scoring depends on is in it; a change is a new version with a new hash,
// which makes the earlier rule 3 judgments stale (kept in the export, never reused).
router.post('/admin/reference', admin, async (req, res) => {
  try {
    const id = parseInt(req.body?.take_id), b = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Which take?' });
    const { rows: [t] } = await pool.query(`SELECT t.*, p.grp FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id = t.participant_id WHERE t.id=$1`, [id]);
    if (!t) return res.status(404).json({ error: 'No such take.' });
    const listener = await reviewer(b.listener_code, ['listener', 'both']);
    if (!listener) return res.status(400).json({ error: 'Choose the fluent listener by their reviewer code (register them under Reviewers first).' });
    if (!HEARD.includes(b.heard)) return res.status(400).json({ error: 'What did the listener hear: speech, no speech, or unsure?' });
    const info = C.slotInfo(t.slot_code, t.grp) || {};
    const ref = { heard: b.heard, spoken_as_script: null, mode: null, items: null, text: b.text == null || b.text === '' ? null : String(b.text).slice(0, 500) };
    if (info.label === 'speech' && b.heard === 'speech') {
      if (![true, false].includes(b.spoken_as_script)) return res.status(400).json({ error: 'Was the line said as written: yes or no?' });
      ref.spoken_as_script = b.spoken_as_script;
      if (b.spoken_as_script) ref.mode = 'as_script';
      else if (b.mode === 'unscorable') ref.mode = 'unscorable';
      else {
        const v = C.validReferenceItems(b.items);
        if (v.error) return res.status(400).json({ error: v.error, needs_items: true });
        ref.mode = 'corrected'; ref.items = v.items;
      }
    }
    const sha = C.referenceSha(ref);
    if (t.reference_frozen_at && t.reference_sha === sha) return res.json({ ok: true, unchanged: true, version: t.reference_version, sha });
    const version = (t.reference_version || 0) + 1;
    const entry = { version, sha, at: new Date().toISOString(), by: req.user.id, listener: listener.code, reference: ref };
    await pool.query(`UPDATE voice_calibration_takes SET heard=$2, spoken_as_script=$3, reference_mode=$4, reference_items=$5, reference_text=$6, reference_version=$7, reference_sha=$8, reference_frozen_at=NOW(),
        listener_code=$9, reference_history = reference_history || $10::jsonb WHERE id=$1`,
      [id, ref.heard, ref.spoken_as_script, ref.mode, ref.items ? JSON.stringify(ref.items) : null, ref.text, version, sha, listener.code, JSON.stringify(entry)]);
    const { rows: [stale] } = await pool.query(`SELECT COUNT(*)::int AS n FROM voice_calibration_preview_judgments WHERE take_id=$1 AND reference_sha <> $2`, [id, sha]);
    res.json({ ok: true, version, sha, revealed: true, stale_judgments: stale.n });
  } catch (err) { fail(res, err); }
});

// Fixes-2z: ask for an authorised replacement of an EXCLUDED take (frozen reference: unsure, heard ≠ intended, or not measured).
// The excluded take stays (superseded when the replacement arrives) and is shown; replacements are budgeted apart.
router.post('/admin/replacement', admin, async (req, res) => {
  // Fixes-3a (the 2z review): eligibility, a repeated request and the budget are decided in ONE transaction, serialised for the
  // round by an advisory lock; the ledger's unique grant numbers (1..12, a CHECK in the database) are the last line of defence.
  const id = parseInt(req.body?.take_id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Which take?' });
  const client = await pool.connect();
  let done = false;
  const finish = async (status, body, commit = false) => { await client.query(commit ? 'COMMIT' : 'ROLLBACK').catch(() => {}); done = true; return res.status(status).json(body); };
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('voice_calibration_replacement_budget'))`);
    const { rows: [t] } = await client.query(`SELECT t.*, p.grp, p.code FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id = t.participant_id
      WHERE t.id=$1 AND p.withdrawn_at IS NULL FOR UPDATE OF t`, [id]);
    if (!t) return await finish(404, { error: 'No such take.' });
    const used = async () => (await client.query(`SELECT (SELECT COUNT(*) FROM voice_calibration_replacement_grants WHERE round = $1)
      + (SELECT COUNT(*) FROM voice_calibration_takes t WHERE t.replacement_authorised IS NOT NULL AND NOT EXISTS (SELECT 1 FROM voice_calibration_replacement_grants g WHERE g.take_id = t.id)) AS n`, [C.REPLACEMENT_ROUND])).rows[0].n;
    // A repeated request for a take already granted: the same grant, unchanged (no new allowance, history kept).
    const { rows: [had] } = await client.query(`SELECT * FROM voice_calibration_replacement_grants WHERE round=$1 AND take_id=$2`, [C.REPLACEMENT_ROUND, id]);
    if (had || t.replacement_authorised) {
      const n = Number(await used());
      return await finish(200, { ok: true, already: true, why: had?.why ?? t.replacement_authorised?.why ?? null, grant_no: had?.grant_no ?? null, used: n, budget: C.REPLACEMENT_BUDGET }, true);
    }
    if (t.superseded_at) return await finish(409, { error: 'This take was already replaced.' });
    if (!t.reference_frozen_at) return await finish(409, { error: 'Save the listener\'s reference first: only an excluded take can be replaced.' });
    const info = C.slotInfo(t.slot_code, t.grp) || {};
    const truth = C.truth(t, info.label), measured = C.decision(t, SP.LIVE_LIMITS) !== 'not checked';
    if (truth !== 'uncertain' && truth !== 'protocol deviation' && measured) return await finish(409, { error: 'This take is usable as it is. Only an excluded take (unsure, the wrong kind of sound, or not measured) can be replaced.' });
    const why = req.body?.why ? String(req.body.why).slice(0, 200) : (truth !== 'speech' && truth !== 'no-speech' ? truth : 'not measured');
    const n = Number(await used());
    if (n >= C.REPLACEMENT_BUDGET) return await finish(409, { error: `The replacement budget (${C.REPLACEMENT_BUDGET} for the round) is used up. Stop and review the round before any more.`, budget: C.REPLACEMENT_BUDGET, used: n });
    const at = new Date().toISOString();
    await client.query(`INSERT INTO voice_calibration_replacement_grants (round, grant_no, take_id, participant_code, slot_code, why, calls_spent, granted_by, granted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [C.REPLACEMENT_ROUND, n + 1, id, t.code, t.slot_code, why, C.engineCalls(t), req.user.id, at]);
    await client.query(`UPDATE voice_calibration_takes SET replacement_authorised = $2 WHERE id=$1 AND replacement_authorised IS NULL`, [id, JSON.stringify({ at, by: req.user.id, why, grant_no: n + 1 })]);
    return await finish(200, { ok: true, why, grant_no: n + 1, used: n + 1, budget: C.REPLACEMENT_BUDGET }, true);
  } catch (err) {
    if (!done) await client.query('ROLLBACK').catch(() => {});
    // The database refused a grant number past the budget or a duplicate: never a 13th grant, never a second grant for a take.
    if (!done && (err.code === '23505' || err.code === '23514')) return res.status(409).json({ error: `The replacement budget (${C.REPLACEMENT_BUDGET} for the round) is used up, or this take was just granted. Reload and check.`, budget: C.REPLACEMENT_BUDGET });
    if (!done) fail(res, err);
  } finally { client.release(); }
});

// Fixes-2y: Part B hand check. Only a "needs a hand check" line, only against the current reference; one of the nine outcomes.
router.post('/admin/hand-check', admin, async (req, res) => {
  try {
    const id = parseInt(req.body?.take_id), engine = String(req.body?.engine || ''), verdict = String(req.body?.verdict || '');
    if (!Number.isInteger(id) || !['gemini', 'whisper'].includes(engine)) return res.status(400).json({ error: 'Which take and engine?' });
    if (!C.LINE_OUTCOMES.includes(verdict) || ['provider error', 'empty answer'].includes(verdict)) return res.status(400).json({ error: 'Choose one of the line outcomes.' });
    const { rows: [t] } = await pool.query(`SELECT t.*, p.grp FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id = t.participant_id WHERE t.id=$1`, [id]);
    if (!t) return res.status(404).json({ error: 'No such take.' });
    if (!t.reference_frozen_at) return res.status(409).json({ error: 'Freeze the listener\'s reference first.' });
    const sc = C.takeScore({ ...t, hand_checks: {} }, C.slotInfo(t.slot_code, t.grp) || {}, engine);
    if (sc.line !== C.HAND_CHECK) return res.status(409).json({ error: `This line does not need a hand check (it is "${sc.line}").` });
    const hc = { verdict, note: req.body?.note ? String(req.body.note).slice(0, 200) : null, by: req.user.id, at: new Date().toISOString(), reference_sha: t.reference_sha, reference_version: t.reference_version, engine };
    await pool.query(`UPDATE voice_calibration_takes SET hand_checks = jsonb_set(COALESCE(hand_checks, '{}'::jsonb), $2, $3::jsonb, true), hand_history = hand_history || $4::jsonb WHERE id=$1`,
      [id, `{${engine}}`, JSON.stringify(hc), JSON.stringify(hc)]);
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// Part A rule 3: each newly admitted take (live refuses, some candidate accepts) through the everyday voice route's own
// verdict and then the logging parser's preview, for BOTH legs. Evaluation mode: nothing saved, no coach message, no learning.
// Fixes-2y: only takes whose reference is frozen (speech, scorable). One judgment per take, engine, reference version and judge
// version, CLAIMED before the parser is called, so two taps at once never evaluate the same leg twice. A judgment made under an
// earlier reference or judge version is stale: kept, never reused, and re-run only when asked ({ reevaluate: true }), counted apart.
router.post('/admin/preview-eval', admin, async (req, res) => {
  try {
    const reevaluate = req.body?.reevaluate === true;
    await flushSpend();
    const { rows } = await pool.query(`SELECT t.*, p.grp, p.patient_id, p.code FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id = t.participant_id
      WHERE t.superseded_at IS NULL AND p.withdrawn_at IS NULL AND t.reference_frozen_at IS NOT NULL AND t.heard = 'speech' AND COALESCE(t.reference_mode, '') <> 'unscorable' ORDER BY t.id`);
    const { rows: [waiting] } = await pool.query(`SELECT COUNT(*)::int AS n FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id = t.participant_id
      WHERE t.superseded_at IS NULL AND p.withdrawn_at IS NULL AND t.reference_frozen_at IS NULL`);
    const { parseMemberMessage, callAIMaxRequests } = require('./aiChat');
    let requestsMade = 0;   // Fixes-3e: outbound provider requests across this tap
    let calls = 0, recalls = 0, judged = 0, stale = 0, busy = 0, more = false;
    // Fixes-3e: first CLAIM every leg this tap will evaluate (within the 20-check limit), then evaluate them. A second tap at the
    // same moment then finds each leg either claimed (busy) or its own, never half-way, whatever the request timing.
    const todo = [], released = new Set();
    let planned = 0;
    const release = async () => {
      for (const c of todo) {
        if (c.started || released.has(c.claim.id)) continue;
        released.add(c.claim.id);
        if (c.fresh) await pool.query(`DELETE FROM voice_calibration_preview_judgments WHERE id=$1 AND status='running'`, [c.claim.id]).catch(() => {});
        else await pool.query(`UPDATE voice_calibration_preview_judgments SET created_at = NOW() - INTERVAL '11 minutes' WHERE id=$1 AND status='running'`, [c.claim.id]).catch(() => {});
      }
    };
    try {
    for (const t of rows) {
      const info = C.slotInfo(t.slot_code, t.grp);
      if (!info || !info.items.length || !C.GRID.some(g => C.newlyAdmitted(t, g))) continue;
      for (const engine of ['gemini', 'whisper']) {
        const { rows: mine } = await pool.query(`SELECT id, reference_sha, judge_version, status, created_at FROM voice_calibration_preview_judgments WHERE take_id=$1 AND engine=$2`, [t.id, engine]);
        if (mine.some(j => j.reference_sha === t.reference_sha && j.judge_version === C.JUDGE_VERSION && j.status === 'done')) continue;
        const isRe = mine.some(j => j.reference_sha !== t.reference_sha || j.judge_version !== C.JUDGE_VERSION);
        if (isRe && !reevaluate) { stale++; continue; }
        const leg = C.voiceLeg(t, engine);
        if (leg.stage === 'to parser' && planned >= 20) { more = true; continue; }
        const reason = isRe ? 're-evaluation' : 'initial';
        let fresh = true;
        let { rows: [claim] } = await pool.query(`INSERT INTO voice_calibration_preview_judgments (take_id, engine, reference_sha, reference_version, judge_version, status, reason)
          VALUES ($1,$2,$3,$4,$5,'running',$6) ON CONFLICT (take_id, engine, reference_sha, judge_version) DO NOTHING RETURNING id`, [t.id, engine, t.reference_sha, t.reference_version, C.JUDGE_VERSION, reason]);
        if (!claim) { fresh = false; ({ rows: [claim] } = await pool.query(`UPDATE voice_calibration_preview_judgments SET created_at = NOW() WHERE take_id=$1 AND engine=$2 AND reference_sha=$3 AND judge_version=$4
          AND status='running' AND created_at < NOW() - INTERVAL '10 minutes' RETURNING id`, [t.id, engine, t.reference_sha, C.JUDGE_VERSION])); }
        if (!claim) { busy++; continue; }      // another tap is evaluating this leg right now
        if (leg.stage === 'to parser') planned++;
        todo.push({ t, info, engine, isRe, leg, claim, fresh, started: false });
      }
    }
    for (const c of todo) {
        const { t, info, engine, isRe, leg, claim } = c;
        c.started = true;
        let stage = leg.stage, preview = null, judgment = null, used = 0;
        const spendKey = `rule3:${crypto.randomUUID()}`;
        if (leg.stage === 'to parser') {
          // Fixes-3d: the attempt is started in the database before the parser is called; without it, no call is made.
          // Fixes-3e: the attempt is written by the first request's hook (before that request leaves); its bound is the parser's
          // real worst case: every configured provider × model × try (callAIMaxRequests).
          if (isRe) recalls++; else calls++;   // parser CHECKS (one per leg)
          const reqs = requestCounter(spendKey, { kind: 'rule3', takeId: t.id, judgmentRef: claim.id, code: t.code, slot: t.slot_code, maxCalls: callAIMaxRequests() });
          try {
            const r = await parseMemberMessage({ userId: t.patient_id, message: leg.text, context: {}, evaluation: true, onAIRequest: reqs.onRequest });
            preview = r && r.__status ? { error: r.error || `HTTP ${r.__status}` } : r;
            stage = preview?.error ? 'parser error' : 'parsed';
          } catch (e) { preview = { error: String(e.message || e).slice(0, 200) }; stage = 'parser error'; }
          // Fixes-3d: the attempt could not be started, so the parser made no request: release the claim and say so (503).
          if (reqs.startFailed && reqs.n === 0) {
            if (isRe) recalls--; else calls--;
            await pool.query(`DELETE FROM voice_calibration_preview_judgments WHERE id=$1 AND status='running'`, [claim.id]).catch(() => {});
            const err = new Error('attempt not started'); err.code = 'ATTEMPT_NOT_STARTED'; throw err;
          }
          // Fixes-3e: `used` is the number of outbound provider REQUESTS this check made (fallbacks and retries included).
          used = reqs.n; requestsMade += used;
          // Fixes-3b: the parser has answered: its requests are counted now, whatever becomes of the judgment.
          if (used) await recordSpend({ kind: 'rule3', attemptKey: spendKey, code: t.code, slot: t.slot_code, calls: used, takeId: t.id, judgmentRef: claim.id });
          judgment = C.judgePreview(C.itemsWithReference(info.items, t.reference_items, t.reference_mode), preview, info.lang);
        } else judgment = { result: leg.stage === 'voice refused' ? 'explicit refusal' : 'provider error', problems: [], hand: [], items: [], note: leg.reason };
        // The judgment and its spend row in ONE statement (Fixes-3c): the row is updated to "judged", or written now if the early
        // record failed, so a judgment can never be saved without its call. If this statement fails, neither is saved.
        await pool.query(`WITH done AS (UPDATE voice_calibration_preview_judgments SET status='done', stage=$2, preview=$3, judgment=$4, parser_calls=$8, provider_requests=$5, parser=$6, finished_at=NOW() WHERE id=$1 RETURNING id, take_id),
          s AS (INSERT INTO voice_calibration_spend (kind, attempt_key, take_id, judgment_ref, participant_code, slot_code, calls, outcome, unit)
          SELECT 'rule3', $7, d.take_id, d.id, p.code, t.slot_code, $5, 'judged', 'requests' FROM done d JOIN voice_calibration_takes t ON t.id = d.take_id JOIN voice_calibration_participants p ON p.id = t.participant_id
          WHERE $5::int > 0
          ON CONFLICT (attempt_key) DO UPDATE SET outcome = 'judged' RETURNING attempt_key)
          UPDATE voice_calibration_attempts SET state = 'recorded', resolved_at = NOW() WHERE attempt_key IN (SELECT attempt_key FROM s) AND state = 'started'`,
          [claim.id, stage, preview ? JSON.stringify(preview) : null, JSON.stringify(judgment), used, preview && (preview.aiProvider || preview.aiModel) ? JSON.stringify({ provider: preview.aiProvider || null, model: preview.aiModel || null }) : null, spendKey,
           leg.stage === 'to parser' && used > 0 ? 1 : 0]);
        pendingSpend.delete(spendKey);   // recorded with the judgment
        judged++;
    }
    } catch (e) { await release(); throw e; }   // claims this tap never reached are released for the next tap
    res.json({ ok: true, judged, parser_calls: calls, reevaluation_calls: recalls, provider_requests: requestsMade, stale_waiting: stale, busy, awaiting_reference: waiting.n, more, accounting_unresolved: spendUnresolved().attempts });
  } catch (err) {
    // Fixes-3d: the attempt could not be started in the database, so the parser was NOT called (its claim was released).
    if (err.code === 'ATTEMPT_NOT_STARTED') return res.status(503).json({ error: 'Could not record the start of the check, so the parser was not called. Try again in a minute.', parser_called: false });
    fail(res, err);
  }
});

// Fixes-3d: settle an attempt whose calls were never recorded (interrupted by a restart or failure), from the provider's own
// records (its usage console). Only an attempt still 'started' after 10 minutes, never one this process still knows; calls
// from 0 to its max_calls; a reason is required. Kept in the attempt (settled: {by, at, calls, why}) and as a spend row.
router.post('/admin/attempts/settle', admin, async (req, res) => {
  // Fixes-3e (the 3d review, finding 1): the count must be a whole number given explicitly: a JSON number, or a string of digits.
  // Missing, null, false, "", whitespace, [] and {} are refused before anything changes (Number() would have made them 0).
  const raw = req.body?.calls;
  const calls = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw.trim()) : NaN;
  const key = String(req.body?.attempt_key || ''), why = String(req.body?.why || '').trim();
  if (!key) return res.status(400).json({ error: 'Which attempt?' });
  if (!Number.isInteger(calls) || calls < 0) return res.status(400).json({ error: 'Give the number of provider requests as a whole number (0 or more), from the provider\'s usage records.' });
  if (why.length < 5) return res.status(400).json({ error: 'Say how the number was found (for example, the provider\'s usage console).' });
  await flushSpend();
  if (pendingSpend.has(key)) return res.status(409).json({ error: 'This server still knows that attempt\'s calls; they are written as soon as the database accepts them.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [a] } = await client.query(`SELECT * FROM voice_calibration_attempts WHERE attempt_key=$1 FOR UPDATE`, [key]);
    if (!a) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No such attempt.' }); }
    if (a.state !== 'started') { await client.query('ROLLBACK'); return res.status(409).json({ error: `This attempt is already ${a.state}.`, state: a.state }); }
    if (Date.now() - new Date(a.started_at).getTime() < 10 * 60 * 1000) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This attempt may still be running. Wait 10 minutes after it started.' }); }
    if (!Number.isInteger(calls) || calls < 0 || calls > a.max_calls) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Calls must be a whole number from 0 to ${a.max_calls}.` }); }
    const settled = { by: req.user.id, at: new Date().toISOString(), calls, why: why.slice(0, 300) };
    await client.query(`UPDATE voice_calibration_attempts SET state='settled', resolved_at=NOW(), settled=$2 WHERE attempt_key=$1`, [key, JSON.stringify(settled)]);
    if (calls > 0) await client.query(`INSERT INTO voice_calibration_spend (kind, attempt_key, take_id, judgment_ref, participant_code, slot_code, calls, outcome, unit) VALUES ($1,$2,$3,$4,$5,$6,$7,'settled by an administrator','requests')
      ON CONFLICT (attempt_key) DO NOTHING`, [a.kind, key, a.take_id, a.judgment_ref, a.participant_code, a.slot_code, calls]);
    await client.query('COMMIT');
    res.json({ ok: true, attempt_key: key, calls });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); fail(res, err); }
  finally { client.release(); }
});

// Fixes-2y: settle a "needs a hand check" preview (current judgments only). Every verdict is kept.
router.post('/admin/judgments/:id/hand', admin, async (req, res) => {
  try {
    const id = parseInt(req.params.id), verdict = String(req.body?.verdict || '');
    if (!['correct reviewable', 'explicit refusal', 'missing/unresolved (visible)', 'disqualifying'].includes(verdict)) return res.status(400).json({ error: 'Verdict: correct reviewable, explicit refusal, missing/unresolved (visible) or disqualifying.' });
    const { rows: [j] } = await pool.query(`SELECT j.*, t.reference_sha AS take_sha FROM voice_calibration_preview_judgments j JOIN voice_calibration_takes t ON t.id = j.take_id WHERE j.id=$1`, [id]);
    if (!j) return res.status(404).json({ error: 'No such judgment.' });
    if (j.status !== 'done' || j.reference_sha !== j.take_sha || j.judge_version !== C.JUDGE_VERSION) return res.status(409).json({ error: 'This judgment is stale or still running: re-evaluate first.' });
    if (j.judgment?.result !== 'needs a hand check') return res.status(409).json({ error: `This preview was judged "${j.judgment?.result}"; only a hand check can be settled by hand.` });
    const hv = { verdict, note: req.body?.note ? String(req.body.note).slice(0, 200) : null, by: req.user.id, at: new Date().toISOString() };
    await pool.query(`UPDATE voice_calibration_preview_judgments SET hand_verdict=$2, hand_history = hand_history || $3::jsonb WHERE id=$1`, [id, JSON.stringify(hv), JSON.stringify(hv)]);
    res.json({ ok: true });
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
    // One operator and one controlled account at a time. Fixes-2y: a session stays in the way until it is RESOLVED
    // (the day back to its baseline and the switch verified off), not merely until its recording window ends.
    const { rows: [open] } = await pool.query(`SELECT id, trial_no FROM voice_calibration_partc_sessions WHERE resolved_at IS NULL ORDER BY id LIMIT 1`);
    if (open) return res.status(409).json({ error: `Try ${open.trial_no} (session ${open.id}) is not resolved yet. Read back, restore if needed, and Finish it first.`, session_id: open.id });
    const { rows: [busy] } = await pool.query(`SELECT trial_no FROM voice_calibration_partc_armed WHERE id=1`);
    if (busy) return res.status(409).json({ error: `Try ${busy.trial_no} is still open. Read back, restore and Finish it first.` });
    const date = getISTDate();
    const baseline = await C.dayState(pool, account, date);
    const key = crypto.randomUUID();
    let sess;
    try {
      ({ rows: [sess] } = await pool.query(`INSERT INTO voice_calibration_partc_sessions (session_key, trial_no, route, account_id, log_date, baseline, armed_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, armed_at`,
        [key, trial, plan.route, account, date, JSON.stringify(baseline), req.user.id]));
    } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'Another try was armed at the same moment. Refresh.' }); throw e; }
    await pool.query(`INSERT INTO voice_calibration_partc_armed (id, trial_no, route, user_id, armed_by, armed_at, session_id, session_key) VALUES (1,$1,$2,$3,$4,$5,$6,$7)`, [trial, plan.route, account, req.user.id, sess.armed_at, sess.id, key]);
    // The try's row keeps marks and every event; its baseline column mirrors the LATEST session (each session keeps its own).
    await pool.query(`INSERT INTO voice_calibration_partc (trial_no, route, account_id, log_date, baseline, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
      ON CONFLICT (trial_no) DO UPDATE SET route=EXCLUDED.route, account_id=EXCLUDED.account_id, log_date=EXCLUDED.log_date, baseline=EXCLUDED.baseline, cleanup=NULL, switch_off_verified=NULL, finished_at=NULL, updated_at=NOW()`,
      [trial, plan.route, account, date, JSON.stringify(baseline)]);
    const { rows: [sw] } = await pool.query(`SELECT user_id FROM voice_fallback_test_account WHERE id=1 AND set_at > NOW() - INTERVAL '24 hours'`);
    const switchOn = !!sw && sw.user_id === account;
    res.json({ ok: true, trial, route: plan.route, path: plan.path, session_id: sess.id, switch_on: switchOn,
      warning: plan.route === 'controlled' && plan.path === 'whisper' && !switchOn ? 'This try is planned for the Whisper fallback, but the Voice backup switch is not on for that account. Turn it on first.'
        : plan.route === 'controlled' && plan.path === 'gemini' && switchOn ? 'This try is planned for Gemini, but the Voice backup switch is on for that account. Turn it off first.' : null });
  } catch (err) { fail(res, err); }
});
/** The session an action applies to: by id, or the one unresolved session. */
async function sessionFor(req) {
  if (req.params.id) return (await pool.query(`SELECT * FROM voice_calibration_partc_sessions WHERE id=$1`, [parseInt(req.params.id)])).rows[0];
  return (await pool.query(`SELECT * FROM voice_calibration_partc_sessions WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 1`)).rows[0];
}
const readback = async (req, res) => {
  try {
    const s = await sessionFor(req); if (!s) return res.status(409).json({ error: 'No try is open.' });
    if (!s.account_id) return res.status(409).json({ error: 'The test account no longer exists.' });
    const now = await C.dayState(pool, s.account_id, s.baseline.date);
    const diff = C.dayDiff(s.baseline, now);
    const entry = { at: new Date().toISOString(), reason: 'read back', diff, by: req.user.id };
    await pool.query(`UPDATE voice_calibration_partc_sessions SET readbacks = readbacks || $2::jsonb WHERE id=$1`, [s.id, JSON.stringify(entry)]);
    await pool.query(`UPDATE voice_calibration_partc SET readbacks = readbacks || $2::jsonb, updated_at = NOW() WHERE trial_no=$1`, [s.trial_no, JSON.stringify(entry)]);
    res.json({ ok: true, trial: s.trial_no, session_id: s.id, diff });
  } catch (err) { fail(res, err); }
};
const restore = async (req, res) => {
  try {
    const s = await sessionFor(req); if (!s) return res.status(409).json({ error: 'No try is open.' });
    if (s.resolved_at) return res.status(409).json({ error: 'This session is already resolved: its day was verified equal to its baseline.' });
    if (!s.account_id) return res.status(409).json({ error: 'The test account no longer exists.' });
    const r = await C.restoreDay(pool, s.account_id, s.baseline);     // only this account, only this session's date, back to THIS session's baseline
    const entry = { at: new Date().toISOString(), by: req.user.id, ...r };
    await pool.query(`UPDATE voice_calibration_partc_sessions SET cleanups = cleanups || $2::jsonb WHERE id=$1`, [s.id, JSON.stringify(entry)]);
    await pool.query(`UPDATE voice_calibration_partc SET cleanup = $2, updated_at = NOW() WHERE trial_no=$1`, [s.trial_no, JSON.stringify(entry)]);
    res.json({ ok: true, trial: s.trial_no, session_id: s.id, ...r });
  } catch (err) { fail(res, err); }
};
// Finish: recording stops at once; the session is COMPLETE only when its day equals its baseline and the switch is off.
// Otherwise it stays open (Restore and Finish keep working by session), and nothing reports success.
const finish = async (req, res) => {
  try {
    const s = await sessionFor(req); if (!s) return res.status(409).json({ error: 'No try is open.' });
    if (s.resolved_at) return res.json({ ok: true, completed: true, already: true, trial: s.trial_no, session_id: s.id, switch_off_verified: true, restored: true, outstanding: [], warning: null });
    const { rows: [a] } = await pool.query(`DELETE FROM voice_calibration_partc_armed WHERE id=1 AND session_id=$1 RETURNING armed_at`, [s.id]);
    const expired = !a && !s.capture_stopped_at ? true : a ? (Date.now() - new Date(a.armed_at).getTime() > C.ARM_MINUTES * 60000) : false;
    await pool.query(`UPDATE voice_calibration_partc_sessions SET capture_stopped_at = COALESCE(capture_stopped_at, NOW()), stop_reason = COALESCE(stop_reason, $2) WHERE id=$1`, [s.id, expired ? 'finish (window had ended)' : 'finish']);
    const chk = await C.checkSession(pool, s, 'finish');
    if (chk.ok) {
      await pool.query(`UPDATE voice_calibration_partc_sessions SET resolved_at = NOW(), resolution = $2 WHERE id=$1`, [s.id, JSON.stringify({ day: chk.note || 'equal to its baseline', switch: 'off', outstanding: [] })]);
      await pool.query(`UPDATE voice_calibration_partc SET switch_off_verified = TRUE, finished_at = NOW(), updated_at = NOW() WHERE trial_no=$1`, [s.trial_no]);
    } else {
      await pool.query(`UPDATE voice_calibration_partc_sessions SET resolution = $2 WHERE id=$1`, [s.id, JSON.stringify({ outstanding: chk.outstanding })]);
      await pool.query(`UPDATE voice_calibration_partc SET switch_off_verified = $2, updated_at = NOW() WHERE trial_no=$1`, [s.trial_no, !chk.switch_on]);
    }
    res.json({ ok: chk.ok, completed: chk.ok, capture_stopped: true, trial: s.trial_no, session_id: s.id, switch_off_verified: !chk.switch_on, restored: chk.diff ? chk.diff.same : true, outstanding: chk.outstanding,
      warning: chk.switch_on ? 'The Voice backup switch is still ON for the test account. Turn it off on the Voice backup test card, then Finish again. The session stays open until then.'
        : !chk.ok ? 'The day still differs from its baseline. Restore it, then Finish again. The session stays open until then.' : null });
  } catch (err) { fail(res, err); }
};
router.post('/admin/partc/readback', admin, readback);
router.post('/admin/partc/restore', admin, restore);
router.post('/admin/partc/finish', admin, finish);
router.post('/admin/partc/sessions/:id/readback', admin, readback);
router.post('/admin/partc/sessions/:id/restore', admin, restore);
router.post('/admin/partc/sessions/:id/finish', admin, finish);
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
    await flushSpend();   // Fixes-3c: write any waiting spend first; whatever still waits is reported as UNRESOLVED
    const { rows: participants } = await pool.query(`SELECT id, code, grp, profile_note, consented_at, consent_version, phone_type, browser, installed_app, device, withdrawn_at FROM voice_calibration_participants ORDER BY id`);
    const { rows: takes } = await pool.query(`SELECT * FROM voice_calibration_takes ORDER BY id`);
    const { rows: wording } = await pool.query(`SELECT * FROM voice_calibration_wording`);
    const { rows: partc } = await pool.query(`SELECT * FROM voice_calibration_partc ORDER BY trial_no`);
    const { rows: sessions } = await pool.query(`SELECT * FROM voice_calibration_partc_sessions ORDER BY id`);
    const { rows: judgments } = await pool.query(`SELECT * FROM voice_calibration_preview_judgments ORDER BY take_id, engine, id`);
    const { rows: reviewers } = await pool.query(`SELECT code, role FROM voice_calibration_reviewers ORDER BY code`);
    // Names are read only to REMOVE them from free text: volunteers' account names (withdrawn ones too) and reviewers' names.
    const { rows: names } = await pool.query(`SELECT u.name FROM voice_calibration_participants p JOIN users u ON u.id = p.patient_id UNION SELECT name FROM voice_calibration_reviewers`);
    const { rows: accounts } = await pool.query(`SELECT name FROM users WHERE name IS NOT NULL`);   // whole names only (operators, coaches, members)
    const { rows: grants } = await pool.query(`SELECT * FROM voice_calibration_replacement_grants WHERE round=$1 ORDER BY grant_no`, [C.REPLACEMENT_ROUND]);
    const { rows: spend } = await pool.query(`SELECT * FROM voice_calibration_spend ORDER BY id`);
    const { rows: reconciled } = await pool.query(`SELECT * FROM voice_calibration_spend_reconciled ORDER BY id`);
    const { rows: uploads } = await pool.query(`SELECT state, ever_kept, COUNT(*)::int AS n FROM voice_calibration_uploads GROUP BY state, ever_kept`);
    const { rows: [settledAttempts] } = await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM((settled->>'calls')::int), 0)::int AS calls FROM voice_calibration_attempts WHERE state = 'settled'`);
    const accounting = { ...(await accountingState()), settled: settledAttempts };
    const buf = X.workbook(C.workbookSheets({ participants, takes, wording, partc, sessions, judgments, reviewers, grants, spend, reconciled, uploads, spendUnresolved: accounting, privateNames: names.map(n => n.name), accountNames: accounts.map(a => a.name) }));
    const day = new Date().toISOString().slice(0, 10);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="FitLife-Voice-Calibration-${day}.xlsx"` });
    res.send(buf);
  } catch (err) { fail(res, err); }
});

/** Takes past their 90 days. Run daily by cronService; safe to repeat. */
async function deleteExpiredTakes(db = pool, limit = 500) {
  await sweepUploads(db).catch(e => console.error('voice calibration upload clean-up failed:', e.message));   // Fixes-3c
  const { rows } = await db.query(`SELECT id, object_key FROM voice_calibration_takes WHERE delete_after < NOW() ORDER BY delete_after LIMIT $1`, [limit]);
  let n = 0;
  for (const r of rows) {
    try { if (r.object_key) await storage.deleteObject(r.object_key); await db.query(`DELETE FROM voice_calibration_takes WHERE id=$1`, [r.id]); n++;
      if (r.object_key) await db.query(`UPDATE voice_calibration_uploads SET state='deleted', resolved_at=NOW() WHERE object_key=$1 AND state='kept'`, [r.object_key]).catch(() => {}); }   // Fixes-3d: kept, then expired
    catch (e) { console.error('voice calibration expiry failed:', r.id, e.message); }
  }
  return n;
}

module.exports = router;
module.exports.deleteExpiredTakes = deleteExpiredTakes;
module.exports.sweepUploads = sweepUploads;
module.exports._spend = { pending: pendingSpend, flush: flushSpend, unresolved: spendUnresolved, accounting: accountingState };   // tests only
module.exports.RETAKE_REASONS = RETAKE_REASONS;
