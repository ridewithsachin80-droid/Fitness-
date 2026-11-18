import { useRef } from 'react';
import { Sheet, Pressable, Collapsible } from '../primitives';
import FoodLog from '../FoodLog';
import { MacroProgress, PrescribedMeals } from '../today/DayWidgets';
import EatenMacros from '../today/EatenMacros';

/**
 * FoodSheet — the food log, with the coach's prescribed meals above it and the
 * macro bars at the top so the member sees where the day stands before adding.
 *
 * `snap="full"` — a food search with a keyboard needs the whole screen.
 */
export default function FoodSheet({ open, onClose, m }) {
  const mealHeadingRef = useRef(null);
  const { log, protocol, update, logMeal, loading, activeActivities, workoutKcal, weightKg, kcalTarget, eaten, terms, isToday } = m;
  return (
    <Sheet size="lg" open={open && !loading} onClose={onClose} snap="full" eyebrow="Food" title={m.foodTarget?.label || "What did you eat?"} initialFocusRef={mealHeadingRef}
      footer={<Pressable variant="primary" className="w-full" onPress={onClose}>Done</Pressable>}>
      {/* 16 Oct 2026: the day's totals on one line, the bars folded away, so the
          foods come first. Opening "Macros & nutrients" shows everything as before. */}
      <p className="text-sm text-white mb-2 tabular-nums" data-testid="food-day-total">
        <span className="font-display text-base">{Math.round(m.kcalIn || 0).toLocaleString('en-IN')}</span>
        {kcalTarget ? <span className="text-lo"> / {Number(kcalTarget).toLocaleString('en-IN')} kcal</span> : <span className="text-lo"> kcal</span>}
        <span className="text-mid"> · P {Math.round(eaten?.pro || 0)} g · C {Math.round(eaten?.carb || 0)} g · F {Math.round(eaten?.fat || 0)} g</span>
      </p>
      <div className="mb-3"><Collapsible title="Macros & nutrients" summary={protocol?.macros ? 'Your targets, bar by bar' : 'What you have eaten today'} testId="food-macros-details">
      {protocol?.macros && (
        <div className="mb-3 -mx-1">
          <MacroProgress
            workoutKcal={workoutKcal}
            macros={protocol.macros}
            foodItems={log.food || []}
            supplements={log.supplements || {}}
            activeActivities={activeActivities}
            activities={log.activities || {}}
            overrides={protocol?.item_overrides || {}}
            rdaOverrides={protocol?.rda_overrides || {}}
            weightKg={weightKg}
          />
        </div>
      )}
      {/* No targets from the coach: the four eaten numbers on their own (10 Oct 2026). */}
      {!protocol?.macros && eaten && (
        <div className="mb-3"><EatenMacros eaten={eaten} terms={terms} isToday={isToday} /></div>
      )}
      </Collapsible></div>
      {protocol?.meal_plan?.length > 0 && (
        <PrescribedMeals mealPlan={protocol.meal_plan} foodItems={log.food} onLogMeal={logMeal} />
      )}
      <div id="section-food">
        <p className="text-caption text-lo mb-2">Each food you add says whether to weigh it raw or cooked</p>
        <FoodLog mealTarget={m.foodTarget} mealHeadingRef={mealHeadingRef} items={log.food} onChange={v => update('food', v)} calorieTarget={kcalTarget} />
      </div>
    </Sheet>
  );
}
