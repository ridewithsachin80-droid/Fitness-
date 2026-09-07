import { motion, useReducedMotion } from 'motion/react';
import { haptic } from '../../store/settingsStore';

/**
 * Segmented — a pill tab control with a sliding indicator.
 *
 *   <Segmented value={tab} onChange={setTab}
 *     options={[{ id: '7', label: '7d' }, { id: '30', label: '30d' }, { id: '90', label: '90d' }]} />
 *
 * The gold pill slides between options (motion `layoutId`) rather than
 * jumping, so the eye follows the choice. Works with any number of options;
 * they share the width equally. Keyboard: arrow keys move the selection.
 */
export default function Segmented({ options = [], value, onChange, size = 'md', className = '', name = 'segmented' }) {
  const reduce = useReducedMotion();
  const pad = size === 'sm' ? 'py-1.5 text-caption' : 'py-2 text-note';

  const move = (dir) => {
    const i = options.findIndex(o => o.id === value);
    const next = options[(i + dir + options.length) % options.length];
    if (next) { haptic(10); onChange?.(next.id); }
  };

  return (
    <div
      role="tablist" aria-label={name}
      className={`relative flex rounded-full bg-white/[0.04] border border-hair p-1 ${className}`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); move(-1); }
      }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id} type="button" role="tab" aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => { if (!active) { haptic(10); onChange?.(o.id); } }}
            style={{ minHeight: size === 'sm' ? 32 : 38 }}
            className={`relative flex-1 min-w-0 rounded-full font-semibold whitespace-nowrap px-3 ${pad}
              transition-colors duration-200 ${active ? 'text-charcoal' : 'text-mid'}`}>
            {active && (
              <motion.span
                layoutId={`${name}-indicator`}
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }}
                className="absolute inset-0 rounded-full bg-gold shadow-sm"
                aria-hidden="true" />
            )}
            <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
              {o.icon}{o.label}
              {o.count != null && (
                <span className={`text-tiny tabular-nums rounded-full px-1.5 py-px ${active ? 'bg-charcoal/15' : 'bg-white/[0.08]'}`}>{o.count}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
