import { Eyebrow, Icon, Pressable } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { planMeals, istMinutes, clock, untilText, itemKcal } from '../../lib/day';

/**
 * NextUp — the next meal from the coach's diet plan (Phase 2).
 *
 * One card, one question answered: "what do I eat next, and how much?"
 * The big button logs it exactly as planned; the sheet behind it lets the
 * member change grams or untick what they skipped before anything is saved.
 *
 * Shown only on today, and only while a prescribed meal is still unlogged.
 * When every meal is logged the card leaves: the Eat row carries the total.
 * Which meal is "next" is decided in lib/day/planMeals.js, not here.
 */
export default function NextUp({ mealPlans, food, onLog, onOther, terms }) {
  const nowMin = istMinutes();
  const { next, then, loggedCount, total } = planMeals({ mealPlans, food, nowMin });
  if (!next) return null;

  const when = next.missed ? 'Missed' : untilText(next.time, nowMin);
  const partly = next.pending.length !== next.items.length;
  const kcal = terms?.kcal || 'kcal';

  return (
    <section className="rounded-3xl border border-gold/40 bg-surface px-4 pt-3 pb-3.5" data-testid="next-up" aria-label="Next up">
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow tone="gold">Next up · from your coach</Eyebrow>
        <span className={`text-caption whitespace-nowrap ${next.missed ? 'text-amber-300 font-semibold' : 'text-mid'}`} data-testid="next-up-when">
          {when || `${loggedCount} of ${total} logged`}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-3 mt-1.5">
        <h2 className="text-lg font-semibold text-white min-w-0 leading-snug">
          {next.time && <span className="font-display text-gold tabular-nums">{clock(next.time)} </span>}
          {next.meal}
        </h2>
        <span className="text-sm text-mid tabular-nums whitespace-nowrap">{next.kcal.toLocaleString('en-IN')} {kcal}</span>
      </div>

      <ul className="mt-1.5">
        {next.items.map((it, i) => {
          const done = !next.pending.includes(it);
          return (
            <li key={i} className="flex items-baseline justify-between gap-3 py-1.5 border-b border-hair last:border-b-0">
              <span className={`text-sm min-w-0 ${done ? 'text-lo line-through' : 'text-white'}`}>{it.name}</span>
              <span className="text-caption text-mid tabular-nums text-right flex-shrink-0 max-w-[50%]">
                {done ? 'logged' : `${it.qty_text || `${it.grams} g`} · ${itemKcal(it)}`}
              </span>
            </li>
          );
        })}
      </ul>

      <Pressable variant="primary" className="w-full mt-3" data-testid="next-up-log"
        onPress={() => { haptic(10); onLog(next); }}>
        <Icon name="check" size={16} className="inline-block mr-1.5 -mt-0.5" />
        {partly ? `Log the other ${next.pending.length}` : 'Log as planned'}
      </Pressable>
      <Pressable variant="secondary" className="w-full mt-2" data-testid="next-up-other" onPress={() => { haptic(10); onOther(next); }}>
        I ate something else
      </Pressable>

      {then && (
        <p className="text-caption text-mid mt-2.5" data-testid="next-up-then">
          Then: {then.time ? `${clock(then.time)} ` : ''}{then.meal} · {then.kcal.toLocaleString('en-IN')} {kcal}
        </p>
      )}
    </section>
  );
}
