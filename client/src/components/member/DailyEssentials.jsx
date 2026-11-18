import { Icon } from '../primitives';

/** The numbers are derived by the existing day model, never demo values.
 *
 * 16 Oct 2026 — brought back from the production Today screen, in this layout:
 *   · protein / carbs / fat against the coach's targets ("29 / 90 g" + a bar),
 *     grams alone when no target is set (the 10 Oct macros build);
 *   · weight change vs yesterday under the weight;
 *   · the program day ("Push · 6 ex") or "Rest day" on the Move tile;
 *   · short empty labels ("Log move") so a tile never breaks onto two lines;
 *   · a "See meals" hint, because the ring opens the food sheet. */
export default function DailyEssentials({ m, onOpen }) {
  const { log, kcalIn, kcalTarget, protocol, sleepText, sleepMins, coachPlan, coachRows, workoutSummary, eaten, macroTargets, weightDelta } = m;
  const target = Number(kcalTarget) > 0 ? Number(kcalTarget) : null;
  const progress = target ? Math.min(100, Math.max(0, kcalIn / target * 100)) : 0;
  const water = (Number(log.water) || 0) / 1000;
  const waterTarget = (protocol?.water_target || 3000) / 1000;
  const sessions = (workoutSummary?.count || 0) + (workoutSummary?.cardio?.length || 0);
  const day = m.isToday ? coachPlan?.todayDay : null;
  const movement = workoutSummary?.duration
    ? `${workoutSummary.duration} min logged`
    : sessions ? `${sessions} ${sessions === 1 ? 'activity' : 'activities'} logged`
    : day ? `${day.day_label}${day.exercises?.length ? ` · ${day.exercises.length} ex` : ''}`
    : m.isToday && coachRows?.rest ? 'Rest day'
    : 'Log move';
  const macros = [['Protein', 'P', eaten?.pro, macroTargets?.pro], ['Carbs', 'C', eaten?.carb, macroTargets?.carb], ['Fat', 'F', eaten?.fat, macroTargets?.fat]];
  const sleepNote = sleepMins != null ? (sleepMins >= 420 ? 'Slept well' : sleepMins < 360 ? 'Short sleep' : null) : null;
  const weightNote = log.weight && weightDelta != null && weightDelta !== 0
    ? `${weightDelta < 0 ? '↓' : '↑'} ${Math.abs(weightDelta)} vs yesterday` : null;
  const metric = (key, icon, label, value, testId, note = null) => <button type="button" className="member-metric"
    data-testid={testId} onClick={() => onOpen(key)} aria-label={label + ': ' + value + (note ? ', ' + note : '') + '. View or edit'}>
    <Icon name={icon} size={21} />
    <span><span className="member-metric-label">{label}</span><strong>{value}</strong>{note && <small className="member-metric-note">{note}</small>}</span>
    <Icon name="chevron-right" size={14} />
  </button>;

  return <div className="member-essentials" data-testid="daily-essentials">
    <button type="button" className="member-nutrition" data-testid="plan-eat" onClick={() => onOpen('food')}
      aria-label={'Food: ' + kcalIn + (target ? ' of ' + target : ' logged') + ' kcal. View or edit food and macros'}>
      <span className="member-calorie-ring">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle className="member-ring-track" cx="100" cy="100" r="91" />
          <circle className="member-ring-fill" cx="100" cy="100" r="91" pathLength="100"
            strokeDasharray={progress + ' 100'} transform="rotate(-90 100 100)" />
        </svg>
        <span className="member-ring-content"><span className="member-ring-label">{m.ageMode === 'child' ? 'Energy' : 'Nourish'}</span>
          <strong>{Math.round(kcalIn).toLocaleString('en-IN')}</strong>
          <span>{target ? 'of ' + target.toLocaleString('en-IN') + ' kcal' : 'kcal logged'}</span>
        </span>
      </span>
      <span className="member-macros" data-testid="plan-macros">{macros.map(([label, short, value, goal]) => {
        const g = Number(goal) > 0 ? Number(goal) : null, v = Math.round(Number(value) || 0);
        // Over the coach's target: the number and its bar turn amber, as on production (MAC-003, 17 Oct 2026).
        const over = g && v > g;
        return <span key={label} className={over ? 'is-over' : undefined}>
          <strong><span className="sr-only">{short} </span><span className="member-macro-value">{v}</span>{g ? <span className="member-macro-goal"> / {Math.round(g)}</span> : null} <small>g</small></strong>
          {g && <span className="member-macro-bar" aria-hidden="true"><span style={{ width: Math.min(100, v / g * 100) + '%' }} /></span>}
          <span>{label}</span>
        </span>;
      })}</span>
      {!log.food?.length
        ? <span className="member-empty-hint">Start with a meal. Speak, snap or type below.</span>
        : <span className="member-ring-hint" aria-hidden="true">See meals ›</span>}
    </button>
    <div className="member-metrics">
      {metric('water', 'drop', 'Water', water.toFixed(2) + ' / ' + waterTarget.toFixed(1) + ' L', 'chip-water')}
      {metric('workout', 'dumbbell', 'Move', movement, 'plan-move')}
      {metric('sleep', 'moon', 'Sleep', sleepText || 'Log sleep', 'chip-sleep', sleepNote)}
      {metric('weight', 'scale', 'Weight', log.weight ? log.weight + ' kg' : 'Log weight', 'hero-weight', weightNote)}
    </div>
  </div>;
}

