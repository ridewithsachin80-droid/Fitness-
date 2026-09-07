import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';

/**
 * HeroNumber — the one number a screen is about, in Fraunces.
 *
 *   <HeroNumber value={82.4} unit="kg" delta={-0.3} deltaUnit="kg" label="vs yesterday" />
 *   <HeroNumber value={1240} of={1800} unit="kcal" size="md" />
 *   <HeroNumber value="—" unit="kg" placeholder />      // nothing logged yet
 *
 * When the value changes (a meal is logged, weight is entered) it counts from
 * the old figure to the new one over ~600ms. That is the difference between a
 * screen that updates and a screen that responds. Respects the phone's
 * reduce-motion setting: then it just changes.
 *
 * `decimals` defaults to the precision of the value passed in, so 82.4 stays
 * 82.4 and 1240 stays 1240 while animating.
 */
const SIZES = {
  lg: { num: 'text-[44px] leading-none', unit: 'text-base', delta: 'text-sm' },
  md: { num: 'text-num leading-none',    unit: 'text-sm',   delta: 'text-note' },
  sm: { num: 'text-num-sm leading-tight', unit: 'text-caption', delta: 'text-caption' },
};

function precisionOf(v) {
  const s = String(v);
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

export default function HeroNumber({
  value, unit, of, delta, deltaUnit = '', label, size = 'lg',
  decimals, placeholder = false, className = '', duration = 0.6,
}) {
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const dp = decimals ?? (numeric ? precisionOf(value) : 0);
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(numeric ? value : null);
  const prev = useRef(numeric ? value : null);

  useEffect(() => {
    if (!numeric) { setShown(null); prev.current = null; return undefined; }
    const from = prev.current;
    prev.current = value;
    if (from == null || reduce || from === value) { setShown(value); return undefined; }
    const controls = animate(from, value, {
      duration, ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(v),
      onComplete: () => setShown(value),
    });
    return () => controls.stop();
  }, [value, numeric, reduce, duration]);

  const s = SIZES[size] || SIZES.lg;
  const text = numeric
    ? (shown ?? value).toFixed(dp).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : (value ?? '—');

  const deltaTone = delta == null ? '' : delta < 0 ? 'text-gold-light' : delta > 0 ? 'text-amber-300' : 'text-mid';
  const deltaText = delta == null ? null
    : delta === 0 ? '= same'
    : `${delta < 0 ? '↓' : '↑'} ${Math.abs(delta).toFixed(precisionOf(delta))}${deltaUnit}`;

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className={`font-display font-semibold tabular-nums tracking-tight ${placeholder || !numeric ? 'text-lo' : 'text-white'} ${s.num}`}>
          {text}
        </span>
        {of != null && (
          <span className={`font-display text-lo tabular-nums ${s.unit}`}>/ {Number(of).toLocaleString('en-IN')}</span>
        )}
        {unit && <span className={`text-mid font-medium ${s.unit}`}>{unit}</span>}
      </div>
      {(deltaText || label) && (
        <div className={`mt-1 flex items-center gap-1.5 ${s.delta}`}>
          {deltaText && <span className={`font-semibold tabular-nums ${deltaTone}`}>{deltaText}</span>}
          {label && <span className="text-mute font-medium">{label}</span>}
        </div>
      )}
    </div>
  );
}
