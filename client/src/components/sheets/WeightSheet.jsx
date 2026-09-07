import { Sheet, Pressable, Icon } from '../primitives';

/**
 * WeightSheet — morning weight. Same input, same validation, same save path
 * (`update('weight', …)` → 4s auto-save) as the old inline panel.
 */
export default function WeightSheet({ open, onClose, m }) {
  const { log, update, weightWarning, validateWeight, weightDelta, yesterdayWeight } = m;
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Morning weight" title="After washroom, before food"
      footer={<Pressable variant="primary" className="w-full" onPress={onClose}>Done</Pressable>}>
      <div className="flex items-center gap-3 pt-1">
        <input type="number" step="0.1" inputMode="decimal" value={log.weight} placeholder="e.g. 92.5"
          aria-label="Weight in kilograms" data-testid="weight-input"
          onChange={e => { update('weight', e.target.value); validateWeight(e.target.value); }}
          style={{ minHeight: 56, fontSize: 26 }}
          className="flex-1 font-display font-semibold text-center border-2 border-white/[0.15] rounded-2xl py-2 focus:outline-none focus:ring-2 focus:ring-gold/30 text-white bg-surface tabular-nums" />
        <span className="text-lo font-semibold">kg</span>
      </div>
      {log.weight && yesterdayWeight != null && (
        <p className="text-caption text-mute mt-2 text-center">
          {weightDelta < 0 ? `↓ ${Math.abs(weightDelta).toFixed(1)} kg vs yesterday`
            : weightDelta > 0 ? `↑ ${weightDelta.toFixed(1)} kg vs yesterday` : 'Same as yesterday'}
        </p>
      )}
      {weightWarning && (
        <div className="mt-3 flex items-start gap-2 bg-amber-400/10 border border-amber-400/20 rounded-xl px-3 py-2" role="alert">
          <Icon name="warning" size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-400 leading-relaxed">{weightWarning}</p>
        </div>
      )}
    </Sheet>
  );
}
