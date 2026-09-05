/**
 * routes/quickLog.js — logging by voice, without a login session.
 *
 * WHY THIS IS ITS OWN FILE
 * ------------------------
 * routes/aiChat.js applies `router.use(authMW)` to everything in it. This
 * endpoint cannot sit behind a JWT: the caller is a phone shortcut, a WhatsApp
 * webhook or an SMS gateway, none of which has a login session.
 *
 * It is mounted on its own path rather than added to /api/ai-chat, so there is
 * no ordering subtlety about which middleware runs first. Route shadowing has
 * bitten this codebase before and it is not worth being clever about.
 *
 * THE TOKEN
 * ---------
 * A long-lived, WRITE-ONLY credential stored in patient_profiles. Its scope is
 * deliberately narrow: it can write a day's log and nothing else. It cannot
 * read labs, change settings, message the coach, or issue another token. If it
 * leaks, the damage is a wrong meal entry, not an account.
 *
 * Revoking is rotating: issuing a new token invalidates the old one, and it is
 * separate from the JWT so revoking voice access never signs the member out of
 * the app.
 */

const router  = require('express').Router();
const crypto  = require('crypto');
const pool    = require('../db/pool');
const authMW  = require('../middleware/auth');

const { parseMemberMessage }   = require('./aiChat');
const { buildParseContext, calorieTargetFor } = require('../services/memberParse');
const { applyParsed, composeVoiceReply }      = require('../services/memberLogApply');
const { getISTDate } = require('../utils/istDate');

const MAX_PER_HOUR = 30;
const rateBuckets  = new Map();

/**
 * A ceiling, not a security boundary. A stuck shortcut retrying in a loop
 * would otherwise fill the day's log with duplicates and burn AI credits.
 */
function withinRateLimit(userId) {
  const now  = Date.now();
  const hour = 60 * 60 * 1000;
  const hits = (rateBuckets.get(userId) || []).filter(t => now - t < hour);
  if (hits.length >= MAX_PER_HOUR) { rateBuckets.set(userId, hits); return false; }
  hits.push(now);
  rateBuckets.set(userId, hits);
  return true;
}

/**
 * Resolves the bearer credential to a member.
 *
 * Accepts EITHER the write-only voice token OR a normal login JWT. Both end up
 * at the same place, which is the point: hands-free mode inside the app is the
 * same conversation as a phone shortcut, and giving it its own endpoint would
 * mean two copies of the parse-apply-reply path drifting apart.
 *
 * The JWT is tried first only because it is cheap to verify and needs no
 * database round trip.
 */
