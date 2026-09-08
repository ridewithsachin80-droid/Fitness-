import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMyToday } from '../api/logs';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore, useTerms, haptic } from '../store/settingsStore';
import { OfflineBanner, MemberBottomNav } from '../components/UI';
import { Eyebrow, Icon, Segmented, Skeleton, SkeletonCard, EmptyState } from '../components/primitives';
import { WEEKDAYS, istWeekday, labelHasWeekday, isWeekdayScheduled, deriveTodayDay } from '../utils/programDay';
import { resolveProtocolItems, AUTO_TICK_IDS } from '../lib/day';
import { plural } from '../constants';

/**
 * Plan — "What am I supposed to follow?" on one screen (Sprint 6).
 *
 * Four views under a segmented control:
 *   Today     — this day's workout, meals, water, supplements, sleep target
 *   This week — Mon … Sun program days, rest days marked, today highlighted
 *   Nutrition — calorie & macro targets, the coach's meal plan meal by meal
 *   Recovery  — sleep target, water target, fasting window, the protocol
 *               items with their timings (the same list Today ticks)
 *
 * Everything comes from ONE request — GET /members/me/today — which already
 * returns the profile (protocol), the meal plan and the program with its
 * days; the same payload Today uses, so the two screens cannot disagree.
 * No schema change.
 */
const SLEEP_TARGET = { bed: '10:00 PM', wake: '6:30 AM', hours: 8 };

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

