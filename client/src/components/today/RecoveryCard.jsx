import { useEffect, useState } from 'react';
import { getTrackerData } from '../../api/trackers';
import { recoverySummary } from '../../lib/day';
import { Eyebrow, Icon } from '../primitives';

/**
 * RecoveryCard — sleep, HRV, resting heart rate, steps and one insight, for
 * members with a synced tracker (Sprint 11c).
 *
 * Renders NOTHING unless a tracker has reported at least one of those numbers
 * for today or yesterday. It never estimates: a member without a ring or watch
 * sees no card, not a made-up score. The provider name sits in the corner so
 * "recovery 41" is clearly the device's number, not FitLife's opinion.
 */
function Stat({ label, value, unit, delta, testId }) {
  if (value == null) return null;
  return (
    <div className="min-w-0" data-testid={testId}>
      <Eyebrow>{label}</Eyebrow>
      <p className="font-display text-num-sm font-semibold text-white tabular-nums leading-tight mt-0.5">
        {value}{unit && <span className="text-caption text-lo font-sans font-medium"> {unit}</span>}
      </p>
      {delta && <p className={`text-caption tabular-nums ${delta.good ? 'text-gold-light' : delta.bad ? 'text-amber-300' : 'text-mute'}`}>{delta.text}</p>}
    </div>
  );
}

export default function RecoveryCard({ today }) {
  const [days, setDays] = useState(null);
  useEffect(() => {
    let alive = true;
    getTrackerData(7).then(r => { if (alive) setDays(Array.isArray(r?.data) ? r.data : []); }).catch(() => { if (alive) setDays([]); });
    return () => { alive = false; };
  }, []);
  if (!days) return null;
  const s = recoverySummary(days, { today });
  if (!s) return null;
  const { latest, avgs, insight } = s;
  const fmtH = (m) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;
  const d = (val, avg, { lowerIsBetter = false, unit = '' } = {}) => {
    if (val == null || avg == null) return null;
    const diff = val - avg; if (Math.abs(diff) < (unit === 'min' ? 15 : 1)) return { text: 'usual', good: false, bad: false };
    const up = diff > 0; const good = lowerIsBetter ? !up : up;
    const shown = unit === 'min' ? fmtH(Math.abs(diff)) : `${Math.round(Math.abs(diff))}${unit}`;
    return { text: `${up ? '↑' : '↓'} ${shown} vs week`, good, bad: !good };
  };
  return (
    <section className="rounded-3xl border border-hair bg-surface px-4 py-3" data-testid="recovery-card">
      <div className="flex items-baseline justify-between">
        <Eyebrow tone="gold">Recovery{s.isToday ? '' : ' · yesterday'}</Eyebrow>
        {s.providers?.length > 0 && <span className="text-tiny text-lo">{s.providers.join(' · ')}</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-2">
        <Stat testId="rec-sleep" label="Sleep" value={latest.sleepMinutes != null ? fmtH(latest.sleepMinutes) : null} delta={d(latest.sleepMinutes, avgs.sleepMinutes, { unit: 'min' })} />
        <Stat testId="rec-hrv" label="HRV" value={latest.hrv != null ? Math.round(latest.hrv) : null} unit="ms" delta={d(latest.hrv, avgs.hrv)} />
        <Stat testId="rec-rhr" label="Resting HR" value={latest.restingHr != null ? Math.round(latest.restingHr) : null} unit="bpm" delta={d(latest.restingHr, avgs.restingHr, { lowerIsBetter: true })} />
        <Stat testId="rec-steps" label="Steps" value={latest.steps != null ? latest.steps.toLocaleString('en-IN') : null} delta={d(latest.steps, avgs.steps)} />
        {latest.recovery != null && <Stat testId="rec-score" label="Recovery" value={Math.round(latest.recovery)} unit="/100" />}
      </div>
      {insight && (
        <p className="mt-3 flex items-start gap-2 text-body-sm text-white leading-snug" data-testid="rec-insight">
          <Icon name="spark" size={13} className="text-gold mt-1 flex-shrink-0" />{insight}
        </p>
      )}
    </section>
  );
}
