/**
 * routes/nutrientEnrichment.js — the nutrient enrichment pilot (Fixes-2k).
 *
 *   GET  /api/nutrient-enrichment/inventory         coach/admin, read-only
 *   POST /api/nutrient-enrichment/batches           admin: propose a batch (changes no food)
 *   GET  /api/nutrient-enrichment/batches/:id       coach/admin: the review rows
 *   POST /api/nutrient-enrichment/batches/:id/approve admin, with { confirm: "approve batch <id>" } (Fixes-2l)
 *   POST /api/nutrient-enrichment/batches/:id/apply admin, with { confirm: "apply batch <id>" }
 *   POST /api/nutrient-enrichment/batches/:id/rollback admin
 *
 * Applying is deliberately awkward: admin only, approval first (who approved
 * and the approved revision are recorded; apply refuses any other revision),
 * a typed confirmation, at most 20 foods per batch, and a pilot must be
 * reviewed and approved by Sachin before any batch is applied on the live
 * test or production database.
 */
const router = require('express').Router();
const pool = require('../db/pool');
const authMW = require('../middleware/auth');
const role = require('../middleware/roleCheck');
const E = require('../services/nutrientEnrichment');

router.use(authMW);

router.get('/inventory', role('monitor', 'admin'), async (req, res) => {
  try {
    const top = Math.min(100, Math.max(1, parseInt(req.query.top) || 30));
    res.json(await E.inventory(pool, { top }));
  } catch (err) {
    console.error('GET /nutrient-enrichment/inventory error:', err);
    res.status(500).json({ error: 'Could not build the inventory' });
  }
});

router.post('/batches', role('admin'), async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const out = await E.createBatch(db, { label: req.body?.label, proposals: req.body?.proposals, notes: req.body?.notes, userId: req.user.id });
    await db.query('COMMIT');
    res.status(201).json(out);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: err.message });
  } finally { db.release(); }
});

router.get('/batches/:id', role('monitor', 'admin'), async (req, res) => {
  try {
    const { rows: [b] } = await pool.query(`SELECT * FROM nutrient_enrichment_batches WHERE id = $1`, [req.params.id]);
    if (!b) return res.status(404).json({ error: 'batch not found' });
    const { rows } = await pool.query(
      `SELECT c.*, f.name AS food FROM nutrient_enrichment_changes c JOIN foods f ON f.id = c.food_id
        WHERE c.batch_id = $1 ORDER BY f.name, c.nutrient`, [b.id]);
    res.json({ batch: b, changes: rows });
  } catch (err) {
    console.error('GET /nutrient-enrichment/batches/:id error:', err);
    res.status(500).json({ error: 'Could not load the batch' });
  }
});

router.post('/batches/:id/approve', role('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (req.body?.confirm !== `approve batch ${id}`) return res.status(400).json({ error: `Type "approve batch ${id}" to confirm` });
  try { res.json(await E.approveBatch(pool, id, req.user.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/batches/:id/apply', role('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (req.body?.confirm !== `apply batch ${id}`) return res.status(400).json({ error: `Type "apply batch ${id}" to confirm` });
  try { res.json(await E.applyBatch(pool, id, req.user.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/batches/:id/rollback', role('admin'), async (req, res) => {
  try { res.json(await E.rollbackBatch(pool, parseInt(req.params.id), req.user.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

module.exports = router;
