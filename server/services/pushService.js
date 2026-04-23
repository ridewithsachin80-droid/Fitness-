const webpush = require('web-push');
const pool = require('../db/pool');

// Configure VAPID credentials (generated in Sprint 1 setup)
webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Send a push notification to all active subscriptions for a user.
 *
 * @param {number} userId  - Recipient's user ID
 * @param {string} title   - Notification title (shown in the OS notification)
 * @param {string} body    - Notification body text
 * @param {string} type    - One of: 'weight','acv','water','supplement','no_log'
 */
async function sendToUser(userId, title, body, type) {
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
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: type,                    // Replaces older notification of same type
    data: { type, timestamp: Date.now() },
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );

      // Log successful send
      await pool.query(
        'INSERT INTO notifications_log (user_id, type, title, body) VALUES ($1,$2,$3,$4)',
        [userId, type, title, body]
      );
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription has expired or been revoked — deactivate it
        await pool.query(
          'UPDATE push_subscriptions SET active = false WHERE id = $1',
          [sub.id]
        );
        console.log(`pushService: deactivated expired subscription ${sub.id}`);
      } else {
        console.error(`pushService: failed to send to sub ${sub.id}:`, err.message);
        // Log the failure
        await pool.query(
          'INSERT INTO notifications_log (user_id, type, title, body, failed) VALUES ($1,$2,$3,$4,true)',
          [userId, type, title, body]
        );
      }
    }
  }
}

module.exports = { sendToUser };
