/**
 * routes/platePhotos.js — Phase 3: a plate photo checked against the plan.
 *
 *   POST /api/plate/check         member: photo + meal name -> what is on the plate vs the plan
 *   POST /api/plate/:id/confirm   member: what they logged (the app writes the food itself)
 *   GET  /api/plate/off-plan      coach:  today's flagged meals for their members
 *   POST /api/plate/:id/seen      coach:  take a card off the feed
 *   GET  /api/plate/storage-check admin:  upload, read back and delete a tiny file
 *
 * Photos are private. The app is sent a signed link that works for 5 minutes.
 * Food is NOT written here: the member's app logs it through the same path as
 * every other entry (offline queue, totals, coach view), then confirms.
 */
const express   = require('express');
const crypto    = require('crypto');
const axios     = require('axios');
const router    = express.Router();
const pool      = require('../db/pool');
const authMW    = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const { getISTDate } = require('../utils/istDate');
const storage   = require('../services/storage');
const PP        = require('../services/platePhoto');
const DP        = require('../services/dietPlan');

const GEMINI_MODELS = [process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite', process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash'].filter(Boolean);
const geminiUrl = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const LINK_SECONDS = 300;

const linkFor = (key) => {
  if (!key) return null;
  try { return storage.photoUrl(key, { expires: LINK_SECONDS }); } catch (_) { return null; }
};

/** The vision model's JSON for this photo and meal. Throws on failure. */
async function askVision(prompt, image, mimeType) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('Photo checking needs GEMINI_API_KEY.'), { status: 500 });
  let lastErr;
  for (const model of GEMINI_MODELS) {
    try {
      const r = await axios.post(`${geminiUrl(model)}?key=${key}`, {
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType || 'image/jpeg', data: image } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500, responseMimeType: 'application/json' },
      }, { headers: { 'content-type': 'application/json' }, timeout: 45000 });
      const text = (r.data.candidates?.[0]?.content?.parts || []).map(p => p.text).join('');
      const a = text.indexOf('{'), b = text.lastIndexOf('}');
      if (a < 0 || b <= a) throw new Error('No JSON in the vision answer');
      return JSON.parse(text.slice(a, b + 1));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Vision model failed');
}

