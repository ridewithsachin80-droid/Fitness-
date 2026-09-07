import { Icon } from '../primitives';
import { haptic } from '../../store/settingsStore';

/**
 * AIRead — "Today's read": one coaching sentence written from the day's own
 * numbers (utils/dailyRead.js). This is what makes the app feel like it
 * already looked at your day rather than waiting to be asked.
 *
 * Tapping it opens the AI chat, because the natural next move after reading
 * "protein's behind" is to say what you're about to eat.
 */
export default function AIRead({ read, action, onOpenChat, onOpen }) {
  if (!read) return null;
  const win = read.tone === 'win';
  return (
    <button type="button" onClick={() => { haptic(10); onOpenChat?.(); }}
      data-testid="ai-read"
      className={`w-full text-left rounded-2xl px-4 py-3 border transition-transform active:scale-[0.99] ${
        win ? 'bg-gold/10 border-gold/40' : 'bg-gold/5 border-gold/[0.24]'}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full bg-gold/[0.14] text-gold flex items-center justify-center">
          <Icon name="spark" size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-eyebrow font-semibold uppercase tracking-widest text-gold-deep">Today's read</span>
          <span className="block text-body-sm text-white leading-relaxed mt-0.5">{read.text}</span>
        </span>
        <Icon name="chevron-right" size={16} className="text-lo flex-shrink-0 mt-2" />
      </div>
      {action && (
        <span role="button" tabIndex={0} data-testid="read-action"
          onClick={(e) => { e.stopPropagation(); haptic(10); onOpen?.(action.sheet); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpen?.(action.sheet); } }}
          className="mt-3 ml-10 inline-flex items-center gap-1 text-caption font-bold text-charcoal bg-gold rounded-full px-3 py-1.5 active:scale-95 transition-transform">
          {action.label} <Icon name="arrow-right" size={12} />
        </span>
      )}
    </button>
  );
}
