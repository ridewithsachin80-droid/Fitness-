import { useEffect, useState } from 'react';
import api from '../../api/client';
import { haptic } from '../../store/settingsStore';
import { whatsappLink } from '../../utils/personalMessage';
import { firstName } from '../../utils/personName';
import { Icon } from '../primitives';

/**
 * OffPlanFeed — Phase 3: meals a member logged from a plate photo that went
 * off plan today. Only meals whose extras came to more than 100 kcal, or a
 * different meal eaten instead, reach this list (services/platePhoto.js). A
 * photo that matched the plan logs quietly and never shows here.
 *
 * The photo opens through a link that expires after 5 minutes; a card with no
 * photo (storage was down, or the photo is past its 90 days) shows a plate.
 */
export function draftForExtra(it) {
  const n = firstName(it.name);
  const what = (it.extras || []).map(e => e.name.toLowerCase()).slice(0, 2).join(' and ');
  return it.outcome === 'swap'
    ? `Hi ${n}, saw your ${it.meal} today was different from the plan. All good? Tell me if the plan needs a change.`
    : `Hi ${n}, saw the ${what || 'extra'} with ${it.meal}. No stress, just keep the next meal to plan 👍`;
}

export default function OffPlanFeed({ active, onCount, onOpen }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    // Never blocks the coach home: no photos, or an older server, is an empty tab.
    api.get('/plate/off-plan').then(({ data }) => setItems(Array.isArray(data?.items) ? data.items : [])).catch(() => {});
  }, []);
  useEffect(() => { onCount?.(items.length); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSeen = (it) => {
    setItems(list => list.filter(x => x.id !== it.id));
    api.post(`/plate/${it.id}/seen`).catch(() => {});
  };
  if (!active) return null;
  if (!items.length) {
    return <p className="text-sm text-mid py-4" data-testid="offplan-empty">Nothing off plan today. Photos that matched the plan logged quietly.</p>;
  }
  return (
    <div className="space-y-2.5 py-2" data-testid="offplan-feed">
      {items.map(it => (
        <div key={it.id} className="rounded-2xl border border-amber-400/40 bg-white/[0.02] p-3 flex gap-3" data-testid="offplan-card">
          <a href={it.photo_url || undefined} target="_blank" rel="noopener noreferrer" aria-label={`Plate photo, ${it.name}, ${it.meal}`}
            className="w-[72px] h-[72px] rounded-xl overflow-hidden bg-charcoal border border-hair flex items-center justify-center flex-shrink-0">
            {it.photo_url ? <img src={it.photo_url} alt="" className="w-full h-full object-cover" /> : <Icon name="food" size={22} className="text-mid" />}
          </a>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <button type="button" onClick={() => onOpen(it)} className="text-sm font-semibold text-white truncate text-left">{it.name}</button>
              <span className="text-caption text-mid whitespace-nowrap">
                {new Date(it.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
              </span>
            </div>
            <p className="text-caption font-semibold uppercase tracking-wider text-amber-300 mt-0.5">
              {it.meal} · {it.outcome === 'swap' ? 'different meal' : 'photo'}
            </p>
            <p className="text-sm text-white leading-snug mt-1" data-testid="offplan-extras">
              {it.outcome === 'swap' ? 'Ate instead: ' : 'Extra: '}
              {(it.extras || []).map(e => `${e.name}, about ${e.grams} g`).join('; ')} · {it.extras_kcal} kcal
            </p>
            {(it.differences || []).length > 0 && <p className="text-caption text-mid leading-snug mt-0.5">{it.differences.join(' · ')}</p>}
            <p className="text-caption text-mid mt-1">
              Day so far {Number(it.day_kcal || 0).toLocaleString('en-IN')}{it.target_kcal ? ` of ${Number(it.target_kcal).toLocaleString('en-IN')}` : ''} kcal
            </p>
            <div className="flex gap-2 mt-2">
              <button type="button" style={{ minHeight: 44 }} data-testid="offplan-message"
                onClick={() => { haptic(10); const url = it.phone && whatsappLink(it.phone, draftForExtra(it)); url ? window.open(url, '_blank', 'noopener') : onOpen(it); }}
                className="flex-1 rounded-xl border border-gold text-gold text-caption font-bold px-2">
                Message
              </button>
              <button type="button" style={{ minHeight: 44 }} data-testid="offplan-seen" onClick={() => { haptic(8); onSeen(it); }}
                className="flex-1 rounded-xl border border-white/[0.12] text-white text-caption font-semibold">Seen</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
