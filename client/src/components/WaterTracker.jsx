const TARGET_ML = 3000;
const QUICK_ADD = [250, 500, 750, 1000];

export default function WaterTracker({ value = 0, onChange }) {
  const pct     = Math.min((value / TARGET_ML) * 100, 100);
  const glasses = Math.round(value / 250);
  const litres  = (value / 1000).toFixed(2);
  const done    = value >= TARGET_ML;

  return (
    <div className="space-y-4">

      {/* Amount display */}
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1">
          <span className={`text-4xl font-bold tabular-nums transition-colors ${
            done ? 'text-emerald-600' : 'text-blue-600'
          }`}>
            {litres}
          </span>
          <span className="text-stone-400 text-sm font-medium">L / 3.0L</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-stone-400">{glasses} glasses</span>
          {done && (
            <div className="text-xs font-semibold text-emerald-600 mt-0.5">✓ Target reached!</div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-3 bg-blue-50 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: done
              ? 'linear-gradient(90deg, #10b981, #059669)'
              : 'linear-gradient(90deg, #60a5fa, #3b82f6)',
          }}
        />
      </div>

      {/* Segment markers */}
      <div className="flex justify-between text-xs text-stone-300 -mt-2 px-0.5">
        {[750, 1500, 2250, 3000].map((ml) => (
          <span key={ml} className={value >= ml ? 'text-emerald-400 font-medium' : ''}>
            {ml / 1000}L
          </span>
        ))}
      </div>

      {/* Quick-add buttons */}
      <div className="grid grid-cols-4 gap-2">
        {QUICK_ADD.map((ml) => (
          <button
            key={ml}
            onClick={() => onChange(Math.min(value + ml, 5000))}
            className="py-2.5 text-xs font-semibold rounded-xl bg-blue-50 text-blue-700
              hover:bg-blue-100 active:scale-95 transition-all"
          >
            +{ml >= 1000 ? `${ml / 1000}L` : `${ml}ml`}
          </button>
        ))}
      </div>

      {/* Remove button */}
      <button
        onClick={() => onChange(Math.max(0, value - 250))}
        disabled={value === 0}
        className="w-full py-2 text-xs font-medium rounded-xl bg-stone-50 text-stone-500
          hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
      >
        − Remove 250ml
      </button>
    </div>
  );
}
