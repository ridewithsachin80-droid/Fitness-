import { useState } from 'react';
import { Sheet } from '../primitives';
import MacroEditor from '../food/MacroEditor';
import { carbsOf } from '../../lib/day';
import { haptic } from '../../store/settingsStore';

/**
 * ChatFoodMacros — the calories and macros on a food row of the AI chat
 * preview, with "Edit macros" (10 Oct 2026).
 *
 * The member's screenshot that started this: Oats 100 g, 374 kcal, P 13.2,
 * and the pack in their hand said 24 g protein. They can now fix the numbers
 * before logging; calories follow the macros. Lives in its own file because
 * AIChatLog.jsx is held under a line budget (test-layout-contracts).
 *
 * The whole preview row is a button that ticks the food on and off, so every
 * click here stops at this component — including clicks inside the sheet,
 * which React bubbles through the portal to the row.
 */

/** The preview food with the member's numbers applied, its row macros
 *  recomputed for the grams on screen. Any plausibility warning is dropped:
 *  the member has just read these numbers off the pack. */
export function foodWithLabel(f, per100g) {
  const k = (Number(f.grams) || 0) / 100;
  const rest = { ...f };
  delete rest.warning;
  return {
    ...rest, per_100g: per100g, label: true, source: 'member',
    macros: {
      ...(f.macros || {}),
      cal:  Math.round((per100g.calories || 0) * k),
      pro:  +((per100g.protein || 0) * k).toFixed(1),
      carb: +(carbsOf(per100g) * k).toFixed(1),
      fat:  +((per100g.fat || 0) * k).toFixed(1),
    },
  };
}

export default function ChatFoodMacros({ f, disabled, onSave }) {
  const [open, setOpen] = useState(false);
  const stop = (e) => e.stopPropagation();
  const openEditor = (e) => { e.stopPropagation(); haptic(10); setOpen(true); };
  return (
    <div className="text-right flex-shrink-0">
      <p className="text-body-sm font-bold text-orange-400">{f.macros?.cal ?? 0} kcal</p>
      <p className="text-eyebrow text-mid">
        P {f.macros?.pro ?? 0} · C {f.macros?.carb ?? 0} · F {f.macros?.fat ?? 0}
      </p>
      {!disabled && f.per_100g && (
        <span role="button" tabIndex={0} onClick={openEditor} data-testid="chat-edit-macros"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(e); } }}
          style={{ minHeight: 30 }}
          className="inline-flex items-center text-caption font-semibold text-gold px-1 -mr-1 rounded-md active:bg-gold/10">
          {f.label ? 'Your label · edit' : 'Edit macros'}
        </span>
      )}
      <span onClick={stop} onKeyDown={stop} onPointerDown={stop}>
        <Sheet open={open} onClose={() => setOpen(false)} eyebrow="Edit macros" title={`${f.name} · ${f.grams} g`}>
          {open && (
            <MacroEditor name={f.name} grams={f.grams} per100g={f.per_100g} foodId={f.food_id || null} isLabel={!!f.label}
              onSave={(per100g) => { onSave?.(per100g); setOpen(false); }} onCancel={() => setOpen(false)} />
          )}
        </Sheet>
      </span>
    </div>
  );
}
