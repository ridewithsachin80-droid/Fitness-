const SLEEP_TARGET_HRS = 8;

function calcHours(bedtime, waketime) {
  if (!bedtime || !waketime) return null;
  const [bh, bm] = bedtime.split(':').map(Number);
  const [wh, wm] = waketime.split(':').map(Number);
  let mins = (wh * 60 + wm) - (bh * 60 + bm);
  if (mins < 0) mins += 24 * 60;  // crossed midnight
  return (mins / 60).toFixed(1);
}

function sleepColor(hours) {
  if (!hours) return null;
  const h = parseFloat(hours);
  if (h >= 7.5) return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Good sleep' };
  if (h >= 6)   return { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   label: 'Fair sleep' };
  return           { bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     label: 'Insufficient' };
}

export default function SleepTracker({ value = {}, onChange }) {
  const { bedtime = '', waketime = '', quality = 0 } = value;
  const hours  = calcHours(bedtime, waketime);
  const colors = sleepColor(hours);

  const update = (field, val) => onChange({ ...value, [field]: val });

  return (
    <div className="space-y-4">

      {/* Time pickers */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { field: 'bedtime',  label: 'Bedtime',   hint: 'Target 10:00 PM', val: bedtime  },
          { field: 'waketime', label: 'Wake time',  hint: 'Target 6:30 AM',  val: waketime },
        ].map(({ field, label, hint, val }) => (
          <div key={field}>
            <label className="block text-xs text-stone-400 font-medium mb-1.5">
              {label}
              <span className="text-stone-300 ml-1">· {hint}</span>
            </label>
            <input
              type="time"
              value={val}
              onChange={(e) => update(field, e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm font-medium
                text-stone-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white
                transition-colors"
            />
          </div>
        ))}
      </div>

      {/* Duration pill */}
      {hours && (
        <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl border
          ${colors.bg} ${colors.border}`}>
          <span className={`text-sm font-semibold ${colors.text}`}>
            {hours} hours · {colors.label}
          </span>
          <div className="flex items-center gap-0.5">
            {[...Array(Math.round(SLEEP_TARGET_HRS))].map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i < Math.round(parseFloat(hours))
                    ? colors.text.replace('text-', 'bg-')
                    : 'bg-stone-200'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Quality rating */}
      <div>
        <label className="block text-xs text-stone-400 font-medium mb-2">Sleep quality</label>
        <div className="flex gap-2 justify-center">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => update('quality', star === quality ? 0 : star)}
              className={`text-2xl transition-all duration-150 hover:scale-110 ${
                star <= quality
                  ? 'opacity-100 scale-110'
                  : 'opacity-25 hover:opacity-60'
              }`}
              aria-label={`${star} star${star > 1 ? 's' : ''}`}
            >
              ⭐
            </button>
          ))}
        </div>
        {quality > 0 && (
          <p className="text-center text-xs text-stone-400 mt-1.5">
            {['', 'Poor', 'Below average', 'Average', 'Good', 'Excellent'][quality]}
          </p>
        )}
      </div>
    </div>
  );
}
