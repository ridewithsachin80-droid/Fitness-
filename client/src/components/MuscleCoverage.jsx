/**
 * MuscleCoverage.jsx
 *
 * "Which muscles worked, which are left to do." One shared dataset, three
 * lenses on it, switchable via tabs rather than three separate disconnected
 * widgets:
 *   - Sessions  — how many distinct days this week hit each muscle group
 *   - Volume    — total sets this week per muscle group
 *   - Recency   — days since each group was last trained at all (catches
 *                 genuinely stale groups, not just "not done today")
 *
 * Used for both the patient's own view (no patientId prop) and the coach's
 * view of any patient (patientId prop) — same component, same data shape,
 * just a different effective patient on the server side.
 */
import { useState, useEffect } from 'react';
import { Card, SectionTitle, CardSkeleton } from './UI';
import { getMuscleCoverage } from '../api/workouts';
import { today as getToday } from '../constants';

const GROUP_META = {
  chest:     { icon: '🫁', label: 'Chest' },
  back:      { icon: '🔙', label: 'Back' },
  legs:      { icon: '🦵', label: 'Legs' },
  shoulders: { icon: '🤷', label: 'Shoulders' },
  arms:      { icon: '💪', label: 'Arms' },
  core:      { icon: '🎯', label: 'Core' },
};
const GROUP_ORDER = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core'];

function recencyText(daysSince) {
  if (daysSince === null) return 'Never logged';
  if (daysSince === 0) return 'Today';
  if (daysSince === 1) return 'Yesterday';
  return `${daysSince}d ago`;
}

// Status color follows whichever lens is active — "good" means different
// things depending on the tab (2+ sessions vs recent-enough vs high volume).
function statusColor(group, tab) {
  if (tab === 'recency') {
    if (group.daysSince === null) return 'stale';
    if (group.daysSince <= 3) return 'good';
    if (group.daysSince <= 7) return 'ok';
    return 'stale';
  }
  const value = tab === 'sessions' ? group.sessions7d : group.sets7d;
  const goodThreshold = tab === 'sessions' ? 2 : 12; // ~2 sessions/week or ~12 sets/week is a reasonable per-group minimum
  if (value === 0) return 'stale';
  if (value >= goodThreshold) return 'good';
  return 'ok';
}

const STATUS_STYLES = {
  good:  'border-[rgba(124,92,252,0.30)] bg-[rgba(124,92,252,0.08)]',
  ok:    'border-amber-400/25 bg-amber-400/[0.06]',
  stale: 'border-white/[0.07] bg-white/[0.02]',
};
const STATUS_DOT = {
  good:  'bg-[#7c5cfc]',
  ok:    'bg-amber-400',
  stale: 'bg-[#3a3a46]',
};

export default function MuscleCoverage({ patientId, refreshTick = 0 }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]       = useState('sessions'); // 'sessions' | 'volume' | 'recency'

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMuscleCoverage(getToday(), patientId)
      .then(({ data }) => !cancelled && setData(data))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [patientId, refreshTick]);

  if (loading) return <Card><CardSkeleton lines={2} /></Card>;
  if (!data?.groups) return null;

  const staleCount = GROUP_ORDER.filter(g => statusColor(data.groups[g], 'recency') === 'stale').length;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle icon="🧠" tooltip="Which muscle groups you've actually trained, and which ones haven't been touched. Full-body exercises (Burpees, Kettlebell Swings, etc.) count toward every group, since they're not isolated to one area.">
          Muscle Coverage
        </SectionTitle>
        {staleCount > 0 && (
          <span className="text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
            {staleCount} need attention
          </span>
        )}
      </div>

      <div className="flex gap-1 bg-white/[0.04] p-1 rounded-xl mb-3">
        {[
          { id: 'sessions', label: 'Sessions' },
          { id: 'volume',   label: 'Volume' },
          { id: 'recency',  label: 'Recency' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === t.id ? 'bg-[#7c5cfc] text-white' : 'text-[#9a9aa6] hover:text-[#d8d8de]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {GROUP_ORDER.map(g => {
          const group = data.groups[g];
          const status = statusColor(group, tab);
          const meta = GROUP_META[g];
          const primary = tab === 'sessions' ? `${group.sessions7d}×`
            : tab === 'volume' ? `${group.sets7d} sets`
            : recencyText(group.daysSince);
          const secondary = tab === 'recency'
            ? (group.lastWorked ? `${group.sets7d} sets this week` : 'No sessions in 60 days')
            : `Last: ${recencyText(group.daysSince)}`;

          return (
            <div key={g} className={`rounded-xl border px-3 py-2.5 ${STATUS_STYLES[status]}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[status]}`} />
                <span className="text-xs font-semibold text-[#d8d8de]">{meta.icon} {meta.label}</span>
              </div>
              <p className="font-display text-lg font-semibold text-[#ededf0] leading-tight">{primary}</p>
              <p className="text-[10px] text-[#5a5a68] mt-0.5">{secondary}</p>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-[#5a5a68] mt-3 italic">
        "Sessions" and "Volume" cover the last 7 days. "Recency" looks back up to 60 days.
      </p>
    </Card>
  );
}
