import { Sheet, Pressable, EmptyState } from '../primitives';
import { NutritionSummary } from '../today/DayWidgets';

export default function NutritionSheet({ open, onClose, m }) {
  const { log, protocol, activeActivities, micro, loading } = m;
  // Same rule as the Today tile (Fixes-2i): unknown values are "not known", never zero.
  const hasData = !!micro?.hasData;
  return (
    <Sheet open={open && !loading} onClose={onClose} eyebrow="Nutrition"
      title={!hasData ? 'Vitamins, minerals, omega-3' : micro.known === 0 ? 'Not known for these foods'
        : `${micro.met} of ${micro.total} targets met${micro.unknown ? ` · ${micro.unknown} not known` : ''}`}
      footer={<Pressable variant="primary" className="w-full" onPress={onClose}>Done</Pressable>}>
      {hasData ? (
        <NutritionSummary
          foodItems={log.food || []}
          supplements={log.supplements || {}}
          activeActivities={activeActivities}
          activities={log.activities || {}}
          rdaOverrides={protocol?.rda_overrides || {}} />
      ) : (
        <EmptyState compact icon="pill" title="Log some food first"
          body="Vitamins, minerals and omega-3s are calculated from what you eat." />
      )}
    </Sheet>
  );
}
