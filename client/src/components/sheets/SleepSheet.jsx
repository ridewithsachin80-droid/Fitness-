import { Sheet, Pressable } from '../primitives';
import { sleepMinutes, sleepTone } from '../../lib/day';

export default function SleepSheet({ open, onClose, m }) {
  const { log, update, terms } = m;
  const mins = sleepMinutes(log.sleep?.bedtime, log.sleep?.waketime);
  const tone = sleepTone(mins);
  return (
    <Sheet open={open} onClose={onClose} eyebrow={terms.sleep} title="Target 10:00 PM → 6:30 AM (8 hrs)"
      footer={<Pressable variant="primary" className="w-full" onPress={onClose}>Done</Pressable>}>
      <div className="flex gap-2 pt-1">
        <div className="flex-1 min-w-0">
          <label className="block text-micro font-medium text-mute mb-1" htmlFor="sleep-bed">Bedtime</label>
          <input id="sleep-bed" type="time" value={log.sleep?.bedtime || ''} data-testid="sleep-bed"
            onChange={e => update('sleep', { ...log.sleep, bedtime: e.target.value })}
            style={{ minHeight: 48 }}
            className="w-full text-sm font-bold bg-surface border border-white/[0.12] rounded-xl px-2 text-white focus:outline-none focus:ring-2 focus:ring-gold/30" />
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-micro font-medium text-mute mb-1" htmlFor="sleep-wake">Wake time</label>
          <input id="sleep-wake" type="time" value={log.sleep?.waketime || ''} data-testid="sleep-wake"
            onChange={e => update('sleep', { ...log.sleep, waketime: e.target.value })}
            style={{ minHeight: 48 }}
            className="w-full text-sm font-bold bg-surface border border-white/[0.12] rounded-xl px-2 text-white focus:outline-none focus:ring-2 focus:ring-gold/30" />
        </div>
      </div>
      {mins != null && (
        <div data-testid="sleep-duration" className={`mt-3 text-center text-caption font-bold py-2 rounded-xl ${
          tone === 'great' ? 'bg-ok/10 text-gold-light' : tone === 'short' ? 'bg-amber-400/10 text-amber-300' : 'bg-white/[0.04] text-mid'}`}>
          {Math.floor(mins / 60)}h {mins % 60}m{tone === 'great' ? ' — great sleep' : tone === 'short' ? ' — try for 7+ hours' : ''}
        </div>
      )}
    </Sheet>
  );
}
