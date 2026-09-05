import { useEffect, useState } from 'react';
import { Card, SectionTitle } from './UI';
import api from '../api/client';
import { platformName, isStandalone } from '../utils/session';

/**
 * Is this the Android wrapper rather than a browser?
 *
 * The TWA sets no user-agent flag we can rely on, so this is a best guess:
 * Android, running standalone. A false positive costs nothing — the deep link
 * simply does not resolve and the member falls back to copying the code.
 */
function looksLikeAndroidApp() {
  return platformName() === 'android' && isStandalone();
}

/**
 * VoiceLogging — set up logging by voice, without opening the app.
 *
 * WHAT THIS ACTUALLY DOES
 * -----------------------
 * Issues a long-lived, write-only token and shows it once. A phone shortcut
 * (or later a WhatsApp webhook) uses it to POST a spoken sentence to
 * /api/quick-log, which parses and saves it exactly as the in-app chat would.
 *
 * The token is deliberately separate from the login: turning voice logging off
 * here does NOT sign the member out of the app, and the token can only write a
 * day's log — it cannot read labs, change settings, or issue another token. If
 * it leaks, the damage is a wrong meal entry, not an account.
 *
 * SHOWN ONCE, ON PURPOSE
 * ----------------------
 * The server stores the token but never returns it again. Making it
 * retrievable would mean anyone who briefly has the member's unlocked phone
 * could copy a permanent credential. If they lose it, they generate a new one
 * — which invalidates the old, which is also how "turn it off" works.
 */
export default function VoiceLogging() {
  const [status,  setStatus]  = useState(null);   // null = still loading
  const [token,   setToken]   = useState(null);   // only ever held in memory
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState(null);
  const [copied,  setCopied]  = useState(false);
  const [handedOff, setHandedOff] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/quick-log/status');
      setStatus(data);
    } catch (_) {
      setStatus({ enabled: false, unavailable: true });
    }
  };

  useEffect(() => { load(); }, []);

  const setUp = async () => {
    setBusy(true); setError(null);
    try {
      const { data } = await api.post('/quick-log/token', {});

      // Inside the Android app, hand the token straight to the native side.
      // Asking a member to copy a 64-character string is exactly where
      // non-technical people give up.
      if (looksLikeAndroidApp()) {
        try {
          window.location.href = `fitlife://quick-log-token?t=${encodeURIComponent(data.token)}`;
          setHandedOff(true);
        } catch (_) {
          setToken(data.token);   // deep link blocked — show it instead
        }
      } else {
        setToken(data.token);
      }
      await load();
    } catch (_) {
      setError("Couldn't set that up. Try again in a moment.");
    }
    setBusy(false);
  };

  const turnOff = async () => {
    setBusy(true); setError(null);
    try {
      await api.delete('/quick-log/token');
      setToken(null);
      await load();
    } catch (_) {
      setError("Couldn't turn that off. Try again in a moment.");
    }
    setBusy(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      // Clipboard is blocked in some in-app browsers. The token is on screen
      // and selectable, so this is a convenience failing, not the feature.
      setError('Copy is blocked here — select the code and copy it by hand.');
    }
  };

  if (status === null) return null;

  return (
    <Card>
      <SectionTitle icon="🎙️" tooltip="Log by speaking, without opening the app">
        Voice logging
      </SectionTitle>

      <p className="text-sm text-[#9A968E] leading-relaxed mt-1">
        Log your day by speaking to your phone, without opening FitLife.
        Set this up once and it keeps working.
      </p>

      {error && <p className="text-sm text-[#E4572E] mt-3">{error}</p>}

      {handedOff && (
        <p className="text-sm text-[#D4AF37] mt-3">
          Ready. Say &ldquo;Hey Google, log with FitLife&rdquo;.
        </p>
      )}

      {/* Platform-specific instructions. Shown only once it is set up —
          telling someone how to use a thing they have not enabled is noise. */}
      {status.enabled && !token && platformName() === 'ios' && (
        <div className="mt-4 text-xs text-[#9A968E] leading-relaxed">
          <p className="text-[#E8E6E1] font-semibold mb-1">On iPhone</p>
          <p>
            Open the Shortcuts app, add the FitLife shortcut your coach sent you,
            and paste this code when it asks. Then just say
            &ldquo;Hey Siri, log with FitLife&rdquo;.
          </p>
        </div>
      )}
      {status.enabled && !token && platformName() === 'android' && !looksLikeAndroidApp() && (
        <div className="mt-4 text-xs text-[#9A968E] leading-relaxed">
          <p className="text-[#E8E6E1] font-semibold mb-1">On Android</p>
          <p>
            Install FitLife from the Play Store, then open this screen inside
            the app and tap New code — it sets itself up.
          </p>
        </div>
      )}

      {token && (
        <div className="mt-4 p-3 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/30">
          <p className="text-xs text-[#D4AF37] font-semibold mb-2">
            Your setup code — copy it now, it won't be shown again
          </p>
          <p className="text-[11px] text-[#E8E6E1] break-all font-mono leading-relaxed">
            {token}
          </p>
          <button onClick={copy}
            className="mt-3 px-4 py-2 rounded-lg text-xs font-semibold bg-[#D4AF37] text-[#121316]">
            {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!status.enabled ? (
          <button onClick={setUp} disabled={busy}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[#D4AF37] text-[#121316] disabled:opacity-40">
            {busy ? 'Setting up…' : 'Set up voice logging'}
          </button>
        ) : (
          <>
            <button onClick={setUp} disabled={busy}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white/10 text-[#E8E6E1] border border-white/20 disabled:opacity-40">
              {busy ? '…' : 'New code'}
            </button>
            <button onClick={turnOff} disabled={busy}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-[#9A968E] disabled:opacity-40">
              Turn off
            </button>
          </>
        )}
      </div>

      {status.enabled && status.issued && !token && (
        <p className="text-xs text-[#7E8596] mt-3">
          Set up on {new Date(status.issued).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric' })}.
          {' '}Lost the code? Tap New code — the old one stops working.
        </p>
      )}

      <p className="text-xs text-[#7E8596] mt-3 leading-relaxed">
        Turning this off never signs you out of the app.
      </p>
    </Card>
  );
}
