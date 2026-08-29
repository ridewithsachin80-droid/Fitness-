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

/** Is push even possible on this device? */
export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && typeof Notification !== 'undefined';
}

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function pushPermission() {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Registers a Web Push subscription. Requires permission to ALREADY be
 * granted — this function never shows the browser prompt itself.
 *
 * That split is the point. The prompt used to fire from a useEffect on the
 * first mount of DailyLog, meaning a brand-new member met a bare system
 * dialog in their first second, before the app had done anything to earn it.
 * Most decline, and a denial is effectively permanent — which silently kills
 * the evening recap, coach messages and every gap nudge for that member, with
 * nothing shown to them or to the coach. PushPrimer now asks in plain words
 * first, and only calls requestPermission() on a real tap.
 *
 * Returns true if a subscription is registered.
 */
export async function registerPushSubscription() {
  if (!pushSupported())  return false;
  if (!VAPID_PUBLIC_KEY) {
    console.warn('registerPushSubscription: VITE_VAPID_PUBLIC_KEY not set');
    return false;
  }
  if (Notification.permission !== 'granted') return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const key  = subscription.getKey('p256dh');
    const auth = subscription.getKey('auth');
    await subscribePush({
      endpoint:    subscription.endpoint,
      p256dh:      btoa(String.fromCharCode(...new Uint8Array(key))),
      auth:        btoa(String.fromCharCode(...new Uint8Array(auth))),
      device_name: navigator.userAgent.substring(0, 80),
    });
    console.log('✅ Push subscription registered');
    return true;
  } catch (err) {
    console.warn('registerPushSubscription failed:', err.message);
    return false;
  }
}

/**
 * Re-registers an ALREADY-granted subscription on mount.
 *
 * Deliberately never prompts. A member who has said yes keeps working across
 * new devices and after a subscription expires; a member who has not is left
 * alone until PushPrimer asks them properly.
 */
export function usePush() {
  const { user }     = useAuthStore();
  const attempted    = useRef(false);

  useEffect(() => {
    if (attempted.current)  return;
    if (!user)              return;
    if (!pushSupported())   return;
    if (!VAPID_PUBLIC_KEY)  {
      console.warn('usePush: VITE_VAPID_PUBLIC_KEY not set — skipping push registration');
      return;
    }
    // The whole behaviour change: no prompt unless the member already agreed.
    if (Notification.permission !== 'granted') return;

    attempted.current = true;
    registerPushSubscription();
  }, [user?.id]);
}
