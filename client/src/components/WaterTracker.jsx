import { haptic } from '../store/settingsStore';

const QUICK_ADD = [250, 500, 750, 1000];

export default function WaterTracker({ value = 0, onChange, target = 3000 }) {
  const TARGET_ML = target;
  const pct     = Math.min((value / TARGET_ML) * 100, 100);
  const glasses = Math.round(value / 250);
  const litres  = (value / 1000).toFixed(2);
  const targetL = (TARGET_ML / 1000).toFixed(1);
  const done    = value >= TARGET_ML;
  const markers = [0.25, 0.5, 0.75, 1].map(f => Math.round(TARGET_ML * f));

  const add = (ml) => { haptic(20); onChange(Math.min(value + ml, 5000)); };
  const remove = () => { haptic(15); onChange(Math.max(0, value - 250)); };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1">
          <span className={`text-4xl font-bold tabular-nums transition-colors ${done ? 'text-[#7c5cfc]' : 'text-blue-400'}`}>
            {litres}
          </span>
          <span className="text-[#4e4e5c] text-sm font-medium">L / {targetL}L</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-[#4e4e5c]">{glasses} glasses</span>
          {done && <div className="text-xs font-semibold text-[#7c5cfc] mt-0.5">✓ Target reached!</div>}
        </div>
      </div>

      <div className="relative h-3 bg-white/[0.06] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{
          width: `${pct}%`,
          background: done ? 'linear-gradient(90deg, #7c5cfc, #22d3ee)' : 'linear-gradient(90deg, #38bdf8, #60a5fa)',
          boxShadow: done ? '0 0 12px rgba(124,92,252,0.40)' : '0 0 12px rgba(96,165,250,0.35)',
        }} />
      </div>

      <div className="flex justify-between text-[10px] text-[#3a3a46] -mt-2 px-0.5">
        {markers.map(ml => (
          <span key={ml} className={value >= ml ? 'text-[#7c5cfc] font-semibold' : ''}>
            {ml / 1000}L
          </span>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {QUICK_ADD.map(ml => (
          <button key={ml} onClick={() => add(ml)}
            style={{ minHeight: 48 }}
            className="py-2.5 text-xs font-semibold rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/15 hover:bg-blue-500/20 active:scale-95 transition-all">
            +{ml >= 1000 ? `${ml / 1000}L` : `${ml}ml`}
          </button>
        ))}
      </div>

      <button onClick={remove} disabled={value === 0}
        style={{ minHeight: 44 }}
        className="w-full py-2 text-xs font-medium rounded-xl bg-white/[0.04] text-[#4e4e5c] border border-white/[0.07] hover:bg-white/[0.07] disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-all">
        − Remove 250ml
      </button>
    </div>
  );
}
