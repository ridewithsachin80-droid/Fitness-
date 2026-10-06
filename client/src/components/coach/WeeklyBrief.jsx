import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Eyebrow } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { formatDate } from '../../constants';

/**
 * WeeklyBrief — Phase 7, on the coach's member page. The AI's brief for the
 * member's last full week (Mon–Sun), written only from the numbers shown under
 * it and the member's check-in. Coach-only: the member never sees it.
 */
export default function WeeklyBrief({ memberId }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = (fresh) => {
    setBusy(true);
    (fresh ? api.post(`/weekly/brief/${memberId}`, {}, { timeout: 60000 }) : api.get(`/weekly/brief/${memberId}`, { timeout: 60000 }))
      .then(({ data }) => setData(data)).catch(() => setData({ error: true })).finally(() => setBusy(false));
  };
  useEffect(() => { load(false); }, [memberId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;
  if (data.error || !data.brief) return <p className="text-caption text-mid" data-testid="brief-error">Could not load the weekly brief.</p>;
  const b = data.brief, f = b.facts || {}, ci = f.checkin;
  const qs = data.questions || [];
  const stat = (label, v) => (
    <div className="rounded-xl bg-white/[0.04] border border-hair px-2 py-1.5 text-center">
      <span className="block text-sm font-semibold text-white tabular-nums">{v}</span>
      <span className="block text-caption text-mid">{label}</span>
    </div>
  );
  const kg = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v} kg`);

  return (
    <div data-testid="weekly-brief">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <Eyebrow>Week brief · {formatDate(f.week_start)} – {formatDate(f.week_end)}</Eyebrow>
        <button type="button" onClick={() => { haptic(8); load(true); }} disabled={busy} style={{ minHeight: 36 }}
          className="text-caption font-semibold text-gold disabled:opacity-50" data-testid="brief-refresh">{busy ? 'Writing…' : 'Refresh'}</button>
      </div>
      <p className="text-sm text-white leading-relaxed whitespace-pre-line" data-testid="brief-text">{b.text}</p>
      <p className="text-caption text-lo mt-1">{b.source === 'ai' ? 'Written by the AI from the numbers below. Only you see this.' : 'The AI was unavailable: these are the numbers in plain words. Only you see this.'}</p>
      <div className="grid grid-cols-4 gap-1.5 mt-2" data-testid="brief-facts">
        {stat('days logged', `${f.days_logged ?? 0}/7`)}
        {stat('avg kcal', f.avg_kcal ?? '—')}
        {stat('weight', kg(f.weight_change))}
        {stat('workouts', f.workout_days ?? 0)}
      </div>
      <div className="mt-2" data-testid="brief-checkin">
        {ci ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {qs.map(q => ci.answers?.[q.key] ? (
                <span key={q.key} className={`text-caption rounded-full px-2.5 py-0.5 border ${(q.key === 'stress' ? ci.answers[q.key] >= 4 : ci.answers[q.key] <= 2) ? 'border-amber-400/50 text-amber-300' : 'border-white/[0.12] text-white'}`}>
                  {q.label} {ci.answers[q.key]}/5
                </span>
              ) : null)}
            </div>
            {ci.note && <p className="text-caption text-white mt-1.5">&ldquo;{ci.note}&rdquo;</p>}
          </>
        ) : <p className="text-caption text-mid">No check-in this week.</p>}
      </div>
    </div>
  );
}
