/**
 * components/food/TrafficBadge.jsx — the over/under target badge.
 * Moved out of components/FoodLog.jsx verbatim (Sprint 12c). Behaviour unchanged.
 */

export function TrafficBadge({ n, target }) {
  if (!n) return null;
  // No calorie target (no plan yet): the numbers still show, without the
  // coloured dot that compares against a target (10 Oct 2026). Before, the
  // whole line was hidden and a member without a plan saw no macros per food.
  const pct = target ? (n.cal / target) * 100 : null;
  const color = pct == null ? null : pct > 110 ? '#f87171' : pct > 80 ? '#fbbf24' : '#e0c98a';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }} data-testid="food-macros">
      {color && <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />}
      <span style={{ fontSize: 12, color: '#8e8e9a' }}>
        {n.cal} kcal · P{n.pro}g · C{n.carb}g · F{n.fat}g
      </span>
    </div>
  );
}

