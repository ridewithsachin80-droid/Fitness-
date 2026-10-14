import { Sheet } from '../primitives';
import { calcN } from '../../lib/coach/dayMath.jsx';

/** Read-only coach history; the selected log is never mutated here. */
export default function CoachHistorySheet({ log, onClose }) {
  if (!log) return null;
  const fl = log;
  const dateLabel = new Date(String(fl.log_date).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const foodItems = fl.food_items || [];
  const totalKcal = foodItems.reduce((sum, item) => sum + (calcN(item)?.cal || 0), 0);
  return (
    <Sheet open onClose={onClose} title={dateLabel} eyebrow="Daily history">
      <div data-testid="coach-history" className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {fl.weight_kg && <span className="text-sm font-semibold text-gold-deep">{fl.weight_kg} kg</span>}
          {fl.compliance_pct != null && <span className="text-sm text-mid">{fl.compliance_pct}% compliance</span>}
        </div>
                  {foodItems.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-lo tracking-wider mb-2">
                        🥗 Food {totalKcal > 0 && <span className="font-normal text-orange-300 normal-case">· {totalKcal} kcal</span>}
                      </p>
                      <div className="space-y-1">
                        {foodItems.map((item, i) => {
                          const n = calcN(item);
                          return (
                            <div key={i} className="flex items-center justify-between gap-3 text-sm py-1.5 border-b border-white/[0.05] last:border-0">
                              <div className="min-w-0 break-words">
                                <span className="text-white font-medium">{item.name}</span>
                                <span className="text-xs text-lo ml-1">{item.grams}g{item.meal ? ` · ${item.meal}` : ''}</span>
                              </div>
                              {n && <span className="shrink-0 text-xs font-bold text-orange-300">{n.cal} kcal</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {fl.water_ml > 0 && (
                    <p className="text-sm text-blue-400 font-semibold">💧 {(fl.water_ml / 1000).toFixed(1)} L water</p>
                  )}
                  {fl.notes && (
                    <div>
                      <p className="text-xs font-bold text-lo tracking-wider mb-1">📝 Notes</p>
                      <p className="text-sm text-mid whitespace-pre-wrap break-words leading-relaxed">{fl.notes}</p>
                    </div>
                  )}
                  {!foodItems.length && !fl.weight_kg && !(fl.water_ml > 0) && !fl.notes && <p className="text-sm text-lo italic text-center py-4">No data recorded this day.</p>}

      </div>
    </Sheet>
  );
}
