import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { Eyebrow } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { formatDate } from '../../constants';
import { POSES } from './ProgressPhotoSheet';
import ProgressPhotoSheet from './ProgressPhotoSheet';

/**
 * ProgressPhotos — two weeks side by side, one pose at a time. Starts on the
 * first week and the latest, which is the comparison people want. Used on the
 * member's Progress page and, read-only, on the coach's member page.
 *
 * memberId set = the coach's view (GET /progress-photos/member/:id).
 */
export default function ProgressPhotos({ memberId = null }) {
  const coach = memberId != null;
  const [data, setData] = useState(null);
  const [pose, setPose] = useState('front');
  const [pick, setPick] = useState({ a: null, b: null });
  const [open, setOpen] = useState(false);
  const load = () => api.get(coach ? `/progress-photos/member/${memberId}` : '/progress-photos/me')
    .then(({ data }) => setData(data)).catch(() => setData({ weeks: [], error: true }));
  useEffect(() => { load(); }, [memberId]); // eslint-disable-line react-hooks/exhaustive-deps

  const weeks = useMemo(() => (data?.weeks || []).filter(w => Object.keys(w.photos).length), [data]);
  const a = pick.a ?? weeks[weeks.length - 1]?.week;     // oldest
  const b = pick.b ?? weeks[0]?.week;                    // newest
  const photo = (week) => weeks.find(w => w.week === week)?.photos?.[pose];

  if (!data) return null;
  const select = (side, value) => (
    <select value={value || ''} onChange={e => setPick(p => ({ ...p, [side]: e.target.value }))} aria-label={side === 'a' ? 'Earlier week' : 'Later week'}
      className="w-full bg-charcoal border border-white/[0.12] rounded-xl text-caption text-white px-2" style={{ minHeight: 40 }}>
      {weeks.map(w => <option key={w.week} value={w.week}>{formatDate(w.week)}</option>)}
    </select>
  );

  return (
    <div data-testid="pp-compare">
      <div className="flex items-baseline justify-between mb-2">
        <Eyebrow>Progress photos</Eyebrow>
        {!coach && <button type="button" onClick={() => { haptic(8); setOpen(true); }} className="text-caption font-semibold text-gold" style={{ minHeight: 36 }} data-testid="pp-open">This week ›</button>}
      </div>
      {weeks.length === 0 ? (
        <p className="text-caption text-mid" data-testid="pp-empty">
          {data.error ? 'Could not load photos.' : coach ? 'No progress photos yet.' : 'No photos yet. On Sunday, take front, side and back: in a few weeks you will see what the scale does not show.'}
        </p>
      ) : (
        <>
          <div className="flex gap-1.5 mb-2" role="tablist" aria-label="Pose">
            {POSES.map(p => (
              <button key={p.key} type="button" role="tab" aria-selected={pose === p.key} onClick={() => setPose(p.key)} style={{ minHeight: 36 }}
                className={`text-caption font-semibold rounded-full px-3 border ${pose === p.key ? 'border-gold text-gold' : 'border-white/[0.12] text-mid'}`}>{p.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[['a', a], ['b', b]].map(([side, week]) => {
              const ph = photo(week);
              return (
                <div key={side} className="space-y-1.5">
                  <div className="aspect-[3/5] rounded-2xl bg-charcoal border border-hair overflow-hidden flex items-center justify-center" data-testid={`pp-side-${side}`}>
                    {ph?.url ? <img src={ph.url} alt={`${pose} photo, week of ${formatDate(week)}`} className="w-full h-full object-cover" />
                      : <span className="text-caption text-lo px-2 text-center">No {pose} photo that week</span>}
                  </div>
                  {weeks.length > 1 ? select(side, week) : <p className="text-caption text-mid text-center">{formatDate(week)}</p>}
                </div>
              );
            })}
          </div>
          <p className="text-caption text-lo mt-2">Private to {coach ? 'the member and you' : 'you and your coach'}. Deleted after 12 months.</p>
        </>
      )}
      {!coach && <ProgressPhotoSheet open={open} onClose={() => setOpen(false)} onChanged={load} />}
    </div>
  );
}
