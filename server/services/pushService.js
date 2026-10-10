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
 *
 * RETURNS A RESULT. It used to return undefined in three separate
 * not-delivered cases — VAPID unconfigured, the subscription lookup failing,
 * and the member simply having no subscriptions — which is indistinguishable
 * from success to any caller that only watches for a thrown error.
 *
 * That is not academic. The coach AI chat reported "morning message sent" for
 * a member who had never granted notification permission: nothing left the
 * server, and the coach was told it had. A caller must be able to tell
 * delivered from silently-skipped.
 *
 * Existing callers ignore the return value and are unaffected.
 *
 * @returns {Promise<{ok: boolean, sent: number, failed: number, reason: string|null}>}
 *          reason is one of 'not-configured' | 'lookup-failed' |
 *          'no-subscriptions' | 'all-failed', or null when something was sent.
 *
 * @param {number} userId  - Recipient's user ID
 * @param {string} title   - Notification title
 * @param {string} body    - Notification body
 * @param {string} type    - 'weight' | 'acv' | 'water' | 'supplement' | 'no_log'
 */
async function sendToUser(userId, title, body, type, extraData = {}) {
  if (!ensureVapid()) return { ok: false, sent: 0, failed: 0, reason: 'not-configured' };

  let subs;
  try {
    const result = await pool.query(
      'SELECT * FROM push_subscriptions WHERE user_id = $1 AND active = true',
      [userId]
    );
    subs = result.rows;
  } catch (err) {
    console.error('pushService: DB query failed:', err.message);
    return { ok: false, sent: 0, failed: 0, reason: 'lookup-failed' };
  }

  // The commonest silent non-delivery: the member never granted notification
  // permission, or is on iOS Safari without installing to the home screen.
  if (!subs.length) return { ok: false, sent: 0, failed: 0, reason: 'no-subscriptions' };

  let sent = 0, failed = 0;

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
      sent++;
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
      failed++;
    }
  }

  return {
    ok: sent > 0,
    sent,
    failed,
    reason: sent > 0 ? null : 'all-failed',
  };
}

module.exports = { sendToUser };
