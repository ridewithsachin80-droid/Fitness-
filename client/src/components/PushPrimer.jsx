/**
 * PushPrimer.jsx — asks for notification permission in plain words, on a tap.
 *
 * The browser prompt used to fire from a useEffect on the first mount of
 * DailyLog: a brand-new member met a bare system dialog in their first second,
 * before the app had shown them anything worth being notified about. Most
 * people decline that, and a denial is effectively permanent — which quietly
 * kills the evening recap, coach messages and every gap nudge for that member,
 * with nothing surfaced to them or to the coach.
 *
 * So: explain first, ask second, and only after they have actually logged
 * something — at which point "your coach sends a recap at 8:30" means
 * something concrete rather than being a request from a stranger.
 *
 * Shown at most twice. Dismissing is a real answer and is remembered.
 */

import { useEffect, useState } from 'react';
import { pushSupported, pushPermission, registerPushSubscription } from '../hooks/usePush';
import { haptic } from '../store/settingsStore';

const SEEN_KEY = 'fl-push-primer';
const MAX_ASKS = 2;

function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); }
  catch { return {}; }
}
function writeSeen(v) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch (_) {}
}

/**
 * @param {boolean} hasLogged  true once the member has something in today's
 *                             log — the primer stays hidden until then.
 */
export default function PushPrimer({ hasLogged }) {
  const [show, setShow]   = useState(false);
  const [busy, setBusy]   = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!hasLogged) return;
    if (!pushSupported()) return;

    const perm = pushPermission();
    // Already answered, either way — never nag.
    if (perm === 'granted') return;
    if (perm === 'denied') return;

    const seen = readSeen();
    if ((seen.asks || 0) >= MAX_ASKS) return;
    if (seen.dismissed) return;

    setShow(true);
  }, [hasLogged]);

  const enable = async () => {
    haptic(20);
    setBusy(true);
    const seen = readSeen();
    writeSeen({ ...seen, asks: (seen.asks || 0) + 1 });
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await registerPushSubscription();
        setShow(false);
      } else {
        // Say what happened rather than just vanishing — otherwise the member
        // has no idea why the recap never arrives.
        setDenied(true);
      }
    } catch (_) {
      setDenied(true);
    } finally { setBusy(false); }
  };

  const dismiss = () => {
    haptic(12);
    writeSeen({ ...readSeen(), dismissed: true });
    setShow(false);
  };

  if (!show) return null;

  if (denied) {
    return (
      <div className="rounded-2xl p-4 border border-white/[0.08] bg-[#1A1C20]">
        <p className="text-sm font-semibold text-white">Notifications are off</p>
        <p className="text-xs text-[#9EA3B0] mt-1 leading-relaxed">
          No problem — you'll still see everything here in the app. If you change
          your mind, turn them on for FitLife in your browser's site settings.
        </p>
        <button onClick={dismiss} style={{ minHeight: 36 }}
          className="mt-2 text-[11px] font-bold text-[#D4AF37] px-2">
          Got it
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4 border border-[rgba(212,175,55,0.20)]
      bg-[rgba(212,175,55,0.06)]">
      <p className="text-sm font-semibold text-white">Want your evening recap?</p>
      <p className="text-xs text-[#9EA3B0] mt-1 leading-relaxed">
        Your coach sends a short summary of your day at 8:30pm, plus a nudge if
        something's missing. Turn on notifications and we'll send it here.
      </p>
      <div className="flex gap-2 mt-3">
        <button onClick={enable} disabled={busy} style={{ minHeight: 38 }}
          className="flex-1 text-[11px] font-bold text-[#121316] rounded-xl
            bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]
            active:scale-[0.98] disabled:opacity-50">
          {busy ? 'Just a moment…' : 'Yes, notify me'}
        </button>
        <button onClick={dismiss} style={{ minHeight: 38 }}
          className="px-3 text-[11px] font-bold text-[#9EA3B0]
            border border-white/[0.10] rounded-xl">
          Not now
        </button>
      </div>
    </div>
  );
}
