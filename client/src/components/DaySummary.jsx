/**
 * DaySummary.jsx — a member's whole day, rendered from structured fields.
 *
 * Shared by the coach chat and the member chat. Both ask the same question of
 * the same data, so both should get the same card; the member side used to get
 * a prose paragraph only because that path was written first.
 *
 * The server sends real fields, not text. An earlier version had the model
 * format the summary and it came back as one run-on paragraph, because a
 * language model's line breaks are a suggestion rather than a contract.
 */
// ── Day summary ───────────────────────────────────────────────────────────────
// Rendered from real fields, so the layout is fixed rather than whatever the
// model felt like emitting. One row per area, label left, figures right, and a
// "left:" line only where there is something outstanding — a coach scanning
// this wants the gaps to stand out, not to read "left: none" six times.
export default function DaySummary({ s }) {
  const Row = ({ label, children }) => (
    <div className="py-2 border-t border-white/[0.06] first:border-t-0 first:pt-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.10em] text-[#7E8596] mb-1">{label}</p>
      {children}
    </div>
  );

  // "nothing assigned" and "assigned but none done" look identical as "none"
  // and mean opposite things, so they are worded differently.
  const Protocol = ({ label, p }) => {
    if (!p.assigned) return null;
    return (
      <Row label={label}>
        <p className="text-sm text-[#FFFFFF] leading-relaxed">
          {p.done.length ? p.done.join(', ') : 'nothing yet'}
          <span className="text-[#7E8596]"> · {p.done.length}/{p.total}</span>
        </p>
        {p.left.length > 0 && (
          <p className="text-sm text-amber-300 leading-relaxed mt-0.5">
            left: {p.left.join(', ')}
          </p>
        )}
      </Row>
    );
  };

  const f = s.food, w = s.water;

  return (
    <div className="mt-0.5">
      <Row label="Food">
        <p className="text-sm text-[#FFFFFF]">
          <span className="font-display text-base font-semibold">{f.kcal}</span> kcal
          <span className="text-[#7E8596]"> · P {f.protein}g · C {f.carbs}g · F {f.fat}g</span>
        </p>
        {f.target != null && (
          <p className={`text-sm mt-0.5 ${f.over ? 'text-red-400' : 'text-amber-300'}`}>
            {f.over
              ? `${Math.abs(f.remaining)} kcal over the ${f.target} target`
              : `${f.remaining} kcal left of ${f.target}`}
          </p>
        )}
        <p className="text-sm text-[#9EA3B0] mt-0.5 leading-relaxed">
          {f.items.length
            ? f.items.map(i => `${i.name} ${i.grams}g`).join(', ')
            : 'nothing logged'}
        </p>
      </Row>

      <Row label="Water">
        <p className="text-sm text-[#FFFFFF]">
          <span className="font-display text-base font-semibold">{w.drunk}</span> ml
          {w.target != null && <span className="text-[#7E8596]"> of {w.target} ml</span>}
        </p>
        {w.remaining != null && w.remaining > 0 && (
          <p className="text-sm text-amber-300 mt-0.5">{w.remaining} ml to go</p>
        )}
        {w.remaining === 0 && w.target != null && (
          <p className="text-sm text-emerald-400 mt-0.5">target met</p>
        )}
      </Row>

      <Protocol label="Activities"  p={s.activities} />
      <Protocol label="ACV"         p={s.acv} />
      <Protocol label="Supplements" p={s.supplements} />

      {(s.weight != null || s.sleep) && (
        <Row label="Body">
          <p className="text-sm text-[#FFFFFF]">
            {s.weight != null ? `${s.weight} kg` : 'weight not logged'}
            {s.sleep && <span className="text-[#7E8596]"> · slept {s.sleep}</span>}
          </p>
        </Row>
      )}

      {!s.logged_anything && (
        <p className="text-sm text-amber-300 mt-2 leading-relaxed">
          Nothing logged today yet.
        </p>
      )}
    </div>
  );
}
