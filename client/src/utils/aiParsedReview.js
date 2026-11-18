// Count of included things across a parsed preview
export const countIncluded = (p) =>
  (p.weightOn && p.weight_kg != null ? 1 : 0) +
  p.activities.filter(a => a.on).length +
  p.acv.filter(a => a.on).length +
  p.supplements.filter(s => s.on).length +
  (p.waterOn && p.water_ml_add ? 1 : 0) +
  (p.sleepOn && p.sleep ? 1 : 0) +
  ((p.bodyMetricsOn && p.bodyMetrics?.length) ? 1 : 0) +
  (p.corrections || []).filter(c => c.on).length +
  (p.notesOn && p.notes ? 1 : 0) +
  p.foods.filter(f => f.on).length +
  p.workouts.filter(w => w.on).length;
