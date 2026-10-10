import { planMeals, istMinutes } from '../../lib/day';
import { haptic } from '../../store/settingsStore';
import { useAIChat } from '../../store/aiChatStore';

/**
 * LogPlannedButton — under the chat's answer to a meal-plan question
 * ("what's today's meal plan?"): the next unlogged meal, one tap from logged.
 * It opens the same sheet as the Next up card.
 *
 * Which meal is "next" is worked out here, when the button is drawn, from the
 * live food log: so an answer given at 10 am does not still offer Breakfast at
 * 2 pm after Breakfast was logged, and with every planned meal logged there is
 * no button at all.
 *
 * Lives in its own file because AIChatLog is held under a line limit
 * (test-layout-contracts): new chat furniture goes beside it, not into it.
 */
export default function LogPlannedButton({ mealPlans = [], food = [], onLogPlanned }) {
  const next = planMeals({ mealPlans, food: food || [], nowMin: istMinutes() }).next;
  if (!next || !onLogPlanned) return null;
  return (
    <button type="button" data-testid="chat-log-planned" style={{ minHeight: 44 }}
      onClick={() => { haptic(10); useAIChat.getState().closeComposer(); onLogPlanned(next); }}
      className="mt-2.5 w-full rounded-xl bg-gold text-charcoal text-sm font-bold px-3">
      Log {next.meal} as planned
    </button>
  );
}
