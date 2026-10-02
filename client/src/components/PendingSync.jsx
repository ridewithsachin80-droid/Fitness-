/**
 * PendingSync.jsx — tells the member when a log is on this phone but not yet
 * on the server.
 *
 * The offline queue (hooks/useOfflineQueue.js) has always worked. What it
 * never did was say anything. A member logging a gym session in a basement saw
 * "auto-saved ✓", walked out satisfied, and appeared on the coach's dashboard
 * as not-logged. Neither of them could tell why.
 *
 * Two states:
 *   · pending — normal. One line, calm, no action needed. It will sync.
 *   · stuck   — something has been waiting over 24h. Now it's worth saying so,
 *               with a retry, because silent forever is how data gets lost.
 *
 * Deliberately not a modal and not an error colour in the pending case. Being
 * offline in a gym is expected behaviour, not a failure.
 */

import { useEffect, useState, useCallback } from 'react';
import { getQueueStatus, onQueueChange, retryQueueNow, claimLegacyEntries, dismissLegacyEntries } from '../hooks/useOfflineQueue';
import { formatDate, plural } from '../constants';
import { haptic } from '../store/settingsStore';

export default function PendingSync() {
  const [status, setStatus]   = useState({ count: 0, stuck: false, exhausted: false, oldestDate: null, unclaimed: 0 });
  const [claiming, setClaiming] = useState(false);
  const [retrying, setRetry]  = useState(false);

  const refresh = useCallback(() => {
    getQueueStatus().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    // Re-read whenever something is queued or a sync pass finishes, rather
    // than polling IndexedDB on a timer.
    const off = onQueueChange(refresh);
    return off;
  }, [refresh]);

  const retry = async () => {
    haptic(15);
    setRetry(true);
    // retryQueueNow resets the attempt counters first — a queue that has hit
    // the retry cap would otherwise be skipped by the sync pass entirely.
    try { await retryQueueNow(); } catch (_) {}
    finally { setRetry(false); refresh(); }
  };

  // Entries queued before each one carried its member. They are never sent on
  // a guess — on a shared phone that guess could put one member's day on
  // another's record — so the member is asked. Only the count is shown, never
  // the contents: this card may be in front of someone the entry is not for.
  const claim = async (mine) => {
    haptic(15);
    setClaiming(true);
    try { await (mine ? claimLegacyEntries() : dismissLegacyEntries()); } catch (_) {}
    finally { setClaiming(false); refresh(); }
  };

  if (status.unclaimed > 0) {
    const n = status.unclaimed;
    return (
      <div className="rounded-xl px-3.5 py-2.5 border border-amber-400/30 bg-amber-400/[0.08]" data-testid="unclaimed-queue">
        <p className="text-xs font-semibold text-amber-300">
          {n} unsent {plural(n, 'day')} found on this phone
        </p>
        <p className="text-caption text-mid mt-0.5 leading-relaxed">
          Saved here before an app update and never sent. If you logged {n === 1 ? 'it' : 'them'}, send {n === 1 ? 'it' : 'them'} to your account.
        </p>
        <div className="mt-1.5 flex gap-2">
          <button onClick={() => claim(true)} disabled={claiming} style={{ minHeight: 36 }}
            className="text-caption font-bold text-charcoal bg-amber-300 hover:bg-amber-200
              disabled:opacity-50 rounded-lg px-3 transition-colors">
            {claiming ? 'Sending…' : 'Mine, send it'}
          </button>
          <button onClick={() => claim(false)} disabled={claiming} style={{ minHeight: 36 }}
            className="text-caption font-semibold text-mid border border-white/[0.12]
              disabled:opacity-50 rounded-lg px-3 transition-colors">
            Not mine
          </button>
        </div>
      </div>
    );
  }

  if (!status.count) return null;

  const label = status.count === 1
    ? '1 day waiting to sync'
    : `${status.count} ${plural(status.count, 'day')} waiting to sync`;

  if (status.stuck) {
    return (
      <div className="rounded-xl px-3.5 py-2.5 border border-amber-400/30 bg-amber-400/[0.08]">
        <p className="text-xs font-semibold text-amber-300">
          {label} — {status.exhausted ? "couldn't send" : `stuck since ${formatDate(status.oldestDate)}`}
        </p>
        <p className="text-caption text-mid mt-0.5 leading-relaxed">
          Your entries are safe on this phone, but your coach can't see them yet.
        </p>
        <button
          onClick={retry}
          disabled={retrying}
          style={{ minHeight: 36 }}
          className="mt-1.5 text-caption font-bold text-charcoal bg-amber-300 hover:bg-amber-200
            disabled:opacity-50 rounded-lg px-3 transition-colors">
          {retrying ? 'Trying…' : 'Try again now'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl px-3.5 py-2
      border border-white/[0.08] bg-white/[0.03]">
      <span className="w-1.5 h-1.5 rounded-full bg-gold flex-shrink-0
        animate-pulse" />
      <p className="text-caption text-mid leading-tight">
        {label} — saved on this phone, will send when you're back online.
      </p>
    </div>
  );
}
