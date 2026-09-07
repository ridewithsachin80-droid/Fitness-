import { Sheet, Pressable, Eyebrow } from '../primitives';
import { SectionTitle } from '../UI';
import { haptic } from '../../store/settingsStore';
import { AUTO_TICK_IDS } from '../../lib/day';

/**
 * ProtocolSheet — the day's activities, ACV doses and supplements as chips.
 *
 * Behaviour carried over exactly from the inline panel:
 *   · tap ticks; long-press (or right-click) shows the item's timing/instructions
 *   · AUTO items (walk, resistance) tick from the Workout log and are read-only —
 *     tapping one explains why instead of doing nothing
 *   · the ACV "?" expands the why-ACV note
 * The popover renders INSIDE the sheet so it sits above the sheet's own layer.
 */
function Chip({ item, checked, onToggle, auto, m }) {
  const { setChipInfo, chipPressStart, chipPressEnd } = m;
  return (
    <button type="button"
      data-testid={`chip-${item.id}`}
      aria-pressed={checked}
      onClick={() => {
        if (auto) {
          setChipInfo({
            label: item.label,
            sub: item.id === 'resistance'
              ? 'Ticks automatically when you log sets in the Workout log.'
              : 'Ticks automatically when you log a walk or run in the Workout log.',
          });
          haptic(10);
          return;
        }
        onToggle(!checked); haptic(12);
      }}
      onTouchStart={() => chipPressStart(item)}
      onTouchEnd={chipPressEnd}
      onTouchMove={chipPressEnd}
      onContextMenu={e => { e.preventDefault(); if (item.sub) setChipInfo({ label: item.label, sub: item.sub }); }}
      title={item.sub || ''}
      style={{ minHeight: 40 }}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all active:scale-95 ${
        checked ? 'bg-gold/[0.16] border-gold/50 text-white'
        : auto  ? 'bg-white/[0.02] border-dashed border-white/[0.14] text-lo'
        : 'bg-white/[0.03] border-white/[0.12] text-mid'}`}>
      <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-extrabold flex-shrink-0 ${
        checked ? 'bg-gold text-charcoal' : 'bg-white/[0.08] text-transparent'}`}>✓</span>
      {item.icon ? `${item.icon} ` : ''}{item.label}
      {auto && <span className="text-tiny font-bold text-gold-light opacity-80">AUTO</span>}
    </button>
  );
}

export default function ProtocolSheet({ open, onClose, m }) {
  const { log, update, terms, activeActivities, activeACV, activeSupplements,
          actDone, acvDone, suppDone, protocolDone, protocolTotal,
          acvExpanded, setAcvExpanded, chipInfo, setChipInfo, loading } = m;
  return (
    <Sheet open={open && !loading} onClose={onClose} eyebrow="Today's protocol" title={`${protocolDone} of ${protocolTotal} done`}
      footer={<Pressable variant="primary" className="w-full" onPress={onClose}>Done</Pressable>}>
      <p className="text-eyebrow text-lo mb-3">Tap to mark done · long-press for timing · AUTO items tick from your Workout log</p>

      {activeActivities.length > 0 && (
        <div className="mb-4">
          <Eyebrow className="mb-2">{terms.activities} · {actDone}/{activeActivities.length}</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {activeActivities.map(a => (
              <Chip key={a.id} item={a} m={m} auto={AUTO_TICK_IDS.includes(a.id)}
                checked={!!log.activities?.[a.id]}
                onToggle={v => update('activities', { ...log.activities, [a.id]: v })} />
            ))}
          </div>
        </div>
      )}

      {activeACV.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <Eyebrow>ACV · {acvDone}/{activeACV.length}</Eyebrow>
            <button type="button" onClick={() => setAcvExpanded(v => !v)} className="text-eyebrow text-gold font-bold" style={{ minHeight: 28 }}>
              {acvExpanded ? 'Hide' : 'Why ACV?'}
            </button>
          </div>
          {acvExpanded && (
            <div className="mb-2 bg-gold/[0.08] border border-gold/15 rounded-xl px-3 py-2.5 text-xs text-mid leading-relaxed">
              <strong className="text-gold-light">Why ACV?</strong> 1 tbsp in 200ml warm water, through a straw, 15 min before meals — helps stabilise blood sugar, supports digestion, and may reduce appetite.
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {activeACV.map(a => (
              <Chip key={a.id} item={a} m={m} checked={!!log.acv?.[a.id]}
                onToggle={v => update('acv', { ...log.acv, [a.id]: v })} />
            ))}
          </div>
        </div>
      )}

      {activeSupplements.length > 0 && (
        <div>
          <div className="mb-2">
            <SectionTitle tooltip="These supplements are prescribed by your coach. They are not medical advice — always check with your doctor if you take other medications.">
              <span className="text-eyebrow font-semibold uppercase tracking-widest text-lo">{terms.supplements} · {suppDone}/{activeSupplements.length}</span>
            </SectionTitle>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {activeSupplements.map(s => (
              <Chip key={s.id} item={s} m={m} checked={!!log.supplements?.[s.id]}
                onToggle={v => update('supplements', { ...log.supplements, [s.id]: v })} />
            ))}
          </div>
        </div>
      )}

      {chipInfo && (
        <div role="status" onClick={() => setChipInfo(null)} data-testid="chip-info"
          className="sticky bottom-2 mt-4 bg-surface border border-gold/40 rounded-2xl px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.7)]">
          <p className="text-sm font-bold text-white">{chipInfo.label}</p>
          <p className="text-xs text-mid mt-0.5 leading-relaxed">{chipInfo.sub}</p>
        </div>
      )}
    </Sheet>
  );
}
