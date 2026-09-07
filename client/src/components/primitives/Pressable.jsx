import { haptic } from '../../store/settingsStore';

/**
 * Pressable — a button that feels like a button on a phone.
 *
 * Every interactive element gets the same three things: a 44px minimum hit
 * area, a tiny scale-down under the thumb, and a haptic tick. These were
 * hand-written on ~200 buttons with slightly different values each time.
 *
 *   <Pressable variant="primary" onPress={save}>Save</Pressable>
 *   <Pressable variant="ghost"   onPress={close}><Icon name="close" /></Pressable>
 *
 * variants: primary (gold, dark text) · secondary (surface, hairline) ·
 *           ghost (no chrome) · danger (red text) · gold-text
 */
const VARIANTS = {
  primary:   'bg-gold text-charcoal font-semibold rounded-2xl px-4 shadow-sm',
  secondary: 'bg-surface text-white font-medium rounded-2xl px-4 border border-hair-med',
  ghost:     'bg-transparent text-mid rounded-xl px-2',
  danger:    'bg-red-400/[0.08] text-red-400 font-medium rounded-2xl px-4 border border-red-400/25',
  'gold-text': 'bg-transparent text-gold font-semibold rounded-xl px-2',
};

export default function Pressable({
  children, onPress, variant = 'secondary', className = '', disabled = false,
  hapticMs = 12, minHeight = 44, type = 'button', ...rest
}) {
  const handle = (e) => {
    if (disabled) return;
    haptic(hapticMs);
    onPress?.(e);
  };
  return (
    <button
      type={type} onClick={handle} disabled={disabled}
      style={{ minHeight }}
      className={`inline-flex items-center justify-center gap-2 select-none
        transition-transform duration-150 active:scale-[0.97]
        disabled:opacity-40 disabled:active:scale-100
        ${VARIANTS[variant] || VARIANTS.secondary} ${className}`}
      {...rest}>
      {children}
    </button>
  );
}
