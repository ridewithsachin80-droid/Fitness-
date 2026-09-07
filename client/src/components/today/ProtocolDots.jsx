import { haptic } from '../../store/settingsStore';
import { AUTO_TICK_IDS } from '../../lib/day';

/**
 * ProtocolDots — one dot per protocol item, filled when done.
 *
 * Replaces the compliance ring + "4 of 7 done" + seven equal tiles. A row of
 * dots says the same thing at a glance and, unlike a percentage, shows WHICH
 * ones are left. Tapping anywhere opens the protocol sheet.
 *
 * Order: activities, then ACV, then supplements — the order the sheet lists
 * them in, so the third dot is always the same item.
 */
export default function ProtocolDots({ activeActivities = [], activeACV = [], activeSupplements = [], log = {}, done, total, terms, onOpen }) {
  const items = [
    ...activeActivities.map(a => ({ id: 'a:' + a.id, label: a.label, on: !!log.activities?.[a.id], auto: AUTO_TICK_IDS.includes(a.id) })),
    ...activeACV.map(a => ({ id: 'v:' + a.id, label: a.label, on: !!log.acv?.[a.id] })),
    ...activeSupplements.map(s => ({ id: 's:' + s.id, label: s.label, on: !!log.supplements?.[s.id] })),
  ];
  if (!items.length) return null;
  const allDone = done === total && total > 0;

  return (
    <button type="button" onClick={() => { haptic(10); onOpen?.(); }}
      data-testid="protocol-dots"
      aria-label={`Protocol: ${done} of ${total} done. Open protocol.`}
      className="w-full text-left rounded-2xl px-4 py-3 bg-white/[0.04] border border-hair active:scale-[0.99] transition-transform">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" aria-hidden="true">
          {items.map(it => (
            <span key={it.id} title={it.label}
              className={`block w-3 h-3 rounded-full transition-colors ${
                it.on ? 'bg-gold shadow-[0_0_8px_rgba(212,175,55,0.45)]'
                : it.auto ? 'border border-dashed border-white/25'
                : 'bg-white/[0.10]'}`} />
          ))}
        </div>
        <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${allDone ? 'text-gold-light' : 'text-white'}`}>
          {done} of {total} done
        </span>
      </div>
      <p className="text-caption text-mute mt-1.5">
        {allDone ? 'Protocol complete for today.'
          : `${terms?.activities || 'Activities'}, ACV and ${(terms?.supplements || 'supplements').toLowerCase()} · tap to tick`}
      </p>
    </button>
  );
}
