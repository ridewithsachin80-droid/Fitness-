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
 * Do the bytes of an existing subscription's server key match the key this
 * build ships with?
 *
 * A PushSubscription is bound to the applicationServerKey it was created with.
 * Rotate VAPID and every existing subscription silently becomes undeliverable:
 * the browser keeps returning it from getSubscription(), the client happily
 * reuses it, and the server's sends fail with 403 forever. Nothing surfaces to
 * the member, the coach, or the logs beyond a failed row a day.
 *
 * `options.applicationServerKey` is an ArrayBuffer of the DECODED key, so the
 * comparison has to be byte-wise against the decoded current key — comparing
 * the base64 strings would always differ.
 *
 * Some older browsers do not expose `options` at all. In that case this
 * returns true (assume it matches) rather than churning a working
 * subscription on every app open.
 */
export function keyMatches(subscription, currentKeyBytes) {
  try {
    const existing = subscription?.options?.applicationServerKey;
    if (!existing) return true;
    const a = new Uint8Array(existing);
    if (a.length !== currentKeyBytes.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== currentKeyBytes[i]) return false;
    return true;
  } catch (_) {
    return true;
  }
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
    const keyBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

    let subscription = await registration.pushManager.getSubscription();

    // An existing subscription created under a DIFFERENT VAPID key is dead
    // weight — the server cannot deliver to it. Drop it and take a fresh one.
    // Without this, rotating the VAPID key breaks push for every existing
    // member permanently, with no error anyone would notice.
    if (subscription && !keyMatches(subscription, keyBytes)) {
      console.warn('registerPushSubscription: VAPID key changed — re-subscribing');
      try { await subscription.unsubscribe(); } catch (_) { /* best effort */ }
      subscription = null;
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: keyBytes,
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
