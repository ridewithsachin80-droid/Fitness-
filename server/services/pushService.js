const webpush = require('web-push');
const pool    = require('../db/pool');

// ── VAPID initialisation — lazy, guarded ─────────────────────────────────────
// Called once before the first send, not at module load.
// This prevents the server crashing on startup if env vars are missing.
let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return true;

  const { VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;

  if (!VAPID_EMAIL || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn(
      'pushService: VAPID env vars not set — push notifications disabled.\n' +
      '  Required: VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY'
    );
    return false;
  }

  try {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
    console.log('✅ VAPID configured');
    return true;
  } catch (err) {
    console.error('pushService: VAPID configuration failed:', err.message);
    return false;
  }
}

// ── sendToUser ────────────────────────────────────────────────────────────────
/**
 * Send a push notification to all active subscriptions for a user.
 * Silently no-ops if VAPID env vars are not configured.
 *
 * @param {number} userId  - Recipient's user ID
 * @param {string} title   - Notification title
 * @param {string} body    - Notification body
 * @param {string} type    - 'weight' | 'acv' | 'water' | 'supplement' | 'no_log'
 */
async function sendToUser(userId, title, body, type, extraData = {}) {
  if (!ensureVapid()) return;   // Push disabled — skip silently

  let subs;
  try {
    const result = await pool.query(
      'SELECT * FROM push_subscriptions WHERE user_id = $1 AND active = true',
      [userId]
    );
    subs = result.rows;
  } catch (err) {
    console.error('pushService: DB query failed:', err.message);
    return;
  }

  if (!subs.length) return;

  const payload = JSON.stringify({
    title,
    body,
    icon:  '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag:   type,
    requireInteraction: extraData.requiresAck === true,  // keeps notification visible
    data:  { type, timestamp: Date.now(), ...extraData },
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      await pool.query(
        'INSERT INTO notifications_log (user_id, type, title, body) VALUES ($1,$2,$3,$4)',
        [userId, type, title, body]
      );
    } catch (err) {
      // 410 Gone / 404 Not Found — the browser dropped it.
      // 403 Forbidden      — the subscription was created under a DIFFERENT
      //                      VAPID key than the one we are signing with. That
      //                      never recovers on its own, so retrying it daily
      //                      forever just writes a failed row a day and hides
      //                      a total outage behind a log nobody reads. Mark it
      //                      dead; the client re-subscribes on next open (see
      //                      keyMatches in client/src/hooks/usePush.js).
      if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403) {
        await pool.query(
          'UPDATE push_subscriptions SET active = false WHERE id = $1',
          [sub.id]
        );
        if (err.statusCode === 403) {
          // Loud, because this one usually means every subscription is dead.
          // If VAPID_PUBLIC_KEY and VITE_VAPID_PUBLIC_KEY have drifted apart,
          // this fires for the whole member list at once.
          console.error(
            `pushService: 403 on subscription ${sub.id} — VAPID key mismatch. ` +
            'Check VAPID_PUBLIC_KEY matches VITE_VAPID_PUBLIC_KEY.'
          );
        } else {
          console.log(`pushService: deactivated expired subscription ${sub.id}`);
        }
      } else {
        console.error(`pushService: failed to send to sub ${sub.id}:`, err.message);
        await pool.query(
          'INSERT INTO notifications_log (user_id, type, title, body, failed) VALUES ($1,$2,$3,$4,true)',
          [userId, type, title, body]
        );
      }
    }
  }
}

module.exports = { sendToUser };
