import { useState } from 'react';
import { Eyebrow, Pressable } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { updateProfile } from '../../api/logs';
import { waterTarget, routineOrigin, targetOrigin, STANDARD_WATER_ML } from '../../lib/day';
import { firstName } from '../../utils/personName';

/**
 * WaterTargetCard — the coach sets one member's daily water target, and sees
 * which of the member's targets are still FitLife standards (Fixes-2j).
 *
 * Every profile starts at 3000 ml from the database default, so a member was
 * shown "3.0 L" as if their coach had chosen it. The member now sees
 * "FitLife standard" until the coach saves a target here. A coach who wants
 * exactly 3 L taps "Keep 3.0 L"; that records it as theirs.
 */
const MIN = 500, MAX = 8000;

export default function WaterTargetCard({ memberId, profile, onSaved }) {
  const [saved, setSaved]     = useState(null);
  const [editing, setEditing] = useState(false);
  const [litres, setLitres]   = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const p = saved || profile;
  const wt = waterTarget(p);
  const first = firstName(profile?.name, 'this member');
  const routine = routineOrigin(p);
  const ml = Math.round(parseFloat(litres) * 1000);
  const inRange = Number.isFinite(ml) && ml >= MIN && ml <= MAX;

  const send = async (water_target) => {
    setBusy(true); setError(null);
    try {
      const { data } = await updateProfile(memberId, { water_target });
      setSaved({ ...profile, ...data });
      setEditing(false); haptic(20); onSaved?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save. Check the connection and try again.');
    } finally { setBusy(false); }
  };

  const field = 'w-full text-sm font-bold bg-surface border border-white/[0.12] rounded-xl px-2 text-white focus:outline-none focus:ring-2 focus:ring-gold/30';

  return (
    <div data-testid="water-target">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Water target</Eyebrow>
          <p className="text-sm font-semibold text-white mt-0.5" data-testid="water-target-value">{wt.label} a day</p>
          <p className="text-caption text-lo mt-0.5" data-testid="water-target-note">
            {wt.isDefault
              ? `FitLife standard. ${first} sees it labelled that way until you set one.`
              : `Set for ${first}. This is what their Plan shows.`}
          </p>
        </div>
        {!editing && (
          <button type="button" style={{ minHeight: 44 }} data-testid="water-target-edit"
            onClick={() => { haptic(10); setLitres((wt.ml / 1000).toFixed(1)); setError(null); setEditing(true); }}
            className="flex-shrink-0 text-xs font-semibold text-gold-light bg-gold/10 px-3 rounded-xl">
            Change
          </button>
        )}
      </div>

      {wt.isDefault && !editing && (
        <button type="button" disabled={busy} style={{ minHeight: 44 }} data-testid="water-target-keep"
          onClick={() => send(STANDARD_WATER_ML)}
          className="mt-1 text-caption font-semibold text-mid disabled:opacity-50">
          Keep {(STANDARD_WATER_ML / 1000).toFixed(1)} L as {first}’s target
        </button>
      )}

      {editing && (
        <div className="mt-3" data-testid="water-target-form">
          <label className="block text-micro font-medium text-mute mb-1" htmlFor="wt-litres">Litres a day</label>
          <input id="wt-litres" type="number" inputMode="decimal" step="0.1" min="0.5" max="8" value={litres}
            onChange={e => setLitres(e.target.value)} style={{ minHeight: 48 }} className={field} data-testid="water-target-input" />
          {litres !== '' && !inRange && (
            <p className="mt-2 text-caption font-semibold text-warn" data-testid="water-target-range">Between 0.5 and 8 litres.</p>
          )}
          {error && <p className="mt-2 text-caption text-danger" data-testid="water-target-error">{error}</p>}
          <div className="flex gap-2 mt-3">
            <Pressable variant="primary" className="flex-1" disabled={busy || !inRange} data-testid="water-target-save" onPress={() => send(ml)}>
              {busy ? 'Saving…' : 'Save'}
            </Pressable>
            <Pressable variant="secondary" className="flex-1" disabled={busy} data-testid="water-target-cancel"
              onPress={() => { setEditing(false); setError(null); }}>
              Cancel
            </Pressable>
          </div>
          {!wt.isDefault && (
            <button type="button" disabled={busy} style={{ minHeight: 44 }} data-testid="water-target-reset"
              onClick={() => send(null)} className="w-full mt-1 text-caption font-semibold text-mid disabled:opacity-50">
              Go back to the FitLife standard
            </button>
          )}
        </div>
      )}

      <p className="text-caption text-lo mt-3 pt-3 border-t border-hair" data-testid="routine-origin">
        Daily routine: {routine.allStandard
          ? `FitLife standard (every item on). ${first} sees it labelled that way.`
          : routine.anyStandard
            ? `you chose some groups; ${routine.standard.map(g => ({ activities: 'activities', acv: 'ACV', supplements: 'supplements' }[g])).join(' and ')} still standard.`
            : 'chosen by you.'}
        {targetOrigin(p, 'macros') === 'none' ? ' No calorie or macro targets set.' : ''}
      </p>
    </div>
  );
}
