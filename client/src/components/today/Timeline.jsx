import { groupByMeal } from '../../utils/coachView';
import { foodKcal } from '../../lib/day';
import { Icon, EmptyState, Stagger } from '../primitives';
import { haptic, useSettingsStore } from '../../store/settingsStore';
import { plural } from '../../constants';

/**
 * Timeline — what has been logged today, as a list the eye can read top to
 * bottom: weight, then each meal in the member's slot order, then the
 * workout, then water and sleep. Every row opens the sheet that edits it.
 *
 * Log entries carry no clock time (weight and foods are day-level fields;
 * meal slots are the member's own labels), so the order is the order of a
 * day, not timestamps. That is also why "Unsorted" foods — logged by the AI
 * with no slot — fall to the end of the meals rather than disappearing.
 *
 * Empty day → an invitation, not a dash.
 */
function Row({ icon, title, sub, value, onPress, testId, tone = 'default' }) {
  return (
    <button type="button" onClick={() => { haptic(10); onPress?.(); }} data-testid={testId}
      className="w-full text-left flex items-center gap-3 py-2.5 border-b border-hair last:border-b-0 active:bg-white/[0.03] transition-colors -mx-1 px-1 rounded-lg">
      <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        tone === 'gold' ? 'bg-gold/[0.12] text-gold' : 'bg-white/[0.05] text-mid'}`}>
        <Icon name={icon} size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white truncate">{title}</span>
        {sub && <span className="block text-caption text-mid truncate">{sub}</span>}
      </span>
      {value != null && <span className="text-sm font-display font-semibold tabular-nums text-white flex-shrink-0">{value}</span>}
      <Icon name="chevron-right" size={14} className="text-ghost flex-shrink-0" />
    </button>
  );
}

export default function Timeline({ m, onOpen, onOpenChat }) {
  const { log, workoutSummary, workoutKcal, sleepText, sleepMins, terms, isToday } = m;
  // The same slot list FoodLog and the AI logger use, so grouping agrees everywhere.
  const mealSlots = useSettingsStore(s => s.mealSlots);
  const rows = [];

  if (log.weight) {
    rows.push({ key: 'weight', icon: 'scale', tone: 'gold', title: 'Morning weight', value: `${log.weight} kg`, sheet: 'weight',
      sub: m.weightDelta == null ? null : m.weightDelta < 0 ? `↓ ${Math.abs(m.weightDelta).toFixed(1)} vs yesterday`
         : m.weightDelta > 0 ? `↑ ${m.weightDelta.toFixed(1)} vs yesterday` : 'same as yesterday' });
  }

  const meals = groupByMeal(log.food || [], mealSlots || []);
  for (const g of meals) {
    if (!g.items.length) continue;
    const kcal = foodKcal(g.items);
    rows.push({
      key: 'meal:' + g.meal, icon: 'food', title: g.meal, sheet: 'food',
      sub: g.items.slice(0, 3).map(f => f.name).join(' · ') + (g.items.length > 3 ? ` +${g.items.length - 3} more` : ''),
      value: kcal ? `${kcal.toLocaleString('en-IN')} ${terms.kcal}` : `${g.items.length} ${plural(g.items.length, 'item')}`,
    });
  }

  if (workoutSummary.count > 0 || (workoutSummary.cardio || []).length > 0) {
    const bits = [];
    if (workoutSummary.count) bits.push(`${workoutSummary.count} ${plural(workoutSummary.count, 'exercise')}`);
    if ((workoutSummary.cardio || []).length) bits.push(`${workoutSummary.cardio.length} cardio`);
    if (workoutSummary.duration) bits.push(`${workoutSummary.duration} min`);
    rows.push({ key: 'workout', icon: 'dumbbell', title: 'Workout', sub: bits.join(' · '), sheet: 'workout',
      value: workoutKcal > 0 ? `${workoutKcal} ${terms.kcal}` : null });
  }

  if ((log.water || 0) > 0) {
    rows.push({ key: 'water', icon: 'drop', title: 'Water', sheet: 'water',
      sub: `${Math.round((log.water || 0) / 250)} ${plural(Math.round((log.water || 0) / 250), 'glass', 'glasses')}`,
      value: `${((log.water || 0) / 1000).toFixed(1)} L` });
  }

  if (sleepText) {
    rows.push({ key: 'sleep', icon: 'moon', title: terms.sleep, sheet: 'sleep',
      sub: `${log.sleep.bedtime} → ${log.sleep.waketime}`, value: sleepText,
      tone: sleepMins >= 420 && sleepMins <= 540 ? 'gold' : 'default' });
  }

  if (!rows.length) {
    return (
      <EmptyState compact icon="spark"
        title={isToday ? 'Nothing logged yet' : 'Nothing was logged this day'}
        body={isToday ? "Tell me about your morning — weight, breakfast, a walk — and I'll fill this in." : 'Tap a chip above to add something.'}
        action={isToday ? { label: 'Log with AI', onPress: onOpenChat } : undefined} />
    );
  }

  return (
    <Stagger data-testid="timeline">
      {rows.map(r => (
        <Row key={r.key} icon={r.icon} tone={r.tone} title={r.title} sub={r.sub} value={r.value}
          testId={`row-${r.key.split(':')[0]}`} onPress={() => onOpen(r.sheet)} />
      ))}
    </Stagger>
  );
}
