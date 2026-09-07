import { Icon } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { plural } from '../../constants';

/**
 * DayStrip — the day at a glance. (The file keeps its Sprint 3 name; deploy
 * never renames files.)
 *
 *   ┌ Food ─────────┐ ┌ Water ────────┐
 *   │ 0 / 1,400 kcal │ │ 1.3 / 4.0 L   │
 *   │ ▬▬░░░░░░░░░░░  │ │ ▬▬▬░░░░░░░░░  │
 *   └───────────────┘ └───────────────┘
 *   ┌ Sleep ────────┐ ┌ Workout ──────┐
 *   └───────────────┘ └───────────────┘
 *   ┌ Nutrition · 19 / 31 targets met ▬▬▬▬░░ › ┐
 *
 * Sprint 4.1: this was a horizontal strip of five chips that scrolled
 * sideways. Members did not know there was a fourth and fifth tile — nothing
 * on screen said "swipe". Now every tile is visible at once: a two-column
 * grid, each tile with a thin progress bar so the state of the day reads
 * without any numbers, and Nutrition as one full-width row. The page never
 * scrolls sideways — asserted in test-layout-contracts and in real Chrome.
 *
 * Each tile is a door to its sheet.
 */
function Bar({ pct, tone = 'gold' }) {
  const w = Math.max(0, Math.min(100, pct || 0));
  const fill = tone === 'blue' ? 'bg-blue-400' : tone === 'ok' ? 'bg-ok' : 'bg-gold';
  return (
    <div className="h-1 rounded-full bg-white/[0.07] overflow-hidden mt-2.5" aria-hidden="true">
      <div className={`h-full rounded-full ${fill} transition-all duration-500`} style={{ width: `${w}%` }} />
    </div>
  );
}

function Tile({ icon, label, value, unit, sub, pct, tone, onPress, active, quiet, testId }) {
  return (
    <button type="button" onClick={() => { haptic(10); onPress?.(); }} data-testid={testId}
      className={`min-w-0 text-left rounded-2xl px-3.5 py-3 border transition-all active:scale-[0.98] ${
        active ? 'bg-gold/[0.14] border-gold/45' : 'bg-white/[0.04] border-hair'}`}>
      <span className={`flex items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-widest ${quiet ? 'text-lo' : 'text-mute'}`}>
        <Icon name={icon} size={13} />
        <span className="truncate">{label}</span>
      </span>
      <span className={`block font-display text-num-sm font-semibold leading-tight tracking-tight mt-1 tabular-nums truncate ${quiet ? 'text-lo' : 'text-white'}`}>
        {value}{unit && <span className="text-caption text-lo font-sans font-medium"> {unit}</span>}
      </span>
      {sub && <span className="block text-caption text-lo truncate mt-0.5">{sub}</span>}
      {pct != null && <Bar pct={pct} tone={tone} />}
    </button>
  );
}

export default function DayStrip({ m, onOpen }) {
  const { log, protocol, kcalIn, kcalTarget, workoutKcal, coachPlan, micro, sleepText, sleepMins, terms, sheet } = m;
  const water   = log.water || 0;
  const targetMl = protocol?.water_target || 3000;

  const plan = coachPlan?.todayDay;
  const workoutValue = workoutKcal > 0 ? workoutKcal : plan ? plan.day_label : '—';
  const workoutUnit  = workoutKcal > 0 ? terms.kcal : '';
  const workoutSub   = workoutKcal > 0 ? 'burned so far'
    : plan ? `${plan.exercises.length} ${plural(plan.exercises.length, 'exercise')} planned`
    : 'nothing logged yet';

  return (
    <div data-testid="day-strip" className="grid grid-cols-2 gap-2">
      <Tile icon="food" testId="chip-food" label="Food" active={sheet === 'food'} onPress={() => onOpen('food')}
        value={kcalIn.toLocaleString('en-IN')} unit={kcalTarget ? `/ ${kcalTarget.toLocaleString('en-IN')} ${terms.kcal}` : terms.kcal}
        pct={kcalTarget ? (kcalIn / kcalTarget) * 100 : null} quiet={!kcalIn} />
      <Tile icon="drop" testId="chip-water" label="Water" active={sheet === 'water'} onPress={() => onOpen('water')}
        value={(water / 1000).toFixed(1)} unit={`/ ${(targetMl / 1000).toFixed(1)} L`}
        pct={(water / targetMl) * 100} tone="blue" quiet={!water} />
      <Tile icon="moon" testId="chip-sleep" label={terms.sleep} active={sheet === 'sleep'} onPress={() => onOpen('sleep')}
        value={sleepText || '—'} unit={sleepText ? '' : 'set times'}
        pct={sleepMins != null ? (sleepMins / 480) * 100 : null} tone="ok" quiet={!sleepText} />
      <Tile icon="dumbbell" testId="chip-workout" label="Workout" active={sheet === 'workout'} onPress={() => onOpen('workout')}
        value={workoutValue} unit={workoutUnit} sub={workoutSub} quiet={workoutValue === '—'} />

      <button type="button" onClick={() => { haptic(10); onOpen('nutrition'); }} data-testid="chip-nutrition"
        className={`col-span-2 min-w-0 text-left rounded-2xl px-3.5 py-2.5 border flex items-center gap-3 transition-all active:scale-[0.99] ${
          sheet === 'nutrition' ? 'bg-gold/[0.14] border-gold/45' : 'bg-white/[0.04] border-hair'}`}>
        <span className={`flex items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-widest flex-shrink-0 ${micro.hasData ? 'text-mute' : 'text-lo'}`}>
          <Icon name="pill" size={13} />Nutrition
        </span>
        <span className="flex-1 min-w-0 flex items-center gap-3">
          <span className={`font-display text-base font-semibold tabular-nums whitespace-nowrap ${micro.hasData ? 'text-white' : 'text-lo'}`}>
            {micro.hasData ? `${micro.met} / ${micro.total}` : '—'}
            <span className="text-caption text-lo font-sans font-medium"> {micro.hasData ? 'targets met' : 'log food first'}</span>
          </span>
          <span className="flex-1 h-1 rounded-full bg-white/[0.07] overflow-hidden" aria-hidden="true">
            <span className="block h-full rounded-full bg-gold transition-all duration-500" style={{ width: `${micro.hasData ? (micro.met / micro.total) * 100 : 0}%` }} />
          </span>
        </span>
        <Icon name="chevron-right" size={14} className="text-ghost flex-shrink-0" />
      </button>
    </div>
  );
}
