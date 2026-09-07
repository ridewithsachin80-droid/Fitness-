import { Sheet, Pressable } from '../primitives';
import FoodLog from '../FoodLog';
import { MacroProgress, PrescribedMeals } from '../today/DayWidgets';

/**
 * FoodSheet — the food log, with the coach's prescribed meals above it and the
 * macro bars at the top so the member sees where the day stands before adding.
 *
 * `snap="full"` — a food search with a keyboard needs the whole screen.
 */
export default function FoodSheet({ open, onClose, m }) {
  const { log, protocol, update, logMeal, loading, activeActivities, workoutKcal, weightKg, kcalTarget } = m;
  return (
    <Sheet open={open && !loading} onClose={onClose} snap="full" eyebrow="Food" title="What did you eat?"
      footer={<Pressable variant="primary" className="w-full" onPress={onClose}>Done</Pressable>}>
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
            weightKg={weightKg}
          />
        </div>
      )}
      {protocol?.meal_plan?.length > 0 && (
        <PrescribedMeals mealPlan={protocol.meal_plan} foodItems={log.food} onLogMeal={logMeal} />
      )}
      <div id="section-food">
        <p className="text-caption text-lo mb-2">Enter weight before cooking · tap mic for voice input</p>
        <FoodLog items={log.food} onChange={v => update('food', v)} calorieTarget={kcalTarget} />
      </div>
    </Sheet>
  );
}
