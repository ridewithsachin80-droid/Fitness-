import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Icon, Eyebrow, SkeletonText } from '../primitives';

/**
 * MemberBrief — three lines a coach reads before scrolling (Sprint 9).
 *
 *   Today: weight 82.4 kg · 2 meals · 666 kcal · 37 g protein · water 1.5 L · protocol 3 ticked.
 *   Weight down 1.1 kg over 2 weeks · 8-day logging streak.
 *   Going well: 8-day streak, down 1.1 kg / 2 wk.
 *
 * Composed server-side by GET /members/:id/brief from the same rows the
 * Needs-attention feed uses, so the two never disagree. Re-fetches when
 * `refreshKey` changes (after the coach saves a log or a note).
 */
const TONE = {
  high:      { bar: 'bg-red-400',   text: 'text-red-400',   label: 'High priority' },
  attention: { bar: 'bg-amber-400', text: 'text-amber-300', label: 'Needs attention' },
  watch:     { bar: 'bg-gold',      text: 'text-gold-light', label: 'Watch' },
  ok:        { bar: 'bg-ok',        text: 'text-ok',        label: 'On track' },
};

export default function MemberBrief({ memberId, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!memberId) return;
    let alive = true;
    setError(false);
    api.get(`/members/${memberId}/brief`)
      .then(({ data }) => { if (alive) setData(data); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [memberId, refreshKey]);

  if (error) return null;                         // the page works without it
  const tone = TONE[data?.priority] || TONE.ok;
  const lines = Array.isArray(data?.brief) ? data.brief : [];

  return (
    <section data-testid="member-brief" data-priority={data?.priority || ''}
      className="rounded-2xl border border-hair bg-surface px-4 py-3 flex gap-3">
      <span className={`w-1 rounded-full flex-shrink-0 ${data ? tone.bar : 'bg-white/[0.08]'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow tone="gold">Brief</Eyebrow>
          {data && <span className={`text-caption font-bold ${tone.text}`} data-testid="brief-priority">{tone.label}</span>}
        </div>
        {!data ? <SkeletonText lines={3} className="mt-2" /> : (
          <ol className="mt-1.5 space-y-1" data-testid="brief-lines">
            {lines.map((l, i) => (
              <li key={i} className="flex items-start gap-2 text-body-sm leading-snug text-white">
                <Icon name={i === 0 ? 'clock' : i === 1 ? 'trend' : 'spark'} size={13} className="text-mid flex-shrink-0 mt-1" />
                <span>{l}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