function Section({ eyebrow, title, children, action }) {
  return (
    <section className="pt-5 first:pt-0">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          {title && <h2 className="font-display text-lg font-medium text-white leading-tight">{title}</h2>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Line({ icon, title, sub, right, onPress, testId, tone }) {
  const body = (
    <>
      <span className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${tone === 'gold' ? 'bg-gold/[0.12] text-gold' : 'bg-white/[0.05] text-mid'}`}>
        <Icon name={icon} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white truncate">{title}</span>
        {sub && <span className="block text-caption text-mid">{sub}</span>}
      </span>
      {right && <span className="text-sm font-display font-semibold tabular-nums text-white flex-shrink-0">{right}</span>}
      {onPress && <Icon name="chevron-right" size={14} className="text-ghost flex-shrink-0" />}
    </>
  );
  const cls = 'w-full text-left flex items-center gap-3 py-2.5 border-b border-hair last:border-b-0';
  return onPress
    ? <button type="button" onClick={() => { haptic(10); onPress(); }} className={`${cls} active:bg-white/[0.03] -mx-1 px-1 rounded-lg`} data-testid={testId}>{body}</button>
    : <div className={cls} data-testid={testId}>{body}</div>;
}

export default function Plan() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const terms = useTerms();
  const mealSlots = useSettingsStore(s => s.mealSlots);
  const [view, setView] = useState('today');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getMyToday()
      .then(({ data }) => setData(data || {}))
      .catch(() => setError('Could not load your plan. Pull down to try again.'));
  }, []);

  const protocol = data?.profile || null;
  const days     = data?.program?.days || [];
  const program  = data?.program?.program || null;
  const meals    = data?.meal_plan?.meals || [];
  const todayWd  = istWeekday();
  const { scheduled, todayDay } = deriveTodayDay(days, todayWd);
  const { activeActivities, activeACV, activeSupplements } = resolveProtocolItems(protocol);
  const macros = protocol?.macros || null;
  const waterL = ((protocol?.water_target || 3000) / 1000).toFixed(1);
  const fasting = protocol?.fasting_start && protocol?.fasting_end ? { start: protocol.fasting_start, end: protocol.fasting_end } : null;

  const mealKcal = (items = []) => Math.round(items.reduce((a, it) => a + ((it.per_100g?.calories || 0) * (it.grams || 0) / 100), 0));
  const goToday = (sheet) => navigate(sheet ? `/?open=${sheet}` : '/');

  const loading = !data && !error;

  return (
    <div className="min-h-screen bg-charcoal font-sans">
      <OfflineBanner />
      <header className="px-4 pt-8 pb-3 bg-gradient-to-b from-surface to-charcoal">
        <div className="max-w-md mx-auto">
          <Eyebrow tone="gold">Plan</Eyebrow>
          <h1 className="font-display text-num font-medium text-white leading-tight mt-1">
            {program?.name ? program.name : 'Your plan'}
          </h1>
          <p className="text-sm text-mid mt-1">
            {protocol?.monitor_name ? `Set by ${protocol.monitor_name}` : 'Set by your coach'}{scheduled ? ' · weekday schedule' : ''}
          </p>
          <Segmented className="mt-4" name="plan-view" value={view} onChange={setView}
            options={[{ id: 'today', label: 'Today' }, { id: 'week', label: 'Week' }, { id: 'nutrition', label: 'Nutrition' }, { id: 'recovery', label: 'Recovery' }]} />
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-8" data-testid="plan-main" data-view={view}>
        {loading && (<><SkeletonCard lines={2} /><Skeleton className="h-24 mt-3" /><SkeletonCard lines={3} className="mt-3" /></>)}
        {error && <EmptyState icon="warning" title="Couldn't load your plan" body={error} />}

        {data && view === 'today' && (
          <>
            <Section eyebrow="Move" title={todayDay ? todayDay.day_label : scheduled ? 'Rest day' : 'No program yet'}
              action={todayDay && <button type="button" onClick={() => { haptic(10); goToday('workout'); }} className="text-caption font-bold text-gold" style={{ minHeight: 32 }}>Start ›</button>}>
              {todayDay ? (
                <div data-testid="plan-today-workout">
                  {todayDay.exercises.map((e, i) => (
                    <Line key={e.id || i} icon="dumbbell" title={e.exercise_name}
                      sub={[e.muscle_group, e.notes].filter(Boolean).join(' · ')}
                      right={e.target_sets ? `${e.target_sets} × ${e.target_reps || '—'}` : null} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-mid">{scheduled ? 'Nothing scheduled today. Walk, stretch, sleep well.' : 'Your coach hasn\u2019t assigned a workout program yet.'}</p>
              )}
            </Section>

            <Section eyebrow="Eat" title={macros?.kcal ? `${macros.kcal.toLocaleString('en-IN')} ${terms.kcal} · ${macros.pro || '—'} g protein` : 'Targets not set yet'}
              action={<button type="button" onClick={() => { haptic(10); goToday('food'); }} className="text-caption font-bold text-gold" style={{ minHeight: 32 }}>Log ›</button>}>
              {meals.length ? (
                <div data-testid="plan-today-meals">
                  {meals.map(mp => (
                    <Line key={mp.meal} icon="food" title={mp.meal}
                      sub={(mp.items || []).slice(0, 3).map(it => it.name).join(' · ') + ((mp.items || []).length > 3 ? ` +${mp.items.length - 3}` : '')}
                      right={`~${mealKcal(mp.items)} ${terms.kcal}`} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-mid">No meal plan for today. Eat to your targets and log as you go.</p>
              )}
            </Section>

            <Section eyebrow="Recover" title={`${waterL} L water · ${SLEEP_TARGET.hours} h sleep`}>
              <div data-testid="plan-today-recover">
                <Line icon="drop" title="Water" sub="Stop 1 hr before sleep · not during meals" right={`${waterL} L`} onPress={() => goToday('water')} />
                <Line icon="moon" title={terms.sleep} sub={`${SLEEP_TARGET.bed} → ${SLEEP_TARGET.wake}`} right={`${SLEEP_TARGET.hours} h`} onPress={() => goToday('sleep')} />
                {activeSupplements.length > 0 && (
                  <Line icon="pill" title={terms.supplements} sub={activeSupplements.map(s => s.label).join(' · ')}
                    right={`${activeSupplements.length}`} onPress={() => goToday('protocol')} />
                )}
              </div>
            </Section>
          </>
        )}

        {data && view === 'week' && (
          <Section eyebrow="This week" title={program?.name || 'No program yet'}>
            {days.length ? (
              <div className="grid grid-cols-1 gap-1.5" data-testid="plan-week">
                {WEEKDAYS.map(wd => {
                  const day = scheduled ? days.find(d => labelHasWeekday(d.day_label, wd)) : null;
                  const isToday = wd === todayWd;
                  return (
                    <div key={wd} data-testid="plan-week-day" data-today={isToday ? '1' : '0'}
                      className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 border ${isToday ? 'bg-gold/[0.10] border-gold/40' : 'bg-white/[0.03] border-hair'}`}>
                      <span className={`w-10 text-eyebrow font-bold uppercase tracking-widest ${isToday ? 'text-gold' : 'text-lo'}`}>{wd}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-semibold truncate ${day ? 'text-white' : 'text-lo'}`}>{day ? day.day_label.replace(/\s*[·-]\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*$/i, '') : 'Rest'}</span>
                        {day && <span className="block text-caption text-mid truncate">{day.exercises.slice(0, 4).map(e => e.exercise_name).join(' · ')}{day.exercises.length > 4 ? ` +${day.exercises.length - 4}` : ''}</span>}
                      </span>
                      {day && <span className="text-caption text-mid tabular-nums flex-shrink-0">{day.exercises.length} {plural(day.exercises.length, 'exercise')}</span>}
                    </div>
                  );
                })}
                {!scheduled && (
                  <p className="text-caption text-lo mt-2">This program isn\u2019t tied to weekdays — pick any day in the Workout sheet. Days: {days.map(d => d.day_label).join(' · ')}</p>
                )}
              </div>
            ) : (
              <EmptyState compact icon="dumbbell" title="No program assigned" body="Your coach sets your weekly split here." />
            )}
          </Section>
        )}

        {data && view === 'nutrition' && (
          <>
            <Section eyebrow="Daily targets" title={macros?.kcal ? `${macros.kcal.toLocaleString('en-IN')} ${terms.kcal}` : 'Not set yet'}>
              {macros ? (
                <div className="grid grid-cols-3 gap-2" data-testid="plan-macros">
                  {[['Protein', macros.pro], ['Carbs', macros.carb], ['Fat', macros.fat]].map(([k, v]) => (
                    <div key={k} className="rounded-2xl bg-white/[0.04] border border-hair px-3 py-2.5">
                      <Eyebrow>{k}</Eyebrow>
                      <span className="block font-display text-num-sm font-semibold text-white tabular-nums mt-0.5">{v ?? '—'}<span className="text-caption text-lo font-sans font-medium"> g</span></span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-mid">Your coach hasn\u2019t set calorie and macro targets yet.</p>}
              {fasting && <p className="text-caption text-mid mt-2">Eating window {fmtTime(fasting.end)} → {fmtTime(fasting.start)} · fast outside it</p>}
            </Section>
            <Section eyebrow="Meal plan" title={meals.length ? `${meals.length} ${plural(meals.length, 'meal')} prescribed` : 'No meal plan'}>
              {meals.length ? meals.map(mp => (
                <div key={mp.meal} className="mb-3" data-testid="plan-meal">
                  <div className="flex items-baseline justify-between"><span className="text-sm font-semibold text-white">{mp.meal}</span><span className="text-caption text-mid tabular-nums">~{mealKcal(mp.items)} {terms.kcal}</span></div>
                  {(mp.items || []).map((it, i) => (
                    <div key={i} className="flex justify-between text-caption py-1 border-b border-hair last:border-b-0">
                      <span className="text-mid truncate">{it.name}</span><span className="text-lo tabular-nums flex-shrink-0 ml-3">{it.grams} g</span>
                    </div>
                  ))}
                </div>
              )) : <p className="text-sm text-mid">Your meal slots: {(mealSlots || []).join(' · ')}. Log each as you eat and the AI tallies it against your targets.</p>}
            </Section>
          </>
        )}

        {data && view === 'recovery' && (
          <>
            <Section eyebrow="Recovery" title={`${SLEEP_TARGET.hours} h sleep · ${waterL} L water`}>
              <div data-testid="plan-recovery">
                <Line icon="moon" title={terms.sleep} sub={`${SLEEP_TARGET.bed} → ${SLEEP_TARGET.wake}`} right={`${SLEEP_TARGET.hours} h`} />
                <Line icon="drop" title="Water" sub="Stop 1 hr before sleep · not during meals" right={`${waterL} L`} />
                {scheduled && (
                  <Line icon="calendar" title="Rest days" sub={WEEKDAYS.filter(wd => !days.some(d => labelHasWeekday(d.day_label, wd))).join(' · ') || 'None — every day has a session'} />
                )}
              </div>
            </Section>
            <Section eyebrow="Protocol" title={(() => { const n = activeActivities.length + activeACV.length + activeSupplements.length; return `${n} ${plural(n, 'item')} a day`; })()}>
              <div data-testid="plan-protocol">
                {activeActivities.map(a => <Line key={a.id} icon="run" title={a.label} sub={a.sub || (AUTO_TICK_IDS.includes(a.id) ? 'Ticks from your Workout log' : '')} />)}
                {activeACV.map(a => <Line key={a.id} icon="drop" title={a.label} sub={a.sub || '1 tbsp in 200 ml warm water, 15 min before the meal'} />)}
                {activeSupplements.map(s => <Line key={s.id} icon="pill" title={s.label} sub={s.sub || ''} />)}
              </div>
            </Section>
          </>
        )}
      </main>

      <MemberBottomNav />
    </div>
  );
}
