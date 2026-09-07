import { Icon } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { plural } from '../../constants';

/**
 * DayStrip — the day at a glance, as a horizontal row of chips.
 *
 *   Food 1,240 / 1,800 · Water 1.5 L · Sleep 7h 10m · Workout Push · Mon · Nutrition 19/31
 *
 * Each chip is a door to its sheet. The strip SCROLLS sideways inside its own
 * box (`overflow-x-auto` on the strip, `flex-shrink-0` on the chips); the page
 * never widens — that rule is asserted in test-layout-contracts.
 */
function Chip({ icon, value, unit, label, onPress, active, tone = 'default', testId }) {
  return (
    <button type="button" onClick={() => { haptic(10); onPress?.(); }} data-testid={testId}
      className={`flex-shrink-0 snap-start text-left rounded-2xl px-3.5 py-2.5 border min-w-[128px] transition-all active:scale-[0.98] ${
        active ? 'bg-gold/[0.14] border-gold/45' : 'bg-white/[0.04] border-hair'}`}>
      <span className={`flex items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-widest ${tone === 'quiet' ? 'text-lo' : 'text-mute'}`}>
        <Icon name={icon} size={13} />{label}
      </span>
      <span className={`block font-display text-num-sm font-semibold leading-tight tracking-tight mt-1 tabular-nums ${tone === 'quiet' ? 'text-lo' : 'text-white'}`}>
        {value}{unit && <span className="text-caption text-lo font-sans font-medium"> {unit}</span>}
      </span>
    </button>
  );
}

export default function DayStrip({ m, onOpen }) {
  const { log, protocol, kcalIn, kcalTarget, workoutKcal, coachPlan, micro, sleepText, terms, sheet } = m;
  const waterL  = ((log.water || 0) / 1000).toFixed(1);
  const targetL = ((protocol?.water_target || 3000) / 1000).toFixed(1);

  const workoutValue = workoutKcal > 0 ? workoutKcal
    : coachPlan?.todayDay ? coachPlan.todayDay.day_label
    : '—';
  const workoutUnit = workoutKcal > 0 ? 'kcal burned'
    : coachPlan?.todayDay ? `${coachPlan.todayDay.exercises.length} ${plural(coachPlan.todayDay.exercises.length, 'exercise')}`
    : 'none yet';

  return (
    <div className="-mx-4 px-4 flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 [scrollbar-width:none]" data-testid="day-strip">
      <Chip icon="food" testId="chip-food" label="Food" active={sheet === 'food'} onPress={() => onOpen('food')}
        value={kcalIn.toLocaleString('en-IN')} unit={kcalTarget ? `/ ${kcalTarget.toLocaleString('en-IN')} ${terms.kcal}` : terms.kcal}
        tone={kcalIn ? 'default' : 'quiet'} />
      <Chip icon="drop" testId="chip-water" label="Water" active={sheet === 'water'} onPress={() => onOpen('water')}
        value={waterL} unit={`/ ${targetL} L`} tone={(log.water || 0) > 0 ? 'default' : 'quiet'} />
      <Chip icon="moon" testId="chip-sleep" label={terms.sleep} active={sheet === 'sleep'} onPress={() => onOpen('sleep')}
        value={sleepText || '—'} unit={sleepText ? '' : 'set times'} tone={sleepText ? 'default' : 'quiet'} />
      <Chip icon="dumbbell" testId="chip-workout" label="Workout" active={sheet === 'workout'} onPress={() => onOpen('workout')}
        value={workoutValue} unit={workoutUnit} tone={workoutValue === '—' ? 'quiet' : 'default'} />
      <Chip icon="pill" testId="chip-nutrition" label="Nutrition" active={sheet === 'nutrition'} onPress={() => onOpen('nutrition')}
        value={micro.hasData ? `${micro.met} / ${micro.total}` : '—'} unit={micro.hasData ? 'targets met' : 'log food first'}
        tone={micro.hasData ? 'default' : 'quiet'} />
    </div>
  );
}
