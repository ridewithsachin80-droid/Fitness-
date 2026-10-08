import { useState } from 'react';
import { Eyebrow, Pressable } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { updateProfile } from '../../api/logs';
import { sleepTarget, sleepMinutes, formatHours } from '../../lib/day';
import { firstName } from '../../utils/personName';

/**
 * SleepTargetCard — the coach sets one member's bedtime and wake time.
 *
 * Every member used to be shown the same target, 10:00 PM to 6:30 AM, from a
 * constant in the app. A member on a late shift, or one who is up at 4:30 for
 * the gym, was being told to sleep at hours they cannot keep. This is where
 * the coach gives them their own.
 *
 * Until it is set the member keeps the standard times, and the card says so.
 * The hours are never typed: they are worked out from the two times, on this
 * card and on the member's Plan alike.
 */
const TOO_SHORT = 4 * 60, TOO_LONG = 12 * 60;

export default function SleepTargetCard({ memberId, profile, onSaved }) {
  // What the server last confirmed, so the card is right before the page reloads.
  const [saved, setSaved]     = useState(null);
  const [editing, setEditing] = useState(false);
  const [bed, setBed]         = useState('');
  const [wake, setWake]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const target = sleepTarget(saved || profile);
  const first  = firstName(profile?.name, 'this member');

  const open = () => {
    haptic(10);
    setBed(target.bed); setWake(target.wake); setError(null); setEditing(true);
  };

  const mins    = bed && wake ? sleepMinutes(bed, wake) : null;
  const inRange = mins != null && mins >= TOO_SHORT && mins <= TOO_LONG;

  const send = async (body) => {
    setBusy(true); setError(null);
    try {
      const { data } = await updateProfile(memberId, body);
      setSaved({ sleep_bed: data?.sleep_bed ?? null, sleep_wake: data?.sleep_wake ?? null });
      setEditing(false);
      haptic(20);
      onSaved?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full text-sm font-bold bg-surface border border-white/[0.12] rounded-xl px-2 text-white focus:outline-none focus:ring-2 focus:ring-gold/30';

  return (
    <div data-testid="sleep-target">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Sleep target</Eyebrow>
          <p className="text-sm font-semibold text-white mt-0.5" data-testid="sleep-target-times">
            {target.bedLabel} → {target.wakeLabel} · {target.hoursLabel}
          </p>
          <p className="text-caption text-lo mt-0.5" data-testid="sleep-target-note">
            {target.isDefault
              ? `The standard times. Set ${first}'s own if they keep different hours.`
              : `Set for ${first}. This is what their Plan shows.`}
          </p>
        </div>
        {!editing && (
          <button type="button" onClick={open} style={{ minHeight: 44 }} data-testid="sleep-target-edit"
            className="flex-shrink-0 text-xs font-semibold text-gold-light bg-gold/10 px-3 rounded-xl">
            Change
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-3" data-testid="sleep-target-form">
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <label className="block text-micro font-medium text-mute mb-1" htmlFor="st-bed">Bedtime</label>
              <input id="st-bed" type="time" value={bed} onChange={e => setBed(e.target.value)}
                style={{ minHeight: 48 }} className={field} data-testid="sleep-target-bed" />
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-micro font-medium text-mute mb-1" htmlFor="st-wake">Wake time</label>
              <input id="st-wake" type="time" value={wake} onChange={e => setWake(e.target.value)}
                style={{ minHeight: 48 }} className={field} data-testid="sleep-target-wake" />
            </div>
          </div>

          {mins != null && (
            <p data-testid="sleep-target-preview"
              className={`mt-2 text-caption font-semibold ${inRange ? 'text-mid' : 'text-amber-300'}`}>
              {inRange
                ? `That is ${formatHours(mins)} of sleep.`
                : `That is ${formatHours(mins)} of sleep. A target should be between 4 and 12 hours. Check AM and PM.`}
            </p>
          )}
          {error && <p className="mt-2 text-caption text-danger" data-testid="sleep-target-error">{error}</p>}

          <div className="flex gap-2 mt-3">
            <Pressable variant="primary" className="flex-1" disabled={busy || !inRange} data-testid="sleep-target-save"
              onPress={() => send({ sleep_bed: bed, sleep_wake: wake })}>
              {busy ? 'Saving…' : 'Save'}
            </Pressable>
            <Pressable variant="secondary" className="flex-1" disabled={busy} data-testid="sleep-target-cancel"
              onPress={() => { setEditing(false); setError(null); }}>
              Cancel
            </Pressable>
          </div>
          {!target.isDefault && (
            <button type="button" disabled={busy} style={{ minHeight: 44 }} data-testid="sleep-target-reset"
              onClick={() => send({ sleep_bed: null, sleep_wake: null })}
              className="w-full mt-1 text-caption font-semibold text-mid disabled:opacity-50">
              Go back to the standard times
            </button>
          )}
        </div>
      )}
    </div>
  );
}
