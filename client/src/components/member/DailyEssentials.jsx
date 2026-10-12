import { Icon } from '../primitives';

/** The numbers are derived by the existing day model, never demo values. */
export default function DailyEssentials({ m, onOpen }) {
  const { log, kcalIn, kcalTarget, protocol, sleepText, coachPlan, workoutSummary, eaten } = m;
  const target = Number(kcalTarget) > 0 ? Number(kcalTarget) : null;
  const progress = target ? Math.min(100, Math.max(0, kcalIn / target * 100)) : 0;
  const water = (Number(log.water) || 0) / 1000;
  const waterTarget = (protocol?.water_target || 3000) / 1000;
  const sessions = (workoutSummary?.count || 0) + (workoutSummary?.cardio?.length || 0);
  const movement = workoutSummary?.duration
    ? `${workoutSummary.duration} min logged`
    : sessions ? `${sessions} ${sessions === 1 ? 'activity' : 'activities'} logged`
    : m.isToday && coachPlan?.todayDay?.day_label || 'Add movement';
  const macros = [['Protein', 'P', eaten?.pro], ['Carbs', 'C', eaten?.carb], ['Fat', 'F', eaten?.fat]];
  const metric = (key, icon, label, value, testId) => <button type="button" className="member-metric"
    data-testid={testId} onClick={() => onOpen(key)} aria-label={label + ': ' + value + '. View or edit'}>
    <Icon name={icon} size={21} />
    <span><span className="member-metric-label">{label}</span><strong>{value}</strong></span>
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
      <span className="member-macros">{macros.map(([label, short, value]) => <span key={label}>
        <strong><span className="sr-only">{short} </span>{Math.round(Number(value) || 0)} <small>g</small></strong><span>{label}</span>
      </span>)}</span>
      {!log.food?.length && <span className="member-empty-hint">Start with a meal. Speak, snap or type below.</span>}
    </button>
    <div className="member-metrics">
      {metric('water', 'drop', 'Water', water.toFixed(2) + ' / ' + waterTarget.toFixed(1) + ' L', 'chip-water')}
      {metric('workout', 'dumbbell', 'Move', movement, 'plan-move')}
      {metric('sleep', 'moon', 'Sleep', sleepText || 'Add sleep', 'chip-sleep')}
      {metric('weight', 'scale', 'Weight', log.weight ? log.weight + ' kg' : 'Add weight', 'hero-weight')}
    </div>
  </div>;
}
