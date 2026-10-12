import { Icon } from '../primitives';

export default function DailyEssentials({ m, onOpen }) {
  const { log, kcalIn, kcalTarget, eaten, protocol, sleepText, coachPlan, workoutSummary } = m;
  const water = log.water || 0;
  const target = protocol?.water_target || 3000;
  const workout = coachPlan?.todayDay;
  const bar = (v, max) => <span className="member-meter"><i style={{ width: Math.min(100, Math.max(0, max ? v / max * 100 : 0)) + '%' }} /></span>;
  return <div className="member-essentials" data-testid="daily-essentials">
    <div className="member-tile">
      <button type="button" onClick={() => onOpen('food')} data-testid="plan-eat">
        <span className="member-tile-label"><Icon name="food" size={16} /> Food <Icon name="chevron-right" size={14} /></span>
        <strong>{kcalIn.toLocaleString('en-IN')} <small>{kcalTarget ? '/ ' + kcalTarget.toLocaleString('en-IN') : ''} kcal</small></strong>
        {bar(kcalIn, kcalTarget)}
        <span className="member-tile-detail">P {Math.round(eaten?.pro || 0)} · C {Math.round(eaten?.carb || 0)} · F {Math.round(eaten?.fat || 0)} g</span>
      </button>
    </div>
    <div className="member-tile">
      <button type="button" onClick={() => onOpen('water')} data-testid="chip-water">
        <span className="member-tile-label"><Icon name="drop" size={16} /> Water <Icon name="chevron-right" size={14} /></span>
        <strong>{(water / 1000).toFixed(2)} <small>/ {(target / 1000).toFixed(1)} L</small></strong>
        {bar(water, target)}
      </button>
      <button type="button" className="member-tile-add" onClick={() => m.update('water', Math.min(10000, water + 250))}>+250 ml</button>
    </div>
    <div className="member-tile">
      <button type="button" onClick={() => onOpen('workout')} data-testid="plan-move">
        <span className="member-tile-label"><Icon name="dumbbell" size={16} /> Move <Icon name="chevron-right" size={14} /></span>
        <strong className="member-workout-name">{workout?.day_label || 'Your workout'}</strong>
        <span className="member-tile-detail">{workout ? workout.exercises.length + ' exercises' : 'Strength, cardio & activities'}</span>
        <span className="member-tile-cta">{workoutSummary?.count ? 'View workout' : 'Start workout'} <Icon name="arrow-right" size={14} /></span>
      </button>
    </div>
    <div className="member-tile">
      <button type="button" onClick={() => onOpen('sleep')} data-testid="chip-sleep">
        <span className="member-tile-label"><Icon name="moon" size={16} /> Sleep <Icon name="chevron-right" size={14} /></span>
        <strong>{sleepText || 'Add sleep'}</strong>
        <span className="member-tile-detail">{sleepText ? 'View or adjust your sleep' : 'Bedtime & wake-up time'}</span>
      </button>
    </div>
  </div>;
}
