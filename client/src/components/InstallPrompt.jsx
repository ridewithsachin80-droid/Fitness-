import { useState, useEffect } from 'react';

/**
 * Shows an "Add to Home Screen" banner when the browser fires
 * the beforeinstallprompt event (Chrome/Android).
 *
 * iOS users: handled separately via the manual Share → Add to Home Screen flow.
 * We detect iOS and show a manual instruction banner instead.
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

    // iOS detection
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    if (ios) {
      setIsIOS(true);
      setShow(true);
      return;
    }

    // Android/Chrome — listen for the native prompt event
    const handler = (e) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // App was installed
    window.addEventListener('appinstalled', () => {
      setShow(false);
      setInstalled(true);
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
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
  };

  const dismiss = () => {
    setShow(false);
    localStorage.setItem('installDismissedAt', Date.now().toString());
  };

  if (!show || installed) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 max-w-sm mx-auto bg-[#131317] border border-white/[0.08] text-white
      rounded-2xl p-4 shadow-card-raised z-50 flex items-center gap-3 fade-up">

      {/* Icon */}
      <div className="w-10 h-10 bg-[#7c5cfc] rounded-xl flex-shrink-0 flex items-center justify-center">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
        </svg>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="font-display font-semibold text-sm">Add to Home Screen</div>
        {isIOS ? (
          <div className="text-xs text-[#9a9aa6] mt-0.5">
            Tap <strong className="text-[#d8d8de]">Share</strong> then{' '}
            <strong className="text-[#d8d8de]">Add to Home Screen</strong>
          </div>
        ) : (
          <div className="text-xs text-[#9a9aa6] mt-0.5">
            Use as an app — works offline too
          </div>
        )}
      </div>

      {/* Actions */}
      {!isIOS && (
        <button
          onClick={install}
          className="px-3 py-2 bg-[#7c5cfc] hover:bg-[#a78bfa] text-[#08052a] text-xs
            font-bold rounded-xl flex-shrink-0 transition-colors"
        >
          Install
        </button>
      )}

      <button
        onClick={dismiss}
        className="text-[#5a5a68] hover:text-[#9a9aa6] text-xl leading-none flex-shrink-0 ml-1"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
