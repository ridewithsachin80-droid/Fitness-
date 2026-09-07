import { formatDate } from '../../constants';
import { Icon } from '../primitives';
import { haptic } from '../../store/settingsStore';

/**
 * DateNav — ‹ Today ›, with "Editing past entry" and a direct way back.
 *
 * The arrows are a matched pair: '›' steps forward ONE day (it used to jump
 * straight to today, which threw a member fixing day −5 who then wanted day
 * −4 back to the present). "Jump to today" is the shortcut, shown only when
 * you are not on today.
 */
export default function DateNav({ date, isToday, onPrev, onNext, onToday }) {
  return (
    <div className="mt-4" data-testid="date-nav">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => { haptic(8); onPrev(); }} aria-label="Previous day"
          style={{ minWidth: 44, minHeight: 40 }}
          className="flex items-center justify-center text-lo rounded-xl hover:bg-white/[0.05] active:scale-95 transition-all">
          <Icon name="chevron-left" size={18} />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-white" data-testid="date-label">{isToday ? 'Today' : formatDate(date)}</p>
          {!isToday && <p className="text-eyebrow text-amber-400 font-medium mt-0.5">Editing past entry</p>}
        </div>
        <button type="button" onClick={() => { haptic(8); onNext(); }} disabled={isToday} aria-label="Next day"
          style={{ minWidth: 44, minHeight: 40 }}
          className="flex items-center justify-center text-gold-deep rounded-xl hover:bg-gold/5 active:scale-95 transition-all disabled:opacity-30">
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
      {!isToday && (
        <button type="button" onClick={() => { haptic(8); onToday(); }} style={{ minHeight: 32 }}
          className="w-full text-caption font-semibold text-gold">
          Jump to today
        </button>
      )}
    </div>
  );
}
