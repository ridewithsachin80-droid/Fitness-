import { firstName } from '../../utils/personName';
import NotificationBell from '../NotificationBell';
import { Eyebrow } from '../primitives';

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

export default function Greeting({ user, avatar, autoSaved, queued, error, streak, streakIsBest, isToday, now = new Date() }) {
  const badge = isToday && streak >= 2 ? (
    <span className="inline-flex items-center gap-1 text-eyebrow font-bold text-gold bg-gold/10 border border-gold/[0.28] rounded-full px-2.5 py-1 whitespace-nowrap"
      data-testid="streak-badge">
      {streak} {streak === 1 ? 'day' : 'days'}{streakIsBest && streak >= 3 ? ' · best this month' : ''}
    </span>
  ) : null;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <Eyebrow tone="gold">FitLife</Eyebrow>
        <h1 className="font-display text-num font-medium leading-tight text-white mt-1 flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className="text-2xl leading-none flex-shrink-0">{avatar}</span>
          <span className="min-w-0 break-words">{greetingFor(now.getHours())}, {firstName(user?.name)}</span>
        </h1>
        {(badge || (autoSaved && !queued) || (autoSaved && queued) || error) && (
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {badge}
            {autoSaved && !queued && (
              <p className="text-xs text-gold-light font-medium" data-testid="save-status"><span className="autosave-dot" />auto-saved ✓</p>
            )}
            {autoSaved && queued && (
              <p className="text-xs text-mid font-medium" data-testid="save-status">saved on this phone · will sync</p>
            )}
            {error && (
              <p className="text-xs text-red-400 font-medium" role="alert" data-testid="save-status">{error}</p>
            )}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 pt-1">
        <NotificationBell />
      </div>
    </div>
  );
}
