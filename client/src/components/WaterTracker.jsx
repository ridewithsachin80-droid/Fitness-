const QUICK_ADD = [250, 500, 750, 1000];

export default function WaterTracker({ value = 0, onChange, target = 3000 }) {
  const TARGET_ML = target;
  const pct     = Math.min((value / TARGET_ML) * 100, 100);
  const glasses = Math.round(value / 250);
  const litres  = (value / 1000).toFixed(2);
  const targetL = (TARGET_ML / 1000).toFixed(1);
  const done    = value >= TARGET_ML;
  const markers = [0.25, 0.5, 0.75, 1].map(f => Math.round(TARGET_ML * f));

  return (
    <div className="space-y-4">

      {/* Amount display */}
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1">
          <span className={`text-4xl font-bold tabular-nums transition-colors ${
            done ? 'text-[#2ce89c]' : 'text-blue-400'
          }`} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {litres}
          </span>
          <span className="text-[#4e4e5c] text-sm font-medium">L / {targetL}L</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-[#4e4e5c]">{glasses} glasses</span>
          {done && (
            <div className="text-xs font-semibold text-[#2ce89c] mt-0.5">✓ Target reached!</div>
          )}
        </div>
      </div>

      {/* Progress track */}
      <div className="relative h-3 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: done
              ? 'linear-gradient(90deg, #2ce89c, #0d9b72)'
              : 'linear-gradient(90deg, #38bdf8, #60a5fa)',
            boxShadow: done
              ? '0 0 12px rgba(44,232,156,0.35)'
              : '0 0 12px rgba(96,165,250,0.35)',
          }}
        />
      </div>

      {/* Segment markers */}
      <div className="flex justify-between text-[10px] text-[#3a3a46] -mt-2 px-0.5">
        {markers.map(ml => (
          <span key={ml} className={value >= ml ? 'text-[#2ce89c] font-semibold' : ''}>
            {ml / 1000}L
          </span>
        ))}
      </div>

      {/* Quick-add buttons */}
      <div className="grid grid-cols-4 gap-2">
        {QUICK_ADD.map(ml => (
          <button key={ml}
            onClick={() => onChange(Math.min(value + ml, 5000))}
            className="py-2.5 text-xs font-semibold rounded-xl bg-blue-500/10 text-blue-400
              border border-blue-500/15 hover:bg-blue-500/20 active:scale-95 transition-all">
            +{ml >= 1000 ? `${ml / 1000}L` : `${ml}ml`}
          </button>
        ))}
      </div>

      {/* Remove button */}
      <button
        onClick={() => onChange(Math.max(0, value - 250))}
        disabled={value === 0}
        className="w-full py-2 text-xs font-medium rounded-xl bg-white/[0.04] text-[#4e4e5c]
          border border-white/[0.07] hover:bg-white/[0.07] disabled:opacity-30
          disabled:cursor-not-allowed active:scale-95 transition-all">
        − Remove 250ml
      </button>
    </div>
  );
}
