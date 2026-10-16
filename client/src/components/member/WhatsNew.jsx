import { useState } from 'react';
import { Icon } from '../primitives';
import { useSettingsStore } from '../../store/settingsStore';

const KEY = 'fitlife-whats-new-2026-10';
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };

/**
 * WhatsNew — a one-time card for members who used the app before the 16 Oct
 * 2026 redesign. Inline (not a pop-up), so it never traps focus or covers the
 * day; "Got it" hides it for good on this phone.
 */
export default function WhatsNew() {
  const onboarded = useSettingsStore(s => s.onboardingDone);
  const [hidden, setHidden] = useState(seen);
  if (hidden || !onboarded) return null;
  const done = () => { try { localStorage.setItem(KEY, '1'); } catch (_) {} setHidden(true); };
  return <section className="member-whatsnew" data-testid="whats-new" aria-label="What's new">
    <p className="member-whatsnew-title"><Icon name="spark" size={16} /> A fresh look — same coach, same data</p>
    <ul>
      <li><strong>Speak · Snap · Type</strong> to log anything, on any day.</li>
      <li>Tap the <strong>ring</strong> for your meals and macros.</li>
      <li><strong>Plan</strong> is a tab; <strong>More</strong> has the rest. Light or dark: in Settings.</li>
    </ul>
    <button type="button" onClick={done} data-testid="whats-new-ok">Got it</button>
  </section>;
}
