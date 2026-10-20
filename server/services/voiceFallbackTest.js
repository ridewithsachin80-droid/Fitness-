/**
 * services/voiceFallbackTest.js — a test-only switch for the everyday voice
 * fallback (Fixes-2p, B18).
 *
 * Why: Whisper only answers a member's voice note after Gemini fails, and a real
 * Gemini failure cannot be produced on demand without changing the shared
 * provider settings, which would affect every member. Instead, on the TEST
 * server only, an administrator names one account; that account's voice notes
 * skip Gemini and go straight to the real Whisper fallback. Everything after
 * that (the language checks, retry, the member's preview and Apply) is the
 * normal path. Each try is recorded with Whisper's raw answer.
 *
 * Three locks:
 *   1. The server must be the test deployment: Railway sets RAILWAY_GIT_BRANCH
 *      to the branch it deployed. Only 'test' counts. Production deploys 'main'.
 *      Back-up for a deploy where Railway gives no branch (e.g. a manual
 *      redeploy): the test service may set FITLIFE_TEST_SERVER=yes. It is read
 *      ONLY when no branch is reported, so a copy of it on production (which
 *      reports 'main') can never turn the switch on.
 *   2. Only an administrator can name the account, and only one at a time.
 *   3. It turns itself off 24 hours after it was set.
 */
const pool = require('../db/pool');

const HOURS = 24;
const available = () => {
  const branch = process.env.RAILWAY_GIT_BRANCH;
  if (branch) return branch === 'test';
  return process.env.FITLIFE_TEST_SERVER === 'yes';
};

/** The named account, if the switch is on and still within its 24 hours. */
async function current() {
  if (!available()) return null;
  const { rows } = await pool.query(
    `SELECT a.user_id, a.set_at, a.set_at + INTERVAL '${HOURS} hours' AS ends_at, u.name, u.role
       FROM voice_fallback_test_account a JOIN users u ON u.id = a.user_id
      WHERE a.id = 1 AND a.set_at > NOW() - INTERVAL '${HOURS} hours'`);
  return rows[0] || null;
}

/** True when this user's voice notes should skip Gemini. Never throws: a fault means "no". */
async function skipsGemini(user) {
  if (!available() || !user?.id) return false;     // production: no database read at all
  try { const c = await current(); return !!c && c.user_id === user.id; }
  catch (e) { console.warn('voice fallback test: check failed:', e.message); return false; }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
/** Keep what a reviewer needs from Whisper's answer: the text and per-section numbers. */
function sectionsOf(raw) {
  const segs = Array.isArray(raw?.segments) ? raw.segments.slice(0, 60) : [];
  return segs.map(s => ({ start: num(s?.start), end: num(s?.end), text: typeof s?.text === 'string' ? s.text.slice(0, 500) : null,
    avg_logprob: num(s?.avg_logprob), no_speech_prob: num(s?.no_speech_prob), compression_ratio: num(s?.compression_ratio) }));
}

/** Record one try. Never throws: recording must not break the member's voice note. */
async function record(userId, { langHint, languageSent, raw, result, error }) {
  try {
    await pool.query(
      `INSERT INTO voice_fallback_test_runs (user_id, lang_hint, language_sent, whisper_text, whisper_language, segments, accepted, reason, transcript, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [userId, langHint ? String(langHint).slice(0, 10) : null, languageSent || null,
       typeof raw?.text === 'string' ? raw.text.slice(0, 2000) : null,
       typeof raw?.language === 'string' ? raw.language.slice(0, 30) : null,
       JSON.stringify(sectionsOf(raw)),
       result ? !!result.ok : null, result && !result.ok ? String(result.reason || '').slice(0, 30) : null,
       result?.ok ? String(result.text || '').slice(0, 1000) : null,
       error ? String(error).slice(0, 200) : null]);
  } catch (e) { console.warn('voice fallback test: could not record:', e.message); }
}

module.exports = { available, current, skipsGemini, record, sectionsOf, HOURS };