// ── Member ───────────────────────────────────────────────────────────────────
router.post('/check', authMW, roleCheck('patient'), async (req, res) => {
  const { image, mimeType } = req.body || {};
  const mealName = String(req.body?.meal || '').trim().slice(0, 40);
  if (!image || typeof image !== 'string') return res.status(400).json({ error: 'A photo is needed.' });
  if (image.length > 8_000_000) return res.status(413).json({ error: 'That photo is too large. Try again.' });
  if (!mealName) return res.status(400).json({ error: 'Which meal is this?' });
  const memberId = req.user.id, today = getISTDate();
  try {
    await DP.ensureDay(pool, memberId, today, today);
    const [plan, { rows }] = await Promise.all([
      DP.planInForce(pool, memberId, today),
      pool.query(`SELECT meal, items, created_at FROM meal_plans WHERE patient_id=$1 AND plan_date=$2::date ORDER BY created_at`, [memberId, today]),
    ]);
    const meal = DP.timedMeals(rows, plan, today).find(m => String(m.meal).toLowerCase() === mealName.toLowerCase());
    if (!meal || !(meal.items || []).length) return res.status(409).json({ error: `There is no ${mealName} in today's plan.` });

    let raw;
    try { raw = await askVision(PP.buildPrompt(meal), image, mimeType); }
    catch (e) { return res.status(502).json({ error: "I couldn't read that photo just now. Try again, or log the meal as planned." }); }
    const analysis = PP.analyse(meal, raw);
    // The food table knows real nutrition for many extras; the model's figure is a fallback.
    try {
      const enriched = await require('./aiChat').enrichFromDB(analysis.extras.map(e => ({ name: e.name, grams: e.grams, per_100g: e.per_100g })));
      analysis.extras = analysis.extras.map((e, i) => {
        const db = enriched?.[i];
        if (!db || !db.per_100g || db.source === 'ai') return e;
        return { ...e, per_100g: db.per_100g, kcal: Math.round(e.grams * (Number(db.per_100g.calories) || 0) / 100) };
      });
    } catch (_) { /* keep the model's figures */ }

    // Keep the photo, privately. A storage failure must not lose the check.
    let objectKey = null;
    if (storage.isConfigured()) {
      const ext = /png/.test(mimeType || '') ? 'png' : /webp/.test(mimeType || '') ? 'webp' : 'jpg';
      const key = `meals/${memberId}/${today}/${crypto.randomUUID()}.${ext}`;
      try { await storage.putObject(key, Buffer.from(image, 'base64'), mimeType || 'image/jpeg'); objectKey = key; }
      catch (e) { console.error('plate photo upload failed:', e.message); }
    }
    const { rows: [row] } = await pool.query(
      `INSERT INTO meal_photos (patient_id, log_date, meal, object_key, analysis) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [memberId, today, meal.meal, objectKey, JSON.stringify(analysis)]);
    res.json({ photo_id: row.id, ...analysis, photo_saved: !!objectKey, photo_url: linkFor(objectKey) });
  } catch (err) {
    console.error('plate check failed:', err.message);
    res.status(500).json({ error: 'Something went wrong. Try again, or log the meal as planned.' });
  }
});

router.post('/:id/confirm', authMW, roleCheck('patient'), async (req, res) => {
  const id = parseInt(req.params.id);
  const as = ['meal', 'extra', 'swap'].includes(req.body?.as) ? req.body.as : 'meal';
  try {
    const { rows: [p] } = await pool.query(`SELECT * FROM meal_photos WHERE id=$1 AND patient_id=$2`, [id, req.user.id]);
    if (!p) return res.status(404).json({ error: 'Photo not found.' });
    const s = PP.summarise(p.analysis, as, req.body?.items);
    await pool.query(
      `UPDATE meal_photos SET status='logged', outcome=$2, extras=$3, extras_kcal=$4, differences=$5, flagged=$6 WHERE id=$1`,
      [id, s.outcome, JSON.stringify(s.extras), s.extras_kcal, JSON.stringify(s.differences), s.flagged]);
    res.json({ ok: true, flagged: s.flagged, outcome: s.outcome });
  } catch (err) {
    console.error('plate confirm failed:', err.message);
    res.status(500).json({ error: 'Could not record that.' });
  }
});

// ── Coach ────────────────────────────────────────────────────────────────────
router.get('/off-plan', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : getISTDate();
  try {
    const mine = req.user.role === 'admin' ? '' : 'AND ph.patient_id IN (SELECT patient_id FROM monitor_patients WHERE monitor_id=$2 AND active=true)';
    const params = req.user.role === 'admin' ? [date] : [date, req.user.id];
    const { rows } = await pool.query(
      `SELECT ph.id, ph.patient_id, u.name, u.phone, ph.meal, ph.outcome, ph.extras, ph.extras_kcal, ph.differences,
              ph.object_key, ph.created_at, dl.food_items, pp.macro_kcal
         FROM meal_photos ph
         JOIN users u ON u.id = ph.patient_id
         LEFT JOIN daily_logs dl ON dl.patient_id = ph.patient_id AND dl.log_date = ph.log_date
         LEFT JOIN patient_profiles pp ON pp.user_id = ph.patient_id
        WHERE ph.log_date = $1::date AND ph.flagged = true AND ph.status = 'logged' AND ph.coach_seen_at IS NULL ${mine}
        ORDER BY ph.created_at DESC LIMIT 50`, params);
    const dayKcal = (items) => Math.round((Array.isArray(items) ? items : []).reduce((a, it) => a + (Number(it.grams) || 0) * (Number(it.per_100g?.calories) || 0) / 100, 0));
    res.json({ date, items: rows.map(r => ({
      id: r.id, member_id: r.patient_id, name: r.name, phone: r.phone, meal: r.meal, outcome: r.outcome,
      extras: r.extras, extras_kcal: r.extras_kcal, differences: r.differences, at: r.created_at,
      day_kcal: dayKcal(r.food_items), target_kcal: r.macro_kcal || null, photo_url: linkFor(r.object_key),
    })) });
  } catch (err) {
    console.error('off-plan feed failed:', err.message);
    res.status(500).json({ error: 'Could not load off-plan meals.' });
  }
});

router.post('/:id/seen', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const mine = req.user.role === 'admin' ? '' : `AND patient_id IN (SELECT patient_id FROM monitor_patients WHERE monitor_id=$2 AND active=true)`;
    const { rowCount } = await pool.query(`UPDATE meal_photos SET coach_seen_at = NOW() WHERE id=$1 ${mine}`,
      req.user.role === 'admin' ? [id] : [id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Could not update.' }); }
});

router.get('/storage-check', authMW, roleCheck('admin'), async (req, res) => {
  res.json(await storage.selfCheck());
});

/** Delete photos past their date. Run daily by cronService; safe to repeat. */
async function deleteExpiredPhotos(db = pool, limit = 500) {
  const { rows } = await db.query(
    `SELECT id, object_key FROM meal_photos WHERE object_key IS NOT NULL AND delete_after < NOW() ORDER BY delete_after LIMIT $1`, [limit]);
  let deleted = 0;
  for (const r of rows) {
    try {
      await storage.deleteObject(r.object_key);
      await db.query(`UPDATE meal_photos SET object_key = NULL WHERE id = $1`, [r.id]);
      deleted++;
    } catch (e) { console.error('photo delete failed:', r.id, e.message); }
  }
  return deleted;
}

module.exports = router;
module.exports.deleteExpiredPhotos = deleteExpiredPhotos;