async function tokenAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  // A logged-in member using hands-free mode in the app.
  if (token && token.split('.').length === 3) {
    try {
      const jwtLib  = require('jsonwebtoken');
      const payload = jwtLib.verify(token, process.env.JWT_SECRET);
      if (payload && payload.role === 'patient' && payload.id) {
        const { rows } = await pool.query(
          `SELECT id, name, active FROM users WHERE id = $1`, [payload.id]);
        if (rows[0] && rows[0].active) { req.member = rows[0]; return next(); }
      }
      return res.status(401).json({ error: 'Voice logging is for members.' });
    } catch (_) {
      // Not a valid JWT — fall through and try it as a voice token. A voice
      // token is hex and can never contain dots, so this cannot misfire.
    }
  }

  // Length-checked before hitting the database so a garbage header costs
  // nothing, and so a short value cannot match by accident.
  if (!token || token.length < 32) {
    return res.status(401).json({ error: 'Voice logging is not set up for this device.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.active
       FROM patient_profiles pp
       JOIN users u ON u.id = pp.user_id
       WHERE pp.quick_log_token = $1`, [token]);
    const member = rows[0];
    if (!member || !member.active || !member.id) {
      return res.status(401).json({ error: 'Voice logging is not set up for this device.' });
    }
    req.member = member;
    return next();
  } catch (err) {
    console.error('quick-log auth failed:', err.message);
    return res.status(500).json({ error: 'Could not check your device.' });
  }
}

// ── POST /api/quick-log ─────────────────────────────────────────────────────
// Body: { text: "2 roti, dal, weight 78.4" }
// Returns a reply written to be READ ALOUD — see composeVoiceReply.
router.post('/', tokenAuth, async (req, res) => {
  const userId = req.member.id;
  const text   = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 1200) : '';

  if (text.length < 2) {
    return res.json({ ok: false, reply: 'I did not catch that. Try again.' });
  }
  if (!withinRateLimit(userId)) {
    return res.status(429).json({ ok: false, reply: 'Too many logs just now. Try again in a little while.' });
  }

  const istDate = getISTDate();
  let reply = 'Something went wrong. Please log it in the app.';
  let outcome = 'error';
  let applied = null;

  try {
    const context = await buildParseContext(userId, { istDate });
    const parsed  = await parseMemberMessage({ userId, message: text, context });

    if (parsed && parsed.__status) {
      // The parser failed upstream — the AI was down, or returned nonsense.
      // Say so plainly rather than pretending nothing was said.
      outcome = 'error';
      reply   = 'The assistant is busy. Try again in a moment.';
    } else if (parsed && parsed.sent_to_coach) {
      outcome = 'coach';
      reply   = 'Sent that to your coach.';
    } else {
      // Voice has no tick-to-confirm step, so everything parsed is applied.
      // That is the whole point, and it is why the plausibility gates in
      // memberLogApply matter more here than they do in the app.
      const result = await applyParsed(userId, parsed, { istDate, source: 'voice' });
      applied = result.applied;
      const target = await calorieTargetFor(userId);
      reply   = composeVoiceReply(result.applied, result.dayTotals, { calorieTarget: target });
      outcome = Object.values(result.applied).some(v => v && v !== 0) ? 'logged' : 'nothing';
    }
  } catch (err) {
    console.error('quick-log failed:', err.stack || err.message);
  }

  // Recorded either way. A turn that failed is the one worth reading later,
  // and it is also the conversation memory the next message needs.
  try {
    await pool.query(
      `INSERT INTO quick_log_turns (patient_id, source, text, reply, outcome)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, String(req.body?.source || 'voice').slice(0, 12), text, reply, outcome]);
  } catch (err) {
    console.error('quick-log turn not recorded:', err.message);
  }

  return res.json({ ok: outcome === 'logged' || outcome === 'coach', reply, applied });
});

// ── POST /api/quick-log/token ───────────────────────────────────────────────
// Member-only. Issues a token, or rotates it — which is how "turn off voice
// logging" works. Returned ONCE; we store it but never show it again.
router.post('/token', authMW, async (req, res) => {
  if (req.user.role !== 'patient') {
    return res.status(403).json({ error: 'Voice logging is for members.' });
  }
  try {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO patient_profiles (user_id, quick_log_token, quick_log_issued)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         quick_log_token  = EXCLUDED.quick_log_token,
         quick_log_issued = NOW()`,
      [req.user.id, token]);
    res.json({ token, issued: new Date().toISOString() });
  } catch (err) {
    console.error('quick-log token issue failed:', err.message);
    res.status(500).json({ error: 'Could not set up voice logging.' });
  }
});

// ── DELETE /api/quick-log/token ─────────────────────────────────────────────
router.delete('/token', authMW, async (req, res) => {
  try {
    await pool.query(
      `UPDATE patient_profiles SET quick_log_token = NULL, quick_log_issued = NULL
       WHERE user_id = $1`, [req.user.id]);
    res.json({ revoked: true });
  } catch (err) {
    console.error('quick-log token revoke failed:', err.message);
    res.status(500).json({ error: 'Could not turn off voice logging.' });
  }
});

// ── GET /api/quick-log/status ───────────────────────────────────────────────
// Whether voice logging is on, and when it was set up. Never returns the
// token itself — it was shown once and is not recoverable by design.
router.get('/status', authMW, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT quick_log_issued FROM patient_profiles WHERE user_id = $1`, [req.user.id]);
    res.json({
      enabled: !!rows[0]?.quick_log_issued,
      issued:  rows[0]?.quick_log_issued || null,
    });
  } catch (err) {
    console.error('quick-log status failed:', err.message);
    res.status(500).json({ error: 'Could not check voice logging.' });
  }
});

module.exports = router;
