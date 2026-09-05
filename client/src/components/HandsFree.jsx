import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHandsFree } from '../hooks/useHandsFree';
import { matchCommand } from '../utils/voiceCommands';
import api from '../api/client';

const STORAGE_KEY = 'fl-hands-free';

/**
 * HandsFree — the always-listening voice assistant, and its indicator.
 *
 * OFF BY DEFAULT, AND VISIBLY ON WHEN ON
 * --------------------------------------
 * There is no wake-word API in a browser. To hear "hey FitLife" the microphone
 * has to be genuinely open the whole time this is enabled. That is a real
 * thing to do to someone's phone, so:
 *
 *   - it is opt-in, never on by default
 *   - while it is listening there is a permanent, visible indicator
 *   - the indicator is also the off switch, reachable in one tap
 *
 * A feature that quietly holds the microphone would be a betrayal of the
 * member, however useful it is.
 *
 * IT ONLY WORKS WITH THE APP OPEN
 * -------------------------------
 * Browsers suspend microphone capture when a tab is backgrounded or the phone
 * locks. This is hands-free WHILE USING THE APP — phone on the kitchen
 * counter, hands busy. Logging from a locked phone is the Shortcut path.
 */
export default function HandsFree() {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
  }, [enabled]);

  /**
   * A navigation command, or null to let it be treated as something to log.
   * Returns the sentence to speak, because the member cannot see that the
   * screen changed.
   */
  const onCommand = useCallback((text) => {
    const cmd = matchCommand(text);
    if (!cmd) return null;
    if (cmd.sleep) { setEnabled(false); return cmd.speak; }
    if (cmd.route) navigate(cmd.route);
    return cmd.speak;
  }, [navigate]);

  /**
   * Sends a confirmed sentence to be logged.
   *
   * Uses /quick-log — the same endpoint a phone shortcut calls — rather than
   * the in-app parse-then-apply path, so hands-free and voice logging cannot
   * drift into behaving differently. The reply comes back already written to
   * be read aloud.
   */
  const onLog = useCallback(async (sentence) => {
    const { data } = await api.post('/quick-log', { text: sentence, source: 'handsfree' });
    return data?.reply || 'Logged.';
  }, []);

  const { state, error, supported } = useHandsFree({ enabled, onCommand, onLog });

  if (!supported) return null;
  if (!enabled) return null;

  const label = {
    idle:       'Listening — say "Hey FitLife"',
    ready:      'Go ahead',
    confirming: 'Waiting for yes or no',
    working:    'Saving…',
    off:        '',
  }[state] || '';

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2
                    px-4 py-2 rounded-full bg-[#1a1b1f] border border-[#D4AF37]/40 shadow-lg">
      <span className={`w-2.5 h-2.5 rounded-full ${
        state === 'confirming' ? 'bg-[#E4572E]' : 'bg-[#D4AF37]'
      } ${state === 'idle' ? 'animate-pulse' : ''}`} />
      <span className="text-xs text-[#E8E6E1] max-w-[55vw] truncate">
        {error || label}
      </span>
      <button onClick={() => setEnabled(false)}
        className="text-xs text-[#9A968E] underline underline-offset-2 shrink-0">
        Stop
      </button>
    </div>
  );
}

/** The toggle, for Settings. Kept here so the storage key has one owner. */
export function useHandsFreeToggle() {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return false; }
  });
  const toggle = (v) => {
    setOn(v);
    try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch (_) {}
    // The indicator lives in another component; a storage event does not fire
    // in the tab that wrote it, so a reload is the honest way to apply this.
    window.location.reload();
  };
  return [on, toggle];
}
