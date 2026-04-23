import { useEffect, useRef } from 'react';
import { subscribePush }    from '../api/logs';
import { useAuthStore }     from '../store/authStore';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/** Convert a URL-safe base64 VAPID key to a Uint8Array for the browser PushManager */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Registers a Web Push subscription on mount (once per device).
 * Silently no-ops if:
 *  - The browser doesn't support push
 *  - The user denies notification permission
 *  - A subscription is already registered
 *
 * Call this hook in DailyLog (patient) so it runs when the app first opens.
 */
export function usePush() {
  const { user }     = useAuthStore();
  const attempted    = useRef(false);

  useEffect(() => {
    // Only run once per mount, only for patients, only if SW + Push are supported
    if (attempted.current)            return;
    if (!user)                        return;
    if (!('serviceWorker' in navigator)) return;
    if (!('PushManager'   in window))    return;
    if (!VAPID_PUBLIC_KEY)            {
      console.warn('usePush: VITE_VAPID_PUBLIC_KEY not set — skipping push registration');
      return;
    }

    attempted.current = true;

    (async () => {
      try {
        // 1. Request notification permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.log('usePush: notification permission denied');
          return;
        }

        // 2. Wait for service worker to be ready
        const registration = await navigator.serviceWorker.ready;

        // 3. Check if already subscribed
        let subscription = await registration.pushManager.getSubscription();

        // 4. Create new subscription if not already subscribed
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly:      true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        }

        // 5. Send subscription to server (upsert — safe to call on every login)
        const key   = subscription.getKey('p256dh');
        const auth  = subscription.getKey('auth');

        await subscribePush({
          endpoint:    subscription.endpoint,
          p256dh:      btoa(String.fromCharCode(...new Uint8Array(key))),
          auth:        btoa(String.fromCharCode(...new Uint8Array(auth))),
          device_name: navigator.userAgent.substring(0, 80),
        });

        console.log('✅ Push subscription registered');
      } catch (err) {
        // Non-fatal — app works fine without push
        console.warn('usePush: failed to register push subscription:', err.message);
      }
    })();
  }, [user?.id]);
}
