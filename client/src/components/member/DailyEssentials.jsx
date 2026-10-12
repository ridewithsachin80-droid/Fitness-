import { Icon } from '../primitives';

/** Daily essentials and weight, directly editable from one quiet summary. */
export default function DailyEssentials({ m, onOpen }) {
  const { log, kcalIn, kcalTarget, protocol, sleepText, coachPlan, workoutSummary } = m;
  const water = log.water || 0;
  const target = protocol?.water_target || 3000;
  const workout = coachPlan?.todayDay;
  const bar = (v, max) => <span className="member-meter" aria-hidden="true"><i style={{ width: Math.min(100, Math.max(0, max ? v / max * 100 : 0)) + '%' }} /></span>;
  return <div className="member-essentials" data-testid="daily-essentials">
    <div className="member-tile">
      <button type="button" onClick={() => onOpen('food')} data-testid="plan-eat" aria-label={`Food: ${kcalIn} of ${kcalTarget || 'no target'} kcal. View or edit`}>
        <span className="member-tile-label"><Icon name="food" size={15} /> Food</span>
        <strong>{kcalIn.toLocaleString('en-IN')} <small>{kcalTarget ? '/ ' + kcalTarget.toLocaleString('en-IN') : ''} kcal</small></strong>
        {bar(kcalIn, kcalTarget)}
      </button>
    </div>
    <div className="member-tile member-water-tile">
      <button type="button" onClick={() => onOpen('water')} data-testid="chip-water" aria-label={`Water: ${(water / 1000).toFixed(2)} of ${(target / 1000).toFixed(1)} litres. View or edit`}>
        <span className="member-tile-label"><Icon name="drop" size={15} /> Water</span>
        <strong>{(water / 1000).toFixed(2)} <small>/ {(target / 1000).toFixed(1)} L</small></strong>
        {bar(water, target)}
      </button>
      <button type="button" className="member-tile-add" aria-label="Add 250 ml of water" onClick={() => m.update('water', Math.min(10000, water + 250))}><Icon name="plus" size={15} /></button>
    </div>
    <div className="member-tile">
      <button type="button" onClick={() => onOpen('workout')} data-testid="plan-move" aria-label={workoutSummary?.count ? 'View workout' : 'Start workout'}>
        <span className="member-tile-label"><Icon name="dumbbell" size={15} /> Move</span>
        <strong className="member-workout-name">{workout?.day_label || 'Your workout'}</strong>
      </button>
    </div>
    <div className="member-tile">
      <button type="button" onClick={() => onOpen('sleep')} data-testid="chip-sleep">
        <span className="member-tile-label"><Icon name="moon" size={15} /> Sleep</span>
        <strong>{sleepText || 'Add sleep'}</strong>
      </button>
    </div>
    <button type="button" className="member-snapshot-weight" data-testid="hero-weight" onClick={() => onOpen('weight')}
      aria-label={log.weight ? `Weight: ${log.weight} kilograms. View or edit` : 'Add weight'}>
      <span className="member-tile-label"><Icon name="scale" size={16} /> Weight</span>
      <span className="member-weight-value"><strong>{log.weight || 'Add weight'}{log.weight && <small> kg</small>}</strong>
        {log.weight && m.weightDelta != null && <span className="member-weight-change">{m.weightDelta === 0 ? 'No change' : `${m.weightDelta < 0 ? '↓' : '↑'} ${Math.abs(m.weightDelta)} kg`}</span>}
      </span>
      <Icon name="chevron-right" size={15} />
    </button>
  </div>;
}
