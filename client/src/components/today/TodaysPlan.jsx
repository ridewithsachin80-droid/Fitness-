import { Icon, Eyebrow } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { plural } from '../../constants';
import { AUTO_TICK_IDS } from '../../lib/day';

/**
 * TodaysPlan — Move · Eat · Recover. One section, three rows, three answers
 * to "what am I supposed to do today?"
 *
 * Sprint 5b. Replaces four things that used to compete for the same screen:
 * the coach card, the four tiles, the deficit chip and the protocol-dots card.
 * The data behind each row is unchanged (coach rules in utils/coachCard.js,
 * numbers from useTodayModel) — only the surface is one instead of four.
 *
 * Each row: an icon, a title with the state, one line of detail, and ONE
 * primary action on the right. Secondary taps (water, sleep, nutrition, the
 * dots) are inline so nothing is more than one tap away.
 */
function Row({ icon, n, title, state, detail, action, onAction, testId, children, last }) {
  return (
    <div className={`flex items-start gap-3 py-3.5 ${last ? '' : 'border-b border-hair'}`} data-testid={testId}>
      <span className="flex-shrink-0 w-9 h-9 rounded-full bg-white/[0.05] text-mid flex items-center justify-center mt-0.5">
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-eyebrow font-semibold uppercase tracking-widest text-lo whitespace-nowrap">{n} · {title}</span>
          {state && <span className="text-caption font-semibold text-gold-light truncate text-right">{state}</span>}
        </div>
        <div className="text-sm text-white mt-0.5 leading-snug">{detail}</div>
        {children}
        {action && (
          <div className="flex justify-end mt-1">
            <button type="button" onClick={() => { haptic(10); onAction?.(); }} data-testid={testId ? `${testId}-action` : undefined}
              style={{ minHeight: 36 }}
              className="text-caption font-bold text-gold whitespace-nowrap px-2 -mr-2 rounded-lg active:scale-95 transition-transform">
              {action} ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Tap({ onPress, testId, children, className = '' }) {
  return (
    <button type="button" onClick={() => { haptic(8); onPress?.(); }} data-testid={testId}
      style={{ minHeight: 32 }}
      className={`inline-flex items-center gap-1.5 text-caption text-mid rounded-lg px-1.5 -mx-1.5 active:bg-white/[0.05] transition-colors ${className}`}>
      {children}
    </button>
  );
}

export default function TodaysPlan({ m, onOpen }) {
  const { log, protocol, coachPlan, coachRows, workoutSummary, workoutKcal, kcalIn, kcalTarget,
          proteinIn, proteinTarget, balance, micro, sleepText, sleepMins, terms,
          activeActivities, activeACV, activeSupplements, protocolDone, protocolTotal } = m;

  // ── Move ────────────────────────────────────────────────────────────────
  const plan = coachPlan?.todayDay;
  const logged = (workoutSummary.count || 0) > 0 || (workoutSummary.cardio || []).length > 0;
  const restDay = !plan && coachRows?.rest;
  let moveState, moveDetail, moveAction;
  if (logged) {
    const bits = [];
    if (workoutSummary.count) bits.push(`${workoutSummary.count} ${plural(workoutSummary.count, 'exercise')}`);
    if ((workoutSummary.cardio || []).length) bits.push(`${workoutSummary.cardio.length} cardio`);
    if (workoutKcal > 0) bits.push(`${workoutKcal} ${terms.kcal}`);
    moveState = 'Logged'; moveDetail = bits.join(' · '); moveAction = 'Add more';
  } else if (plan) {
    moveDetail = `${plan.day_label} · ${plan.exercises.length} ${plural(plan.exercises.length, 'exercise')}`;
    moveAction = 'Start workout';
  } else if (restDay) {
    moveState = 'Rest day'; moveDetail = 'Recovery counts. Walk, water, sleep.'; moveAction = 'Log activity';
  } else {
    moveDetail = 'No program today — log anything you did.'; moveAction = 'Log workout';
  }

  // ── Eat ─────────────────────────────────────────────────────────────────
  const pendingMeals = coachRows?.pendingMeals || [];
  const eatState = kcalIn > 0 && kcalTarget ? `${Math.round((kcalIn / kcalTarget) * 100)}% of target` : null;
  const eatDetail = (
    <span className="tabular-nums">
      <span className="font-display font-semibold text-base">{kcalIn.toLocaleString('en-IN')}</span>
      {kcalTarget && <span className="text-lo"> / {kcalTarget.toLocaleString('en-IN')}</span>} <span className="text-lo">{terms.kcal}</span>
      {proteinTarget && (<><span className="text-ghost"> · </span><span className="font-display font-semibold text-base">{proteinIn}</span><span className="text-lo"> / {proteinTarget} g protein</span></>)}
    </span>
  );
  const eatAction = pendingMeals.length ? 'View meal plan' : 'Log food';

  // ── Recover ─────────────────────────────────────────────────────────────
  const water = log.water || 0;
  const targetMl = protocol?.water_target || 3000;
  const dots = [
    ...activeActivities.map(a => ({ id: 'a:' + a.id, on: !!log.activities?.[a.id], auto: AUTO_TICK_IDS.includes(a.id) })),
    ...activeACV.map(a => ({ id: 'v:' + a.id, on: !!log.acv?.[a.id] })),
    ...activeSupplements.map(s => ({ id: 's:' + s.id, on: !!log.supplements?.[s.id] })),
  ];
  const recoverState = sleepMins != null ? (sleepMins >= 420 ? 'Slept well' : sleepMins < 360 ? 'Short sleep' : null) : null;

  return (
    <section className="rounded-3xl border border-hair bg-surface px-4 pt-3 pb-1" data-testid="todays-plan">
      <Eyebrow tone="gold">Today's plan</Eyebrow>

      <Row n="1" icon="dumbbell" title="Move" state={moveState} detail={moveDetail} action={moveAction}
        onAction={() => onOpen('workout')} testId="plan-move" />

      <Row n="2" icon="food" title="Eat" state={eatState} detail={eatDetail} action={eatAction}
        onAction={() => onOpen('food')} testId="plan-eat">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
          {pendingMeals.length > 0 && (
            <Tap onPress={() => onOpen('food')} testId="plan-meals">
              <Icon name="clock" size={12} />{pendingMeals.length} {plural(pendingMeals.length, 'meal plan')} pending
            </Tap>
          )}
          {balance != null && (
            <span className={`text-caption tabular-nums ${balance > 0 ? 'text-amber-300' : 'text-mid'}`} data-testid="plan-balance">
              {balance > 0 ? `${balance.toLocaleString('en-IN')} kcal over target` : `${Math.abs(balance).toLocaleString('en-IN')} kcal under target`}
            </span>
          )}
          {/* Sprint 11: the day's remaining macros, turned into a meal. */}
          <Tap onPress={() => onOpen('mealidea')} testId="chip-mealidea" className="text-gold-deep font-semibold">
            <Icon name="spark" size={12} />What to eat
          </Tap>
          <Tap onPress={() => onOpen('nutrition')} testId="chip-nutrition">
            <Icon name="pill" size={12} />{micro.hasData ? `${micro.met}/${micro.total} nutrients` : 'Nutrients'}
          </Tap>
        </div>
      </Row>

      <Row n="3" icon="moon" title="Recover" state={recoverState} last testId="plan-recover"
        detail={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Tap onPress={() => onOpen('water')} testId="chip-water" className="text-white">
              <Icon name="drop" size={13} className="text-blue-300" />
              <span className="tabular-nums"><span className="font-display font-semibold text-base">{(water / 1000).toFixed(1)}</span><span className="text-lo"> / {(targetMl / 1000).toFixed(1)} L</span></span>
            </Tap>
            <Tap onPress={() => onOpen('sleep')} testId="chip-sleep" className="text-white">
              <Icon name="moon" size={13} className="text-mid" />
              <span className="tabular-nums">{sleepText ? <span className="font-display font-semibold text-base">{sleepText}</span> : <span className="text-lo">set sleep times</span>}</span>
            </Tap>
          </span>
        }
        action={protocolTotal > 0 ? (protocolDone === protocolTotal ? 'Protocol ✓' : 'Tick protocol') : null}
        onAction={() => onOpen('protocol')}>
        {dots.length > 0 && (
          <button type="button" onClick={() => { haptic(10); onOpen('protocol'); }} data-testid="protocol-dots"
            aria-label={`Protocol: ${protocolDone} of ${protocolTotal} done. Open protocol.`}
            style={{ minHeight: 32 }}
            className="mt-1.5 flex items-center gap-2 -mx-1.5 px-1.5 rounded-lg active:bg-white/[0.05] transition-colors max-w-full">
            <span className="flex flex-wrap gap-1" aria-hidden="true">
              {dots.map(d => (
                <span key={d.id} className={`block w-2.5 h-2.5 rounded-full ${
                  d.on ? 'bg-gold' : d.auto ? 'border border-dashed border-white/25' : 'bg-white/[0.10]'}`} />
              ))}
            </span>
            <span className="text-caption text-mid tabular-nums whitespace-nowrap">{protocolDone} of {protocolTotal}</span>
          </button>
        )}
      </Row>
    </section>
  );
}
