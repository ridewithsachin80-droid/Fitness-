/**
 * lib/day/protocol.js — which protocol items are in force for a member.
 *
 * Built-in items (constants) plus the coach's custom ones, with per-member
 * label/timing overrides applied, filtered to the ids the coach switched on.
 * Moved out of useTodayModel in Sprint 6 so the Plan screen shows exactly the
 * same list Today ticks — one derivation, two screens.
 */
import { ACTIVITIES, ACV_ITEMS, SUPPLEMENTS } from '../../constants';

export function resolveProtocolItems(protocol) {
  const overrides = protocol?.item_overrides || {};
  const applyOverride = (item) => {
    const ov = overrides[item.id];
    if (!ov) return item;
    const timing = [ov.fromTime, ov.toTime].filter(Boolean).join('–');
    const sub    = [ov.totalTime, timing].filter(Boolean).join(' · ') || ov.sub || item.sub || '';
    return { ...item, label: ov.label || item.label, sub };
  };
  const allActivities  = [...ACTIVITIES,  ...(protocol?.custom_activities  || [])].map(applyOverride);
  const allACV         = [...ACV_ITEMS,   ...(protocol?.custom_acv         || [])].map(applyOverride);
  const allSupplements = [...SUPPLEMENTS, ...(protocol?.custom_supplements || [])].map(applyOverride);
  return {
    activeActivities:  allActivities.filter(a  => !protocol?.activities  || protocol.activities.includes(a.id)),
    activeACV:         allACV.filter(a         => !protocol?.acv         || protocol.acv.includes(a.id)),
    activeSupplements: allSupplements.filter(s => !protocol?.supplements || protocol.supplements.includes(s.id)),
  };
}
