import { StatPill } from '../UI';
import { ACTIVITIES, ACV_ITEMS, SUPPLEMENTS } from '../../constants';
import { UNSORTED_MEAL, groupByMeal } from '../../utils/coachView';
import WorkoutSessionViewer from '../WorkoutSessionViewer';
import { calcN, rowCompliance } from '../../lib/coach/dayMath.jsx';
import { microStatus, resolveProtocolItems, protocolFromProfile } from '../../lib/day';
import { MicroRow, microCountTone } from '../today/DayWidgets';

/**
 * DayDetail — every tick, macro and note for one day, as the coach sees it
 * (Sprint 12b). This was a 260-line IIFE inside Monitor.jsx's render; it is
 * unchanged apart from receiving its inputs as props. It sits behind the
 * "Full log" collapsible under the member's timeline.
 */
export default function DayDetail({ activeLog, activeDate, memberId, workoutTick, data }) {
                const log = activeLog;
                const score = log.compliance_pct || rowCompliance(log);
                const weightKg = parseFloat(log.weight_kg) || 0;
                const burnedKcal = weightKg > 0
                  ? ACTIVITIES.reduce((sum, a) => {
                      if (!log.activities?.[a.id] || !a.met) return sum;
                      return sum + Math.round(a.met * weightKg * ((a.durationMin || 30) / 60));
                    }, 0)
                  : 0;
                const eatenKcal = (log.food_items || []).reduce((sum, f) => {
                  const n = calcN(f); return sum + (n?.cal || 0);
                }, 0);
                const netKcal = eatenKcal - burnedKcal;

                return (
                  <div className="space-y-3">

                    {/* Weight + stats row */}
                    <div className="grid grid-cols-3 gap-2">
                      <StatPill value={log.weight_kg ? `${log.weight_kg} kg` : '—'} label="Weight" color="emerald" />
                      <StatPill value={`${((log.water_ml || 0) / 1000).toFixed(1)}L`} label="Water" />
                      <StatPill value={log.sleep?.quality > 0 ? `${log.sleep.quality}/5` : '—'} label="Sleep" />
                    </div>

                    {/* Net calorie row */}
                    {burnedKcal > 0 && (
                      <div className={`flex items-center justify-between text-xs px-3 py-2.5 rounded-xl border ${
                        netKcal <= 0 ? 'bg-gold/[0.07] border-gold/20 text-gold'
                        : netKcal <= 200 ? 'bg-warn/10 border-warn/20 text-warn'
                        : 'bg-red-400/10 border-red-400/20 text-red-400'
                      }`}>
                        <div className="flex gap-3">
                          <span>🍽 <strong>{eatenKcal}</strong> eaten</span>
                          <span>🔥 <strong>{burnedKcal}</strong> burned</span>
                        </div>
                        <span className="font-bold">Net {netKcal > 0 ? `+${netKcal}` : netKcal} kcal{netKcal <= 0 && ' 🎯'}</span>
                      </div>
                    )}

                    {/* Meal plan adherence */}
                    {data?.profile?.meal_plan?.length > 0 && (
                      <div className="rounded-xl border border-hair overflow-hidden">
                        <div className="px-3 py-2 bg-surface border-b border-white/[0.06]">
                          <span className="text-eyebrow font-bold text-lo">🍽 Meal Plan Adherence</span>
                        </div>
                        <div className="px-3 py-2.5 flex flex-wrap gap-2">
                          {data.profile.meal_plan.map(meal => {
                            const logged  = (log.food_items || []).map(f => f.name?.toLowerCase());
                            const total   = (meal.items || []).length;
                            const matched = (meal.items || []).filter(i => logged.includes(i.food_name?.toLowerCase())).length;
                            const pct     = total > 0 ? matched / total : 0;
                            const color   = pct >= 0.8 ? 'bg-gold/10 text-gold border-gold/[0.22]'
                                          : pct >= 0.5 ? 'bg-warn/10 text-warn border-warn/25'
                                          :              'bg-red-400/10 text-red-400 border-red-400/25';
                            const icon    = pct >= 0.8 ? '✓' : pct >= 0.5 ? '~' : '✗';
                            return (
                              <div key={meal.id} className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${color}`}>
                                {icon} {meal.name} {total > 0 ? `${matched}/${total}` : ''}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Food log */}
                    {log.food_items?.length > 0 && (
                      <div className="rounded-xl border border-hair overflow-hidden">
                        <div className="px-3 py-2 bg-surface border-b border-white/[0.06] flex justify-between">
                          <span className="text-eyebrow font-bold text-lo">🥗 Food Log</span>
                          <span className="text-xs font-bold text-gold">{eatenKcal} kcal total</span>
                        </div>
                        {(() => {
                          // Slot names are member-configurable and the AI logger can persist
                          // meal = null, so everything without a usable slot lands in
                          // 'Unsorted' rather than vanishing. The rules live in
                          // utils/coachView.js so the coach screen and the test suite run
                          // the same code.
                          return groupByMeal(log.food_items || [], data?.profile?.meal_slots || [])
                            .map(({ meal, items: mealItems }) => {
                          if (!mealItems.length) return null;
                          const mealCal = mealItems.reduce((s, f) => s + (calcN(f)?.cal || 0), 0);
                          return (
                            <div key={meal} className="border-b border-white/[0.05] last:border-0">
                              <div className="px-3 py-1.5 flex justify-between items-center bg-white/[0.02]">
                                <span className={`text-eyebrow font-semibold tracking-wide ${
                                  meal === UNSORTED_MEAL ? 'text-warn' : 'text-faint'
                                }`}>
                                  {meal}{meal === UNSORTED_MEAL && ' · no meal slot'}
                                </span>
                                <span className="text-xs text-lo">{mealCal} kcal</span>
                              </div>
                              {mealItems.map((f, i) => {
                                const n = calcN(f);
                                return (
                                  <div key={i} className="px-3 py-2 flex items-start justify-between gap-2 border-t border-white/[0.04]">
                                    <div className="min-w-0">
                                      <div className="text-sm font-medium text-white truncate">{f.name}</div>
                                      <div className="text-xs text-lo">{f.grams}g{f.label && <span className="text-gold-light" data-testid="coach-label-tag"> · member's own label</span>}</div>
                                    </div>
                                    {n && (
                                      <div className="flex gap-2.5 text-right flex-shrink-0">
                                        <div className="text-center">
                                          <div className="text-xs font-bold text-gold">{n.cal}</div>
                                          <div className="text-eyebrow text-lo">kcal</div>
                                        </div>
                                        <div className="text-center">
                                          <div className="text-xs font-bold text-blue-400">{n.pro}g</div>
                                          <div className="text-eyebrow text-lo">pro</div>
                                        </div>
                                        <div className="text-center">
                                          <div className="text-xs font-bold text-carb">{n.carb}g</div>
                                          <div className="text-eyebrow text-lo">carb</div>
                                        </div>
                                        <div className="text-center">
                                          <div className="text-xs font-bold text-fat">{n.fat}g</div>
                                          <div className="text-eyebrow text-lo">fat</div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                          });
                        })()}
                        {/* Day total row */}
                        {(() => {
                          const t = log.food_items.reduce((acc, f) => {
                            const n = calcN(f);
                            if (!n) return acc;
                            return { cal: acc.cal+n.cal, pro: acc.pro+n.pro, carb: acc.carb+n.carb, fat: acc.fat+n.fat };
                          }, { cal:0, pro:0, carb:0, fat:0 });
                          return (
                            <div className="px-3 py-2.5 bg-gold/5 flex items-center justify-between border-t border-gold/[0.12]">
                              <span className="text-xs font-bold text-gold">Day Total</span>
                              <div className="flex gap-3 text-xs">
                                <span className="font-bold text-gold">{t.cal} kcal</span>
                                <span className="text-blue-400">{t.pro.toFixed(1)}g P</span>
                                <span className="text-carb">{t.carb.toFixed(1)}g C</span>
                                <span className="text-fat">{t.fat.toFixed(1)}g F</span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Activities / ACV / Supplements — labeled checklist, not just icons.
                        Each group shows its own X/Y so the coach can scan exactly what's
                        missing without having to decode emoji or count cryptic pills. */}
                    <div className="space-y-3">
                      {[
                        { title: '🏃 Activities', items: ACTIVITIES,  done: log.activities },
                        { title: '🍎 ACV',         items: ACV_ITEMS,  done: log.acv },
                        { title: '💊 Supplements', items: SUPPLEMENTS, done: log.supplements },
                      ].map(group => {
                        const doneCount = group.items.filter(it => group.done?.[it.id]).length;
                        return (
                          <div key={group.title}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-bold text-faint tracking-wide">{group.title}</span>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                doneCount === group.items.length
                                  ? 'bg-gold/[0.14] text-gold-light'
                                  : doneCount === 0
                                  ? 'bg-white/[0.05] text-lo'
                                  : 'bg-warn/10 text-warn'
                              }`}>{doneCount}/{group.items.length}</span>
                            </div>
                            <div className="space-y-1">
                              {group.items.map(it => {
                                const isDone = !!group.done?.[it.id];
                                return (
                                  <div key={it.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${
                                    isDone ? 'bg-gold/[0.06]' : 'bg-white/[0.02]'
                                  }`}>
                                    <span className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${
                                      isDone ? 'bg-gold' : 'bg-white/[0.08]'
                                    }`}>
                                      {isDone && (
                                        <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      )}
                                    </span>
                                    <span className={`text-xs font-medium leading-tight ${isDone ? 'text-white' : 'text-lo'}`}>
                                      {it.icon && <span className="mr-1">{it.icon}</span>}{it.label}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <WorkoutSessionViewer memberId={parseInt(memberId)} date={activeDate} refreshTick={workoutTick} />

                    {/* Key nutrients collapsible — the member's own rule (Fixes-2i): the same
                        supplements maths, and unknown values are "not known", never zero. */}
                    {(log.food_items || []).some(f => Number(f?.grams) > 0) && (() => {
                      // The member's own inputs, as on their Today screen: sunlight counts toward vitamin D.
                      // The profile row names the coach's choice protocol_activities; the member's
                      // protocol (server/routes/logs.js) calls it activities. protocolFromProfile maps it.
                      const { activeActivities } = resolveProtocolItems(protocolFromProfile(data?.profile || {}));
                      const st = microStatus({ foodItems: log.food_items || [], supplements: log.supplements || {},
                        activities: log.activities || {}, activeActivities,
                        rdaOverrides: data?.profile?.rda_overrides || {} });
                      const KEYS = ['vit_b12','vit_d','vit_c','calcium','iron','magnesium','zinc','folate','omega3_epa','omega3_dha','fiber'];
                      const met = KEYS.filter(k => st.rows[k]?.status === 'met').length;
                      const unk = KEYS.filter(k => st.rows[k]?.status === 'unknown').length;
                      return (
                        <details className="border border-hair rounded-xl overflow-hidden" data-testid="coach-key-nutrients">
                          <summary className="px-3 py-2.5 text-xs font-semibold text-faint cursor-pointer
                            hover:text-gold list-none flex justify-between items-center bg-surface">
                            <span>🔬 Key Nutrients</span>
                            <span className={`px-2 py-0.5 rounded-full font-bold text-xs ${microCountTone(met, KEYS.length, unk)}`}>{met}/{KEYS.length}{unk ? ` · ${unk} not known` : ''} ▼</span>
                          </summary>
                          <div className="px-3 py-3 space-y-2 bg-surface">
                            {KEYS.map(k => <MicroRow key={k} r={st.rows[k]} custom={!!data?.profile?.rda_overrides?.[k]} />)}
                          </div>
                        </details>
                      );
                    })()}

                    {/* Notes */}
                    {log.notes && (
                      <p className="text-xs text-faint italic border-t border-white/[0.06] pt-2.5 leading-relaxed">
                        📝 {log.notes}
                      </p>
                    )}
                  </div>
                );
              }
