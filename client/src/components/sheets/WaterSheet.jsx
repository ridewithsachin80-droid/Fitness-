import { Sheet, Pressable } from '../primitives';
import { haptic } from '../../store/settingsStore';

export default function WaterSheet({ open, onClose, m }) {
  const { log, protocol, update } = m;
  const water  = log.water || 0;
  const target = protocol?.water_target || 3000;
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Water" title={`Target ${(target / 1000).toFixed(1)} L`}
      footer={<Pressable variant="primary" className="w-full" onPress={onClose}>Done</Pressable>}>
      <p className="text-caption text-lo">Stop 1 hr before sleep · not during meals</p>
      <p className="font-display text-num-lg font-semibold text-white mt-2 tabular-nums" data-testid="water-total">
        {(water / 1000).toFixed(2)}
        <span className="text-sm text-lo font-sans font-medium"> / {(target / 1000).toFixed(1)} L</span>
        <span className="text-caption text-lo font-sans font-semibold float-right mt-3">{Math.round(water / 250)} glasses</span>
      </p>
      <div className="h-2 rounded-full bg-white/[0.07] overflow-hidden mt-2 mb-3">
        <div className="h-full rounded-full bg-blue-400 transition-all" style={{ width: `${Math.min(100, (water / target) * 100)}%` }} />
      </div>
      <div className="flex gap-1.5">
        {[250, 500, 750, 1000].map(ml => (
          <button key={ml} type="button" data-testid={`water-add-${ml}`}
            onClick={() => { update('water', Math.min(10000, water + ml)); haptic(12); }}
            style={{ minHeight: 44 }}
            className="flex-1 text-caption font-bold text-blue-300 bg-blue-400/[0.08] border border-blue-400/25 rounded-xl active:scale-95 transition-transform">
            +{ml >= 1000 ? '1L' : ml}
          </button>
        ))}
      </div>
      {water > 0 && (
        <button type="button" onClick={() => { update('water', Math.max(0, water - 250)); haptic(10); }}
          style={{ minHeight: 38 }}
          className="w-full mt-2 text-eyebrow font-bold text-lo hover:text-red-400 rounded-xl border border-white/[0.06] transition-colors">
          − Remove 250ml
        </button>
      )}
    </Sheet>
  );
}
