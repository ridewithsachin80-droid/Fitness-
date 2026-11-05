/**
 * lib/day/protocol.js — which protocol items are in force for a member.
 *
 * Built-in items (constants) plus the coach's custom ones, with per-member
 * label/timing overrides applied, filtered to the ids the coach switched on.
 * Moved out of useTodayModel in Sprint 6 so the Plan screen shows exactly the
 * same list Today ticks — one derivation, two screens.
 */
import { ACTIVITIES, ACV_ITEMS, SUPPLEMENTS } from '../../constants';

/** Fixes-3k: true for members created from Fixes-3k on (the server sends default_none / protocol_default_none). */
export const protocolDefaultNone = (p) => p?.default_none === true || p?.protocol_default_none === true;

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
  // Fixes-3k (UX review finding 3; Sachin's decision, 5 Nov): for a member created from Fixes-3k on
  // (protocol_default_none), "no coach selection" for supplements and apple cider vinegar means NONE of the built-in
  // items: the app no longer lists 7 supplements and 3 ACV doses nobody prescribed. Items the coach created for that
  // member still count. Existing members keep the old meaning (every built-in item), exactly as before, because the
  // old app saved "the coach ticked all" the same way as "never chosen". Activities: unchanged.
  const builtIn = new Set([...ACV_ITEMS, ...SUPPLEMENTS].map(i => i.id));
  const noneByDefault = protocolDefaultNone(protocol);
  const chosen = (list, item) => (Array.isArray(list) ? list.includes(item.id) : (!noneByDefault || !builtIn.has(item.id)));
  return {
    activeActivities:  allActivities.filter(a  => !protocol?.activities  || protocol.activities.includes(a.id)),
    activeACV:         allACV.filter(a         => chosen(protocol?.acv, a)),
    activeSupplements: allSupplements.filter(s => chosen(protocol?.supplements, s)),
  };
}
