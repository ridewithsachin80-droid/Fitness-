/**
 * routes/progressPhotos.js — Phase 4: weekly progress photos.
 *
 *   POST   /api/progress-photos            member: one pose for this week (retake replaces it)
 *   GET    /api/progress-photos/me         member: their weeks, newest first
 *   DELETE /api/progress-photos/:id        member: delete one photo, now
 *   GET    /api/progress-photos/member/:id coach (assigned) or admin: that member's weeks
 *
 * Sachin's rules (5 Oct 2026): the member AND their coach see the photos; they
 * are deleted automatically after 12 months.
 *
 * These are body photos. They are:
 *   - stored only in the private R2 bucket, never in the database;
 *   - shown only through signed links that stop working after 5 minutes;
 *   - never sent to any AI model (nothing in this file calls one);
 *   - visible to the member, their assigned coach, and admin; nobody else.
 */
const express   = require('express');
const crypto    = require('crypto');
const router    = express.Router();
const pool      = require('../db/pool');
const authMW    = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const { getISTDate } = require('../utils/istDate');
const storage   = require('../services/storage');

const POSES = ['front', 'side', 'back'];
const LINK_SECONDS = 300;

/** The Sunday on or before an IST date: the week a photo belongs to. */
function weekOf(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

const linkFor = (key) => { try { return storage.photoUrl(key, { expires: LINK_SECONDS }); } catch (_) { return null; } };

async function weeksFor(memberId) {
  const { rows } = await pool.query(
    `SELECT id, week_date, pose, object_key, created_at FROM progress_photos
      WHERE patient_id = $1 ORDER BY week_date DESC, pose LIMIT 160`, [memberId]);
  const weeks = new Map();
  for (const r of rows) {
    const w = typeof r.week_date === 'string' ? r.week_date : r.week_date.toISOString().slice(0, 10);
    if (!weeks.has(w)) weeks.set(w, { week: w, photos: {} });
    weeks.get(w).photos[r.pose] = { id: r.id, url: linkFor(r.object_key), at: r.created_at };
  }
  return [...weeks.values()];
}

async function canSee(user, memberId) {
  if (user.role === 'admin') return true;
  if (user.role === 'patient') return user.id === memberId;
  const { rows } = await pool.query(
    `SELECT 1 FROM monitor_patients WHERE monitor_id=$1 AND patient_id=$2 AND active=true`, [user.id, memberId]);
  return rows.length > 0;
}

// ── Member ───────────────────────────────────────────────────────────────────
router.post('/', authMW, roleCheck('patient'), async (req, res) => {
  const pose = String(req.body?.pose || '').toLowerCase();
  const { image, mimeType } = req.body || {};
  if (!POSES.includes(pose)) return res.status(400).json({ error: 'Pose must be front, side or back.' });
  if (!image || typeof image !== 'string') return res.status(400).json({ error: 'A photo is needed.' });
  if (image.length > 8_000_000) return res.status(413).json({ error: 'That photo is too large. Try again.' });
  if (!storage.isConfigured()) return res.status(503).json({ error: 'Photo storage is not set up yet. Your coach has been told.' });
  const memberId = req.user.id, week = weekOf(getISTDate());
  const ext = /png/.test(mimeType || '') ? 'png' : 'jpg';
  const key = `progress/${memberId}/${week}/${pose}-${crypto.randomUUID()}.${ext}`;
  try {
    await storage.putObject(key, Buffer.from(image, 'base64'), /png/.test(mimeType || '') ? 'image/png' : 'image/jpeg');
  } catch (e) {
    console.error('progress photo upload failed:', e.message);
    return res.status(502).json({ error: "Couldn't save that photo just now. Try again." });
  }
  try {
    // A retake replaces this week's photo for that pose; the old file goes.
    const { rows: [old] } = await pool.query(
      `SELECT object_key FROM progress_photos WHERE patient_id=$1 AND week_date=$2 AND pose=$3`, [memberId, week, pose]);
    const { rows: [row] } = await pool.query(
      `INSERT INTO progress_photos (patient_id, week_date, pose, object_key) VALUES ($1,$2,$3,$4)
       ON CONFLICT (patient_id, week_date, pose)
       DO UPDATE SET object_key = EXCLUDED.object_key, created_at = NOW(), delete_after = NOW() + INTERVAL '12 months'
       RETURNING id`, [memberId, week, pose, key]);
    if (old?.object_key && old.object_key !== key) storage.deleteObject(old.object_key).catch(e => console.error('old progress photo delete failed:', e.message));
    res.json({ id: row.id, week, pose, url: linkFor(key) });
  } catch (e) {
    storage.deleteObject(key).catch(() => {});
    console.error('progress photo save failed:', e.message);
    res.status(500).json({ error: "Couldn't save that photo just now. Try again." });
  }
});

router.get('/me', authMW, roleCheck('patient'), async (req, res) => {
  try { res.json({ week: weekOf(getISTDate()), weeks: await weeksFor(req.user.id) }); }
  catch (e) { res.status(500).json({ error: 'Could not load your photos.' }); }
});

router.delete('/:id', authMW, roleCheck('patient'), async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { rows: [row] } = await pool.query(`SELECT object_key FROM progress_photos WHERE id=$1 AND patient_id=$2`, [id, req.user.id]);
    if (!row) return res.status(404).json({ error: 'Photo not found.' });
    // Storage first: if the file cannot be deleted, keep the row so it is retried, never orphaned.
    try { await storage.deleteObject(row.object_key); }
    catch (e) { return res.status(502).json({ error: "Couldn't delete that photo just now. Try again." }); }
    await pool.query(`DELETE FROM progress_photos WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Could not delete that photo.' }); }
});

// ── Coach ────────────────────────────────────────────────────────────────────
router.get('/member/:memberId', authMW, roleCheck('monitor', 'admin'), async (req, res) => {
  const memberId = parseInt(req.params.memberId);
  if (!Number.isInteger(memberId)) return res.status(400).json({ error: 'Bad member.' });
  try {
    if (!(await canSee(req.user, memberId))) return res.status(403).json({ error: 'Member not assigned to you.' });
    res.json({ week: weekOf(getISTDate()), weeks: await weeksFor(memberId) });
  } catch (e) { res.status(500).json({ error: 'Could not load photos.' }); }
});

/** Delete photos past their 12 months. Run daily by cronService; safe to repeat. */
async function deleteExpiredProgressPhotos(db = pool, limit = 500) {
  const { rows } = await db.query(
    `SELECT id, object_key FROM progress_photos WHERE delete_after < NOW() ORDER BY delete_after LIMIT $1`, [limit]);
  let deleted = 0;
  for (const r of rows) {
    try {
      await storage.deleteObject(r.object_key);
      await db.query(`DELETE FROM progress_photos WHERE id = $1`, [r.id]);
      deleted++;
    } catch (e) { console.error('progress photo expiry failed:', r.id, e.message); }
  }
  return deleted;
}

module.exports = router;
module.exports.deleteExpiredProgressPhotos = deleteExpiredProgressPhotos;
module.exports.weekOf = weekOf;
