const router = require('express').Router();
const pool = require('../db/pool');
const authMW = require('../middleware/auth');

// ── POST /api/notifications/subscribe ────────────────────────────────────────
// Store or update a Web Push subscription for the authenticated user.
// Called by usePush() hook on first page load after permission granted.
router.post('/subscribe', authMW, async (req, res) => {
  const { endpoint, p256dh, auth, device_name } = req.body;

  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'endpoint, p256dh, and auth are required' });
  }

  try {
    // Upsert: if endpoint already exists, re-activate and update keys
    const result = await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_name, active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id     = EXCLUDED.user_id,
         p256dh      = EXCLUDED.p256dh,
         auth        = EXCLUDED.auth,
         device_name = EXCLUDED.device_name,
         active      = true
       RETURNING id`,
      [req.user.id, endpoint, p256dh, auth, device_name || null]
    );

    res.status(201).json({ subscribed: true, id: result.rows[0].id });
  } catch (err) {
    console.error('POST /notifications/subscribe error:', err);
    res.status(500).json({ error: 'Failed to save push subscription' });
  }
});

// ── DELETE /api/notifications/unsubscribe ─────────────────────────────────────
// Soft-delete: marks the subscription inactive instead of deleting.
// Accepts endpoint in request body so the client can pass the exact sub endpoint.
router.delete('/unsubscribe', authMW, async (req, res) => {
  const { endpoint } = req.body;

  try {
    if (endpoint) {
      // Unsubscribe a specific device
      await pool.query(
        `UPDATE push_subscriptions
         SET active = false
         WHERE user_id = $1 AND endpoint = $2`,
        [req.user.id, endpoint]
      );
    } else {
      // Unsubscribe all devices for this user
      await pool.query(
        'UPDATE push_subscriptions SET active = false WHERE user_id = $1',
        [req.user.id]
      );
    }

    res.json({ unsubscribed: true });
  } catch (err) {
    console.error('DELETE /notifications/unsubscribe error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// ── GET /api/notifications/subscriptions ──────────────────────────────────────
// List all active push subscriptions for the current user (useful for settings UI).
router.get('/subscriptions', authMW, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, device_name, created_at
       FROM push_subscriptions
       WHERE user_id = $1 AND active = true
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('GET /notifications/subscriptions error:', err);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// ── GET /api/notifications/log ─────────────────────────────────────────────────
// Returns the last 20 notifications sent to the current user (for a settings/history UI).
router.get('/log', authMW, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, type, title, body, sent_at, opened_at, failed
       FROM notifications_log
       WHERE user_id = $1
       ORDER BY sent_at DESC
       LIMIT 20`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('GET /notifications/log error:', err);
    res.status(500).json({ error: 'Failed to fetch notification log' });
  }
});

module.exports = router;
