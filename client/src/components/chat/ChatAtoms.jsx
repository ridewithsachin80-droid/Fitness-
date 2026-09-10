/**
 * components/chat/ChatAtoms.jsx — the small pieces the AI chat is built from
 * (Sprint 12). Layout constants, the composer's auto-grow, the suggestion
 * chips, and two tiny presentational atoms. No state, no fetches.
 */
// Bottom nav card (~64px) + its 12px pad + the orb lifted 22px above the card.
// Measured in UI.jsx (the nav's own spacer is 104px); the composer sits just
// above the orb's crown.
export const COMPOSER_BOTTOM_PX = 100;
export const COMPOSER_BOTTOM_FOCUSED_PX = 12;   // nav hidden while typing

// Grow the textarea to its content, capped by its max-height (5 lines).
export function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export const SUGGESTION_CHIPS = [
  'weight 82.5, morning walk done',
  '2 chapati, 1 bowl dal for lunch',
  'drank 1 litre water, took my supplements',
  'slept 10:30 to 6:30',
];

// ── Small UI atoms ───────────────────────────────────────────────────────────
export function GroupHeader({ icon, title, count }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span className="text-xs">{icon}</span>
      <span className="text-eyebrow font-bold text-mid tracking-widest">{title}</span>
      {count != null && <span className="text-eyebrow text-lo">· {count}</span>}
    </div>
  );
}

/** Tappable include/exclude chip — purple when included, dimmed when excluded */
export function ToggleChip({ on, onToggle, children }) {
  return (
    <button onClick={onToggle}
      style={{ minHeight: 36 }}
      className={`flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5 border transition-all active:scale-95 ${
        on
          ? 'bg-gold/[0.16] border-gold/45 text-white font-semibold'
          : 'bg-white/[0.03] border-white/[0.08] text-lo line-through'
      }`}>
      <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-tiny flex-shrink-0 ${
        on ? 'bg-gold text-charcoal' : 'bg-white/[0.08] text-transparent'
      }`}>✓</span>
      {children}
    </button>
  );
}

