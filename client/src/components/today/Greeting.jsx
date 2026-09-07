import { firstName } from '../../utils/personName';
import NotificationBell from '../NotificationBell';
import { formatDate } from '../../constants';

/**
 * Greeting — the top line of Today.
 *
 * Time-of-day greeting in Fraunces with the member's avatar, the streak badge
 * and the notification bell on the right. Save feedback ("auto-saved ✓",
 * "saved on this phone · will sync", or the error) sits directly under the
 * greeting, next to where the member is editing — the old page rendered the
 * error 1,900 lines further down, below every panel, so a failed save looked
 * like nothing had happened.
 */
export function greetingFor(hour) {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Greeting({ user, avatar, autoSaved, queued, error, streak, streakIsBest, isToday, weekNumber, date, now = new Date() }) {
  const dateLine = isToday
    ? now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
    : formatDate(date);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-num font-medium leading-tight text-white flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className="text-2xl leading-none flex-shrink-0">{avatar}</span>
          <span className="min-w-0 break-words">{greetingFor(now.getHours())}, {firstName(user?.name)}</span>
        </h1>
        <p className="text-sm text-mid mt-1" data-testid="date-line">
          {dateLine}{weekNumber ? <span className="text-lo"> · Week {weekNumber}</span> : null}
          {isToday && streak >= 2 && (
            <span className="text-lo whitespace-nowrap" data-testid="streak-badge"> · <span className="text-gold-deep font-semibold tabular-nums">{streak}</span>-day streak</span>
          )}
        </p>
        {autoSaved && !queued && <p className="text-xs text-gold-light mt-1 font-medium" data-testid="save-status"><span className="autosave-dot" />auto-saved ✓</p>}
        {autoSaved && queued && <p className="text-xs text-mid mt-1 font-medium" data-testid="save-status">saved on this phone · will sync</p>}
        {error && <p className="text-xs text-red-400 mt-1 font-medium" role="alert" data-testid="save-status">{error}</p>}
      </div>
      <div className="flex-shrink-0 pt-1">
        <NotificationBell />
      </div>
    </div>
  );
}
