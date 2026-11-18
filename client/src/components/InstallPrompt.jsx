import { useState, useEffect } from 'react';
import { captureInstallOffer, getInstallOffer, clearInstallOffer, onInstallOffer } from '../utils/installOffer';

/**
 * Shows an "Add to Home Screen" banner when the browser fires
 * the beforeinstallprompt event (Chrome/Android).
 *
 * iOS users: handled separately via the manual Share → Add to Home Screen flow.
 * We detect iOS and show a manual instruction banner instead.
 */
/** Fixes-3j: the first time this phone opened FitLife (kept on the phone); true once that is a day ago. */
export function seenForADay(now = Date.now()) {
  try {
    const k = 'fitlife.firstSeenAt';
    const first = parseInt(localStorage.getItem(k) || '', 10);
    if (!Number.isFinite(first)) { localStorage.setItem(k, String(now)); return false; }
    return now - first >= 24 * 60 * 60 * 1000;
  } catch { return false; }
}

/**
 * Fixes-3j (UX review finding 16, found by the Android emulator robot): this card used to FLOAT (fixed, bottom-24, z-50)
 * over the "Type to log" bar on Today whenever Android Chrome offered installation, and its × was 11×20 px. It is now an
 * ordinary card in the page, at the end of Today, so it covers nothing; the × is a 44×44 px button.
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferred] = useState(null);
  const [show, setShow]               = useState(false);
  const [isIOS, setIsIOS]             = useState(false);
  const [installed, setInstalled]     = useState(false);

  useEffect(() => {
    // Don't show if already installed (standalone mode)
    if (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
      return;
    }

    // Already dismissed? Respect it for 14 days, then offer again — a
    // permanent dismiss means anyone who closes it once (even by accident)
    // never sees it again, which isn't what most users actually want.
    const dismissedAt = localStorage.getItem('installDismissedAt');
    if (dismissedAt && Date.now() - parseInt(dismissedAt) < 14 * 24 * 60 * 60 * 1000) return;
    // Fixes-3j (UX review 16): not on a member's first day on this phone — let them settle in before asking.
    if (!seenForADay()) return;

    // iOS detection
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    if (ios) {
      setIsIOS(true);
      setShow(true);
      return;
    }

    // Android/Chrome — the offer is caught from the app's start (utils/installOffer, Fixes-3j), so one that arrived
    // while Today was loading, or before a visit to another day, still shows.
    captureInstallOffer();
    const take = (e) => { if (e) { setDeferred(e); setShow(true); } else { setShow(false); setInstalled(true); } };
    if (getInstallOffer()) take(getInstallOffer());
    return onInstallOffer(take);
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      localStorage.setItem('installed', 'true');
    }
    setShow(false);
    setDeferred(null);
    clearInstallOffer();   // Chrome's offer can be used once
  };

  const dismiss = () => {
    setShow(false);
    localStorage.setItem('installDismissedAt', Date.now().toString());
  };

  if (!show || installed) return null;

  return (
    <div data-testid="install-card" className="mt-3 bg-surface border border-white/[0.08] text-white
      rounded-2xl p-4 flex items-center gap-3">

      {/* Icon */}
      <div className="w-10 h-10 bg-gold rounded-xl flex-shrink-0 flex items-center justify-center">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
        </svg>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="font-display font-semibold text-sm">Add to Home Screen</div>
        {isIOS ? (
          <div className="text-xs text-mid mt-0.5">
            Tap <strong className="text-soft">Share</strong> then{' '}
            <strong className="text-soft">Add to Home Screen</strong>
          </div>
        ) : (
          <div className="text-xs text-mid mt-0.5">
            Use as an app — works offline too
          </div>
        )}
      </div>

      {/* Actions */}
      {!isIOS && (
        <button
          onClick={install}
          style={{ minHeight: 44 }}
          className="px-3 py-2 bg-gold hover:bg-gold-light text-charcoal text-xs
            font-bold rounded-xl flex-shrink-0 transition-colors"
        >
          Install
        </button>
      )}

      <button
        type="button"
        onClick={dismiss}
        data-testid="install-dismiss"
        style={{ minWidth: 44, minHeight: 44 }}
        className="text-mid hover:text-white text-xl leading-none flex-shrink-0 -mr-2 flex items-center justify-center rounded-xl"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
