/**
 * EatenMacros — protein, carbs and fat eaten so far, for every member.
 *
 * Sachin, 10 Oct 2026: "need the calories macros to be shown in what's
 * consumed, for no plan and for plan". Before this, a member whose coach had
 * set targets saw protein only on Today and the four bars only inside the
 * food sheet; a member with no targets saw calories and nothing else.
 *
 *   with targets     37 / 120 g   and a thin bar per macro
 *   without targets  37 g         (the eaten number alone — no invented target)
 *
 * `variant="card"` adds the calories line and a frame, for the food sheet of
 * a member who has no targets (members with targets get MacroProgress there).
 */
const CELLS = [
  { k: 'pro',  label: 'Protein', bar: 'bg-blue-400' },
  { k: 'carb', label: 'Carbs',   bar: 'bg-amber-400' },
  { k: 'fat',  label: 'Fat',     bar: 'bg-amber-500' },
];

export function MacroCells({ eaten, targets, testId = 'eaten-macros' }) {
  return (
    <div className="grid grid-cols-3 gap-2" data-testid={testId}>
      {CELLS.map(c => {
        const v = Math.round(eaten?.[c.k] || 0);
        const t = targets?.[c.k] ? Math.round(targets[c.k]) : null;
        return (
          <div key={c.k} className="min-w-0" data-testid={`${testId}-${c.k}`}>
            <div className="text-eyebrow font-semibold uppercase tracking-widest text-lo">{c.label}</div>
            <div className="tabular-nums whitespace-nowrap leading-tight">
              <span className={`font-display font-semibold text-sm ${t && v > t ? 'text-amber-300' : 'text-white'}`}>{v}</span>
              <span className="text-caption text-lo">{t ? ` / ${t} g` : ' g'}</span>
            </div>
            {t && (
              <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden mt-1" aria-hidden="true">
                <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${Math.min(100, (v / t) * 100)}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EatenMacros({ eaten, targets = null, terms = { kcal: 'kcal' }, isToday = true }) {
  const kcal = Math.round(eaten?.kcal || 0);
  return (
    <div className="rounded-2xl border border-hair bg-surface px-4 py-3" data-testid="eaten-card">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-eyebrow font-semibold uppercase tracking-widest text-lo">{isToday ? 'Eaten today' : 'Eaten this day'}</span>
        <span className="tabular-nums whitespace-nowrap" data-testid="eaten-kcal">
          <span className="font-display font-semibold text-base text-white">{kcal.toLocaleString('en-IN')}</span>
          <span className="text-caption text-lo"> {terms.kcal}</span>
        </span>
      </div>
      <MacroCells eaten={eaten} targets={targets} />
      {!targets && (
        <p className="text-caption text-lo mt-2 leading-snug" data-testid="eaten-no-targets">
          No targets from your coach yet, so these are what you have eaten.
        </p>
      )}
    </div>
  );
}
