import { anyRow } from '../../utils/coachCard';
import { Icon, Eyebrow } from '../primitives';
import { haptic } from '../../store/settingsStore';

/**
 * CoachCard — "From your coach today". PENDING items only: the workout until
 * the first set or cardio is logged, each meal plan until its first item is
 * logged, the targets until any food is logged; a rest-day line only for
 * weekday-scheduled programs. The rules live in utils/coachCard.js.
 *
 * Rows open the sheet where the thing gets done.
 */
function Line({ icon, title, sub, cta, onPress, first }) {
  const inner = (
    <>
      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-gold/[0.12] text-gold flex items-center justify-center mt-0.5">
        <Icon name={icon} size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{title}</span>
        {sub && <span className="block text-caption text-mid truncate">{sub}</span>}
      </span>
      {cta && <span className="text-caption font-bold text-gold flex-shrink-0 mt-1.5">{cta} ›</span>}
    </>
  );
  const cls = `w-full text-left flex items-start gap-3 py-2 ${first ? '' : 'border-t border-hair mt-1 pt-3'}`;
  return onPress
    ? <button type="button" onClick={() => { haptic(10); onPress(); }} className={cls}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}

export default function CoachCard({ rows, coachPlan, protocol, onOpen }) {
  if (!rows || !anyRow(rows)) return null;
  const { workout: showWorkout, rest: showRest, targets: showTargets, pendingMeals = [] } = rows;
  let first = true;
  const take = () => { const f = first; first = false; return f; };

  return (
    <section className="rounded-2xl border border-gold/25 bg-surface px-4 py-3" data-testid="coach-card">
      <Eyebrow tone="gold" className="mb-1">From your coach today</Eyebrow>
      {showWorkout && (
        <Line first={take()} icon="dumbbell" cta="Start" onPress={() => onOpen('workout')}
          title={`${coachPlan.todayDay.day_label} — ${coachPlan.todayDay.exercises.length} exercises`}
          sub={coachPlan.todayDay.exercises.slice(0, 3).map(e => e.exercise_name).join(' · ')
            + (coachPlan.todayDay.exercises.length > 3 ? ` +${coachPlan.todayDay.exercises.length - 3} more` : '')} />
      )}
      {!showWorkout && showRest && (
        <Line first={take()} icon="moon" title={`Rest day on ${coachPlan.programName}`} sub="Recovery counts. Walk, water, sleep." />
      )}
      {pendingMeals.map(mp => {
        const kcal = Math.round((mp.items || []).reduce((a, it) => a + ((it.per_100g?.calories || 0) * (it.grams || 0) / 100), 0));
        return (
          <Line key={mp.meal} first={take()} icon="food" cta="Log" onPress={() => onOpen('food')}
            title={`${mp.meal} plan — ${(mp.items || []).length} items · ~${kcal} kcal`}
            sub={(mp.items || []).slice(0, 3).map(it => it.name).join(' · ') + ((mp.items || []).length > 3 ? ` +${(mp.items || []).length - 3} more` : '')} />
        );
      })}
      {showTargets && (
        <Line first={take()} icon="trend" cta="Log" onPress={() => onOpen('food')}
          title="Eat to today's targets"
          sub={`${protocol.macros.kcal} kcal${protocol.macros.pro ? ` · ${protocol.macros.pro}g protein` : ''}${protocol.macros.carb ? ` · ${protocol.macros.carb}g carbs` : ''}${protocol.macros.fat ? ` · ${protocol.macros.fat}g fat` : ''}`} />
      )}
    </section>
  );
}
